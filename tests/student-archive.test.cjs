const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../student.html'), 'utf8');
const start = source.indexOf('      async function archiveStudentClinicalRecord(');
const fn = source.slice(start, source.indexOf('\n      }', start) + 8);
async function run(id, rows = [], response = { ok: true }) {
  const calls = [], messages = [];
  let refreshes = 0;
  const context = vm.createContext({
    getCurrentStudentId: () => 'S1', normalizeProcedureKey: value => value,
    ApiClient: {
      request: async () => ({ ok: true, cases: rows }),
      deleteCaseRecord: async (...args) => { calls.push(args); return response; },
    },
    loadActiveWorkspaceRecords: async () => { refreshes++; },
    showOptionPane: message => messages.push(message),
  });
  vm.runInContext(fn, context);
  await context.archiveStudentClinicalRecord({ id, procedureKey: 'delivery-assisted', caseNo: '003', patientName: 'Patient', academicYear: '2026-2027' });
  return { calls, messages, refreshes };
}
(async () => {
  for (const id of [0, '0', 12]) {
    const result = await run(id);
    assert.equal(result.calls[0][1], id);
    assert.equal(result.refreshes, 1);
    assert.equal(result.messages[0].title, 'Record Archived');
  }
  const failed = await run(12, [], { ok: false, message: 'Database operation failed.' });
  assert.equal(failed.refreshes, 0);
  assert.equal(failed.messages[0].title, 'Unable to Archive');
  const row = { id: 0, student_id: 'S1', procedure_key: 'delivery-assisted', case_no: '003', patient_name: 'Patient', academic_year: '2026-2027' };
  const recovered = await run('', [row]);
  assert.equal(recovered.calls[0][1], 0);
  for (const rows of [[], [row, { ...row, id: 2 }], [{ ...row, student_id: 'OTHER' }], [{ ...row, academic_year: '2025-2026' }]]) {
    const result = await run('', rows);
    assert.equal(result.calls.length, 0);
    assert.equal(result.refreshes, 0);
    assert.equal(result.messages[0].title, 'Unable to Archive');
  }
  console.log('PASS: archive persistence, zero IDs, missing-ID recovery, failure feedback and ambiguous/wrong-record rejection');
})().catch(error => { console.error(error); process.exitCode = 1; });
