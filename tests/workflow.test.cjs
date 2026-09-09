const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(read('assets/js/record-quality.js'), context);
const quality = context.window.RecordQuality;
const complete = {
  student_id: 'S1', case_no: '001', patient_name: 'Test Patient', patient_address: 'Test Address',
  complete_diagnosis: 'Test diagnosis', date_time_performed: '2026-07-20 08:09:00',
  facility_name: 'Test Facility', facility_address: 'Test Facility Address', facility_contact_number: '09123456789',
  supervisor_printed_name: 'Test Supervisor', supervisor_contact_number: '09987654321',
  supervisor_position_designation: 'Midwife', supervisor_license_no: '123456', supervisor_license_expiry_date: '2028-01-20',
  record_status: 'verified',
};
const required = { 'delivery-handled': 20, 'delivery-assisted': 20, suturing: 5, 'iv-insertion': 5, 'internal-exam': 20 };
const records = Object.entries(required).flatMap(([procedure_key, count]) => Array.from({ length: count }, (_, index) => ({ ...complete, id: `${procedure_key}-${index}`, procedure_key, case_no: String(index + 1) })));
assert.equal(quality.exportSelection(records, false).length, 70);
assert.throws(() => quality.exportSelection(records.slice(1), false), /19 \/ 20/);
assert.throws(() => quality.exportSelection(records.map((r, i) => i ? r : { ...r, record_status: 'needs_revision', checked_by: 'Teacher' }), false), /19 \/ 20/);
assert.throws(() => quality.exportSelection(records.map((r, i) => i ? r : { ...r, patient_address: ' ' }), false), /19 \/ 20/);
assert.equal(quality.exportSelection([], true).length, 0);
assert.equal(quality.exportSelection(records.slice(0, 1), true).length, 1);
assert.equal(quality.exportSelection([{ ...records[0], record_status: 'invalid', id: 'invalid' }, ...records], false).some((r) => r.id === 'invalid'), false);

function sourceFunction(file, name) {
  const source = read(file);
  const start = source.search(new RegExp(`      (?:async )?function ${name}\\(`));
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n      }', start) + 8);
}
function element(tag) {
  return {
    tag, children: [], value: '', listeners: {},
    append(child) { this.children.push(child); },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
    remove() { this.removed = true; },
    reportValidity() { return true; },
    get elements() { return this.children.flatMap((label) => label.children); },
  };
}
async function testExports() {
  let fetches = 0;
  context.window.ApiClient = {
    getJoinedCases: async () => { fetches++; return [...records, { ...records[0], student_id: 'OTHER' }]; },
    getStudent: async () => ({ ok: true, student: { student_id: 'S1', student_name: 'Fresh Name' } }),
  };
  const snapshot = await quality.prepareExport('S1', false);
  assert.equal(snapshot.student.student_name, 'Fresh Name');
  assert.equal(snapshot.records.length, 70);
  await quality.prepareExport('S1', true);
  assert.equal(fetches, 2, 'Every download must fetch current records');
  context.window.ApiClient.getJoinedCases = async () => records.map((r, i) => i ? r : { ...r, archived_at: '2026-09-06' });
  await assert.rejects(quality.prepareExport('S1', false), /19 \/ 20/);
  context.window.ApiClient.getJoinedCases = async () => { throw new Error('Network unavailable'); };
  await assert.rejects(quality.prepareExport('S1', true), /Network unavailable/);
  context.window.ApiClient.getJoinedCases = async () => records;
  context.window.ApiClient.getStudent = async () => ({ ok: false, message: 'Profile unavailable' });
  await assert.rejects(quality.prepareExport('S1', false), /Profile unavailable/);
}
async function testAdminMutations() {
  let saved, archived, form, refreshed = 0;
  const messages = [];
  const editContext = vm.createContext({
    document: { createElement: element },
    ApiClient: {
      getJoinedCases: async () => [{ ...complete, id: 1 }],
      updateCaseRecord: async (id, payload) => { saved = { id, payload }; return { ok: true }; },
      deleteCaseRecord: async (student, id) => { archived = id; return { ok: true }; },
    },
    optionPaneMessage: { after(node) { form = node; node.elements.find((input) => input.name === 'case_no').value = '002'; } },
    optionPaneYes: element('button'),
    showOptionPane: async () => true,
    showMessageDialog: async (...args) => messages.push(args),
    renderCases: async () => { refreshed++; }, refreshOverview() {}, loadAdminActivityLog: async () => {},
    readJson() { throw new Error('Browser storage must not be used'); },
    writeJson() { throw new Error('Browser storage must not be used'); },
  });
  for (const name of ['editCase', 'deleteCase']) vm.runInContext(sourceFunction('admin-dashboard.html', name), editContext);
  await editContext.editCase(1);
  assert.equal(saved.id, 1);
  assert.equal(saved.payload.case_no, '002');
  assert.equal(saved.payload.facility_name, complete.facility_name);
  assert.equal(Object.keys(saved.payload).length, 13, 'All editable fields must reach the API');
  assert.equal(form.removed, true);
  await editContext.deleteCase(1);
  assert.equal(archived, 1);
  assert.equal(refreshed, 2);
  editContext.ApiClient.updateCaseRecord = async () => ({ ok: false, message: 'Database save failed' });
  await editContext.editCase(1);
  assert.equal(refreshed, 2, 'Failed saves must not report a successful refresh');
  assert.equal(messages.at(-1)[0], 'Database save failed');
  editContext.ApiClient.deleteCaseRecord = async () => ({ ok: false, message: 'Archive failed' });
  await editContext.deleteCase(1);
  assert.equal(messages.at(-1)[0], 'Archive failed');
  assert.equal(refreshed, 2);
}
async function testVerificationGate() {
  let called = false, message;
  const reviewContext = vm.createContext({
    currentReviewRecord: {}, RecordQuality: quality,
    showOptionMessage: (...args) => { message = args; },
    ApiClient: { updateRecordStatus: async () => { called = true; } },
  });
  vm.runInContext(sourceFunction('instructor.html', 'runRecordReviewAction'), reviewContext);
  await reviewContext.runRecordReviewAction('Verified');
  assert.equal(called, false);
  assert.equal(message[0], 'Record Incomplete');
}
async function testMessageBox() {
  class FakeNode {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
    append(...items) { this.children.push(...items); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    remove() { this.removed = true; }
    focus() { this.focused = true; }
    setAttribute() {}
  }
  const body = new FakeNode();
  const fakeDocument = {
    body,
    createElement: () => new FakeNode(),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  const messageContext = vm.createContext({ window: {}, document: fakeDocument });
  vm.runInContext(read('assets/js/record-quality.js'), messageContext);
  const pending = messageContext.window.RecordQuality.notify('<unsafe>', 'Download Failed');
  assert.equal(body.children.length, 1);
  const overlay = body.children[0];
  const dialog = overlay.children[0];
  assert.equal(dialog.children[0].textContent, 'Download Failed');
  assert.equal(dialog.children[1].textContent, '<unsafe>');
  const okButton = dialog.children[2].children[0];
  okButton.listeners.click();
  await pending;
  assert.equal(overlay.removed, true);
}
(async () => {
  await testExports();
  await testAdminMutations();
  await testVerificationGate();
  await testMessageBox();
  console.log('PASS: verified requirements, draft selection, fresh data, failed refreshes, student isolation, database save/archive and incomplete verification gate');
})().catch((error) => { console.error(error); process.exitCode = 1; });
