<?php
declare(strict_types=1);
require __DIR__ . '/../api/record-validation.php';

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
$fields = ['case_no','patient_name','patient_address','complete_diagnosis','date_time_performed','facility_name','facility_address','facility_contact_number','supervisor_printed_name','supervisor_contact_number','supervisor_position_designation','supervisor_license_no','supervisor_license_expiry_date'];
$complete = array_fill_keys($fields, 'Filled');
check(missingClinicalFields($complete) === [], 'Complete record should pass.');
check(count(missingClinicalFields([])) === 13, 'All missing fields should be reported.');
foreach (['', ' ', null, 'N/A', '-', '0000-00-00', '0000-00-00 00:00:00'] as $value) {
    $record = $complete;
    $record['supervisor_license_expiry_date'] = $value;
    check(missingClinicalFields($record) === ['License expiry date'], 'Blank and placeholder values must prevent verification.');
}
echo "PASS: server completeness validation and placeholder rejection\n";
