const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const html = fs.readFileSync("student.html", "utf8");
const start = html.indexOf("      const caseDraftFields = [");
const end = html.indexOf("      function clearDeliveryFormInputs()", start);
const fields = {};
const storage = {
  getItem(key) { return this[key] ?? null; },
  setItem(key, value) { this[key] = value; },
  removeItem(key) { delete this[key]; },
};
const context = vm.createContext({
  sessionStorage: storage,
  document: { getElementById(id) { return fields[id] ||= { value: "" }; } },
  deliveryEditingIndex: -1,
  activeProcedureKey: "delivery-handled",
  student: "S1",
});
vm.runInContext("function getCurrentStudentId() { return student; }", context);
vm.runInContext(html.slice(start, end), context);
const run = code => vm.runInContext(code, context);
run("restoreStudentCaseDraft()");
fields.inputPatientName.value = "Draft patient";
run("saveStudentCaseDraft()");
fields.inputPatientName.value = "";
run("restoreStudentCaseDraft()");
assert.equal(fields.inputPatientName.value, "Draft patient");
run('activeProcedureKey = "suturing"; restoreStudentCaseDraft()');
assert.equal(fields.inputPatientName.value, "");
run('activeProcedureKey = "delivery-handled"; student = "S2"; restoreStudentCaseDraft()');
assert.equal(fields.inputPatientName.value, "");
run('student = "S1"; restoreStudentCaseDraft()');
assert.equal(fields.inputPatientName.value, "Draft patient");
run("deliveryEditingIndex = 0; restoreStudentCaseDraft()");
fields.inputPatientName.value = "Existing record";
run("saveStudentCaseDraft(); deliveryEditingIndex = -1; restoreStudentCaseDraft()");
assert.equal(fields.inputPatientName.value, "Draft patient");
run("discardStudentCaseDraft(); restoreStudentCaseDraft()");
assert.equal(fields.inputPatientName.value, "");
fields.inputPatientName.value = "New draft";
run("saveStudentCaseDraft(); clearStudentCaseDrafts(); saveStudentCaseDraft()");
assert.equal(Object.keys(storage).filter(key => key.startsWith("student-case-draft:")).length, 0);
storage.getItem = () => { throw new Error("Storage disabled"); };
storage.setItem = () => { throw new Error("Storage disabled"); };
assert.doesNotThrow(() => run("restoreStudentCaseDraft(); saveStudentCaseDraft(); discardStudentCaseDraft()"));
for (const part of html.split("<script").slice(1)) {
  const body = part.slice(part.indexOf(">") + 1, part.indexOf("</script>"));
  if (body.trim()) new vm.Script(body);
}
console.log("PASS: draft restoration, student/procedure isolation, edit exclusion, cleanup, storage failures, and inline script syntax");
