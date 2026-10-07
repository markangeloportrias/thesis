document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('desktopProfileHeader');
  if (!header) return;
  const instructor = header.dataset.profileRole === 'instructor';
  const name = document.getElementById(instructor ? 'sidebarInstructorName' : 'sidebarProfileName');
  const details = document.getElementById(instructor ? 'sidebarInstructorRole' : 'mobileStudentDetails');
  const sourcePhoto = document.getElementById(instructor ? 'sidebarInstructorPhoto' : 'sidebarStudentPhoto');
  const photo = header.querySelector('img');
  const fallback = header.querySelector('.desktop-profile-avatar i');
  const sync = () => {
    header.querySelector('strong').textContent = name?.textContent || (instructor ? 'Instructor' : 'Student');
    header.querySelector('small').textContent = details?.textContent || (instructor ? 'Clinical instructor' : 'Clinical trainee');
    const src = sourcePhoto?.getAttribute('src') || '';
    if (src && photo.getAttribute('src') !== src) {
      photo.style.display = 'none';
      fallback.style.display = 'block';
      photo.src = src;
    } else if (!src) {
      photo.removeAttribute('src');
      photo.style.display = 'none';
      fallback.style.display = 'block';
    }
  };
  photo.onload = () => { photo.style.display = 'block'; fallback.style.display = 'none'; };
  photo.onerror = () => { photo.style.display = 'none'; fallback.style.display = 'block'; };
  const observer = new MutationObserver(sync);
  [name, details, sourcePhoto].filter(Boolean).forEach(node => observer.observe(node, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'],
  }));
  sync();
});
