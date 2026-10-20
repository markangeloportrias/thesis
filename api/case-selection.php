<?php
declare(strict_types=1);

// Imported databases can reuse numeric case IDs across procedures.
function caseCommentScope(array $record): string
{
    return hash('sha256', json_encode(array_map(
        static fn($field) => (string)($record[$field] ?? ''),
        ['id', 'student_id', 'procedure_key', 'academic_year', 'created_at']
    ), JSON_THROW_ON_ERROR));
}

// Use the same complete identity as record mutations, not the imported ID
// alone, when clearing the legacy copy of a deleted feedback comment.
function clearCaseFeedbackMirror(PDO $pdo, array $record, string $text): bool
{
    [$where, $params] = caseMutationSelection(
        (string)$record['id'], $record, (string)$record['student_id'],
        !empty($record['archived_at'])
    );
    $stmt = $pdo->prepare("UPDATE case_records SET teacher_remarks=NULL WHERE $where AND teacher_remarks=?");
    $stmt->execute(array_merge($params, [$text]));
    return $stmt->rowCount() > 0;
}

// Old imports can also contain colliding feedback scopes. Never delete shared
// feedback when its exact owner cannot be established.
function requireUniqueFeedbackScope(PDO $pdo, array $record): void
{
    $stmt = $pdo->prepare('SELECT * FROM case_records WHERE id=?');
    $stmt->execute([$record['id']]);
    $scope = caseCommentScope($record);
    $matches = array_filter($stmt->fetchAll(PDO::FETCH_ASSOC),
        static fn($candidate) => caseCommentScope($candidate) === $scope);
    if (count($matches) !== 1) {
        throw new RuntimeException('This feedback has an ambiguous imported record identity. No comments were deleted.');
    }
}

// Remove superseded feedback, retaining only the newest comment for this exact
// record. Remember imported sources without retaining their comment text, so
// loading feedback cannot recreate comments that were replaced.
function pruneCaseFeedback(PDO $pdo, array $record, array $user): void
{
    requireUniqueFeedbackScope($pdo, $record);
    $scope = caseCommentScope($record);
    $stmt = $pdo->prepare('SELECT id,source_key,comment_text FROM case_comments WHERE record_scope=? ORDER BY created_at DESC,id DESC FOR UPDATE');
    $stmt->execute([$scope]);
    $comments = $stmt->fetchAll();
    foreach (array_slice($comments, 1) as $comment) {
        if (!empty($comment['source_key'])) {
            audit($pdo, $user, 'supersede_comment_source', 'case_comment', hash('sha256', $scope . $comment['source_key']), []);
        }
        if (trim((string)($record['teacher_remarks'] ?? '')) === trim((string)$comment['comment_text'])) {
            audit($pdo, $user, 'supersede_comment_source', 'case_comment', hash('sha256', $scope . 'legacy-case:' . $record['id']), []);
        }
        $pdo->prepare('DELETE FROM case_comments WHERE id=? AND record_scope=?')->execute([$comment['id'], $scope]);
    }
}

function isSupersededCommentSource(PDO $pdo, string $scope, string $source): bool
{
    $stmt = $pdo->prepare("SELECT 1 FROM audit_trail WHERE entity_type='case_comment' AND entity_uid=? AND action_name='supersede_comment_source' LIMIT 1");
    $stmt->execute([hash('sha256', $scope . $source)]);
    return (bool)$stmt->fetchColumn();
}

// Reuse the exact predicate for the locked read and the write. An imported
// database may lack the unique key that normally makes id sufficient.
function caseMutationSelection(string $id, array $identity, ?string $owner = null, bool $archived = false): array
{
    $where = [$archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
    $params = [];
    if ($id !== 'resolve') {
        $where[] = 'id=?';
        $params[] = $id;
    } elseif ($identity === []) {
        throw new InvalidArgumentException('Record identity is required.');
    }
    if ($identity !== []) {
        foreach (['student_id', 'procedure_key', 'case_no', 'patient_name', 'academic_year'] as $column) {
            $where[] = "COALESCE(`$column`,'')=?";
            $params[] = (string)($identity[$column] ?? '');
        }
        // Compare the original database values, not formatted table text. These
        // additional details distinguish cases even when imported IDs and case
        // numbers are repeated. Never interpolate client-provided column names.
        foreach (['patient_address', 'complete_diagnosis', 'date_time_performed',
            'facility_name', 'facility_address', 'facility_contact_number',
            'supervisor_printed_name', 'supervisor_contact_number',
            'supervisor_position_designation', 'supervisor_license_no',
            'supervisor_license_expiry_date', 'created_at'] as $column) {
            if (!array_key_exists($column, $identity)) continue;
            if ($identity[$column] === null) {
                $where[] = "`$column` IS NULL";
            } else {
                $where[] = "`$column`=?";
                $params[] = (string)$identity[$column];
            }
        }
    }
    if ($owner !== null) {
        $where[] = 'student_id=?';
        $params[] = $owner;
    }
    return [implode(' AND ', $where), $params];
}
