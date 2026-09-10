const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../admin-dashboard.html'), 'utf8');
const start = source.indexOf('      let notificationsLoadVersion =');
const end = source.indexOf('      function deleteNotification(', start);
const pending = [];
const context = vm.createContext({
  viewingArchivedNotifications: false, adminNotifications: [],
  ApiClient: { getNotificationHistory: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
  renderNotifications() {}, showMessageDialog: async () => {},
  sidebarCountNotifications: { style: {} }, notificationsEmpty: { style: {} }, notificationsResultsSummary: {},
});
vm.runInContext(source.slice(start, end), context);
(async () => {
  const old = context.loadAdminNotifications();
  context.viewingArchivedNotifications = true;
  const latest = context.loadAdminNotifications();
  pending[1].resolve([{ id: 0, message: 'Archived request' }]); await latest;
  pending[0].resolve([{ id: 5, message: 'Stale active request' }]); await old;
  assert.equal(context.adminNotifications[0].message, 'Archived request');
  const failed = context.loadAdminNotifications();
  pending[2].reject(new Error('Database unavailable')); await failed;
  assert.equal(context.notificationsEmpty.textContent, 'Database unavailable');
  assert.equal(context.notificationsResultsSummary.textContent, 'Notifications could not be loaded.');
  console.log('PASS: notification view race protection and explicit loading errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
