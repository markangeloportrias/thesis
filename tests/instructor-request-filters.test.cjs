const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../instructor.html'), 'utf8');
let rows = ['pending', 'approved', 'rejected', 'approved'].map(status => ({ dataset: { requestStatus: status }, style: {} }));
const buttons = ['pending', 'approved', 'rejected', 'all'].map(status => ({ dataset: { requestFilter: status }, setAttribute(key, value) { this[key] = value; } }));
const empty = {};
const context = vm.createContext({ document: {
  querySelectorAll: selector => selector.includes('.request-item') ? rows : buttons,
  getElementById: () => empty,
} });
const start = source.indexOf('      let instructorRequestFilter =');
vm.runInContext(source.slice(start, source.indexOf("      document.getElementById('instructor-request-filters')", start)), context);
for (const [filter, count] of [['pending', 1], ['approved', 2], ['rejected', 1], ['all', 4]]) {
  vm.runInContext(`instructorRequestFilter = '${filter}'; applyInstructorRequestFilter();`, context);
  assert.equal(rows.filter(row => row.style.display === '').length, count);
  assert.equal(buttons.find(button => button.dataset.requestFilter === filter)['aria-pressed'], 'true');
  assert.equal(empty.hidden, true);
}
assert.equal(buttons[1].textContent, 'Approved 2');
rows[0].dataset.requestStatus = 'approved';
vm.runInContext("instructorRequestFilter = 'pending'; applyInstructorRequestFilter();", context);
assert.equal(empty.hidden, false);
assert.equal(buttons[0].textContent, 'Pending 0');
assert.equal(buttons[1].textContent, 'Approved 3');
rows = [];
vm.runInContext('applyInstructorRequestFilter();', context);
assert.equal(empty.hidden, false);
assert.equal(buttons[1].textContent, 'Approved 0');
console.log('PASS: all instructor filters, counts, selected state, decision changes and empty results');
