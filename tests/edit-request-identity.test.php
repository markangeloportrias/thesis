<?php
declare(strict_types=1);
require __DIR__ . '/../api/case-selection.php';
class EditRequestResponse extends RuntimeException {
    public function __construct(public array $body, public int $status) { parent::__construct($body['message'] ?? ''); }
}
function respond(array $body, int $status = 200): void { throw new EditRequestResponse($body, $status); }
function requireFields(array $data, array $fields): void {
    foreach ($fields as $field) if (empty($data[$field])) throw new RuntimeException('Missing field');
}
class EditRequestDatabase extends PDO {
    public function __construct() { parent::__construct('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]); }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare(str_replace(' FOR UPDATE', '', $query), $options);
    }
}
function checkRequest(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
$source = file_get_contents(__DIR__ . '/../api/index.php');
$start = strpos($source, "            requireFields(\$data, ['procedure_key', 'procedure_name']);", strpos($source, "if (\$resource === 'edit-requests')"));
$end = strpos($source, "\n        }", $start);
$submit = eval('return function ($pdo, $user, $data) {' . substr($source, $start, $end - $start) . '};');
$db = new EditRequestDatabase();
$db->exec('CREATE TABLE case_records (id INTEGER, student_id TEXT, procedure_key TEXT, procedure_name TEXT, case_no TEXT, patient_name TEXT, academic_year TEXT, archived_at TEXT, record_status TEXT, checked_by TEXT, checked_at TEXT)');
$db->exec("INSERT INTO case_records VALUES (0,'S1','delivery handled','Delivery Handled','001','Patient','2025-2026',NULL,'verified','Instructor',NULL), (0,'S1','delivery handled','Delivery Handled','001','Patient','2026-2027',NULL,'submitted',NULL,NULL)");
$db->exec('CREATE TABLE edit_requests (id INTEGER PRIMARY KEY, student_id TEXT, procedure_key TEXT, procedure_name TEXT, case_numbers TEXT, record_identity TEXT)');
$db->exec('CREATE TABLE notification_history (event_type TEXT, student_id TEXT, procedure_key TEXT, procedure_type TEXT, case_no TEXT, request_id TEXT, message TEXT)');
$identity = ['student_id'=>'S1', 'procedure_key'=>'delivery handled', 'case_no'=>'001', 'patient_name'=>'Patient', 'academic_year'=>'2026-2027'];
$send = function (array $identity, string $owner = 'S1') use ($submit, $db): EditRequestResponse {
    try { $submit($db, ['role'=>'student', 'user_uid'=>$owner], ['procedure_key'=>'delivery handled', 'procedure_name'=>'Delivery Handled', 'record_identity'=>$identity]); }
    catch (EditRequestResponse $response) { return $response; }
    throw new RuntimeException('Expected response');
};
checkRequest($send($identity)->status === 201, 'Unverified selected identity must not be blocked by another verified case sharing its ID and number');
checkRequest(json_decode($db->query('SELECT record_identity FROM edit_requests')->fetchColumn(), true) === $identity, 'Persist exact identity');
$locked = array_merge($identity, ['academic_year'=>'2025-2026']);
checkRequest($send($locked)->status === 409, 'Verified identity stays locked');
checkRequest($send($identity, 'OTHER')->status === 409, 'Identity cannot bypass ownership');
checkRequest($send([])->status === 422, 'Missing identity is rejected');
$db->exec("INSERT INTO case_records SELECT * FROM case_records WHERE academic_year='2026-2027'");
checkRequest($send($identity)->status === 409, 'Ambiguous identities rejected');
checkRequest((int)$db->query('SELECT COUNT(*) FROM edit_requests')->fetchColumn() === 1, 'Rejected requests must not create pending requests');
checkRequest($db->query("SELECT record_status FROM case_records WHERE academic_year='2025-2026'")->fetchColumn() === 'verified', 'Request cannot unlock a verified record');
echo "PASS: real request handler identity selection, storage, verified locks, ownership and rollback\n";
