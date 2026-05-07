/* ─── TOC SCROLL SPY ─── */
(function () {
  const links    = document.querySelectorAll('.toc-link[href^="#"]');
  const sections = Array.from(links)
    .map(l => document.querySelector(l.getAttribute('href')))
    .filter(Boolean);

  function onScroll() {
    const scrollY = window.scrollY + 100;
    let active = sections[0];

    sections.forEach(sec => {
      if (sec.offsetTop <= scrollY) active = sec;
    });

    links.forEach(l => {
      l.classList.toggle(
        'active',
        l.getAttribute('href') === '#' + active.id
      );
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ─── SMOOTH SCROLL ─── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
