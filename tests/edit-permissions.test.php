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
