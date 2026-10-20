<?php
declare(strict_types=1);
require __DIR__ . '/../api/case-selection.php';

$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec('CREATE TABLE case_records (
    id INTEGER, student_id TEXT, procedure_key TEXT, case_no TEXT,
    patient_name TEXT, academic_year TEXT, created_at TEXT,
    complete_diagnosis TEXT, teacher_remarks TEXT, record_status TEXT, archived_at TEXT
)');
$insert = $db->prepare('INSERT INTO case_records VALUES (0,?,?,?,?,?,?,?,?,?,NULL)');
foreach ([
    ['S1','handled','001','Patient','2026','2026-01-01','First','Same feedback','needs_revision'],
    ['S1','handled','001','Patient','2026','2026-01-02','Second','Same feedback','verified'],
    ['S2','handled','001','Patient','2026','2026-01-01','Third','Same feedback','verified'],
] as $row) $insert->execute($row);
$record = $db->query("SELECT * FROM case_records WHERE complete_diagnosis='First'")->fetch(PDO::FETCH_ASSOC);
requireUniqueFeedbackScope($db, $record);
if (!clearCaseFeedbackMirror($db, $record, 'Same feedback')) throw new RuntimeException('Selected feedback was not cleared');
$rows = $db->query('SELECT teacher_remarks,record_status FROM case_records ORDER BY rowid')->fetchAll(PDO::FETCH_ASSOC);
if ($rows[0]['teacher_remarks'] !== null || $rows[0]['record_status'] !== 'needs_revision') throw new RuntimeException('Selected feedback or status is incorrect');
foreach (array_slice($rows, 1) as $row) {
    if ($row['teacher_remarks'] !== 'Same feedback' || $row['record_status'] !== 'verified') throw new RuntimeException('Another case was changed');
}
if (clearCaseFeedbackMirror($db, $record, 'Same feedback')) throw new RuntimeException('Repeat deletion changed another case');

// Same imported ID, case number and timestamp, but different clinical details.
$db->exec("UPDATE case_records SET created_at='2026-01-01',teacher_remarks='Same feedback'");
clearCaseFeedbackMirror($db, $record, 'Same feedback');
if ((int)$db->query("SELECT COUNT(*) FROM case_records WHERE teacher_remarks='Same feedback'")->fetchColumn() !== 2) throw new RuntimeException('Full identity did not isolate mirror deletion');
try {
    requireUniqueFeedbackScope($db, $record);
    throw new LogicException('Ambiguous legacy feedback should be rejected');
} catch (RuntimeException $error) {
    if ($error instanceof LogicException) throw $error;
}

// Regression guards for both API deletion paths.
$api = file_get_contents(__DIR__ . '/../api/index.php');
if (strpos($api, 'UPDATE edit_requests SET rejection_remarks=NULL') !== false) throw new RuntimeException('Deleting one case must not erase shared request feedback');
if (strpos($api, 'DELETE FROM case_comments WHERE id=? AND record_scope=? AND comment_text=? AND archived_at IS NULL') === false) throw new RuntimeException('Resolved comment deletion lost its scope');
echo "PASS: feedback deletion isolates duplicate IDs, preserves statuses and other cases, and rejects ambiguous scopes\n";
