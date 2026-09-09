<?php
declare(strict_types=1);

function missingClinicalFields(array $record): array
{
    $fields = [
        'case_no' => 'Case number', 'patient_name' => 'Patient name', 'patient_address' => 'Patient address',
        'complete_diagnosis' => 'Complete diagnosis', 'date_time_performed' => 'Date and time performed',
        'facility_name' => 'Facility name', 'facility_address' => 'Facility address',
        'facility_contact_number' => 'Facility contact number', 'supervisor_printed_name' => 'Supervisor name',
        'supervisor_contact_number' => 'Supervisor contact number',
        'supervisor_position_designation' => 'Position / designation', 'supervisor_license_no' => 'License number',
        'supervisor_license_expiry_date' => 'License expiry date',
    ];
    $missing = [];
    foreach ($fields as $key => $label) {
        $value = trim((string)($record[$key] ?? ''));
        if ($value === '' || preg_match('/^(?:n\/?a|-|0{4}-0{2}-0{2}(?:[ T]00:00:00)?)$/i', $value)) $missing[] = $label;
    }
    return $missing;
}
