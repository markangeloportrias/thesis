<?php
declare(strict_types=1);
require_once __DIR__ . '/recovery-mailer.php';

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

function instructorRecoveryCodeHash(string $uid, string $code): string
{
    return hash('sha256', 'instructor-code:' . $uid . ':' . $code);
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
        $from = (string)($settings['from_email'] ?? '') ?: (string)($settings['smtp_username'] ?? '');
        if (!filter_var($url, FILTER_VALIDATE_URL) || parse_url($url, PHP_URL_SCHEME) !== 'https'
            || parse_url($url, PHP_URL_QUERY) !== null || parse_url($url, PHP_URL_FRAGMENT) !== null
            || !filter_var($from, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $from)) {
            respond(['ok'=>false, 'message'=>'Email recovery is not configured yet. Please contact the administrator.'], 503);
        }
        if ($sendMail === null) {
            try { $mailer = createRecoveryMailer($settings); }
            catch (Throwable $error) {
                error_log('Instructor recovery SMTP configuration unavailable; check deployment dependencies and mail settings.');
                respond(['ok'=>false, 'message'=>'Email recovery is not configured yet. Please contact the administrator.'], 503);
            }
            $sendMail = static function (string $to, string $subject, string $body) use ($mailer): bool {
                return sendRecoverySmtpMail($mailer, $to, $subject, $body);
            };
        }
        $message = 'If this email belongs to an active instructor account, a recovery code will be sent. Check your inbox and spam folder. If you requested one recently, use the latest code or wait two minutes before requesting another.';
        $pdo->beginTransaction();
        $account = $pdo->prepare("SELECT account_uid FROM instructor_accounts WHERE email=? AND status='active' AND archived_at IS NULL FOR UPDATE");
        $account->execute([$email]);
        $uid = $account->fetchColumn();
        if ($uid) {
            // Per-account cooldown also prevents repeated mail from different IPs.
            $recent = $pdo->prepare('SELECT 1 FROM instructor_password_resets WHERE instructor_uid=? AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE) LIMIT 1');
            $recent->execute([$uid]);
            if (!$recent->fetchColumn()) {
                $code = str_pad((string)random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
                $pdo->prepare('UPDATE instructor_password_resets SET used_at=NOW() WHERE instructor_uid=? AND used_at IS NULL')->execute([$uid]);
                $pdo->prepare('INSERT INTO instructor_password_resets (instructor_uid,token_hash,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 10 MINUTE))')->execute([$uid, instructorRecoveryCodeHash((string)$uid, $code)]);
                $body = "An instructor password reset was requested for your Clinical Portal account.\n\nYour recovery code is: " . $code . "\n\nEnter this code in the recovery window at " . $url . ". After verification, you can choose a new password.\n\nThis code expires in 10 minutes and can be used once. Do not share it. If you did not request this, you can ignore this email.\n";
                $sent = $sendMail($email, 'Clinical Portal - Reset instructor password', $body, [
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

    if ($action === 'instructor-verify-code') {
        try { $email = instructorRecoveryEmail($data['email'] ?? ''); }
        catch (InvalidArgumentException $error) { respond(['ok'=>false, 'message'=>$error->getMessage()], 422); }
        $code = trim((string)($data['code'] ?? ''));
        $invalid = ['ok'=>false, 'message'=>'The recovery code is incorrect or expired. Use the latest code or request another.'];
        if (!preg_match('/\A[0-9]{8}\z/', $code)) respond($invalid, 422);
        $pdo->beginTransaction();
        $account = $pdo->prepare("SELECT account_uid FROM instructor_accounts WHERE email=? AND status='active' AND archived_at IS NULL FOR UPDATE");
        $account->execute([$email]);
        $uid = $account->fetchColumn();
        if (!$uid) { $pdo->rollBack(); respond($invalid, 422); }
        // A shared per-account bucket prevents guessing by switching IP addresses.
        // It survives new code requests and is serialized by the account row lock.
        $identity = hash('sha256', (string)$uid);
        $bucket = hash('sha256', 'instructor-recovery-all-ips');
        $limit = $pdo->prepare("SELECT failure_count FROM auth_login_attempts WHERE role_name='ins-code-account' AND identity_hash=? AND ip_hash=? AND last_failed_at>DATE_SUB(NOW(), INTERVAL 15 MINUTE)");
        $limit->execute([$identity, $bucket]);
        if ((int)$limit->fetchColumn() >= 5) {
            $pdo->rollBack();
            respond(['ok'=>false, 'message'=>'Too many code attempts. Wait 15 minutes and request a new code.'], 429);
        }
        $attempt = $pdo->prepare("INSERT INTO auth_login_attempts (role_name,identity_hash,ip_hash,failure_count) VALUES ('ins-code-account',?,?,1)
            ON DUPLICATE KEY UPDATE failure_count=IF(last_failed_at<DATE_SUB(NOW(), INTERVAL 15 MINUTE),1,failure_count+1),last_failed_at=NOW()");
        $attempt->execute([$identity, $bucket]);
        $valid = $pdo->prepare('SELECT id FROM instructor_password_resets WHERE instructor_uid=? AND token_hash=? AND used_at IS NULL AND expires_at>NOW() FOR UPDATE');
        $valid->execute([$uid, instructorRecoveryCodeHash((string)$uid, $code)]);
        $resetId = $valid->fetchColumn();
        if (!$resetId) { $pdo->commit(); respond($invalid, 422); }
        // Replace the code hash with a high-entropy, short-lived reset permission.
        // The emailed code can no longer be exchanged after this transaction.
        $token = bin2hex(random_bytes(32));
        $pdo->prepare('UPDATE instructor_password_resets SET token_hash=?,expires_at=DATE_ADD(NOW(),INTERVAL 10 MINUTE) WHERE id=?')->execute([hash('sha256', $token), $resetId]);
        $pdo->commit();
        respond(['ok'=>true, 'token'=>$token, 'message'=>'Code verified. Choose your new password.']);
    }

    $token = (string)($data['token'] ?? '');
    $password = (string)($data['password'] ?? '');
    if (!preg_match('/\A[a-f0-9]{64}\z/', $token)) respond(['ok'=>false, 'message'=>'Your reset session is invalid or expired. Request a new code.'], 422);
    if (!instructorRecoveryPassword($password)) respond(['ok'=>false, 'message'=>'Use a password between 8 and 72 bytes long.'], 422);
    $hash = hash('sha256', $token);
    $lookup = $pdo->prepare('SELECT instructor_uid FROM instructor_password_resets WHERE token_hash=?');
    $lookup->execute([$hash]);
    $uid = $lookup->fetchColumn();
    if (!$uid) respond(['ok'=>false, 'message'=>'Your reset session is invalid or expired. Request a new code.'], 422);
    $pdo->beginTransaction();
    // Lock the account first, consistently with issuance and admin updates.
    $account = $pdo->prepare("SELECT account_uid FROM instructor_accounts WHERE account_uid=? AND status='active' AND archived_at IS NULL FOR UPDATE");
    $account->execute([$uid]);
    $active = $account->fetchColumn();
    $valid = $pdo->prepare('SELECT id FROM instructor_password_resets WHERE token_hash=? AND instructor_uid=? AND used_at IS NULL AND expires_at>NOW() FOR UPDATE');
    $valid->execute([$hash, $uid]);
    if (!$active || !$valid->fetchColumn()) {
        $pdo->rollBack();
        respond(['ok'=>false, 'message'=>'Your reset session is invalid or expired. Request a new code.'], 422);
    }
    $pdo->prepare('UPDATE instructor_accounts SET password=?, email_verified_at=NOW() WHERE account_uid=?')->execute([password_hash($password, PASSWORD_DEFAULT), $uid]);
    $pdo->prepare('UPDATE instructor_password_resets SET used_at=NOW() WHERE instructor_uid=? AND used_at IS NULL')->execute([$uid]);
    $pdo->prepare("UPDATE api_sessions SET revoked_at=NOW() WHERE role='instructor' AND user_uid=? AND revoked_at IS NULL")->execute([$uid]);
    $pdo->commit();
    respond(['ok'=>true, 'message'=>'Your password has been reset. Sign in with your new password.']);
}
