(() => {
  const TOTAL = Maqasid.TOTAL_PAGES;
  const LABELS = {
    ar: {
      page: 'صفحة',
      of: 'من',
      prev: 'السابق',
      next: 'التالي',
      toggle: 'English',
      toggleTitle: 'Read in English',
      home: 'الصفحة الرئيسية',
      theme: 'تبديل الوضع الليلي',
      fontDown: 'تصغير الخط',
      fontUp: 'تكبير الخط',
      title: 'المقاصد عند الإمام الشاطبي',
      error: 'تعذّر تحميل الصفحة.',
      retry: 'إعادة المحاولة',
    },
    en: {
      page: 'Page',
      of: 'of',
      prev: 'Previous',
      next: 'Next',
      toggle: 'العربية',
      toggleTitle: 'اقرأ بالعربية',
      home: 'Home',
      theme: 'Toggle dark mode',
      fontDown: 'Smaller text',
      fontUp: 'Larger text',
      title: 'Al-Maqasid according to Imam al-Shatibi',
      error: 'Could not load this page.',
      retry: 'Try again',
    },
  };

  const el = {
    reader: document.getElementById('reader'),
    article: document.getElementById('content'),
    select: document.getElementById('page-select'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    prevLabel: document.querySelector('#prev .label'),
    nextLabel: document.querySelector('#next .label'),
    counter: document.getElementById('counter'),
    lang: document.getElementById('lang-toggle'),
    home: document.getElementById('home'),
    theme: document.getElementById('theme-toggle'),
    enNote: document.getElementById('en-note'),
    fontDown: document.getElementById('font-down'),
    fontUp: document.getElementById('font-up'),
  };

  const FONT = { min: 0.8, max: 2, step: 0.1 };
  let fontScale = clampScale(Maqasid.load().fontScale ?? 1);

  const cache = new Map();
  let state = initialState();
  let renderToken = 0;

  function clampScale(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 1;
    return Math.round(Math.min(Math.max(n, FONT.min), FONT.max) * 10) / 10;
  }

  function applyFontScale() {
    document.documentElement.style.setProperty('--font-scale', fontScale);
    el.fontDown.disabled = fontScale <= FONT.min;
    el.fontUp.disabled = fontScale >= FONT.max;
  }

  function changeFont(delta) {
    const next = clampScale(fontScale + delta);
    if (next === fontScale) return;
    fontScale = next;
    Maqasid.save({ fontScale });
    applyFontScale();
  }

  function clampPage(n) {
    n = parseInt(n, 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), TOTAL) : 1;
  }

  // Priority: URL hash (#en/12) → last saved position → Arabic page 1.
  function initialState() {
    const fromHash = parseHash();
    if (fromHash) return fromHash;
    const saved = Maqasid.load();
    return {
      lang: saved.lang === 'en' ? 'en' : 'ar',
      page: clampPage(saved.page || 1),
    };
  }

  function parseHash() {
    const m = location.hash.match(/^#(ar|en)(?:\/(\d+))?$/);
    if (!m) return null;
    const saved = Maqasid.load();
    return { lang: m[1], page: clampPage(m[2] || saved.page || 1) };
  }

  async function fetchPage(lang, page) {
    const key = `${lang}/${page}`;
    if (!cache.has(key)) {
      const promise = fetch(`${key}.html`)
        .then((res) => {
          if (!res.ok) throw new Error(res.status);
          return res.text();
        })
        .then((html) => {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          return doc.querySelector('article') || doc.body;
        })
        .catch((err) => {
          cache.delete(key);
          throw err;
        });
      cache.set(key, promise);
    }
    return cache.get(key);
  }

  // Lines of underscores separate body text from footnotes; style them.
  function decorate(article) {
    let inNotes = false;
    for (const p of [...article.querySelectorAll('p')]) {
      const text = p.textContent.trim();
      if (/^_{5,}$/.test(text)) {
        const hr = document.createElement('hr');
        hr.className = 'fn-sep';
        p.replaceWith(hr);
        inNotes = true;
      } else if (inNotes && /^\(\d+\)/.test(text)) {
        p.classList.add('footnote');
      } else {
        inNotes = false;
      }
    }
    return article;
  }

  function applyChrome() {
    const t = LABELS[state.lang];
    const root = document.documentElement;
    root.lang = state.lang;
    root.dir = state.lang === 'ar' ? 'rtl' : 'ltr';

    document.title = `${t.title} — ${t.page} ${state.page}`;
    el.prevLabel.textContent = t.prev;
    el.nextLabel.textContent = t.next;
    el.lang.textContent = t.toggle;
    el.lang.lang = state.lang === 'ar' ? 'en' : 'ar';
    el.lang.title = t.toggleTitle;
    el.home.setAttribute('aria-label', t.home);
    el.home.title = t.home;
    el.theme.setAttribute('aria-label', t.theme);
    el.theme.title = t.theme;
    for (const [btn, label] of [[el.fontDown, t.fontDown], [el.fontUp, t.fontUp], [el.prev, t.prev], [el.next, t.next]]) {
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
    el.counter.textContent = `${state.page} ${t.of} ${TOTAL}`;
    el.enNote.hidden = state.lang !== 'en';

    if (el.select.dataset.lang !== state.lang) {
      for (const opt of el.select.options) opt.textContent = `${t.page} ${opt.value}`;
      el.select.dataset.lang = state.lang;
    }
    el.select.value = String(state.page);
    el.select.setAttribute('aria-label', t.page);

    el.prev.disabled = state.page <= 1;
    el.next.disabled = state.page >= TOTAL;
  }

  async function render({ scroll = true } = {}) {
    const token = ++renderToken;
    const { lang, page } = state;

    applyChrome();
    history.replaceState(null, '', `#${lang}/${page}`);
    Maqasid.save({ lang, page });
    el.reader.classList.add('loading');

    try {
      const source = await fetchPage(lang, page);
      if (token !== renderToken) return;
      const article = decorate(source.cloneNode(true));
      el.article.replaceChildren(...article.childNodes);
    } catch {
      if (token !== renderToken) return;
      showError();
    } finally {
      if (token === renderToken) el.reader.classList.remove('loading');
    }

    if (scroll) window.scrollTo({ top: 0 });

    // Warm the cache for the likely next page.
    if (page < TOTAL) fetchPage(lang, page + 1).catch(() => {});
  }

  function showError() {
    const t = LABELS[state.lang];
    const msg = document.createElement('p');
    msg.className = 'error';
    msg.textContent = t.error;
    const retry = document.createElement('button');
    retry.className = 'btn';
    retry.textContent = t.retry;
    retry.addEventListener('click', () => render());
    const wrap = document.createElement('div');
    wrap.className = 'error';
    wrap.append(msg, retry);
    el.article.replaceChildren(wrap);
  }

  function goTo(page) {
    page = clampPage(page);
    if (page === state.page) return;
    state = { ...state, page };
    render();
  }

  function setLang(lang) {
    if (lang === state.lang) return;
    state = { ...state, lang };
    render({ scroll: false });
  }

  // ---- Setup ----

  const frag = document.createDocumentFragment();
  for (let i = 1; i <= TOTAL; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    frag.append(opt);
  }
  el.select.append(frag);

  el.select.addEventListener('change', () => goTo(el.select.value));
  el.prev.addEventListener('click', () => goTo(state.page - 1));
  el.next.addEventListener('click', () => goTo(state.page + 1));
  el.lang.addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));
  Maqasid.bindThemeToggle(el.theme);
  el.fontDown.addEventListener('click', () => changeFont(-FONT.step));
  el.fontUp.addEventListener('click', () => changeFont(FONT.step));
  applyFontScale();

  window.addEventListener('hashchange', () => {
    const next = parseHash();
    if (next && (next.lang !== state.lang || next.page !== state.page)) {
      state = next;
      render();
    }
  });

  // Arrow keys follow reading direction: in Arabic, left is forward.
  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target === el.select) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const forwardKey = state.lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    goTo(state.page + (e.key === forwardKey ? 1 : -1));
  });

  // Swipe: like turning a physical page. Arabic books open right-to-left,
  // so swiping right moves forward in Arabic; swiping left moves forward in English.
  let touch = null;
  el.reader.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });

  el.reader.addEventListener('touchend', (e) => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    const quick = Date.now() - touch.t < 800;
    touch = null;
    if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (window.getSelection()?.toString()) return;
    const forward = state.lang === 'ar' ? dx > 0 : dx < 0;
    goTo(state.page + (forward ? 1 : -1));
  }, { passive: true });

  render();
})();
