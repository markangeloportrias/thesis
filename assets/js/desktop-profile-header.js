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
  const clock = document.createElement('div');
  clock.className = 'desktop-profile-clock';
  const date = document.createElement('span');
  const time = document.createElement('time');
  clock.append(date, time);
  header.append(clock);
  const mobileProfile = document.querySelector('.student-mobile-profile-copy');
  const mobileTime = mobileProfile ? document.createElement('time') : null;
  if (mobileTime) {
    mobileTime.className = 'mobile-profile-clock';
    mobileProfile.append(mobileTime);
  }
  const mobileDateFormat = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric',
  });
  const dateFormat = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const timeFormat = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
  });
  const updateClock = () => {
    const now = new Date();
    date.textContent = dateFormat.format(now);
    time.dateTime = now.toISOString();
    if (mobileTime) {
      mobileTime.dateTime = now.toISOString();
      mobileTime.textContent = mobileDateFormat.format(now) + ' · ' + timeFormat.format(now) + ' PHT';
      mobileTime.title = dateFormat.format(now) + ' · Philippine Time';
    }
    time.textContent = timeFormat.format(now) + ' · Philippine Time';
  };
  updateClock();
  const clockInterval = setInterval(() => { if (!document.hidden) updateClock(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
  window.addEventListener('pagehide', event => { if (!event.persisted) clearInterval(clockInterval); });
});
