(function () {
  'use strict';
  var rows = [];
  var pending = null;
  var body = document.getElementById('instructorActivityRows');
  var search = document.getElementById('instructorActivitySearch');
  var status = document.getElementById('instructorActivityStatus');
  var refresh = document.getElementById('instructorActivityRefresh');
  function details(value) {
    try { value = typeof value === 'string' ? JSON.parse(value) : value; } catch (_) {}
    if (!value) return '';
    if (typeof value !== 'object') return String(value);
    return Object.entries(value).map(function (entry) {
      return entry[0].replace(/_/g, ' ') + ': ' + (typeof entry[1] === 'object' ? JSON.stringify(entry[1]) : entry[1]);
    }).join('; ');
  }
  function render() {
    var term = search.value.trim().toLowerCase();
    body.replaceChildren();
    var count = 0;
    rows.forEach(function (entry) {
      var values = [entry.created_at || '', String(entry.action_name || '').replace(/_/g, ' '),
        String(entry.entity_type || '').replace(/_/g, ' '), entry.entity_uid ?? '', details(entry.details)];
      if (term && !values.join(' ').toLowerCase().includes(term)) return;
      var row = document.createElement('tr');
      values.forEach(function (value, index) {
        var cell = document.createElement('td');
        if (index === 1) {
          var badge = document.createElement('span');
          badge.className = 'activity-action';
          badge.textContent = value || '—';
          cell.appendChild(badge);
        } else cell.textContent = value === '' ? '—' : String(value);
        row.appendChild(cell);
      });
      body.appendChild(row);
      count++;
    });
    status.textContent = count ? count + ' activities shown.' : term ? 'No matching activities.' : 'No recorded activity yet.';
  }
  function load() {
    if (pending) return pending;
    refresh.disabled = true;
    status.textContent = 'Loading activity logs…';
    body.setAttribute('aria-busy', 'true');
    pending = (async function () {
      try {
        var result = await window.ApiClient.request('audit?mine=1');
        if (!result.ok || !Array.isArray(result.entries)) throw new Error(result.message || 'Unable to load activity logs.');
        rows = result.entries;
        render();
      } catch (error) {
        rows = [];
        body.replaceChildren();
        status.textContent = (error.message || 'Unable to load activity logs.') + ' Select Refresh to try again.';
      } finally {
        refresh.disabled = false;
        body.removeAttribute('aria-busy');
        pending = null;
      }
    })();
    return pending;
  }
  search.addEventListener('input', render);
  refresh.addEventListener('click', load);
  window.InstructorActivity = { load: load };
})();
