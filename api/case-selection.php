<?php
declare(strict_types=1);

// Reuse the exact predicate for the locked read and the write. An imported
// database may lack the unique key that normally makes id sufficient.
function caseMutationSelection(string $id, array $identity, ?string $owner = null): array
{
    $where = ['archived_at IS NULL'];
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
    }
    if ($owner !== null) {
        $where[] = 'student_id=?';
        $params[] = $owner;
    }
    return [implode(' AND ', $where), $params];
}
