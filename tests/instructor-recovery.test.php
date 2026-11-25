<?php
declare(strict_types=1);
// Run with a disposable localhost MySQL database in PORTAL_RECOVERY_TEST_DSN.
require __DIR__ . '/../api/instructor-recovery.php';
$dsn = getenv('PORTAL_RECOVERY_TEST_DSN') ?: '';
if (!preg_match('/^mysql:host=127\.0\.0\.1;/', $dsn)) throw new RuntimeException('A disposable localhost test DSN is required.');
$pdo = new PDO($dsn, 'root', '', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES=>false]);
// Temporary fixtures cannot replace persistent portal tables.
$pdo->exec("CREATE TEMPORARY TABLE instructor_accounts (account_uid VARCHAR(80) PRIMARY KEY,email VARCHAR(254) UNIQUE,email_verified_at DATETIME NULL,password VARCHAR(255),status VARCHAR(20),archived_at DATETIME NULL) ENGINE=InnoDB");
$pdo->exec("CREATE TEMPORARY TABLE instructor_password_resets (id BIGINT AUTO_INCREMENT PRIMARY KEY,instructor_uid VARCHAR(80),token_hash CHAR(64) UNIQUE,expires_at DATETIME,used_at DATETIME NULL,created_at DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB");
$pdo->exec("CREATE TEMPORARY TABLE api_sessions (role VARCHAR(20),user_uid VARCHAR(80),revoked_at DATETIME NULL) ENGINE=InnoDB");
$pdo->exec("CREATE TEMPORARY TABLE auth_login_attempts (role_name VARCHAR(24),identity_hash CHAR(64),ip_hash CHAR(64),failure_count SMALLINT DEFAULT 0,first_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,last_failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,locked_until DATETIME NULL, UNIQUE(role_name,identity_hash,ip_hash)) ENGINE=InnoDB");
// Load the real throttling helpers without starting the application bootstrap.
$bootstrap = file_get_contents(__DIR__ . '/../api/bootstrap.php');
$start = strpos($bootstrap, 'function authAttemptIdentity(');
$end = strpos($bootstrap, 'function bearerToken(', $start);
eval(substr($bootstrap, $start, $end - $start));
function columnExists(PDO $pdo, string $table, string $column): bool { return true; }
function portalTableExists(PDO $pdo, string $table): bool { return true; }
class RecoveryResponse extends RuntimeException {
    public array $body;
    public function __construct(array $body, int $status) { parent::__construct('', $status); $this->body=$body; }
}
function respond(array $body, int $status=200): void { throw new RecoveryResponse($body, $status); }
function check(bool $condition, string $label): void { if (!$condition) throw new RuntimeException($label); }
$config=['instructor_recovery'=>['login_url'=>'https://portal.example/login','from_email'=>'sender@portal.example']];
$mail=[];
$sender=function ($to, $subject, $body, $headers) use (&$mail): bool { $mail[]=compact('to','body'); return true; };
function requestRecovery(string $action, array $data, int $expected=200, ?callable $transport=null): array {
    global $pdo,$config,$sender;
    try { handleInstructorRecovery($pdo,$config,$action,$data,$transport ?? $sender); }
    catch (RecoveryResponse $response) { check($response->getCode()===$expected, 'Unexpected response: '.json_encode($response->body)); return $response->body; }
    throw new RuntimeException('No response');
}
function clearLimits(): void { global $pdo; $pdo->exec('DELETE FROM auth_login_attempts'); }
function lastCode(): string { global $mail; preg_match('/recovery code is: ([0-9]{8})/', end($mail)['body'], $match); return $match[1]; }
function lastToken(): string { return requestRecovery('instructor-verify-code',['email'=>'teacher@example.com','code'=>lastCode()])['token']; }
$_SERVER['REMOTE_ADDR']='127.0.0.1';
$pdo->prepare("INSERT INTO instructor_accounts (account_uid,email,password,status) VALUES ('test','teacher@example.com',?,'active')")->execute([password_hash('Old-password-123',PASSWORD_DEFAULT)]);
$pdo->exec("INSERT INTO api_sessions VALUES ('instructor','test',NULL),('student','test',NULL)");
requestRecovery('instructor-forgot-password',['email'=>'bad'],422);
$unknown=requestRecovery('instructor-forgot-password',['email'=>'unknown@example.com'],422);
$known=requestRecovery('instructor-forgot-password',['email'=>' TEACHER@example.com ']);
check($known['ok'] && !$unknown['ok'],'Unregistered email rejected before code entry');
check(count($mail)===1,'Exactly one mail');
check($pdo->query('SELECT token_hash FROM instructor_password_resets')->fetchColumn()===instructorRecoveryCodeHash('test',lastCode()),'Only code hash stored');
$wrongCode=lastCode()==='00000000'?'11111111':'00000000';
requestRecovery('instructor-verify-code',['email'=>'teacher@example.com','code'=>$wrongCode],422);
$token=lastToken();
requestRecovery('instructor-verify-code',['email'=>'teacher@example.com','code'=>lastCode()],422);
check($pdo->query('SELECT token_hash FROM instructor_password_resets')->fetchColumn()===hash('sha256',$token),'Only hashed token stored');
requestRecovery('instructor-forgot-password',['email'=>'teacher@example.com']);
check(count($mail)===1,'Cooldown blocks repeat mail');
clearLimits();
requestRecovery('instructor-reset-password',['token'=>$token,'password'=>'short'],422);
requestRecovery('instructor-reset-password',['token'=>str_repeat('0',64),'password'=>'New-password-123'],422);
requestRecovery('instructor-reset-password',['token'=>$token,'password'=>'New-password-123']);
$account=$pdo->query('SELECT * FROM instructor_accounts')->fetch();
check(password_verify('New-password-123',$account['password']) && !password_verify('Old-password-123',$account['password']),'Password replaced');
check($account['email_verified_at']!==null,'Email possession verified');
check((int)$pdo->query("SELECT COUNT(*) FROM api_sessions WHERE role='instructor' AND revoked_at IS NULL")->fetchColumn()===0,'Instructor sessions revoked');
check((int)$pdo->query("SELECT COUNT(*) FROM api_sessions WHERE role='student' AND revoked_at IS NULL")->fetchColumn()===1,'Other roles unaffected');
requestRecovery('instructor-reset-password',['token'=>$token,'password'=>'Other-password-123'],422);
clearLimits();
$pdo->exec('UPDATE instructor_password_resets SET created_at=DATE_SUB(NOW(),INTERVAL 3 MINUTE)');
requestRecovery('instructor-forgot-password',['email'=>'teacher@example.com']);
$token=lastToken();
$pdo->exec('UPDATE instructor_password_resets SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE)');
requestRecovery('instructor-reset-password',['token'=>$token,'password'=>'Other-password-123'],422);
$pdo->exec("UPDATE instructor_accounts SET status='inactive'");
$count=count($mail);
requestRecovery('instructor-forgot-password',['email'=>'teacher@example.com'],422);
check(count($mail)===$count,'Inactive account not mailed');
$pdo->exec("UPDATE instructor_accounts SET status='active'");
$pdo->exec('UPDATE instructor_password_resets SET created_at=DATE_SUB(NOW(),INTERVAL 3 MINUTE)');
$before=(int)$pdo->query('SELECT COUNT(*) FROM instructor_password_resets')->fetchColumn();
requestRecovery('instructor-forgot-password',['email'=>'teacher@example.com'],200,static function (): bool {return false;});
check((int)$pdo->query('SELECT COUNT(*) FROM instructor_password_resets')->fetchColumn()===$before,'Mail failure rolls back token');
clearLimits();
for ($i=0;$i<5;$i++) requestRecovery('instructor-forgot-password',['email'=>'unknown@example.com'],422);
requestRecovery('instructor-forgot-password',['email'=>'different@example.com'],429);
clearLimits();
$pdo->exec('UPDATE instructor_password_resets SET created_at=DATE_SUB(NOW(),INTERVAL 3 MINUTE)');
requestRecovery('instructor-forgot-password',['email'=>'teacher@example.com']);
$code=lastCode();
$pdo->exec('UPDATE instructor_password_resets SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE)');
requestRecovery('instructor-verify-code',['email'=>'teacher@example.com','code'=>$code],422);
clearLimits();
$pdo->exec('UPDATE instructor_password_resets SET expires_at=DATE_ADD(NOW(),INTERVAL 10 MINUTE)');
$wrongCode=$code==='00000000'?'11111111':'00000000';
for ($i=0;$i<5;$i++) {
    $_SERVER['REMOTE_ADDR']='127.0.0.'.($i+2);
    requestRecovery('instructor-verify-code',['email'=>'teacher@example.com','code'=>$wrongCode],422);
}
$_SERVER['REMOTE_ADDR']='127.0.0.9';
requestRecovery('instructor-verify-code',['email'=>'teacher@example.com','code'=>$code],429);
check(instructorRecoveryPassword(str_repeat('a',72)) && !instructorRecoveryPassword(str_repeat('a',73)), 'Bcrypt length boundary');
echo "Instructor recovery tests passed: emailed codes, code verification, replay prevention, expiry, account-wide attempt limit, reset, sessions, privacy, cooldown and mail failure.\n";
