<?php
declare(strict_types=1);
require __DIR__ . '/../api/case-selection.php';
function checkSelection(bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
}
// Deliberately reproduce a damaged import with two rows sharing id=0.
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec("CREATE TABLE case_records (id INTEGER, student_id TEXT, procedure_key TEXT, case_no TEXT, patient_name TEXT, academic_year TEXT, archived_at TEXT, record_status TEXT)");
$insert = $db->prepare("INSERT INTO case_records VALUES (0,'S1','delivery assisted',?,'Patient','2026-2027',NULL,'submitted')");
$insert->execute(['001']);
$insert->execute(['003']);
$identity = ['student_id'=>'S1','procedure_key'=>'delivery assisted','case_no'=>'003','patient_name'=>'Patient','academic_year'=>'2026-2027'];
[$where, $params] = caseMutationSelection('0', $identity, 'S1');
$select = $db->prepare("SELECT * FROM case_records WHERE $where LIMIT 2");
$select->execute($params);
checkSelection(count($select->fetchAll()) === 1, 'Only selected case must match');
$update = $db->prepare("UPDATE case_records SET record_status='verified' WHERE $where");
$update->execute($params);
checkSelection($update->rowCount() === 1, 'Verification must change one row');
checkSelection($db->query("SELECT record_status FROM case_records WHERE case_no='001'")->fetchColumn() === 'submitted', 'Other case must stay submitted');
$archive = $db->prepare("UPDATE case_records SET archived_at='2026-09-10',record_status='archived' WHERE $where");
$archive->execute($params);
checkSelection($archive->rowCount() === 1, 'Archive must change one row');
checkSelection($db->query("SELECT case_no FROM case_records WHERE archived_at IS NULL")->fetchColumn() === '001', 'Other case must remain active');
$db->exec('UPDATE case_records SET archived_at=NULL');
[$bareWhere, $bareParams] = caseMutationSelection('0', []);
$bare = $db->prepare("SELECT * FROM case_records WHERE $bareWhere LIMIT 2");
$bare->execute($bareParams);
checkSelection(count($bare->fetchAll()) === 2, 'Legacy ID-only request must expose ambiguity for rejection');
[$ownerWhere, $ownerParams] = caseMutationSelection('0', $identity, 'OTHER');
$owner = $db->prepare("SELECT * FROM case_records WHERE $ownerWhere");
$owner->execute($ownerParams);
checkSelection($owner->fetchAll() === [], 'Identity must not bypass session ownership');
echo "PASS: duplicate imported IDs isolate archive and verification; legacy ambiguity and ownership guards\n";
