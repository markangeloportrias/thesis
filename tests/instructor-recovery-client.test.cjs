const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/api-client.js'), 'utf8');
const calls = [];
let failure = false;
const context = vm.createContext({
  ApiClient: {}, JSON,
  mysqlRequest: async (path, options) => {
    calls.push({path, body: JSON.parse(options.body), method: options.method});
    if (failure) throw new Error('Recovery is not configured');
    return {ok: true, message: 'Complete'};
  },
});
const start = source.indexOf('  ApiClient.createInstructorAccount = async function');
vm.runInContext(source.slice(start, source.indexOf('  ApiClient.setInstructorStatus =', start)), context);
(async () => {
  await context.ApiClient.createInstructorAccount('teacher', 'Password123', 'Teacher', 'teacher@example.com');
  assert.equal(calls[0].body.email, 'teacher@example.com');
  await context.ApiClient.updateInstructorAccount('teacher/1', {email: 'new@example.com'});
  assert.equal(calls[1].path, 'instructors/teacher%2F1');
  assert.equal(calls[1].body.email, 'new@example.com');
  await context.ApiClient.requestInstructorPasswordReset('teacher@example.com');
  assert.equal(calls[2].path, 'auth/instructor-forgot-password');
  assert.equal(calls[2].method, 'POST');
  const token = 'a'.repeat(64);
  await context.ApiClient.resetInstructorPassword(token, 'NewPassword123');
  assert.equal(calls[3].path, 'auth/instructor-reset-password');
  assert.equal(calls[3].body.token, token);
  assert.equal(calls[3].body.password, 'NewPassword123');
  failure = true;
  const result = await context.ApiClient.requestInstructorPasswordReset('teacher@example.com');
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Recovery is not configured');
  console.log('PASS: admin recovery email payloads, reset endpoints, and error propagation');
})().catch(error => { console.error(error); process.exitCode = 1; });
