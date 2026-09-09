<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/record-validation.php';

function validateContactNumberInput($value, string $label = 'Contact number'): void
{
    $contactNumber = trim((string)($value ?? ''));
    if ($contactNumber !== '' && !preg_match('/^\d{11}$/', $contactNumber)) {
        respond(['ok' => false, 'message' => $label . ' must contain exactly 11 digits.'], 422);
    }
}

function messageContainsInappropriateLanguage(string $message): bool
{
    $normalized = strtolower(trim($message));
    $terms = [
        'asshole', 'bastard', 'bitch', 'bullshit', 'dick', 'fuck', 'fucking',
        'gago', 'gagi', 'gaga', 'pakyu', 'putangina', 'putang ina', 'puta',
        'shit', 'tanga', 'bobo', 'ulol',
    ];
    foreach ($terms as $term) {
        if (preg_match('/(?<![a-z])' . preg_quote($term, '/') . '(?![a-z])/i', $normalized)) return true;
    }
    return false;
}

function rejectInappropriateMessage(string $message): void
{
    if (messageContainsInappropriateLanguage($message)) {
        respond([
            'ok' => false,
            'code' => 'inappropriate_message',
            'message' => 'Please revise your message. Inappropriate language is not allowed.',
        ], 422);
    }
}

function normalizeCaseRoleValue(string $value): string
{
    $value = preg_replace('/\s+/', '', trim($value)) ?? '';
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function clinicalRoleForProcedure(string $procedure): ?string
{
    $normalized = strtolower(trim((string)(preg_replace('/[^a-z0-9]+/i', ' ', $procedure) ?? '')));
    if (in_array($normalized, ['delivery handled', 'iv insertion', 'internal exam', 'internal examination', 'ie', 'i e'], true)) return 'handle';
    if (in_array($normalized, ['delivery assisted', 'suturing', 'perineal suturing'], true)) return 'assist';
    return null;
}

function clinicalRoleLabel(string $role): string
{
    return $role === 'assist' ? 'Assist' : 'Handle';
}

function resolveCaseRoleGroup(PDO $pdo, string $studentId, string $academicYear): ?array
{
    $stmt = $pdo->prepare("SELECT a.block_id,b.label AS block_label,y.label AS academic_year
        FROM student_block_assignments a
        JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL
        JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL
        WHERE a.student_id=? AND a.archived_at IS NULL
        ORDER BY (y.label=?) DESC,(y.status='active') DESC,y.start_year DESC
        LIMIT 1");
    $stmt->execute([$studentId, $academicYear]);
    $group = $stmt->fetch();
    return $group ?: null;
}

function resolveCaseRoleContext(PDO $pdo, string $studentId, string $academicYear, string $caseNo, string $patientName, string $procedure): ?array
{
    $role = clinicalRoleForProcedure($procedure);
    $caseKey = normalizeCaseRoleValue($caseNo);
    $patientKey = normalizeCaseRoleValue($patientName);
    if ($role === null || ($caseKey === '' && $patientKey === '')) return null;

    $group = resolveCaseRoleGroup($pdo, $studentId, $academicYear);
    if (!$group) return null;

    return [
        'role' => $role,
        'case_key' => $caseKey,
        'case_no' => trim($caseNo),
        'patient_key' => $patientKey,
        'patient_name' => trim($patientName),
        'block_id' => (int)$group['block_id'],
        'block_label' => (string)$group['block_label'],
        'academic_year' => (string)$group['academic_year'],
    ];
}

function getActiveCaseRoleRecords(PDO $pdo, array $context): array
{
    $stmt = $pdo->prepare("SELECT c.id,c.student_id,c.student_name,c.procedure_key,c.procedure_name,c.case_no,c.patient_name
        FROM case_records c
        JOIN student_block_assignments a ON a.student_id=c.student_id AND a.archived_at IS NULL
        JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL
        WHERE a.block_id=? AND c.academic_year=? AND c.archived_at IS NULL
        ORDER BY c.created_at ASC,c.id ASC");
    $stmt->execute([$context['block_id'], $context['academic_year']]);

    $records = [];
    foreach ($stmt->fetchAll() as $record) {
        $matchesCaseNo = $context['case_key'] !== ''
            && normalizeCaseRoleValue((string)($record['case_no'] ?? '')) === $context['case_key'];
        $matchesPatientName = $context['patient_key'] !== ''
            && normalizeCaseRoleValue((string)($record['patient_name'] ?? '')) === $context['patient_key'];
        if (!$matchesCaseNo && !$matchesPatientName) continue;
        $role = clinicalRoleForProcedure((string)($record['procedure_key'] ?? ''))
            ?? clinicalRoleForProcedure((string)($record['procedure_name'] ?? ''));
        if ($role === null) continue;
        $record['clinical_role'] = $role;
        $record['case_role_match'] = $matchesCaseNo && $matchesPatientName
            ? 'case_no_and_patient_name'
            : ($matchesCaseNo ? 'case_no' : 'patient_name');
        $records[] = $record;
    }
    return $records;
}

function findCaseRoleConflict(array $records, string $role, string $studentId): ?array
{
    foreach ($records as $record) {
        if (($record['clinical_role'] ?? '') === $role && (string)$record['student_id'] !== $studentId) return $record;
    }
    return null;
}

function caseRoleLockNames(array $context): array
{
    $identities = [];
    if ($context['case_key'] !== '') $identities[] = 'case_no:' . $context['case_key'];
    if ($context['patient_key'] !== '') $identities[] = 'patient_name:' . $context['patient_key'];
    $lockNames = array_map(static function (string $identity) use ($context): string {
        return 'midwife-case-role-' . substr(hash('sha256', implode('|', [
            $context['block_id'],
            $context['academic_year'],
            $context['role'],
            $identity,
        ])), 0, 40);
    }, $identities);
    sort($lockNames, SORT_STRING);
    return array_values(array_unique($lockNames));
}

function acquireCaseRoleLocks(PDO $pdo, array $lockNames): bool
{
    $acquired = [];
    foreach ($lockNames as $lockName) {
        $stmt = $pdo->prepare('SELECT GET_LOCK(?, 5)');
        $stmt->execute([$lockName]);
        if ((int)$stmt->fetchColumn() !== 1) {
            releaseCaseRoleLocks($pdo, array_reverse($acquired));
            return false;
        }
        $acquired[] = $lockName;
    }
    return true;
}

function releaseCaseRoleLocks(PDO $pdo, array $lockNames): void
{
    foreach ($lockNames as $lockName) {
        $stmt = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $stmt->execute([$lockName]);
    }
}

function caseRoleConflictPayload(array $context): array
{
    $roleLabel = clinicalRoleLabel((string)$context['role']);
    return [
        'ok' => false,
        'code' => 'case_role_unavailable',
        'role' => $context['role'],
        'role_label' => $roleLabel,
        'case_no' => $context['case_no'],
        'message' => "The {$roleLabel} role is already assigned to another groupmate for this patient.",
    ];
}

const PORTAL_BACKUP_TABLES = [
    'procedures',
    'students',
    'instructor_accounts',
    'school_years',
    'student_blocks',
    'student_block_assignments',
    'case_records',
    'case_comments',
    'edit_requests',
    'edit_permissions',
    'notification_history',
    'chat_messages',
    'school_year_archives',
    'school_year_archive_procedures',
    'school_year_archive_records',
    'system_meta',
    'audit_trail',
];

function databaseTableExists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?');
    $stmt->execute([$table]);
    return (bool)$stmt->fetchColumn();
}

function databaseTableColumns(PDO $pdo, string $table): array
{
    $rows = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll();
    return array_map(static fn(array $row): string => (string)$row['Field'], $rows);
}

function schoolYearsWithBlocks(PDO $pdo): array
{
    $years = $pdo->query("SELECT y.id,y.label,y.status,y.created_at,COUNT(DISTINCT b.id) AS block_count,COUNT(DISTINCT s.student_id) AS student_count FROM school_years y LEFT JOIN student_blocks b ON b.school_year_id=y.id AND b.archived_at IS NULL LEFT JOIN student_block_assignments a ON a.block_id=b.id AND a.archived_at IS NULL LEFT JOIN students s ON s.student_id=a.student_id AND s.archived_at IS NULL WHERE y.archived_at IS NULL GROUP BY y.id,y.label,y.status,y.created_at,y.start_year ORDER BY y.start_year DESC")->fetchAll();
    $blocks = $pdo->prepare("SELECT b.id,b.label,y.label AS school_year,b.status,b.created_at,COUNT(DISTINCT s.student_id) AS student_count FROM student_blocks b JOIN school_years y ON y.id=b.school_year_id LEFT JOIN student_block_assignments a ON a.block_id=b.id AND a.archived_at IS NULL LEFT JOIN students s ON s.student_id=a.student_id AND s.archived_at IS NULL WHERE b.school_year_id=? AND b.archived_at IS NULL GROUP BY b.id,b.label,y.label,b.status,b.created_at ORDER BY b.label");
    foreach ($years as &$year) {
        $blocks->execute([$year['id']]);
        $year['blocks'] = $blocks->fetchAll();
    }
    unset($year);
    return $years;
}

function createPortalBackup(PDO $pdo, array $user): array
{
    $tables = [];
    foreach (PORTAL_BACKUP_TABLES as $table) {
        if (!databaseTableExists($pdo, $table)) continue;
        $tables[$table] = $pdo->query("SELECT * FROM `$table`")->fetchAll();
    }
    audit($pdo, $user, 'export_backup', 'system');
    return [
        'app' => 'midwife-clinical-portal',
        'format_version' => 2,
        'exported_at' => gmdate('c'),
        'tables' => $tables,
    ];
}

function restorePortalBackup(PDO $pdo, array $snapshot, array $user): void
{
    if (($snapshot['app'] ?? '') !== 'midwife-clinical-portal' || !is_array($snapshot['tables'] ?? null)) {
        respond(['ok' => false, 'message' => 'The selected file is not a valid MIDWIFE database backup.'], 422);
    }
    $backupTables = $snapshot['tables'];
    $restoreTables = array_values(array_filter(PORTAL_BACKUP_TABLES, static fn(string $table): bool => array_key_exists($table, $backupTables)));
    if (!$restoreTables) respond(['ok' => false, 'message' => 'The backup does not contain portal records.'], 422);

    $pdo->beginTransaction();
    try {
        foreach (PORTAL_BACKUP_TABLES as $table) {
            if (!in_array($table, $restoreTables, true) || !databaseTableExists($pdo, $table)) continue;
            $allowedColumns = array_flip(databaseTableColumns($pdo, $table));
            foreach ((array)$backupTables[$table] as $row) {
                if (!is_array($row)) continue;
                $row = array_intersect_key($row, $allowedColumns);
                if (!$row) continue;
                $columns = array_keys($row);
                $quotedColumns = implode(',', array_map(static fn(string $column): string => "`$column`", $columns));
                $placeholders = implode(',', array_fill(0, count($columns), '?'));
                // Merge backups safely: existing primary/unique-key rows remain
                // untouched, while rows not present locally are restored.
                $stmt = $pdo->prepare("INSERT IGNORE INTO `$table` ($quotedColumns) VALUES ($placeholders)");
                $stmt->execute(array_values($row));
            }
        }
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    audit($pdo, $user, 'restore_backup', 'system', '', ['exported_at' => (string)($snapshot['exported_at'] ?? '')]);
}

$parts = pathParts();
$resource = $parts[0] ?? 'health';
$id = $parts[1] ?? '';
$action = $parts[2] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$data = input();

try {
    if ($resource === 'health') respond(['ok' => true, 'service' => 'MIDWIFE Clinical Portal API']);

    if ($resource === 'backup') {
        $user = currentUser($pdo, ['admin']);
        if ($method === 'GET') respond(['ok' => true, 'backup' => createPortalBackup($pdo, $user)]);
        if ($method === 'POST' && $id === 'restore') {
            if (($data['confirmation'] ?? '') !== 'RESTORE') {
                respond(['ok' => false, 'message' => 'Type RESTORE to confirm merging this database backup.'], 422);
            }
            restorePortalBackup($pdo, (array)($data['backup'] ?? []), $user);
            respond(['ok' => true]);
        }
        respond(['ok' => false, 'message' => 'Backup endpoint not found.'], 404);
    }

    if ($resource === 'sync-state' && $method === 'GET') {
        currentUser($pdo, ['admin', 'instructor', 'student']);
        $parts = [];
        foreach ([
            ['students', 'updated_at'],
            ['instructor_accounts', 'updated_at'],
            ['school_years', 'updated_at'],
            ['student_blocks', 'updated_at'],
            ['student_block_assignments', 'updated_at'],
            ['case_records', 'updated_at'],
            ['case_comments', 'COALESCE(archived_at,created_at)'],
            ['edit_requests', 'updated_at'],
            ['edit_permissions', 'updated_at'],
            ['notification_history', 'created_at'],
            ['chat_messages', 'created_at'],
            ['audit_trail', 'created_at'],
        ] as [$table, $timestampColumn]) {
            $row = $pdo->query("SELECT COUNT(*) AS row_count, COALESCE(MAX($timestampColumn), '') AS latest FROM $table")->fetch();
            $parts[] = $table . ':' . ($row['row_count'] ?? 0) . ':' . ($row['latest'] ?? '');
        }
        respond(['ok' => true, 'version' => hash('sha256', implode('|', $parts))]);
    }

    if ($resource === 'dashboard-stats' && $method === 'GET') {
        currentUser($pdo, ['admin', 'instructor']);
        $counts = [];
        $queries = [
            'students' => 'SELECT COUNT(*) FROM students WHERE archived_at IS NULL',
            'instructors' => 'SELECT COUNT(*) FROM instructor_accounts WHERE archived_at IS NULL AND status = \'active\'',
            'records' => 'SELECT COUNT(*) FROM case_records WHERE archived_at IS NULL',
            'school_years' => 'SELECT COUNT(*) FROM school_years WHERE archived_at IS NULL',
            'pending_requests' => 'SELECT COUNT(*) FROM edit_requests WHERE archived_at IS NULL AND status = \'pending\'',
        ];
        foreach ($queries as $key => $sql) $counts[$key] = (int)$pdo->query($sql)->fetchColumn();
        respond(['ok' => true, 'counts' => $counts]);
    }

    if ($resource === 'instructor-directory' && $method === 'GET') {
        currentUser($pdo, ['admin', 'instructor', 'student']);
        $rows=$pdo->query("SELECT account_uid AS id,username,display_name,role_title,status FROM instructor_accounts WHERE archived_at IS NULL AND status='active' ORDER BY display_name")->fetchAll();
        respond(['ok'=>true,'accounts'=>$rows]);
    }

    if ($resource === 'school-year-directory' && $method === 'GET') {
        currentUser($pdo, ['admin', 'instructor']);
        $rows = schoolYearsWithBlocks($pdo);
        respond(['ok'=>true,'years'=>$rows]);
    }

    if ($resource === 'block-directory' && $method === 'GET') {
        currentUser($pdo, ['admin', 'instructor']);
        $year=trim((string)($_GET['school_year']??''));
        $stmt=$pdo->prepare("SELECT b.id,b.label,y.label AS school_year,b.status,b.created_at,COUNT(DISTINCT s.student_id) AS student_count FROM student_blocks b JOIN school_years y ON y.id=b.school_year_id LEFT JOIN student_block_assignments a ON a.block_id=b.id AND a.archived_at IS NULL LEFT JOIN students s ON s.student_id=a.student_id AND s.archived_at IS NULL WHERE b.archived_at IS NULL ".($year !== '' ? 'AND y.label=?' : '')." GROUP BY b.id,b.label,y.label,b.status,b.created_at,y.start_year ORDER BY y.start_year DESC,b.label");
        $stmt->execute($year !== '' ? [$year] : []);
        respond(['ok'=>true,'blocks'=>$stmt->fetchAll()]);
    }

    if ($resource === 'assignment-directory' && $method === 'GET') {
        currentUser($pdo, ['admin', 'instructor']);
        $year=trim((string)($_GET['school_year']??''));
        $blockId=trim((string)($_GET['block_id']??''));
        $stmt=$pdo->prepare("SELECT s.student_id,s.student_name,s.parent_name,s.contact_number,s.parent_contact,y.label AS registered_school_year,b.id AS block_id,b.label AS block_label FROM student_block_assignments a JOIN students s ON s.student_id=a.student_id JOIN student_blocks b ON b.id=a.block_id JOIN school_years y ON y.id=b.school_year_id WHERE a.archived_at IS NULL AND s.archived_at IS NULL ".($blockId !== '' ? 'AND b.id=?' : ($year !== '' ? 'AND y.label=?' : ''))." ORDER BY s.student_name");
        $stmt->execute($blockId !== '' ? [$blockId] : ($year !== '' ? [$year] : []));
        respond(['ok'=>true,'students'=>$stmt->fetchAll()]);
    }

    if ($resource === 'auth' && $id === 'session' && $method === 'GET') {
        $user = currentUser($pdo, ['admin', 'instructor', 'student'], true);
        $payload = ['ok' => true, 'role' => $user['role'], 'user_uid' => $user['user_uid'], 'expires_at' => $user['expires_at']];
        if ($user['role'] === 'admin') {
            $admin = $pdo->prepare('SELECT must_change_pin FROM admins WHERE id=? AND archived_at IS NULL');
            $admin->execute([$user['user_uid']]);
            $payload['must_change_pin'] = (bool)$admin->fetchColumn();
        }
        respond($payload);
    }

    if ($resource === 'auth' && $id === 'admin-pin' && $method === 'PATCH') {
        $user = currentUser($pdo, ['admin'], true);
        requireFields($data, ['current_pin', 'new_pin']);
        $currentPin = (string)$data['current_pin'];
        $newPin = (string)$data['new_pin'];
        if (!preg_match('/^\d{6,12}$/', $newPin)) {
            respond(['ok' => false, 'message' => 'New PIN must contain 6 to 12 digits.'], 422);
        }
        $admin = $pdo->prepare('SELECT pin_number FROM admins WHERE id=? AND archived_at IS NULL');
        $admin->execute([$user['user_uid']]);
        $storedPin = (string)$admin->fetchColumn();
        if (!passwordMatches($currentPin, $storedPin)) {
            respond(['ok' => false, 'message' => 'Current PIN is incorrect.'], 403);
        }
        $update = $pdo->prepare('UPDATE admins SET pin_number=?, must_change_pin=0 WHERE id=? AND archived_at IS NULL');
        $update->execute([password_hash($newPin, PASSWORD_DEFAULT), $user['user_uid']]);
        $sessions = $pdo->prepare('UPDATE api_sessions SET revoked_at=NOW() WHERE role=\'admin\' AND user_uid=? AND token_hash<>? AND revoked_at IS NULL');
        $sessions->execute([$user['user_uid'], hash('sha256', bearerToken())]);
        audit($pdo, $user, 'change_pin', 'admin', (string)$user['user_uid']);
        respond(['ok' => true]);
    }

    if ($resource === 'auth' && $method === 'POST' && $id !== 'logout') {
        $role = $id;
        $identity = '';
        if ($role === 'student') {
            requireFields($data, ['student_id', 'password']);
            $identity = (string)$data['student_id'];
            $stmt = $pdo->prepare('SELECT student_id AS uid, student_id, student_name, parent_name, contact_number, parent_contact, profile_photo, password FROM students WHERE student_id = ? AND archived_at IS NULL');
            $stmt->execute([$data['student_id']]);
        } elseif ($role === 'instructor') {
            requireFields($data, ['username', 'password']);
            $identity = (string)$data['username'];
            $stmt = $pdo->prepare('SELECT account_uid AS uid, account_uid AS id, username, display_name, contact_number, profile_photo, role_title AS role, password FROM instructor_accounts WHERE username = ? AND archived_at IS NULL AND status = \'active\'');
            $stmt->execute([$data['username']]);
        } elseif ($role === 'admin') {
            requireFields($data, ['pin_number']);
            $identity = 'administrator';
            $stmt = $pdo->query('SELECT CAST(id AS CHAR) AS uid, pin_number, must_change_pin FROM admins WHERE archived_at IS NULL ORDER BY id LIMIT 1');
        } else respond(['ok' => false, 'message' => 'Unknown authentication role.'], 404);
        if (loginIsLocked($pdo, $role, $identity)) {
            respond(['ok' => false, 'message' => 'Too many failed attempts. Please try again in 15 minutes.'], 429);
        }
        $row = $stmt->fetch();
        $credential = $role === 'admin' ? (string)$data['pin_number'] : (string)$data['password'];
        $stored = $role === 'admin' ? ($row['pin_number'] ?? '') : ($row['password'] ?? '');
        if (!$row || !passwordMatches($credential, $stored)) {
            recordLoginFailure($pdo, $role, $identity);
            respond(['ok' => false, 'message' => 'Invalid credentials.'], 401);
        }
        clearLoginFailures($pdo, $role, $identity);
        unset($row['password'], $row['pin_number']);
        $token = createSession($pdo, $role, (string)$row['uid'], (int)$config['session_hours']);
        respond(['ok' => true, 'token' => $token, 'role' => $role, 'user' => $row]);
    }

    if ($resource === 'auth' && $id === 'logout' && $method === 'POST') {
        $token = bearerToken();
        if ($token !== '') {
            $stmt = $pdo->prepare('UPDATE api_sessions SET revoked_at = NOW() WHERE token_hash = ?');
            $stmt->execute([hash('sha256', $token)]);
        }
        respond(['ok' => true]);
    }

    if ($resource === 'students') {
        $user = currentUser($pdo, ['admin', 'instructor', 'student']);
        if ($method === 'GET') {
            if ($id !== '') {
                if ($user['role']==='student' && $user['user_uid']!==$id) respond(['ok'=>false,'message'=>'Access denied.'],403);
                // Include the current assignment so profile screens can render the
                // academic year and block even when opened outside the roster flow.
                $stmt=$pdo->prepare("SELECT s.student_id,s.student_name,s.parent_name,s.contact_number,s.parent_contact,s.profile_photo,s.status,s.archived_at,s.created_at,
                    (SELECT y.label FROM student_block_assignments a JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL WHERE a.student_id=s.student_id AND a.archived_at IS NULL ORDER BY (y.status='active') DESC,y.start_year DESC LIMIT 1) AS registered_school_year,
                    (SELECT b.label FROM student_block_assignments a JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL WHERE a.student_id=s.student_id AND a.archived_at IS NULL ORDER BY (y.status='active') DESC,y.start_year DESC LIMIT 1) AS block_label
                    FROM students s WHERE s.student_id=?");$stmt->execute([$id]);
                respond(['ok'=>true,'student'=>$stmt->fetch()?:null]);
            }
            if ($user['role']==='student') respond(['ok'=>false,'message'=>'Access denied.'],403);
            $archived = ($_GET['archived'] ?? '0') === '1';
            $stmt = $pdo->prepare("SELECT s.student_id,s.student_name,s.parent_name,s.contact_number,s.parent_contact,s.profile_photo,s.status,s.archived_at,s.created_at,
                (SELECT y.label FROM student_block_assignments a JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL WHERE a.student_id=s.student_id AND a.archived_at IS NULL ORDER BY (y.status='active') DESC,y.start_year DESC LIMIT 1) AS registered_school_year,
                (SELECT b.label FROM student_block_assignments a JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL WHERE a.student_id=s.student_id AND a.archived_at IS NULL ORDER BY (y.status='active') DESC,y.start_year DESC LIMIT 1) AS block_label
                FROM students s WHERE ".($archived ? 's.archived_at IS NOT NULL' : 's.archived_at IS NULL')." ORDER BY s.student_name");
            $stmt->execute();
            respond(['ok' => true, 'students' => $stmt->fetchAll()]);
        }
        if ($method === 'POST' && $id === '') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            requireFields($data, ['student_id', 'student_name', 'password', 'parent_name', 'contact_number']); // Password is the student's initial login credential.
            if (!credentialIsStrong((string)$data['password'], 6)) respond(['ok'=>false,'message'=>'Initial password must contain at least 6 characters.'],422);
            validateContactNumberInput($data['contact_number'] ?? null);
            validateContactNumberInput($data['parent_contact'] ?? null, 'Parent/Guardian contact');
            $stmt = $pdo->prepare('INSERT INTO students (student_id, student_name, password, parent_name, contact_number, parent_contact) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$data['student_id'], $data['student_name'], password_hash((string)$data['password'], PASSWORD_DEFAULT), $data['parent_name'] ?? null, $data['contact_number'] ?? null, $data['parent_contact'] ?? null]);
            audit($pdo, $user, 'create', 'student', (string)$data['student_id']);
            respond(['ok' => true, 'student_id' => $data['student_id']], 201);
        }
        if ($method === 'PATCH' && $id !== '' && in_array($action, ['archive', 'restore'], true)) {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $pdo->beginTransaction();
            try {
                $sql = $action === 'archive'
                    ? 'UPDATE students SET archived_at = NOW(), status = \'archived\' WHERE student_id = ? AND archived_at IS NULL'
                    : 'UPDATE students SET archived_at = NULL, status = \'active\' WHERE student_id = ? AND archived_at IS NOT NULL';
                $stmt = $pdo->prepare($sql);
                $stmt->execute([$id]);
                $accountChanged = $stmt->rowCount() > 0;
                $assignmentChanged = 0;
                if ($accountChanged && $action === 'archive') {
                    $sessions = $pdo->prepare("UPDATE api_sessions SET revoked_at = NOW() WHERE role = 'student' AND user_uid = ? AND revoked_at IS NULL");
                    $sessions->execute([$id]);
                }
                if ($action === 'restore') {
                    // Restore the student's previous active-school-year placement as
                    // part of the same operation. This also repairs legacy removals
                    // where only the assignment was archived.
                    $assignments = $pdo->prepare(
                        "UPDATE student_block_assignments a
                         JOIN student_blocks b ON b.id = a.block_id AND b.archived_at IS NULL
                         JOIN school_years y ON y.id = b.school_year_id AND y.archived_at IS NULL
                         SET a.archived_at = NULL
                         WHERE a.student_id = ? AND a.archived_at IS NOT NULL"
                    );
                    $assignments->execute([$id]);
                    $assignmentChanged = $assignments->rowCount();
                }
                $changed = $accountChanged || $assignmentChanged > 0;
                if ($changed) {
                    audit($pdo, $user, $action, 'student', $id, [
                        'account_status' => $action === 'archive' ? 'paused' : 'active',
                        'assignments_restored' => $assignmentChanged,
                    ]);
                }
                $pdo->commit();
                respond([
                    'ok' => $changed,
                    'account_status' => $action === 'archive' ? 'paused' : 'active',
                    'assignments_restored' => $assignmentChanged,
                ]);
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'delete') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $activeCaseStmt = $pdo->prepare('SELECT COUNT(*) FROM case_records WHERE student_id=? AND archived_at IS NULL');
            $activeCaseStmt->execute([$id]);
            if ((int)$activeCaseStmt->fetchColumn() > 0) {
                respond(['ok'=>false,'message'=>'Archive all active clinical records for this student before permanently deleting the account.'],409);
            }
            $studentStmt = $pdo->prepare('SELECT student_id FROM students WHERE student_id=? AND archived_at IS NOT NULL');
            $studentStmt->execute([$id]);
            if (!$studentStmt->fetchColumn()) respond(['ok'=>false,'message'=>'Archived student not found.'],404);
            $pdo->beginTransaction();
            try {
                $pdo->prepare('DELETE FROM notification_history WHERE student_id=? OR request_id IN (SELECT id FROM edit_requests WHERE student_id=?)')->execute([$id, $id]);
                $pdo->prepare('DELETE FROM case_comments WHERE case_id IN (SELECT id FROM case_records WHERE student_id=?)')->execute([$id]);
                $pdo->prepare('DELETE FROM case_records WHERE student_id=? AND archived_at IS NOT NULL')->execute([$id]);
                $pdo->prepare('DELETE FROM edit_permissions WHERE student_id=?')->execute([$id]);
                $pdo->prepare('DELETE FROM edit_requests WHERE student_id=?')->execute([$id]);
                $pdo->prepare('DELETE FROM chat_messages WHERE student_id=?')->execute([$id]);
                $pdo->prepare('DELETE FROM student_block_assignments WHERE student_id=?')->execute([$id]);
                $pdo->prepare("DELETE FROM api_sessions WHERE role='student' AND user_uid=?")->execute([$id]);
                $stmt = $pdo->prepare('DELETE FROM students WHERE student_id=? AND archived_at IS NOT NULL');
                $stmt->execute([$id]);
                $deleted = $stmt->rowCount() > 0;
                if ($deleted) audit($pdo, $user, 'delete_permanently', 'student', $id);
                $pdo->commit();
                respond(['ok'=>$deleted]);
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
        }
        if ($method === 'PATCH' && $id !== '' && $action === '') {
            if (!in_array($user['role'], ['admin', 'instructor'], true) && !($user['role'] === 'student' && $user['user_uid'] === $id)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            if (array_key_exists('contact_number', $data)) validateContactNumberInput($data['contact_number']);
            if (array_key_exists('parent_contact', $data)) validateContactNumberInput($data['parent_contact'], 'Parent/Guardian contact');
            $fields=[];$params=[];foreach(['student_name','parent_name','contact_number','parent_contact','profile_photo'] as $field){if(array_key_exists($field,$data)){$fields[]="$field=?";$params[]=$data[$field];}}
            $passwordChanged = false;
            if(!empty($data['password'])){
                $newPassword = (string)$data['password'];
                if (!credentialIsStrong($newPassword, 6)) respond(['ok'=>false,'message'=>'New password must contain at least 6 characters.'],422);
                if ($user['role'] === 'student') {
                    requireFields($data, ['current_password']);
                    $credentialStmt = $pdo->prepare('SELECT password FROM students WHERE student_id=? AND archived_at IS NULL');
                    $credentialStmt->execute([$id]);
                    if (!passwordMatches((string)$data['current_password'], (string)$credentialStmt->fetchColumn())) {
                        respond(['ok'=>false,'message'=>'Current password is incorrect.'],403);
                    }
                }
                $fields[]='password=?';$params[]=password_hash($newPassword,PASSWORD_DEFAULT);$passwordChanged = true;
            }
            if(!$fields)respond(['ok'=>false,'message'=>'No student changes supplied.'],422);$params[]=$id;$stmt=$pdo->prepare('UPDATE students SET '.implode(',',$fields).' WHERE student_id=? AND archived_at IS NULL');$stmt->execute($params);
            if ($passwordChanged) {
                $sessions = $pdo->prepare('UPDATE api_sessions SET revoked_at=NOW() WHERE role=\'student\' AND user_uid=? AND token_hash<>? AND revoked_at IS NULL');
                $sessions->execute([$id, hash('sha256', bearerToken())]);
            }
            audit($pdo,$user,$passwordChanged ? 'change_password' : 'update','student',$id);respond(['ok'=>true,'password_changed'=>$passwordChanged]);
        }
    }

    if ($resource === 'instructors') {
        $user = currentUser($pdo, ['admin', 'student', 'instructor']);
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT account_uid AS id, username, display_name, contact_number, profile_photo, role_title AS role, status, archived_at, created_at FROM instructor_accounts WHERE archived_at IS NULL ORDER BY display_name')->fetchAll();
            respond(['ok' => true, 'accounts' => $rows]);
        }
        if ($method === 'POST' && $id === '') {
            if ($user['role'] !== 'admin') respond(['ok'=>false,'message'=>'Access denied.'],403);
            requireFields($data, ['username', 'password', 'display_name']);
            validateContactNumberInput($data['contact_number'] ?? null);
            $uid = 'ins_' . bin2hex(random_bytes(8));
            $stmt = $pdo->prepare('INSERT INTO instructor_accounts (account_uid, username, password, display_name, contact_number, role_title) VALUES (?, ?, ?, ?, ?, ?)');
            $stmt->execute([$uid, $data['username'], password_hash((string)$data['password'], PASSWORD_DEFAULT), $data['display_name'], $data['contact_number'] ?? null, $data['role'] ?? 'Clinical Instructor']);
            audit($pdo, $user, 'create', 'instructor', $uid);
            respond(['ok' => true, 'id' => $uid], 201);
        }
        if ($method === 'PATCH' && $id !== '' && $action === '') {
            $fields=[];$params=[];
            if ($user['role'] === 'instructor' && $user['user_uid'] !== $id) respond(['ok'=>false,'message'=>'Access denied.'],403);
            if ($user['role'] === 'student') respond(['ok'=>false,'message'=>'Access denied.'],403);
            $allowedFields = $user['role'] === 'admin'
                ? ['username'=>'username','display_name'=>'display_name','contact_number'=>'contact_number','profile_photo'=>'profile_photo','role'=>'role_title','status'=>'status']
                : ['contact_number'=>'contact_number','profile_photo'=>'profile_photo'];
            foreach ($allowedFields as $inputKey=>$column) {
                if ($inputKey === 'contact_number' && array_key_exists($inputKey, $data)) validateContactNumberInput($data[$inputKey]);
                if (array_key_exists($inputKey,$data)) {$fields[]="$column=?";$params[]=$data[$inputKey];}
            }
            if ($user['role'] === 'admin' && !empty($data['password'])) {$fields[]='password=?';$params[]=password_hash((string)$data['password'],PASSWORD_DEFAULT);}
            if (!$fields) respond(['ok'=>false,'message'=>'No instructor changes supplied.'],422);
            $params[]=$id;$stmt=$pdo->prepare('UPDATE instructor_accounts SET '.implode(',',$fields).' WHERE account_uid=? AND archived_at IS NULL');$stmt->execute($params);
            audit($pdo,$user,'update','instructor',$id);respond(['ok'=>$stmt->rowCount()>=0]);
        }
    }

    if ($resource === 'school-years') {
        $user = currentUser($pdo, ['admin', 'instructor']);
        if ($method === 'GET') {
            $rows = schoolYearsWithBlocks($pdo);
            respond(['ok' => true, 'years' => $rows]);
        }
        if ($method === 'POST') {
            if ($user['role'] !== 'admin') respond(['ok'=>false,'message'=>'Access denied.'],403);
            requireFields($data, ['label']);
            if (!preg_match('/^(\d{4})-(\d{4})$/', (string)$data['label'], $m) || (int)$m[2] !== (int)$m[1] + 1) respond(['ok' => false, 'message' => 'Use a consecutive YYYY-YYYY school year.'], 422);
            $pdo->beginTransaction();
            $pdo->prepare("UPDATE school_years SET status='inactive' WHERE archived_at IS NULL AND status='active'")->execute();
            $stmt = $pdo->prepare('INSERT INTO school_years (label, start_year, end_year, status, created_by) VALUES (?, ?, ?, \'active\', ?)');
            $stmt->execute([$data['label'], $m[1], $m[2], $user['user_uid']]);
            $schoolYearId = (string)$pdo->lastInsertId();
            $pdo->commit();
            audit($pdo, $user, 'create', 'school_year', $schoolYearId, ['label' => $data['label']]);
            respond(['ok' => true, 'id' => $schoolYearId], 201);
        }
        if ($method === 'PATCH' && $id !== '') {
            if ($user['role'] !== 'admin') respond(['ok'=>false,'message'=>'Access denied.'],403);
            $nextStatus = strtolower(trim((string)($data['status'] ?? '')));
            if (!in_array($nextStatus, ['active', 'inactive'], true)) respond(['ok' => false, 'message' => 'Invalid academic year status.'], 422);
            if ($nextStatus === 'inactive') {
                $activeCount = (int)$pdo->query("SELECT COUNT(*) FROM school_years WHERE archived_at IS NULL AND status='active'")->fetchColumn();
                $current = $pdo->prepare('SELECT status FROM school_years WHERE id=? AND archived_at IS NULL');
                $current->execute([$id]);
                if ($current->fetchColumn() === 'active' && $activeCount <= 1) respond(['ok' => false, 'message' => 'One academic year must remain active.'], 422);
                $stmt = $pdo->prepare("UPDATE school_years SET status='inactive' WHERE id=? AND archived_at IS NULL");
                $stmt->execute([$id]);
            } else {
                $pdo->beginTransaction();
                $pdo->prepare("UPDATE school_years SET status='inactive' WHERE archived_at IS NULL AND status='active' AND id<>?")->execute([$id]);
                $stmt = $pdo->prepare("UPDATE school_years SET status='active' WHERE id=? AND archived_at IS NULL");
                $stmt->execute([$id]);
                $pdo->commit();
            }
            audit($pdo, $user, 'update', 'school_year', $id, ['status' => $nextStatus]);
            respond(['ok' => $stmt->rowCount() >= 0]);
        }
    }

    if ($resource === 'blocks') {
        $user = currentUser($pdo, ['admin', 'instructor']);
        if ($method === 'GET') {
            $year = trim((string)($_GET['school_year'] ?? ''));
            $stmt = $pdo->prepare('SELECT b.id, b.label, y.label AS school_year, b.status, b.created_at, COUNT(DISTINCT s.student_id) AS student_count FROM student_blocks b JOIN school_years y ON y.id=b.school_year_id LEFT JOIN student_block_assignments a ON a.block_id=b.id AND a.archived_at IS NULL LEFT JOIN students s ON s.student_id=a.student_id AND s.archived_at IS NULL WHERE b.archived_at IS NULL '.($year !== '' ? 'AND y.label=?' : '').' GROUP BY b.id,b.label,y.label,b.status,b.created_at,y.start_year ORDER BY y.start_year DESC,b.label');
            $stmt->execute($year !== '' ? [$year] : []);
            respond(['ok' => true, 'blocks' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            requireFields($data, ['label', 'school_year']);
            $stmt = $pdo->prepare('INSERT INTO student_blocks (school_year_id, label, created_by) SELECT id, ?, ? FROM school_years WHERE label=? AND archived_at IS NULL');
            $stmt->execute([$data['label'], $user['user_uid'], $data['school_year']]);
            $blockId = (string)$pdo->lastInsertId();
            if ($stmt->rowCount() > 0) audit($pdo, $user, 'create', 'student_block', $blockId, ['label' => $data['label'], 'school_year' => $data['school_year']]);
            respond(['ok' => $stmt->rowCount() > 0, 'id' => $blockId], 201);
        }
        if ($method === 'PATCH' && $id !== '') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            requireFields($data, ['label']);
            $stmt = $pdo->prepare('UPDATE student_blocks SET label=? WHERE id=? AND archived_at IS NULL');
            $stmt->execute([$data['label'], $id]);
            if ($stmt->rowCount() > 0) audit($pdo, $user, 'update', 'student_block', $id, ['label' => $data['label']]);
            respond(['ok' => $stmt->rowCount() > 0]);
        }
    }

    if ($resource === 'assignments') {
        $user = currentUser($pdo, ['admin', 'instructor']);
        if ($method === 'GET') {
            $year = trim((string)($_GET['school_year'] ?? ''));
            $blockId = trim((string)($_GET['block_id'] ?? ''));
            if (($_GET['unassigned'] ?? '0') === '1') {
                $stmt = $pdo->prepare('SELECT s.student_id,s.student_name,s.parent_name,s.contact_number,s.parent_contact FROM students s WHERE s.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM student_block_assignments a JOIN student_blocks b ON b.id=a.block_id JOIN school_years y ON y.id=b.school_year_id WHERE a.student_id=s.student_id AND a.archived_at IS NULL AND y.label=?) ORDER BY s.student_name');
                $stmt->execute([$year]);
                respond(['ok' => true, 'students' => $stmt->fetchAll()]);
            }
            $stmt = $pdo->prepare('SELECT s.student_id,s.student_name,s.parent_name,s.contact_number,s.parent_contact,y.label AS registered_school_year,b.id AS block_id,b.label AS block_label FROM student_block_assignments a JOIN students s ON s.student_id=a.student_id JOIN student_blocks b ON b.id=a.block_id JOIN school_years y ON y.id=b.school_year_id WHERE a.archived_at IS NULL AND s.archived_at IS NULL '.($blockId !== '' ? 'AND b.id=?' : ($year !== '' ? 'AND y.label=?' : '')).' ORDER BY s.student_name');
            $stmt->execute($blockId !== '' ? [$blockId] : ($year !== '' ? [$year] : []));
            respond(['ok' => true, 'students' => $stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            requireFields($data, ['student_id', 'block_id']);
            $stmt = $pdo->prepare('INSERT INTO student_block_assignments (student_id, block_id, school_year_id, assigned_by) SELECT ?, b.id, b.school_year_id, ? FROM student_blocks b WHERE b.id=? AND b.archived_at IS NULL ON DUPLICATE KEY UPDATE block_id=VALUES(block_id), assigned_by=VALUES(assigned_by), archived_at=NULL, updated_at=NOW()');
            $stmt->execute([$data['student_id'], $user['user_uid'], $data['block_id']]);
            if ($stmt->rowCount() === 0) respond(['ok'=>false,'message'=>'The selected block is unavailable.'],422);
            audit($pdo, $user, 'assign', 'student_block', (string)$data['student_id'], ['block_id' => $data['block_id']]);
            respond(['ok' => true]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'archive') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $stmt = $pdo->prepare('UPDATE student_block_assignments SET archived_at=NOW() WHERE student_id=? AND archived_at IS NULL');
            $stmt->execute([$id]);
            if ($stmt->rowCount() > 0) audit($pdo, $user, 'unassign', 'student_block', $id);
            respond(['ok' => true]);
        }
    }

    if ($resource === 'case-comments') {
        $user = currentUser($pdo, ['admin', 'instructor', 'student']);
        $caseId = trim((string)($_GET['case_id'] ?? ''));
        if ($method === 'GET') {
            if ($caseId === '') respond(['ok' => false, 'message' => 'case_id is required.'], 422);
            $caseStmt = $pdo->prepare('SELECT id,student_id,instructor_uid,instructor_name,procedure_key,case_no,teacher_remarks FROM case_records WHERE id=?');
            $caseStmt->execute([$caseId]); $case = $caseStmt->fetch();
            if (!$case) respond(['ok' => false, 'message' => 'Case not found.'], 404);
            if ($user['role'] === 'student' && $user['user_uid'] !== $case['student_id']) respond(['ok' => false, 'message' => 'Access denied.'], 403);

            $legacy = trim((string)($case['teacher_remarks'] ?? ''));
            $commentCountStmt=$pdo->prepare('SELECT COUNT(*) FROM case_comments WHERE case_id=?');$commentCountStmt->execute([$caseId]);$hasComments=(int)$commentCountStmt->fetchColumn()>0;
            if (!$hasComments && $legacy !== '' && !preg_match('/^(none|n\/?a|not applicable|null|undefined|-)$/i', $legacy)) {
                $legacyStmt = $pdo->prepare("INSERT IGNORE INTO case_comments (case_id,author_uid,author_name,author_role,comment_text,source_key) VALUES (?,?,?,?,?,?)");
                $legacyStmt->execute([$caseId,$case['instructor_uid'] ?: null,$case['instructor_name'] ?: 'Clinical Instructor','instructor',$legacy,'legacy-case:'.$caseId]);
            }

            $requestStmt = $pdo->prepare("SELECT id,rejection_remarks,rejected_at FROM edit_requests WHERE student_id=? AND procedure_key=? AND status='rejected' AND rejection_remarks IS NOT NULL");
            $requestStmt->execute([$case['student_id'],$case['procedure_key']]);
            $insertRequestComment = $pdo->prepare("INSERT IGNORE INTO case_comments (case_id,author_uid,author_name,author_role,comment_text,source_key,created_at) VALUES (?,?,?,?,?,?,COALESCE(?,NOW()))");
            foreach ($requestStmt->fetchAll() as $request) {
                $numbersStmt = $pdo->prepare('SELECT case_numbers FROM edit_requests WHERE id=?'); $numbersStmt->execute([$request['id']]);
                $numbers = json_decode((string)$numbersStmt->fetchColumn(), true); if (!is_array($numbers)) $numbers=[];
                if (!in_array((string)$case['case_no'], array_map('strval',$numbers), true)) continue;
                $remark = trim((string)$request['rejection_remarks']);
                if ($remark === '' || preg_match('/^(none|n\/?a|not applicable|null|undefined|-)$/i', $remark)) continue;
                $insertRequestComment->execute([$caseId,null,$case['instructor_name'] ?: 'Clinical Instructor','instructor',$remark,'edit-request:'.$request['id'],$request['rejected_at']]);
            }

            $archived = ($_GET['archived'] ?? '0') === '1';
            $stmt = $pdo->prepare('SELECT id,case_id,author_uid,author_name,author_role,comment_text,created_at,archived_at FROM case_comments WHERE case_id=? AND '.($archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL').' ORDER BY created_at DESC,id DESC');
            $stmt->execute([$caseId]); respond(['ok'=>true,'comments'=>$stmt->fetchAll()]);
        }
        if ($method === 'PATCH' && $id !== '' && in_array($action, ['archive','restore'], true)) {
            $ownerStmt=$pdo->prepare('SELECT c.student_id FROM case_comments m JOIN case_records c ON c.id=m.case_id WHERE m.id=?');$ownerStmt->execute([$id]);$owner=$ownerStmt->fetchColumn();
            if (!$owner) respond(['ok'=>false,'message'=>'Comment not found.'],404);
            if ($user['role']==='student' && $user['user_uid']!==$owner) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $sql=$action==='archive'?'UPDATE case_comments SET archived_at=NOW(),archived_by=? WHERE id=? AND archived_at IS NULL':'UPDATE case_comments SET archived_at=NULL,archived_by=NULL WHERE id=? AND archived_at IS NOT NULL';
            $stmt=$pdo->prepare($sql);$stmt->execute($action==='archive'?[$user['user_uid'],$id]:[$id]);audit($pdo,$user,$action,'case_comment',$id);respond(['ok'=>$stmt->rowCount()>0]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'delete') {
            $ownerStmt=$pdo->prepare('SELECT c.student_id,m.case_id,m.source_key,m.comment_text FROM case_comments m JOIN case_records c ON c.id=m.case_id WHERE m.id=? AND m.archived_at IS NOT NULL');
            $ownerStmt->execute([$id]);
            $comment=$ownerStmt->fetch();
            if (!$comment) respond(['ok'=>false,'message'=>'Archived comment not found.'],404);
            if ($user['role']==='student' && $user['user_uid']!==$comment['student_id']) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $pdo->beginTransaction();
            try {
                $stmt=$pdo->prepare('DELETE FROM case_comments WHERE id=? AND archived_at IS NOT NULL');
                $stmt->execute([$id]);
                $deleted = $stmt->rowCount() > 0;
                if ($deleted && strpos((string)($comment['source_key'] ?? ''), 'legacy-case:') === 0) {
                    $clearCase = $pdo->prepare('UPDATE case_records SET teacher_remarks=NULL WHERE id=? AND teacher_remarks=?');
                    $clearCase->execute([$comment['case_id'], $comment['comment_text']]);
                }
                if ($deleted && strpos((string)($comment['source_key'] ?? ''), 'edit-request:') === 0) {
                    $requestId = substr((string)$comment['source_key'], strlen('edit-request:'));
                    $clearRequest = $pdo->prepare('UPDATE edit_requests SET rejection_remarks=NULL WHERE id=? AND rejection_remarks=?');
                    $clearRequest->execute([$requestId, $comment['comment_text']]);
                }
                if ($deleted) audit($pdo,$user,'delete_permanently','case_comment',$id);
                $pdo->commit();
                respond(['ok'=>$deleted]);
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
        }
    }
    if ($resource === 'case-role-availability' && $method === 'GET') {
        $user = currentUser($pdo, ['student']);
        $caseNo = trim((string)($_GET['case_no'] ?? ''));
        $patientName = trim((string)($_GET['patient_name'] ?? ''));
        $procedureKey = trim((string)($_GET['procedure_key'] ?? ''));
        if ($caseNo === '' || $patientName === '' || $procedureKey === '') respond(['ok' => false, 'message' => 'case_no, patient_name, and procedure_key are required.'], 422);

        $context = resolveCaseRoleContext(
            $pdo,
            $user['user_uid'],
            trim((string)($_GET['academic_year'] ?? '')),
            $caseNo,
            $patientName,
            $procedureKey,
        );
        $role = clinicalRoleForProcedure($procedureKey);
        if ($context === null) {
            respond([
                'ok' => true,
                'enforced' => false,
                'available' => true,
                'role' => $role,
                'role_label' => $role === null ? null : clinicalRoleLabel($role),
            ]);
        }

        $records = getActiveCaseRoleRecords($pdo, $context);
        $ownedByCurrentStudent = false;
        foreach ($records as $record) {
            if (($record['clinical_role'] ?? '') === $context['role'] && (string)$record['student_id'] === $user['user_uid']) {
                $ownedByCurrentStudent = true;
                break;
            }
        }
        $conflict = findCaseRoleConflict($records, $context['role'], $user['user_uid']);
        $conflictPayload = $conflict ? caseRoleConflictPayload($context) : null;
        respond([
            'ok' => true,
            'enforced' => true,
            'available' => $conflict === null,
            'role' => $context['role'],
            'role_label' => clinicalRoleLabel($context['role']),
            'case_no' => $caseNo,
            'patient_name' => $patientName,
            'owned_by_current_student' => $conflict === null && $ownedByCurrentStudent,
            'message' => $conflictPayload['message'] ?? '',
        ]);
    }

    if ($resource === 'cases') {
        $user = currentUser($pdo, ['admin', 'instructor', 'student']);
        if ($method === 'GET') {
            $archived = ($_GET['archived'] ?? '0') === '1';
            $conditions = [$archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL']; $params = [];
            if ($user['role'] === 'student') { $conditions[] = 'c.student_id=?'; $params[] = $user['user_uid']; }
            elseif (!empty($_GET['student_id'])) { $conditions[] = 'c.student_id=?'; $params[] = $_GET['student_id']; }
            if (!empty($_GET['school_year'])) { $conditions[] = 'c.academic_year=?'; $params[] = $_GET['school_year']; }
            if (!empty($_GET['procedure'])) { $conditions[] = 'c.procedure_key=?'; $params[] = $_GET['procedure']; }
            $stmt = $pdo->prepare("SELECT c.*,
                (SELECT y.label
                 FROM student_block_assignments a
                 JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL
                 JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL
                 WHERE a.student_id=c.student_id AND a.archived_at IS NULL
                 ORDER BY (y.label=c.academic_year) DESC,(y.status='active') DESC,y.start_year DESC
                 LIMIT 1) AS assigned_school_year
                FROM case_records c WHERE " . implode(' AND ', $conditions) . ' ORDER BY c.date_time_performed DESC, c.id DESC');
            $stmt->execute($params); respond(['ok' => true, 'cases' => $stmt->fetchAll()]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === '') {
            $ownership = $user['role'] === 'student' ? ' AND student_id=?' : '';
            $recordStmt = $pdo->prepare('SELECT id,student_id,procedure_key,academic_year,case_no,patient_name FROM case_records WHERE id=? AND archived_at IS NULL' . $ownership);
            $recordParams = [$id];
            if ($ownership !== '') $recordParams[] = $user['user_uid'];
            $recordStmt->execute($recordParams);
            $record = $recordStmt->fetch();
            if (!$record) respond(['ok' => false, 'message' => 'Clinical record not found or access is denied.'], 404);

            if ($user['role'] === 'student') {
                $permission = $pdo->prepare('SELECT approved FROM edit_permissions WHERE student_id=? AND procedure_key=?');
                $permission->execute([$user['user_uid'], $record['procedure_key']]);
                if ((int)$permission->fetchColumn() !== 1) {
                    respond(['ok' => false, 'message' => 'Instructor correction approval is required before editing this record.'], 403);
                }
            }

            $editableFields = [
                'case_no', 'complete_diagnosis', 'date_time_performed', 'patient_name', 'patient_address',
                'facility_name', 'facility_address', 'facility_contact_number', 'supervisor_printed_name',
                'supervisor_contact_number', 'supervisor_position_designation', 'supervisor_license_no',
                'supervisor_license_expiry_date',
            ];
            if (array_key_exists('facility_contact_number', $data)) validateContactNumberInput($data['facility_contact_number'], 'Facility contact number');
            if (array_key_exists('supervisor_contact_number', $data)) validateContactNumberInput($data['supervisor_contact_number'], 'Supervisor contact number');
            $fields = [];
            $params = [];
            foreach ($editableFields as $field) {
                if (array_key_exists($field, $data)) {
                    $fields[] = "$field=?";
                    $params[] = in_array($field, ['date_time_performed', 'supervisor_license_expiry_date'], true)
                        && trim((string)($data[$field] ?? '')) === '' ? null : $data[$field];
                }
            }
            if (!$fields) respond(['ok' => false, 'message' => 'No clinical changes were supplied.'], 422);

            $nextCaseNo = trim((string)($data['case_no'] ?? $record['case_no']));
            $nextPatientName = trim((string)($data['patient_name'] ?? $record['patient_name']));
            if ($nextCaseNo === '' || $nextPatientName === '') respond(['ok' => false, 'message' => 'Case number and patient name are required.'], 422);
            $roleContext = resolveCaseRoleContext($pdo, (string)$record['student_id'], (string)$record['academic_year'], $nextCaseNo, $nextPatientName, (string)$record['procedure_key']);
            $lockNames = $roleContext === null ? [] : caseRoleLockNames($roleContext);
            $roleConflict = null;
            if ($lockNames && !acquireCaseRoleLocks($pdo, $lockNames)) respond(['ok' => false, 'message' => 'The patient role is being updated. Please try again.'], 503);
            try {
                if ($roleContext !== null) {
                    $roleConflict = findCaseRoleConflict(getActiveCaseRoleRecords($pdo, $roleContext), $roleContext['role'], (string)$record['student_id']);
                }
                if ($roleConflict === null) {
                    $fields[] = 'record_status=?';
                    $params[] = 'submitted';
                    $fields[] = 'teacher_remarks=?';
                    $params[] = null;
                    $fields[] = 'checked_by=NULL';
                    $fields[] = 'checked_at=NULL';
                    $params[] = $id;
                    $update = $pdo->prepare('UPDATE case_records SET ' . implode(',', $fields) . ' WHERE id=? AND archived_at IS NULL');
                    $update->execute($params);
                    if ($user['role'] === 'student') {
                        $consume = $pdo->prepare('UPDATE edit_permissions SET approved=0, updated_at=NOW() WHERE student_id=? AND procedure_key=?');
                        $consume->execute([$user['user_uid'], $record['procedure_key']]);
                    }
                    audit($pdo, $user, 'update', 'case', $id, ['fields' => array_values(array_intersect($editableFields, array_keys($data)))]);
                }
            } finally {
                releaseCaseRoleLocks($pdo, $lockNames);
            }
            if ($roleConflict !== null) respond(caseRoleConflictPayload($roleContext), 409);
            respond(['ok' => true]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'review') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $statusMap = ['Draft' => 'submitted', 'Submitted' => 'submitted', 'Under Review' => 'reviewed', 'Changes Requested' => 'needs_revision', 'Resubmitted' => 'submitted', 'Verified' => 'verified', 'Invalid' => 'invalid', 'Archived' => 'archived'];
            $requested = (string)($data['status'] ?? '');
            $status = $statusMap[$requested] ?? $requested;
            if (!in_array($status, ['submitted', 'reviewed', 'verified', 'needs_revision', 'invalid', 'archived'], true)) respond(['ok' => false, 'message' => 'Invalid record status.'], 422);
            if (in_array($status, ['needs_revision', 'invalid'], true) && trim((string)($data['remarks'] ?? '')) === '') {
                respond(['ok' => false, 'message' => 'Explain what needs to be corrected before requesting changes or marking a record invalid.'], 422);
            }
            $instructorId = $data['instructor_id'] ?? $data['instructorId'] ?? null;
            $instructorName = $data['instructor_name'] ?? $data['instructorName'] ?? null;
            $pdo->beginTransaction();
            $recordStmt = $pdo->prepare('SELECT * FROM case_records WHERE id=? AND archived_at IS NULL FOR UPDATE');
            $recordStmt->execute([$id]);
            $reviewRecord = $recordStmt->fetch();
            if (!$reviewRecord) {
                $pdo->rollBack();
                respond(['ok' => false, 'message' => 'Clinical record not found or already archived.'], 404);
            }
            if ($status === 'verified') {
                $missing = missingClinicalFields($reviewRecord);
                if ($missing) {
                    $pdo->rollBack();
                    respond(['ok' => false, 'message' => 'Complete these fields before verification: ' . implode(', ', $missing) . '.', 'missing_fields' => $missing], 422);
                }
                validateContactNumberInput($reviewRecord['facility_contact_number'], 'Facility contact number');
                validateContactNumberInput($reviewRecord['supervisor_contact_number'], 'Supervisor contact number');
            }
            $stmt = $pdo->prepare("UPDATE case_records SET record_status=?,teacher_remarks=?,checked_by=IF(?='verified',?,NULL),checked_at=IF(?='verified',NOW(),NULL),instructor_uid=COALESCE(?,instructor_uid),instructor_name=COALESCE(?,instructor_name) WHERE id=? AND archived_at IS NULL");
            $stmt->execute([$status, $data['remarks'] ?? null, $status, $instructorName, $status, $instructorId, $instructorName, $id]);
            audit($pdo, $user, 'review', 'case', $id, ['status' => $requested, 'remarks' => $data['remarks'] ?? null]);
            $pdo->commit();
            respond(['ok' => true]);
        }
        if ($method === 'POST') {
            requireFields($data, ['student_id', 'procedure_key', 'case_no', 'patient_name']);
            if ($user['role'] === 'student' && $user['user_uid'] !== (string)$data['student_id']) respond(['ok' => false, 'message' => 'Access denied.'], 403);
            // Students may not add more records once the verified requirement is met.
            // Keep this server-side so the limit cannot be bypassed by calling the API directly.
            $procedureTargets = ['delivery-handled' => 20, 'delivery-assisted' => 20, 'internal-exam' => 20, 'suturing' => 5, 'iv-insertion' => 5];
            $procedureKey = trim((string)$data['procedure_key']);
            if ($user['role'] === 'student' && isset($procedureTargets[$procedureKey])) {
                $verifiedStmt = $pdo->prepare("SELECT COUNT(*) FROM case_records WHERE student_id=? AND procedure_key=? AND record_status='verified' AND archived_at IS NULL");
                $verifiedStmt->execute([(string)$data['student_id'], $procedureKey]);
                if ((int)$verifiedStmt->fetchColumn() >= $procedureTargets[$procedureKey]) {
                    respond(['ok' => false, 'message' => 'This procedure is locked because you reached the required number of verified cases.'], 409);
                }
            }
            validateContactNumberInput($data['facility_contact_number'] ?? null, 'Facility contact number');
            validateContactNumberInput($data['supervisor_contact_number'] ?? null, 'Supervisor contact number');
            $requestedAcademicYear = trim((string)($data['academic_year'] ?? ''));
            $yearStmt = $pdo->prepare("SELECT y.label
                FROM student_block_assignments a
                JOIN student_blocks b ON b.id=a.block_id AND b.archived_at IS NULL
                JOIN school_years y ON y.id=b.school_year_id AND y.archived_at IS NULL
                WHERE a.student_id=? AND a.archived_at IS NULL
                ORDER BY (y.label=?) DESC,(y.status='active') DESC,y.start_year DESC
                LIMIT 1");
            $yearStmt->execute([$data['student_id'], $requestedAcademicYear]);
            $assignedAcademicYear = trim((string)($yearStmt->fetchColumn() ?: ''));
            $academicYear = $assignedAcademicYear !== ''
                ? $assignedAcademicYear
                : ($requestedAcademicYear !== '' ? $requestedAcademicYear : null);
            $caseNo = trim((string)$data['case_no']);
            $patientName = trim((string)$data['patient_name']);
            $roleContext = resolveCaseRoleContext($pdo, (string)$data['student_id'], (string)($academicYear ?? ''), $caseNo, $patientName, (string)$data['procedure_key']);
            $lockNames = [];
            $roleConflict = null;
            $inserted = false;
            $caseId = '';
            if ($roleContext !== null) {
                $lockNames = caseRoleLockNames($roleContext);
                if (!acquireCaseRoleLocks($pdo, $lockNames)) respond(['ok' => false, 'message' => 'The patient role is being updated. Please try again.'], 503);
            }

            try {
                if ($roleContext !== null) {
                    $roleConflict = findCaseRoleConflict(
                        getActiveCaseRoleRecords($pdo, $roleContext),
                        $roleContext['role'],
                        (string)$data['student_id'],
                    );
                }
                if ($roleConflict === null) {
                    $stmt = $pdo->prepare('INSERT INTO case_records (student_id, student_name, instructor_uid, instructor_name, academic_year, procedure_key, procedure_name, case_no, complete_diagnosis, date_time_performed, patient_name, patient_address, facility_name, facility_address, facility_contact_number, supervisor_printed_name, supervisor_contact_number, supervisor_position_designation, supervisor_license_no, supervisor_license_expiry_date) SELECT s.student_id,s.student_name,?,?,?,p.procedure_key,p.procedure_name,?,?,?,?,?,?,?,?,?,?,?,?,? FROM students s JOIN procedures p ON p.procedure_key=? WHERE s.student_id=? AND s.archived_at IS NULL');
                    $stmt->execute([$data['instructor_uid'] ?? null,$data['instructor_name'] ?? null,$academicYear,$caseNo,$data['complete_diagnosis'] ?? null,$data['date_time_performed'] ?? null,$data['patient_name'] ?? null,$data['patient_address'] ?? null,$data['facility_name'] ?? null,$data['facility_address'] ?? null,$data['facility_contact_number'] ?? null,$data['supervisor_printed_name'] ?? null,$data['supervisor_contact_number'] ?? null,$data['supervisor_position_designation'] ?? null,$data['supervisor_license_no'] ?? null,$data['supervisor_license_expiry_date'] ?? null,$data['procedure_key'],$data['student_id']]);
                    $inserted = $stmt->rowCount() > 0;
                    $caseId = (string)$pdo->lastInsertId();
                }
            } finally {
                releaseCaseRoleLocks($pdo, $lockNames);
            }

            if ($roleConflict !== null) respond(caseRoleConflictPayload($roleContext), 409);
            if ($inserted) audit($pdo, $user, 'create', 'case', $caseId, ['student_id' => $data['student_id'], 'procedure_key' => $data['procedure_key']]);
            respond(['ok' => $inserted, 'id' => $caseId], 201);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'comment') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $remarks = trim((string)($data['remarks'] ?? ''));
            if ($remarks === '') respond(['ok' => false, 'message' => 'A comment is required.'], 422);
            $caseStmt=$pdo->prepare('SELECT instructor_name FROM case_records WHERE id=? AND archived_at IS NULL');$caseStmt->execute([$id]);$case=$caseStmt->fetch();
            if (!$case) respond(['ok'=>false,'message'=>'Case not found.'],404);
            $authorName=trim((string)($data['checked_by'] ?? '')) ?: ($case['instructor_name'] ?: 'Clinical Instructor');
            $pdo->beginTransaction();
            $stmt=$pdo->prepare('INSERT INTO case_comments (case_id,author_uid,author_name,author_role,comment_text) VALUES (?,?,?,?,?)');
            $stmt->execute([$id,$user['user_uid'],$authorName,$user['role']==='admin'?'admin':'instructor',$remarks]);
            $pdo->prepare('UPDATE case_records SET teacher_remarks=? WHERE id=?')->execute([$remarks,$id]);
            $commentId=(string)$pdo->lastInsertId();
            audit($pdo,$user,'comment','case',$id,['comment_id'=>$commentId,'remarks'=>$remarks]);
            $pdo->commit();
            respond(['ok'=>true,'id'=>$commentId]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'archive') {
            $where = $user['role'] === 'student' ? ' AND student_id=?' : ''; $params = [$id]; if ($where) $params[] = $user['user_uid'];
            $stmt = $pdo->prepare('UPDATE case_records SET archived_at=NOW(), record_status=\'archived\' WHERE id=? AND archived_at IS NULL' . $where);
            $stmt->execute($params); audit($pdo, $user, 'archive', 'case', $id); respond(['ok' => $stmt->rowCount() > 0]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'restore') {
            $where = $user['role'] === 'student' ? ' AND student_id=?' : '';
            $params = [$id];
            if ($where) $params[] = $user['user_uid'];
            $recordStmt = $pdo->prepare('SELECT id,student_id,academic_year,procedure_key,case_no,patient_name FROM case_records WHERE id=? AND archived_at IS NOT NULL' . $where);
            $recordStmt->execute($params);
            $record = $recordStmt->fetch();
            if (!$record) respond(['ok' => false, 'message' => 'Archived case not found.'], 404);

            $recordAcademicYear = trim((string)($record['academic_year'] ?? ''));
            $roleContext = $recordAcademicYear === ''
                ? null
                : resolveCaseRoleContext($pdo, (string)$record['student_id'], $recordAcademicYear, (string)$record['case_no'], (string)($record['patient_name'] ?? ''), (string)$record['procedure_key']);
            $lockNames = [];
            $roleConflict = null;
            $restored = false;
            if ($roleContext !== null) {
                $lockNames = caseRoleLockNames($roleContext);
                if (!acquireCaseRoleLocks($pdo, $lockNames)) respond(['ok' => false, 'message' => 'The patient role is being updated. Please try again.'], 503);
            }

            try {
                if ($roleContext !== null) {
                    $roleConflict = findCaseRoleConflict(
                        getActiveCaseRoleRecords($pdo, $roleContext),
                        $roleContext['role'],
                        (string)$record['student_id'],
                    );
                }
                if ($roleConflict === null) {
                    $stmt = $pdo->prepare('UPDATE case_records SET archived_at=NULL, record_status=\'submitted\' WHERE id=? AND archived_at IS NOT NULL' . $where);
                    $stmt->execute($params);
                    $restored = $stmt->rowCount() > 0;
                }
            } finally {
                releaseCaseRoleLocks($pdo, $lockNames);
            }

            if ($roleConflict !== null) respond(caseRoleConflictPayload($roleContext), 409);
            if ($restored) audit($pdo, $user, 'restore', 'case', $id);
            respond(['ok' => $restored]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'delete') {
            $where = $user['role'] === 'student' ? ' AND student_id=?' : '';
            $params = [$id];
            if ($where) $params[] = $user['user_uid'];
            $stmt = $pdo->prepare('DELETE FROM case_records WHERE id=? AND archived_at IS NOT NULL' . $where);
            $stmt->execute($params);
            if ($stmt->rowCount() > 0) audit($pdo, $user, 'delete_permanently', 'case', $id);
            respond(['ok' => $stmt->rowCount() > 0]);
        }
        if ($method === 'DELETE' && $id !== '') {
            $where = $user['role'] === 'student' ? ' AND student_id=?' : ''; $params = [$id]; if ($where) $params[] = $user['user_uid'];
            $stmt = $pdo->prepare('DELETE FROM case_records WHERE id=? AND archived_at IS NOT NULL' . $where);
            $stmt->execute($params); audit($pdo, $user, 'delete_permanently', 'case', $id); respond(['ok' => $stmt->rowCount() > 0]);
        }
    }

    if ($resource === 'edit-requests') {
        $user = currentUser($pdo, ['admin', 'instructor', 'student']);
        if ($method === 'GET') {
            $archived = ($_GET['archived'] ?? '0') === '1';
            $where = $archived ? ' AND archived_at IS NOT NULL' : ' AND archived_at IS NULL';
            if ($user['role'] === 'student') $where .= ' AND student_id=?';
            $stmt = $pdo->prepare('SELECT * FROM edit_requests WHERE 1=1' . $where . ' ORDER BY requested_at DESC');
            $stmt->execute($user['role'] === 'student' ? [$user['user_uid']] : []);
            respond(['ok' => true, 'requests' => $stmt->fetchAll()]);
        }
        if ($method === 'POST' && $user['role'] === 'student') {
            requireFields($data, ['procedure_key', 'procedure_name']);
            $stmt = $pdo->prepare('INSERT INTO edit_requests (student_id, procedure_key, procedure_name, case_numbers) VALUES (?, ?, ?, ?)');
            $stmt->execute([$user['user_uid'],$data['procedure_key'],$data['procedure_name'],json_encode($data['case_numbers'] ?? [])]); respond(['ok'=>true,'id'=>$pdo->lastInsertId()],201);
        }
        if ($method === 'PATCH' && $id !== '' && in_array($action, ['approve','reject','archive','restore'], true)) {
            if ($action !== 'archive' && !in_array($user['role'], ['admin','instructor'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $sql = $action === 'approve'
                ? "UPDATE edit_requests SET status='approved', approved_at=NOW() WHERE id=? AND archived_at IS NULL"
                : ($action === 'reject'
                    ? "UPDATE edit_requests SET status='rejected', rejection_remarks=?, rejected_at=NOW() WHERE id=? AND archived_at IS NULL"
                    : ($action === 'restore'
                        ? 'UPDATE edit_requests SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL'
                        : 'UPDATE edit_requests SET archived_at=NOW() WHERE id=? AND archived_at IS NULL'));
            $params = $action === 'reject' ? [$data['remarks'] ?? '',$id] : [$id]; $stmt=$pdo->prepare($sql);$stmt->execute($params);
            if (in_array($action,['approve','reject'],true)) {
                $requestStmt=$pdo->prepare('SELECT student_id,procedure_key,procedure_name,case_numbers FROM edit_requests WHERE id=?');$requestStmt->execute([$id]);$request=$requestStmt->fetch();
                if ($request) {
                    $approved=$action==='approve'?1:0;
                    $perm=$pdo->prepare('INSERT INTO edit_permissions (student_id,procedure_key,approved,approved_at) VALUES (?,?,?,IF(?=1,NOW(),NULL)) ON DUPLICATE KEY UPDATE approved=VALUES(approved),approved_at=VALUES(approved_at),updated_at=NOW()');
                    $perm->execute([$request['student_id'],$request['procedure_key'],$approved,$approved]);
                    $caseNumbers = json_decode((string)($request['case_numbers'] ?? ''), true);
                    $caseNumber = is_array($caseNumbers) ? implode(', ', array_filter(array_map('strval', $caseNumbers), static fn($value) => trim($value) !== '')) : '';
                    $notice=$pdo->prepare('INSERT INTO notification_history (event_type,student_id,procedure_key,procedure_type,case_no,request_id,message,remarks) VALUES (?,?,?,?,?,?,?,?)');
                    $notice->execute(['edit_request_'.$action,$request['student_id'],$request['procedure_key'],$request['procedure_name'],$caseNumber ?: null,$id,'Your edit request was '.$action.'.',$data['remarks']??null]);
                }
            }
            audit($pdo,$user,$action,'edit_request',$id);respond(['ok'=>$stmt->rowCount()>0]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'delete') {
            if (!in_array($user['role'], ['admin', 'instructor', 'student'], true)) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $requestStmt = $pdo->prepare('SELECT student_id FROM edit_requests WHERE id=? AND archived_at IS NOT NULL');
            $requestStmt->execute([$id]);
            $request = $requestStmt->fetch();
            if (!$request) respond(['ok'=>false,'message'=>'Archived edit request not found.'],404);
            if ($user['role'] === 'student' && $user['user_uid'] !== (string)$request['student_id']) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $pdo->beginTransaction();
            try {
                $pdo->prepare('DELETE FROM notification_history WHERE request_id=?')->execute([$id]);
                $stmt = $pdo->prepare('DELETE FROM edit_requests WHERE id=? AND archived_at IS NOT NULL');
                $stmt->execute([$id]);
                if ($stmt->rowCount() > 0) audit($pdo,$user,'delete_permanently','edit_request',$id);
                $pdo->commit();
                respond(['ok'=>$stmt->rowCount()>0]);
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
        }
    }

    if ($resource === 'chat') {
        $user=currentUser($pdo,['admin','instructor','student']);
        if ($method === 'GET') {
            $conditions=['archived_at IS NULL'];$params=[];
            if ($user['role']==='student') {$conditions[]='student_id=?';$params[]=$user['user_uid'];}
            elseif (!empty($_GET['student_id'])) {$conditions[]='student_id=?';$params[]=$_GET['student_id'];}
            if (!empty($_GET['instructor_id'])) {$conditions[]='(instructor_id=? OR instructor_id IS NULL)';$params[]=$_GET['instructor_id'];}
            $stmt=$pdo->prepare('SELECT * FROM chat_messages WHERE '.implode(' AND ',$conditions).' ORDER BY created_at,id');$stmt->execute($params);
            respond(['ok'=>true,'messages'=>$stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            requireFields($data,['student_id','message']);
            if ($user['role']==='student' && $user['user_uid']!==(string)$data['student_id']) respond(['ok'=>false,'message'=>'Access denied.'],403);
            $senderRole=$user['role']==='student'?'student':'instructor';
            $message = trim((string)$data['message']);
            rejectInappropriateMessage($message);
            $stmt=$pdo->prepare('INSERT INTO chat_messages (student_id,student_name,instructor_id,instructor_name,sender_role,sender_name,message,read_by_student,read_by_instructor) SELECT s.student_id,s.student_name,?,?,?,?,?,?,? FROM students s WHERE s.student_id=? AND s.archived_at IS NULL');
            $stmt->execute([$data['instructor_id']??null,$data['instructor_name']??null,$senderRole,$data['sender_name']??($senderRole==='student'?'Student':'Instructor'),$message,$senderRole==='instructor'?1:0,$senderRole==='student'?1:0,$data['student_id']]);
            respond(['ok'=>$stmt->rowCount()>0,'id'=>$pdo->lastInsertId()],201);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'edit') {
            requireFields($data, ['message']);
            $message = trim((string)$data['message']);
            if ($message === '') respond(['ok'=>false,'message'=>'A message is required.'],422);
            rejectInappropriateMessage($message);
            $ownerWhere = $user['role'] === 'student'
                ? "sender_role='student' AND student_id=?"
                : ($user['role'] === 'instructor' ? "sender_role='instructor' AND instructor_id=?" : '1=1');
            $params = [$message, $id];
            if ($ownerWhere !== '1=1') $params[] = $user['user_uid'];
            $stmt = $pdo->prepare("UPDATE chat_messages SET message=? WHERE id=? AND archived_at IS NULL AND $ownerWhere");
            $stmt->execute($params);
            $updated = $stmt->rowCount() > 0;
            if (!$updated) {
                $existingParams = [$id];
                if ($ownerWhere !== '1=1') $existingParams[] = $user['user_uid'];
                $existing = $pdo->prepare("SELECT 1 FROM chat_messages WHERE id=? AND archived_at IS NULL AND $ownerWhere");
                $existing->execute($existingParams);
                $updated = (bool)$existing->fetchColumn();
            }
            respond(['ok'=>$updated]);
        }
        if ($method === 'PATCH' && $id !== '' && in_array($action, ['unsend', 'delete'], true)) {
            $ownerWhere = $user['role'] === 'student'
                ? "sender_role='student' AND student_id=?"
                : ($user['role'] === 'instructor' ? "sender_role='instructor' AND instructor_id=?" : '1=1');
            $params = [$id];
            if ($ownerWhere !== '1=1') $params[] = $user['user_uid'];
            $stmt = $pdo->prepare("UPDATE chat_messages SET archived_at=NOW() WHERE id=? AND archived_at IS NULL AND $ownerWhere");
            $stmt->execute($params);
            respond(['ok'=>$stmt->rowCount()>0]);
        }
    }

    if ($resource === 'notifications') {
        $user = currentUser($pdo, ['admin','instructor','student']);
        if ($method === 'GET') {
            $archived = ($_GET['archived'] ?? '0') === '1';
            $where = $user['role']==='student' ? ' AND (notification_history.student_id=? OR notification_history.student_id IS NULL)' : '';
            $stmt=$pdo->prepare('SELECT notification_history.*, edit_requests.case_numbers AS request_case_numbers FROM notification_history LEFT JOIN edit_requests ON edit_requests.id=notification_history.request_id WHERE '.($archived ? 'notification_history.archived_at IS NOT NULL' : 'notification_history.archived_at IS NULL').$where.' ORDER BY notification_history.created_at DESC');
            $stmt->execute($where?[$user['user_uid']]:[]);respond(['ok'=>true,'notifications'=>$stmt->fetchAll()]);
        }
        if ($method === 'POST') {
            requireFields($data,['event_type']);$stmt=$pdo->prepare('INSERT INTO notification_history (event_type,student_id,procedure_key,procedure_type,case_no,request_id,message,remarks,meta) VALUES (?,?,?,?,?,?,?,?,?)');$stmt->execute([$data['event_type'],$data['student_id']??null,$data['procedure_key']??null,$data['procedure_type']??null,$data['case_no']??null,$data['request_id']??null,$data['message']??null,$data['remarks']??null,json_encode($data['meta']??null)]);respond(['ok'=>true,'id'=>$pdo->lastInsertId()],201);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'comment') {
            if (!in_array($user['role'], ['admin', 'instructor'], true)) respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $remarks = trim((string)($data['remarks'] ?? ''));
            if ($remarks === '') respond(['ok' => false, 'message' => 'A comment is required.'], 422);
            $stmt = $pdo->prepare('UPDATE case_records SET teacher_remarks=? WHERE id=? AND archived_at IS NULL');
            $stmt->execute([$remarks, $id]);
            audit($pdo, $user, 'comment', 'case', $id, ['remarks' => $remarks]);
            respond(['ok' => $stmt->rowCount() >= 0]);
        }
        if ($method === 'PATCH' && $id !== '' && in_array($action, ['archive', 'restore'], true)) {
            if ($user['role'] !== 'admin') respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $stmt=$pdo->prepare('UPDATE notification_history SET archived_at='.($action === 'archive' ? 'NOW()' : 'NULL').' WHERE id=? AND archived_at IS '.($action === 'archive' ? 'NULL' : 'NOT NULL'));
            $stmt->execute([$id]);
            if ($stmt->rowCount() > 0) audit($pdo, $user, $action, 'notification', $id);
            respond(['ok'=>$stmt->rowCount()>0]);
        }
        if ($method === 'PATCH' && $id !== '' && $action === 'delete') {
            if ($user['role'] !== 'admin') respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $stmt = $pdo->prepare('DELETE FROM notification_history WHERE id=? AND archived_at IS NOT NULL');
            $stmt->execute([$id]);
            if ($stmt->rowCount() > 0) audit($pdo, $user, 'delete_permanently', 'notification', $id);
            respond(['ok' => $stmt->rowCount() > 0]);
        }
        if ($method === 'DELETE' && $id !== '') {
            if ($user['role'] !== 'admin') respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $stmt = $pdo->prepare('DELETE FROM notification_history WHERE id=? AND archived_at IS NOT NULL');
            $stmt->execute([$id]);
            if ($stmt->rowCount() > 0) audit($pdo, $user, 'delete', 'notification', $id);
            respond(['ok' => $stmt->rowCount() > 0]);
        }
    }

    if ($resource === 'audit') {
        $user = currentUser($pdo, ['admin', 'instructor', 'student']);
        if ($method === 'POST') {
            if ($user['role'] !== 'admin') respond(['ok' => false, 'message' => 'Access denied.'], 403);
            $actionName = trim((string)($data['action'] ?? $data['action_name'] ?? ''));
            $entityType = trim((string)($data['entity'] ?? $data['entity_type'] ?? 'system'));
            if ($actionName === '') respond(['ok' => false, 'message' => 'An activity action is required.'], 422);
            audit($pdo, $user, substr($actionName, 0, 80), substr($entityType, 0, 120), '', is_array($data['details'] ?? null) ? $data['details'] : []);
            respond(['ok' => true], 201);
        }
        $recordId = (string)($_GET['record_id'] ?? '');
        if ($user['role'] === 'student') {
            $sql = 'SELECT a.*, c.case_no, c.procedure_name FROM audit_trail a INNER JOIN case_records c ON a.entity_type = \'case\' AND a.entity_uid = CAST(c.id AS CHAR) WHERE c.student_id = ?';
            $params = [$user['user_uid']];
            if ($recordId !== '') {
                $sql .= ' AND c.id = ?';
                $params[] = $recordId;
            }
            $sql .= ' ORDER BY a.created_at DESC LIMIT 200';
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } elseif ($recordId !== '') {
            $stmt = $pdo->prepare("SELECT * FROM audit_trail WHERE entity_type = 'case' AND entity_uid = ? ORDER BY created_at DESC");
            $stmt->execute([$recordId]);
            $rows = $stmt->fetchAll();
        } else {
            $rows = $pdo->query("SELECT a.*, COALESCE(NULLIF(i.display_name, ''), NULLIF(s.student_name, ''), CASE WHEN a.actor_role = 'admin' THEN 'Administrator' ELSE NULL END) AS actor_name
                FROM audit_trail a
                LEFT JOIN instructor_accounts i ON a.actor_role = 'instructor' AND i.account_uid = a.actor_uid
                LEFT JOIN students s ON a.actor_role = 'student' AND s.student_id = a.actor_uid
                ORDER BY a.created_at DESC LIMIT 500")->fetchAll();
        }
        respond(['ok' => true, 'entries' => $rows]);
    }

    respond(['ok' => false, 'message' => 'Endpoint not found.'], 404);
} catch (PDOException $error) {
    if (in_array($resource, ['blocks', 'block-directory', 'assignments', 'assignment-directory'], true)) {
        error_log('Portal roster SQL error ['.$resource.']: '.$error->getMessage());
    }
    $duplicate = $error->getCode() === '23000';
    respond(['ok' => false, 'message' => $duplicate ? 'That record already exists.' : 'Database operation failed.'], $duplicate ? 409 : 500);
} catch (Throwable $error) {
    respond(['ok' => false, 'message' => 'Server operation failed.'], 500);
}
