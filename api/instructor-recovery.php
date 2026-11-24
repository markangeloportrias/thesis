<?php
declare(strict_types=1);

function instructorRecoveryEmail($value): string
{
    $email = strtolower(trim((string)$value));
    if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException('Enter a valid instructor recovery email.');
    }
    return $email;
}

function instructorRecoveryPassword(string $password): bool
{
    return strlen($password) >= 8 && strlen($password) <= 72 && strpos($password, "\0") === false;
}

function handleInstructorRecovery(PDO $pdo, array $config, string $action, array $data, ?callable $sendMail = null): void
{
    header('Cache-Control: no-store');
    if (!columnExists($pdo, 'instructor_accounts', 'email') || !portalTableExists($pdo, 'instructor_password_resets')) {
        respond(['ok'=>false, 'message'=>'Password recovery is not available yet. Please contact the administrator.'], 503);
    }
    // Count requests across all addresses/tokens for the requesting IP.
    $rateRole = $action === 'instructor-forgot-password' ? 'ins-reset-request' : 'ins-reset-submit';
    if (loginIsLocked($pdo, $rateRole, 'recovery')) {
        respond(['ok'=>false, 'message'=>'Too many attempts. Please try again in 15 minutes.'], 429);
    }
    recordLoginFailure($pdo, $rateRole, 'recovery');

    if ($action === 'instructor-forgot-password') {
        try { $email = instructorRecoveryEmail($data['email'] ?? ''); }
        catch (InvalidArgumentException $error) { respond(['ok'=>false, 'message'=>$error->getMessage()], 422); }
        $settings = $config['instructor_recovery'] ?? [];
        $url = (string)($settings['login_url'] ?? '');
        $from = (string)($settings['from_email'] ?? '');
        if (!filter_var($url, FILTER_VALIDATE_URL) || parse_url($url, PHP_URL_SCHEME) !== 'https'
            || parse_url($url, PHP_URL_QUERY) !== null || parse_url($url, PHP_URL_FRAGMENT) !== null
            || !filter_var($from, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $from)) {
            respond(['ok'=>false, 'message'=>'Email recovery is not configured yet. Please contact the administrator.'], 503);
        }
        $message = 'If this email belongs to an active instructor account, a reset link will be sent. Check your inbox and spam folder.';
        $pdo->beginTransaction();
        $account = $pdo->prepare("SELECT account_uid FROM instructor_accounts WHERE email=? AND status='active' AND archived_at IS NULL FOR UPDATE");
        $account->execute([$email]);
        $uid = $account->fetchColumn();
        if ($uid) {
            // Per-account cooldown also prevents repeated mail from different IPs.
            $recent = $pdo->prepare('SELECT 1 FROM instructor_password_resets WHERE instructor_uid=? AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE) LIMIT 1');
            $recent->execute([$uid]);
            if (!$recent->fetchColumn()) {
                $token = bin2hex(random_bytes(32));
                $pdo->prepare('UPDATE instructor_password_resets SET used_at=NOW() WHERE instructor_uid=? AND used_at IS NULL')->execute([$uid]);
                $pdo->prepare('INSERT INTO instructor_password_resets (instructor_uid,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 30 MINUTE))')->execute([$uid, hash('sha256', $token)]);
                // Fragment avoids putting the secret in server logs or referrers.
                $link = $url . '#instructor-reset=' . $token;
                $body = "An instructor password reset was requested for your Clinical Portal account.\n\nOpen this link to choose a new password:\n" . $link . "\n\nThis link expires in 30 minutes and can be used once. If you did not request this, you can ignore this email.\n";
                $sent = ($sendMail ?? 'mail')($email, 'Clinical Portal - Reset instructor password', $body, [
                    'From' => $from, 'MIME-Version' => '1.0', 'Content-Type' => 'text/plain; charset=UTF-8',
                ]);
                if (!$sent) {
                    $pdo->rollBack();
                    error_log('Instructor reset mail was not accepted by the mail transport.');
                    // Keep the same public response to avoid disclosing account membership.
                    respond(['ok'=>true, 'message'=>$message]);
                }
            }
        }
        $pdo->commit();
        respond(['ok'=>true, 'message'=>$message]);
    }

    $token = (string)($data['token'] ?? '');
    $password = (string)($data['password'] ?? '');
    if (!preg_match('/\A[a-f0-9]{64}\z/', $token)) respond(['ok'=>false, 'message'=>'This reset link is invalid or expired. Request a new link.'], 422);
    if (!instructorRecoveryPassword($password)) respond(['ok'=>false, 'message'=>'Use a password between 8 and 72 bytes long.'], 422);
    $hash = hash('sha256', $token);
    $lookup = $pdo->prepare('SELECT instructor_uid FROM instructor_password_resets WHERE token_hash=?');
    $lookup->execute([$hash]);
    $uid = $lookup->fetchColumn();
    if (!$uid) respond(['ok'=>false, 'message'=>'This reset link is invalid or expired. Request a new link.'], 422);
    $pdo->beginTransaction();
    // Lock the account first, consistently with issuance and admin updates.
    $account = $pdo->prepare("SELECT account_uid FROM instructor_accounts WHERE account_uid=? AND status='active' AND archived_at IS NULL FOR UPDATE");
    $account->execute([$uid]);
    $active = $account->fetchColumn();
    $valid = $pdo->prepare('SELECT id FROM instructor_password_resets WHERE token_hash=? AND instructor_uid=? AND used_at IS NULL AND expires_at>NOW() FOR UPDATE');
    $valid->execute([$hash, $uid]);
    if (!$active || !$valid->fetchColumn()) {
        $pdo->rollBack();
        respond(['ok'=>false, 'message'=>'This reset link is invalid or expired. Request a new link.'], 422);
    }
    $pdo->prepare('UPDATE instructor_accounts SET password=?, email_verified_at=NOW() WHERE account_uid=?')->execute([password_hash($password, PASSWORD_DEFAULT), $uid]);
    $pdo->prepare('UPDATE instructor_password_resets SET used_at=NOW() WHERE instructor_uid=? AND used_at IS NULL')->execute([$uid]);
    $pdo->prepare("UPDATE api_sessions SET revoked_at=NOW() WHERE role='instructor' AND user_uid=? AND revoked_at IS NULL")->execute([$uid]);
    $pdo->commit();
    respond(['ok'=>true, 'message'=>'Your password has been reset. Sign in with your new password.']);
}
