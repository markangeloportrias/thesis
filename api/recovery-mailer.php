<?php
declare(strict_types=1);

function recoverySmtpSettings(array $settings): array
{
    $username = trim((string)($settings['smtp_username'] ?? ''));
    $password = preg_replace('/\s+/', '', (string)($settings['smtp_password'] ?? ''));
    $from = trim((string)($settings['from_email'] ?? '')) ?: $username;
    if (!filter_var($username, FILTER_VALIDATE_EMAIL) || !filter_var($from, FILTER_VALIDATE_EMAIL)
        || strcasecmp($username, $from) !== 0 || $password === '') {
        throw new RuntimeException('Gmail SMTP settings are missing or the sender does not match the Gmail account.');
    }
    return ['username'=>$username, 'password'=>$password, 'from'=>$from];
}

function createRecoveryMailer(array $settings): \PHPMailer\PHPMailer\PHPMailer
{
    $smtp = recoverySmtpSettings($settings);
    $autoload = __DIR__ . '/vendor/autoload.php';
    if (!is_file($autoload)) throw new RuntimeException('Email delivery library is not installed.');
    require_once $autoload;
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mail->isSMTP();
    $mail->Host = 'smtp.gmail.com';
    $mail->Port = 465;
    $mail->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
    $mail->SMTPAuth = true;
    $mail->Username = $smtp['username'];
    $mail->Password = $smtp['password'];
    $mail->SMTPDebug = 0;
    $mail->Timeout = 15;
    $mail->Timelimit = 20;
    $mail->SMTPOptions = ['ssl'=>['verify_peer'=>true,'verify_peer_name'=>true,'allow_self_signed'=>false]];
    $mail->CharSet = 'UTF-8';
    $mail->setFrom($smtp['from'], 'MIDWIFE Clinical Portal');
    $mail->isHTML(false);
    return $mail;
}

function sendRecoverySmtpMail(\PHPMailer\PHPMailer\PHPMailer $mail, string $to, string $subject, string $body): bool
{
    try {
        $mail->addAddress($to);
        $mail->Subject = $subject;
        $mail->Body = $body;
        return $mail->send();
    } catch (Throwable $error) {
        // Log a diagnostic category only; never credentials, message body or code.
        $detail = strtolower($mail->ErrorInfo);
        $category = strpos($detail, 'authenticate') !== false ? 'authentication rejected (check Gmail App Password)'
            : (strpos($detail, 'connect') !== false ? 'connection failed (check outbound port 465 and TLS)' : 'delivery rejected');
        error_log('Instructor recovery Gmail SMTP: ' . $category);
        return false;
    } finally {
        $mail->smtpClose();
    }
}
