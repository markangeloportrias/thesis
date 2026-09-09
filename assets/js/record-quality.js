/* Shared record completeness checks for review and PRC previews. */
(function () {
  'use strict';
  const fields = {
    case_no: 'Case number', patient_name: 'Patient name', patient_address: 'Patient address',
    complete_diagnosis: 'Complete diagnosis', date_time_performed: 'Date and time performed',
    facility_name: 'Facility name', facility_address: 'Facility address',
    facility_contact_number: 'Facility contact number', supervisor_printed_name: 'Supervisor name',
    supervisor_contact_number: 'Supervisor contact number',
    supervisor_position_designation: 'Position / designation', supervisor_license_no: 'License number',
    supervisor_license_expiry_date: 'License expiry date',
  };
  function missing(record) {
    return Object.entries(fields).filter(([key]) => {
      const value = String(record?.[key] ?? '').trim();
      return !value || /^(?:n\/?a|-|0{4}-0{2}-0{2}(?:[ T]00:00:00)?)$/i.test(value);
    }).map(([, label]) => label);
  }
  function status(record) {
    return String(record.record_status || record.status || (record.checked_by ? 'verified' : 'submitted')).toLowerCase();
  }
  function reviewPanel(record) {
    const panel = document.createElement('section');
    const gaps = missing(record);
    panel.className = 'record-quality-panel';
    const heading = document.createElement('strong');
    heading.textContent = gaps.length ? `${gaps.length} fields need attention` : 'All PRC fields are filled in';
    panel.append(heading);
    const copy = document.createElement('p');
    copy.textContent = gaps.length ? `Missing: ${gaps.join(', ')}.` : 'Check the accuracy of the information before verifying this record.';
    panel.append(copy);
    const remarks = String(record.teacher_remarks || record.remarks || '').trim();
    if (remarks) {
      const reason = document.createElement('p');
      reason.textContent = `Instructor feedback: ${remarks}`;
      panel.append(reason);
    }
    return panel;
  }
  function showPreflight(records, student) {
    const overlay = document.getElementById('prcPreviewOverlay');
    const pages = document.getElementById('prcPreviewPages');
    if (!overlay || !pages) return;
    overlay.querySelector('[data-prc-quality]')?.remove();
    const list = Array.isArray(records) ? records : [];
    const panel = document.createElement('details');
    panel.className = 'record-quality-panel prc-quality-panel';
    panel.dataset.prcQuality = '';
    const issues = list.map((record, index) => {
      const gaps = missing(record);
      const notes = [];
      if (gaps.length) notes.push(`Missing: ${gaps.join(', ')}`);
      if (status(record) !== 'verified') notes.push('Not yet verified');
      return notes.length ? `${record.procedure_name || 'Procedure'} — Case ${record.case_no || index + 1}: ${notes.join('. ')}.` : '';
    }).filter(Boolean);
    if (!list.length) issues.push('No clinical records are included. This export is a blank form.');
    if (!String(student?.student_name || student?.name || '').trim()) issues.push('Applicant name is missing.');
    if (!String(student?.school_name || student?.school || '').trim()) issues.push('School uses the portal default: BOHOL ISLAND STATE UNIVERSITY CALAPE. Check that this is correct.');
    const remaining = Object.entries(targets).map(([key, target]) => {
      const count = list.filter((record) => procedureKey(record) === key && status(record) === 'verified' && missing(record).length === 0).length;
      return count < target ? `${key.replace(/-/g, ' ')}: ${count} / ${target}` : '';
    }).filter(Boolean);
    if (remaining.length) issues.push(`Verified form requirements: ${remaining.join('; ')}.`);
    const summary = document.createElement('summary');
    summary.textContent = issues.length ? `PRC check: ${issues.length} items to review before submission` : `PRC check: all ${list.length} records are filled in and verified`;
    panel.append(summary);
    const note = document.createElement('p');
    note.textContent = 'Review these details before using the form. Blank requirement rows and signatures must still be completed as applicable.';
    panel.append(note);
    const items = document.createElement('ul');
    issues.forEach((issue) => { const item = document.createElement('li'); item.textContent = issue; items.append(item); });
    panel.append(items);
    pages.before(panel);
  }
  const targets = { 'delivery-handled': 20, 'delivery-assisted': 20, 'suturing': 5, 'iv-insertion': 5, 'internal-exam': 20 };
  function procedureKey(record) {
    const value = String(record.procedure_key || record.procedure_name || '').toLowerCase().replace(/[_-]/g, ' ');
    if (value.includes('assisted')) return 'delivery-assisted';
    if (value.includes('delivery') || value.includes('deliveries')) return 'delivery-handled';
    if (value.includes('sutur')) return 'suturing';
    if (value.includes('intraven') || value.includes('iv')) return 'iv-insertion';
    if (value.includes('internal')) return 'internal-exam';
    return '';
  }
  function exportSelection(records, draft) {
    const selected = [];
    const shortfalls = [];
    for (const [key, target] of Object.entries(targets)) {
      const candidates = records.filter((record) => procedureKey(record) === key &&
        (draft || (status(record) === 'verified' && missing(record).length === 0)));
      selected.push(...candidates.slice(0, target));
      if (candidates.length < target) shortfalls.push(`${key.replace(/-/g, ' ')}: ${candidates.length} / ${target}`);
    }
    if (!draft && shortfalls.length) throw new Error(`The verified form requires complete, verified cases for every procedure. ${shortfalls.join('; ')}. You can download a draft while completing these requirements.`);
    return selected;
  }
  async function prepareExport(studentId, draft) {
    if (!studentId) throw new Error('Select a student before exporting.');
    const [records, profile] = await Promise.all([
      window.ApiClient.getJoinedCases(studentId, '', ''),
      window.ApiClient.getStudent(studentId),
    ]);
    if (!Array.isArray(records)) throw new Error('Unable to refresh the clinical records.');
    if (!profile?.ok || !profile.student) throw new Error(profile?.message || 'Unable to refresh the student profile.');
    if (!draft && !String(profile.student.student_name || '').trim()) throw new Error('The applicant name is required for a verified form.');
    const scoped = records.filter((record) => String(record.student_id) === String(studentId) && !record.archived_at);
    return { records: exportSelection(scoped, draft), student: profile.student, draft };
  }
  function markDraftDocument(xml, namespace) {
    // Mark each table page without adding paragraphs that shift the template layout.
    Array.from(xml.getElementsByTagNameNS(namespace, 'tbl')).forEach((table) => {
      const firstText = table.getElementsByTagNameNS(namespace, 't')[0];
      if (firstText) firstText.textContent = `DRAFT - ${firstText.textContent}`;
    });
  }
  function markDraftPreview(pages, draft) {
    pages.querySelectorAll('.prc-export-form').forEach((page) => {
      page.classList.toggle('is-draft', draft);
      page.querySelector('[data-draft-label]')?.remove();
      if (draft) {
        const label = document.createElement('div');
        label.dataset.draftLabel = '';
        label.className = 'prc-draft-label';
        label.textContent = 'DRAFT - NOT FOR SUBMISSION';
        page.prepend(label);
      }
    });
  }
  function notify(message, title = 'Message') {
    const existing = document.querySelector('[data-record-quality-notice]');
    existing?.remove();
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'record-quality-notice-overlay';
      overlay.dataset.recordQualityNotice = '';
      overlay.setAttribute('role', 'presentation');
      const dialog = document.createElement('section');
      dialog.className = 'record-quality-notice';
      dialog.setAttribute('role', 'alertdialog');
      dialog.setAttribute('aria-modal', 'true');
      const heading = document.createElement('h2');
      heading.textContent = title;
      const copy = document.createElement('p');
      copy.textContent = String(message || '');
      const actions = document.createElement('div');
      actions.className = 'record-quality-notice-actions';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'record-quality-notice-close';
      close.textContent = 'OK';
      const dismiss = () => {
        document.removeEventListener('keydown', onKeydown);
        overlay.remove();
        resolve();
      };
      const onKeydown = (event) => { if (event.key === 'Escape' || event.key === 'Enter') dismiss(); };
      close.addEventListener('click', dismiss);
      overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss(); });
      document.addEventListener('keydown', onKeydown);
      actions.append(close);
      dialog.append(heading, copy, actions);
      overlay.append(dialog);
      document.body.append(overlay);
      close.focus();
    });
  }
  window.RecordQuality = { missing, status, reviewPanel, showPreflight, exportSelection, prepareExport, markDraftDocument, markDraftPreview, notify };
})();
