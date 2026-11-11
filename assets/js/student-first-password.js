(function () {
  'use strict';
  window.requireStudentPasswordChange = function (session) {
    if (!session.must_change_password) return Promise.resolve();
    return new Promise((resolve) => {
      const panel = document.createElement('dialog');
      panel.setAttribute('aria-labelledby', 'firstPasswordTitle');
      panel.style.cssText = 'width:min(460px,90vw);box-sizing:border-box;border:1px solid #bdd3ed;border-radius:18px;padding:28px;color:#123663;background:white;box-shadow:0 20px 80px #12366355;';
      panel.innerHTML = `
        <form>
          <h2 id="firstPasswordTitle" style="margin:0 0 12px;font-size:24px">Change your default password</h2>
          <p style="line-height:1.5">For your account security, set a new password before continuing to your dashboard.</p>
          <label style="display:block;font-weight:700;margin-top:16px" for="firstCurrentPassword">Current password</label>
          <input id="firstCurrentPassword" type="password" autocomplete="current-password" required style="width:100%;box-sizing:border-box;padding:12px;margin-top:6px;border:1px solid #a7bfdc;border-radius:8px">
          <label style="display:block;font-weight:700;margin-top:16px" for="firstNewPassword">New password</label>
          <input id="firstNewPassword" type="password" autocomplete="new-password" minlength="6" required style="width:100%;box-sizing:border-box;padding:12px;margin-top:6px;border:1px solid #a7bfdc;border-radius:8px">
          <small>Use at least 6 characters, different from your default password.</small>
          <label style="display:block;font-weight:700;margin-top:16px" for="firstConfirmPassword">Confirm new password</label>
          <input id="firstConfirmPassword" type="password" autocomplete="new-password" minlength="6" required style="width:100%;box-sizing:border-box;padding:12px;margin-top:6px;border:1px solid #a7bfdc;border-radius:8px">
          <p role="alert" style="color:#9b241c;font-weight:600"></p>
          <button type="submit" style="width:100%;padding:13px;border:0;border-radius:8px;background:#084c91;color:white;font-weight:700;font-size:16px">Save password and continue</button>
        </form>`;
      panel.addEventListener('cancel', (event) => event.preventDefault());
      document.body.appendChild(panel);
      panel.showModal();
      const form = panel.querySelector('form');
      const button = panel.querySelector('button');
      const error = panel.querySelector('[role="alert"]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (button.disabled) return;
        const current = panel.querySelector('#firstCurrentPassword').value;
        const password = panel.querySelector('#firstNewPassword').value;
        error.textContent = '';
        if (password !== panel.querySelector('#firstConfirmPassword').value) {
          error.textContent = 'New passwords do not match.';
          return;
        }
        if (password === 'midwife' + session.user_uid) {
          error.textContent = 'Choose a password different from your default password.';
          return;
        }
        button.disabled = true;
        button.textContent = 'Saving password…';
        try {
          const result = await ApiClient.changeStudentInitialPassword(current, password);
          if (!result?.ok) throw new Error(result?.message || 'Unable to change password.');
          panel.close();
          panel.remove();
          resolve();
        } catch (failure) {
          error.textContent = failure.message || 'Unable to change password. Please try again.';
        } finally {
          button.disabled = false;
          button.textContent = 'Save password and continue';
        }
      });
    });
  };
})();
