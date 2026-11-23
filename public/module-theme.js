(function () {
  if (window.TLTheme) return;
  var root = document.documentElement;
  var file = (location.pathname.split('/').pop() || '').replace(/\.html?$/, '') || 'module';
  var moduleId = (root.getAttribute('data-tl-module') || file).replace(/[^a-z0-9_-]/gi, '');
  var choiceCookie = 'tl_mt_' + moduleId;
  var listeners = [];
  var css = [
    'html:root[data-tl-theme="wics"]{color-scheme:light;--bg:#d7d6cb;--panel:#ffffff;--panel2:#eef0e8;--cell:#e0e2d8;--line:#c5c7bb;--text:#13203a;--muted:#5c6a82;--accent:#0594d0;--accent2:#6f83b5;--good:#1d8a5a;--bad:#c8344f;--warn:#b98500;',
    '--wics-bg:#d7d6cb;--wics-panel:#ffffff;--wics-side:#dddddd;--wics-head:#e0e2d8;--wics-bar:#6f83b5;--wics-accent:#0594d0;--wics-text:#13203a;--wics-muted:#5c6a82;--wics-line:#c5c7bb}',
    'html:root[data-tl-theme="wics"] button.primary{background:#077db3;color:#ffffff}html:root[data-tl-theme="wics"] button.primary:hover{background:#066c9b}',
    'html:root[data-tl-theme="wics"] .overlay{background:rgba(19,32,58,.82)}',
    '.tl-theme-toggle{font:600 12px "TL Fox Dollar",Inter,system-ui,sans-serif;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;border:1px solid var(--line,#26324c);background:var(--panel,#131a2a);color:var(--text,#e8eefc);cursor:pointer}',
    '.tl-theme-toggle:focus-visible{outline:2px solid var(--accent,#39d0ff);outline-offset:2px}',
    '.tl-theme-toggle[hidden]{display:none}',
    '.tl-theme-toggle-float{position:fixed;left:10px;bottom:10px;z-index:2147483000;opacity:.9}'
  ].join('');

  function readCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) { return null; }
  }

  function parentRoot() {
    try { return window.parent !== window ? window.parent.document.documentElement : null; } catch (e) { return null; }
  }

  function siteTheme() {
    var parent = parentRoot();
    var fromParent = parent && parent.getAttribute('data-theme');
    if (fromParent) return fromParent;
    return readCookie('vv_theme') || 'wics';
  }

  function choice() { return readCookie(choiceCookie) === 'original' ? 'original' : 'site'; }

  function current() { return siteTheme() === 'wics' && choice() !== 'original' ? 'wics' : 'original'; }

  var applied = null;
  function apply() {
    var next = current();
    if (next === 'wics') root.setAttribute('data-tl-theme', 'wics');
    else root.removeAttribute('data-tl-theme');
    syncToggles();
    if (next === applied) return;
    applied = next;
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](next); } catch (e) {} }
    try { window.dispatchEvent(new CustomEvent('tl-theme-change', { detail: { theme: next } })); } catch (e) {}
  }

  function setChoice(mode) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = choiceCookie + '=' + (mode === 'original' ? 'original' : 'site') + '; Path=/; SameSite=Lax; Max-Age=31536000' + secure;
    apply();
  }

  var toggles = [];
  function syncToggles() {
    var available = siteTheme() === 'wics';
    var wics = current() === 'wics';
    for (var i = 0; i < toggles.length; i++) {
      var button = toggles[i];
      button.hidden = !available;
      button.setAttribute('aria-pressed', wics ? 'true' : 'false');
      button.textContent = wics ? 'Theme: WICS' : 'Theme: Original';
      button.title = wics ? 'Switch to this module’s original colors' : 'Switch to the WICS colors';
    }
  }

  function makeToggle(extraClass) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'tl-theme-toggle' + (extraClass ? ' ' + extraClass : '');
    button.addEventListener('click', function () { setChoice(current() === 'wics' ? 'original' : 'site'); button.blur(); });
    toggles.push(button);
    syncToggles();
    return button;
  }

  function mountToggles() {
    var slots = document.querySelectorAll('[data-tl-theme-toggle]');
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].getAttribute('data-tl-theme-mounted')) continue;
      slots[i].setAttribute('data-tl-theme-mounted', '1');
      slots[i].appendChild(makeToggle(slots[i].getAttribute('data-tl-theme-toggle') || ''));
    }
    if (!slots.length && root.getAttribute('data-tl-theme-float') !== 'off' && document.body) document.body.appendChild(makeToggle('tl-theme-toggle-float'));
  }

  var style = document.createElement('style');
  style.id = 'tl-module-theme';
  style.textContent = css;
  (document.head || root).appendChild(style);
  apply();

  var parent = parentRoot();
  if (parent && typeof MutationObserver !== 'undefined') new MutationObserver(apply).observe(parent, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('focus', apply);
  window.addEventListener('storage', apply);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountToggles);
  else mountToggles();

  window.TLTheme = {
    get: current,
    isWics: function () { return current() === 'wics'; },
    set: setChoice,
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    toggle: makeToggle,
    css: function (name, fallback) { var value = getComputedStyle(root).getPropertyValue(name).trim(); return value || fallback; }
  };
})();
