const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/api-client.js'), 'utf8');
const calls = [];
let token = 'session-a';
let loading = 0;
const context = vm.createContext({
  location: { protocol: 'https:' },
  sessionStorage: { getItem: () => token, removeItem() {} },
  window: {
    setTimeout() {}, dispatchEvent() {},
    StudentLoading: { begin() { loading++; return () => loading--; } },
  },
  CustomEvent: function (type) { this.type = type; },
  fetch(url, options) {
    return new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
  },
});
vm.runInContext(source.slice(source.indexOf('  var pendingMutationRequests'), source.indexOf('  async function mysqlLogin')), context);
const request = context.mysqlRequest;
function respond(index, data = { ok: true, records: [{ id: 1 }] }) {
  calls[index].resolve({ ok: true, status: 200, json: async () => data });
}
(async () => {
  const burst = [request('cases'), request('cases'), request('cases', { silent: true })];
  assert.equal(calls.length, 1, 'Concurrent dashboard reads should make one HTTP request');
  respond(0);
  const results = await Promise.all(burst);
  results[0].records[0].id = 99;
  assert.equal(results[1].records[0].id, 1, 'Each caller must own its records');
  assert.equal(loading, 0, 'All loading indicators must finish');

  for (let i = 0; i < 5; i++) {
    const before = calls.length;
    const reads = [request('cases'), request('cases')];
    assert.equal(calls.length, before + 1, 'Each later refresh must fetch fresh data');
    respond(before);
    await Promise.all(reads);
    assert.equal(context.pendingReadRequests.size, 0, 'Finished reads must not accumulate');
  }

  let before = calls.length;
  const failed = [request('cases'), request('cases')];
  calls[before].reject(new Error('Connection interrupted'));
  assert.ok((await Promise.allSettled(failed)).every(result => result.status === 'rejected'));
  assert.equal(context.pendingReadRequests.size, 0);
  assert.equal(loading, 0);
  const retry = request('cases');
  respond(before + 1);
  await retry;

  before = calls.length;
  const first = request('cases');
  token = 'session-b';
  const otherSession = request('cases');
  assert.equal(calls.length, before + 2, 'Different sessions must not share requests');
  respond(before); respond(before + 1);
  await Promise.all([first, otherSession]);

  before = calls.length;
  const oldRead = request('cases');
  const write = request('cases/1', { method: 'PATCH', body: '{"status":"reviewed"}' });
  respond(before + 1);
  await write;
  const freshRead = request('cases');
  assert.equal(calls.length, before + 3, 'A read after saving must not reuse pre-save data');
  respond(before); respond(before + 2);
  await Promise.all([oldRead, freshRead]);

  before = calls.length;
  const abortable = [request('cases', { signal: {} }), request('cases', { signal: {} })];
  assert.equal(calls.length, before + 2, 'Independently abortable reads must stay separate');
  respond(before); respond(before + 1);
  await Promise.all(abortable);
  assert.equal(loading, 0);
  console.log('PASS: concurrent reads, repeated refresh cleanup, fresh results, isolated data, failure retry, session separation, writes and abort signals');
})().catch(error => { console.error(error); process.exitCode = 1; });
