const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseStudentsCsv, mount } = require('../assets/js/admin-student-import.js');

test('CSV preserves IDs, Unicode names, commas and escaped quotes', () => {
  assert.deepEqual(parseStudentsCsv('\uFEFFstudent_id,student_name\r\n001234,"Dela Cruz, Ana"\r\n123456,"José ""Pepe"" Santos"\r\n'), [
    { student_id: '001234', student_name: 'Dela Cruz, Ana', password: 'midwife001234' },
    { student_id: '123456', student_name: 'José "Pepe" Santos', password: 'midwife123456' },
  ]);
});

test('CSV rejects invalid files before any account is created', () => {
  for (const input of [
    '', 'student_id,student_name\n', 'id,name\n123456,Ana',
    'student_id,student_name\n12345,Ana',
    'student_id,student_name\n123456,',
    'student_id,student_name\n123456,Ana,Extra',
    'student_id,student_name\n123456,"Ana',
    'student_id,student_name\n123456,"Ana"oops',
    'student_id,student_name\n' + Array.from({ length: 101 }, (_, i) => `${100000 + i},Student`).join('\n'),
  ]) assert.throws(() => parseStudentsCsv(input));
});

test('import snapshots the block, continues after duplicate failure, and refreshes once', async () => {
  const elements = {};
  for (const id of ['importStudentsCsvBtn', 'studentsCsvFile', 'studentsCsvReport']) {
    elements[id] = { listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } };
  }
  global.document = { getElementById: id => elements[id] };
  const context = { blockId: 'block-a', schoolYear: '2025-2026', blockLabel: 'Block A' };
  const calls = [];
  let refreshes = 0;
  let popupMessage = '';
  mount({
    getContext: () => context,
    confirm: async () => { context.blockId = 'block-b'; return true; },
    create: async (block, student) => {
      calls.push([block.blockId, student]);
      return { ok: student.student_id !== '123456', message: 'That record already exists.' };
    },
    refresh: async () => { refreshes++; },
    showResults: async (message) => { popupMessage = message; },
  });
  elements.studentsCsvFile.files = [{ name: 'students.csv', size: 100, text: async () => 'student_id,student_name\n123456,Ana\n001234,Bea\n001234,Bea Again' }];
  try {
    await elements.studentsCsvFile.listeners.change();
    assert.equal(calls.length, 2);
    assert.ok(calls.every(([block]) => block === 'block-a'));
    assert.equal(calls[1][1].password, 'midwife001234');
    assert.equal(refreshes, 1);
    assert.match(elements.studentsCsvReport.textContent, /Imported: 1. Not imported: 2/);
    assert.match(elements.studentsCsvReport.textContent, /123456 - Ana: Already exists/);
    assert.match(elements.studentsCsvReport.textContent, /001234 - Bea: Added/);
    assert.match(elements.studentsCsvReport.textContent, /001234 - Bea Again: Duplicate ID/);
    assert.equal(elements.studentsCsvReport.hidden, true);
    assert.equal(popupMessage, elements.studentsCsvReport.textContent);
    assert.equal(elements.importStudentsCsvBtn.disabled, false);
  } finally { delete global.document; }
});
