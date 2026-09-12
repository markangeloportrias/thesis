<?php
declare(strict_types=1);
require __DIR__ . '/../api/block-identities.php';
function checkBlockRepair(bool $condition): void {
    if (!$condition) throw new RuntimeException('Block repair assertion failed');
}
$plan = planBlockIdentityRepair([['id'=>0], ['id'=>0], ['id'=>5]], [5]);
checkBlockRepair($plan === [['old_id'=>0,'new_id'=>6], ['old_id'=>0,'new_id'=>7]]);
checkBlockRepair(planBlockIdentityRepair([['id'=>5], ['id'=>6], ['id'=>7]], [5]) === []);
checkBlockRepair(planBlockIdentityRepair([['id'=>0]], [8]) === [['old_id'=>0,'new_id'=>9]]);
checkBlockRepair(planBlockIdentityRepair([['id'=>2], ['id'=>2]], []) === [['old_id'=>2,'new_id'=>3], ['old_id'=>2,'new_id'=>4]]);
foreach ([[0,0], [2,2]] as $ids) {
    try {
        planBlockIdentityRepair(array_map(fn($id)=>['id'=>$id], $ids), [$ids[0]]);
        throw new LogicException('Referenced duplicate must be rejected');
    } catch (RuntimeException $error) {
        checkBlockRepair(str_contains($error->getMessage(), 'assignments'));
    }
}
echo "PASS: zero IDs, duplicate IDs, valid IDs preserved, idempotent plans, ambiguous assignments blocked\n";
