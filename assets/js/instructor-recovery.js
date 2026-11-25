(() => {
  'use strict';
  const link = document.getElementById('instructorForgotPassword');
  if (!link) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'instructorRecoveryModal';
  overlay.innerHTML = `
    <section class="modal-content" role="dialog" aria-modal="true" aria-labelledby="instructorRecoveryTitle">
      <button type="button" class="modal-close" aria-label="Close password recovery">&times;</button>
      <h2 id="instructorRecoveryTitle">Forgot Instructor Password</h2>
      <p class="recovery-description">Enter the recovery email registered by your administrator.</p>
      <form>
        <div class="input-container recovery-email"><div class="input-field-wrapper">
          <i class="fas fa-envelope input-icon" aria-hidden="true"></i>
          <input id="instructorRecoveryEmail" type="email" autocomplete="email" maxlength="254" placeholder=" " required>
          <label for="instructorRecoveryEmail">Recovery Email</label>
        </div></div>
        <div class="input-container recovery-code" hidden><div class="input-field-wrapper">
          <i class="fas fa-key input-icon" aria-hidden="true"></i>
          <input id="instructorRecoveryCode" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" minlength="8" maxlength="8" placeholder=" ">
          <label for="instructorRecoveryCode">8-digit Recovery Code</label>
        </div></div>
        <div class="recovery-passwords" hidden>
          <div class="input-container"><div class="input-field-wrapper">
            <i class="fas fa-lock input-icon" aria-hidden="true"></i>
            <input id="instructorRecoveryPassword" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder=" ">
            <label for="instructorRecoveryPassword">New Password</label>
            <button type="button" class="password-toggle-btn" data-recovery-password="instructorRecoveryPassword" aria-controls="instructorRecoveryPassword" aria-label="Show new password" aria-pressed="false"><i class="fas fa-eye" aria-hidden="true"></i></button>
          </div></div>
          <div class="input-container"><div class="input-field-wrapper">
            <i class="fas fa-lock input-icon" aria-hidden="true"></i>
            <input id="instructorRecoveryConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder=" ">
            <label for="instructorRecoveryConfirm">Confirm New Password</label>
            <button type="button" class="password-toggle-btn" data-recovery-password="instructorRecoveryConfirm" aria-controls="instructorRecoveryConfirm" aria-label="Show confirm password" aria-pressed="false"><i class="fas fa-eye" aria-hidden="true"></i></button>
          </div></div>
        </div>
        <p class="message" role="status" aria-live="polite" hidden></p>
        <button type="submit" class="btn btn-primary modal-btn">Send Recovery Code</button>
        <button type="button" class="btn modal-btn recovery-restart" hidden>Request another code</button>
      </form>
    </section>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  const email = overlay.querySelector('input[type=email]');
  const code = overlay.querySelector('#instructorRecoveryCode');
  const restart = overlay.querySelector('.recovery-restart');
  const password = overlay.querySelector('#instructorRecoveryPassword');
  const confirm = overlay.querySelector('#instructorRecoveryConfirm');
  const submit = overlay.querySelector('[type=submit]');
  const message = overlay.querySelector('[role=status]');
  let token = '';
  let busy = false;
  let step = 'email';
  const passwordToggles = [...overlay.querySelectorAll('[data-recovery-password]')];
  function setPasswordVisible(button, visible) {
    const input = overlay.querySelector('#' + button.dataset.recoveryPassword);
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', (visible ? 'Hide ' : 'Show ') + (input === password ? 'new password' : 'confirm password'));
    button.querySelector('i').className = visible ? 'fas fa-eye-slash' : 'fas fa-eye';
  }
  passwordToggles.forEach(button => button.addEventListener('click', () => {
    setPasswordVisible(button, button.getAttribute('aria-pressed') !== 'true');
  }));
  function showStep(next) {
    step = next;
    passwordToggles.forEach(button => setPasswordVisible(button, false));
    const titles = {email: 'Forgot Instructor Password', code: 'Verify Recovery Code', password: 'Reset Instructor Password', done: 'Password Reset Complete'};
    const descriptions = {email: 'Enter the recovery email registered by your administrator.', code: 'Enter the 8-digit code sent to ' + email.value.trim() + '. It expires in 10 minutes.', password: 'Code verified. Choose a new password with at least 8 characters.', done: 'You can now sign in to your instructor account with your new password.'};
    overlay.querySelector('h2').textContent = titles[step];
    overlay.querySelector('.recovery-description').textContent = descriptions[step];
    overlay.querySelector('.recovery-email').hidden = step !== 'email';
    email.disabled = step !== 'email';
    overlay.querySelector('.recovery-code').hidden = step !== 'code';
    code.disabled = step !== 'code';
    code.required = step === 'code';
    overlay.querySelector('.recovery-passwords').hidden = step !== 'password';
    password.disabled = confirm.disabled = step !== 'password';
    password.required = confirm.required = step === 'password';
    submit.textContent = {email:'Send Recovery Code',code:'Verify Code',password:'Reset Password',done:'Back to Sign In'}[step];
    submit.disabled = false;
    restart.hidden = step !== 'code';
    ({email, code, password, done:submit}[step]).focus();
  }
  function open(resetToken = '') {
    token = resetToken;
    form.reset();
    message.hidden = true;
    message.style.display = 'none';
    document.getElementById('instructorModal').classList.remove('active');
    overlay.classList.add('active');
    showStep(token ? 'password' : 'email');
  }
  function close() {
    if (busy) return;
    token = '';
    form.reset();
    overlay.classList.remove('active');
    document.getElementById('instructorModal').classList.add('active');
    document.getElementById('instructorUsernameInput').focus();
  }
  link.addEventListener('click', event => { event.preventDefault(); open(); });
  restart.addEventListener('click', () => {
    if (busy) return;
    token = '';
    code.value = password.value = confirm.value = '';
    message.hidden = true;
    message.style.display = 'none';
    showStep('email');
  });
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button,input')].filter(el => !el.disabled && el.offsetParent !== null);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    if (step === 'done') { close(); return; }
    message.hidden = false;
    message.style.display = 'block';
    message.className = 'message error';
    if (token && password.value !== confirm.value) { message.textContent = 'Passwords do not match.'; return; }
    if (token && new TextEncoder().encode(password.value).length > 72) { message.textContent = 'Password is too long. Use at most 72 bytes.'; return; }
    busy = true;
    submit.disabled = true;
    message.textContent = token ? 'Resetting password…' : 'Sending request…';
    try {
      const result = step === 'password'
        ? await ApiClient.resetInstructorPassword(token, password.value)
        : step === 'code'
          ? await ApiClient.verifyInstructorRecoveryCode(email.value.trim(), code.value.trim())
          : await ApiClient.requestInstructorPasswordReset(email.value.trim());
      message.textContent = result.message || 'Unable to complete the request. Please try again.';
      message.className = result.ok ? 'message success' : 'message error';
      if (result.ok) {
        if (step === 'email') showStep('code');
        else if (step === 'code') {
          if (!/^[a-f0-9]{64}$/.test(result.token || '')) throw new Error('Invalid reset response');
          token = result.token;
          code.value = '';
          showStep('password');
        } else {
          token = '';
          form.reset();
          showStep('done');
        }
      } else {
        submit.disabled = false;
        if (step === 'email') window.alert(message.textContent);
      }
    } catch (_) {
      message.textContent = 'Unable to connect. Please try again.';
      submit.disabled = false;
    } finally { busy = false; }
  });
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('instructor-reset')) {
    const resetToken = hash.get('instructor-reset');
    history.replaceState(null, '', location.pathname + location.search);
    if (/^[a-f0-9]{64}$/.test(resetToken)) open(resetToken);
    else { open(); message.hidden = false; message.style.display = 'block'; message.textContent = 'Invalid reset link. Request a recovery code below.'; }
  }
})();
