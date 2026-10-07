// Display-only summary of the same annual directory data used by each dashboard.
window.renderAnnualRecordsSummary = function (totals) {
  const container = document.getElementById('annualRecordsSummary');
  if (!container) return;
  container.replaceChildren();
  [
    ['calendar-alt', 'Academic Years', totals.years],
    ['folder-open', 'Registered Blocks', totals.blocks],
    ['users', 'Student Enrollments', totals.students],
    ['file-alt', 'Clinical Records', totals.records],
  ].forEach(([icon, label, count]) => {
    const card = document.createElement('div');
    card.className = 'annual-summary-card';
    const symbol = document.createElement('i');
    symbol.className = 'fas fa-' + icon;
    symbol.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const value = document.createElement('strong');
    value.textContent = String(Number(count) || 0);
    const caption = document.createElement('span');
    caption.textContent = label;
    copy.append(value, caption);
    card.append(symbol, copy);
    container.append(card);
  });
};
