// Shared helpers: persisted state and the dark/light theme toggle.
// Book-specific values (storage key, page count, titles) come from book.js,
// which build_site.py generates from the site's book.json.
const Site = (() => {
  const KEY = window.BOOK.storageKey;
  const TOTAL_PAGES = window.BOOK.totalPages;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }

  function save(patch) {
    const next = { ...load(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode etc.) — reading still works.
    }
    return next;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    save({ theme });
  }

  function bindThemeToggle(button) {
    button.addEventListener('click', () => {
      const current = document.documentElement.dataset.theme;
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  return { TOTAL_PAGES, load, save, bindThemeToggle };
})();
