<?php
declare(strict_types=1);

const EDIT_PERMISSION_MATCH = "student_id=? AND REPLACE(LOWER(TRIM(procedure_key)), '-', ' ')=?";

function editPermissionProcedure(string $procedure): string
{
    return str_replace('-', ' ', strtolower(trim($procedure)));
}

function hasClinicalEditPermission(PDO $pdo, string $student, string $procedure, bool $lock = false): bool
{
    // Old imports can contain several permission rows. A newer consumed or
    // rejected permission must override an older approval.
    $stmt = $pdo->prepare('SELECT approved FROM edit_permissions WHERE ' . EDIT_PERMISSION_MATCH . ' ORDER BY updated_at DESC, approved ASC, id DESC LIMIT 1' . ($lock ? ' FOR UPDATE' : ''));
    $stmt->execute([$student, editPermissionProcedure($procedure)]);
    return (int)$stmt->fetchColumn() === 1;
}

function setClinicalEditPermission(PDO $pdo, string $student, string $procedure, bool $approved): void
{
    $exists = $pdo->prepare('SELECT 1 FROM edit_permissions WHERE ' . EDIT_PERMISSION_MATCH . ' LIMIT 1');
    $exists->execute([$student, editPermissionProcedure($procedure)]);
    $approvedAt = $approved ? 'NOW()' : 'NULL';
    if ($exists->fetchColumn()) {
        $update = $pdo->prepare("UPDATE edit_permissions SET approved=?, approved_at=$approvedAt, updated_at=NOW() WHERE " . EDIT_PERMISSION_MATCH);
        $update->execute([(int)$approved, $student, editPermissionProcedure($procedure)]);
    } else {
        $insert = $pdo->prepare("INSERT INTO edit_permissions (student_id,procedure_key,approved,approved_at) VALUES (?,?,?,$approvedAt)");
        $insert->execute([$student, $procedure, (int)$approved]);
    }
}

// Approval belongs to the original record inputs, not a reused case ID or
// a permission shared by all records in a procedure.
function clinicalRecordEditApproval(PDO $pdo, array $record, bool $lock = false): ?array
{
    $stmt = $pdo->prepare("SELECT * FROM edit_requests WHERE student_id=? AND REPLACE(LOWER(TRIM(procedure_key)), '-', ' ')=? AND archived_at IS NULL ORDER BY requested_at DESC,id DESC" . ($lock ? ' FOR UPDATE' : ''));
    $stmt->execute([$record['student_id'], editPermissionProcedure($record['procedure_key'])]);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $request) {
        $identity = json_decode((string)($request['record_identity'] ?? ''), true);
        if (is_array($identity) && $identity) {
            $matches = true;
            foreach ($identity as $field => $value) {
                if (!array_key_exists($field, $record) || (string)($record[$field] ?? '') !== (string)($value ?? '')) {
                    $matches = false;
                    break;
                }
            }
            if (!$matches) continue;
        } else {
            // Legacy case-number requests are usable only when unambiguous.
            $numbers = json_decode((string)($request['case_numbers'] ?? ''), true);
            if (!is_array($numbers) || !in_array((string)$record['case_no'], array_map('strval', $numbers), true)) continue;
            $count = $pdo->prepare("SELECT COUNT(*) FROM case_records WHERE student_id=? AND REPLACE(LOWER(TRIM(procedure_key)), '-', ' ')=? AND case_no=? AND archived_at IS NULL");
            $count->execute([$record['student_id'], editPermissionProcedure($record['procedure_key']), $record['case_no']]);
            if ((int)$count->fetchColumn() !== 1 || !hasClinicalEditPermission($pdo, $record['student_id'], $record['procedure_key'], $lock)) return null;
        }
        // The latest matching decision takes precedence over older approvals.
        return $request['status'] === 'approved' && empty($request['consumed_at']) ? $request : null;
    }
    return null;
}

function consumeClinicalRecordEditApproval(PDO $pdo, array $request): void
{
    $stmt = $pdo->prepare("UPDATE edit_requests SET consumed_at=NOW() WHERE student_id=? AND procedure_key=? AND id=? AND requested_at=? AND COALESCE(record_identity,'')=? AND status='approved' AND consumed_at IS NULL");
    $stmt->execute([$request['student_id'], $request['procedure_key'], $request['id'], $request['requested_at'], $request['record_identity'] ?? '']);
    if (!$stmt->rowCount()) throw new RuntimeException('The correction approval was already used or withdrawn.');
    if (empty($request['record_identity'])) {
        $legacy = $pdo->prepare('UPDATE edit_permissions SET approved=0, updated_at=NOW() WHERE ' . EDIT_PERMISSION_MATCH);
        $legacy->execute([$request['student_id'], editPermissionProcedure($request['procedure_key'])]);
    }
}
