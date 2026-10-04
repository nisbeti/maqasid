(() => {
  const TOTAL = Site.TOTAL_PAGES;
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
      title: window.BOOK.title.ar,
      error: 'تعذّر تحميل الصفحة.',
      retry: 'إعادة المحاولة',
      contents: 'المحتويات',
      goToPage: 'انتقل إلى صفحة',
      go: 'اذهب',
      close: 'إغلاق',
      expand: 'عرض الأقسام',
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
      title: window.BOOK.title.en,
      error: 'Could not load this page.',
      retry: 'Try again',
      contents: 'Contents',
      goToPage: 'Go to page',
      go: 'Go',
      close: 'Close',
      expand: 'Show sections',
    },
  };

  const el = {
    reader: document.getElementById('reader'),
    contentsBtn: document.getElementById('contents-btn'),
    contentsLabel: document.querySelector('#contents-btn .contents-label'),
    contents: document.getElementById('contents'),
    contentsTitle: document.getElementById('contents-title'),
    contentsClose: document.getElementById('contents-close'),
    contentsList: document.getElementById('contents-list'),
    pageJump: document.getElementById('page-jump'),
    pageJumpLabel: document.querySelector('#page-jump .page-jump-label'),
    pageInput: document.getElementById('page-input'),
    pageTotal: document.querySelector('#page-jump .page-total'),
    pageGo: document.querySelector('#page-jump .page-go'),
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
  let fontScale = clampScale(Site.load().fontScale ?? 1);

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
    Site.save({ fontScale });
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
    const saved = Site.load();
    return {
      lang: saved.lang === 'en' ? 'en' : 'ar',
      page: clampPage(saved.page || 1),
    };
  }

  function parseHash() {
    const m = location.hash.match(/^#(ar|en)(?:\/(\d+))?$/);
    if (!m) return null;
    const saved = Site.load();
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
  // A note can run to more than one paragraph: under the footnote
  // separator (exactly 10 underscores), the lines after a "(n)" line stay
  // footnotes. Longer runs are section breaks, not footnotes.
  function decorate(article) {
    let inNotes = false;
    let inNote = false;
    let notesSeparator = false;
    for (const p of [...article.querySelectorAll('p')]) {
      const text = p.textContent.trim();
      if (/^_{5,}$/.test(text)) {
        const hr = document.createElement('hr');
        hr.className = 'fn-sep';
        p.replaceWith(hr);
        inNotes = true;
        inNote = false;
        notesSeparator = text.length === 10;
      } else if (inNotes && (/^\(\d+\)/.test(text) || inNote)) {
        p.classList.add('footnote');
        inNote = notesSeparator;
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

    applyContentsChrome(t);

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
  let settleFrame = null;
  let lastScrollLeft = null;

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
    Site.save({ lang, page });

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
    if (performance.now() - lastUserScroll > USER_SCROLL_MS) {
      // Nobody swiped: the track moved because its width changed (a pane or
      // window opening, a phone turning) while the page was being drawn. That
      // is not a page turn - put the current page back.
      alignCurrent();
      return;
    }
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

  /*
    A page is only ever adopted because the reader moved the track. When the
    reader has no width yet as the track is built (the tab or pane is still
    opening), putting the current page in view lands short, and settle() saw a
    neighbour at rest and adopted it - and again from there, so the reader
    drifted back a page or several by itself (45 -> 44, 20 -> 19 -> 15). So
    settle() only turns the page within a while of a touch, wheel, press or
    page turn; and when the track changes width, the current page is lined up
    again.
  */
  const USER_SCROLL_MS = 4000;
  let lastUserScroll = -Infinity;
  const markUserScroll = () => { lastUserScroll = performance.now(); };

  function alignCurrent() {
    const slide = currentSlide();
    if (!slide) return;
    el.reader.style.scrollSnapType = 'none';
    slide.el.scrollIntoView({ behavior: 'instant', inline: 'start', block: 'nearest' });
    const snapBack = () => { el.reader.style.scrollSnapType = ''; };
    requestAnimationFrame(snapBack);
    setTimeout(snapBack);
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 150);
  }

  /*
    Look as soon as the track stops moving, not only once it has been quiet for
    a while. A reader's next swipe usually begins before the one before it has
    finished, and every scroll event put the wait off again, so through a run
    of quick swipes the track was never rebuilt: the reader ran off the end of
    it and bounced there, with the page number and the dropdown left behind on
    the page the run started from, and no page ever new enough to show its
    spinner.

    At rest means the position held still from one frame to the next. Merely
    passing through a page's alignment is not rest: adopting a page mid-flight
    rebuilds the track under the momentum that is still running, and the swipe
    carries on into the page after it.
  */
  function settleSoon() {
    if (settleFrame !== null) return;

    settleFrame = requestAnimationFrame(() => {
      settleFrame = null;

      const at = el.reader.scrollLeft;

      if (at === lastScrollLeft) {
        settle();
      } else {
        lastScrollLeft = at;
        settleSoon();
      }
    });
  }

  function goTo(page) {
    page = clampPage(page);
    if (page === state.page) return;
    const neighbour = slides.get(slideKey(state.lang, page));
    markUserScroll();
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

  // ---- Contents: chapters and sections (book.js contents, from
  // contents.json), plus a box to go to a page by number. ----

  const CONTENTS = (window.BOOK.contents || []).map(([level, page, ar, en], i) => ({ level, page, ar, en, i }));

  // The entry the page is in: the last one starting on or before it.
  function entryFor(page, maxLevel = 3) {
    let found = null;
    for (const entry of CONTENTS) {
      if (entry.page > page) break;
      if (entry.level <= maxLevel) found = entry;
    }
    return found;
  }

  function applyContentsChrome(t) {
    // The button says where you are: the section (or chapter) you're in.
    const here = entryFor(state.page, 2);
    const title = here ? here[state.lang] : `${t.page} ${state.page}`;
    el.contentsLabel.textContent = title;
    el.contentsBtn.title = `${t.contents} — ${title}`;
    el.contentsBtn.setAttribute('aria-label', `${t.contents}: ${title}`);
    el.contentsTitle.textContent = t.contents;
    el.contentsClose.setAttribute('aria-label', t.close);
    el.contentsClose.title = t.close;
    el.pageJumpLabel.textContent = t.goToPage;
    el.pageInput.max = String(TOTAL);
    el.pageTotal.textContent = `${t.of} ${TOTAL}`;
    el.pageGo.textContent = t.go;
  }

  // The list: chapters, each with its sections folded away under a toggle,
  // built for the reader's language when the panel opens.
  function buildContents() {
    const t = LABELS[state.lang];
    const current = entryFor(state.page);
    const chapterOf = (entry) => {
      let chapter = null;
      for (const e of CONTENTS) {
        if (e.i > entry.i) break;
        if (e.level === 1) chapter = e;
      }
      return chapter;
    };
    const openChapter = current && chapterOf(current);
    el.contentsList.replaceChildren();
    let group = null;
    for (const entry of CONTENTS) {
      const li = document.createElement('li');
      li.className = `contents-entry level-${entry.level}`;
      const row = document.createElement('div');
      row.className = 'contents-row';
      const link = document.createElement('a');
      link.href = `#${state.lang}/${entry.page}`;
      link.className = 'contents-link';
      const title = document.createElement('span');
      title.textContent = entry[state.lang];
      const page = document.createElement('span');
      page.className = 'contents-page';
      page.textContent = entry.page;
      link.append(title, page);
      if (current && entry.i === current.i) link.setAttribute('aria-current', 'location');
      row.append(link);
      li.append(row);
      if (entry.level === 1) {
        group = document.createElement('ol');
        group.className = 'contents-sections';
        li.append(group);
        el.contentsList.append(li);
        group.hidden = entry !== openChapter;
        li.dataset.chapter = String(entry.i);
      } else if (group) {
        group.append(li);
      } else {
        el.contentsList.append(li);
      }
    }
    // A toggle for each chapter that has sections.
    for (const li of el.contentsList.querySelectorAll(':scope > li[data-chapter]')) {
      const sections = li.querySelector('.contents-sections');
      if (!sections.children.length) continue;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'contents-toggle';
      toggle.setAttribute('aria-label', t.expand);
      toggle.setAttribute('aria-expanded', String(!sections.hidden));
      toggle.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
      toggle.addEventListener('click', () => {
        sections.hidden = !sections.hidden;
        toggle.setAttribute('aria-expanded', String(!sections.hidden));
      });
      li.querySelector('.contents-row').prepend(toggle);
    }
  }

  function openContents() {
    buildContents();
    el.pageInput.value = String(state.page);
    el.contents.showModal();
    const current = el.contentsList.querySelector('[aria-current]');
    if (current) current.scrollIntoView({ block: 'center' });
  }

  el.contentsBtn.addEventListener('click', openContents);
  el.contentsClose.addEventListener('click', () => el.contents.close());
  // A tap on the dimmed page around the panel closes it.
  el.contents.addEventListener('click', (e) => {
    if (e.target === el.contents) el.contents.close();
  });
  el.contentsList.addEventListener('click', (e) => {
    const link = e.target.closest('a.contents-link');
    if (!link) return;
    e.preventDefault();
    el.contents.close();
    goTo(link.getAttribute('href').split('/')[1]);
  });
  el.pageJump.addEventListener('submit', (e) => {
    e.preventDefault();
    el.contents.close();
    goTo(el.pageInput.value);
  });
  if (!CONTENTS.length) el.contentsList.hidden = true;

  // ---- Setup ----

  el.prev.addEventListener('click', () => goTo(state.page - 1));
  el.next.addEventListener('click', () => goTo(state.page + 1));
  el.lang.addEventListener('click', () => setLang(state.lang === 'ar' ? 'en' : 'ar'));
  Site.bindThemeToggle(el.theme);
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
    if (e.altKey || e.ctrlKey || e.metaKey || el.contents.open) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const forwardKey = state.lang === 'ar' ? 'ArrowLeft' : 'ArrowRight';
    goTo(state.page + (e.key === forwardKey ? 1 : -1));
  });

  // Swiping is the track scrolling. Wait for the scrolling to stop before
  // deciding where it came to rest.
  for (const type of ['touchstart', 'touchmove', 'wheel', 'pointerdown']) {
    el.reader.addEventListener(type, markUserScroll, { passive: true });
  }
  let trackWidth = el.reader.clientWidth;
  new ResizeObserver(() => {
    if (el.reader.clientWidth === trackWidth) return;
    trackWidth = el.reader.clientWidth;
    alignCurrent();
  }).observe(el.reader);
  el.reader.addEventListener('touchend', settleSoon, { passive: true });
  el.reader.addEventListener('touchcancel', settleSoon, { passive: true });
  el.reader.addEventListener('scroll', settleSoon, { passive: true });
  el.reader.addEventListener('scrollend', settle);

  render();
})();
