const THEME_KEY = 'fr-theme';
const THEMES = ['dark', 'light', 'red'];

function getTheme() {
  return localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

function applyTheme(theme) {
  THEMES.forEach(t => document.body.classList.toggle(`${t}-mode`, t === theme));
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll('.em-theme-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.theme === theme);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getTheme());

  // Scroll-aware header
  const header = document.querySelector('.em-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 0);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Burger / overlay
  const burger = document.getElementById('menu-toggle');
  const panel  = document.getElementById('menu-panel');

  function openMenu() {
    burger.classList.add('is-open');
    burger.setAttribute('aria-expanded', 'true');
    panel.classList.add('is-open');
    panel.removeAttribute('aria-hidden');
  }

  function closeMenu() {
    burger.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
  }

  burger.addEventListener('click', () => {
    panel.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  // Close on nav link click or outside click
  panel.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && !burger.contains(e.target)) closeMenu();
  });

  // Theme buttons
  panel.querySelectorAll('.em-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
});
