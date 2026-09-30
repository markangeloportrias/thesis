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

      function shortActivityText(value, limit = 88) {
        const text = String(value ?? "").replace(/\s+/g, " ").trim();
        return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
      }

      function activityDetails(entry) {
        let details = entry?.details;
        if (typeof details === "string") {
          try { details = JSON.parse(details); } catch (error) { /* Keep plain-text details. */ }
        }
        const messages = [];
        const identity = details && typeof details === "object"
          ? (details.record_identity || details.recordIdentity)
          : null;
        if (identity && typeof identity === "object") {
          const caseNumber = identity.case_no || entry?.case_no;
          const patientName = identity.patient_name;
          const procedure = identity.procedure_key ? activityEntityLabel(identity.procedure_key) : "";
          [caseNumber && `Case ${caseNumber}`, patientName, procedure].filter(Boolean).forEach((value) => {
            messages.push(shortActivityText(value));
          });
        } else if (entry?.case_no) {
          messages.push(shortActivityText(`Case ${entry.case_no}`));
        }
        if (details && typeof details === "object") {
          Object.entries(details)
            .filter(([key, value]) => !["record_identity", "recordIdentity", "comment_id"].includes(key) && value !== null && value !== undefined && value !== "")
            .forEach(([key, value]) => {
              if (key === "fields" && Array.isArray(value)) messages.push(`Updated: ${value.map(activityEntityLabel).join(", ")}`);
              else if (["remarks", "comment", "message"].includes(key)) messages.push(`Remarks: ${shortActivityText(value)}`);
              else if (key === "status") messages.push(`Status: ${shortActivityText(value, 42)}`);
              else if (["instructor_name", "instructor"].includes(key)) messages.push(`Instructor: ${shortActivityText(value, 56)}`);
            });
        } else if (details) {
          messages.push(shortActivityText(details));
        }
        const actor = entry?.actor_role
          ? `By ${entry.actor_name || activityEntityLabel(entry.actor_role)}${entry.actor_name ? ` (${activityEntityLabel(entry.actor_role)})` : ''}`
          : "";
        return [messages.join(" • "), actor].filter(Boolean).join(" • ") || "No additional details";
      }

  function render() {
    var term = search.value.trim().toLowerCase();
    body.replaceChildren();
    var count = 0;
    rows.forEach(function (entry) {
      var rawDate = entry.created_at || entry.timestamp;
      var date = rawDate ? PhilippineTime.parse(rawDate) : null;
      var values = [date && !Number.isNaN(date.getTime()) ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : rawDate || 'Not available',
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
