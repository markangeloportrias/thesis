window.renderManageStudentsSummary = function (years) {
  const container = document.getElementById('manageStudentsSummary');
  if (!container) return;
  const rows = Array.isArray(years) ? years : [];
  const cards = [
    ['calendar-alt', rows.length, 'Academic Years'],
    ['folder-open', rows.reduce((sum, year) => sum + (Number(year.block_count) || 0), 0), 'Registered Blocks'],
    ['users', rows.reduce((sum, year) => sum + (Number(year.student_count) || 0), 0), 'Student Enrollments'],
    ['calendar-check', rows.filter(year => String(year.status || '').toLowerCase() === 'active').length, 'Active Academic Years'],
  ];
  container.replaceChildren();
  cards.forEach(([icon, count, label]) => {
    const card = document.createElement('div');
    card.className = 'manage-students-summary-card';
    const symbol = document.createElement('i');
    symbol.className = 'fas fa-' + icon;
    symbol.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const value = document.createElement('strong');
    value.textContent = String(count);
    const caption = document.createElement('span');
    caption.textContent = label;
    copy.append(value, caption);
    card.append(symbol, copy);
    container.append(card);
  });
};
