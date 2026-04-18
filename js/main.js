const THEME_KEY = 'fr-theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.body.classList.toggle('dark-mode',  theme === 'dark');
  document.body.classList.toggle('light-mode', theme === 'light');
  const sw = document.getElementById('theme-switch');
  if (sw) sw.classList.toggle('em-switch--off', theme === 'light');
  localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
  const current = getTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getTheme());
  const sw = document.getElementById('theme-switch');
  if (sw) sw.addEventListener('click', toggleTheme);
});
