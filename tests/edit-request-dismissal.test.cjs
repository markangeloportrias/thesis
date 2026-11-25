const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const student = fs.readFileSync(path.join(__dirname, '../student.html'), 'utf8');
const start = student.indexOf('      function getEditRequestStatus(rec)');
const code = student.slice(start, student.indexOf('      function setEditRequestStatus', start));
const request = {
  studentId: 'S1', type: 'delivery-handled', status: 'approved',
  requestedAt: '2026-11-25T10:00:00Z', student_dismissed_at: '2026-11-25 10:01:00',
};
const context = vm.createContext({
  localStorage: { getItem: () => '{}' },
  getProcedureRecordReviewStatus: () => 'needs_revision',
  getCaseKey: () => 'case-1', getCurrentStudentId: () => 'S1',
  normalizeProcedureKey: value => value, editRequestMatchesRecord: () => true,
  PhilippineTime: { parse: Date.parse }, activeProcedureKey: 'delivery-handled',
  liveEditRequestsLoaded: true, liveEditRequestsCache: [request],
});
vm.runInContext(code, context);
assert.equal(context.getEditRequestStatus({}), 'accepted', 'Dismissal must preserve unused approval');
request.consumed_at = '2026-11-25 10:02:00';
assert.equal(context.getEditRequestStatus({}), '', 'Saving the edit consumes approval');
delete request.consumed_at;
context.liveEditRequestsCache.unshift({ ...request, status: 'pending', requestedAt: '2026-11-25T11:00:00Z' });
assert.equal(context.getEditRequestStatus({}), '', 'A cancelled newer request must not revive an older approval');
context.liveEditRequestsCache[0].student_dismissed_at = null;
assert.equal(context.getEditRequestStatus({}), 'requested', 'Active pending requests show the pending state');

const client = fs.readFileSync(path.join(__dirname, '../assets/js/api-client.js'), 'utf8');
const clientStart = client.indexOf('  ApiClient.getEditRequests = async');
const paths = [];
const api = vm.createContext({ ApiClient: {}, URLSearchParams,
  mysqlRequest: async url => { paths.push(url); return { requests: [] }; },
});
vm.runInContext(client.slice(clientStart, client.indexOf('  ApiClient.archiveEditRequest =', clientStart)), api);
(async () => {
  await api.ApiClient.getEditRequests();
  await api.ApiClient.getEditRequests({ includeDismissed: true });
  assert.deepEqual(paths, ['edit-requests', 'edit-requests?include_dismissed=1']);
  console.log('PASS: dismissed approvals remain usable, consumed approvals expire, and notification reads stay separate');
})().catch(error => { console.error(error); process.exitCode = 1; });
