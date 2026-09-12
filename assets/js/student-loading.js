(function () {
  'use strict';
  var pending = new Map();
  var timer = null;
  var scope = null;
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
    var visible = Array.from(pending.values()).filter(function (request) {
      return request.mutation || request.scope === scope;
    });
    label.textContent = visible.some(function (request) { return request.mutation; })
      ? 'Saving changes…' : 'Loading data…';
    if (!visible.length) {
      window.clearTimeout(timer);
      timer = null;
      panel.hidden = true;
      label.textContent = '';
    } else if (timer === null && panel.hidden) {
      timer = window.setTimeout(function () {
        timer = null;
        panel.hidden = !Array.from(pending.values()).some(function (request) {
          return request.mutation || request.scope === scope;
        });
      }, 200);
    }
  }
  window.StudentLoading = {
    setScope: function (value) {
      scope = value;
      render();
    },
    begin: function (path, options) {
      // Routine connection/version checks should not flash a loading message.
      if (/^(health|sync-state)(\?|$)/.test(path)) return function () {};
      var mutation = !/^(GET|HEAD|OPTIONS)$/.test(String(options.method || 'GET').toUpperCase());
      var key = {};
      var button = mutation && document.activeElement && document.activeElement.closest('button');
      var wasDisabled = button && button.disabled;
      if (button && !wasDisabled) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('student-button-loading');
      }
      pending.set(key, { mutation: mutation, scope: scope });
      render();
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
        render();
      };
    }
  };
})();
