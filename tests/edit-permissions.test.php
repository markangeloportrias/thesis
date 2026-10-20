<?php
declare(strict_types=1);
require __DIR__ . '/../api/edit-permissions.php';
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$db->sqliteCreateFunction('NOW', static fn(): string => '2026-09-10 12:00:00');
$db->exec('CREATE TABLE edit_permissions (id INTEGER DEFAULT 0, student_id TEXT, procedure_key TEXT, approved INTEGER, approved_at TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
function permissionCheck(bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
}
$db->exec("INSERT INTO edit_permissions VALUES (0,'S1','delivery-assisted',0,NULL,'2026-09-09 10:00:00'),(0,'S1','delivery assisted',1,'2026-09-10 11:00:00','2026-09-10 11:00:00')");
permissionCheck(hasClinicalEditPermission($db, 'S1', 'delivery-assisted'), 'Latest matching approval must be recognized across key formats');
permissionCheck(!hasClinicalEditPermission($db, 'OTHER', 'delivery assisted'), 'Never use another student approval');
permissionCheck(!hasClinicalEditPermission($db, 'S1', 'suturing'), 'Never use another procedure approval');
setClinicalEditPermission($db, 'S1', 'delivery-assisted', true);
permissionCheck((int)$db->query('SELECT COUNT(*) FROM edit_permissions WHERE approved=1')->fetchColumn() === 2, 'Synchronize all imported permission rows');
$consume = $db->prepare('UPDATE edit_permissions SET approved=0, updated_at=NOW() WHERE ' . EDIT_PERMISSION_MATCH);
$consume->execute(['S1', 'delivery assisted']);
permissionCheck(!hasClinicalEditPermission($db, 'S1', 'delivery-assisted'), 'Approval may only be consumed once');
setClinicalEditPermission($db, 'S1', 'delivery-assisted', true);
permissionCheck(hasClinicalEditPermission($db, 'S1', 'delivery assisted'), 'New approval must re-enable correction');
setClinicalEditPermission($db, 'S1', 'delivery assisted', false);
permissionCheck(!hasClinicalEditPermission($db, 'S1', 'delivery-assisted'), 'Rejection must revoke all variants');
setClinicalEditPermission($db, 'S2', 'suturing', true);
permissionCheck(hasClinicalEditPermission($db, 'S2', 'suturing'), 'New students must receive a permission row');
echo "PASS: permission key variants, duplicate rows, ownership, consumption, reapproval and rejection\n";

$db->exec('CREATE TABLE case_records (id INTEGER, student_id TEXT, procedure_key TEXT, case_no TEXT, patient_name TEXT, academic_year TEXT, archived_at TEXT)');
$db->exec('CREATE TABLE edit_requests (id INTEGER, student_id TEXT, procedure_key TEXT, case_numbers TEXT, record_identity TEXT, status TEXT, requested_at TEXT, archived_at TEXT, consumed_at TEXT)');
$first = ['id'=>0, 'student_id'=>'S3', 'procedure_key'=>'delivery handled', 'case_no'=>'001', 'patient_name'=>'First', 'academic_year'=>'2026-2027'];
$second = array_merge($first, ['patient_name'=>'Second']);
$caseInsert = $db->prepare('INSERT INTO case_records VALUES (?,?,?,?,?,?,NULL)');
foreach ([$first, $second] as $record) $caseInsert->execute(array_values($record));
$insertRequest = $db->prepare("INSERT INTO edit_requests VALUES (0,'S3','delivery handled','[\"001\"]',?,'approved',?,NULL,NULL)");
$insertRequest->execute([json_encode(array_diff_key($first, ['id'=>true])), '2026-10-20 10:00:00']);
$insertRequest->execute([json_encode(array_diff_key($second, ['id'=>true])), '2026-10-20 10:01:00']);
// A consumed procedure-wide flag must not override either exact approval.
setClinicalEditPermission($db, 'S3', 'delivery handled', false);
$firstApproval = clinicalRecordEditApproval($db, $first);
permissionCheck($firstApproval !== null, 'Exact approval must work despite stale procedure permission');
permissionCheck(clinicalRecordEditApproval($db, $second) !== null, 'Second record has its own approval');
$db->beginTransaction();
consumeClinicalRecordEditApproval($db, $firstApproval);
$db->rollBack();
permissionCheck(clinicalRecordEditApproval($db, $first) !== null, 'Failed save rollback preserves approval');
$db->beginTransaction();
consumeClinicalRecordEditApproval($db, $firstApproval);
$db->commit();
permissionCheck(clinicalRecordEditApproval($db, $first) === null, 'Saved record cannot reuse approval');
permissionCheck(clinicalRecordEditApproval($db, $second) !== null, 'Saving first record does not consume second approval with same ID and case number');
permissionCheck(clinicalRecordEditApproval($db, array_merge($second, ['student_id'=>'OTHER'])) === null, 'No cross-student approval');
permissionCheck(clinicalRecordEditApproval($db, array_merge($second, ['patient_name'=>'Third'])) === null, 'No cross-identity approval');
$insertRequest->execute([json_encode(array_diff_key($second, ['id'=>true])), '2026-10-20 10:02:00']);
$db->exec("UPDATE edit_requests SET status='rejected' WHERE requested_at='2026-10-20 10:02:00'");
permissionCheck(clinicalRecordEditApproval($db, $second) === null, 'New rejection overrides previous exact approval');
echo "PASS: record identity approvals, independent consumption, transaction rollback, ownership and newest decision\n";
