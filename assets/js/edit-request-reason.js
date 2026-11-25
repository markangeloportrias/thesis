(() => {
  const style = document.createElement('style');
  style.textContent = `.edit-reason-panel{position:fixed;inset:0;margin:auto;width:min(480px,calc(100vw - 32px));box-sizing:border-box;max-height:90vh;overflow:auto;padding:28px;border:1px solid #bed5ed;border-radius:22px;background:#fff;color:#073572;box-shadow:0 24px 70px #001b4440;font-family:inherit}.edit-reason-panel::backdrop{background:#04193980;backdrop-filter:blur(5px)}.edit-reason-panel h2{margin:0 0 16px;font-size:23px}.edit-reason-panel p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.edit-reason-panel textarea{display:block;box-sizing:border-box;width:100%;min-height:140px;margin:12px 0;padding:12px;border:1px solid #acc9e8;border-radius:10px;font:inherit;resize:vertical}.edit-reason-panel footer{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.edit-reason-panel button,.edit-reason-button{padding:10px 14px;border:1px solid #9dbde0;border-radius:9px;background:#edf5ff;color:#073572;font:inherit;cursor:pointer}.edit-reason-panel button[type=submit]{background:#ffd000;font-weight:700}.edit-reason-button{font-size:13px;margin:4px}.edit-reason-panel button:focus-visible{outline:3px solid #236eb4}`;
  document.head.appendChild(style);
  function panel(reason, editable) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'edit-reason-panel';
      dialog.setAttribute('aria-label', editable ? 'Reason for edit request' : 'Student edit request reason');
      dialog.innerHTML = `<form><h2>${editable ? 'Request Record Edit' : 'Edit Request Reason'}</h2>${editable ? '<label>Why does this record need editing?<textarea required maxlength="2000" placeholder="Describe what needs to be corrected and why."></textarea></label>' : '<p></p>'}<footer><button type="button">${editable ? 'Cancel' : 'Close'}</button>${editable ? '<button type="submit">Submit Request</button>' : ''}</footer></form>`;
      if (!editable) dialog.querySelector('p').textContent = reason || 'No reason was provided for this older request.';
      let value = null;
      dialog.querySelector('button[type=button]').onclick = () => dialog.close();
      dialog.querySelector('form').onsubmit = event => {
        event.preventDefault();
        const input = dialog.querySelector('textarea');
        if (!input) return;
        input.setCustomValidity(input.value.trim() ? '' : 'Please enter a reason.');
        if (!input.reportValidity()) return;
        value = input.value.trim();
        dialog.close();
      };
      dialog.querySelector('textarea')?.addEventListener('input', event => event.target.setCustomValidity(''));
      dialog.addEventListener('close', () => { dialog.remove(); previous?.focus(); resolve(value); }, {once:true});
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }
  window.EditRequestReason = {
    ask: () => panel('', true),
    button(container, reason) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'edit-reason-button';
      button.innerHTML = '<i class="fas fa-comment-alt" aria-hidden="true"></i> Reason';
      button.onclick = event => { event.stopPropagation(); panel(reason, false); };
      container.prepend(button);
    }
  };
})();
