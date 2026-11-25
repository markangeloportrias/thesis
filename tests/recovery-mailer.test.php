<?php
declare(strict_types=1);
require __DIR__ . '/../api/recovery-mailer.php';
function expectMail(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
$settings=['smtp_username'=>'teacher@gmail.com','smtp_password'=>'abcd efgh ijkl mnop','from_email'=>'teacher@gmail.com'];
$mail=createRecoveryMailer($settings);
expectMail($mail->Mailer==='smtp' && $mail->SMTPAuth, 'Authenticated SMTP required');
expectMail($mail->Host==='smtp.gmail.com' && $mail->Port===465 && $mail->SMTPSecure==='ssl', 'Gmail implicit TLS settings');
expectMail($mail->Password==='abcdefghijklmnop', 'App password spaces normalized');
expectMail($mail->SMTPOptions['ssl']['verify_peer'] && $mail->SMTPOptions['ssl']['verify_peer_name'], 'TLS verification enabled');
expectMail($mail->SMTPDebug===0 && $mail->From==='teacher@gmail.com', 'Sender and debug configuration');
expectMail(createRecoveryMailer(array_diff_key($settings,['from_email'=>true]))->From==='teacher@gmail.com', 'Sender defaults to authenticated account');
foreach ([['smtp_password'=>''],['smtp_username'=>'invalid'],['from_email'=>'someone-else@gmail.com']] as $invalid) {
    try { recoverySmtpSettings(array_replace($settings,$invalid)); throw new LogicException('Invalid settings accepted'); }
    catch (RuntimeException $expected) { expectMail(!($expected instanceof LogicException),'Must reject invalid settings'); }
}
class PreviewRecoveryMail extends \PHPMailer\PHPMailer\PHPMailer {
    public function send() { return $this->preSend(); }
}
$preview=new PreviewRecoveryMail(true);
$preview->setFrom('teacher@gmail.com','MIDWIFE Clinical Portal');
$preview->isSMTP();
expectMail(sendRecoverySmtpMail($preview,'recipient@gmail.com','Recovery code','Your code: 12345678'), 'Build email');
$mime=$preview->getSentMIMEMessage();
expectMail(strpos($mime,'recipient@gmail.com')!==false && strpos($mime,'12345678')!==false,'Recipient and code included in message');
class RejectedRecoveryMail extends \PHPMailer\PHPMailer\PHPMailer {
    public function send() { $this->ErrorInfo='SMTP Error: Could not authenticate.'; throw new RuntimeException('Authentication failure'); }
}
expectMail(!sendRecoverySmtpMail(new RejectedRecoveryMail(true),'recipient@gmail.com','Recovery code','12345678'),'Failure must return false so token is rolled back');
echo "PASS: Gmail SMTP configuration, TLS, sender, App Password handling, MIME message and failure handling (no live emails sent).\n";
