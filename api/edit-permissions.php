<?php
declare(strict_types=1);

const EDIT_PERMISSION_MATCH = "student_id=? AND REPLACE(LOWER(TRIM(procedure_key)), '-', ' ')=REPLACE(LOWER(TRIM(?)), '-', ' ')";

function hasClinicalEditPermission(PDO $pdo, string $student, string $procedure, bool $lock = false): bool
{
    // Old imports can contain several permission rows. A newer consumed or
    // rejected permission must override an older approval.
    $stmt = $pdo->prepare('SELECT approved FROM edit_permissions WHERE ' . EDIT_PERMISSION_MATCH . ' ORDER BY updated_at DESC, approved ASC, id DESC LIMIT 1' . ($lock ? ' FOR UPDATE' : ''));
    $stmt->execute([$student, $procedure]);
    return (int)$stmt->fetchColumn() === 1;
}

function setClinicalEditPermission(PDO $pdo, string $student, string $procedure, bool $approved): void
{
    $exists = $pdo->prepare('SELECT 1 FROM edit_permissions WHERE ' . EDIT_PERMISSION_MATCH . ' LIMIT 1');
    $exists->execute([$student, $procedure]);
    $approvedAt = $approved ? 'NOW()' : 'NULL';
    if ($exists->fetchColumn()) {
        $update = $pdo->prepare("UPDATE edit_permissions SET approved=?, approved_at=$approvedAt, updated_at=NOW() WHERE " . EDIT_PERMISSION_MATCH);
        $update->execute([(int)$approved, $student, $procedure]);
    } else {
        $insert = $pdo->prepare("INSERT INTO edit_permissions (student_id,procedure_key,approved,approved_at) VALUES (?,?,?,$approvedAt)");
        $insert->execute([$student, $procedure, (int)$approved]);
    }
}
