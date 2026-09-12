<?php
declare(strict_types=1);

// Repair imported block tables without changing student data or valid IDs.
function planBlockIdentityRepair(array $blocks, array $referencedIds): array
{
    $counts = [];
    // Do not reuse an ID held by an orphaned assignment either.
    $nextId = $referencedIds ? max(0, ...$referencedIds) : 0;
    foreach ($blocks as $block) {
        $id = (int)$block['id'];
        $counts[$id] = ($counts[$id] ?? 0) + 1;
        $nextId = max($nextId, $id);
    }
    $changes = [];
    foreach ($blocks as $block) {
        $id = (int)$block['id'];
        if ($id > 0 && $counts[$id] === 1) continue;
        if (in_array($id, $referencedIds, true)) {
            throw new RuntimeException('Block IDs need repair, but existing assignments use an invalid or duplicated block ID. No block IDs were changed; these assignments need review.');
        }
        $changes[] = ['old_id' => $id, 'new_id' => ++$nextId];
    }
    return $changes;
}

function ensureBlockIdentities(PDO $pdo): void
{
    $column = $pdo->query("SELECT COLUMN_TYPE, EXTRA FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_blocks' AND COLUMN_NAME='id'")->fetch();
    if (!$column || !preg_match('/^(?:tinyint|smallint|mediumint|int|bigint)(?:\(\d+\))?(?: unsigned)?$/i', $column['COLUMN_TYPE'])) {
        throw new RuntimeException('The block ID column needs database schema review. No block IDs were changed.');
    }
    $hasUniqueId = static function () use ($pdo): bool {
        return (bool)$pdo->query("SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_blocks' AND NON_UNIQUE=0 GROUP BY INDEX_NAME HAVING COUNT(*)=1 AND MAX(COLUMN_NAME)='id' LIMIT 1")->fetchColumn();
    };
    $invalid = (bool)$pdo->query('SELECT 1 FROM student_blocks GROUP BY id HAVING id<=0 OR COUNT(*)>1 LIMIT 1')->fetchColumn();
    if (!$invalid && stripos($column['EXTRA'], 'auto_increment') !== false && $hasUniqueId()) return;

    $lockName = 'block-identity-' . substr(hash('sha256', (string)$pdo->query('SELECT DATABASE()')->fetchColumn()), 0, 40);
    $lock = $pdo->prepare('SELECT GET_LOCK(?, 20)');
    $lock->execute([$lockName]);
    if ((int)$lock->fetchColumn() !== 1) throw new RuntimeException('Block repair is in progress. Please reopen the academic year.');
    try {
        $pdo->beginTransaction();
        $blocks = $pdo->query('SELECT id FROM student_blocks ORDER BY id FOR UPDATE')->fetchAll();
        $references = array_map('intval', $pdo->query('SELECT block_id FROM student_block_assignments FOR UPDATE')->fetchAll(PDO::FETCH_COLUMN));
        $changes = planBlockIdentityRepair($blocks, $references);
        if ($changes) {
            // Other installations may add relationships not present in this repo.
            $otherReferences = $pdo->query("SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='student_blocks' AND REFERENCED_COLUMN_NAME='id' AND NOT (TABLE_NAME='student_block_assignments' AND COLUMN_NAME='block_id') LIMIT 1")->fetchColumn();
            if ($otherReferences) throw new RuntimeException('Additional block relationships need review before block IDs can be repaired.');
            $update = $pdo->prepare('UPDATE student_blocks SET id=? WHERE id=? LIMIT 1');
            foreach ($changes as $change) {
                $update->execute([$change['new_id'], $change['old_id']]);
                if ($update->rowCount() !== 1) throw new RuntimeException('Block IDs changed during repair. Please retry.');
            }
        }
        $pdo->commit();
        // DDL commits implicitly. Retrying after a DDL failure preserves the
        // repaired IDs and retries only the missing schema constraints.
        if (!$hasUniqueId()) {
            $pdo->exec('ALTER TABLE student_blocks ADD UNIQUE KEY uq_portal_block_identity (id)');
        }
        $pdo->exec('ALTER TABLE student_blocks MODIFY COLUMN id ' . $column['COLUMN_TYPE'] . ' NOT NULL AUTO_INCREMENT');
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    } finally {
        $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
    }
}
