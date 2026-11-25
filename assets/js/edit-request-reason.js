(() => {
  const style = document.createElement('style');
  style.textContent = `
    html body dialog.edit-reason-panel{position:fixed;inset:0;margin:auto;width:min(520px,calc(100vw - 32px));box-sizing:border-box;max-height:90vh;overflow:auto;padding:0;border:1px solid #c8d9ed;border-radius:16px;background:#fff;color:#073572;box-shadow:0 24px 70px #001b4433;font-family:Inter,Arial,sans-serif}
    .edit-reason-panel::backdrop{background:#061b3a66;backdrop-filter:blur(3px)}
    html body .edit-reason-panel form{display:block;margin:0;padding:0}
    html body .edit-reason-panel .reason-header{display:flex;align-items:center;gap:12px;padding:22px 24px;border-bottom:1px solid #e0e9f4;background:#fff}
    .edit-reason-panel .reason-icon{display:grid;place-items:center;flex-shrink:0;width:42px;height:42px;border-radius:12px;background:#ffd000;color:#003f88;font-size:18px}
    html body .edit-reason-panel h2{margin:0;color:#073572;font-size:20px;font-weight:800;line-height:1.3;letter-spacing:-.4px}
    html body .edit-reason-panel .reason-subtitle{margin:5px 0 0;color:#6b7f99;font-size:12px;font-weight:400;line-height:1.5}
    .edit-reason-panel .reason-body{padding:22px 24px}
    html body .edit-reason-panel .reason-label{display:block;margin:0 0 10px;color:#24415f;font-size:12px;font-weight:700;line-height:1.5;text-transform:none;letter-spacing:0}
    html body .edit-reason-panel textarea{display:block;box-sizing:border-box;width:100%;min-height:135px;margin:0;padding:13px 14px;border:1px solid #bfd1e6;border-radius:10px;background:#f9fbfe;color:#193b64;font:400 14px/1.65 Inter,Arial,sans-serif;resize:vertical;box-shadow:none}
    html body .edit-reason-panel textarea::placeholder{color:#8a9bb1;font-size:13px;font-weight:400}
    html body .edit-reason-panel textarea:focus{outline:none;border-color:#00509d;box-shadow:0 0 0 3px #00509d15;background:#fff}
    html body .edit-reason-panel .reason-text{margin:0;padding:16px;border:1px solid #dce6f2;border-left:3px solid #ffd000;border-radius:9px;background:#f7faff;color:#24415f;font-size:14px;font-weight:400;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}
    html body .edit-reason-panel .reason-hint{margin:10px 0 0;color:#6b7f99;font-size:11px;line-height:1.5}
    html body .edit-reason-panel footer{display:flex;justify-content:flex-end;gap:10px;margin:0;padding:16px 24px;border-top:1px solid #e0e9f4;background:#f8fafd}
    html body .edit-reason-panel footer button{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:88px;height:38px;margin:0;padding:0 16px;border:1px solid #c2d3e7!important;border-radius:8px;background:#fff!important;color:#24415f!important;font:700 12px/1 Inter,Arial,sans-serif!important;box-shadow:none!important;cursor:pointer}
    html body .edit-reason-panel footer button:hover{background:#eaf1f9!important}
    html body .edit-reason-panel footer button.reason-primary{border-color:#ffd000!important;background:#ffd000!important;color:#073572!important}
    html body .edit-reason-panel footer button.reason-primary:hover{border-color:#ecc100!important;background:#ecc100!important}
    .edit-reason-panel button:focus-visible{outline:3px solid #236eb4;outline-offset:3px}
    .edit-reason-button{padding:10px 14px;border:1px solid #9dbde0;border-radius:9px;background:#edf5ff;color:#073572;font:inherit;font-size:13px;margin:4px;cursor:pointer}
    @media(max-width:480px){html body .edit-reason-panel .reason-header{padding:18px;gap:10px}html body .edit-reason-panel h2{font-size:18px}.edit-reason-panel .reason-body{padding:18px}html body .edit-reason-panel footer{padding:14px 18px}}
  `;
  document.head.appendChild(style);
  function panel(reason, editable) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const dialog = document.createElement('dialog');
      dialog.className = 'edit-reason-panel';
      dialog.setAttribute('aria-label', editable ? 'Reason for edit request' : 'Student edit request reason');
      dialog.innerHTML = `<form><header class="reason-header"><span class="reason-icon" aria-hidden="true"><i class="fas ${editable ? 'fa-pen' : 'fa-comment-dots'}"></i></span><div><h2>${editable ? 'Request Record Edit' : 'Edit Request Reason'}</h2><p class="reason-subtitle">${editable ? 'Send a correction request to your instructor.' : 'Reason provided by the student.'}</p></div></header><div class="reason-body">${editable ? '<label class="reason-label" for="edit-request-reason-input">What needs to be corrected?</label><textarea id="edit-request-reason-input" required maxlength="2000" placeholder="Explain which details need changing and why." aria-describedby="edit-request-reason-hint"></textarea><p class="reason-hint" id="edit-request-reason-hint">Your request will remain pending until your instructor reviews it.</p>' : '<div class="reason-label">Submitted reason</div><p class="reason-text"></p>'}</div><footer><button type="button" class="${editable ? '' : 'reason-primary'}">${editable ? 'Cancel' : 'Close'}</button>${editable ? '<button type="submit" class="reason-primary"><i class="fas fa-paper-plane" aria-hidden="true"></i> Submit Request</button>' : ''}</footer></form>`;
      if (!editable) dialog.querySelector('.reason-text').textContent = reason || 'No reason was provided for this older request.';
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
    button(container, reason, className = 'edit-reason-button') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.innerHTML = '<i class="fas fa-comment-alt" aria-hidden="true"></i> Reason';
      button.onclick = event => { event.stopPropagation(); panel(reason, false); };
      container.prepend(button);
    }
  };
})();
