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
        <div class="recovery-passwords" hidden>
          <div class="input-container"><div class="input-field-wrapper">
            <i class="fas fa-lock input-icon" aria-hidden="true"></i>
            <input id="instructorRecoveryPassword" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder=" ">
            <label for="instructorRecoveryPassword">New Password</label>
          </div></div>
          <div class="input-container"><div class="input-field-wrapper">
            <i class="fas fa-lock input-icon" aria-hidden="true"></i>
            <input id="instructorRecoveryConfirm" type="password" autocomplete="new-password" minlength="8" maxlength="72" placeholder=" ">
            <label for="instructorRecoveryConfirm">Confirm New Password</label>
          </div></div>
        </div>
        <p class="message" role="status" aria-live="polite" hidden></p>
        <button type="submit" class="btn btn-primary modal-btn">Send Reset Link</button>
      </form>
    </section>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  const email = overlay.querySelector('input[type=email]');
  const password = overlay.querySelector('#instructorRecoveryPassword');
  const confirm = overlay.querySelector('#instructorRecoveryConfirm');
  const submit = overlay.querySelector('[type=submit]');
  const message = overlay.querySelector('[role=status]');
  let token = '';
  let busy = false;
  function open(resetToken = '') {
    token = resetToken;
    form.reset();
    message.hidden = true;
    message.style.display = 'none';
    overlay.querySelector('h2').textContent = token ? 'Reset Instructor Password' : 'Forgot Instructor Password';
    overlay.querySelector('.recovery-description').textContent = token ? 'Choose a new password with at least 8 characters (maximum 72 bytes).' : 'Enter the recovery email registered by your administrator.';
    overlay.querySelector('.recovery-email').hidden = !!token;
    email.disabled = !!token;
    overlay.querySelector('.recovery-passwords').hidden = !token;
    password.required = confirm.required = !!token;
    password.disabled = confirm.disabled = !token;
    submit.disabled = false;
    submit.textContent = token ? 'Reset Password' : 'Send Reset Link';
    document.getElementById('instructorModal').classList.remove('active');
    overlay.classList.add('active');
    (token ? password : email).focus();
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
    message.hidden = false;
    message.style.display = 'block';
    message.className = 'message error';
    if (token && password.value !== confirm.value) { message.textContent = 'Passwords do not match.'; return; }
    if (token && new TextEncoder().encode(password.value).length > 72) { message.textContent = 'Password is too long. Use at most 72 bytes.'; return; }
    busy = true;
    submit.disabled = true;
    message.textContent = token ? 'Resetting password…' : 'Sending request…';
    try {
      const result = token
        ? await ApiClient.resetInstructorPassword(token, password.value)
        : await ApiClient.requestInstructorPasswordReset(email.value.trim());
      message.textContent = result.message || 'Unable to complete the request. Please try again.';
      message.className = result.ok ? 'message success' : 'message error';
      if (result.ok) {
        token = '';
        form.reset();
        submit.textContent = 'Request Complete';
      } else submit.disabled = false;
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
    else { open(); message.hidden = false; message.style.display = 'block'; message.textContent = 'Invalid reset link. Request a new link below.'; }
  }
})();
