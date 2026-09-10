const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/api-client.js'), 'utf8');
const start = source.indexOf('  ApiClient.approveEditRequest =');
const code = source.slice(start, source.indexOf('  ApiClient.rejectEditRequest =', start));
const requests = [
  { id: 0, student_id: 'S1', procedure_key: 'delivery assisted', case_numbers: '["001"]', requested_at: '2026-09-10 10:00:00' },
  { id: 0, student_id: 'S1', procedure_key: 'delivery assisted', case_numbers: '["003"]', requested_at: '2026-09-10 11:00:00' },
];
const writes = [];
const context = vm.createContext({ ApiClient: {}, mysqlRequest: async (path, options) => {
  if (!options) return { ok: true, requests };
  writes.push({ path, body: JSON.parse(options.body) });
  return { ok: true };
} });
vm.runInContext(code, context);
(async () => {
  assert.equal((await context.ApiClient.approveEditRequest(0, '003')).ok, true);
  assert.equal(writes[0].path, 'edit-requests/0/approve');
  assert.equal(writes[0].body.request_identity.case_numbers, '["003"]');
  assert.equal(writes[0].body.request_identity.requested_at, requests[1].requested_at);
  assert.equal((await context.ApiClient.approveEditRequest(0)).ok, false);
  requests.push({ ...requests[1], student_id: 'S2' });
  assert.equal((await context.ApiClient.approveEditRequest(0, '003')).ok, false);
  assert.equal(writes.length, 1, 'Ambiguous requests must never be approved');
  console.log('PASS: zero-ID approval selects case details and rejects ambiguous requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
