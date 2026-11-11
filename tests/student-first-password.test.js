const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
  const fields = {};
  for (const selector of ['form', 'button', '[role="alert"]', '#firstCurrentPassword', '#firstNewPassword', '#firstConfirmPassword']) {
    fields[selector] = { value: '', listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  }
  const panel = {
    style: {}, listeners: {}, setAttribute() {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelector(selector) { return fields[selector]; },
    showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.removed = true; },
  };
  let calls = 0;
  let response = { ok: true };
  const context = {
    window: {}, document: { body: { appendChild() {} }, createElement() { return panel; } },
    ApiClient: { async changeStudentInitialPassword(current, password) {
      calls++;
      assert.equal(current, 'midwife001234');
      assert.equal(password, 'Changed123!');
      return response;
    } },
  };
  vm.runInNewContext(fs.readFileSync('assets/js/student-first-password.js', 'utf8'), context);
  return { panel, fields, context, get calls() { return calls; }, fail() { response = { ok: false, message: 'Current password is incorrect.' }; } };
}

test('custom-password accounts do not see the panel', async () => {
  const app = setup();
  await app.context.window.requireStudentPasswordChange({ must_change_password: false });
  assert.equal(app.panel.open, undefined);
  assert.equal(app.calls, 0);
});

test('required panel blocks Escape, mismatches and default reuse; resolves only after saving', async () => {
  const app = setup();
  const done = app.context.window.requireStudentPasswordChange({ must_change_password: true, user_uid: '001234' });
  assert.equal(app.panel.open, true);
  let prevented = false;
  app.panel.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.doesNotMatch(app.panel.innerHTML, /type="button"|Cancel|Logout/);
  const submit = () => app.fields.form.listeners.submit({ preventDefault() {} });
  app.fields['#firstCurrentPassword'].value = 'midwife001234';
  app.fields['#firstNewPassword'].value = 'Changed123!';
  app.fields['#firstConfirmPassword'].value = 'Different';
  await submit();
  assert.equal(app.calls, 0);
  assert.match(app.fields['[role="alert"]'].textContent, /do not match/);
  app.fields['#firstNewPassword'].value = app.fields['#firstConfirmPassword'].value = 'midwife001234';
  await submit();
  assert.equal(app.calls, 0);
  app.fields['#firstNewPassword'].value = app.fields['#firstConfirmPassword'].value = 'Changed123!';
  await submit();
  await done;
  assert.equal(app.calls, 1);
  assert.equal(app.panel.removed, true);
});

test('server failures leave the required panel open and allow retry', async () => {
  const app = setup();
  app.fail();
  app.context.window.requireStudentPasswordChange({ must_change_password: true, user_uid: '001234' });
  app.fields['#firstCurrentPassword'].value = 'midwife001234';
  app.fields['#firstNewPassword'].value = app.fields['#firstConfirmPassword'].value = 'Changed123!';
  await app.fields.form.listeners.submit({ preventDefault() {} });
  assert.equal(app.panel.open, true);
  assert.equal(app.fields.button.disabled, false);
  assert.match(app.fields['[role="alert"]'].textContent, /incorrect/);
});
