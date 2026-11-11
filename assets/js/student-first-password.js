(function () {
  'use strict';
  window.requireStudentPasswordChange = function (session) {
    if (!session.must_change_password) return Promise.resolve();
    return new Promise((resolve) => {
      const panel = document.createElement('dialog');
      panel.setAttribute('id', 'studentFirstPasswordPanel');
      panel.setAttribute('aria-labelledby', 'firstPasswordTitle');
      panel.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 32px);height:fit-content;overflow-y:auto;box-sizing:border-box;border:1px solid #bdd3ed;border-radius:20px;padding:28px;color:#123663;background:white;box-shadow:0 24px 80px #092b6355;';
      panel.innerHTML = `
        <style>
          #studentFirstPasswordPanel::backdrop { background:rgba(9,30,65,.52); backdrop-filter:blur(4px); }
          #studentFirstPasswordPanel form { margin:0; }
          #studentFirstPasswordPanel h2 { font-size:24px !important; line-height:1.25; margin:0 0 12px; color:#123663; }
          #studentFirstPasswordPanel p { font-size:15px; line-height:1.5; margin:0 0 18px; color:#456080; }
          #studentFirstPasswordPanel label { font-size:14px !important; font-weight:700; color:#123663; }
          #studentFirstPasswordPanel input { font-size:16px !important; line-height:1.4; min-height:46px; background:#f8fbff; color:#123663; box-shadow:none; }
          #studentFirstPasswordPanel input:focus { outline:2px solid #4682b4; outline-offset:2px; }
          #studentFirstPasswordPanel small { display:block; margin-top:8px; font-size:13px; line-height:1.45; color:#456080; }
          #studentFirstPasswordPanel [role="alert"] { margin:12px 0 0; color:#9b241c; }
          #studentFirstPasswordPanel [role="alert"]:empty { display:none; }
          #studentFirstPasswordPanel button { margin-top:22px; min-height:48px; font-size:16px !important; background:#084c91 !important; color:white !important; }
          #studentFirstPasswordPanel button:disabled { opacity:.65; cursor:wait; }
          @media (max-width:480px) { #studentFirstPasswordPanel { padding:22px !important; } }
        </style>
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
