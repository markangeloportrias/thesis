const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const qualityStyles = read('assets/css/components/record-quality.css');
assert.match(qualityStyles, /\.btn, \.primary, \.secondary, \.option-pane-btn/);
assert.match(qualityStyles, /min-height: 36px !important;\s*height: 36px !important/);
assert.match(qualityStyles, /\.messages-composer \.btn \{ min-height: 48px/);
assert.match(qualityStyles, /button\[style\*="display: none"\][\s\S]*display: none !important/);
assert.match(qualityStyles, /background: #dcecf6 !important/);
assert.match(qualityStyles, /color: #111827 !important/);
assert.match(qualityStyles, /\.progress-next-step button \{ display: none !important; \}/);
const pages = ['student.html', 'instructor.html', 'admin-dashboard.html'];
for (const file of pages) {
  for (const match of read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1], { filename: file });
  }
}
function element() {
  return {
    children: [], dataset: {}, attributes: {}, style: {}, classList: { add() {} }, value: '', textContent: '', innerHTML: '',
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, fn) { this[type] = fn; },
  };
}
const elements = new Map();
const document = { createElement: element, getElementById: (id) => {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
} };
const context = vm.createContext({ window: {}, document });
vm.runInContext(read('assets/js/record-quality.js'), context);
const quality = context.window.RecordQuality;
assert.equal(typeof quality.notify, 'function');
assert.equal(quality.missing({}).length, 13);
const complete = Object.fromEntries(['case_no', 'patient_name', 'patient_address', 'complete_diagnosis', 'date_time_performed', 'facility_name', 'facility_address', 'facility_contact_number', 'supervisor_printed_name', 'supervisor_contact_number', 'supervisor_position_designation', 'supervisor_license_no', 'supervisor_license_expiry_date'].map(key => [key, 'Filled']));
assert.equal(quality.missing(complete).length, 0);
assert.deepEqual(Array.from(quality.missing({ ...complete, patient_name: ' ', supervisor_license_expiry_date: '0000-00-00' })), ['Patient name', 'License expiry date']);
assert.equal(quality.status({ record_status: 'needs_revision', checked_by: 'Teacher' }), 'needs_revision');
assert.equal(quality.status({ checked_by: 'Teacher' }), 'verified');
const feedback = '<img src=x onerror=alert(1)>';
assert.equal(quality.reviewPanel({ ...complete, teacher_remarks: feedback }).children.at(-1).textContent, `Instructor feedback: ${feedback}`);
function sourceFunction(file, name) {
  const source = read(file);
  const start = source.search(new RegExp(`      (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n      }', start);
  return source.slice(start, end + 8);
}
context.normalizeText = (value) => String(value || '').trim().toLowerCase();
context.editRequestsSearchInput = { value: '' };
context.editRequestsStatusFilter = { value: 'pending' };
context.adminEditRequests = [
  { studentId: 'S1', status: 'pending', caseNumbers: ['001'] },
  { studentId: 'S2', status: 'approved', caseNumbers: ['002'] },
  { studentId: 'S1', status: 'rejected', caseNumbers: ['003'] },
];
vm.runInContext(sourceFunction('admin-dashboard.html', 'getEditRequestsFiltered'), context);
assert.equal(context.getEditRequestsFiltered().length, 1);
context.editRequestsStatusFilter.value = '';
context.editRequestsSearchInput.value = 'S1';
assert.equal(context.getEditRequestsFiltered().length, 2);
context.editRequestsSearchInput.value = '002';
assert.equal(context.getEditRequestsFiltered()[0].status, 'approved');
context.escapeHtml = (s) => String(s).replaceAll('<', '&lt;');
context.adminActivityLoadError = '';
context.adminActivityEntries = [
  { actor_name: 'Alice', actor_role: 'instructor', action_name: 'review', created_at: '2026-09-05 12:00:00' },
  { actor_name: 'Bob', actor_role: 'admin', action_name: 'archive', created_at: '2026-09-04 12:00:00' },
];
for (const name of ['activityEntityLabel', 'activityActionLabel', 'activityDetails', 'renderAuditLog']) vm.runInContext(sourceFunction('admin-dashboard.html', name), context);
document.getElementById('auditFromFilter').value = '2026-09-05';
document.getElementById('auditToFilter').value = '2026-09-05';
context.renderAuditLog();
assert.equal(document.getElementById('auditLogTbody').children.length, 1);
assert.ok(document.getElementById('auditLogTbody').children[0].innerHTML.includes('Alice'));
document.getElementById('auditPersonFilter').value = 'nobody';
context.renderAuditLog();
assert.equal(document.getElementById('auditLogEmpty').textContent, 'No activity matches these filters.');
context.getProcedureRecordReviewStatus = quality.status;
context.createProcedureProgressMetric = (options) => options;
vm.runInContext(sourceFunction('student.html', 'createProcedureProgressGroup'), context);
const group = context.createProcedureProgressGroup([{ status: 'Verified' }, { status: 'Submitted' }], 20, 'Delivery Handled');
assert.equal(group.children[0].count, 1, 'Submitted records must not count as completed');
assert.equal(group.children.length, 2, 'Use one progress bar and one supporting line');
assert.equal(group.children[0].maximum, 20, 'Verified progress is measured against the requirement');
assert.ok(group.children.at(-1).textContent.includes('19 remaining'));
assert.equal(group.children.at(-1).children.length, 0, 'Progress line must not leak a redundant View records action');
const finished = context.createProcedureProgressGroup([{ status: 'Verified' }], 1, 'Delivery Handled');
assert.equal(finished.children.at(-1).children.length, 0);
context.sidebarCountRequests = element();
context.toggleArchivedEditRequestsBtn = element();
context.renderEditRequests = () => {};
context.showMessageDialog = () => { throw new Error('Unexpected request load error'); };
for (const name of ['updatePendingRequestCounts', 'loadAdminEditRequests']) vm.runInContext(sourceFunction('admin-dashboard.html', name), context);
async function testPendingCounts() {
  context.viewingArchivedEditRequests = false;
  context.ApiClient = { getEditRequests: async () => [{ status: 'pending' }, { status: 'approved' }] };
  await context.loadAdminEditRequests();
  for (const id of ['dashboardRequestsValue', 'dashboardPendingBadge']) assert.equal(document.getElementById(id).textContent, '1');
  assert.equal(context.sidebarCountRequests.textContent, '1');
  assert.equal(document.getElementById('dashboardPendingBadge').hidden, false);
  context.viewingArchivedEditRequests = true;
  context.ApiClient.getEditRequests = async () => [];
  await context.loadAdminEditRequests();
  assert.equal(context.sidebarCountRequests.textContent, '1', 'Archives must not clear active counts');
  let resolve;
  context.ApiClient.getEditRequests = () => new Promise((done) => { resolve = done; });
  const staleLoad = context.loadAdminEditRequests();
  context.viewingArchivedEditRequests = false;
  const active = [{ status: 'pending', id: 'active' }];
  context.adminEditRequests = active;
  resolve([{ id: 'archived' }]);
  await staleLoad;
  assert.equal(context.adminEditRequests, active, 'A stale archive response must not replace active records');
}
testPendingCounts().then(() => console.log('PASS: syntax, field checks, feedback safety, request filters/counts, stale responses, activity filters, verified progress and navigation')).catch((error) => { console.error(error); process.exitCode = 1; });
