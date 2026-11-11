(function (root) {
  'use strict';

  // Parse quoted CSV fields, including escaped quotes, commas and CRLF files.
  function parseStudentsCsv(source) {
    const text = String(source).replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    function finishField() { row.push(field); field = ''; closed = false; }
    function finishRow() {
      finishField();
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closed = true; }
        } else field += c;
      } else if (c === ',') finishField();
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        finishRow();
      } else if (c === '"' && field === '' && !closed) quoted = true;
      else if (closed || c === '"') throw new Error('Invalid CSV quoting. Please use the CSV template.');
      else field += c;
    }
    if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
    finishRow();
    const header = rows.shift() || [];
    if (header.length !== 2 || header[0].trim().toLowerCase() !== 'student_id' || header[1].trim().toLowerCase() !== 'student_name') {
      throw new Error('The first row must be student_id,student_name (in that order).');
    }
    if (!rows.length) throw new Error('Add students below the CSV header before importing.');
    if (rows.length > 100) throw new Error('Import up to 100 students per CSV file.');
    return rows.map((cells, index) => {
      const location = `Student row ${index + 1}`;
      if (cells.length !== 2) throw new Error(`${location}: expected exactly two columns. Quote names containing commas.`);
      const student_id = cells[0].trim();
      const student_name = cells[1].trim();
      if (!/^\d{6}$/.test(student_id)) throw new Error(`${location}: student ID must contain exactly 6 digits. Keep leading zeros.`);
      if (!student_name || student_name.length > 255 || /[\x00-\x1f\x7f]/.test(student_name)) throw new Error(`${location}: enter a valid student name (up to 255 characters).`);
      return { student_id, student_name, password: `midwife${student_id}` };
    });
  }

  function shortReason(message) {
    const text = String(message || '').toLowerCase();
    if (/already exists|duplicate/.test(text)) return 'Already exists';
    if (/access denied|forbidden|unauthorized/.test(text)) return 'Access denied';
    if (/session|log.?in|authentication/.test(text)) return 'Session expired';
    if (/block.*unavailable/.test(text)) return 'Block unavailable';
    if (/network|fetch|timeout|connection/.test(text)) return 'Check connection';
    if (/invalid|required|must contain/.test(text)) return 'Invalid data';
    return 'Request failed';
  }

  function mount(options) {
    const button = document.getElementById('importStudentsCsvBtn');
    const input = document.getElementById('studentsCsvFile');
    const report = document.getElementById('studentsCsvReport');
    let busy = false;
    function show(text) { report.hidden = false; report.textContent = text; }
    button.addEventListener('click', () => {
      if (busy) return;
      const context = options.getContext();
      if (!context.blockId || !context.schoolYear) { show('Open a school year and block first.'); return; }
      input.value = '';
      input.click();
    });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file || busy) return;
      const context = { ...options.getContext() };
      if (!context.blockId || !context.schoolYear) { show('Open a school year and block first.'); return; }
      busy = true;
      button.disabled = true;
      try {
        if (!/\.csv$/i.test(file.name) || file.size > 1024 * 1024) throw new Error('Choose a CSV file no larger than 1 MB.');
        const students = parseStudentsCsv(await file.text());
        const confirmed = await options.confirm(
          `Import ${students.length} students into ${context.schoolYear} / ${context.blockLabel}? Initial passwords will be midwife followed by the student ID. Existing accounts will not be changed.`,
          { title: 'Import Students from CSV', confirmLabel: 'Import Students' }
        );
        if (!confirmed) return;
        const failures = [];
        const successes = [];
        const seen = new Set();
        let imported = 0;
        for (let i = 0; i < students.length; i++) {
          const student = students[i];
          const label = `${student.student_id} - ${student.student_name}`;
          if (seen.has(student.student_id)) {
            failures.push(`${label}: Duplicate ID`);
            continue;
          }
          seen.add(student.student_id);
          show(`Importing ${i + 1} of ${students.length} students…`);
          try {
            const result = await options.create(context, student);
            if (!result?.ok) throw new Error(result?.message || 'Unable to create this student.');
            imported++;
            successes.push(`${label}: Added`);
          } catch (error) {
            failures.push(`${label}: ${shortReason(error.message)}`);
          }
        }
        show(`Imported: ${imported}. Not imported: ${failures.length}.\n\nSuccessfully added\n${successes.join('\n') || 'None'}\n\nNot added\n${failures.join('\n') || 'None'}`);
        if (imported) {
          try { await options.refresh(context); }
          catch (_) { report.textContent += '\nAccounts were created, but the roster could not refresh. Refresh the list to view them.'; }
        }
      } catch (error) { show(error.message || 'Unable to read the CSV file.'); }
      finally { busy = false; button.disabled = false; input.value = ''; }
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { parseStudentsCsv, mount };
  else root.AdminStudentImport = { parseStudentsCsv, mount };
})(typeof window !== 'undefined' ? window : globalThis);
