const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../instructor.html'), 'utf8');
const start = source.indexOf('      async function runRecordReviewAction(');
const fn = source.slice(start, source.indexOf('\n      }', start) + 8);
async function review(record, result = { ok: true }) {
  const calls = [], messages = [];
  let refreshed = false;
  const context = vm.createContext({
    currentReviewRecord: record, currentInstructor: { id: 'I1' }, currentInstructorName: 'Instructor',
    RecordQuality: { missing: () => [] }, normalizeProcedureKey: value => String(value).toLowerCase().replace(/ /g, '-'),
    showOptionConfirm: async () => true, showOptionMessage: (...args) => messages.push(args),
    ApiClient: { updateRecordStatus: async (...args) => { calls.push(args); return result; } },
    closeDetailModal() {}, loadRecords: async () => { refreshed = true; }, refreshDashboardCounts: async () => {},
  });
  vm.runInContext(fn, context);
  await context.runRecordReviewAction('Verified');
  return { calls, messages, refreshed };
}
(async () => {
  const identity = { student_id: 'S1', procedure_key: 'delivery-handled', case_no: '001', patient_name: 'Patient', academic_year: '2026-2027' };
  for (const id of [42, '42', 0, '0']) {
    const result = await review({ ...identity, id });
    assert.equal(result.calls[0][0], id);
    assert.equal(result.refreshed, true);
  }
  const alias = await review({ ...identity, case_id: 57 });
  assert.equal(alias.calls[0][0], 57);
  for (const id of [undefined, '', 'legacy-local-id', -1]) {
    const result = await review({ ...identity, id });
    assert.equal(result.calls[0][0], 'resolve');
    assert.deepEqual(JSON.parse(JSON.stringify(result.calls[0][2].record_identity)), identity);
    assert.equal(result.refreshed, true);
  }
  const ambiguous = await review(identity, { ok: false, message: 'More than one clinical record matches' });
  assert.equal(ambiguous.refreshed, false);
  assert.equal(ambiguous.messages[0][1], 'More than one clinical record matches');
  console.log('PASS: review IDs, ID aliases, zero IDs, missing-ID server resolution and ambiguous-match feedback');
})().catch(error => { console.error(error); process.exitCode = 1; });
