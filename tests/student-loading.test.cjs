const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function element() { return { hidden: false, children: [], classList: { add() {}, remove() {} }, append(...items) { this.children.push(...items); }, setAttribute() {}, removeAttribute() {}, closest() { return this; } }; }
const body = element(); body.appendChild = item => body.children.push(item);
const timers = new Map(); let next = 0;
const button = element(); button.disabled = false;
const window = { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } };
const context = vm.createContext({ window, document: { body, activeElement: button, createElement: element }, Map });
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../assets/js/student-loading.js'), 'utf8'), context);
const panel = body.children[0];
const first = window.StudentLoading.begin('cases', {});
assert.equal(panel.hidden, true);
const second = window.StudentLoading.begin('students', {});
for (const fn of timers.values()) fn(); timers.clear();
assert.equal(panel.hidden, false);
first(); assert.equal(panel.hidden, false);
second(); assert.equal(panel.hidden, true);
const save = window.StudentLoading.begin('cases/1/archive', { method: 'PATCH' });
assert.equal(button.disabled, true);
assert.equal(panel.children[1].textContent, 'Saving changes\u2026');
save(); save();
assert.equal(button.disabled, false);
assert.equal(panel.hidden, true);
assert.equal(timers.size, 0);
window.StudentLoading.begin('sync-state', {})();
assert.equal(timers.size, 0);
console.log('PASS: delayed loading, overlapping requests, mutation button state, cleanup and silent version polling');

