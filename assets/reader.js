(() => {
  const TOTAL = Maqasid.TOTAL_PAGES;
  // Book pages reuse this script's ?v= so bumping it also refreshes cached page text.
  const VERSION = new URL(document.currentScript.src).search;
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
    select: document.getElementById('page-select'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    prevLabel: document.querySelector('#prev .label'),
    nextLabel: document.querySelector('#next .label'),
    counter: document.getElementById('counter'),
    lang: document.getElementById('lang-toggle'),
    home: document.getElementById('home'),
    theme: document.getElementById('theme-toggle'),
    noteTemplate: document.getElementById('en-note-template'),
    fontDown: document.getElementById('font-down'),
    fontUp: document.getElementById('font-up'),
  };

  const FONT = { min: 0.8, max: 2, step: 0.1 };
  let fontScale = clampScale(Maqasid.load().fontScale ?? 1);

  const cache = new Map();
  let state = initialState();

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
      const promise = fetch(`${key}.html${VERSION}`)
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

    if (el.select.dataset.lang !== state.lang) {
      for (const opt of el.select.options) opt.textContent = `${t.page} ${opt.value}`;
      el.select.dataset.lang = state.lang;
    }
    el.select.value = String(state.page);
    el.select.setAttribute('aria-label', t.page);

    el.prev.disabled = state.page <= 1;
    el.next.disabled = state.page >= TOTAL;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // How many pages either side of the one being read are kept in the track. A
  // fast swipe can start before the last one has settled and the track been
  // rebuilt; with only one page each side it would hit the end and stop dead,
  // so keep enough that a run of quick swipes always has a page to land on
  // (showing its text, or a spinner while it loads).
  const AHEAD = 3;

  // The page being read sits in a track with the pages either side of it,
  // like the adhkar pages: the browser scrolls and snaps the track under the
  // finger, so a swipe is as smooth as it gets, and the neighbours are already
  // loaded when they slide in. When a swipe comes to rest on a neighbour, that
  // page becomes the current one and the track is rebuilt around it, unseen.
  const slides = new Map();
  let settleTimer = null;

  const slideKey = (lang, page) => `${lang}/${page}`;
  const currentSlide = () => slides.get(slideKey(state.lang, state.page));

  function makeSlide(lang, page) {
    const node = document.createElement('div');
    node.className = 'slide loading'; // until fillSlide has put its page in
    const article = document.createElement('article');
    node.append(article);
    if (lang === 'en') node.append(el.noteTemplate.content.cloneNode(true));
    return { key: slideKey(lang, page), lang, page, el: node, article, loaded: false, loading: null };
  }

  function showError(slide) {
    const t = LABELS[slide.lang];
    const msg = document.createElement('p');
    msg.className = 'error';
    msg.textContent = t.error;
    const retry = document.createElement('button');
    retry.className = 'btn';
    retry.textContent = t.retry;
    retry.addEventListener('click', () => fillSlide(slide));
    const wrap = document.createElement('div');
    wrap.className = 'error';
    wrap.append(msg, retry);
    slide.article.replaceChildren(wrap);
  }

  function fillSlide(slide) {
    if (slide.loaded) return Promise.resolve();
    if (slide.loading) return slide.loading;
    slide.el.classList.add('loading');
    slide.loading = fetchPage(slide.lang, slide.page)
      .then((source) => {
        slide.article.replaceChildren(...decorate(source.cloneNode(true)).childNodes);
        slide.loaded = true;
      })
      .catch(() => {
        // A neighbour that fails stays blank until it is the page being read.
        if (slide.page === state.page && slide.lang === state.lang) showError(slide);
      })
      .finally(() => {
        slide.loading = null;
        slide.el.classList.remove('loading');
      });
    return slide.loading;
  }

  // Rebuild the track around the current page: keep the slides still wanted,
  // make the missing ones, drop the rest, and put the track back on the current
  // one without the reader seeing it move.
  async function render({ keepScroll = false } = {}) {
    const { lang, page } = state;

    applyChrome();
    history.replaceState(null, '', `#${lang}/${page}`);
    Maqasid.save({ lang, page });

    const scrollTop = keepScroll ? currentSlide()?.el.scrollTop ?? 0 : 0;
    const wanted = Array.from({ length: AHEAD * 2 + 1 }, (_, i) => page - AHEAD + i)
      .filter((p) => p >= 1 && p <= TOTAL)
      .map((p) => slides.get(slideKey(lang, p)) ?? makeSlide(lang, p));

    el.reader.style.scrollSnapType = 'none';
    for (const [key, slide] of slides) {
      if (!wanted.includes(slide)) {
        slide.el.remove();
        slides.delete(key);
      }
    }
    // Last to first, so that each slide goes in before one already there.
    wanted.toReversed().forEach((slide, i) => {
      const after = wanted[wanted.length - i];
      slides.set(slide.key, slide);
      if (!slide.el.isConnected) el.reader.insertBefore(slide.el, after?.el ?? null);
      slide.el.toggleAttribute('data-current', slide.page === page);
      slide.el.setAttribute('aria-hidden', slide.page === page ? 'false' : 'true');
    });

    const slide = currentSlide();
    slide.el.scrollIntoView({ behavior: 'instant', inline: 'start', block: 'nearest' });
    // A frame, or a turn of the loop where no frame comes: a tab in the
    // background gets no frames, and the track would be left free to scroll
    // with nothing to come to rest on.
    const snapBack = () => { el.reader.style.scrollSnapType = ''; };
    requestAnimationFrame(snapBack);
    setTimeout(snapBack);

    await fillSlide(slide);
    if (scrollTop) slide.el.scrollTop = scrollTop;
    // Nearest first, so the pages most likely to be swiped to arrive first.
    wanted
      .toSorted((a, b) => Math.abs(a.page - page) - Math.abs(b.page - page))
      .forEach((neighbour) => fillSlide(neighbour));
    preloadNeighbours(lang, page);
  }

  // Fetch likely next destinations while the connection is known to be
  // alive. Some networks silently drop idle connections, and the browser
  // then stalls ~10s before reconnecting, so a request made later (after
  // the reader has been reading a while) can be slow.
  function preloadNeighbours(lang, page) {
    const other = lang === 'ar' ? 'en' : 'ar';
    const targets = [[lang, page + AHEAD + 1], [lang, page - AHEAD - 1], [other, page]];
    for (const [l, p] of targets) {
      if (p >= 1 && p <= TOTAL) fetchPage(l, p).catch(() => {});
    }
  }

  // Once the track is at rest on a slide that is not the current one, that
  // page is the one being read. This runs even with a finger on the screen: a
  // fast reader's next swipe often starts before the last one has settled, and
  // waiting for the finger to lift left that swipe nowhere to go. Rebuilding
  // keeps the same page under the finger, so it cannot be seen.
  function settle() {
    const track = el.reader.getBoundingClientRect();
    const gap = (slide) => Math.abs(slide.el.getBoundingClientRect().left - track.left);
    const nearest = [...slides.values()].reduce((best, slide) => (gap(slide) < gap(best) ? slide : best));
    // A fiftieth of the page, which is far inside the half that would make
    // another slide the nearest one: a snap lands on whatever fraction of a
    // pixel the screen rounds to, and exactness here means waiting for ever.
    if (gap(nearest) > Math.max(4, track.width / 50)) {
      scheduleSettle();
    } else if (nearest.page !== state.page) {
      state = { ...state, page: nearest.page };
      render();
    }
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 150);
  }

  function goTo(page) {
    page = clampPage(page);
    if (page === state.page) return;
    const neighbour = slides.get(slideKey(state.lang, page));
    if (neighbour && Math.abs(page - state.page) === 1) {
      // The next page is already beside this one: slide to it. (Further pages
      // in the track jump instead, rather than gliding past the ones between.)
      neighbour.el.scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', inline: 'start', block: 'nearest' });
      return;
    }
    state = { ...state, page };
    render();
  }

  function setLang(lang) {
    if (lang === state.lang) return;
    state = { ...state, lang };
    render({ keepScroll: true });
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

  // Swiping is the track scrolling. Wait for the scrolling to stop before
  // deciding where it came to rest.
  el.reader.addEventListener('touchend', scheduleSettle, { passive: true });
  el.reader.addEventListener('touchcancel', scheduleSettle, { passive: true });
  el.reader.addEventListener('scroll', scheduleSettle, { passive: true });
  el.reader.addEventListener('scrollend', settle);

  render();
})();
