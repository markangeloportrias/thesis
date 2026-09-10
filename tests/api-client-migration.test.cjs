const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/api-client.js'), 'utf8');
let response;
let calls = [];
let expired = false;
let storedToken = 'test-session';
const context = vm.createContext({
  Map, Date, Error, Object, JSON,
  location: { protocol: 'https:' },
  sessionStorage: { getItem: () => storedToken, removeItem: () => { storedToken = ''; } },
  window: { setTimeout() {}, dispatchEvent() { expired = true; } },
  CustomEvent: function (name) { this.type = name; },
  fetch: async (url, options) => { calls.push({ url, options }); return response; },
  ApiClient: {},
});
vm.runInContext(source.slice(source.indexOf('  var pendingMutationRequests'), source.indexOf('  async function mysqlLogin')), context);
const start = source.indexOf('  ApiClient.registerStudentInBlock = async function');
vm.runInContext(source.slice(start, source.indexOf('  ApiClient.archiveStudent =', start)), context);
const jsonResponse = (status, value) => ({ status, ok: status < 400, json: async () => value });
(async () => {
  response = { status: 200, ok: true, json: async () => { throw new Error('HTML from hosting'); } };
  await assert.rejects(context.mysqlRequest('students'), /invalid API response/);
  response = jsonResponse(200, {});
  await assert.rejects(context.mysqlRequest('cases'), /invalid API response/);
  response = jsonResponse(401, { ok: false, message: 'Session expired' });
  await assert.rejects(context.mysqlRequest('students'), /Session expired/);
  assert.equal(expired, true);
  assert.equal(storedToken, '');
  storedToken = 'test-session';
  response = jsonResponse(201, { ok: true, student_id: 'T1' });
  calls = [];
  assert.equal((await context.ApiClient.registerStudentInBlock(12, '2026-2027', { student_id: 'T1' })).ok, true);
  assert.equal(calls.length, 1, 'Account and enrollment must use a single HTTP mutation');
  assert.equal(calls[0].url, 'api/students');
  assert.equal(JSON.parse(calls[0].options.body).block_id, 12);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-session');
  assert.equal((await context.ApiClient.registerStudentInBlock(12, '2026-2027', { student_id: 'T1' })).ok, false);
  assert.equal(calls.length, 1, 'Rapid duplicate submission must not reach the server');
  response = jsonResponse(503, { ok: false, message: 'Temporarily unavailable' });
  await assert.rejects(context.mysqlRequest('students', { method: 'POST', body: '{"student_id":"T2"}' }), /Temporarily unavailable/);
  response = jsonResponse(201, { ok: true });
  assert.equal((await context.mysqlRequest('students', { method: 'POST', body: '{"student_id":"T2"}' })).ok, true, 'A failed request must remain retryable');
  console.log('PASS: invalid hosting responses, session expiry, atomic enrollment, duplicate click guard and failed-request retry');
})().catch(error => { console.error(error); process.exitCode = 1; });
