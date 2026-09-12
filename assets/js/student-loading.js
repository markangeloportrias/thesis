(function () {
  'use strict';
  var pending = new Map();
  var timer = null;
  var panel = document.createElement('div');
  panel.className = 'student-loading-status';
  panel.hidden = true;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-atomic', 'true');
  var spinner = document.createElement('span');
  spinner.className = 'student-loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  var label = document.createElement('span');
  panel.append(spinner, label);
  document.body.appendChild(panel);

  function render() {
    label.textContent = Array.from(pending.values()).some(Boolean)
      ? 'Saving changes…' : 'Loading data…';
  }
  window.StudentLoading = {
    begin: function (path, options) {
      // Routine connection/version checks should not flash a loading message.
      if (/^(health|sync-state)(\?|$)/.test(path)) return function () {};
      var mutation = !/^(GET|HEAD|OPTIONS)$/.test(String(options.method || 'GET').toUpperCase());
      // Admin tables provide their own loading/empty states. A global popup for
      // reads can outlive the visible table when another background read is slow.
      if (!mutation && document.body.classList.contains('role-admin')) return function () {};
      var key = {};
      var button = mutation && document.activeElement && document.activeElement.closest('button');
      var wasDisabled = button && button.disabled;
      if (button && !wasDisabled) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('student-button-loading');
      }
      pending.set(key, mutation);
      render();
      if (timer === null && panel.hidden) {
        timer = window.setTimeout(function () {
          timer = null;
          if (pending.size) panel.hidden = false;
        }, 200);
      }
      var finished = false;
      return function () {
        if (finished) return;
        finished = true;
        pending.delete(key);
        if (button && !wasDisabled) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.classList.remove('student-button-loading');
        }
        if (!pending.size) {
          window.clearTimeout(timer);
          timer = null;
          panel.hidden = true;
          label.textContent = '';
        } else render();
      };
    }
  };
})();
