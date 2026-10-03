// First-visit tip that points at the text size buttons (− / +).
// Shown once per device; it goes for good on "Got it", Escape, or a tap on − or +.
// Add ?sizetip to the address to see it again.
(() => {
  const storageKey = (window.BOOK && window.BOOK.storageKey) || 'maqasid';
  const SEEN_KEY = storageKey + ':sizeTipSeen';
  const target = document.querySelector('.font-size');
  if (!target) return;

  const read = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return '1'; } };
  const write = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ } };
  if (new URLSearchParams(location.search).has('sizetip')) {
    try { localStorage.removeItem(SEEN_KEY); } catch { /* storage unavailable */ }
  }
  if (read() === '1') return;

  const TEXT = {
    ar: { tip: 'اضغط − أو + لتصغير الخط أو تكبيره.', ok: 'حسنًا' },
    en: { tip: 'Tap − or + to make the text smaller or larger.', ok: 'Got it' },
  };

  const tip = document.createElement('div');
  tip.id = 'size-tip';
  tip.setAttribute('role', 'dialog');
  tip.hidden = true;
  tip.innerHTML = '<p id="size-tip-text"></p><div class="size-tip-actions"><button type="button" class="size-tip-close"></button></div>';
  tip.setAttribute('aria-labelledby', 'size-tip-text');
  document.body.append(tip);
  const text = tip.querySelector('p');
  const close = tip.querySelector('button');

  function label() {
    const lang = document.documentElement.lang === 'en' ? 'en' : 'ar';
    tip.lang = lang;
    tip.dir = lang === 'ar' ? 'rtl' : 'ltr';
    text.textContent = TEXT[lang].tip;
    close.textContent = TEXT[lang].ok;
  }

  function place() {
    if (tip.hidden) return;
    const rect = target.getBoundingClientRect();
    const margin = 16;
    const width = tip.offsetWidth;
    const centre = rect.left + rect.width / 2;
    const left = Math.max(margin, Math.min(centre - width / 2, window.innerWidth - width - margin));
    tip.style.left = left + 'px';
    tip.style.top = (rect.top - tip.offsetHeight - 12) + 'px';
    tip.style.setProperty('--arrow-x', Math.max(18, Math.min(centre - left, width - 18)) + 'px');
  }

  function show() {
    if (read() === '1') return;
    label();
    tip.hidden = false;
    target.classList.add('tip-target');
    place();
  }

  function dismiss() {
    write();
    tip.hidden = true;
    target.classList.remove('tip-target');
  }

  close.addEventListener('click', dismiss);
  target.addEventListener('click', dismiss);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !tip.hidden) dismiss(); });
  window.addEventListener('resize', place);
  // Follow the reader's language: switching rewrites the tip and may move the buttons.
  new MutationObserver(() => { if (!tip.hidden) { label(); place(); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(show, 600));
})();
