const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../student.html'), 'utf8');
const start = source.indexOf('      async function saveDeliveryAssistedRecord(');
const fn = source.slice(start, source.indexOf('\n      }', start) + 8);
const calls = [];
const identity = { student_id: 'S1', case_no: '003', complete_diagnosis: 'Original' };
const context = vm.createContext({
  getCurrentStudentId: () => 'S1', deliveryEditingRecord: { recordIdentity: identity },
  activeProcedureConfig: { procedureName: 'Delivery Assisted' }, showOptionPane() {},
  ApiClient: {
    updateCaseRecord: async (id, data) => { calls.push({ mode: 'update', id, data }); return { ok: true }; },
    saveCaseRecord: async () => { calls.push({ mode: 'create' }); return { ok: true }; },
  },
});
vm.runInContext(fn, context);
(async () => {
  for (const id of [0, '0', 12, 'resolve']) {
    assert.equal(await context.saveDeliveryAssistedRecord({ caseNo: '004', diagnosis: 'Edited' }, id), true);
    assert.equal(calls.at(-1).mode, 'update');
    assert.equal(calls.at(-1).id, id);
    assert.equal(calls.at(-1).data.record_identity, identity);
    assert.equal(calls.at(-1).data.case_no, '004');
  }
  await context.saveDeliveryAssistedRecord({ caseNo: '005' }, null);
  assert.equal(calls.at(-1).mode, 'create');
  console.log('PASS: zero-ID edits use update with original identity; new records still use create');
})().catch(error => { console.error(error); process.exitCode = 1; });
