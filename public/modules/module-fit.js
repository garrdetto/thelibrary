(() => {
  if (window.tlFit) return;
  const MIN_DOC_ZOOM = 0.3;
  const MIN_BOX_ZOOM = 0.5;
  const watched = new Map();
  let queued = false;

  const style = document.createElement('style');
  style.textContent = `
html.tl-fit-doc { overflow: hidden !important; }
html.tl-fit-doc body { padding-top: 10px !important; padding-bottom: 10px !important; align-items: flex-start; }
html.tl-fit-doc main > footer { display: none !important; }
.tl-fit-box::-webkit-scrollbar { display: none; }
.tl-help-btn { position: fixed; top: 8px; right: 8px; z-index: 60; width: 32px; height: 32px; padding: 0; border-radius: 50%; font: 800 16px Inter, system-ui, sans-serif; display: grid; place-items: center; cursor: pointer; color: var(--text, #e8eefc); background: var(--panel, #131a2a); border: 1px solid var(--line, #26324c); opacity: .85; }
.tl-help-btn:hover, .tl-help-btn:focus-visible { opacity: 1; border-color: var(--accent, #39d0ff); }
.tl-help { position: fixed; inset: 0; z-index: 70; display: none; align-items: center; justify-content: center; padding: 16px; background: rgba(5, 8, 15, .6); }
.tl-help.show { display: flex; }
.tl-help-card { position: relative; width: min(560px, 100%); max-height: 100%; overflow: auto; padding: 18px 20px; border-radius: 14px; background: var(--panel, #131a2a); color: var(--text, #e8eefc); border: 1px solid var(--line, #26324c); font: 14px/1.6 Inter, system-ui, sans-serif; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
.tl-help-card h2 { margin: 0 0 8px; font: 700 22px Rajdhani, Inter, sans-serif; }
.tl-help-card .tl-help-close { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; padding: 0; border-radius: 50%; }
`;
  document.head.appendChild(style);

  function zoomTargets(entry) {
    if (entry.doc) return [document.querySelector('body > main') || document.body];
    return Array.from(entry.el.children).filter((child) => !child.hasAttribute('data-tl-nofit'));
  }

  function box(entry) {
    if (entry.doc) {
      const root = document.documentElement;
      return { ch: innerHeight, cw: innerWidth, sh: root.scrollHeight, sw: root.scrollWidth };
    }
    const el = entry.el;
    const cs = getComputedStyle(el);
    let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
    for (const child of el.children) {
      if (child.hasAttribute('data-tl-nofit')) continue;
      const pos = getComputedStyle(child).position;
      if (pos === 'fixed' || pos === 'sticky') continue;
      for (const rect of child.getClientRects()) {
        if (rect.width === 0 && rect.height === 0) continue;
        top = Math.min(top, rect.top); left = Math.min(left, rect.left);
        bottom = Math.max(bottom, rect.bottom); right = Math.max(right, rect.right);
      }
    }
    if (bottom === -Infinity) return { ch: el.clientHeight, cw: el.clientWidth, sh: 0, sw: 0 };
    const sh = bottom - top + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const sw = right - left + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    return { ch: el.clientHeight, cw: el.clientWidth, sh, sw };
  }

  function apply(entry, zoom) {
    entry.zoom = zoom;
    const value = zoom >= 0.999 ? '' : String(zoom);
    for (const target of zoomTargets(entry)) target.style.zoom = value;
  }

  function fit(entry) {
    hideBars(entry);
    if (!entry.doc && !entry.el.isConnected) { watched.delete(entry.el); return; }
    if (!entry.doc && entry.el.getClientRects().length === 0) return;
    apply(entry, 1);
    if (!entry.doc) { entry.el.style.overflow = ''; entry.el.scrollTop = 0; entry.el.scrollLeft = 0; }
    const first = box(entry);
    if (first.ch < 2 || first.cw < 2) return;
    const min = entry.doc ? MIN_DOC_ZOOM : MIN_BOX_ZOOM;
    const fits = (b) => b.sh <= b.ch + 0.5 && b.sw <= b.cw + 0.5;
    const fitsAt = (z) => { apply(entry, z); return fits(box(entry)); };
    let zoom = 1;
    if (!fits(first)) {
      const guess = Math.max(min, Math.min(0.99, 1 / Math.max(first.sh / first.ch, first.sw / first.cw)));
      let lo = min, hi = 1;
      if (fitsAt(guess)) lo = guess; else hi = guess;
      if (lo === min && !fitsAt(min)) hi = min;
      for (let i = 0; i < 7 && hi - lo > 0.01; i += 1) {
        const mid = (lo + hi) / 2;
        if (fitsAt(mid)) lo = mid; else hi = mid;
      }
      zoom = lo;
      apply(entry, zoom);
    }
    if (!entry.doc) {
      entry.el.style.overflow = zoom > min ? 'hidden' : '';
      entry.el.scrollTop = 0;
      entry.el.scrollLeft = 0;
    }
  }

  function hideBars(entry) {
    if (entry.doc || entry.styled) return;
    entry.styled = true;
    entry.el.style.scrollbarWidth = 'none';
    entry.el.classList.add('tl-fit-box');
  }

  function fitAll() {
    queued = false;
    for (const entry of watched.values()) fit(entry);
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(fitAll);
  }

  const resize = new ResizeObserver(schedule);
  let selector = '[data-tl-fit]';
  function scan(root) {
    if (!(root instanceof Element)) return;
    if (root.matches(selector)) watch(root);
    root.querySelectorAll(selector).forEach(watch);
  }
  const mutate = new MutationObserver((records) => {
    let touched = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        scan(node);
      }
      if (!touched) for (const [el, entry] of watched) if (!entry.doc && el.contains(record.target)) { touched = true; break; }
    }
    if (touched) schedule();
  });

  function watch(el) {
    if (!el || watched.has(el)) return;
    const entry = { el, doc: false, zoom: 1 };
    watched.set(el, entry);
    resize.observe(el);
    for (const child of el.children) resize.observe(child);
    schedule();
  }

  function helpButton(footer) {
    if (!footer || !footer.textContent.trim()) return;
    const title = document.querySelector('h1')?.textContent?.trim() || 'How to play';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tl-help-btn';
    button.textContent = '?';
    button.title = 'How to play';
    button.setAttribute('aria-label', 'How to play');
    const layer = document.createElement('div');
    layer.className = 'tl-help';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'How to play');
    const card = document.createElement('div');
    card.className = 'tl-help-card';
    const heading = document.createElement('h2');
    heading.textContent = `How to play ${title}`;
    const body = document.createElement('div');
    body.innerHTML = footer.innerHTML;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tl-help-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    card.append(close, heading, body);
    layer.append(card);
    const hide = () => { layer.classList.remove('show'); button.focus(); };
    button.addEventListener('click', () => { layer.classList.add('show'); close.focus(); });
    close.addEventListener('click', hide);
    layer.addEventListener('click', (event) => { if (event.target === layer) hide(); });
    layer.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); hide(); } });
    button.addEventListener('keydown', (event) => event.stopPropagation());
    document.body.append(button, layer);
  }

  function fitDocument() {
    document.documentElement.classList.add('tl-fit-doc');
    helpButton(document.querySelector('main > footer'));
    const entry = { el: document.documentElement, doc: true, zoom: 1 };
    watched.set(document.documentElement, entry);
    resize.observe(document.body);
    const main = document.querySelector('main');
    if (main) resize.observe(main);
    addEventListener('resize', schedule);
    schedule();
  }

  function start() {
    const script = document.querySelector('script[src$="module-fit.js"]');
    if (script?.hasAttribute('data-doc')) fitDocument();
    if (script?.dataset.fit) selector += `, ${script.dataset.fit}`;
    scan(document.body);
    mutate.observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', schedule);
    document.fonts?.ready?.then(schedule);
    addEventListener('load', schedule);
  }

  window.tlFit = { watch, refit: schedule };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
