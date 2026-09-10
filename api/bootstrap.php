<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';

// Bootstrap errors happen before the router's try/catch. Keep them JSON too.
set_exception_handler(static function (Throwable $error): void {
    error_log('Portal bootstrap error: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'Database initialization failed. Check the server PHP error log and database migration.']);
});

header('Content-Type: application/json; charset=utf-8');
// The portal is normally served from this same XAMPP origin. A separate
// frontend must be explicitly allow-listed through THESIS_ALLOWED_ORIGIN.
$requestOrigin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
$allowedOrigin = trim((string)($config['allowed_origin'] ?? ''));
if ($requestOrigin !== '' && $allowedOrigin !== '' && hash_equals($allowedOrigin, $requestOrigin)) {
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Permanent deletion is disabled. Use an archive endpoint.']);
    exit;
}

try {
    $db = $config['database'];
    $pdo = new PDO(
        "mysql:host={$db['host']};port={$db['port']};dbname={$db['name']};charset=utf8mb4",
        $db['user'],
        $db['password'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (Throwable $error) {
    error_log('Portal database connection error: ' . $error->getMessage());
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'Database connection failed.']);
    exit;
}

function ensureCaseCommentsTable(PDO $pdo): void
{
    if (portalTableExists($pdo, 'case_comments')) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS case_comments (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        case_id INT UNSIGNED NOT NULL,
        author_uid VARCHAR(80) NULL,
        author_name VARCHAR(255) NOT NULL,
        author_role ENUM('instructor','admin') NOT NULL DEFAULT 'instructor',
        comment_text TEXT NOT NULL,
        source_key VARCHAR(120) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        archived_at DATETIME NULL,
        archived_by VARCHAR(80) NULL,
        UNIQUE KEY uq_case_comments_source (source_key),
        INDEX idx_case_comments_case (case_id, archived_at, created_at),
        CONSTRAINT fk_case_comments_case FOREIGN KEY (case_id) REFERENCES case_records(id)
          ON UPDATE CASCADE ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

ensureCaseCommentsTable($pdo);

function ensureAuditTrailTable(PDO $pdo): void
{
    if (portalTableExists($pdo, 'audit_trail')) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS audit_trail (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        actor_role ENUM('admin', 'instructor', 'student', 'system') NOT NULL,
        actor_uid VARCHAR(80) NULL,
        action_name VARCHAR(80) NOT NULL,
        entity_type VARCHAR(80) NOT NULL,
        entity_uid VARCHAR(120) NULL,
        details JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_entity (entity_type, entity_uid),
        INDEX idx_audit_actor (actor_role, actor_uid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

ensureAuditTrailTable($pdo);

function portalTableExists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
    $stmt->execute([$table]);
    return (bool)$stmt->fetchColumn();
}

function columnExists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $stmt->execute([$table, $column]);
    return (bool)$stmt->fetchColumn();
}

function ensureSecurityTables(PDO $pdo): void
{
    // Bcrypt hashes are currently 60 characters long and may grow in a future
    // PHP release. Older portal installs used VARCHAR(50), which silently
    // truncates a hash and makes the administrator unable to sign in.
    $pinColumn = $pdo->query("SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admins' AND COLUMN_NAME='pin_number'")->fetchColumn();
    if ($pinColumn !== false && (int)$pinColumn < 255) {
        $pdo->exec('ALTER TABLE admins MODIFY COLUMN pin_number VARCHAR(255) NOT NULL');
    }

    if (!columnExists($pdo, 'admins', 'must_change_pin')) {
        $pdo->exec('ALTER TABLE admins ADD COLUMN must_change_pin TINYINT(1) NOT NULL DEFAULT 0 AFTER pin_number');
    }

    if (portalTableExists($pdo, 'auth_login_attempts')) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS auth_login_attempts (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        role_name VARCHAR(24) NOT NULL,
        identity_hash CHAR(64) NOT NULL,
        ip_hash CHAR(64) NOT NULL,
        failure_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        first_failed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_failed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_until DATETIME NULL,
        UNIQUE KEY uq_auth_attempt_identity (role_name, identity_hash, ip_hash),
        INDEX idx_auth_attempt_lock (locked_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function ensureStudentProfileFields(PDO $pdo): void
{
    if (!columnExists($pdo, 'students', 'parent_contact')) {
        $pdo->exec('ALTER TABLE students ADD COLUMN parent_contact VARCHAR(50) NULL AFTER contact_number');
    }
}

function indexExists(PDO $pdo, string $table, string $index): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?');
    $stmt->execute([$table, $index]);
    return (bool)$stmt->fetchColumn();
}

function ensureEnrollmentHistorySchema(PDO $pdo): void
{
    if (!columnExists($pdo, 'student_block_assignments', 'school_year_id')) {
        $pdo->exec('ALTER TABLE student_block_assignments ADD COLUMN school_year_id INT UNSIGNED NULL AFTER block_id');
    }
    $nullable = $pdo->query("SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_block_assignments' AND COLUMN_NAME='school_year_id'")->fetchColumn();
    if ($nullable === 'YES') {
        $pdo->exec('UPDATE student_block_assignments a JOIN student_blocks b ON b.id=a.block_id SET a.school_year_id=b.school_year_id WHERE a.school_year_id IS NULL');
        $missingSchoolYears = (int)$pdo->query('SELECT COUNT(*) FROM student_block_assignments WHERE school_year_id IS NULL')->fetchColumn();
        if ($missingSchoolYears === 0) {
            $pdo->exec('ALTER TABLE student_block_assignments MODIFY COLUMN school_year_id INT UNSIGNED NOT NULL');
        }
    }
    // The original unique student_id index also satisfies the student foreign
    // key on existing installs, so provide a normal replacement before it is
    // removed to permit multi-year enrollments.
    if (!indexExists($pdo, 'student_block_assignments', 'idx_assignment_student')) {
        $pdo->exec('ALTER TABLE student_block_assignments ADD INDEX idx_assignment_student (student_id)');
    }
    if (indexExists($pdo, 'student_block_assignments', 'uq_student_block')) {
        $pdo->exec('ALTER TABLE student_block_assignments DROP INDEX uq_student_block');
    }
    if (!indexExists($pdo, 'student_block_assignments', 'uq_student_school_year')) {
        $pdo->exec('ALTER TABLE student_block_assignments ADD UNIQUE KEY uq_student_school_year (student_id, school_year_id)');
    }
    if (!indexExists($pdo, 'student_block_assignments', 'idx_assignment_year')) {
        $pdo->exec('ALTER TABLE student_block_assignments ADD INDEX idx_assignment_year (school_year_id, archived_at)');
    }
}

function migrateLegacyCredentials(PDO $pdo): void
{
    $adminRows = $pdo->query('SELECT id, pin_number FROM admins')->fetchAll();
    $adminUpdate = $pdo->prepare('UPDATE admins SET pin_number=?, must_change_pin=1 WHERE id=? AND pin_number=?');
    foreach ($adminRows as $row) {
        $pin = (string)($row['pin_number'] ?? '');
        // Do not hash a previously truncated bcrypt value. It is not the
        // administrator's PIN and must be recovered with the explicit,
        // server-side recovery secret below.
        if (isTruncatedBcryptHash($pin)) {
            continue;
        }
        if ($pin !== '' && !isPasswordHash($pin)) {
            $adminUpdate->execute([password_hash($pin, PASSWORD_DEFAULT), $row['id'], $pin]);
        }
    }

    foreach ([
        ['students', 'student_id'],
        ['instructor_accounts', 'account_uid'],
    ] as [$table, $idColumn]) {
        $rows = $pdo->query("SELECT $idColumn AS record_id, password FROM $table")->fetchAll();
        $update = $pdo->prepare("UPDATE $table SET password=? WHERE $idColumn=? AND password=?");
        foreach ($rows as $row) {
            $password = (string)($row['password'] ?? '');
            if ($password !== '' && !isPasswordHash($password)) {
                $update->execute([password_hash($password, PASSWORD_DEFAULT), $row['record_id'], $password]);
            }
        }
    }
}

ensureSecurityTables($pdo);
ensureStudentProfileFields($pdo);
ensureEnrollmentHistorySchema($pdo);
function isTruncatedBcryptHash(string $value): bool
{
    return str_starts_with($value, '$2') && strlen($value) < 60;
}

function ensureInitialAdministrator(PDO $pdo, string $initialPin): void
{
    $count = (int)$pdo->query('SELECT COUNT(*) FROM admins WHERE archived_at IS NULL')->fetchColumn();
    if ($count > 0) return;
    if (!preg_match('/^\d{6,12}$/', $initialPin)) {
        return;
    }
    $stmt = $pdo->prepare('INSERT INTO admins (pin_number, must_change_pin) VALUES (?, 0)');
    $stmt->execute([password_hash($initialPin, PASSWORD_DEFAULT)]);
}

function recoverTruncatedAdministratorCredentials(PDO $pdo, string $recoveryPin): void
{
    if (!preg_match('/^\d{6,12}$/', $recoveryPin)) {
        return;
    }

    $rows = $pdo->query('SELECT id, pin_number FROM admins WHERE archived_at IS NULL')->fetchAll();
    $affectedIds = [];
    foreach ($rows as $row) {
        if (isTruncatedBcryptHash((string)($row['pin_number'] ?? ''))) {
            $affectedIds[] = (int)$row['id'];
        }
    }
    if ($affectedIds === []) {
        return;
    }

    $pdo->beginTransaction();
    try {
        $update = $pdo->prepare('UPDATE admins SET pin_number=?, must_change_pin=1 WHERE id=?');
        foreach ($affectedIds as $id) {
            $update->execute([password_hash($recoveryPin, PASSWORD_DEFAULT), $id]);
        }
        // Any session issued before recovery must not remain usable.
        $pdo->exec("DELETE FROM api_sessions WHERE role='admin'");
        $audit = $pdo->prepare("INSERT INTO audit_trail (actor_role, actor_uid, action_name, entity_type, entity_uid, details) VALUES ('system', NULL, 'recover_admin_pin', 'admin', ?, ?)");
        foreach ($affectedIds as $id) {
            $audit->execute([(string)$id, json_encode(['reason' => 'legacy_truncated_bcrypt'])]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

function retireLegacyCredentialProcedures(PDO $pdo): void
{
    // These legacy procedures compare or store credentials in plaintext. All
    // account creation and authentication must go through the API instead.
    $exists = $pdo->prepare("SELECT 1 FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME=? AND ROUTINE_TYPE='PROCEDURE'");
    foreach ([
        'sp_register_student',
        'sp_authenticate_student',
        'sp_authenticate_instructor',
        'sp_create_instructor_account',
    ] as $procedure) {
        $exists->execute([$procedure]);
        if (!$exists->fetchColumn()) continue;
        $pdo->exec("DROP PROCEDURE IF EXISTS `$procedure`");
    }
}

ensureInitialAdministrator($pdo, (string)($config['initial_admin_pin'] ?? ''));
recoverTruncatedAdministratorCredentials($pdo, (string)($config['admin_recovery_pin'] ?? ''));
migrateLegacyCredentials($pdo);
retireLegacyCredentialProcedures($pdo);

function ensureInvalidCaseRecordStatus(PDO $pdo): void
{
    $stmt = $pdo->query("SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='case_records' AND COLUMN_NAME='record_status'");
    $columnType = (string)$stmt->fetchColumn();
    if ($columnType === '' || stripos($columnType, "'invalid'") !== false) return;

    $pdo->exec("ALTER TABLE case_records MODIFY COLUMN record_status ENUM('submitted','reviewed','verified','needs_revision','invalid','archived') NOT NULL DEFAULT 'submitted'");
    $pdo->exec("UPDATE case_records c
        SET c.record_status='invalid'
        WHERE c.record_status='needs_revision'
          AND (
            SELECT JSON_UNQUOTE(JSON_EXTRACT(a.details, '$.status'))
            FROM audit_trail a
            WHERE a.entity_type='case'
              AND a.entity_uid=CAST(c.id AS CHAR)
              AND a.action_name='review'
            ORDER BY a.id DESC
            LIMIT 1
          )='Invalid'");
}

ensureInvalidCaseRecordStatus($pdo);

function input(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $_POST;
}

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function requireFields(array $data, array $fields): void
{
    foreach ($fields as $field) {
        if (!isset($data[$field]) || trim((string)$data[$field]) === '') {
            respond(['ok' => false, 'message' => "$field is required."], 422);
        }
    }
}

function passwordMatches(string $plain, string $stored): bool
{
    return $stored !== '' && isPasswordHash($stored) && password_verify($plain, $stored);
}

function isPasswordHash(string $value): bool
{
    $info = password_get_info($value);
    return ($info['algoName'] ?? 'unknown') !== 'unknown';
}

function credentialIsStrong(string $value, int $minimumLength = 8): bool
{
    return strlen($value) >= $minimumLength;
}

function authAttemptIdentity(string $role, string $identity): array
{
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    return [
        hash('sha256', strtolower(trim($identity))),
        hash('sha256', $ip),
    ];
}

function loginIsLocked(PDO $pdo, string $role, string $identity): bool
{
    [$identityHash, $ipHash] = authAttemptIdentity($role, $identity);
    $stmt = $pdo->prepare('SELECT locked_until > NOW() FROM auth_login_attempts WHERE role_name=? AND identity_hash=? AND ip_hash=?');
    $stmt->execute([$role, $identityHash, $ipHash]);
    return (bool)$stmt->fetchColumn();
}

function recordLoginFailure(PDO $pdo, string $role, string $identity): void
{
    [$identityHash, $ipHash] = authAttemptIdentity($role, $identity);
    // `failure_count` is assigned before `locked_until` in this upsert, so
    // checking the updated value locks on the fifth failed attempt (not the
    // fourth, which happened when the expression added one a second time).
    $stmt = $pdo->prepare("INSERT INTO auth_login_attempts (role_name, identity_hash, ip_hash, failure_count, first_failed_at, last_failed_at, locked_until)
        VALUES (?, ?, ?, 1, NOW(), NOW(), NULL)
        ON DUPLICATE KEY UPDATE
          failure_count = IF(last_failed_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE), 1, failure_count + 1),
          first_failed_at = IF(last_failed_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE), NOW(), first_failed_at),
          last_failed_at = NOW(),
          locked_until = IF(failure_count >= 5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), NULL)");
    $stmt->execute([$role, $identityHash, $ipHash]);
}

function clearLoginFailures(PDO $pdo, string $role, string $identity): void
{
    [$identityHash, $ipHash] = authAttemptIdentity($role, $identity);
    $stmt = $pdo->prepare('DELETE FROM auth_login_attempts WHERE role_name=? AND identity_hash=? AND ip_hash=?');
    $stmt->execute([$role, $identityHash, $ipHash]);
}

function bearerToken(): string
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $header = $value;
                break;
            }
        }
    }
    return preg_match('/^Bearer\s+(.+)$/i', $header, $match) ? trim($match[1]) : '';
}

function currentUser(PDO $pdo, array $roles = [], bool $allowPendingAdminPin = false): array
{
    $token = bearerToken();
    if ($token === '') respond(['ok' => false, 'message' => 'Authentication required.'], 401);
    $hash = hash('sha256', $token);
    $stmt = $pdo->prepare('SELECT role, user_uid, expires_at FROM api_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()');
    $stmt->execute([$hash]);
    $user = $stmt->fetch();
    if (!$user) respond(['ok' => false, 'message' => 'Session is invalid or expired.'], 401);
    if ($roles && !in_array($user['role'], $roles, true)) respond(['ok' => false, 'message' => 'Access denied.'], 403);
    if ($user['role'] === 'admin' && !$allowPendingAdminPin) {
        $admin = $pdo->prepare('SELECT must_change_pin FROM admins WHERE id=? AND archived_at IS NULL');
        $admin->execute([$user['user_uid']]);
        if ((bool)$admin->fetchColumn()) {
            respond(['ok' => false, 'message' => 'Your administrator PIN must be changed before continuing.'], 403);
        }
    }
    return $user;
}

function createSession(PDO $pdo, string $role, string $uid, int $hours): string
{
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare('INSERT INTO api_sessions (token_hash, role, user_uid, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))');
    $stmt->execute([hash('sha256', $token), $role, $uid, $hours]);
    return $token;
}

function audit(PDO $pdo, array $user, string $action, string $entity, string $entityId = '', array $details = []): void
{
    $stmt = $pdo->prepare('INSERT INTO audit_trail (actor_role, actor_uid, action_name, entity_type, entity_uid, details) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([$user['role'], $user['user_uid'], $action, $entity, $entityId, json_encode($details)]);
}

function pathParts(): array
{
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '';
    $marker = '/api/';
    $position = strpos($path, $marker);
    $path = $position === false ? trim($path, '/') : substr($path, $position + strlen($marker));
    return array_values(array_filter(explode('/', trim($path, '/')), 'strlen'));
}
