(function () {
  'use strict';
  var rows = [];
  var pending = null;
  var body = document.getElementById('instructorActivityRows');
  var search = document.getElementById('instructorActivitySearch');
  var status = document.getElementById('instructorActivityStatus');
  var refresh = document.getElementById('instructorActivityRefresh');
      function activityEntityLabel(value) {
        return String(value || "system activity")
          .replace(/[_-]+/g, " ")
          .replace(/\b\w/g, (letter) => letter.toUpperCase());
      }

      function activityActionLabel(entry) {
        const action = String(entry?.action_name || entry?.action || "Administrative action")
          .replace(/[_-]+/g, " ")
          .trim();
        const entity = entry?.entity_type ? activityEntityLabel(entry.entity_type) : "";
        const isGenericEntity = ["System", "Admin Tool"].includes(entity);
        return entity && !isGenericEntity && !action.toLowerCase().includes(entity.toLowerCase())
          ? `${action.replace(/^\w/, (letter) => letter.toUpperCase())} ${entity}`
          : action.replace(/^\w/, (letter) => letter.toUpperCase());
      }

      function activityDetails(entry) {
        let details = entry?.details;
        if (typeof details === "string") {
          try { details = JSON.parse(details); } catch (error) { /* Keep plain-text details. */ }
        }
        let message = "";
        if (details && typeof details === "object") {
          message = Object.entries(details)
            .filter(([, value]) => value !== null && value !== undefined && value !== "")
            .map(([key, value]) => `${activityEntityLabel(key)}: ${typeof value === "object" ? JSON.stringify(value) : value}`)
            .join(" • ");
        } else {
          message = String(details || "");
        }
        const actor = entry?.actor_role
          ? `By ${entry.actor_name || activityEntityLabel(entry.actor_role)}${entry.actor_name ? ` (${activityEntityLabel(entry.actor_role)})` : ''}`
          : "";
        return [message, actor].filter(Boolean).join(" • ") || "No additional details";
      }

  function render() {
    var term = search.value.trim().toLowerCase();
    body.replaceChildren();
    var count = 0;
    rows.forEach(function (entry) {
      var rawDate = entry.created_at || entry.timestamp;
      var date = rawDate ? new Date(String(rawDate).replace(' ', 'T')) : null;
      var values = [date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : rawDate || 'Not available',
        activityActionLabel(entry), activityDetails(entry)];
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
