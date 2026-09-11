const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../student.html'), 'utf8');
const start = source.indexOf('      function correctionRequestStatus(');
const end = source.indexOf('      function closeStudentChatMenus(', start);
const rows = [];
const requests = ['approved', 'rejected', 'pending'].map((status, i) => ({
  id: 0, studentId: 'S1', student_id: 'S1', procedureKey: 'delivery assisted',
  procedure_key: 'delivery assisted', caseNo: '001', caseNumbers: ['001'],
  case_numbers: '["001"]', requested_at: `2026-09-0${i + 1}`, status,
}));
const container = { innerHTML: '', querySelector: () => ({ appendChild: row => rows.push(row) }) };
const badge = { style: {} };
const context = vm.createContext({
  ApiClient: { getEditRequests: async () => requests },
  getCurrentStudentId: () => 'S1', escapeHtml: value => value,
  document: {
    getElementById: id => id === 'editRequestsContent' ? container : badge,
    createElement: () => {
      const button = { setAttribute() {} };
      return { querySelector: () => button, addEventListener() {}, button };
    },
  },
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  await context.renderEditRequests();
  assert.match(rows[0].innerHTML, /Approved by instructor/);
  assert.match(rows[1].innerHTML, /Rejected by instructor/);
  assert.match(rows[2].innerHTML, /Pending instructor review/);
  assert.match(rows[0].button.innerHTML, /Dismiss/);
  assert.match(rows[1].button.innerHTML, /Dismiss/);
  assert.match(rows[2].button.innerHTML, /Cancel Request/);
  assert.equal(badge.textContent, '1');
  // Same case and duplicate database IDs must not merge separate decisions.
  assert.equal(rows.length, 3);
  const client = fs.readFileSync(path.join(__dirname, '../assets/js/api-client.js'), 'utf8');
  const archiveStart = client.indexOf('  ApiClient.archiveEditRequest =');
  const writes = [];
  const api = vm.createContext({ ApiClient: {}, mysqlRequest: async (url, options) => {
    writes.push(JSON.parse(options.body)); return { ok: true };
  } });
  vm.runInContext(client.slice(archiveStart, client.indexOf('  ApiClient.approveEditRequest =', archiveStart)), api);
  await api.ApiClient.cancelEditRequest(0, requests[2]);
  assert.equal(writes[0].request_identity.requested_at, requests[2].requested_at);
  assert.equal(writes[0].request_identity.case_numbers, '["001"]');
  console.log('PASS: correction request decisions, actions, count, and cancellation identity');
})().catch(error => { console.error(error); process.exitCode = 1; });
