const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../student.html'), 'utf8');
const storage = new Map();
const record = (year, status = 'Submitted') => ({
  id: 0, caseNo: '001', procedureKey: 'delivery-handled', status,
  recordIdentity: { student_id: 'S1', procedure_key: 'delivery handled', case_no: '001',
    academic_year: year, patient_name: 'Patient', complete_diagnosis: year },
});
const first = record('2025-2026');
const second = record('2026-2027');
const locked = record('2024-2025', 'Verified');
const request = { studentId: 'S1', type: 'delivery handled', caseNumbers: ['001'],
  status: 'pending', record_identity: JSON.stringify(first.recordIdentity) };
const context = vm.createContext({
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  deliveryRecords: [first, second, locked], activeProcedureKey: 'delivery-handled',
  normalizeProcedureKey: value => String(value).replaceAll(' ', '-'),
  getCurrentStudentId: () => 'S1',
  getProcedureRecordReviewStatus: rec => rec.status.toLowerCase(),
  liveEditRequestsLoaded: true, liveEditRequestsCache: [request],
  PhilippineTime: { parse: value => new Date(value) },
});
vm.runInContext(source.slice(source.indexOf('      function getCaseKey('), source.indexOf('      function clearCancelledEditRequest(')), context);
assert.notEqual(context.getCaseKey(first), context.getCaseKey(second));
assert.equal(context.getEditRequestStatus(first), 'requested');
assert.equal(context.getEditRequestStatus(second), '');
context.liveEditRequestsCache = [{ ...request, status: 'approved', consumed_at: '2026-10-20 12:00:00' }];
assert.equal(context.getEditRequestStatus(first), '', 'Used approval cannot expose edit action');
const correction = { ...first, status: 'needs_revision' };
assert.equal(context.getEditRequestStatus(correction), 'accepted', 'Instructor-requested changes allow correction');
assert.equal(context.getEditRequestStatus({ ...correction, checkedBy: 'Instructor' }), '', 'Verification lock takes precedence');
assert.equal(context.getEditRequestStatus(locked), '');
assert.equal(context.editRequestMatchesRecord({ ...request, record_identity: null }, first), false);
context.setEditRequestStatus(second, 'requested');
assert.equal(context.getEditRequestStatus(second), '', 'Authoritative state overrides phantom local pending');
context.liveEditRequestsCache = [{ ...request, status: 'approved' }];
assert.equal(context.getEditRequestStatus(first), 'accepted');
assert.equal(context.getEditRequestStatus(second), '');

// Execute the real click handler with a deferred API response: no optimistic
// pending state, no success dialog on rejection, and identity sent unchanged.
const start = source.indexOf('buttons[1]?.addEventListener("click", async () => {');
const end = source.indexOf('          buttons[2]?.addEventListener', start);
let click;
let resolveRequest;
let saved = 0;
let refreshed = 0;
let payload;
const dialogs = [];
const button = { disabled: false, addEventListener: (_, handler) => { click = handler; } };
Object.assign(context, {
  buttons: [{}, button], rec: second, requestStatus: '',
  PROCEDURE_CONFIGS: { 'delivery-handled': { procedureName: 'Delivery Handled' } },
  activeProcedureConfig: {},
  ApiClient: { requestEditApproval: (...args) => {
    payload = args;
    return new Promise(resolve => { resolveRequest = resolve; });
  } },
  setEditRequestStatus: () => { saved++; },
  loadActiveWorkspaceRecords: async () => { refreshed++; },
  showOptionPane: dialog => dialogs.push(dialog),
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  const pending = click();
  assert.equal(button.disabled, true);
  assert.equal(saved, 0);
  assert.equal(dialogs.length, 0);
  assert.equal(payload[3], second.recordIdentity);
  resolveRequest({ ok: false, message: 'Verified clinical records are locked and cannot request edits.' });
  await pending;
  assert.equal(saved, 0);
  assert.equal(refreshed, 1);
  assert.equal(dialogs.at(-1).title, 'Unable to Request Edit');
  assert.equal(button.disabled, false);
  const success = click();
  resolveRequest({ ok: true });
  await success;
  assert.equal(saved, 1);
  assert.equal(refreshed, 2);
  assert.equal(dialogs.at(-1).title, 'Edit Requested');
  console.log('PASS: identity isolation, legacy ambiguity, verified locks, failed and successful submissions');
})().catch(error => { console.error(error); process.exitCode = 1; });
