// Run only against a disposable, seeded local database: this creates test data.
// Set PORTAL_TEST_URL and PORTAL_TEST_ADMIN_PIN before running.
const assert = require('node:assert/strict');
const base = process.env.PORTAL_TEST_URL;
const pin = process.env.PORTAL_TEST_ADMIN_PIN;
if (!base || !pin || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  throw new Error('A disposable localhost PORTAL_TEST_URL and PORTAL_TEST_ADMIN_PIN are required.');
}
async function request(path, method = 'GET', body, token, expected = 200) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, expected, path + ': ' + JSON.stringify(result));
  if (expected < 400) assert.equal(result.ok, true, path + ': ' + JSON.stringify(result));
  return result;
}
(async () => {
  await request('health');
  const admin = (await request('auth/admin', 'POST', { pin_number: pin })).token;
  const suffix = Date.now().toString();
  const years = (await request('school-years', 'GET', undefined, admin)).years;
  if (!years.some(y => y.label === '2026-2027')) await request('school-years', 'POST', { label: '2026-2027' }, admin, 201);
  const block = await request('blocks', 'POST', { label: 'Test ' + suffix, school_year: '2026-2027' }, admin, 201);
  const username = 'test_' + suffix;
  await request('instructors', 'POST', { username, password: 'Workflow-Test-123', display_name: 'Test Instructor' }, admin, 201);
  const instructorLogin = await request('auth/instructor', 'POST', { username, password: 'Workflow-Test-123' });
  const teacher = instructorLogin.token;
  const student = { student_id: 'T' + suffix, student_name: 'Test Student', parent_name: 'Test Guardian', password: 'Workflow-Test-123', contact_number: '09123456789', block_id: block.id };
  await request('students', 'POST', { ...student, student_id: 'F' + suffix, block_id: 2147483647 }, teacher, 422);
  assert.equal((await request('students/F' + suffix, 'GET', undefined, teacher)).student, null, 'Failed enrollment must not leave an account');
  await request('students', 'POST', student, teacher, 201);
  await request('students', 'POST', student, teacher, 409);
  const roster = (await request('assignments?block_id=' + block.id, 'GET', undefined, teacher)).students;
  assert.equal(roster.filter(s => s.student_id === student.student_id).length, 1);
  const studentToken = (await request('auth/student', 'POST', { student_id: student.student_id, password: student.password })).token;
  const record = {
    student_id: student.student_id, procedure_key: 'delivery-handled', academic_year: '2026-2027', case_no: '001',
    patient_name: 'Test Patient', patient_address: 'Test Address', complete_diagnosis: 'Test Diagnosis',
    date_time_performed: '2026-09-10 10:30:00', facility_name: 'Test Facility', facility_address: 'Test Address',
    facility_contact_number: '09123456789', supervisor_printed_name: 'Test Supervisor', supervisor_contact_number: '09123456789',
    supervisor_position_designation: 'Midwife', supervisor_license_no: '123456', supervisor_license_expiry_date: '2028-01-01',
  };
  const saved = await request('cases', 'POST', record, studentToken, 201);
  await request('cases', 'POST', record, studentToken, 409);
  assert.equal((await request('cases', 'GET', undefined, studentToken)).cases.length, 1);
  const identity = { student_id: record.student_id, procedure_key: record.procedure_key, case_no: record.case_no, patient_name: record.patient_name, academic_year: record.academic_year };
  const reviewBody = { status: 'Verified', record_identity: identity, instructor_id: instructorLogin.user.id, instructor_name: 'Test Instructor' };
  await request('cases/resolve/review', 'PATCH', reviewBody, studentToken, 403);
  await request('cases/resolve/review', 'PATCH', { ...reviewBody, record_identity: { ...identity, academic_year: '2000-2001' } }, teacher, 404);
  await request('cases/resolve/review', 'PATCH', reviewBody, teacher);
  assert.equal((await request('cases', 'GET', undefined, studentToken)).cases[0].record_status, 'verified');
  await request('cases/' + saved.id + '/review', 'PATCH', { status: 'Verified', instructor_id: instructorLogin.user.id, instructor_name: 'Test Instructor' }, teacher);
  assert.equal((await request('cases', 'GET', undefined, studentToken)).cases[0].record_status, 'verified');
  await request('cases/' + saved.id + '/archive', 'PATCH', {}, teacher);
  assert.equal((await request('cases', 'GET', undefined, studentToken)).cases.length, 0);
  await request('cases/' + saved.id + '/restore', 'PATCH', {}, teacher);
  const edit = await request('edit-requests', 'POST', { procedure_key: 'delivery-handled', procedure_name: 'Delivery Handled', case_numbers: ['001'] }, studentToken, 201);
  await request('edit-requests/' + edit.id + '/approve', 'PATCH', {}, teacher);
  await request('edit-requests/' + edit.id + '/approve', 'PATCH', {}, teacher);
  const notices = (await request('notifications', 'GET', undefined, studentToken)).notifications;
  assert.equal(notices.filter(n => String(n.request_id) === String(edit.id)).length, 1);
  await request('students/' + student.student_id + '/archive', 'PATCH', {}, teacher);
  await request('auth/session', 'GET', undefined, studentToken, 401);
  assert.equal((await request('assignments?block_id=' + block.id, 'GET', undefined, teacher)).students.length, 0);
  await request('students/' + student.student_id + '/restore', 'PATCH', {}, teacher);
  assert.equal((await request('assignments?block_id=' + block.id, 'GET', undefined, teacher)).students.length, 1);
  console.log('PASS: restricted database permissions, atomic student enrollment, duplicate prevention, verification, case/student archive and restore, session revocation, approval notifications');
})().catch(error => { console.error(error); process.exitCode = 1; });
