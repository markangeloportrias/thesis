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
