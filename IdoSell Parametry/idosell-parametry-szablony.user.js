// ==UserScript==
// @name         IdoSell - Parametry Toolbar
// @namespace    https://idosell.com/
// @version      4.6.27
// @description  Toolbar do grupowej edycji parametrow: panel-pro v1.2.4 inline + new-panel support, checkboxy, zaznaczanie, rozwijanie/zwijanie, grupowe usuwanie/edycja, import CSV
// @author       SyncOffer
// @match        https://*.iai-shop.com/panel/app/parameters.php*
// @match        https://*.idosell.com/panel/app/parameters.php*
// @match        https://*.iai-shop.com/panel/parameters.php*
// @match        https://*.idosell.com/panel/parameters.php*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // v4.5.52: strona jest React SPA (/panel/app/parameters.php) z iframe-em
  // pod /panel/parameters.php. Skrypt powinien działać TYLKO w wewnętrznym
  // iframe — tam mamy bezpośredni dostęp do drzewa #block_group0. W outer
  // React SPA splash trafiał pod hydraty React i był maskowany.
  if (location.pathname === '/panel/app/parameters.php') {
    try { console.log('[parametry v4.5.52] outer React shell — skrypt nieaktywny tutaj, czekamy na iframe'); } catch (e) {}
    return;
  }

  // v4.5.52: pre-hide native panel + splash overlay (uruchamiane w iframe).
  // Hide'ujemy własne body — splash jako overlay nad nim.
  (function preHide() {
    try { console.log('[parametry v4.5.52] preHide start, path=', location.pathname); } catch (e) {}
    var preStyle = document.createElement('style');
    preStyle.id = 'tp-prehide-style';
    preStyle.textContent = [
      '/* Ukryj zawartość body dopóki nie zamontujemy widoku */',
      'html.tp-prehide body > *:not(#tp-loading-splash) { visibility: hidden !important; }',
      '#tp-loading-splash { position: fixed; inset: 0; background: linear-gradient(180deg,#f8fafc,#eef2f7); z-index: 2147483645; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; font-family: "Segoe UI",Roboto,sans-serif; color: #334155; transition: opacity 0.25s; }',
      '#tp-loading-splash .tp-splash-card { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 32px 48px; background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }',
      '#tp-loading-splash .tp-spinner { width: 48px; height: 48px; border: 4px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: tp-spin 0.8s linear infinite; }',
      '#tp-loading-splash .tp-splash-title { font-size: 15px; font-weight: 600; color: #0f172a; }',
      '#tp-loading-splash .tp-splash-sub { font-size: 12px; color: #64748b; }',
      '@keyframes tp-spin { to { transform: rotate(360deg); } }',
      '#tp-loading-splash.tp-hide { opacity: 0; pointer-events: none; }'
    ].join('\n');
    (document.head || document.documentElement).appendChild(preStyle);
    document.documentElement.classList.add('tp-prehide');

    function ensureSplash() {
      if (!document.body) return;
      if (document.getElementById('tp-loading-splash')) return;
      var splash = document.createElement('div');
      splash.id = 'tp-loading-splash';
      splash.innerHTML = '<div class="tp-splash-card"><div class="tp-spinner"></div><div class="tp-splash-title">Ładowanie panelu Parametrów</div><div class="tp-splash-sub">Inicjalizacja widoku rozszerzonego…</div></div>';
      document.body.appendChild(splash);
    }
    if (document.body) ensureSplash();
    else {
      var splashTimer = setInterval(function () {
        if (document.body) { ensureSplash(); clearInterval(splashTimer); }
      }, 20);
    }

    // Safety: po 30s zdejmij splash niezależnie od stanu (gdyby coś padło)
    setTimeout(function () {
      var s = document.getElementById('tp-loading-splash');
      if (s) { s.classList.add('tp-hide'); setTimeout(function () { try { s.remove(); } catch (e) {} }, 250); }
      var st = document.getElementById('tp-prehide-style');
      if (st) try { st.remove(); } catch (e) {}
    }, 30000);
  })();

  function _tpRevealReadyView() {
    try { document.documentElement.classList.remove('tp-prehide'); } catch (e) {}
    var s = document.getElementById('tp-loading-splash');
    if (s) { s.classList.add('tp-hide'); setTimeout(function () { try { s.remove(); } catch (e) {} }, 250); }
    var st = document.getElementById('tp-prehide-style');
    if (st) try { st.remove(); } catch (e) {}
  }

  // v4.5.55: localStorage cache z TTL — pierwszy fetch zapisuje, kolejne wejścia
  // czytają natychmiast. Pomaga przy children/products/context — drugie wejście
  // na parameters.php pokazuje pełne kolumny od ręki.
  var TP_CACHE_HOST = (location.hostname || 'host').replace(/[^a-zA-Z0-9.-]/g, '_');
  var TP_TTL_CTX      = 24 * 60 * 60 * 1000; // 24 h — kontekst rzadko się zmienia
  var TP_TTL_CHILDREN = 60 * 60 * 1000;      // 1 h — liczba wartości
  var TP_TTL_PRODUCTS = 30 * 60 * 1000;      // 30 min — przypisania produktów

  function _tpCacheKey(scope, id) { return 'tp.' + TP_CACHE_HOST + '.' + scope + '.' + id; }

  function tpCacheGet(scope, id, ttlMs) {
    try {
      var raw = localStorage.getItem(_tpCacheKey(scope, id));
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.t !== 'number') return null;
      if (Date.now() - obj.t > ttlMs) return null;
      return obj.v;
    } catch (e) { return null; }
  }
  function tpCacheSet(scope, id, value) {
    try { localStorage.setItem(_tpCacheKey(scope, id), JSON.stringify({ t: Date.now(), v: value })); }
    catch (e) { /* quota / privacy mode — ignore */ }
  }
  function tpCacheDel(scope, id) {
    try { localStorage.removeItem(_tpCacheKey(scope, id)); } catch (e) {}
  }
  function tpCacheClearAll() {
    try {
      var prefix = 'tp.' + TP_CACHE_HOST + '.';
      var toDel = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) toDel.push(k);
      }
      toDel.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }
  // v4.5.89: trwały wybór liczby elementów na stronę (bez TTL — ustawienie użytkownika)
  // v4.5.94: opcjonalny scope ('' = parametry, 'Sec' = sekcje)
  function loadPerPagePref(scope) {
    try {
      var raw = localStorage.getItem(_tpCacheKey('pref', 'perPage' + (scope || '')));
      if (raw === null || raw === '') return 50;
      var n = parseInt(raw, 10);
      return isNaN(n) ? 50 : n; // 0 = "wszystko"
    } catch (e) { return 50; }
  }
  function savePerPagePref(n, scope) {
    try { localStorage.setItem(_tpCacheKey('pref', 'perPage' + (scope || '')), String(n)); } catch (e) {}
  }

  // Expose na window dla diagnostyki (F12: tpCacheClearAll())
  try { window.tpCacheClearAll = tpCacheClearAll; } catch (e) {}

  /* === Embedded panel-pro widget v1.2.4 (inline) === */
/* ============================================================================
 * panel-pro v1.2.1
 * Reusable list/tree panel widget for Tampermonkey on IdoSell-style admin pages.
 *
 * v1.2.1 changes vs v1.2.0:
 *   - search icon size increased 18 -> 22px
 *   - tooltip clipping fixed: .panel-pro overflow:visible, border-radius
 *     applied per first/last child (toolbar/footer)
 *   - footer rich content: counter slot, action links (Propozycja/Zglos blad),
 *     version label — configurable via options.footer
 *   - panel.setCounter(html) helper to update counter text
 * ==========================================================================*/
(function (root) {
  'use strict';
  if (root.PanelPro && root.PanelPro.VERSION === '1.2.4') return;

  var VERSION = '1.2.4';
  var STYLE_ID = 'panel-pro-styles-v1_2_4';

  var CSS = [
    /* OpsBar floating cards */
    '.panel-pro__opsbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px 0; }',
    '.panel-pro__opsbar-group { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #fff; padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
    '.panel-pro__opsbar-label { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding-right: 4px; }',
    '.panel-pro__opsbar-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s; }',
    '.panel-pro__opsbar-btn:hover { background: #f8fafc; border-color: #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }',
    '.panel-pro__opsbar-btn .material-symbols-outlined { font-size: 18px; }',
    '.panel-pro__opsbar-btn--primary { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '.panel-pro__opsbar-btn--primary:hover { background: #1d4ed8; border-color: #1d4ed8; }',
    '.panel-pro__opsbar-btn--danger { color: #dc2626; border-color: #fca5a5; }',
    '.panel-pro__opsbar-btn--danger:hover { background: #fef2f2; border-color: #dc2626; }',

    /* Card panel: overflow visible so tooltips can escape */
    '.panel-pro { background: #fff; border: 1px solid #dadce0; border-radius: 8px; display: flex; flex-direction: column; width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; font-family: "Google Sans", Roboto, "Segoe UI", Arial, sans-serif; font-size: 14px; color: #202124; margin: 0 0 24px 0; position: relative; overflow-x: hidden; overflow-y: visible; }',
    '.panel-pro__toolbar:first-child { border-top-left-radius: 8px; border-top-right-radius: 8px; }',
    '.panel-pro__footer:last-child { border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }',
    '.panel-pro > *:not(.panel-pro__header-wrapper) { overflow: visible; }',

    /* Toolbar */
    '.panel-pro__toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #dadce0; }',
    '.panel-pro__toolbar__left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 auto; }',
    '.panel-pro__toolbar__right { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-width: 0; flex: 0 0 auto; justify-content: flex-end; row-gap: 6px; }',
    '.panel-pro__group { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; min-width: 0; flex-wrap: nowrap; }',
    '.panel-pro__separator { width: 1px; height: 20px; background: #dadce0; margin: 0 8px; }',
    '.panel-pro__label { color: #80868b; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; padding: 0; }',

    /* Search — bigger icon, rectangular */
    '.panel-pro__search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 12px; width: 100%; flex: 1 1 auto; max-width: 100%; min-width: 0; transition: border-color 0.2s, box-shadow 0.2s; box-sizing: border-box; }',
    '.panel-pro__search:focus-within { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1); }',
    '.panel-pro__search .material-symbols-outlined { font-size: 20px; color: #5f6368; flex-shrink: 0; }',
    '.panel-pro__search-clear { display: none; align-items: center; justify-content: center; flex-shrink: 0; width: 22px; height: 22px; padding: 0; margin: 0; border: none; background: transparent; border-radius: 50%; cursor: pointer; color: #80868b; transition: background 0.15s, color 0.15s; }',
    '.panel-pro__search-clear:hover { background: #e8eaed; color: #202124; }',
    '.panel-pro__search-clear .material-symbols-outlined { font-size: 18px; color: inherit; }',
    '.panel-pro__search input { border: none !important; outline: none !important; flex: 1; background: transparent !important; font-size: 14px !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; color: #202124 !important; font-family: inherit; min-width: 0; }',
    '.panel-pro__search input::placeholder { color: #9aa0a6; transition: opacity 0.15s; }',
    '.panel-pro__search input:focus::placeholder { opacity: 0; }',

    /* Buttons */
    '.panel-pro__btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; color: #334155; transition: background 0.15s; white-space: nowrap; }',
    '.panel-pro__btn:hover:not(:disabled) { background: #f1f5f9; }',
    '.panel-pro__btn:disabled { opacity: 0.5; cursor: not-allowed; }',
    '.panel-pro__btn .material-symbols-outlined { font-size: 18px; color: #5f6368; }',
    '.panel-pro__btn--icon { padding: 5px; border: 1px solid #dadce0; border-radius: 6px; }',
    '.panel-pro__btn--icon:hover:not(:disabled) { background: #f1f5f9; border-color: #c4c7c5; }',
    '.panel-pro__btn--icon .material-symbols-outlined { font-size: 20px; }',
    '.panel-pro__dropdown__menu--cols { min-width: 180px; padding: 6px 0; }',
    '.panel-pro__dropdown__check { display: flex; align-items: center; gap: 8px; padding: 7px 14px; cursor: pointer; font-size: 13px; color: #334155; user-select: none; }',
    '.panel-pro__dropdown__check:hover { background: #f1f5f9; }',
    '.panel-pro__dropdown__check input { margin: 0; cursor: pointer; accent-color: #2563eb; }',
    '.panel-pro__btn--text { background: transparent; }',
    '.panel-pro__btn--primary { background: #2563eb; color: #fff; }',
    '.panel-pro__btn--primary:hover:not(:disabled) { background: #1d4ed8; }',
    '.panel-pro__btn--primary .material-symbols-outlined { color: #fff; }',
    '.panel-pro__btn--danger { color: #dc2626; }',
    '.panel-pro__btn--danger:hover:not(:disabled) { background: #fef2f2; }',
    '.panel-pro__btn--danger .material-symbols-outlined { color: #dc2626; }',
    '.panel-pro__btn--accent { color: #1565c0; }',
    '.panel-pro__btn--accent:hover:not(:disabled) { background: #e3f2fd; }',

    /* Dropdown */
    '.panel-pro__dropdown { position: relative; display: inline-block; }',
    '.panel-pro__dropdown__toggle { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: #334155; font-family: inherit; font-weight: 500; }',
    '.panel-pro__dropdown__toggle:hover { background: #f1f5f9; }',
    '.panel-pro__dropdown__toggle .material-symbols-outlined { font-size: 18px; color: #5f6368; }',
    '.panel-pro__dropdown__menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 220px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 2147483000; display: none; padding: 4px 0; }',
    '.panel-pro__dropdown__menu.panel-pro--open { display: block; }',
    '.panel-pro__dropdown__item { display: flex; align-items: center; padding: 8px 12px; cursor: pointer; font-size: 13px; color: #334155; gap: 8px; }',
    '.panel-pro__dropdown__item:hover { background: #f1f5f9; }',
    '.panel-pro__dropdown__item.panel-pro--active { background: #eff6ff; color: #1d4ed8; font-weight: 600; }',
    '.panel-pro__dropdown__item .material-symbols-outlined { font-size: 16px; width: 16px; opacity: 0; }',
    '.panel-pro__dropdown__item.panel-pro--active .material-symbols-outlined { opacity: 1; }',

    /* Tooltip (portal: rendered into <body>, escapes overflow:hidden ancestors) */
    '.panel-pro__tooltip { position: fixed; background: #323232; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 6px; max-width: 320px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); pointer-events: none; z-index: 2147483647; text-transform: none; letter-spacing: 0; font-weight: 400; line-height: 1.35; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; opacity: 0; transition: opacity 0.12s; }',
    '.panel-pro__tooltip--visible { opacity: 1; }',

    /* Header wrapper holds thead + selection bar overlay */
    '.panel-pro__header-wrapper { position: relative; overflow: hidden; }',

    /* Table header */
    '.panel-pro__thead { display: grid; column-gap: 10px; align-items: center; padding: 12px 0; background: #efefef; border-bottom: 1px solid #dadce0; font-size: 12px; font-weight: 500; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; box-sizing: border-box; }',
    '.panel-pro__thead > div { padding: 0 8px; text-align: center; min-width: 0; }',
    '.panel-pro__thead .panel-pro__col--name { text-align: left; }',
    '.panel-pro__thead .panel-pro__col-hint { font-size: 10px; color: #9aa0a6; font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 6px; }',
    '.panel-pro__col--hidden { padding: 0 !important; overflow: hidden !important; visibility: hidden !important; }',
    'li.panel-pro__row > div { overflow: hidden; }',

    /* Selection bar — display toggle */
    '.panel-pro__selection-bar { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #eff6ff; border-bottom: 1px solid #bfdbfe; display: none; column-gap: 10px; align-items: center; z-index: 5; box-sizing: border-box; }',
    '.panel-pro__selection-bar.panel-pro--visible { display: grid; }',
    '.panel-pro__selection-bar--floating { position: fixed !important; top: 0 !important; height: auto !important; min-height: 48px; padding: 6px 0; z-index: 1000; box-shadow: 0 2px 8px rgba(0,0,0,0.15); border-radius: 0 0 8px 8px; }',
    '.panel-pro__selection-bar > div { padding: 0 8px; min-width: 0; }',
    '.panel-pro__selection-bar__check { display: flex; align-items: center; justify-content: center; }',
    '.panel-pro__selection-bar__check input { accent-color: #1a73e8; width: 16px; height: 16px; cursor: pointer; }',
    '.panel-pro__selection-bar__content { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-width: 0; }',
    '.panel-pro__selection-bar__left { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: #1d4ed8; }',
    '.panel-pro__selection-bar__count { background: #fff; color: #1d4ed8; padding: 2px 10px; border-radius: 12px; border: 1px solid #bfdbfe; font-size: 12px; font-weight: 700; }',
    '.panel-pro__selection-bar__right { display: flex; align-items: center; gap: 6px; }',
    '.panel-pro__selection-bar__btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; background: #fff; color: #334155; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s; }',
    '.panel-pro__selection-bar__btn:hover { background: #f1f5f9; border-color: #94a3b8; }',
    '.panel-pro__selection-bar__btn .material-symbols-outlined { font-size: 16px; }',
    '.panel-pro__selection-bar__btn--primary { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '.panel-pro__selection-bar__btn--primary:hover { background: #1d4ed8; border-color: #1d4ed8; }',
    '.panel-pro__selection-bar__btn--danger { color: #dc2626; border-color: #fca5a5; }',
    '.panel-pro__selection-bar__btn--danger:hover { background: #fef2f2; border-color: #dc2626; }',
    '.panel-pro__selection-bar__sep { width: 1px; height: 20px; background: #bfdbfe; margin: 0 4px; }',
    '.panel-pro__selection-bar__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; color: #64748b; border-radius: 4px; margin-left: 4px; transition: background 0.15s; }',
    '.panel-pro__selection-bar__close:hover { background: #dbeafe; color: #1d4ed8; }',
    '.panel-pro__selection-bar__close .material-symbols-outlined { font-size: 20px; }',

    /* Body */
    '.panel-pro__tbody { padding: 0; overflow-x: auto; min-width: 0; }',
    '.panel-pro__tbody > ul { list-style: none; margin: 0; padding: 0; }',
    'li.panel-pro__row { display: grid !important; column-gap: 10px; align-items: center; padding: 4px 0 !important; border: none !important; border-radius: 0 !important; border-bottom: 1px solid #e2e8f0 !important; min-height: 37px; transition: background 0.1s; list-style: none !important; margin: 0 !important; box-sizing: border-box; }',
    'li.panel-pro__row > div { padding: 0 8px; min-width: 0; }',
    /* Defensive: native IdoSell elements that sneak into the row should not occupy grid tracks */
    'li.panel-pro__row > .clear, li.panel-pro__row > [id^="iteminfo_"], li.panel-pro__row > [id^="space_"] { display: none !important; }',
    'li.panel-pro__row > ul, li.panel-pro__row > [id^="block_group"] { grid-column: 1 / -1; padding: 0 !important; margin: 0 !important; list-style: none !important; }',
    /* v4.5.21: avoid double separator when a parameter has expanded children. Parent row drops its bottom border; the last child row inside the nested ul still has one. */
    'li.panel-pro__row:has(> ul[id^="block_group"]:not(:empty)) { border-bottom: none !important; }',
    /* Also drop hover-only border on parent while expanded to keep the look consistent */
    'li.panel-pro__row > ul[id^="block_group"] > li.panel-pro__row { margin-left: 0 !important; padding-left: 0 !important; }',
    'li.panel-pro__row:hover { background: #f8fafc; }',
    'li.panel-pro__row.panel-pro--selected { background: #eff6ff !important; }',
    'li.panel-pro__row.panel-pro--selected > * { background: transparent !important; box-shadow: none !important; }',
    'li.panel-pro__row.panel-pro--selected:hover { background: #dbeafe; }',
    'li.panel-pro__row.panel-pro--hidden, li.panel-pro__row.panel-pro--filter-hidden, li.panel-pro__row.panel-pro--view-hidden, li.panel-pro__row.panel-pro--page-hidden { display: none !important; }',

    /* Status toast */
    '.panel-pro__status { position: fixed; bottom: 20px; right: 20px; background: #323232; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-family: inherit; box-shadow: 0 4px 16px rgba(0,0,0,0.25); z-index: 999999; max-width: calc(100vw - 40px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: panel-pro-fade-in 0.2s ease; }',
    '.panel-pro__status--error { background: #d93025; }',
    '@keyframes panel-pro-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }',

    /* Footer + counter + links + version + pagination */
    '.panel-pro__footer { padding: 10px 16px; background: #fff; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; font-size: 13px; color: #5f6368; }',
    '.panel-pro__footer:empty { display: none; }',
    /* v4.5.84: global footer bar (na samym dole strony) */
    '.tp-global-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 5px 20px; margin: 10px 0 0px 0; border-top: 1px solid #e2e8f0; background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); font-family: "Google Sans", Roboto, Arial, sans-serif; }',
    '.tp-global-footer__links { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
    '.tp-global-footer__link, .tp-global-footer__link:hover, .tp-global-footer__link:focus { text-decoration: none !important; }',
    '.tp-global-footer__link { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid #dadce0; border-radius: 6px; background: transparent; color: #5f6368; font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.15s; }',
    '.tp-global-footer__link .material-symbols-outlined { font-size: 14px; }',
    '.tp-global-footer__link:hover { background: #f1f3f4; }',
    '.tp-global-footer__link--feature:hover { background: #eff4ff; color: #2563eb; border-color: #2563eb; }',
    '.tp-global-footer__link--bug:hover { background: #f1f3f4; color: #d93025; border-color: #d93025; }',
    '.tp-global-footer__brand { display: flex; align-items: center; opacity: .9; }',
    '.tp-global-footer__brand svg { height: 34px; width: auto; display: block; }',
    '.panel-pro__footer__left { display: flex; align-items: center; gap: 0; flex-wrap: wrap; }',
    '.panel-pro__sep { color: #dadce0; margin: 0 12px; user-select: none; }',
    '.panel-pro__footer__right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }',
    '.panel-pro__counter { color: #5f6368; font-size: 13px; font-weight: 400; }',
    '.panel-pro__counter--selected { color: #1a73e8; font-weight: 400; }',
    '.panel-pro__counter--total { font-weight: 400; }',
    '.panel-pro__footer-link { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 1px solid #dadce0; border-radius: 6px; background: transparent; color: #5f6368; font-size: 11px; font-weight: 500; font-family: inherit; cursor: pointer; transition: all 0.15s; text-decoration: none; }',
    '.panel-pro__footer-link .material-symbols-outlined { font-size: 14px; }',
    '.panel-pro__footer-link:hover { background: #f1f3f4; }',
    '.panel-pro__footer-link--feature:hover { background: #eff4ff; color: #2563eb; border-color: #2563eb; }',
    '.panel-pro__footer-link--bug:hover { background: #f1f3f4; color: #d93025; border-color: #d93025; }',
    '.panel-pro__version { color: #9aa0a6; font-size: 11px; }',
    '.panel-pro__pagination { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }',
    '.panel-pro__pagination__info { color: #5f6368; font-size: 12px; margin: 0; }',
    '.panel-pro__pagination__btn, .panel-pro__pagination__page { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; color: #334155; font-family: inherit; }',
    '.panel-pro__pagination__btn:hover:not(:disabled), .panel-pro__pagination__page:hover:not(.panel-pro--active) { background: #f8fafc; border-color: #cbd5e1; }',
    '.panel-pro__pagination__page--active { background: #2563eb !important; color: #fff !important; border-color: #2563eb !important; }',
    '.panel-pro__pagination__btn:disabled { opacity: 0.4; cursor: not-allowed; }',
    '.panel-pro__pagination__per-page { display: inline-flex !important; align-items: center; gap: 8px !important; }',
    '.panel-pro__pagination__per-page-label { color: #5f6368; font-size: 12px; margin-right: 8px !important; }',
    '.panel-pro__pagination__per-page select { margin-left: 4px !important; padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; font-size: 13px; font-family: inherit; }',
    ''
  ].join('\n');

  function injectStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  // v1.2.5: portal tooltip — attach once per document so tooltips escape overflow:hidden ancestors
  var _tooltipEl = null, _tooltipTarget = null, _tooltipShowTimer = null, _tooltipHideTimer = null;
  function installPortalTooltips(doc) {
    if (doc.defaultView && doc.defaultView.__panelProTooltipsInstalled) return;
    if (doc.defaultView) doc.defaultView.__panelProTooltipsInstalled = true;

    function ensureEl() {
      if (_tooltipEl && _tooltipEl.isConnected) return _tooltipEl;
      _tooltipEl = doc.createElement('div');
      _tooltipEl.className = 'panel-pro__tooltip';
      doc.body.appendChild(_tooltipEl);
      return _tooltipEl;
    }

    function positionFor(target) {
      var rect = target.getBoundingClientRect();
      var tEl = ensureEl();
      tEl.style.top = '-9999px'; tEl.style.left = '-9999px';
      tEl.textContent = target.getAttribute('data-pp-tooltip') || '';
      // measure
      var tw = tEl.offsetWidth, th = tEl.offsetHeight;
      var vw = (doc.defaultView || window).innerWidth;
      var left = rect.left + (rect.width / 2) - (tw / 2);
      if (left < 6) left = 6;
      if (left + tw > vw - 6) left = vw - tw - 6;
      var top = rect.top - th - 8;
      if (top < 6) top = rect.bottom + 8;
      tEl.style.left = Math.round(left) + 'px';
      tEl.style.top = Math.round(top) + 'px';
    }

    function show(target) {
      if (!target || !target.getAttribute) return;
      var txt = target.getAttribute('data-pp-tooltip');
      if (!txt) return;
      _tooltipTarget = target;
      clearTimeout(_tooltipHideTimer);
      clearTimeout(_tooltipShowTimer);
      _tooltipShowTimer = setTimeout(function () {
        if (_tooltipTarget !== target) return;
        var tEl = ensureEl();
        tEl.textContent = txt;
        positionFor(target);
        tEl.classList.add('panel-pro__tooltip--visible');
      }, 120);
    }

    function hide() {
      _tooltipTarget = null;
      clearTimeout(_tooltipShowTimer);
      clearTimeout(_tooltipHideTimer);
      _tooltipHideTimer = setTimeout(function () {
        if (_tooltipEl) _tooltipEl.classList.remove('panel-pro__tooltip--visible');
      }, 60);
    }

    doc.addEventListener('mouseover', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-pp-tooltip]') : null;
      if (t) show(t);
    }, true);
    doc.addEventListener('mouseout', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-pp-tooltip]') : null;
      if (t && t === _tooltipTarget) hide();
    }, true);
    doc.addEventListener('scroll', function () { hide(); }, true);
    doc.addEventListener('click', function () { hide(); }, true);
  }

  function injectMaterialFont(doc) {
    if (doc.querySelector('link[href*="material-symbols"]')) return;
    var link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
    doc.head.appendChild(link);
  }

  function el(doc, tag, attrs, children) {
    var e = doc.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'className') e.className = attrs[k];
        else if (k === 'textContent') e.textContent = attrs[k];
        else if (k === 'innerHTML') e.innerHTML = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') {
          for (var sk in attrs[k]) e.style[sk] = attrs[k][sk];
        }
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          e.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
        }
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
      });
    }
    return e;
  }

  function icon(doc, name) {
    return el(doc, 'span', { className: 'material-symbols-outlined', textContent: name });
  }

  function buildOpsBarBtn(doc, cfg, ctx) {
    var classes = ['panel-pro__opsbar-btn'];
    if (cfg.variant) classes.push('panel-pro__opsbar-btn--' + cfg.variant);
    var btn = el(doc, 'button', { className: classes.join(' '), type: 'button' });
    if (cfg.tooltip) btn.setAttribute('data-pp-tooltip', cfg.tooltip);
    if (cfg.icon) btn.appendChild(icon(doc, cfg.icon));
    if (cfg.label) btn.appendChild(doc.createTextNode(' ' + cfg.label));
    if (cfg.onClick) btn.addEventListener('click', function (e) { cfg.onClick(e, ctx.api); });
    if (cfg.id) btn.dataset.ppId = cfg.id;
    return btn;
  }

  function buildOpsBar(doc, cfg, ctx) {
    var bar = el(doc, 'div', { className: 'panel-pro__opsbar' });
    function buildSide(side) {
      var group = el(doc, 'div', { className: 'panel-pro__opsbar-group' });
      if (side.label) group.appendChild(el(doc, 'span', { className: 'panel-pro__opsbar-label', textContent: side.label }));
      (side.buttons || []).forEach(function (b) { group.appendChild(buildOpsBarBtn(doc, b, ctx)); });
      return group;
    }
    if (cfg.left) bar.appendChild(buildSide(cfg.left));
    else bar.appendChild(el(doc, 'div'));
    if (cfg.right) bar.appendChild(buildSide(cfg.right));
    else bar.appendChild(el(doc, 'div'));
    return bar;
  }

  function buildButton(doc, cfg, ctx) {
    var classes = ['panel-pro__btn'];
    if (cfg.variant) classes.push('panel-pro__btn--' + cfg.variant);
    var btn = el(doc, 'button', { className: classes.join(' '), type: 'button' });
    if (cfg.tooltip) btn.setAttribute('data-pp-tooltip', cfg.tooltip);
    if (cfg.icon) btn.appendChild(icon(doc, cfg.icon));
    if (cfg.label) btn.appendChild(doc.createTextNode(' ' + cfg.label));
    if (cfg.onClick) btn.addEventListener('click', function (e) { cfg.onClick(e, ctx.api); });
    if (cfg.id) btn.dataset.ppId = cfg.id;
    return btn;
  }

  function buildDropdown(doc, cfg, ctx) {
    var wrap = el(doc, 'div', { className: 'panel-pro__dropdown' });
    var current = (cfg.options || []).find(function (o) { return o.active; }) || (cfg.options || [])[0];
    var toggle = el(doc, 'button', { className: 'panel-pro__dropdown__toggle', type: 'button' });
    if (cfg.icon) toggle.appendChild(icon(doc, cfg.icon));
    var lbl = el(doc, 'span', { className: 'panel-pro__dropdown__label', textContent: current ? current.label : '' });
    toggle.appendChild(lbl);
    toggle.appendChild(icon(doc, 'expand_more'));
    var menu = el(doc, 'div', { className: 'panel-pro__dropdown__menu' });
    function renderItems() {
      menu.innerHTML = '';
      (cfg.options || []).forEach(function (opt) {
        var item = el(doc, 'div', { className: 'panel-pro__dropdown__item' + (opt.active ? ' panel-pro--active' : '') });
        item.appendChild(icon(doc, 'check'));
        item.appendChild(doc.createTextNode(opt.label));
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          (cfg.options || []).forEach(function (o) { o.active = false; });
          opt.active = true;
          lbl.textContent = opt.label;
          menu.classList.remove('panel-pro--open');
          renderItems();
          if (cfg.onChange) cfg.onChange(opt.value, ctx.api);
        });
        menu.appendChild(item);
      });
    }
    renderItems();
    toggle.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('panel-pro--open'); });
    doc.addEventListener('click', function (e) {
      if (!e.target.closest('.panel-pro__dropdown')) menu.classList.remove('panel-pro--open');
    });
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
  }

  // v4.5.71: trwałość widoczności kolumn (localStorage)
  function loadColPrefs(key) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function saveColPrefs(key, hiddenIds) {
    try { localStorage.setItem(key, JSON.stringify(hiddenIds || [])); } catch (e) {}
  }
  function applyColPrefs(columns, cfg) {
    if (!cfg || !cfg.key) return;
    var hidden = loadColPrefs(cfg.key);
    if (!hidden || !hidden.length) return;
    var tog = cfg.toggleable || [];
    columns.forEach(function (c) {
      if (tog.indexOf(c.id) >= 0) c.hidden = hidden.indexOf(c.id) >= 0;
    });
  }

  // v4.5.71: ikona "Pokaż/ukryj kolumny" + menu z checkboxami
  function buildColumnsMenu(doc, columns, cfg, ctx) {
    var wrap = el(doc, 'div', { className: 'panel-pro__dropdown' });
    var toggle = el(doc, 'button', { className: 'panel-pro__btn panel-pro__btn--icon', type: 'button' });
    toggle.setAttribute('data-pp-tooltip', cfg.tooltip || 'Pokaż / ukryj kolumny');
    toggle.appendChild(icon(doc, 'view_week'));
    var menu = el(doc, 'div', { className: 'panel-pro__dropdown__menu panel-pro__dropdown__menu--cols' });
    (cfg.toggleable || []).forEach(function (cid) {
      var col = columns.filter(function (c) { return c.id === cid; })[0];
      if (!col) return;
      var label = (cfg.labels && cfg.labels[cid]) || col.label || cid;
      var item = el(doc, 'label', { className: 'panel-pro__dropdown__check' });
      var cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !col.hidden;
      cb.addEventListener('click', function (e) { e.stopPropagation(); });
      cb.addEventListener('change', function () {
        if (ctx.api && ctx.api.setColumnVisible) ctx.api.setColumnVisible(cid, cb.checked);
        var hid = columns.filter(function (c) {
          return (cfg.toggleable.indexOf(c.id) >= 0) && c.hidden;
        }).map(function (c) { return c.id; });
        saveColPrefs(cfg.key, hid);
      });
      item.appendChild(cb);
      item.appendChild(doc.createTextNode(' ' + label));
      menu.appendChild(item);
    });
    toggle.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('panel-pro--open'); });
    doc.addEventListener('click', function (e) {
      if (!e.target.closest('.panel-pro__dropdown')) menu.classList.remove('panel-pro--open');
    });
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
  }

  function buildToolbar(doc, cfg, ctx, columns, columnsMenuCfg) {
    var toolbar = el(doc, 'div', { className: 'panel-pro__toolbar' });
    var leftWrap = el(doc, 'div', { className: 'panel-pro__toolbar__left' });
    var rightWrap = el(doc, 'div', { className: 'panel-pro__toolbar__right' });

    if (cfg.search) {
      var sb = el(doc, 'div', { className: 'panel-pro__search' });
      sb.appendChild(icon(doc, 'search'));
      var input = el(doc, 'input', { type: 'text', placeholder: cfg.search.placeholder || 'Szukaj...', autocomplete: 'off' });
      var clearBtn = el(doc, 'button', { className: 'panel-pro__search-clear', type: 'button', title: 'Wyczyść' });
      clearBtn.setAttribute('tabindex', '-1');
      clearBtn.appendChild(icon(doc, 'close'));
      var syncClear = function () { clearBtn.style.display = input.value ? 'inline-flex' : 'none'; };
      input.addEventListener('input', function () {
        if (cfg.search.onChange) cfg.search.onChange(input.value, ctx.api);
        syncClear();
      });
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        input.value = '';
        if (cfg.search.onChange) cfg.search.onChange('', ctx.api);
        syncClear();
        input.focus();
      });
      syncClear();
      sb.appendChild(input);
      sb.appendChild(clearBtn);
      leftWrap.appendChild(sb);
    }

    (cfg.sections || []).forEach(function (section, idx) {
      if (idx > 0) rightWrap.appendChild(el(doc, 'div', { className: 'panel-pro__separator' }));
      var group = el(doc, 'div', { className: 'panel-pro__group' });
      if (section.label) group.appendChild(el(doc, 'span', { className: 'panel-pro__label', textContent: section.label }));
      (section.buttons || []).forEach(function (btn) { group.appendChild(buildButton(doc, btn, ctx)); });
      if (section.dropdown) group.appendChild(buildDropdown(doc, section.dropdown, ctx));
      if (section.columnsMenu && columnsMenuCfg && columns) group.appendChild(buildColumnsMenu(doc, columns, columnsMenuCfg, ctx));
      rightWrap.appendChild(group);
    });

    toolbar.appendChild(leftWrap);
    toolbar.appendChild(rightWrap);
    return toolbar;
  }

  function buildSelectionBarBtn(doc, cfg, ctx) {
    var classes = ['panel-pro__selection-bar__btn'];
    if (cfg.variant) classes.push('panel-pro__selection-bar__btn--' + cfg.variant);
    var btn = el(doc, 'button', { className: classes.join(' '), type: 'button' });
    if (cfg.tooltip) btn.setAttribute('data-pp-tooltip', cfg.tooltip);
    if (cfg.icon) btn.appendChild(icon(doc, cfg.icon));
    if (cfg.label) btn.appendChild(doc.createTextNode(' ' + cfg.label));
    if (cfg.onClick) btn.addEventListener('click', function (e) { cfg.onClick(e, ctx.api); });
    return btn;
  }

  function buildSelectionBar(doc, cfg, ctx, columns) {
    var bar = el(doc, 'div', { className: 'panel-pro__selection-bar' });
    var dragWidth = (columns[0] && columns[0].width) || '24px';
    var checkWidth = (columns[1] && columns[1].width) || '40px';
    bar.style.gridTemplateColumns = dragWidth + ' ' + checkWidth + ' 1fr';

    var dragCol = el(doc, 'div');
    var checkCol = el(doc, 'div', { className: 'panel-pro__selection-bar__check' });
    var headerCb = doc.createElement('input');
    headerCb.type = 'checkbox';
    headerCb.checked = true;
    headerCb.addEventListener('change', function () {
      if (cfg.onClear) cfg.onClear(ctx.api);
      ctx.api.setSelection(0);
    });
    checkCol.appendChild(headerCb);

    var contentCol = el(doc, 'div', { className: 'panel-pro__selection-bar__content' });
    var leftCol = el(doc, 'div', { className: 'panel-pro__selection-bar__left' });
    var labelTpl = cfg.selectedLabel || 'Wybrano {n} obiektow';
    leftCol.innerHTML = labelTpl.replace('{n}', '<span class="panel-pro__selection-bar__count">0</span>');

    var rightCol = el(doc, 'div', { className: 'panel-pro__selection-bar__right' });
    (cfg.actions || []).forEach(function (a) { rightCol.appendChild(buildSelectionBarBtn(doc, a, ctx)); });

    if (cfg.extraActions && cfg.extraActions.length) {
      rightCol.appendChild(el(doc, 'span', { className: 'panel-pro__selection-bar__sep' }));
      cfg.extraActions.forEach(function (a) { rightCol.appendChild(buildSelectionBarBtn(doc, a, ctx)); });
    }

    var closeBtn = el(doc, 'button', { className: 'panel-pro__selection-bar__close', type: 'button', title: 'Zamknij' });
    closeBtn.appendChild(icon(doc, 'close'));
    closeBtn.addEventListener('click', function () {
      if (cfg.onClear) cfg.onClear(ctx.api);
      ctx.api.setSelection(0);
    });
    rightCol.appendChild(closeBtn);

    contentCol.appendChild(leftCol);
    contentCol.appendChild(rightCol);

    bar.appendChild(dragCol);
    bar.appendChild(checkCol);
    bar.appendChild(contentCol);
    return bar;
  }

  function updateSelectionBarLabel(bar, count) {
    if (!bar) return;
    var chip = bar.querySelector('.panel-pro__selection-bar__count');
    if (chip) chip.textContent = String(count);
  }

  function buildHeader(doc, columns) {
    var header = el(doc, 'div', { className: 'panel-pro__thead' });
    columns.forEach(function (col) {
      var classes = 'panel-pro__col panel-pro__col--' + col.id;
      if (col.hidden) classes += ' panel-pro__col--hidden';
      var cell = el(doc, 'div', { className: classes });
      if (col.label) cell.appendChild(doc.createTextNode(col.label));
      if (col.hint) cell.appendChild(el(doc, 'span', { className: 'panel-pro__col-hint', textContent: col.hint }));
      header.appendChild(cell);
    });
    return header;
  }

  function gridTemplateFromColumns(columns) {
    return columns.map(function (c) { return c.hidden ? '0' : (c.width || 'auto'); }).join(' ');
  }

  // Generate per-mount CSS rules for hidden columns: hide row cells in matching nth-child positions
  function buildHiddenColsCss(mountId, columns) {
    var rules = [];
    columns.forEach(function (c, idx) {
      if (c.hidden) {
        rules.push('#' + mountId + ' li.panel-pro__row > *:nth-child(' + (idx + 1) + ') { padding: 0 !important; overflow: hidden !important; visibility: hidden !important; }');
      }
    });
    return rules.join('\n');
  }

  function buildPaginationContainer(doc) {
    return el(doc, 'div', { className: 'panel-pro__pagination', id: 'panel-pro-pagination-' + Math.random().toString(36).slice(2, 9) });
  }

  function paginationRange(page, total) {
    if (total <= 7) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var pages = [1];
    if (page > 3) pages.push('...');
    for (var p = Math.max(2, page - 1); p <= Math.min(total - 1, page + 1); p++) pages.push(p);
    if (page < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  function renderPagination(doc, container, state, opts) {
    container.innerHTML = '';
    var page = state.page;
    var perPage = state.perPage;
    var total = state.total;
    if (total === 0) return;
    var totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(total / perPage));
    var start = perPage === 0 ? 1 : (page - 1) * perPage + 1;
    var end = perPage === 0 ? total : Math.min(page * perPage, total);
    var _info = el(doc, 'span', { className: 'panel-pro__pagination__info' });
    _info.innerHTML = '<span class="panel-pro__sep">|</span>Widoczne: ' + start + '-' + end + '<span class="panel-pro__sep">|</span>';
    container.appendChild(_info);
    var prev = el(doc, 'button', { className: 'panel-pro__pagination__btn', type: 'button' });
    prev.appendChild(icon(doc, 'chevron_left'));
    if (page <= 1) prev.disabled = true;
    prev.addEventListener('click', function () { opts.onPageChange(Math.max(1, page - 1)); });
    container.appendChild(prev);
    paginationRange(page, totalPages).forEach(function (p) {
      if (p === '...') {
        container.appendChild(el(doc, 'span', { className: 'panel-pro__pagination__page', textContent: '\u2026', style: { cursor: 'default', border: 'none' } }));
      } else {
        var btn = el(doc, 'button', { className: 'panel-pro__pagination__page' + (p === page ? ' panel-pro__pagination__page--active' : ''), type: 'button', textContent: String(p) });
        btn.addEventListener('click', function () { opts.onPageChange(p); });
        container.appendChild(btn);
      }
    });
    var next = el(doc, 'button', { className: 'panel-pro__pagination__btn', type: 'button' });
    next.appendChild(icon(doc, 'chevron_right'));
    if (page >= totalPages) next.disabled = true;
    next.addEventListener('click', function () { opts.onPageChange(Math.min(totalPages, page + 1)); });
    container.appendChild(next);
    container.appendChild(el(doc, 'span', { className: 'panel-pro__sep', textContent: '|' }));
    var perWrap = el(doc, 'span', { className: 'panel-pro__pagination__per-page' });
    perWrap.appendChild(el(doc, 'span', { className: 'panel-pro__pagination__per-page-label', textContent: 'Poka\u017c na stronie ' }));
    var sel = el(doc, 'select');
    (opts.perPageOptions || [10, 25, 50, 100, 0]).forEach(function (n) {
      var o = el(doc, 'option', { value: String(n), textContent: n === 0 ? 'Wszystkie' : String(n) });
      if (n === perPage) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { opts.onPerPageChange(parseInt(sel.value, 10)); });
    perWrap.appendChild(sel);
    container.appendChild(perWrap);
  }

  var _statusTimer = null;
  function showStatus(doc, msg, isError) {
    var existing = doc.querySelector('.panel-pro__status');
    if (existing) existing.remove();
    if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
    var status = el(doc, 'div', { className: 'panel-pro__status' + (isError ? ' panel-pro__status--error' : ''), textContent: msg });
    doc.body.appendChild(status);
    _statusTimer = setTimeout(function () { status.remove(); _statusTimer = null; }, 3500);
  }

  function ensureId(node) {
    if (!node.id) node.id = 'panel-pro-mount-' + Math.random().toString(36).slice(2, 9);
    return node.id;
  }

  function mount(doc, options) {
    if (!doc || !options) throw new Error('PanelPro.mount: doc + options required');
    if (!options.mountTarget) throw new Error('PanelPro.mount: mountTarget required');

    injectStyles(doc);
    injectMaterialFont(doc);
    installPortalTooltips(doc);

    var columns = options.columns || [];
    if (options.columnsMenu) applyColPrefs(columns, options.columnsMenu);
    var gridTemplate = gridTemplateFromColumns(columns);

    ensureId(options.mountTarget);
    var rowStyleId = 'panel-pro-row-grid-' + Math.random().toString(36).slice(2, 9);
    var rowStyle = doc.createElement('style');
    rowStyle.id = rowStyleId;
    rowStyle.textContent =
      '#' + options.mountTarget.id + ' .panel-pro__thead,' +
      '#' + options.mountTarget.id + ' li.panel-pro__row {' +
      '  grid-template-columns: ' + gridTemplate + ';' +
      '}\n' + buildHiddenColsCss(options.mountTarget.id, columns);
    doc.head.appendChild(rowStyle);

    var ctx = { api: null };
    var opsBar = options.opsBar ? buildOpsBar(doc, options.opsBar, ctx) : null;

    var cardEl = el(doc, 'div', { className: 'panel-pro' });
    var toolbar = options.toolbar ? buildToolbar(doc, options.toolbar, ctx, columns, options.columnsMenu) : null;
    var headerWrapper = el(doc, 'div', { className: 'panel-pro__header-wrapper' });
    var header = buildHeader(doc, columns);
    var selectionBar = options.selectionBar ? buildSelectionBar(doc, options.selectionBar, ctx, columns) : null;
    headerWrapper.appendChild(header);
    if (selectionBar) headerWrapper.appendChild(selectionBar);

    var body = el(doc, 'div', { className: 'panel-pro__tbody' });
    var footer = el(doc, 'div', { className: 'panel-pro__footer' });

    var counterEl = null;
    var paginationContainer = null;
    var footerLeft = el(doc, 'div', { className: 'panel-pro__footer__left' });
    var footerRight = el(doc, 'div', { className: 'panel-pro__footer__right' });

    var fcfg = options.footer || {};
    if (fcfg.counter !== false) {
      counterEl = el(doc, 'span', { className: 'panel-pro__counter', innerHTML: fcfg.counterHtml || '' });
      footerLeft.appendChild(counterEl);
    }
    if (options.pagination) {
      paginationContainer = buildPaginationContainer(doc);
      footerLeft.appendChild(paginationContainer);
    }
    (fcfg.links || []).forEach(function (link) {
      var classes = ['panel-pro__footer-link'];
      if (link.variant) classes.push('panel-pro__footer-link--' + link.variant);
      var elTag = link.href ? 'a' : 'button';
      var attrs = { className: classes.join(' ') };
      if (link.href) { attrs.href = link.href; attrs.target = link.target || '_blank'; attrs.rel = 'noopener'; }
      else { attrs.type = 'button'; }
      if (link.tooltip) attrs.title = link.tooltip;
      var btn = el(doc, elTag, attrs);
      if (link.icon) btn.appendChild(icon(doc, link.icon));
      if (link.label) btn.appendChild(doc.createTextNode(' ' + link.label));
      if (link.onClick) btn.addEventListener('click', function (e) { link.onClick(e, ctx.api); });
      footerRight.appendChild(btn);
    });
    if (fcfg.version) {
      footerRight.appendChild(el(doc, 'span', { className: 'panel-pro__version', textContent: fcfg.version }));
    }
    if (options.footerSlot) footerRight.appendChild(options.footerSlot);

    footer.appendChild(footerLeft);
    footer.appendChild(footerRight);

    if (toolbar) cardEl.appendChild(toolbar);
    cardEl.appendChild(headerWrapper);
    cardEl.appendChild(body);
    cardEl.appendChild(footer);

    if (opsBar) options.mountTarget.appendChild(opsBar);
    options.mountTarget.appendChild(cardEl);

    if (options.treeRoot) body.appendChild(options.treeRoot);

    // v1.2.5: floating selection bar when the card scrolls off the top of the viewport
    var _floatAttached = false;
    function updateSelectionBarFloat() {
      if (!selectionBar) return;
      if (!selectionBar.classList.contains('panel-pro--visible')) {
        if (_floatAttached) {
          selectionBar.classList.remove('panel-pro__selection-bar--floating');
          selectionBar.style.left = ''; selectionBar.style.width = ''; selectionBar.style.top = '';
          _floatAttached = false;
        }
        return;
      }
      var rect = cardEl.getBoundingClientRect();
      var shouldFloat = rect.top < 0 && rect.bottom > 60;
      if (shouldFloat) {
        selectionBar.classList.add('panel-pro__selection-bar--floating');
        selectionBar.style.left = Math.round(rect.left) + 'px';
        selectionBar.style.width = Math.round(rect.width) + 'px';
        _floatAttached = true;
      } else if (_floatAttached) {
        selectionBar.classList.remove('panel-pro__selection-bar--floating');
        selectionBar.style.left = ''; selectionBar.style.width = '';
        _floatAttached = false;
      }
    }
    var _ppWin = doc.defaultView || window;
    _ppWin.addEventListener('scroll', updateSelectionBarFloat, true);
    _ppWin.addEventListener('resize', updateSelectionBarFloat);

    var api = {
      version: VERSION,
      root: cardEl,
      opsBar: opsBar,
      toolbar: toolbar,
      tableHeader: header,
      selectionBar: selectionBar,
      body: body,
      footer: footer,
      counter: counterEl,
      paginationContainer: paginationContainer,
      columns: columns,
      gridTemplate: gridTemplate,
      applyRowGrid: function (li) { if (li && li.classList) li.classList.add('panel-pro__row'); },
      showStatus: function (msg, isError) { showStatus(doc, msg, isError); },
      renderPagination: function (state, opts) { if (paginationContainer) renderPagination(doc, paginationContainer, state, opts); },
      setCounter: function (htmlOrText) { if (counterEl) counterEl.innerHTML = htmlOrText || ''; },
      setSelection: function (count) {
        if (!selectionBar) return;
        if (count > 0) {
          selectionBar.classList.add('panel-pro--visible');
          updateSelectionBarLabel(selectionBar, count);
        } else {
          selectionBar.classList.remove('panel-pro--visible');
        }
        updateSelectionBarFloat();
      },
      findToolbarBtn: function (id) { return cardEl.querySelector('.panel-pro__btn[data-pp-id="' + id + '"]') || cardEl.querySelector('.panel-pro__opsbar-btn[data-pp-id="' + id + '"]'); },
      // v4.5.71: pokaż/ukryj kolumnę w locie (grid + CSS + nagłówek)
      setColumnVisible: function (colId, visible) {
        var col = columns.filter(function (c) { return c.id === colId; })[0];
        if (!col) return;
        col.hidden = !visible;
        var gt = gridTemplateFromColumns(columns);
        gridTemplate = gt;
        rowStyle.textContent =
          '#' + options.mountTarget.id + ' .panel-pro__thead,' +
          '#' + options.mountTarget.id + ' li.panel-pro__row {' +
          '  grid-template-columns: ' + gt + ';' +
          '}\n' + buildHiddenColsCss(options.mountTarget.id, columns);
        var cell = header.querySelector('.panel-pro__col--' + colId);
        if (cell) cell.classList.toggle('panel-pro__col--hidden', !visible);
      },
      destroy: function () {
        cardEl.remove();
        if (opsBar) opsBar.remove();
        var s = doc.getElementById(rowStyleId);
        if (s) s.remove();
      }
    };
    ctx.api = api;
    return api;
  }

  root.PanelPro = { VERSION: VERSION, mount: mount };
})(typeof window !== 'undefined' ? window : this);

  /* === End embedded panel-pro === */


  const AJAX_URL = '/panel/ajax/parameters.php';
  // v4.5.17: detect language from URL ?lang=... (default: pol)
  function detectLangFromUrl() {
    try {
      var urls = [window.top && window.top.location.href, window.location.href];
      for (var i = 0; i < urls.length; i++) {
        if (!urls[i]) continue;
        var m = urls[i].match(/[?&]lang=([a-z]{3})/i);
        if (m) return m[1].toLowerCase();
      }
    } catch (e) {}
    return 'pol';
  }
  const LANG = detectLangFromUrl();

  // =========================================================================
  // LANG META & FLAGS
  // =========================================================================

  const LANG_META = {
    pol: { cc: 'pl', name: 'Polski' },
    eng: { cc: 'gb', name: 'Angielski' },
    ger: { cc: 'de', name: 'Niemiecki' },
    fre: { cc: 'fr', name: 'Francuski' },
    ita: { cc: 'it', name: 'W\u0142oski' },
    spa: { cc: 'es', name: 'Hiszpa\u0144ski' },
    por: { cc: 'pt', name: 'Portugalski' },
    rus: { cc: 'ru', name: 'Rosyjski' },
    cze: { cc: 'cz', name: 'Czeski' },
    slo: { cc: 'sk', name: 'S\u0142owacki' },
    hun: { cc: 'hu', name: 'W\u0119gierski' },
    rom: { cc: 'ro', name: 'Rumu\u0144ski' },
    ukr: { cc: 'ua', name: 'Ukrai\u0144ski' },
    bul: { cc: 'bg', name: 'Bu\u0142garski' },
    cro: { cc: 'hr', name: 'Chorwacki' },
    dut: { cc: 'nl', name: 'Holenderski' },
    swe: { cc: 'se', name: 'Szwedzki' },
    nor: { cc: 'no', name: 'Norweski' },
    dan: { cc: 'dk', name: 'Du\u0144ski' },
    fin: { cc: 'fi', name: 'Fi\u0144ski' },
    gre: { cc: 'gr', name: 'Grecki' },
    tur: { cc: 'tr', name: 'Turecki' },
    lit: { cc: 'lt', name: 'Litewski' },
    lat: { cc: 'lv', name: '\u0141otewski' },
    est: { cc: 'ee', name: 'Esto\u0144ski' },
    slv: { cc: 'si', name: 'S\u0142owe\u0144ski' },
  };

  function getLangFlag(code, size) {
    size = size || 20;
    const meta = LANG_META[code];
    const cc = meta ? meta.cc : code.substring(0, 2);
    return '<img src="https://flagcdn.com/w' + size + '/' + cc + '.png" width="' + size + '" alt="' + cc.toUpperCase() + '" style="display:inline-block;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,0.12);vertical-align:middle;">';
  }

  function getLangName(code) {
    return (LANG_META[code] && LANG_META[code].name) || code.toUpperCase();
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function detectAvailableLanguages(doc) {
    const languages = [];
    languages.push({ code: LANG, label: LANG.toUpperCase() });
    if (doc) {
      const links = doc.querySelectorAll('a[href*="parameters.php"]');
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const langMatch = href.match(/[?&]lang=([a-z]{3})/);
        if (langMatch) {
          const code = langMatch[1];
          if (!languages.find(function(l) { return l.code === code; })) {
            const label = link.textContent.trim() || code.toUpperCase();
            languages.push({ code: code, label: label });
          }
        }
      }
    }
    return languages;
  }

  // =========================================================================
  // MATERIAL FONT
  // =========================================================================

  function loadMaterialFont(doc) {
    if (doc.querySelector('#tp-material-font')) return;
    const link = doc.createElement('link');
    link.id = 'tp-material-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
    doc.head.appendChild(link);
  }

  // =========================================================================
  // PAGE HEADER
  // =========================================================================

  // v4.5.70: wspólny budowniczy przełącznika języka (reużywany w Parametrach i Sekcjach)
  function buildLangSwitcherHtml(doc, ddId) {
    var languages = detectAvailableLanguages(doc);
    var currentLang = LANG;
    var otherLangs = languages.filter(function (l) { return l.code !== currentLang; });
    var head = '<span class="tp-page-header__lang-label">Wersja językowa:</span>';
    if (otherLangs.length > 0) {
      var items = otherLangs.map(function (l) {
        return '<div class="tp-lang-dropdown__item" data-lang="' + l.code + '">' + getLangFlag(l.code) + ' <span>' + escapeHtml(getLangName(l.code)) + '</span></div>';
      }).join('');
      return head +
        '<div class="tp-lang-dropdown" id="' + ddId + '">' +
          '<button type="button" class="tp-lang-selector tp-lang-dropdown__trigger">' +
            getLangFlag(currentLang) + ' <strong>' + escapeHtml(getLangName(currentLang)) + '</strong>' +
            '<span class="material-symbols-outlined tp-lang-chevron">expand_more</span>' +
          '</button>' +
          '<div class="tp-lang-dropdown__content">' + items + '</div>' +
        '</div>';
    }
    return head + '<span class="tp-lang-selector">' + getLangFlag(currentLang) + ' <strong>' + escapeHtml(getLangName(currentLang)) + '</strong></span>';
  }

  function wireLangDropdown(doc, root, ddId) {
    var langDd = root.querySelector('#' + ddId);
    if (!langDd) return;
    var trigger = langDd.querySelector('.tp-lang-selector');
    if (trigger) trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      langDd.classList.toggle('tp-open');
    });
    langDd.querySelectorAll('.tp-lang-dropdown__item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        var code = item.dataset.lang;
        if (!code) return;
        var topWin = window.top || window;
        try {
          var topUrl = new URL(topWin.location.href);
          topUrl.pathname = '/panel/app/parameters.php';
          topUrl.searchParams.set('lang', code);
          topWin.location.assign(topUrl.toString());
        } catch (err) {
          var url = new URL((doc.defaultView || window).location.href);
          url.searchParams.set('lang', code);
          (doc.defaultView || window).location.assign(url.toString());
        }
      });
    });
    doc.addEventListener('click', function (e) {
      if (!e.target.closest('#' + ddId)) langDd.classList.remove('tp-open');
    });
  }

  // v4.5.70: wstaw nagłówek (tytuł + język) w lewy slot opsbar tej samej linii
  function relocateHeaderIntoOpsBar(panel, headerEl) {
    if (!panel || !panel.opsBar || !headerEl) return;
    var leftSlot = panel.opsBar.firstChild;
    if (!leftSlot) return;
    leftSlot.innerHTML = '';
    leftSlot.appendChild(headerEl);
    headerEl.classList.add('tp-page-header--inline');
  }

  function buildPageHeader(doc) {
    const h1 = doc.querySelector('h1');
    if (!h1) return;

    const header = doc.createElement('div');
    header.className = 'tp-page-header';
    header.innerHTML =
      '<div class="tp-page-header__top">' +
        '<h1 class="tp-page-header__title">Parametry</h1>' +
      '</div>' +
      '<div class="tp-page-header__meta">' +
        buildLangSwitcherHtml(doc, 'tp-lang-dropdown') +
      '</div>';

    // Hide original h1 and language rows (NOT the whole table - it contains the tree!)
    h1.style.display = 'none';
    const langTable = doc.querySelector('table');
    if (langTable) {
      const rows = langTable.querySelectorAll('tr');
      for (var i = 0; i < rows.length; i++) {
        // Hide rows with language info but NOT the row with the parameter tree
        if (rows[i].querySelector('#product_parameters_container')) continue;
        if (rows[i].textContent.indexOf('Aktualnie edytujesz') !== -1 ||
            rows[i].querySelector('a[href*="lang="]')) {
          rows[i].style.display = 'none';
        }
      }
    }

    h1.parentNode.insertBefore(header, h1);

    // v4.5.70: wire lang dropdown via shared helper
    wireLangDropdown(doc, header, 'tp-lang-dropdown');

    // Hide native "Dodaj element" div
    var nativeAddDiv = doc.getElementById('product_parameters');
    if (nativeAddDiv) nativeAddDiv.style.display = 'none';

    // Strip table wrapper styling — make the table invisible as container
    var wrapperTable = doc.querySelector('table.table-bordered');
    if (wrapperTable) {
      wrapperTable.style.cssText = 'border:none !important; background:none !important; box-shadow:none !important; margin:0 !important;';
      wrapperTable.classList.remove('table-striped', 'table-bordered', 'table-hover');
    }
    var tableParent = doc.querySelector('.table-parent-wrapper');
    if (tableParent) {
      tableParent.style.cssText = 'padding:0 !important; margin:0 !important; border:none !important; background:none !important; box-shadow:none !important; overflow:visible !important;';
    }
    var tdText = doc.querySelector('td.text');
    if (tdText) {
      tdText.style.cssText = 'padding:0 !important; border:none !important;';
    }
    return header;
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  // v4.5.0: Find document holding the parameter tree.
  // Old panel: tree is inside an <iframe>. New panel: tree is in top document.
  // Returns the document (top or iframe) that contains #block_group0.
  function getIframeDoc() {
    // Try top first (new panel)
    if (document.querySelector('#block_group0')) return document;
    // Fall back to scanning iframes (old panel)
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var d = iframes[i].contentDocument;
        if (d && d.querySelector('#block_group0')) return d;
      } catch (e) {}
    }
    // Nothing found yet — for backwards compat, return first iframe doc (init may retry)
    if (iframes.length > 0) {
      try { return iframes[0].contentDocument; } catch (e) { return null; }
    }
    return document; // last resort
  }

  function getIframeWin() {
    var d = getIframeDoc();
    return d ? (d.defaultView || d.parentWindow || window) : window;
  }

  function fetchAjax(body) {
    return new Promise((resolve, reject) => {
      const win = getIframeWin();
      if (!win) return reject(new Error('Brak dostepu do iframe'));
      const xhr = new win.XMLHttpRequest();
      xhr.open('POST', AJAX_URL);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = () => {
        if (xhr.status >= 500) return reject(new Error('HTTP ' + xhr.status + ' \u2014 operacja niedostepna lub chwilowy blad serwera'));
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) {
          var snippet = (xhr.responseText || '').substring(0, 120).replace(/\s+/g, ' ');
          reject(new Error('Nieprawidlowa odpowiedz serwera: ' + snippet));
        }
      };
      xhr.onerror = () => reject(new Error('Blad sieci'));
      xhr.send(body);
    });
  }

  function fetchAjaxRaw(url, body) {
    return new Promise((resolve, reject) => {
      const win = getIframeWin();
      if (!win) return reject(new Error('Brak dostepu do iframe'));
      const xhr = new win.XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { resolve({ raw: xhr.responseText }); }
      };
      xhr.onerror = () => reject(new Error('Blad sieci'));
      xhr.send(body);
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // =========================================================================
  // SELECTION STATE
  // =========================================================================

  const selectedNodes = new Set(); // Set of node IDs (strings)

  function getNodeId(el) {
    // el is an <li> with id like "m_12345"
    if (!el || !el.id) return null;
    return el.id.replace('m_', '');
  }

  function getNodeName(doc, nodeId) {
    const nameEl = doc.getElementById('showMenuSub_' + nodeId);
    return nameEl ? nameEl.textContent.trim() : 'ID ' + nodeId;
  }

  function getParentId(doc, nodeId) {
    const li = doc.getElementById('m_' + nodeId);
    if (!li) return '0';
    const parentUl = li.closest('ul[id^="block_group"]');
    return parentUl ? parentUl.id.replace('block_group', '') : '0';
  }

  function isParameter(doc, nodeId) {
    const nameEl = doc.getElementById('showMenuSub_' + nodeId);
    return nameEl && nameEl.classList.contains('parameter');
  }

  function isValue(doc, nodeId) {
    const nameEl = doc.getElementById('showMenuSub_' + nodeId);
    return nameEl && nameEl.classList.contains('value');
  }

  // v4.5.22: sections = parameters whose showMenuSub has class 'section'
  function isSection(doc, nodeId) {
    const nameEl = doc.getElementById('showMenuSub_' + nodeId);
    return nameEl && nameEl.classList.contains('section');
  }
  // v4.5.31: fetch full list of sections via API — IdoSell has type=parameter/section/value
  // numberOfOccurrence is broken for sections (always returns 0) — don't call it.
  async function getAllSections(doc) {
    try {
      var resp = await fetchAjax('action=getList&type=section&parent=0&lang=' + LANG);
      if (!resp || !resp.data) return [];
      var sections = resp.data.map(function (s) {
        return { id: String(s.id), name: String(s.name || '').trim() };
      });
      sections.sort(function (a, b) { return a.name.localeCompare(b.name, 'pl'); });
      return sections;
    } catch (e) {
      console.error('[parametry] getAllSections failed:', e);
      return [];
    }
  }

  // =========================================================================
  // FORCE DELETE (kept from v1)
  // =========================================================================

  function showForceDeleteStatus(doc, message, isError) {
    let statusEl = doc.getElementById('tp-force-status');
    if (!statusEl) {
      statusEl = doc.createElement('div');
      statusEl.id = 'tp-force-status';
      doc.body.appendChild(statusEl);
    }
    statusEl.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;' +
      'padding:12px 20px;border-radius:8px;font-size:13px;font-family:Arial,sans-serif;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.2);max-width:500px;transition:opacity 0.3s;' +
      (isError
        ? 'background:#fbe9e7;color:#c62828;border:1px solid #ef9a9a;'
        : 'background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;');
    statusEl.textContent = message;

    if (!isError) {
      clearTimeout(statusEl._hideTimer);
      statusEl._hideTimer = setTimeout(() => {
        statusEl.style.opacity = '0';
        setTimeout(() => statusEl.remove(), 300);
      }, 3000);
    }
  }

  async function forceDeleteNode(doc, nodeId, parentId, nodeName, silent, onStatus) {
    function updateStatus(msg, isError) {
      if (onStatus) onStatus(msg);
      else if (!silent) showForceDeleteStatus(doc, msg, isError);
    }

    updateStatus('Usuwanie "' + nodeName + '"...');

    // v4.5.45: gdy kasujemy wartosc, po odpieciu sprawdzimy czy parametr-rodzic
    // ma jeszcze inne wartosci na tych produktach. Jesli nie - odpinamy tez parametr.
    var isValueNode = isValue(doc, nodeId);
    var parentIsParameter = parentId && parentId !== '0' && isParameter(doc, parentId);

    var totalDetached = 0;
    var detachedFrom = [];
    var maxRetries = 10;

    for (var attempt = 0; attempt < maxRetries; attempt++) {
      var removeResult = await fetchAjax(
        'action=removeParam&node=' + nodeId + '&tree=0&shop=2&parent=' + parentId
      );

      // Success
      if (removeResult.child && !removeResult.errno) {
        if (isValueNode && parentIsParameter && detachedFrom.length > 0) {
          await detachOrphanParentFromProducts(parentId, detachedFrom, updateStatus);
        }
        // v4.5.55: usunięcie → wyczyść cache węzła i jego rodzica (dzieci się zmienia)
        try { tpCacheDel('ctx', nodeId); tpCacheDel('pr', nodeId); if (parentId) { tpCacheDel('ch2', parentId + '_pol'); tpCacheDel('ch2', parentId + '_' + LANG); tpCacheDel('pr', parentId); } } catch (e) {}
        updateStatus(totalDetached > 0
          ? 'Usunieto "' + nodeName + '" (odpieto od ' + totalDetached + ' towarow)'
          : 'Usunieto "' + nodeName + '"');
        return true;
      }

      if (!removeResult.error && !removeResult.errno) {
        if (isValueNode && parentIsParameter && detachedFrom.length > 0) {
          await detachOrphanParentFromProducts(parentId, detachedFrom, updateStatus);
        }
        try { tpCacheDel('ctx', nodeId); tpCacheDel('pr', nodeId); if (parentId) { tpCacheDel('ch2', parentId + '_pol'); tpCacheDel('ch2', parentId + '_' + LANG); tpCacheDel('pr', parentId); } } catch (e) {}
        updateStatus('Usunieto "' + nodeName + '"');
        return true;
      }

      // Errno 235 — detach products
      if (String(removeResult.errno) === '235' && removeResult.error) {
        var idsSection = removeResult.error.split(/towar[óo]w:\s*/i)[1] || '';
        var productIds = (idsSection.match(/\d+/g) || []);

        if (productIds.length === 0) {
          updateStatus('Blad: nie udalo sie odczytac ID towarow', true);
          return false;
        }

        for (var i = 0; i < productIds.length; i++) {
          updateStatus('Odpinanie "' + nodeName + '" od towaru ' + (totalDetached + 1) + ' (ID: ' + productIds[i] + ')...');
          try {
            await fetchAjaxRaw(
              AJAX_URL + '?action=saveParametersChanges&productId=' + productIds[i],
              'data=' + encodeURIComponent(JSON.stringify([
                { operation: 'remove', parameter: String(nodeId) }
              ])) + '&columns=[]'
            );
            totalDetached++;
            detachedFrom.push(String(productIds[i]));
          } catch (e) {
            totalDetached++;
            detachedFrom.push(String(productIds[i]));
          }
          if (i < productIds.length - 1) await sleep(200);
        }

        continue;
      }

      // Other error
      updateStatus('Blad: ' + (removeResult.error || 'errno ' + removeResult.errno), true);
      return false;
    }

    updateStatus('Blad: nie udalo sie usunac po ' + maxRetries + ' probach', true);
    return false;
  }

  // v4.5.45: dla kazdego produktu na liscie sprawdz czy parametr-rodzic ma jeszcze inna wartosc.
  // Jesli juz nie ma (parametr osierocony), odepnij rowniez sam parametr.
  async function detachOrphanParentFromProducts(parentId, productIds, updateStatus) {
    if (!productIds || !productIds.length) return;
    var stillHas = new Set();
    try {
      var occ = await fetchAjax('action=numberOfOccurrence&id=' + encodeURIComponent(parentId));
      var raw = occ && occ.data ? occ.data.products : null;
      if (Array.isArray(raw)) {
        raw.forEach(function (p) { stillHas.add(String(typeof p === 'object' ? (p.id || p.product_id) : p)); });
      } else if (raw && typeof raw === 'object') {
        Object.values(raw).forEach(function (p) { stillHas.add(String(typeof p === 'object' ? (p.id || p.product_id) : p)); });
      }
    } catch (e) { return; }
    var orphans = productIds.filter(function (pid) { return !stillHas.has(String(pid)); });
    if (!orphans.length) return;
    for (var i = 0; i < orphans.length; i++) {
      if (updateStatus) updateStatus('Odpinanie pustego parametru-rodzica od towaru ' + (i + 1) + '/' + orphans.length + ' (ID: ' + orphans[i] + ')...');
      try {
        await fetchAjaxRaw(
          AJAX_URL + '?action=saveParametersChanges&productId=' + orphans[i],
          'data=' + encodeURIComponent(JSON.stringify([
            { operation: 'remove', parameter: String(parentId) }
          ])) + '&columns=[]'
        );
      } catch (e) {}
      if (i < orphans.length - 1) await sleep(200);
    }
  }

  async function loadChildValues(nodeId) {
    // v4.5.55: cache TTL 1h dla per-lang listy dzieci
    // v4.5.57: parsujemy też natywną liczbę produktów per wartość z iteminfo ("towary: N")
    var cacheKey = nodeId + '_' + LANG;
    var cached = tpCacheGet('ch2', cacheKey, TP_TTL_CHILDREN);
    if (cached !== null) return cached;
    const win = getIframeWin();
    return new Promise((resolve, reject) => {
      const xhr = new win.XMLHttpRequest();
      xhr.open('POST', AJAX_URL);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = () => {
        try {
          const resp = JSON.parse(xhr.responseText);
          const html = resp.treeCode || '';
          // Wyciągnij natywne liczby produktów per wartość: <a id="products_X" ...>towary: N</a>
          var prodMap = {};
          html.replace(/products_(\d+)[^>]*>[^<]*?(\d+)\s*<\/a>/g, function (_, id, n) {
            prodMap[id] = Number(n);
            return _;
          });
          const children = [];
          const regex = /id="m_(\d+)"[\s\S]*?class="showMenuSub\s+value[^"]*">([^<]+)/g;
          let match;
          while ((match = regex.exec(html)) !== null) {
            const cid = match[1];
            children.push({ id: cid, name: match[2].trim(), productCount: prodMap[cid] || 0 });
          }
          tpCacheSet('ch2', cacheKey, children);
          resolve(children);
        } catch (e) { reject(e); }
      };
      xhr.onerror = () => reject(new Error('Blad sieci'));
      xhr.send('action=getTreeForSection&parameter=group' + nodeId + '&lang=' + LANG);
    });
  }

  async function forceDeleteParameterWithValues(doc, paramId, paramName) {
    showForceDeleteStatus(doc, 'Ladowanie wartosci "' + paramName + '"...');

    let children;
    try {
      children = await loadChildValues(paramId);
    } catch (e) {
      showForceDeleteStatus(doc, 'Blad ladowania wartosci: ' + e.message, true);
      return false;
    }

    const totalSteps = children.length + 1;
    let completed = 0;

    for (const child of children) {
      showForceDeleteStatus(doc,
        'Usuwanie wartosci "' + child.name + '" (' + (completed + 1) + '/' + totalSteps + ')...'
      );

      const success = await forceDeleteNode(doc, child.id, paramId, child.name, true);
      if (!success) {
        showForceDeleteStatus(doc,
          'Blad przy usuwaniu wartosci "' + child.name + '"', true
        );
        return false;
      }

      const li = doc.getElementById('m_' + child.id);
      if (li) {
        const space = doc.getElementById('space_' + child.id);
        if (space) space.remove();
        li.remove();
      }

      completed++;
    }

    showForceDeleteStatus(doc,
      'Usuwanie parametru "' + paramName + '" (' + totalSteps + '/' + totalSteps + ')...'
    );

    const success = await forceDeleteNode(doc, paramId, '0', paramName, true);

    if (success) {
      showForceDeleteStatus(doc,
        'Usunieto "' + paramName + '" z ' + children.length + ' wartosciami'
      );
      const li = doc.getElementById('m_' + paramId);
      if (li) {
        const space = doc.getElementById('space_' + paramId);
        if (space) space.remove();
        li.remove();
      }
      return true;
    } else {
      showForceDeleteStatus(doc, 'Blad przy usuwaniu parametru "' + paramName + '"', true);
      return false;
    }
  }

  function hookNativeDeleteButtons(doc) {
    doc.addEventListener('click', async function (e) {
      const target = e.target.closest('.removeParam, [id^="removeEl_"]');
      if (!target) return;

      e.stopPropagation();
      e.preventDefault();

      const nodeId = target.id ? target.id.replace('removeEl_', '') : null;
      if (!nodeId) return;

      const nameDiv = doc.getElementById('showMenuSub_' + nodeId);
      const nodeName = nameDiv ? nameDiv.textContent.trim() : 'ID ' + nodeId;

      const parentLi = target.closest('ul[id^="block_group"]');
      const parentId = parentLi ? parentLi.id.replace('block_group', '') : '0';

      if (!confirm('Usunac "' + nodeName + '"?\n\nJesli jest przypisany do towarow, zostanie najpierw automatycznie odpiety.')) {
        return;
      }

      const success = await forceDeleteNode(doc, nodeId, parentId, nodeName);

      if (success) {
        const li = doc.getElementById('m_' + nodeId);
        if (li) {
          const space = doc.getElementById('space_' + nodeId);
          if (space) space.remove();
          li.remove();
        }
      }
    }, true);

    doc.addEventListener('click', function (e) {
      const menuSub = e.target.closest('.showMenuSub.parameter');
      if (!menuSub) return;

      const idMatch = menuSub.id ? menuSub.id.match(/\d+/) : null;
      if (!idMatch) return;
      const paramId = idMatch[0];

      setTimeout(() => {
        const optionsSpan = doc.getElementById('options_' + paramId);
        if (!optionsSpan) return;
        if (optionsSpan.querySelector('.tp-delete-param-link')) return;

        var link = doc.createElement('a');
        link.className = 'nohref tp-delete-param-link';
        link.style.cssText = 'color:#e53935;cursor:pointer;margin-left:8px;font-weight:bold;';
        link.textContent = 'usun z wartosciami';
        link.addEventListener('click', async function (ev) {
          ev.stopPropagation();
          ev.preventDefault();

          var nameDiv = doc.getElementById('showMenuSub_' + paramId);
          var paramName = nameDiv ? nameDiv.textContent.trim() : 'ID ' + paramId;

          if (!confirm(
            'UWAGA: Usunac parametr "' + paramName + '" wraz ze WSZYSTKIMI jego wartosciami?\n\n' +
            'Wartosci zostana automatycznie odpiete od towarow przed usunieciem.'
          )) {
            return;
          }

          await forceDeleteParameterWithValues(doc, paramId, paramName);
        });

        optionsSpan.appendChild(doc.createTextNode(' '));
        optionsSpan.appendChild(link);
      }, 150);
    });

    doc.addEventListener('click', function (e) {
      var menuSub = e.target.closest('.showMenuSub.value.del_no');
      if (!menuSub) return;

      var idMatch = menuSub.id ? menuSub.id.match(/\d+/) : null;
      if (!idMatch) return;
      var valueId = idMatch[0];

      setTimeout(function () {
        var optionsSpan = doc.getElementById('options_' + valueId);
        if (!optionsSpan) return;
        if (optionsSpan.querySelector('.tp-force-delete-link')) return;

        var link = doc.createElement('a');
        link.className = 'nohref tp-force-delete-link';
        link.style.cssText = 'color:#e53935;cursor:pointer;margin-left:8px;font-weight:bold;';
        link.textContent = 'usun';
        link.addEventListener('click', async function (ev) {
          ev.stopPropagation();
          ev.preventDefault();

          var nameDiv = doc.getElementById('showMenuSub_' + valueId);
          var valName = nameDiv ? nameDiv.textContent.trim() : 'ID ' + valueId;

          var parentUl = doc.getElementById('m_' + valueId);
          if (parentUl) parentUl = parentUl.closest('ul[id^="block_group"]');
          var parentId = parentUl ? parentUl.id.replace('block_group', '') : '0';

          if (!confirm('Usunac "' + valName + '"?\n\nJesli jest przypisany do towarow, zostanie najpierw automatycznie odpiety.')) {
            return;
          }

          var success = await forceDeleteNode(doc, valueId, parentId, valName);
          if (success) {
            var li = doc.getElementById('m_' + valueId);
            if (li) {
              var space = doc.getElementById('space_' + valueId);
              if (space) space.remove();
              li.remove();
            }
          }
        });

        optionsSpan.appendChild(doc.createTextNode(' '));
        optionsSpan.appendChild(link);
      }, 150);
    });
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  function injectStyles(doc) {
    const style = doc.createElement('style');
    style.textContent = `
/* Material Symbols */
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'liga';
}

/* Animations */
@keyframes tpFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes tpSlideUp { from { opacity: 0; transform: translateY(30px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes tpFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes tpSlideDown { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(30px) scale(0.97); } }
@keyframes tpSpin { to { transform: rotate(360deg); } }
@keyframes tp-slide-in {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Force delete status toast */
#tp-force-status {
  animation: tp-slide-in 0.3s ease-out;
}

/* ===== PAGE HEADER ===== */
.tp-page-header {
  margin-bottom: 8px;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
}
.tp-page-header--inline {
  margin: 0 !important;
}
.tp-page-header--inline .tp-page-header__top {
  margin-bottom: 2px;
}
.tp-page-header--inline .tp-page-header__title {
  font-size: 18px;
}
.tp-page-header--inline .tp-page-header__meta {
  font-size: 12px;
}
.tp-page-header__top {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 4px;
}
.tp-page-header__title {
  font-size: 20px;
  font-weight: 500;
  color: #202124;
  margin: 0;
}
.tp-page-header__meta {
  font-size: 13px;
  color: #5f6368;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tp-page-header__lang-label {
  color: #80868b;
}
.tp-page-header__lang {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tp-page-header__lang strong {
  line-height: 1;
}
.tp-page-header__lang-separator {
  color: #dadce0;
  margin: 0 2px;
}
.tp-page-header__lang-link {
  font-size: 20px;
  text-decoration: none;
  opacity: 0.7;
  transition: opacity 0.15s, transform 0.15s;
  display: inline-block;
  padding: 2px 3px;
  border-radius: 4px;
  line-height: 1;
}
.tp-lang-dropdown {
  position: relative;
  display: inline-block;
}
.tp-lang-selector {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  transition: border-color 0.15s;
  font-family: inherit;
}
.tp-lang-selector:hover { border-color: #2563eb; }
.tp-lang-selector strong { font-weight: 600; }
.tp-lang-chevron {
  font-size: 16px !important;
  margin-left: 2px;
  color: #64748b;
}
.tp-lang-dropdown__content {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 180px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 10000;
  display: none;
  padding: 4px 0;
}
.tp-lang-dropdown.tp-open .tp-lang-dropdown__content { display: block; }
.tp-lang-dropdown__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: #334155;
}
.tp-lang-dropdown__item:hover { background: #f1f5f9; }
.tp-page-header__lang-link:hover {
  opacity: 1;
  transform: scale(1.15);
  background: rgba(0,0,0,0.05);
}

/* ===== BUTTONS ===== */
.tp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font-size: 14px;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  font-weight: 500;
  cursor: pointer;
  background: #fff;
  color: #202124;
  transition: background 0.15s, box-shadow 0.15s;
  line-height: 1.4;
}
.tp-btn:hover { background: #f1f3f4; }
.tp-btn .material-symbols-outlined { font-size: 18px; }
.tp-btn--primary {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}
.tp-btn--primary:hover {
  background: #1765cc;
  box-shadow: 0 1px 3px rgba(26,115,232,.3);
}

/* ===== TOOLBAR ===== */
.tp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: #f8f9fa;
  border: 1px solid #dadce0;
  border-radius: 8px;
  margin: 0;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  font-size: 14px;
}
.tp-toolbar__group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tp-toolbar__separator {
  width: 1px;
  height: 24px;
  background: #dadce0;
  margin: 0 4px;
}
.tp-toolbar__spacer {
  flex: 1;
}
.tp-toolbar__break {
  flex-basis: 100%;
  height: 0;
}
.tp-toolbar__group--bulk {
  margin-left: auto;
}
.tp-toolbar__label {
  font-size: 11px;
  color: #80868b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 500;
  padding-right: 4px;
}

/* ===== VIEW DROPDOWN ===== */
.tp-view-dropdown {
  position: relative;
  display: inline-block;
}
.tp-view-dropdown__toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #202124;
  font-family: inherit;
  white-space: nowrap;
}
.tp-view-dropdown__toggle:hover { background: #f1f3f4; }
.tp-view-dropdown__toggle .material-symbols-outlined {
  font-size: 18px;
  color: #1a73e8;
}
.tp-view-dropdown__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 180px;
  background: #fff;
  border: 1px solid #dadce0;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  z-index: 10000;
  display: none;
  padding: 4px 0;
}
.tp-view-dropdown__menu.tp-open { display: block; }
.tp-view-dropdown__item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: #202124;
  gap: 6px;
}
.tp-view-dropdown__item:hover { background: #f1f3f4; }
.tp-view-dropdown__item.tp-active { background: #e8f0fe; color: #1a73e8; font-weight: 500; }
.tp-view-dropdown__item .material-symbols-outlined {
  font-size: 16px;
  color: inherit;
  width: 16px;
  opacity: 0;
}
.tp-view-dropdown__item.tp-active .material-symbols-outlined { opacity: 1; }

/* Search */
.tp-search-box {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border: 1px solid #dadce0;
  border-radius: 20px;
  padding: 4px 12px;
}
.tp-search-box .material-symbols-outlined {
  font-size: 18px;
  color: #5f6368;
}
.tp-search-input {
  border: none !important;
  outline: none !important;
  font-size: 13px !important;
  width: 160px;
  background: transparent !important;
  font-family: inherit;
  padding: 4px 0 !important;
  margin: 0 !important;
  box-shadow: none !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  height: auto !important;
  line-height: normal !important;
  color: #202124 !important;
}
.tp-search-input::placeholder {
  color: #9aa0a6;
  transition: opacity 0.15s;
}
.tp-search-input:focus::placeholder {
  opacity: 0;
}
.tp-search-input:focus {
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}

/* ===== BUTTONS ===== */
.tp-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  color: #202124;
  transition: background 0.15s, box-shadow 0.15s;
  white-space: nowrap;
}
.tp-btn:hover:not(:disabled) {
  background: #f1f3f4;
  box-shadow: 0 1px 3px rgba(0,0,0,.1);
}
.tp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tp-btn .material-symbols-outlined { font-size: 18px; }
.tp-btn--icon { padding: 6px; border-color: transparent; background: transparent; }
.tp-btn--icon:hover:not(:disabled) { background: #e8eaed; }
.tp-btn--icon .material-symbols-outlined { font-size: 20px; }
.tp-btn--text { border-color: transparent; background: transparent; }
.tp-btn--text:hover:not(:disabled) { background: #e8eaed; }
.tp-btn--primary {
  background: #1a73e8;
  color: #fff;
  border-color: #1a73e8;
}
.tp-btn--primary:hover:not(:disabled) {
  background: #1765cc;
  box-shadow: 0 1px 3px rgba(26,115,232,.3);
}
.tp-btn--danger { color: #d93025; }
.tp-btn--danger:hover:not(:disabled) { background: #fce8e6; }
.tp-btn--move { color: #1565c0; }
.tp-btn--move:hover:not(:disabled) { background: #e3f2fd; }
.tp-distinction-option { display:flex; align-items:center; gap:12px; padding:12px 16px; border:2px solid #dee2e6; border-radius:8px; cursor:pointer; transition:all .15s; background:#fff; }
.tp-distinction-option:hover { border-color:#adb5bd; }
.tp-distinction-option.tp-selected { border-color:#e67e22; background:#fef9f3; }
.tp-distinction-option input[type=radio] { accent-color:#e67e22; width:18px; height:18px; }
.tp-distinction-option .tp-dist-icon { font-size:28px; }
.tp-distinction-option .tp-dist-label { font-weight:600; font-size:14px; }
.tp-distinction-option .tp-dist-desc { font-size:12px; color:#666; margin-top:2px; }

/* Tooltips */
[data-tooltip] {
  position: relative;
}
[data-tooltip]::before,
[data-tooltip]::after {
  position: absolute;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s, visibility 0.15s;
  pointer-events: none;
  z-index: 10001;
}
[data-tooltip]::after {
  content: attr(data-tooltip);
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: #323232;
  color: #fff;
  font-size: 12px;
  font-weight: 400;
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  line-height: 1.3;
  text-transform: none;
  letter-spacing: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
[data-tooltip]::before {
  content: '';
  bottom: calc(100% + 3px);
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #323232;
}
[data-tooltip]:hover::before,
[data-tooltip]:hover::after {
  opacity: 1;
  visibility: visible;
}

/* ===== GRID HEADER ===== */
.tp-grid__header {
  display: grid;
  grid-template-columns: 24px 40px 32px 1fr 80px 110px 80px 90px 220px;
  column-gap: 8px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 2px solid #dadce0;
  background: #f1f3f4;
  font-size: 12px;
  font-weight: 500;
  color: #5f6368;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  margin-top: 4px;
}
.tp-grid__header > div { padding: 0 4px; text-align: center; }
.tp-grid__header .tp-col-name { text-align: left; font-weight: 500; }
.tp-grid__header .tp-col-name .tp-header-hint {
  font-size: 10px;
  color: #9aa0a6;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  margin-left: 6px;
}

/* ===== ROW GRID (enhanced li) ===== */
li.tp-row-enhanced {
  display: grid !important;
  grid-template-columns: 24px 40px 32px 1fr 80px 110px 80px 90px 220px;
  column-gap: 8px;
  align-items: center;
  padding: 3px 0 !important;
  border: none !important;
  border-radius: 0 !important;
  min-height: 36px;
  transition: background 0.1s;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  font-size: 14px;
  list-style: none !important;
  margin: 0 !important;
}
li.tp-row-enhanced.tp-row--hidden { display: none !important; }
li.tp-row-enhanced.tp-row--filter-hidden { display: none !important; }
li.tp-row-enhanced.tp-row--view-hidden { display: none !important; }
li.tp-row-enhanced:hover { background: #f8f9fa; }
li.tp-row-enhanced.tp-row--selected { background: #e8f0fe; }
li.tp-row-enhanced.tp-row--selected:hover { background: #d2e3fc; }
li.tp-row-enhanced > div { padding: 0 4px; }

/* Grid cells */
.tp-col-check {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 100%;
}
.tp-col-expand {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 100%;
}
/* Drag handle */
.tp-col-drag {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 100%;
}
.tp-drag-handle {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 24px !important;
  height: 24px !important;
  font-size: 18px !important;
  color: #bdc1c6 !important;
  cursor: grab !important;
  border-radius: 4px !important;
  transition: color 0.15s, background 0.15s;
  border: none !important;
  background: none !important;
  padding: 0 !important;
}
.tp-drag-handle:hover {
  color: #5f6368 !important;
  background: #e8eaed !important;
}
.tp-drag-handle:active {
  cursor: grabbing !important;
}
/* Merge mode */
.tp-action-btn--merge { color: #e37400 !important; }
.tp-action-btn--merge:hover { background: #fef3c7 !important; color: #b45309 !important; }
li.tp-merge-source {
  background: #fef3c7 !important;
  outline: 2px solid #f59e0b !important;
  outline-offset: -2px;
  z-index: 2;
  position: relative;
}
li.tp-merge-target {
  cursor: pointer !important;
  transition: background 0.15s !important;
}
li.tp-merge-target:hover {
  background: #dcfce7 !important;
  outline: 2px solid #22c55e !important;
  outline-offset: -2px;
}
/* Override jQuery UI disabled opacity when we disable native draggable */
li.ui-draggable-disabled.tp-row-enhanced {
  opacity: 1 !important;
}
#tp-merge-banner {
  position: fixed !important;
  top: 8px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  background: #f59e0b !important;
  color: #fff !important;
  padding: 10px 20px !important;
  font-size: 14px !important;
  font-family: Arial, sans-serif !important;
  display: flex !important;
  align-items: center !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25) !important;
  z-index: 999999 !important;
  white-space: nowrap !important;
}
.tp-col-name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
.tp-col-name .tp-row-icon {
  font-size: 22px !important;
  color: #5f6368 !important;
  flex-shrink: 0;
}
.tp-col-name .tp-row-icon--param {
  color: #1967d2 !important;
}
.tp-col-name .tp-row-icon--value {
  color: #137333 !important;
}
.tp-col-name .tp-row-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px !important;
  font-weight: 400;
}
.tp-col-id {
  font-size: 12px;
  color: #5f6368;
  font-family: 'Roboto Mono', monospace;
  text-align: center;
}
.tp-col-type {
  text-align: center;
  display: none !important; /* replaced by tp-col-priority + tp-col-children in v3.4.0 */
}
.tp-col-priority {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 2px;
  font-size: 13px;
  color: #5f6368;
}
.tp-col-priority .tp-prio-text {
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-family: 'Roboto Mono', monospace;
}
.tp-col-priority .tp-prio-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  font-size: 16px !important;
  color: #5f6368;
  transition: background 0.15s, color 0.15s;
  user-select: none;
}
.tp-col-priority .tp-prio-btn:hover {
  background: #e8eaed;
  color: #1a73e8;
}
.tp-col-priority .tp-prio-btn.tp-prio-btn--disabled {
  color: #dadce0;
  cursor: default;
  pointer-events: none;
}
.tp-col-children {
  text-align: center;
  font-size: 13px;
  color: #5f6368;
  font-variant-numeric: tabular-nums;
  font-family: 'Roboto Mono', monospace;
}
.tp-col-children--empty { color: #dadce0; }
.tp-col-products {
  text-align: center;
  font-size: 13px;
}
.tp-col-products a {
  color: #1a73e8 !important;
  text-decoration: none !important;
  font-weight: 500;
}
.tp-col-products a:hover {
  text-decoration: underline !important;
}
.tp-col-actions {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px !important;
}

/* Checkbox */
.tp-checkbox {
  width: 16px !important;
  height: 16px !important;
  accent-color: #1a73e8;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0 !important;
  padding: 0 !important;
  vertical-align: middle !important;
}

/* Expand icon */
.tp-expand-icon {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 32px !important;
  height: 32px !important;
  flex-shrink: 0;
  cursor: pointer;
  border-radius: 50% !important;
  font-size: 22px !important;
  color: #5f6368 !important;
  transition: background 0.15s;
  user-select: none;
  padding: 0 !important;
  line-height: 1 !important;
  border: none !important;
  background: none !important;
}
.tp-expand-icon:hover { background: #e8eaed !important; }

/* Badges */
.tp-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
}
.tp-badge--param {
  background: #e8f0fe;
  color: #1967d2;
}
.tp-badge--value {
  background: #e6f4ea;
  color: #137333;
}

/* Action buttons in row */
.tp-action-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 32px !important;
  height: 32px !important;
  border-radius: 50% !important;
  cursor: pointer !important;
  color: #5f6368 !important;
  font-size: 20px !important;
  transition: background 0.15s, color 0.15s !important;
  border: none !important;
  background: none !important;
  padding: 0 !important;
  line-height: 1 !important;
}
.tp-action-btn:hover { background: #e8eaed !important; color: #202124 !important; }
.tp-action-btn--danger { color: #d93025 !important; }
.tp-action-btn--danger:hover { background: #fce8e6 !important; color: #d93025 !important; }

/* Copyable ID */
.tp-copyable {
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 4px;
  transition: background 0.15s;
}
.tp-copyable:hover {
  background: #e8eaed;
}
/* v4.6.5: edytor opisu (HTML / WYSIWYG) */
.tp-ed-wrap { border:1px solid #d0d5dd; border-radius:8px; overflow:visible; background:#fff; }
.tp-ed-bar { display:flex; border-bottom:1px solid #e2e8f0; background:#f8f9fa; border-radius:8px 8px 0 0; overflow:hidden; }
.tp-ed-btn { flex:1; padding:8px 12px; border:none; background:transparent; cursor:pointer; font-size:12px; font-weight:600; color:#5f6368; font-family:inherit; transition:background .15s,color .15s; }
.tp-ed-btn:hover { background:#e8eaed; }
.tp-ed-btn.tp-ed-on { background:#fff; color:#1a73e8; box-shadow:inset 0 -2px 0 #1a73e8; }
.tp-ed-src { width:100% !important; box-sizing:border-box !important; border:none !important; padding:10px 12px !important; margin:0 !important; font:13px/1.5 ui-monospace,Consolas,monospace !important; color:#1a1a2e !important; background:#fff !important; resize:vertical !important; outline:none !important; border-radius:0 0 8px 8px !important; }
.tp-ed-wys { padding:10px 12px; min-height:140px; outline:none; font-size:14px; color:#1a1a2e; background:#fff; border-radius:0 0 8px 8px; overflow:auto; line-height:1.5; }
.tp-ed-wys:focus { box-shadow: inset 0 0 0 2px rgba(26,115,232,.18); }

/* v4.6.7: modal edycji w stylu Menu (settings-v2) */
.tp-se { background:#f4f5f7 !important; padding:14px 16px 6px !important; }
.tp-se .tp-se-card { background:#fff; border:1px solid #eef0f4; border-radius:14px; margin-bottom:14px; overflow:hidden; }
.tp-se .tp-se-card:last-child { margin-bottom:0; }
.tp-se .tp-se-head { padding:13px 20px; border-bottom:1px solid #eef0f4; background:#fafbfc; font-size:12px; font-weight:700; color:#344054; text-transform:uppercase; letter-spacing:.06em; display:flex; align-items:center; gap:10px; }
.tp-se .tp-se-head .material-symbols-outlined { font-size:17px; color:#667085; opacity:.75; }
.tp-se .tp-se-body { padding:4px 20px 10px; }
.tp-se .lang-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:6px; padding:10px 0 6px; }
.tp-se .lang-item { display:flex; align-items:center; gap:8px; padding:6px 10px; border:1px solid #e0e3ea; border-radius:8px; cursor:pointer; font-size:12.5px; color:#344054; transition:all .15s; user-select:none; background:transparent; font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; text-align:left; }
.tp-se .lang-item:hover { background:#fafbfd; }
.tp-se .lang-item.checked { border:2px solid #4f8cff; padding:5px 9px; background:#f5f8ff; }
.tp-se .lang-flag { font-size:14px; }
.tp-se .lang-name { flex:1; }
.tp-se .lang-item input { display:none; }
.tp-se .lang-check { width:14px; height:14px; border-radius:3px; border:1.5px solid #c6d0e0; flex-shrink:0; position:relative; }
.tp-se .lang-item.checked .lang-check { background:#4f8cff; border-color:#4f8cff; }
.tp-se .lang-item.checked .lang-check::after { content:''; position:absolute; left:3.5px; top:.5px; width:4px; height:8px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }
.tp-se .tp-se-row { display:flex; align-items:center; justify-content:space-between; padding:11px 0; border-bottom:1px solid #f0f2f5; gap:16px; }
.tp-se .tp-se-row:last-child { border-bottom:none; }
.tp-se .tp-se-row--col { display:block; padding:12px 0 6px; }
.tp-se .tp-se-lbl { flex:1 1 auto; font-size:13.5px; color:#344054; }
.tp-se .tp-se-row--col > .tp-se-lbl { display:block; margin-bottom:8px; font-weight:500; }
.tp-se .tp-se-ctl { flex:0 0 420px; max-width:420px; }
.tp-se .tp-se-ctl input[type=text], .tp-se .tp-se-ctl select {
  width:100% !important; box-sizing:border-box !important; padding:9px 11px !important; margin:0 !important;
  background:#f8f9fb !important; border:1px solid #e0e3ea !important; border-radius:8px !important;
  font:13px 'DM Sans',inherit !important; color:#1a1a2e !important; height:auto !important; outline:none !important;
  -webkit-appearance:none !important; appearance:none !important;
}
.tp-se .tp-se-ctl select { background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' fill='none' stroke='%2398a2b3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important; background-repeat:no-repeat !important; background-position:right 10px center !important; padding-right:30px !important; }
.tp-se .tp-se-ctl input[type=text]:focus, .tp-se .tp-se-ctl select:focus { border-color:#4f8cff !important; box-shadow:0 0 0 3px rgba(79,140,255,.15) !important; }
.tp-se .tp-se-hint { margin:10px 0 4px; padding:11px 14px; border-radius:9px; font-size:12px; display:flex; gap:10px; align-items:flex-start; line-height:1.5; background:#eef3ff; border:1px solid #d6e2ff; color:#3b5998; }
/* edytor opisu: header (label + pill toggle po prawej) */
.tp-se .tp-ed-v2head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:12px; }
.tp-se .tp-ed-v2head .tp-ed-v2lbl { font-size:13px; color:#344054; font-weight:500; }
.tp-se .tp-ed-wrap { border:none; background:transparent; }
.tp-se .tp-ed-wrap .tp-ed-bar { display:inline-flex; border:none; background:#f0f2f5; border-radius:8px; padding:3px; overflow:visible; }
.tp-se .tp-ed-wrap .tp-ed-btn { flex:none; padding:5px 14px; border-radius:6px; color:#98a2b3; }
.tp-se .tp-ed-wrap .tp-ed-btn:hover { background:rgba(255,255,255,.5); color:#344054; }
.tp-se .tp-ed-wrap .tp-ed-btn.tp-ed-on { background:#fff; color:#1a1a2e; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.tp-se .tp-ed-src { border:1px solid #e0e3ea !important; border-radius:10px !important; background:#f8f9fb !important; }
.tp-se .tp-ed-wys { border:1px solid #e0e3ea; border-radius:10px; background:#f8f9fb; }
/* integracja natywnego edytora grafik */
/* v4.6.12: sekcja grafik w stylu Menu */
.tp-se .tp-gfx-slot-header { font-size:11.5px; font-weight:700; color:#e65100; text-transform:uppercase; letter-spacing:.05em; padding:14px 0 6px; }
.tp-se .tp-gfx-subfield { display:flex; align-items:center; justify-content:space-between; padding:8px 0; gap:16px; }
.tp-se .tp-gfx-subfield .tp-se-lbl { font-size:13.5px; color:#344054; flex:1 1 auto; }
.tp-se .tp-gfx-subfield .tp-se-ctl { flex:0 0 420px; max-width:420px; }
.tp-se .tp-gfx-slot-upload { padding:4px 0 8px; }
.tp-se .tp-gfx-upload-row { display:flex; align-items:center; gap:12px; padding:10px 14px; background:#f8f9fb; border:1px dashed #d0d5dd; border-radius:8px; margin-bottom:8px; transition:border-color .15s; }
.tp-se .tp-gfx-upload-row:hover { border-color:#4f8cff; }
.tp-se .tp-gfx-upload-label { font-size:12.5px; color:#667085; flex-shrink:0; min-width:120px; }
.tp-se .tp-gfx-browse { padding:5px 14px; border-radius:6px; border:1px solid #d0d5dd; background:#fff; font-size:12px; color:#344054; cursor:pointer; font-weight:500; font-family:inherit; }
.tp-se .tp-gfx-browse:hover { background:#f8f9fb; border-color:#b0b7c3; }
.tp-se .tp-gfx-upload-state { font-size:12px; color:#98a2b3; flex:1; }
.tp-se .tp-gfx-existing { display:flex; align-items:center; gap:10px; padding:8px 12px; background:#fff; border:1px solid #e8ebf0; border-radius:8px; margin-bottom:8px; font-size:12.5px; }
.tp-se .tp-gfx-existing-label { font-size:12px; color:#667085; font-weight:500; flex-shrink:0; }
.tp-se .tp-gfx-thumb { height:40px; width:auto; max-width:120px; border-radius:4px; border:1px solid #e8ebf0; object-fit:contain; background:#fff; }
.tp-se .tp-gfx-existing-actions { display:flex; align-items:center; gap:10px; margin-left:auto; }
.tp-se .tp-gfx-link { font-size:12px; color:#4f8cff; text-decoration:none; font-weight:500; cursor:pointer; }
.tp-se .tp-gfx-link:hover { text-decoration:underline; }
.tp-se .tp-gfx-del { font-size:12px; color:#d32f2f; cursor:pointer; font-weight:500; }
.tp-se .tp-gfx-del:hover { text-decoration:underline; }

/* Hide native elements inside enhanced rows */
li.tp-row-enhanced > .showChildren,
li.tp-row-enhanced > .hideChildren,
li.tp-row-enhanced > .options,
li.tp-row-enhanced > [id^="space_"],
li.tp-row-enhanced > [id^="options_"],
li.tp-row-enhanced > [id^="iteminfo_"],
li.tp-row-enhanced > [id^="clear_"],
li.tp-row-enhanced > .clear,
li.tp-row-enhanced > br,
li.tp-row-enhanced > a.nohref {
  display: none !important;
}
/* Child ul spans full grid width */
li.tp-row-enhanced > ul {
  grid-column: 1 / -1;
}

/* ===== FOOTER ===== */
.tp-grid__footer {
  padding: 8px 16px;
  border-top: 1px solid #e0e0e0;
  font-size: 13px;
  color: #5f6368;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  margin-top: 4px;
}
.tp-counter--selected {
  color: #1a73e8;
  font-weight: 600;
}
.tp-version {
  color: #9aa0a6;
  font-size: 11px;
}

/* ===== PAGINATION ===== */
.tp-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tp-pagination__info {
  font-size: 13px;
  color: #5f6368;
  margin-right: 8px;
}
.tp-pagination__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  color: #5f6368;
  font-size: 20px;
  transition: background 0.15s;
  padding: 0;
  font-family: 'Material Symbols Outlined';
}
.tp-pagination__btn:hover:not(:disabled) { background: #e8eaed; }
.tp-pagination__btn:disabled { opacity: 0.35; cursor: default; }
.tp-pagination__pages {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tp-pagination__page {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: 50% !important;
  cursor: pointer;
  color: #5f6368;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s;
  padding: 0 !important;
  width: 32px;
  line-height: 1 !important;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  box-sizing: border-box !important;
}
.tp-pagination__page:hover { background: #e8eaed; }
.tp-pagination__page--active {
  background: #1a73e8 !important;
  color: #fff !important;
  cursor: default;
}
.tp-pagination__page--ellipsis {
  cursor: default;
  color: #9aa0a6;
}
.tp-pagination__page--ellipsis:hover { background: none; }
.tp-pagination__per-page {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  font-size: 13px;
  color: #5f6368;
}
.tp-pagination__per-page select {
  border: 1px solid #dadce0;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 13px;
  background: #fff;
  color: #202124;
  cursor: pointer;
  font-family: inherit;
  outline: none;
}
.tp-pagination__per-page select:focus {
  border-color: #1a73e8;
}

/* ===== WRAPPER OVERRIDES — flat look like Menu ===== */
/* Remove Bootstrap list-group styling from root UL */
#block_group0.list-group,
ul.list-group[id^="block_group"] {
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  width: 100% !important;
  box-sizing: border-box !important;
}
/* Remove Bootstrap list-group-item borders */
.list-group-item {
  border: none !important;
  border-radius: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  background: none !important;
}
/* Child ULs (expanded values) — no borders, just indent */
ul[id^="block_group"]:not(#block_group0) {
  margin: 0 !important;
  padding: 0 0 0 40px !important;
  border: none !important;
  list-style: none !important;
  border-radius: 0 !important;
}
/* Force transparent wrapper table full width */
table.t6.table,
table.t6 {
  width: 100% !important;
  border: none !important;
  background: none !important;
  border-collapse: collapse !important;
  box-shadow: none !important;
  margin: 0 !important;
}
table.t6 td.text,
td.text {
  padding: 0 !important;
  border: none !important;
  width: 100% !important;
}
table.t6 tr,
table.t6 tbody {
  border: none !important;
}
.table-parent-wrapper {
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  overflow: visible !important;
  background: none !important;
  box-shadow: none !important;
}
/* Fix vertical centering gap between toolbar and list */
#pageContent.page-content > div {
  vertical-align: top !important;
}
/* Native page-header h1 margin override */
.page-header h1,
.page-header > h1 {
  margin: 0 !important;
}
/* Native breadcrumbs margin override */
.breadcrumbs {
  margin-bottom: 0 !important;
}
/* Remove toolbar-to-grid gap */
.tp-toolbar {
  margin-bottom: 0 !important;
  border-radius: 8px !important;
}
.tp-grid__header {
  margin-top: 0 !important;
}
.tp-grid__footer {
  margin-top: 0 !important;
}

/* Highlight selected rows (legacy compat) */
li.tp-row--selected > div {
  background: #e8f0fe !important;
}

/* Overlay & Modal */
.tp-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Segoe UI', Roboto, Arial, sans-serif;
  animation: tpFadeIn 0.2s ease;
}
.tp-overlay.tp-closing {
  animation: tpFadeOut 0.16s ease forwards;
}
.tp-overlay.tp-closing .tp-modal {
  animation: tpSlideDown 0.16s ease forwards;
}

.tp-modal {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 11px 15px -7px rgba(0,0,0,0.2), 0 24px 38px 3px rgba(0,0,0,0.14);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: tpSlideUp 0.25s ease;
}

.tp-modal-header {
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}
.tp-modal-header--danger {
  background: #c0392b;
  color: #fff;
  border-radius: 12px 12px 0 0;
}
.tp-modal-header--primary {
  background: #1a73e8;
  color: #fff;
  border-radius: 12px 12px 0 0;
}
.tp-modal-header-close {
  cursor: pointer;
  font-size: 18px;
  opacity: 0.8;
  background: none;
  border: none;
  color: inherit;
  margin-left: auto;
  transition: opacity 0.15s;
}
.tp-modal-header-close:hover { opacity: 1; }
.tp-modal-count-badge {
  background: rgba(255,255,255,0.15);
  color: white;
  font-size: 13px;
  font-weight: 400;
  padding: 4px 12px;
  border-radius: 20px;
}

.tp-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: #f8f9fa;
}

.tp-modal-footer {
  padding: 14px 24px;
  border-top: 1px solid #e8eaed;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  background: #fff;
}
.tp-modal-footer button {
  padding: 9px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  transition: all 0.15s ease;
  border: none;
}
.tp-modal-footer button:disabled { opacity: 0.5; cursor: not-allowed; }

.tp-btn-modal-primary {
  background: #1a73e8;
  color: white;
}
.tp-btn-modal-primary:hover:not(:disabled) { background: #1557b0; }
.tp-btn-modal-danger {
  background: #d93025;
  color: white;
}
.tp-btn-modal-danger:hover:not(:disabled) { background: #b71c1c; }
.tp-btn-modal-secondary {
  background: #f1f3f4;
  color: #202124;
  border: 1px solid #dadce0;
}
.tp-btn-modal-secondary:hover { background: #e8eaed; }
.tp-btn-modal-stop {
  background: #e67e22;
  color: #fff;
}
.tp-btn-modal-stop:hover { background: #d35400; }

/* Info / Warning bars */
.tp-info-bar {
  background: #e8f0fe;
  border: 1px solid #c2d7f2;
  color: #1a56b8;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
.tp-warning-bar {
  background: #fff3cd;
  border: 1px solid #ffc107;
  color: #856404;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}

/* Progress bar */
.tp-progress {
  height: 8px;
  background: #e8eaed;
  border-radius: 4px;
  overflow: hidden;
}
.tp-progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
  width: 0%;
}
.tp-progress-text {
  font-size: 12px;
  color: #5f6368;
}

/* Tabs */
.tp-tabs {
  display: flex;
  border-bottom: 2px solid #e8eaed;
  margin-bottom: 16px;
}
.tp-tab {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #5f6368;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.15s, border-color 0.15s;
}
.tp-tab:hover { color: #202124; }
.tp-tab--active {
  color: #1a73e8;
  border-bottom-color: #1a73e8;
}
.tp-tab-content { display: none; }
.tp-tab-content--active { display: block; }

/* Toggle switch */
.tp-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.tp-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.tp-switch-track {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: #dadce0;
  border-radius: 10px;
  transition: background 0.2s;
}
.tp-switch-track::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}
.tp-switch input:checked + .tp-switch-track {
  background: #1a73e8;
}
.tp-switch input:checked + .tp-switch-track::before {
  transform: translateX(16px);
}

/* Edit field row */
.tp-field-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
}
.tp-field-row:last-child { border-bottom: none; }
.tp-field-label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #202124;
}
.tp-field-select {
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
}

/* CSV preview table */
.tp-csv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 8px;
}
.tp-csv-table th {
  background: #f1f3f4;
  padding: 6px 10px;
  text-align: left;
  font-weight: 500;
  border-bottom: 2px solid #dadce0;
}
.tp-csv-table td {
  padding: 6px 10px;
  border-bottom: 1px solid #f0f0f0;
}
.tp-csv-table tr:hover { background: #f8f9fa; }

/* File upload area */
.tp-upload-area {
  border: 2px dashed #dadce0;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  color: #5f6368;
  font-size: 13px;
}
.tp-upload-area:hover {
  border-color: #1a73e8;
  background: #f0f6ff;
}

/* Spinner */
.tp-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #e8eaed;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: tpSpin 0.6s linear infinite;
}
`;
    doc.head.appendChild(style);
  }

  // =========================================================================
  // GRID HEADER
  // =========================================================================

  function buildGridHeader(doc) {
    const existing = doc.querySelector('.tp-grid__header');
    if (existing) existing.remove();

    const header = doc.createElement('div');
    header.className = 'tp-grid__header';
    header.innerHTML =
      '<div class="tp-col-drag"></div>' +
      '<div class="tp-col-check"><input type="checkbox" id="tp-select-all-header" class="tp-checkbox" title="Zaznacz/Odznacz wszystko"></div>' +
      '<div class="tp-col-expand"></div>' +
      '<div class="tp-col-name">Nazwa <span class="tp-header-hint">(Dwuklik na nazw\u0119 = edycja)</span></div>' +
      '<div class="tp-col-id">ID</div>' +
      '<div class="tp-col-priority">Priorytet</div>' +
      '<div class="tp-col-children">Dzieci</div>' +
      '<div class="tp-col-products">Produkty</div>' +
      '<div class="tp-col-actions">Akcje</div>';

    // Select-all checkbox handler
    const selectAllCb = header.querySelector('#tp-select-all-header');
    selectAllCb.addEventListener('change', function() {
      if (selectAllCb.checked) {
        selectAll(doc);
      } else {
        deselectAll(doc);
      }
    });

    // Insert before the tree list
    const treeRoot = doc.querySelector('#block_group0') || doc.querySelector('ul[id^="block_group"]');
    if (treeRoot) {
      treeRoot.parentNode.insertBefore(header, treeRoot);
    }
  }

  // =========================================================================
  // MERGE MODE (click-based merge for values)
  // =========================================================================

  var _mergeState = {
    active: false,
    sourceId: null,
    sourceName: null,
    parentId: null,
    doc: null
  };

  function enterMergeMode(doc, sourceId, sourceName, parentId) {
    // Cancel any previous merge mode
    if (_mergeState.active) exitMergeMode();

    _mergeState = { active: true, sourceId: sourceId, sourceName: sourceName, parentId: parentId, doc: doc };

    // Highlight source row
    var sourceLi = doc.getElementById('m_' + sourceId);
    if (sourceLi) sourceLi.classList.add('tp-merge-source');

    // Highlight ALL values on the page as targets (mergeParam works cross-parameter)
    var allValues = doc.querySelectorAll('div[id^="showMenuSub_"].value');
    for (var i = 0; i < allValues.length; i++) {
      var valId = allValues[i].id.replace('showMenuSub_', '');
      if (valId !== sourceId) {
        var valLi = doc.getElementById('m_' + valId);
        if (valLi) valLi.classList.add('tp-merge-target');
      }
    }
    // Also highlight siblings that might not have .value class yet (collapsed)
    var parentUl = doc.getElementById('block_group' + parentId);
    if (parentUl) {
      var siblings = parentUl.querySelectorAll(':scope > li[id^="m_"]');
      for (var j = 0; j < siblings.length; j++) {
        if (getNodeId(siblings[j]) !== sourceId) {
          siblings[j].classList.add('tp-merge-target');
        }
      }
    }

    // Show banner
    var existing = doc.getElementById('tp-merge-banner');
    if (existing) existing.remove();
    var banner = doc.createElement('div');
    banner.id = 'tp-merge-banner';
    banner.innerHTML =
      '<span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;">merge</span>' +
      'Tryb \u0142\u0105czenia: kliknij warto\u015b\u0107 docelow\u0105 dla <strong>' + escapeHtml(sourceName) + '</strong>' +
      '<span id="tp-merge-cancel" style="margin-left:12px;cursor:pointer;font-weight:bold;padding:4px 10px;border-radius:4px;background:rgba(255,255,255,0.3);">\u2715 Anuluj</span>';
    var toolbar = doc.getElementById('tp-toolbar');
    if (toolbar) {
      toolbar.parentNode.insertBefore(banner, toolbar.nextSibling);
    } else {
      doc.body.insertBefore(banner, doc.body.firstChild);
    }
    banner.querySelector('#tp-merge-cancel').addEventListener('click', function() {
      exitMergeMode();
    });

    // Listen for target clicks
    doc.addEventListener('click', mergeTargetClickHandler, true);
  }

  function exitMergeMode() {
    if (!_mergeState.doc) return;
    var doc = _mergeState.doc;

    // Remove highlights
    var sources = doc.querySelectorAll('.tp-merge-source');
    for (var i = 0; i < sources.length; i++) sources[i].classList.remove('tp-merge-source');
    var targets = doc.querySelectorAll('.tp-merge-target');
    for (var i = 0; i < targets.length; i++) targets[i].classList.remove('tp-merge-target');

    // Remove banner
    var banner = doc.getElementById('tp-merge-banner');
    if (banner) banner.remove();

    // Remove listener
    doc.removeEventListener('click', mergeTargetClickHandler, true);

    _mergeState = { active: false, sourceId: null, sourceName: null, parentId: null, doc: null };
  }

  function mergeTargetClickHandler(e) {
    if (!_mergeState.active) return;

    var targetLi = e.target.closest('li.tp-merge-target');
    if (!targetLi) {
      // Clicking outside targets — check if it's cancel or ignore
      if (e.target.closest('#tp-merge-banner')) return;
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    var targetId = getNodeId(targetLi);
    if (!targetId) return;

    var targetNameEl = _mergeState.doc.getElementById('showMenuSub_' + targetId);
    var targetName = targetNameEl ? targetNameEl.textContent.trim() : 'ID ' + targetId;

    var msg = 'UWAGA: Operacja jest NIEODWRACALNA!\n\n' +
      'Po\u0142\u0105czy\u0107 warto\u015b\u0107:\n' +
      '  \u201e' + _mergeState.sourceName + '\u201d (ID: ' + _mergeState.sourceId + ')\n' +
      'z warto\u015bci\u0105:\n' +
      '  \u201e' + targetName + '\u201d (ID: ' + targetId + ')?\n\n' +
      'Produkty przypisane do \u201e' + _mergeState.sourceName + '\u201d zostan\u0105 przepisane do \u201e' + targetName + '\u201d.\n' +
      'Warto\u015b\u0107 \u201e' + _mergeState.sourceName + '\u201d zostanie usuni\u0119ta.';

    if (!confirm(msg)) return;

    var sourceId = _mergeState.sourceId;
    var doc = _mergeState.doc;
    exitMergeMode();

    // Call native merge API
    var xhr = new XMLHttpRequest();
    xhr.open('POST', AJAX_URL, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onload = function() {
      if (xhr.status === 200) {
        showForceDeleteStatus(doc, 'Po\u0142\u0105czono warto\u015bci');

        // Find source's parent parameter BEFORE removing from DOM
        var sourceParentId = getParentId(doc, sourceId);

        // Remove source li from DOM
        var sourceLi = doc.getElementById('m_' + sourceId);
        if (sourceLi) {
          var space = doc.getElementById('space_' + sourceId);
          if (space) space.remove();
          sourceLi.remove();
        }
        updateCounter(doc);

        // Check if source's parent parameter is now empty (no more values)
        if (sourceParentId && sourceParentId !== '0') {
          var parentBlock = doc.getElementById('block_group' + sourceParentId);
          var remainingValues = parentBlock ? parentBlock.querySelectorAll(':scope > li[id^="m_"]').length : 0;
          if (remainingValues === 0) {
            // Parameter is empty after merge — auto-delete it (with force detach)
            showForceDeleteStatus(doc, 'Parametr pusty po po\u0142\u0105czeniu \u2014 usuwanie...');
            var parentName = getNodeName(doc, sourceParentId);
            forceDeleteNode(doc, sourceParentId, getParentId(doc, sourceParentId), parentName, true).then(function(ok) {
              if (ok) {
                var paramLi = doc.getElementById('m_' + sourceParentId);
                if (paramLi) {
                  var paramSpace = doc.getElementById('space_' + sourceParentId);
                  if (paramSpace) paramSpace.remove();
                  paramLi.remove();
                }
                showForceDeleteStatus(doc, 'Usuni\u0119to pusty parametr "' + parentName + '"');
                updateCounter(doc);
              }
            });
          }
        }

        // Update product count on target value
        fetchAjax('action=numberOfOccurrence&id=' + targetId).then(function(resp) {
          var newCount = (resp.data && resp.data.numberOfProduct) ? resp.data.numberOfProduct : '?';
          var targetLi = doc.getElementById('m_' + targetId);
          if (targetLi) {
            var prodCell = targetLi.querySelector('.tp-col-products');
            if (prodCell) {
              var link = prodCell.querySelector('a');
              if (link) {
                link.textContent = newCount;
              } else {
                prodCell.textContent = newCount;
              }
            }
          }
          var nativeLink = doc.getElementById('products_' + targetId);
          if (nativeLink) {
            nativeLink.textContent = nativeLink.textContent.replace(/\d+/, newCount);
          }
        }).catch(function() {});
      } else {
        showForceDeleteStatus(doc, 'B\u0142\u0105d przy \u0142\u0105czeniu warto\u015bci', true);
      }
    };
    xhr.onerror = function() {
      showForceDeleteStatus(doc, 'B\u0142\u0105d sieci przy \u0142\u0105czeniu', true);
    };
    xhr.send('action=mergeParam&id=' + sourceId + '&idExist=' + targetId);
  }

  function disableNativeDraggable(doc) {
    // Disable native jQuery UI draggable on value rows to prevent accidental merge via drag
    // This runs after children are loaded via MutationObserver
    if (!doc.defaultView || !doc.defaultView.jQuery) return;
    var $ = doc.defaultView.jQuery;
    try {
      var draggables = $(doc).find('li.ui-draggable');
      draggables.each(function() {
        try { $(this).draggable('disable'); } catch(_e) {}
      });
    } catch(_e) {}
  }

  // =========================================================================
  // ENHANCE ROWS (replaces injectCheckbox)
  // =========================================================================

  // =========================================================================
  // PRIORITY CELL (index/total with ↑↓ arrows, saves via saveManualSort)
  // =========================================================================

  function computePriorityInfo(li) {
    var parentUl = li.parentNode;
    if (!parentUl || !parentUl.id || !/^block_group/.test(parentUl.id)) {
      return { index: 0, total: 0 };
    }
    var siblings = Array.prototype.slice.call(parentUl.querySelectorAll(':scope > li[id^="m_"]'));
    var idx = siblings.indexOf(li);
    return { index: idx + 1, total: siblings.length, siblings: siblings };
  }

  function saveSiblingsOrder(doc, siblings) {
    var sortOrder = [];
    for (var i = 0; i < siblings.length; i++) {
      var nid = getNodeId(siblings[i]);
      if (!nid) continue;
      sortOrder.push({ id: Number(nid), sortOrder: i + 1 });
    }
    return new Promise(function(resolve) {
      var xhr = new (doc.defaultView || window).XMLHttpRequest();
      xhr.open('POST', '/panel/ajax/parameters.php', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = function() { resolve(xhr.status === 200); };
      xhr.onerror = function() { resolve(false); };
      xhr.send('action=saveManualSort&parameters=' + encodeURIComponent(JSON.stringify(sortOrder)));
    });
  }

  function refreshSiblingPriorityCells(parentUl) {
    if (!parentUl) return;
    var siblings = Array.prototype.slice.call(parentUl.querySelectorAll(':scope > li[id^="m_"]'));
    for (var i = 0; i < siblings.length; i++) {
      var cell = siblings[i].querySelector(':scope > .tp-col-priority');
      if (!cell) continue;
      var txt = cell.querySelector('.tp-prio-text');
      var upBtn = cell.querySelector('.tp-prio-btn--up');
      var downBtn = cell.querySelector('.tp-prio-btn--down');
      if (txt) txt.textContent = (i + 1) + '/' + siblings.length;
      if (upBtn) upBtn.classList.toggle('tp-prio-btn--disabled', i === 0);
      if (downBtn) downBtn.classList.toggle('tp-prio-btn--disabled', i === siblings.length - 1);
    }
  }

  function moveNodePriority(doc, li, direction) {
    var parentUl = li.parentNode;
    if (!parentUl) return;
    var siblings = Array.prototype.slice.call(parentUl.querySelectorAll(':scope > li[id^="m_"]'));
    var idx = siblings.indexOf(li);
    if (idx === -1) return;
    var newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= siblings.length) return;

    var swapWith = siblings[newIdx];
    var myNid = getNodeId(li);
    var swapNid = getNodeId(swapWith);

    // Move DOM (also handle space_ companion elements)
    var mySpace = myNid ? doc.getElementById('space_' + myNid) : null;
    var swapSpace = swapNid ? doc.getElementById('space_' + swapNid) : null;

    if (direction === 'up') {
      parentUl.insertBefore(li, swapWith);
      if (mySpace) parentUl.insertBefore(mySpace, li);
    } else {
      var afterSwap = swapWith.nextSibling;
      parentUl.insertBefore(li, afterSwap);
      if (mySpace) parentUl.insertBefore(mySpace, li);
    }

    // Update UI immediately
    refreshSiblingPriorityCells(parentUl);

    // Save to server
    saveSiblingsOrder(doc, Array.prototype.slice.call(parentUl.querySelectorAll(':scope > li[id^="m_"]'))).then(function(ok) {
      if (ok) {
        showForceDeleteStatus(doc, 'Zapisano now\u0105 kolejno\u015b\u0107');
      } else {
        showForceDeleteStatus(doc, 'B\u0142\u0105d zapisu kolejno\u015bci', true);
      }
    });
  }

  function buildPriorityCell(doc, li, nodeId) {
    var cell = doc.createElement('div');
    cell.className = 'tp-col-priority';
    var info = computePriorityInfo(li);

    var upBtn = doc.createElement('span');
    upBtn.className = 'material-symbols-outlined tp-prio-btn tp-prio-btn--up';
    upBtn.textContent = 'expand_less';
    upBtn.title = 'Przesu\u0144 w g\u00f3r\u0119';
    if (info.index <= 1) upBtn.classList.add('tp-prio-btn--disabled');
    upBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      moveNodePriority(doc, li, 'up');
    });

    var txt = doc.createElement('span');
    txt.className = 'tp-prio-text';
    txt.textContent = info.total > 0 ? (info.index + '/' + info.total) : '\u2014';

    var downBtn = doc.createElement('span');
    downBtn.className = 'material-symbols-outlined tp-prio-btn tp-prio-btn--down';
    downBtn.textContent = 'expand_more';
    downBtn.title = 'Przesu\u0144 w d\u00f3\u0142';
    if (info.index >= info.total) downBtn.classList.add('tp-prio-btn--disabled');
    downBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      moveNodePriority(doc, li, 'down');
    });

    cell.appendChild(upBtn);
    cell.appendChild(txt);
    cell.appendChild(downBtn);
    return cell;
  }

  // v4.5.7: Direct XHR rename, no modal opened
  function _saveRenameDirect(doc, nodeId, newName) {
    return new Promise(function (resolve, reject) {
      var win = getIframeWin() || doc.defaultView;
      var xhr = new win.XMLHttpRequest();
      xhr.open('POST', '/panel/ajax/parameters.php', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var j = JSON.parse(xhr.responseText || '{}');
            if (j && j.errno && j.errno !== 0) return reject(new Error(j.message || ('errno ' + j.errno)));
          } catch (e) {}
          resolve();
        } else { reject(new Error('HTTP ' + xhr.status)); }
      };
      xhr.onerror = function () { reject(new Error('Network error')); };
      var body = 'action=setSettings&id=' + encodeURIComponent(nodeId) +
                 '&menuSection=true&names[' + LANG + ']=' + encodeURIComponent(newName);
      xhr.send(body);
    });
  }

  var _inlineEditActive = false;
  function startInlineRename(doc, li, nameEl, label, nodeId, saveFn) {
    if (_inlineEditActive) return;
    _inlineEditActive = true;
    var orig = label.textContent;
    var wrap = doc.createElement('span');
    wrap.style.cssText = 'display:flex; align-items:center; gap:6px; flex:1; min-width:0;';
    var input = doc.createElement('input');
    input.type = 'text';
    input.value = orig;
    input.className = 'tp-inline-edit-input';
    input.style.cssText = 'flex:1; min-width:80px; padding:3px 6px; font-size:14px; border:1px solid #2563eb; border-radius:4px; outline:none; background:#fff; font-family:inherit; color:#202124; box-sizing:border-box;';
    var okBtn = doc.createElement('button');
    okBtn.type = 'button';
    okBtn.title = 'Zapisz (Enter)';
    okBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">check</span>';
    okBtn.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:1px solid #16a34a; border-radius:4px; background:#fff; color:#16a34a; cursor:pointer; flex-shrink:0;';
    var cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.title = 'Anuluj (Esc)';
    cancelBtn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">close</span>';
    cancelBtn.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; border:1px solid #dc2626; border-radius:4px; background:#fff; color:#dc2626; cursor:pointer; flex-shrink:0;';
    wrap.appendChild(input);
    wrap.appendChild(okBtn);
    wrap.appendChild(cancelBtn);
    label.style.display = 'none';
    label.parentElement.insertBefore(wrap, label.nextSibling);
    input.focus();
    input.select();
    okBtn.addEventListener('click', function (e) { e.stopPropagation(); save(); });
    cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); cancel(); });

    function cancel() {
      if (wrap && wrap.parentElement) wrap.remove();
      label.style.display = '';
      _inlineEditActive = false;
    }
    function save() {
      var newName = input.value.trim();
      if (!newName || newName === orig) { cancel(); return; }
      input.disabled = true;
      input.style.opacity = '0.6';
      (saveFn ? saveFn(nodeId, newName) : _saveRenameDirect(doc, nodeId, newName)).then(function () {
        label.textContent = newName;
        // Also update the native span in case other parts of the page rely on it
        if (nameEl) nameEl.textContent = newName;
        cancel();
        if (_panel && _panel.showStatus) _panel.showStatus('Zapisano nową nazwę');
      }).catch(function (err) {
        input.disabled = false;
        input.style.opacity = '';
        input.style.borderColor = '#d93025';
        input.title = 'Błąd zapisu: ' + (err && err.message || err);
      });
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', function () {
      setTimeout(function () {
        if (_inlineEditActive && input.parentElement && !input.disabled) save();
      }, 200);
    });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }

  function enhanceRow(li, doc) {
    const nodeId = getNodeId(li);
    if (!nodeId) return;
    if (li.classList.contains('tp-row-enhanced')) {
      // Migration v3.3 -> v3.4: if row has legacy tp-col-type but not new cols, re-enhance
      var hasLegacy = li.querySelector(':scope > .tp-col-type');
      var hasNew = li.querySelector(':scope > .tp-col-priority');
      if (hasLegacy && !hasNew) {
        // Remove all tp-col-* wrapper cells so we rebuild
        var legacyCells = li.querySelectorAll(':scope > .tp-col-drag, :scope > .tp-col-check, :scope > .tp-col-expand, :scope > .tp-col-name, :scope > .tp-col-id, :scope > .tp-col-type, :scope > .tp-col-products, :scope > .tp-col-actions');
        legacyCells.forEach(function(c) { c.remove(); });
        li.classList.remove('tp-row-enhanced');
      } else {
        return;
      }
    }

    const nameEl = li.querySelector('.showMenuSub');
    if (!nameEl) return;

    li.classList.add('tp-row-enhanced');
    if (_panel && _panel.applyRowGrid) _panel.applyRowGrid(li);
    if (selectedNodes.has(nodeId)) {
      li.classList.add('tp-row--selected');
      li.classList.add('panel-pro--selected');
    }

    const isPar = isParameter(doc, nodeId);
    const isVal = isValue(doc, nodeId);
    const nodeName = nameEl.textContent.trim();

    // 0. Drag handle cell (only for values — acts as native jQuery UI sortable handle)
    const dragCell = doc.createElement('div');
    dragCell.className = 'tp-col-drag';
    if (isVal) {
      const dragIcon = doc.createElement('span');
      dragIcon.className = 'material-symbols-outlined tp-drag-handle moveEl';
      dragIcon.textContent = 'drag_indicator';
      dragIcon.title = 'Przeci\u0105gnij aby zmieni\u0107 kolejno\u015b\u0107';
      dragCell.appendChild(dragIcon);
    }

    // 1. Checkbox cell
    const checkCell = doc.createElement('div');
    checkCell.className = 'tp-col-check';
    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'tp-checkbox';
    cb.dataset.nodeId = nodeId;
    cb.checked = selectedNodes.has(nodeId);
    cb.addEventListener('click', function(e) { e.stopPropagation(); });
    cb.addEventListener('change', function(e) {
      e.stopPropagation();
      if (cb.checked) {
        selectedNodes.add(nodeId);
        li.classList.add('tp-row--selected');
        li.classList.add('panel-pro--selected');
      } else {
        selectedNodes.delete(nodeId);
        li.classList.remove('tp-row--selected');
        li.classList.remove('panel-pro--selected');
      }
      // Cascade to children
      const childBlock = doc.getElementById('block_group' + nodeId);
      if (childBlock) {
        const childLis = childBlock.querySelectorAll(':scope > li[id^="m_"]');
        for (var i = 0; i < childLis.length; i++) {
          var childLi = childLis[i];
          var childId = getNodeId(childLi);
          if (!childId) continue;
          if (cb.checked) {
            selectedNodes.add(childId);
            childLi.classList.add('tp-row--selected');
            childLi.classList.add('panel-pro--selected');
          } else {
            selectedNodes.delete(childId);
            childLi.classList.remove('tp-row--selected');
            childLi.classList.remove('panel-pro--selected');
          }
          var childCb = childLi.querySelector('.tp-checkbox');
          if (childCb) childCb.checked = cb.checked;
        }
      }
      // v4.5.66: zaznaczenie wartości => auto-zaznacz rodzica-parametr
      // (nie da się wyeksportować samych wartości bez parametru)
      if (cb.checked && isValue(doc, nodeId)) {
        var pId = getParentId(doc, nodeId);
        if (pId && pId !== '0') {
          selectedNodes.add(pId);
          var pLi = doc.getElementById('m_' + pId);
          if (pLi) {
            pLi.classList.add('tp-row--selected');
            pLi.classList.add('panel-pro--selected');
            var pCb = pLi.querySelector(':scope > .tp-col-check .tp-checkbox') || pLi.querySelector('.tp-checkbox');
            if (pCb) pCb.checked = true;
          }
        }
      }
      updateCounter(doc);
    });
    checkCell.appendChild(cb);

    // 2. Expand cell
    const expandCell = doc.createElement('div');
    expandCell.className = 'tp-col-expand';
    const showBtn = li.querySelector('.showChildren');
    const hideBtn = li.querySelector('.hideChildren');
    if (isPar) {
      // Parameter: folder icon (open/closed), clickable if has children
      var hasChildren = showBtn || hideBtn;
      const folderIcon = doc.createElement('span');
      folderIcon.className = 'material-symbols-outlined tp-expand-icon';
      var childBlock0 = doc.getElementById('block_group' + nodeId);
      var isOpen0 = childBlock0 && childBlock0.children.length > 0 && childBlock0.style.display !== 'none';
      folderIcon.textContent = hasChildren ? (isOpen0 ? 'folder_open' : 'folder') : 'folder_off';
      folderIcon.style.fontSize = '20px';
      folderIcon.style.color = hasChildren ? '#e67e22' : '#ccc';
      folderIcon.style.cursor = hasChildren ? 'pointer' : 'default';
      if (hasChildren) {
        folderIcon.addEventListener('click', function(e) {
          e.stopPropagation();
          var childBlock = doc.getElementById('block_group' + nodeId);
          var isExpanded = childBlock && childBlock.children.length > 0 && childBlock.style.display !== 'none';
          if (isExpanded) {
            var hBtn = li.querySelector('.hideChildren');
            if (hBtn) hBtn.click();
            folderIcon.textContent = 'folder';
            setTimeout(function () { updateCounter(doc); }, 100);
          } else {
            var sBtn = li.querySelector('.showChildren');
            if (sBtn) sBtn.click();
            folderIcon.textContent = 'folder_open';
            // After AJAX load, check if children actually appeared
            setTimeout(function() {
              var cb = doc.getElementById('block_group' + nodeId);
              if (!cb || cb.querySelectorAll(':scope > li').length === 0) {
                folderIcon.textContent = 'folder_off';
                folderIcon.style.color = '#ccc';
                folderIcon.style.cursor = 'default';
              }
            }, 1500);
          }
        });
      }
      expandCell.appendChild(folderIcon);
    } else if (isVal) {
      // Value: subdirectory arrow (non-clickable)
      const subIcon = doc.createElement('span');
      subIcon.className = 'material-symbols-outlined';
      subIcon.textContent = 'subdirectory_arrow_right';
      subIcon.style.cssText = 'font-size:18px;color:#bbb;';
      expandCell.appendChild(subIcon);
    }

    // 3. Name cell (no icon before name — folder moved to expand cell)
    const nameCell = doc.createElement('div');
    nameCell.className = 'tp-col-name';
    const icon = doc.createElement('span');
    icon.className = 'material-symbols-outlined tp-row-icon' + (isPar ? ' tp-row-icon--param' : ' tp-row-icon--value');
    icon.textContent = isVal ? 'sell' : '';
    if (isVal) nameCell.appendChild(icon);
    const label = doc.createElement('span');
    label.className = 'tp-row-label';
    label.textContent = nodeName;
    label.title = nodeName + ' (Dwuklik = edycja)';
    label.style.cursor = 'pointer';
    label.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      e.preventDefault();
      startInlineRename(doc, li, nameEl, label, nodeId);
    });
    nameCell.appendChild(label);

    // 4. ID cell
    const idCell = doc.createElement('div');
    idCell.className = 'tp-col-id tp-copyable';
    idCell.textContent = nodeId;
    idCell.title = 'Kliknij aby skopiowa\u0107';
    idCell.addEventListener('click', function() {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(nodeId);
      } else {
        // Fallback
        var ta = doc.createElement('textarea');
        ta.value = nodeId;
        ta.style.cssText = 'position:fixed;left:-9999px;';
        doc.body.appendChild(ta);
        ta.select();
        doc.execCommand('copy');
        ta.remove();
      }
      idCell.style.background = '#c8e6c9';
      setTimeout(function() { idCell.style.background = ''; }, 600);
    });

    // 5a. Priority cell (1/N with up/down arrows; calls saveManualSort)
    // v4.3.2: priority column removed from UI

    // 5b. Children count cell (for parameters: number of child values)
    const childrenCell = doc.createElement('div');
    childrenCell.className = 'tp-col-children';
    if (isPar) {
      var childUl = doc.getElementById('block_group' + nodeId);
      var childCount = childUl ? childUl.querySelectorAll(':scope > li[id^="m_"]').length : 0;
      // If not loaded, we can't know yet — show placeholder
      if (childUl && childCount > 0) {
        childrenCell.textContent = String(childCount);
      } else {
        childrenCell.textContent = '\u2014';
        childrenCell.classList.add('tp-col-children--empty');
        childrenCell.dataset.nodeId = nodeId;
      }
    } else {
      childrenCell.textContent = '\u2014';
      childrenCell.classList.add('tp-col-children--empty');
    }

    // 6. Products cell
    const productsCell = doc.createElement('div');
    productsCell.className = 'tp-col-products';
    // Try to read product count from native iteminfo
    var productsLink = doc.getElementById('products_' + nodeId);
    if (productsLink) {
      var countMatch = productsLink.textContent.match(/(\d+)/);
      var count = countMatch ? countMatch[1] : '0';
      var link = doc.createElement('a');
      link.href = 'javascript:void(0)';
      link.textContent = count;
      link.title = 'Poka\u017c produkty';
      link.addEventListener('click', function(e) {
        e.stopPropagation();
        // Use native link to ensure correct navigation
        var nativeLink = doc.getElementById('products_' + nodeId);
        if (nativeLink) nativeLink.click();
      });
      productsCell.appendChild(link);
    } else if (isVal) {
      // Products info may load later; set up a lazy check
      productsCell.dataset.nodeId = nodeId;
      productsCell.textContent = '\u2014';
    }

    // 7. Actions cell
    const actionsCell = doc.createElement('div');
    actionsCell.className = 'tp-col-actions';

    // Helper to ensure native options are revealed before clicking them
    function ensureOptionsAndClick(nativeSelector) {
      // First click the name to reveal the .options span
      nameEl.click();
      setTimeout(function() {
        var el = doc.getElementById(nativeSelector);
        if (el) el.click();
      }, 100);
    }

    // a) Add value (dodaj wartość) — only for parameters
    if (isPar) {
      var addAction = doc.createElement('span');
      addAction.className = 'material-symbols-outlined tp-action-btn';
      addAction.textContent = 'add_circle';
      addAction.title = 'Dodaj warto\u015b\u0107';
      addAction.dataset.tooltip = 'Dodaj warto\u015b\u0107';
      addAction.addEventListener('click', function(e) {
        e.stopPropagation();
        createNewValue(doc, nodeId, nodeName);
      });
      actionsCell.appendChild(addAction);
    }

    // b) Settings (edytuj) — triggers native editEl
    var editAction = doc.createElement('span');
    editAction.className = 'material-symbols-outlined tp-action-btn';
    editAction.textContent = 'settings';
    editAction.title = 'Edytuj';
    editAction.dataset.tooltip = 'Edytuj';
    editAction.addEventListener('click', function(e) {
      e.stopPropagation();
      showEditElementModal(doc, nodeId);
    });
    actionsCell.appendChild(editAction);

    // c) Set as default (ustaw jako domyślny) — only for parameters
    if (isPar) {
      var defaultAction = doc.createElement('span');
      defaultAction.className = 'material-symbols-outlined tp-action-btn';
      defaultAction.textContent = 'star';
      defaultAction.title = 'Ustaw jako domy\u015blny';
      defaultAction.dataset.tooltip = 'Ustaw jako domy\u015blny';
      defaultAction.addEventListener('click', function(e) {
        e.stopPropagation();
        ensureOptionsAndClick('default_' + nodeId);
      });
      actionsCell.appendChild(defaultAction);
    }

    // d) Sort child values with natural ordering — only for parameters
    if (isPar) {
      var sortAction = doc.createElement('span');
      sortAction.className = 'material-symbols-outlined tp-action-btn';
      sortAction.textContent = 'sort_by_alpha';
      sortAction.title = 'Posortuj warto\u015bci (sortowanie naturalne)';
      sortAction.dataset.tooltip = 'Posortuj warto\u015bci';
      sortAction.addEventListener('click', function(e) {
        e.stopPropagation();
        sortChildValuesNatural(doc, nodeId, 'name');
      });
      actionsCell.appendChild(sortAction);

      // v4.6.1: sortowanie wartości po ID (rosnąco)
      var sortIdAction = doc.createElement('span');
      sortIdAction.className = 'material-symbols-outlined tp-action-btn';
      sortIdAction.textContent = 'tag';
      sortIdAction.title = 'Posortuj wartości wg ID (rosnąco)';
      sortIdAction.dataset.tooltip = 'Posortuj wartości wg ID';
      sortIdAction.addEventListener('click', function(e) {
        e.stopPropagation();
        sortChildValuesNatural(doc, nodeId, 'id');
      });
      actionsCell.appendChild(sortIdAction);
    }

    // e) Merge element (połącz) — click-based merge mode for values
    if (isVal) {
      var mergeAction = doc.createElement('span');
      mergeAction.className = 'material-symbols-outlined tp-action-btn tp-action-btn--merge';
      mergeAction.textContent = 'merge';
      mergeAction.title = 'Po\u0142\u0105cz z inn\u0105 warto\u015bci\u0105';
      mergeAction.dataset.tooltip = 'Po\u0142\u0105cz';
      mergeAction.addEventListener('click', function(e) {
        e.stopPropagation();
        var parentUl = li.closest('ul[id^="block_group"]');
        var parentId = parentUl ? parentUl.id.replace('block_group', '') : '0';
        enterMergeMode(doc, nodeId, nodeName, parentId);
      });
      actionsCell.appendChild(mergeAction);
    }

    // g) Delete (always red)
    var deleteAction = doc.createElement('span');
    deleteAction.className = 'material-symbols-outlined tp-action-btn tp-action-btn--danger';
    deleteAction.textContent = 'delete';
    deleteAction.title = 'Usu\u0144';
    deleteAction.dataset.tooltip = 'Usu\u0144';
    deleteAction.addEventListener('click', function(e) {
      e.stopPropagation();
      var parentUl = li.closest('ul[id^="block_group"]');
      var parentId = parentUl ? parentUl.id.replace('block_group', '') : '0';
      if (!confirm('Usun\u0105\u0107 "' + nodeName + '"?')) return;
      forceDeleteNode(doc, nodeId, parentId, nodeName).then(function(success) {
        if (success) {
          var space = doc.getElementById('space_' + nodeId);
          if (space) space.remove();
          li.remove();
          updateCounter(doc);
        }
      });
    });
    actionsCell.appendChild(deleteAction);

    // v4.5.48: kontekst — pusta komórka, wypełniana w tle przez loadContextsInBackground
    var contextCell = doc.createElement('div');
    contextCell.className = 'tp-col-context';
    contextCell.style.cssText = 'text-align:center';
    // v4.6.16: kolumny Grafika + Opis (status), wypełniane razem z kontekstem
    var gfxCell = doc.createElement('div');
    gfxCell.className = 'tp-col-gfx';
    gfxCell.style.cssText = 'text-align:center';
    var descCell = doc.createElement('div');
    descCell.className = 'tp-col-desc';
    descCell.style.cssText = 'text-align:center';
    var cachedCtx = _ctxCache[nodeId];
    if (cachedCtx) {
      contextCell.dataset.ctxLoaded = '1';
      renderContextCell(contextCell, cachedCtx.ctx);
      renderGfxCell(gfxCell, cachedCtx.gfx);
      renderDescCell(descCell, cachedCtx.descSet);
    }

    // Insert cells at the beginning (before existing content)
    li.insertBefore(actionsCell, li.firstChild);
    li.insertBefore(descCell, li.firstChild);
    li.insertBefore(gfxCell, li.firstChild);
    li.insertBefore(contextCell, li.firstChild);
    li.insertBefore(productsCell, li.firstChild);
    li.insertBefore(childrenCell, li.firstChild);
    li.insertBefore(idCell, li.firstChild);
    li.insertBefore(nameCell, li.firstChild);
    li.insertBefore(expandCell, li.firstChild);
    li.insertBefore(checkCell, li.firstChild);
    li.insertBefore(dragCell, li.firstChild);
  }

  function enhanceAllRows(doc) {
    const items = doc.querySelectorAll('li[id^="m_"]');
    for (var i = 0; i < items.length; i++) {
      enhanceRow(items[i], doc);
    }
  }

  function updateExpandIcon(li, doc) {
    var nodeId = getNodeId(li);
    if (!nodeId) return;
    var expandIcon = li.querySelector('.tp-expand-icon');
    if (!expandIcon) return;
    var childBlock = doc.getElementById('block_group' + nodeId);
    var isExpanded = childBlock && childBlock.children.length > 0 && childBlock.style.display !== 'none';
    expandIcon.textContent = isExpanded ? 'expand_more' : 'chevron_right';
  }

  function updateChildrenCounts(doc) {
    var cells = doc.querySelectorAll('.tp-col-children[data-node-id]');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var nid = cell.dataset.nodeId;
      var childUl = doc.getElementById('block_group' + nid);
      if (!childUl) continue;
      var count = childUl.querySelectorAll(':scope > li[id^="m_"]').length;
      if (count > 0) {
        cell.textContent = String(count);
        cell.classList.remove('tp-col-children--empty');
        delete cell.dataset.nodeId;
      }
    }
  }

  function updateProductCounts(doc) {
    updateChildrenCounts(doc);
    var cells = doc.querySelectorAll('.tp-col-products[data-node-id]');
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var nid = cell.dataset.nodeId;
      var prodLink = doc.getElementById('products_' + nid);
      if (prodLink && cell.textContent === '\u2014') {
        var countMatch = prodLink.textContent.match(/(\d+)/);
        var count = countMatch ? countMatch[1] : '0';
        cell.textContent = '';
        var link = doc.createElement('a');
        link.href = 'javascript:void(0)';
        link.textContent = count;
        link.title = 'Poka\u017c produkty';
        (function(id) {
          link.addEventListener('click', function(e) {
            e.stopPropagation();
            var nativeLink = doc.getElementById('products_' + id);
            if (nativeLink) nativeLink.click();
          });
        })(nid);
        cell.appendChild(link);
      }
    }
  }

  // =========================================================================
  // PAGINATION
  // =========================================================================

  var _paginationState = {
    currentPage: 1,
    perPage: loadPerPagePref(),
    totalVisible: 0,
    doc: null
  };

  function getRootItems(doc) {
    var root = doc.querySelector('#block_group0');
    if (!root) return [];
    return Array.from(root.querySelectorAll(':scope > li[id^="m_"]'));
  }

  // v4.5.53: tylko wiersze aktualnej strony — używane do priorytetowego ładowania danych
  function getVisibleRootItems(doc) {
    return getRootItems(doc).filter(function (li) {
      return !li.classList.contains('tp-row--hidden') &&
             !li.classList.contains('tp-row--filter-hidden') &&
             !li.classList.contains('panel-pro--view-hidden');
    });
  }

  function applyPagination(doc) {
    var items = getRootItems(doc);
    // Collect items that are either visible or only hidden by pagination
    var filteredItems = items.filter(function(li) {
      return !li.classList.contains('tp-row--filter-hidden') &&
             !li.classList.contains('tp-row--view-hidden');
    });

    var perPage = _paginationState.perPage;

    // perPage === 0 means "show all"
    if (perPage === 0) {
      for (var k = 0; k < filteredItems.length; k++) {
        filteredItems[k].classList.remove('tp-row--hidden');
      }
      _paginationState.currentPage = 1;
      _paginationState.totalVisible = filteredItems.length;
      if (typeof refreshPagination === 'function' && _panel) refreshPagination(doc, _panel);
      else renderPaginationControls(doc, 1);
      updateCounter(doc);
      return;
    }

    var totalPages = Math.max(1, Math.ceil(filteredItems.length / perPage));

    if (_paginationState.currentPage > totalPages) {
      _paginationState.currentPage = totalPages;
    }

    var start = (_paginationState.currentPage - 1) * perPage;
    var end = start + perPage;

    for (var i = 0; i < filteredItems.length; i++) {
      var li = filteredItems[i];
      if (i >= start && i < end) {
        li.classList.remove('tp-row--hidden');
      } else {
        li.classList.add('tp-row--hidden');
      }
    }

    _paginationState.totalVisible = filteredItems.length;
    if (typeof refreshPagination === 'function' && _panel) refreshPagination(doc, _panel);
    else renderPaginationControls(doc, totalPages);
    updateCounter(doc);
  }

  function renderPaginationControls(doc, totalPages) {
    var container = doc.getElementById('tp-pagination');
    if (!container) return;

    var page = _paginationState.currentPage;
    var perPage = _paginationState.perPage;
    var total = _paginationState.totalVisible;

    if (total === 0) {
      container.innerHTML = '';
      return;
    }

    var start = (page - 1) * perPage + 1;
    var end = Math.min(page * perPage, total);

    var html = '';

    // Info
    html += '<span class="tp-pagination__info">' + start + '\u2013' + end + ' z ' + total + '</span>';

    // Prev
    html += '<button class="tp-pagination__btn" data-page="prev"' + (page <= 1 ? ' disabled' : '') + '><span class="material-symbols-outlined" style="font-size:20px">chevron_left</span></button>';

    // Pages
    html += '<span class="tp-pagination__pages">';
    var pages = getPaginationRange(page, totalPages);
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p === '...') {
        html += '<span class="tp-pagination__page tp-pagination__page--ellipsis">\u2026</span>';
      } else {
        html += '<button class="tp-pagination__page' + (p === page ? ' tp-pagination__page--active' : '') + '" data-page="' + p + '">' + p + '</button>';
      }
    }
    html += '</span>';

    // Next
    html += '<button class="tp-pagination__btn" data-page="next"' + (page >= totalPages ? ' disabled' : '') + '><span class="material-symbols-outlined" style="font-size:20px">chevron_right</span></button>';

    // Per page selector
    html += '<span class="tp-pagination__per-page"><select id="tp-per-page">';
    var options = [10, 15, 20, 25, 50, 100, 200, 0];
    for (var j = 0; j < options.length; j++) {
      var label = options[j] === 0 ? 'Wszystkie' : options[j];
      html += '<option value="' + options[j] + '"' + (options[j] === perPage ? ' selected' : '') + '>' + label + '</option>';
    }
    html += '</select> na stron\u0119</span>';

    // Replace container to clear old listeners
    var newContainer = container.cloneNode(false);
    newContainer.innerHTML = html;
    container.parentNode.replaceChild(newContainer, container);

    // Click delegation for page buttons
    newContainer.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      var val = btn.dataset.page;
      if (val === 'prev') {
        _paginationState.currentPage = Math.max(1, _paginationState.currentPage - 1);
      } else if (val === 'next') {
        _paginationState.currentPage++;
      } else {
        _paginationState.currentPage = parseInt(val, 10);
      }
      applyPagination(doc);
      var gridHeader = doc.querySelector('.tp-grid__header');
      if (gridHeader) gridHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Per-page change
    var perPageSelect = newContainer.querySelector('#tp-per-page');
    if (perPageSelect) {
      perPageSelect.addEventListener('change', function() {
        _paginationState.perPage = parseInt(this.value, 10);
        _paginationState.currentPage = 1;
        savePerPagePref(_paginationState.perPage);
        applyPagination(doc);
      });
    }
  }

  function getPaginationRange(current, total) {
    if (total <= 7) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var pages = [];
    pages.push(1);
    if (current > 3) pages.push('...');
    var rangeStart = Math.max(2, current - 1);
    var rangeEnd = Math.min(total - 1, current + 1);
    for (var j = rangeStart; j <= rangeEnd; j++) pages.push(j);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  // =========================================================================
  // FOOTER
  // =========================================================================

  function buildFooter(doc) {
    var existing = doc.querySelector('.tp-grid__footer');
    if (existing) existing.remove();

    var footer = doc.createElement('div');
    footer.className = 'tp-grid__footer';
    footer.innerHTML =
      '<span id="tp-counter"></span>' +
      '<div id="tp-pagination" class="tp-pagination"></div>' +
      '<span class="tp-version">v3.1.0</span>';

    var treeRoot = doc.querySelector('#block_group0') || doc.querySelector('ul[id^="block_group"]');
    if (treeRoot) {
      treeRoot.parentNode.insertBefore(footer, treeRoot.nextSibling);
    } else {
      doc.body.appendChild(footer);
    }
    _paginationState.doc = doc;
  }

  var _counterTimer = null;
  function updateCounter(doc) {
    if (_panel && _panel.setSelection) _panel.setSelection(selectedNodes.size);
    if (_panel && typeof rebuildViewsDropdown === "function") { try { rebuildViewsDropdown(doc); } catch (e) {} }
    if (_panel && _panel.setCounter) {
      var _allRows = doc.querySelectorAll('li[id^="m_"]');
      var _t = 0;
      for (var _i = 0; _i < _allRows.length; _i++) {
        if (_allRows[_i].offsetParent !== null) _t++;
      }
      // v4.5.93: footer = Wszystkich parametrów: X | Wszystkich wartości: Y [| Zaznaczone: Z]
      var _roots = getRootItems(doc);
      var _pCount = 0;
      for (var _ri = 0; _ri < _roots.length; _ri++) {
        var _rid = getNodeId(_roots[_ri]);
        if (_rid && !isSection(doc, _rid)) _pCount++;
      }
      var _vCount = 0;
      var _childCells = doc.querySelectorAll('#block_group0 > li[id^="m_"] > .tp-col-children');
      for (var _ci = 0; _ci < _childCells.length; _ci++) {
        var _ct = (_childCells[_ci].textContent || '').trim();
        if (/^\d+$/.test(_ct)) _vCount += parseInt(_ct, 10);
      }
      var _se = selectedNodes.size;
      var _sep = '<span class="panel-pro__sep">|</span>';
      var _h = 'Wszystkich parametrów: <span class="panel-pro__counter--total">' + _pCount + '</span>' +
               _sep + 'Wszystkich wartości: <span class="panel-pro__counter--total">' + _vCount + '</span>';
      if (_se > 0) _h += _sep + 'Zaznaczone: <span class="panel-pro__counter--selected">' + _se + '</span>';
      _panel.setCounter(_h);
    }
    if (_counterTimer) return;
    _counterTimer = requestAnimationFrame(function() {
      _counterTimer = null;
      var counterEl = doc.getElementById('tp-counter');
      if (!counterEl) return;
      var _allRows2 = doc.querySelectorAll('li[id^="m_"]');
      var total = 0;
      for (var _j = 0; _j < _allRows2.length; _j++) {
        if (_allRows2[_j].offsetParent !== null) total++;
      }
      var rootTotal = getRootItems(doc).length;
      var selected = selectedNodes.size;
      var text = '\u0141\u0105cznie: ' + total + ' (' + rootTotal + ' parametr\u00f3w)';
      if (selected > 0) {
        counterEl.innerHTML = text + ' | Zaznaczono: <span class="tp-counter--selected">' + selected + '</span>';
      } else {
        counterEl.textContent = text;
      }
    });
  }

  // =========================================================================
  // SEARCH / FILTER
  // =========================================================================

  // v4.5.74: wyszukiwarka po nazwie i ID — parametrów ORAZ ich wartości.
  // Wartość może być w zwiniętym parametrze lub jeszcze niezaładowana — używamy
  // cache 'ch2' (rozgrzewany w tle) lub doczytujemy listę wartości, a parametr
  // z trafioną wartością jest pokazywany i rozwijany.
  var _filterTreeTimer = null;
  var _filterTreeSeq = 0;

  function _qHit(name, id, q) {
    return String(name || '').toLowerCase().indexOf(q) !== -1 || String(id || '').indexOf(q) !== -1;
  }

  function _setRowFiltered(doc, li, hidden) {
    if (hidden) { li.classList.add('tp-row--filter-hidden'); li.classList.add('tp-row--hidden'); }
    else { li.classList.remove('tp-row--filter-hidden'); li.classList.remove('tp-row--hidden'); }
    var sp = doc.getElementById('space_' + getNodeId(li));
    if (sp) sp.style.display = hidden ? 'none' : '';
  }

  function _filterClearAll(doc) {
    var allItems = doc.querySelectorAll('li[id^="m_"]');
    for (var i = 0; i < allItems.length; i++) {
      allItems[i].classList.remove('tp-row--filter-hidden');
      allItems[i].classList.remove('tp-row--hidden');
      var sp = doc.getElementById('space_' + getNodeId(allItems[i]));
      if (sp) sp.style.display = '';
    }
    _paginationState.currentPage = 1;
    applyPagination(doc);
  }

  function ensureNodeExpanded(doc, pid) {
    return new Promise(function (resolve) {
      var block = doc.getElementById('block_group' + pid);
      if (block && block.querySelector(':scope > li[id^="m_"]')) return resolve();
      var btn = doc.getElementById('showChildren_' + pid);
      if (!btn) return resolve();
      btn.click();
      var checks = 0;
      var iv = setInterval(function () {
        checks++;
        var b = doc.getElementById('block_group' + pid);
        if ((b && b.querySelector(':scope > li[id^="m_"]')) || checks > 80) {
          clearInterval(iv);
          resolve();
        }
      }, 30);
    });
  }

  function filterTree(doc, query) {
    clearTimeout(_filterTreeTimer);
    var q = (query || '').toLowerCase().trim();
    _filterTreeSeq++;
    if (!q) { _filterClearAll(doc); return; }
    _filterTreeTimer = setTimeout(function () { _filterTreeRun(doc, q); }, 220);
  }

  async function _filterTreeRun(doc, q) {
    var mySeq = ++_filterTreeSeq;
    var roots = getRootItems(doc);

    var info = roots.map(function (li) {
      var pid = getNodeId(li);
      var pname = getNodeName(doc, pid).toLowerCase();
      var paramMatch = pname.indexOf(q) !== -1 || pid.indexOf(q) !== -1;
      var isSec = isSection(doc, pid);
      var childMatch = false;
      if (!isSec) {
        var block = doc.getElementById('block_group' + pid);
        var loadedVlis = block ? block.querySelectorAll(':scope > li[id^="m_"]') : [];
        for (var k = 0; k < loadedVlis.length; k++) {
          var vid = getNodeId(loadedVlis[k]);
          if (_qHit(getNodeName(doc, vid), vid, q)) { childMatch = true; break; }
        }
        if (!childMatch && !paramMatch) {
          var cached = tpCacheGet('ch2', pid + '_' + LANG, TP_TTL_CHILDREN);
          if (cached) childMatch = cached.some(function (c) { return _qHit(c.name, c.id, q); });
        }
      }
      var hasLoaded = !isSec && !!(doc.getElementById('block_group' + pid) && doc.getElementById('block_group' + pid).querySelector(':scope > li[id^="m_"]'));
      var needsLoad = !isSec && !paramMatch && !childMatch && !hasLoaded &&
        tpCacheGet('ch2', pid + '_' + LANG, TP_TTL_CHILDREN) === null;
      return { li: li, pid: pid, isSec: isSec, paramMatch: paramMatch, childMatch: childMatch, needsLoad: needsLoad };
    });

    // Doczytaj wartości tam, gdzie nie ma cache (tylko dla zapytań >= 2 znaki)
    if (q.length >= 2) {
      var toLoad = info.filter(function (p) { return p.needsLoad; });
      var CONC = 8;
      for (var i = 0; i < toLoad.length; i += CONC) {
        if (mySeq !== _filterTreeSeq) return;
        var batch = toLoad.slice(i, i + CONC);
        await Promise.all(batch.map(async function (p) {
          try {
            var kids = await loadChildValues(p.pid);
            p.childMatch = (kids || []).some(function (c) { return _qHit(c.name, c.id, q); });
          } catch (e) {}
        }));
      }
      if (mySeq !== _filterTreeSeq) return;
    }

    // Widoczność parametrów + lista do rozwinięcia (trafiona wartość w zwiniętym parametrze)
    var expandPids = [];
    info.forEach(function (p) {
      var visible = p.paramMatch || p.childMatch;
      _setRowFiltered(doc, p.li, !visible);
      if (visible && p.childMatch && !p.paramMatch) {
        var block = doc.getElementById('block_group' + p.pid);
        if (!(block && block.querySelector(':scope > li[id^="m_"]'))) expandPids.push(p.pid);
      }
    });

    for (var e = 0; e < expandPids.length; e++) {
      if (mySeq !== _filterTreeSeq) return;
      await ensureNodeExpanded(doc, expandPids[e]);
    }
    if (mySeq !== _filterTreeSeq) return;

    // Widoczność wartości: pokaż gdy trafiona wartość lub gdy trafiony sam parametr
    info.forEach(function (p) {
      if (p.isSec) return;
      var block = doc.getElementById('block_group' + p.pid);
      if (!block) return;
      var paramVisible = p.paramMatch || p.childMatch;
      var vlis = block.querySelectorAll(':scope > li[id^="m_"]');
      for (var k = 0; k < vlis.length; k++) {
        var vli = vlis[k];
        try { enhanceRow(vli, doc); } catch (err) {}
        var vid = getNodeId(vli);
        var vmatch = _qHit(getNodeName(doc, vid), vid, q);
        var vVisible = paramVisible && (p.paramMatch || vmatch);
        _setRowFiltered(doc, vli, !vVisible);
      }
    });

    _paginationState.currentPage = 1;
    applyPagination(doc);
  }

  // =========================================================================
  // EXPAND / COLLAPSE ALL
  // =========================================================================

  let expandAbortController = null;

  async function expandAll(doc) {
    expandAbortController = new AbortController();
    const signal = expandAbortController.signal;

    const expandButtons = Array.from(doc.querySelectorAll('.showChildren'));
    const CONCURRENCY = 100; // fire all at once, let server handle it
    let idx = 0;

    function expandOne() {
      while (idx < expandButtons.length) {
        if (signal.aborted) return Promise.resolve();
        const btn = expandButtons[idx++];
        const nodeId = btn.id ? btn.id.replace('showChildren_', '') : null;
        if (!nodeId) continue;
        const childBlock = doc.getElementById('block_group' + nodeId);
        if (childBlock && childBlock.children.length > 0) continue; // already loaded

        btn.click();

        return new Promise((resolve) => {
          let checks = 0;
          const interval = setInterval(() => {
            checks++;
            const block = doc.getElementById('block_group' + nodeId);
            if ((block && block.children.length > 0) || checks > 60 || signal.aborted) {
              clearInterval(interval);
              resolve();
            }
          }, 30);
        }).then(() => expandOne()); // when done, grab next
      }
      return Promise.resolve();
    }

    // Start CONCURRENCY workers in parallel — each grabs next item when done
    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(expandOne());
    await Promise.all(workers);

    expandAbortController = null;
    updateCounter(doc);
  }

  function collapseAll(doc) {
    const hideButtons = doc.querySelectorAll('.hideChildren');
    for (const btn of hideButtons) { btn.click(); }
    const allLi = doc.querySelectorAll('li.tp-row-enhanced');
    for (const li of allLi) {
      var expandIcon = li.querySelector('.tp-expand-icon');
      if (expandIcon) expandIcon.textContent = 'chevron_right';
    }
    updateCounter(doc);
  }

  function stopExpand() {
    if (expandAbortController) {
      expandAbortController.abort();
      expandAbortController = null;
    }
  }

  // =========================================================================
  // SELECTION HELPERS
  // =========================================================================

  function selectAll(doc) {
    const items = doc.querySelectorAll('li[id^="m_"]');
    for (const li of items) {
      if (li.style.display === 'none') continue;
      const id = getNodeId(li);
      if (!id) continue;
      selectedNodes.add(id);
      li.classList.add('tp-row--selected');
      li.classList.add('panel-pro--selected');
      const cb = li.querySelector('.tp-checkbox');
      if (cb) cb.checked = true;
    }
    updateCounter(doc);
  }

  function deselectAll(doc) {
    selectedNodes.clear();
    const cbs = doc.querySelectorAll('.tp-checkbox');
    for (const cb of cbs) cb.checked = false;
    const items = doc.querySelectorAll('.tp-row--selected, .panel-pro--selected');
    for (const li of items) {
      li.classList.remove('tp-row--selected');
      li.classList.remove('panel-pro--selected');
    }
    updateCounter(doc);
  }

  function invertSelection(doc) {
    const items = doc.querySelectorAll('li[id^="m_"]');
    for (const li of items) {
      if (li.style.display === 'none') continue;
      const id = getNodeId(li);
      if (!id) continue;
      const cb = li.querySelector('.tp-checkbox');
      if (selectedNodes.has(id)) {
        selectedNodes.delete(id);
        li.classList.remove('tp-row--selected');
        li.classList.remove('panel-pro--selected');
        if (cb) cb.checked = false;
      } else {
        selectedNodes.add(id);
        li.classList.add('tp-row--selected');
        li.classList.add('panel-pro--selected');
        if (cb) cb.checked = true;
      }
    }
    updateCounter(doc);
  }

  // =========================================================================
  // BULK DELETE MODAL
  // =========================================================================

  let bulkAbortController = null;

  function showBulkDeleteModal(doc) {
    if (selectedNodes.size === 0) return;

    const existing = doc.querySelector('#tp-delete-modal');
    if (existing) existing.remove();

    // Separate into values and parameters, sort: values first
    const nodeIds = [...selectedNodes];
    const values = nodeIds.filter(id => isValue(doc, id));
    const params = nodeIds.filter(id => isParameter(doc, id));
    const sortedIds = [...values, ...params];

    const overlay = doc.createElement('div');
    overlay.id = 'tp-delete-modal';
    overlay.className = 'tp-overlay';

    const modal = doc.createElement('div');
    modal.className = 'tp-modal';
    modal.style.width = '560px';

    // Header
    const header = doc.createElement('div');
    header.className = 'tp-modal-header tp-modal-header--danger';
    header.innerHTML = '<span>Usuwanie zaznaczonych</span>';
    const badge = doc.createElement('span');
    badge.className = 'tp-modal-count-badge';
    badge.textContent = sortedIds.length + ' elementow';
    header.appendChild(badge);
    modal.appendChild(header);

    // Body
    const body = doc.createElement('div');
    body.className = 'tp-modal-body';
    body.style.background = '#fff';

    // Info
    const info = doc.createElement('div');
    info.className = 'tp-info-bar';
    info.innerHTML = 'Parametrow: <b>' + params.length + '</b> | Wartosci: <b>' + values.length + '</b>';
    body.appendChild(info);

    // Filters section
    const filtersSection = doc.createElement('div');
    filtersSection.style.cssText = 'background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;padding:12px 14px;margin-bottom:12px;';
    filtersSection.innerHTML = '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Filtry usuwania:</div>';

    const filterDefs = [
      { id: 'tp-filter-skip-active', label: 'Pomin parametry/wartosci przypisane do aktywnych towarow (usniete towary nie licza sie)', checked: false },
      { id: 'tp-filter-skip-distinction', label: 'Pomin parametry rozrozniajace w grupach wariantow', checked: false },
      { id: 'tp-filter-skip-priceconfig', label: 'Pomin parametry konfiguratora cen', checked: false },
      { id: 'tp-filter-dissolve-groups', label: 'Rozwiaz grupy wariantow przed usunieciem parametru rozrozniajacego', checked: false }
    ];

    filterDefs.forEach(f => {
      const row = doc.createElement('label');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;cursor:pointer;font-size:12px;padding:4px 0;color:#333;';
      const cb = doc.createElement('input');
      cb.type = 'checkbox';
      cb.id = f.id;
      cb.checked = f.checked;
      cb.style.cssText = 'width:15px;height:15px;margin-top:1px;accent-color:#1a73e8;flex-shrink:0;';
      row.appendChild(cb);
      row.appendChild(doc.createTextNode(f.label));
      filtersSection.appendChild(row);
    });

    body.appendChild(filtersSection);

    // Node list
    const listLabel = doc.createElement('div');
    listLabel.style.cssText = 'font-weight:500;margin-bottom:8px;font-size:13px;';
    listLabel.textContent = 'Elementy do usuniecia:';
    body.appendChild(listLabel);

    const list = doc.createElement('div');
    list.style.cssText = 'max-height:150px;overflow-y:auto;border:1px solid #dee2e6;border-radius:4px;padding:8px;margin-bottom:16px;font-size:12px;background:#fff;';
    list.innerHTML = sortedIds.map(id => {
      const name = getNodeName(doc, id);
      const type = isParameter(doc, id) ? '[P]' : '[W]';
      return '<div style="padding:2px 0;color:#333;">\u2022 ' + type + ' ' + name + '</div>';
    }).join('');
    body.appendChild(list);

    // Warning
    const warning = doc.createElement('div');
    warning.className = 'tp-warning-bar';
    warning.innerHTML = '<b>Uwaga:</b> Jesli do usuwanych elementow przypisane sa towary, powiazania zostana usuniete. <b>Operacji nie mozna cofnac!</b>';
    body.appendChild(warning);

    // Confirm checkbox
    const confirmRow = doc.createElement('label');
    confirmRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;padding:8px 0;';
    const confirmCb = doc.createElement('input');
    confirmCb.type = 'checkbox';
    confirmCb.style.cssText = 'width:16px;height:16px;accent-color:#d93025;';
    confirmRow.appendChild(confirmCb);
    confirmRow.appendChild(doc.createTextNode('Potwierdzam usuniecie — rozumiem, ze operacja jest nieodwracalna'));
    body.appendChild(confirmRow);

    modal.appendChild(body);

    // Footer
    const footer = doc.createElement('div');
    footer.className = 'tp-modal-footer';

    const cancelBtn = doc.createElement('button');
    cancelBtn.textContent = 'Anuluj';
    cancelBtn.className = 'tp-btn-modal-secondary';
    cancelBtn.addEventListener('click', () => closeModal());

    const deleteBtn = doc.createElement('button');
    deleteBtn.textContent = 'Usun';
    deleteBtn.className = 'tp-btn-modal-danger';
    deleteBtn.disabled = true;

    confirmCb.addEventListener('change', () => {
      deleteBtn.disabled = !confirmCb.checked;
    });

    var deleteInProgress = false;

    function closeModal() {
      if (deleteInProgress) return; // block closing during process
      overlay.classList.add('tp-closing');
      setTimeout(() => overlay.remove(), 160);
    }

    deleteBtn.addEventListener('click', async () => {
      if (deleteBtn.disabled) return;

      deleteInProgress = true;
      bulkAbortController = new AbortController();
      const signal = bulkAbortController.signal;

      // Replace body with progress
      body.innerHTML = '';
      const progressWrap = doc.createElement('div');
      progressWrap.style.cssText = 'padding:20px;';

      const statusText = doc.createElement('div');
      statusText.className = 'tp-progress-text';
      statusText.style.marginBottom = '12px';
      statusText.textContent = 'Rozpoczynanie...';
      progressWrap.appendChild(statusText);

      const barOuter = doc.createElement('div');
      barOuter.className = 'tp-progress';
      barOuter.style.height = '20px';
      const barInner = doc.createElement('div');
      barInner.className = 'tp-progress-fill';
      barInner.style.background = '#c0392b';
      barOuter.appendChild(barInner);
      progressWrap.appendChild(barOuter);

      body.appendChild(progressWrap);

      // Change footer to Stop
      footer.innerHTML = '';
      const stopBtn = doc.createElement('button');
      stopBtn.textContent = 'Stop';
      stopBtn.className = 'tp-btn-modal-stop';
      stopBtn.addEventListener('click', () => {
        if (bulkAbortController) bulkAbortController.abort();
      });
      footer.appendChild(stopBtn);

      // Read filter settings
      const skipActive = doc.getElementById('tp-filter-skip-active') && doc.getElementById('tp-filter-skip-active').checked;
      const skipDistinction = doc.getElementById('tp-filter-skip-distinction') && doc.getElementById('tp-filter-skip-distinction').checked;
      const skipPriceConfig = doc.getElementById('tp-filter-skip-priceconfig') && doc.getElementById('tp-filter-skip-priceconfig').checked;
      const dissolveGroups = doc.getElementById('tp-filter-dissolve-groups') && doc.getElementById('tp-filter-dissolve-groups').checked;
      const hasFilters = skipActive || skipDistinction || skipPriceConfig || dissolveGroups;

      // Execute deletions
      const results = { success: 0, deleted: [], errors: [], skipped: [], total: sortedIds.length, aborted: false };

      for (let i = 0; i < sortedIds.length; i++) {
        if (signal.aborted) { results.aborted = true; break; }

        const nodeId = sortedIds[i];
        const nodeName = getNodeName(doc, nodeId);
        const parentId = getParentId(doc, nodeId);
        const isParam = isParameter(doc, nodeId);

        statusText.textContent = 'Usuwanie (' + (i + 1) + '/' + sortedIds.length + ') ' + nodeName + '...';
        barInner.style.width = Math.round(((i + 1) / sortedIds.length) * 100) + '%';

        // Apply filters — check BEFORE any removeParam to avoid side effects
        if (hasFilters && isParam) {
          try {
            statusText.textContent = 'Sprawdzanie (' + (i + 1) + '/' + sortedIds.length + ') ' + nodeName + '...';

            // Use numberOfOccurrence to check active products (safe, no side effects)
            var occResult = await fetchAjax('action=numberOfOccurrence&id=' + nodeId);
            var activeCount = (occResult.data && occResult.data.numberOfProduct) || 0;
            var sampleProducts = (occResult.data && occResult.data.products) || [];

            // Filter: skip if has active products
            if (skipActive && activeCount > 0) {
              results.skipped.push({ name: nodeName, reason: 'przypisany do ' + activeCount + ' aktywnych towarow' });
              continue;
            }

            // For group_distinction and price_config checks, need a sample product ID
            if (skipDistinction || skipPriceConfig) {
              var sampleId = null;

              // Try numberOfOccurrence products first
              if (sampleProducts.length > 0) {
                sampleId = String(typeof sampleProducts[0] === 'object' ? (sampleProducts[0].id || sampleProducts[0].product_id) : sampleProducts[0]);
              }

              // Fallback: use removeParam probe (safe — only returns error, doesn't detach)
              if (!sampleId) {
                var probeResult = await fetchAjax(
                  'action=removeParam&node=' + nodeId + '&tree=0&shop=2&parent=' + parentId
                );
                if (String(probeResult.errno) === '235' && probeResult.error) {
                  var probeIds = probeResult.error.split(/towar[óo]w:\s*/i)[1] || '';
                  sampleId = (probeIds.match(/\d+/) || [])[0];
                }
              }

              if (sampleId) {
                var productData = await fetchAjax('action=getProductData&product=' + sampleId);
                if (productData.data && Array.isArray(productData.data)) {
                  var paramData = productData.data.find(function(p) { return String(p.id) === String(nodeId); });
                  if (paramData) {
                    if (skipDistinction && paramData.group_distinction === 'y') {
                      results.skipped.push({ name: nodeName, reason: 'parametr rozrozniajacy w grupie' });
                      continue;
                    }
                    if (skipPriceConfig && paramData.price_config === 'y') {
                      results.skipped.push({ name: nodeName, reason: 'parametr konfiguratora cen' });
                      continue;
                    }
                  }
                }
              }
            }
          } catch (e) {
            // Filter check failed — proceed with deletion anyway
          }
        }

        // Dissolve groups if param is group_distinction
        if (dissolveGroups && isParam) {
          try {
            var probeForGroup = await fetchAjax(
              'action=removeParam&node=' + nodeId + '&tree=0&shop=2&parent=' + parentId
            );
            if (String(probeForGroup.errno) === '235' && probeForGroup.error) {
              var groupIds = probeForGroup.error.split(/towar[óo]w:\s*/i)[1] || '';
              var groupProductIds = (groupIds.match(/\d+/g) || []);
              if (groupProductIds.length > 0) {
                // Check if this param is group_distinction on first product
                var pData = await fetchAjax('action=getProductData&product=' + groupProductIds[0]);
                if (pData.data && Array.isArray(pData.data)) {
                  var pInfo = pData.data.find(function(p) { return String(p.id) === String(nodeId); });
                  if (pInfo && pInfo.group_distinction === 'y') {
                    statusText.textContent = 'Rozwiazywanie grup (' + (i + 1) + '/' + sortedIds.length + ') ' + nodeName + '...';
                    // setindependent on each product to dissolve their groups
                    for (var gi = 0; gi < groupProductIds.length; gi++) {
                      if (signal.aborted) break;
                      try {
                        await new Promise(function(resolve) {
                          var xhr = new (getIframeWin()).XMLHttpRequest();
                          xhr.open('GET', '/panel/product-edit.php?idt=' + groupProductIds[gi] + '&action=setindependent');
                          xhr.onload = function() { resolve(); };
                          xhr.onerror = function() { resolve(); };
                          xhr.send();
                        });
                      } catch (e) {}
                      if (gi < groupProductIds.length - 1 && gi % 5 === 4) await sleep(200);
                    }
                  }
                }
              }
            }
          } catch (e) {}
        }

        try {
          const success = await forceDeleteNode(doc, nodeId, parentId, nodeName, true, function(msg) {
            statusText.textContent = '(' + (i + 1) + '/' + sortedIds.length + ') ' + msg;
          });
          if (success) {
            results.success++;
            results.deleted.push(nodeName);
            const li = doc.getElementById('m_' + nodeId);
            if (li) {
              const space = doc.getElementById('space_' + nodeId);
              if (space) space.remove();
              li.remove();
            }
            selectedNodes.delete(nodeId);
          } else {
            results.errors.push({ nodeId, name: nodeName, error: 'Nie udalo sie usunac' });
          }
        } catch (e) {
          results.errors.push({ nodeId, name: nodeName, error: e.message });
        }

        if (i < sortedIds.length - 1) await sleep(200);
      }

      bulkAbortController = null;
      deleteInProgress = false;
      updateCounter(doc);

      // Show results
      body.innerHTML = '';
      const summary = doc.createElement('div');
      summary.style.cssText = 'padding:20px;';

      let html = '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">Zakonczone</div>';
      html += '<div style="color:#27ae60;margin-bottom:6px;">Usunieto: <b>' + results.success + '</b> / ' + results.total + '</div>';
      if (results.skipped.length > 0) {
        html += '<div style="color:#e67e22;margin-bottom:6px;">Pominieto (filtry): <b>' + results.skipped.length + '</b></div>';
      }

      // Detailed list: deleted
      if (results.deleted.length > 0) {
        html += '<div style="margin-top:10px;font-weight:600;font-size:12px;color:#27ae60;">Usuniete:</div>';
        html += '<div style="max-height:80px;overflow-y:auto;font-size:11px;border:1px solid #a5d6a7;padding:6px;border-radius:4px;margin-top:4px;background:#f1f8e9;">';
        results.deleted.forEach(function(name) {
          html += '<div>\u2713 ' + name + '</div>';
        });
        html += '</div>';
      }

      // Detailed list: skipped
      if (results.skipped.length > 0) {
        html += '<div style="margin-top:10px;font-weight:600;font-size:12px;color:#e67e22;">Pominiete:</div>';
        html += '<div style="max-height:80px;overflow-y:auto;font-size:11px;border:1px solid #ffcc80;padding:6px;border-radius:4px;margin-top:4px;background:#fff8e1;">';
        results.skipped.forEach(function(s) {
          html += '<div>\u25CB ' + s.name + ' — <i>' + s.reason + '</i></div>';
        });
        html += '</div>';
      }
      if (results.errors.length > 0) {
        html += '<div style="color:#e74c3c;margin-bottom:6px;">Bledy: <b>' + results.errors.length + '</b></div>';
        html += '<div style="max-height:100px;overflow-y:auto;font-size:12px;border:1px solid #eee;padding:8px;border-radius:4px;margin-top:8px;">';
        results.errors.forEach(e => {
          html += '<div>\u2022 ' + e.name + ': ' + e.error + '</div>';
        });
        html += '</div>';
      }
      if (results.aborted) {
        html += '<div style="color:#e67e22;margin-top:8px;">Operacja przerwana przez uzytkownika.</div>';
      }
      summary.innerHTML = html;
      body.appendChild(summary);

      footer.innerHTML = '';
      const closeBtn = doc.createElement('button');
      closeBtn.textContent = 'Zamknij';
      closeBtn.className = 'tp-btn-modal-primary';
      closeBtn.addEventListener('click', () => closeModal());
      footer.appendChild(closeBtn);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(deleteBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    doc.body.appendChild(overlay);
  }

  // =========================================================================
  // BULK MOVE MODAL (move values between parameters)
  // =========================================================================

  function getAllParameters(doc) {
    var params = [];
    var rootUl = doc.getElementById('block_group0');
    if (!rootUl) return params;
    var items = rootUl.querySelectorAll(':scope > li[id^="m_"]');
    for (var i = 0; i < items.length; i++) {
      var id = getNodeId(items[i]);
      if (id && isParameter(doc, id)) {
        params.push({ id: id, name: getNodeName(doc, id) });
      }
    }
    return params;
  }

  function showBulkMoveModal(doc) {
    if (selectedNodes.size === 0) return;

    var existing = doc.querySelector('#tp-move-modal');
    if (existing) existing.remove();

    // Only values can be moved
    var nodeIds = [...selectedNodes];
    var valueIds = nodeIds.filter(function(id) { return isValue(doc, id); });

    if (valueIds.length === 0) {
      alert('Zaznacz wartosci do przeniesienia (nie parametry).');
      return;
    }

    // Group values by source parameter
    var byParam = {};
    valueIds.forEach(function(id) {
      var li = doc.getElementById('m_' + id);
      if (!li) return;
      var parentUl = li.closest('ul[id^="block_group"]');
      var parentId = parentUl ? parentUl.id.replace('block_group', '') : '0';
      if (!byParam[parentId]) {
        byParam[parentId] = { paramName: getNodeName(doc, parentId), values: [] };
      }
      byParam[parentId].values.push({ id: id, name: getNodeName(doc, id) });
    });

    // Get all parameters for the dropdown
    var allParams = getAllParameters(doc);
    // Exclude source parameters
    var sourceParamIds = Object.keys(byParam);

    var overlay = doc.createElement('div');
    overlay.id = 'tp-move-modal';
    overlay.className = 'tp-overlay';

    var modal = doc.createElement('div');
    modal.className = 'tp-modal';
    modal.style.width = '600px';

    // Header
    var header = doc.createElement('div');
    header.className = 'tp-modal-header';
    header.style.background = '#1565c0';
    header.innerHTML = '<span>Przenoszenie wartosci</span>';
    var badge = doc.createElement('span');
    badge.className = 'tp-modal-count-badge';
    badge.textContent = valueIds.length + ' wartosci';
    header.appendChild(badge);
    modal.appendChild(header);

    // Body
    var body = doc.createElement('div');
    body.className = 'tp-modal-body';
    body.style.background = '#fff';

    // Info — group by source parameter
    var info = doc.createElement('div');
    info.className = 'tp-info-bar';
    var infoHtml = '';
    Object.keys(byParam).forEach(function(pid) {
      var g = byParam[pid];
      infoHtml += '<div style="margin-bottom:4px;"><b>' + escapeHtml(g.paramName) + '</b>: ' +
        g.values.map(function(v) { return escapeHtml(v.name); }).join(', ') + '</div>';
    });
    info.innerHTML = infoHtml;
    body.appendChild(info);

    // Target parameter selector
    var selectLabel = doc.createElement('div');
    selectLabel.style.cssText = 'font-weight:600;margin:12px 0 6px;font-size:13px;';
    selectLabel.textContent = 'Parametr docelowy:';
    body.appendChild(selectLabel);

    var selectWrap = doc.createElement('div');
    selectWrap.style.cssText = 'position:relative;margin-bottom:16px;';

    var searchBox = doc.createElement('input');
    searchBox.type = 'text';
    searchBox.placeholder = 'Szukaj parametru...';
    searchBox.style.cssText = 'width:100%;padding:8px 12px;border:1px solid #dadce0;border-radius:6px;font-size:13px;box-sizing:border-box;outline:none;';

    var dropdownList = doc.createElement('div');
    dropdownList.style.cssText = 'max-height:180px;overflow-y:auto;border:1px solid #dadce0;border-radius:6px;margin-top:4px;background:#fff;';

    var selectedParamId = null;
    var selectedParamName = null;

    function renderParamList(filter) {
      dropdownList.innerHTML = '';
      var filtered = allParams.filter(function(p) {
        if (sourceParamIds.indexOf(p.id) !== -1) return false;
        if (!filter) return true;
        return p.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
      });
      if (filtered.length === 0) {
        dropdownList.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:12px;">Brak wynikow</div>';
        return;
      }
      filtered.forEach(function(p) {
        var row = doc.createElement('div');
        row.style.cssText = 'padding:6px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f0f0f0;transition:background 0.1s;';
        row.textContent = p.name + ' (ID: ' + p.id + ')';
        row.addEventListener('mouseenter', function() { row.style.background = '#e8f0fe'; });
        row.addEventListener('mouseleave', function() { row.style.background = selectedParamId === p.id ? '#d2e3fc' : ''; });
        row.addEventListener('click', function() {
          selectedParamId = p.id;
          selectedParamName = p.name;
          searchBox.value = p.name;
          // Highlight selected
          var rows = dropdownList.querySelectorAll('div[style]');
          for (var i = 0; i < rows.length; i++) rows[i].style.background = '';
          row.style.background = '#d2e3fc';
          moveBtn.disabled = !confirmCb.checked;
        });
        if (selectedParamId === p.id) row.style.background = '#d2e3fc';
        dropdownList.appendChild(row);
      });
    }

    searchBox.addEventListener('input', function() {
      selectedParamId = null;
      selectedParamName = null;
      renderParamList(searchBox.value);
    });
    searchBox.addEventListener('focus', function() {
      renderParamList(searchBox.value);
    });

    selectWrap.appendChild(searchBox);
    selectWrap.appendChild(dropdownList);
    body.appendChild(selectWrap);
    renderParamList('');

    // Warning
    var warning = doc.createElement('div');
    warning.className = 'tp-warning-bar';
    warning.innerHTML = '<b>Uwaga:</b> Wartosci zostana przeniesione do wybranego parametru. ' +
      'Produkty przypisane do przenoszonych wartosci zostana automatycznie zaktualizowane. ' +
      '<b>Operacja jest nieodwracalna!</b>';
    body.appendChild(warning);

    // Confirm
    var confirmRow = doc.createElement('label');
    confirmRow.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;padding:8px 0;';
    var confirmCb = doc.createElement('input');
    confirmCb.type = 'checkbox';
    confirmCb.style.cssText = 'width:16px;height:16px;accent-color:#1565c0;';
    confirmRow.appendChild(confirmCb);
    confirmRow.appendChild(doc.createTextNode('Potwierdzam przeniesienie — rozumiem, ze operacja jest nieodwracalna'));
    body.appendChild(confirmRow);

    modal.appendChild(body);

    // Footer
    var footer = doc.createElement('div');
    footer.className = 'tp-modal-footer';

    var cancelBtn = doc.createElement('button');
    cancelBtn.textContent = 'Anuluj';
    cancelBtn.className = 'tp-btn-modal-secondary';
    cancelBtn.addEventListener('click', function() { closeModal(); });

    var moveBtn = doc.createElement('button');
    moveBtn.textContent = 'Przenies';
    moveBtn.className = 'tp-btn-modal-primary';
    moveBtn.disabled = true;

    confirmCb.addEventListener('change', function() {
      moveBtn.disabled = !(confirmCb.checked && selectedParamId);
    });

    function closeModal() {
      overlay.classList.add('tp-closing');
      setTimeout(function() { overlay.remove(); }, 160);
    }

    moveBtn.addEventListener('click', async function() {
      if (moveBtn.disabled || !selectedParamId) return;

      bulkAbortController = new AbortController();
      var signal = bulkAbortController.signal;

      // Replace body with progress
      body.innerHTML = '';
      var progressWrap = doc.createElement('div');
      progressWrap.style.cssText = 'padding:20px;';

      var statusText = doc.createElement('div');
      statusText.className = 'tp-progress-text';
      statusText.style.marginBottom = '12px';
      statusText.textContent = 'Rozpoczynanie...';
      progressWrap.appendChild(statusText);

      var barOuter = doc.createElement('div');
      barOuter.className = 'tp-progress';
      barOuter.style.height = '20px';
      var barInner = doc.createElement('div');
      barInner.className = 'tp-progress-fill';
      barOuter.appendChild(barInner);
      progressWrap.appendChild(barOuter);

      body.appendChild(progressWrap);

      // Change footer to Stop
      footer.innerHTML = '';
      var stopBtn = doc.createElement('button');
      stopBtn.textContent = 'Stop';
      stopBtn.className = 'tp-btn-modal-stop';
      stopBtn.addEventListener('click', function() {
        if (bulkAbortController) bulkAbortController.abort();
      });
      footer.appendChild(stopBtn);

      var results = { success: 0, errors: [], total: valueIds.length, aborted: false };

      // Step 1: Load existing values in target parameter
      statusText.textContent = 'Ladowanie wartosci parametru docelowego...';
      var targetValues = [];
      try {
        targetValues = await loadChildValues(selectedParamId);
      } catch (e) {
        // Target may be empty or not expanded yet — not an error
      }

      for (var i = 0; i < valueIds.length; i++) {
        if (signal.aborted) { results.aborted = true; break; }

        var valId = valueIds[i];
        var valName = getNodeName(doc, valId);
        var parentUl = doc.getElementById('m_' + valId);
        parentUl = parentUl ? parentUl.closest('ul[id^="block_group"]') : null;
        var sourceParamId = parentUl ? parentUl.id.replace('block_group', '') : '0';

        statusText.textContent = 'Przenoszenie (' + (i + 1) + '/' + valueIds.length + ') ' + valName + '...';
        barInner.style.width = Math.round(((i + 1) / valueIds.length) * 100) + '%';

        try {
          // Check if value with same name already exists in target
          var existingTarget = null;
          for (var t = 0; t < targetValues.length; t++) {
            if (targetValues[t].name === valName) {
              existingTarget = targetValues[t];
              break;
            }
          }

          var targetValueId;
          if (existingTarget) {
            targetValueId = existingTarget.id;
          } else {
            // Create value in target parameter
            var createResp = await fetchAjax(
              'action=checkElValues&type=value&lang=' + LANG +
              '&parameter_id=' + selectedParamId +
              '&product=0' +
              '&value[]=' + encodeURIComponent(valName)
            );
            if (createResp.error) throw new Error(createResp.error);
            // Extract new value ID from response
            if (createResp.data && createResp.data.children && createResp.data.children.length > 0) {
              targetValueId = createResp.data.children[createResp.data.children.length - 1].id;
              targetValues.push({ id: targetValueId, name: valName });
            } else {
              throw new Error('Nie udalo sie utworzyc wartosci w parametrze docelowym');
            }
          }

          // Merge source → target (moves products automatically)
          var mergeResp = await fetchAjax(
            'action=mergeParam&id=' + valId + '&idExist=' + targetValueId
          );
          if (mergeResp.error && mergeResp.error !== '') throw new Error(mergeResp.error);

          // Remove source value from tree (mergeParam doesn't auto-delete)
          await fetchAjax(
            'action=removeParam&node=' + valId + '&tree=0&shop=2&parent=' + sourceParamId
          );

          // Remove from DOM
          var li = doc.getElementById('m_' + valId);
          if (li) {
            var space = doc.getElementById('space_' + valId);
            if (space) space.remove();
            li.remove();
          }
          selectedNodes.delete(valId);
          results.success++;

        } catch (e) {
          results.errors.push({ nodeId: valId, name: valName, error: e.message });
        }

        if (i < valueIds.length - 1) await sleep(300);
      }

      bulkAbortController = null;
      updateCounter(doc);

      // Show results
      body.innerHTML = '';
      var summary = doc.createElement('div');
      summary.style.cssText = 'padding:20px;';

      var html = '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">Zakonczone</div>';
      html += '<div style="color:#27ae60;margin-bottom:6px;">Przeniesiono: <b>' + results.success + '</b> / ' + results.total + ' do <b>' + escapeHtml(selectedParamName) + '</b></div>';
      if (results.errors.length > 0) {
        html += '<div style="color:#e74c3c;margin-bottom:6px;">Bledy: <b>' + results.errors.length + '</b></div>';
        html += '<div style="max-height:100px;overflow-y:auto;font-size:12px;border:1px solid #eee;padding:8px;border-radius:4px;margin-top:8px;">';
        results.errors.forEach(function(e) {
          html += '<div>\u2022 ' + escapeHtml(e.name) + ': ' + escapeHtml(e.error) + '</div>';
        });
        html += '</div>';
      }
      if (results.aborted) {
        html += '<div style="color:#e67e22;margin-top:8px;">Operacja przerwana przez uzytkownika.</div>';
      }
      summary.innerHTML = html;
      body.appendChild(summary);

      footer.innerHTML = '';
      var closeBtn = doc.createElement('button');
      closeBtn.textContent = 'Zamknij';
      closeBtn.className = 'tp-btn-modal-primary';
      closeBtn.addEventListener('click', function() { closeModal(); });
      footer.appendChild(closeBtn);
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(moveBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeModal();
    });
    doc.body.appendChild(overlay);
  }

  // =========================================================================
  // BULK EDIT MODAL
  // =========================================================================

  const PARAM_SETTINGS_FIELDS = [
    { key: 'distinction', label: 'Wyrozniony na karcie towaru i liscie towarow', options: [['y', 'Tak'], ['n', 'Nie']] },
    { key: 'projector_hide', label: 'Ukryty w projektorze i porownywarce', options: [['y', 'Tak'], ['n', 'Nie']] },
    { key: 'priority', label: 'Priorytet (globalny)', type: 'number' },
    { key: 'auction_template_hide', label: 'Ukryty dla szablonow aukcji', options: [['y', 'Tak'], ['n', 'Nie']] },
    { key: 'price_config', label: 'Parametr konfiguratora cen', options: [['y', 'Tak'], ['n', 'Nie']] },
    { key: 'group_distinction', label: 'Parametr rozrozniajacy towary w grupie', options: [['y', 'Tak'], ['n', 'Nie']] },
  ];

  function showBulkEditModal(doc) {
    if (selectedNodes.size === 0) return;

    const existing = doc.querySelector('#tp-edit-modal');
    if (existing) existing.remove();

    const overlay = doc.createElement('div');
    overlay.id = 'tp-edit-modal';
    overlay.className = 'tp-overlay';

    const modal = doc.createElement('div');
    modal.className = 'tp-modal';
    modal.style.width = '640px';

    function closeModal() {
      overlay.classList.add('tp-closing');
      setTimeout(() => overlay.remove(), 160);
    }

    // Header
    const header = doc.createElement('div');
    header.className = 'tp-modal-header tp-modal-header--primary';
    header.innerHTML = '<span>Grupowa edycja</span>';
    const badge = doc.createElement('span');
    badge.className = 'tp-modal-count-badge';
    badge.textContent = selectedNodes.size + ' zaznaczonych';
    header.appendChild(badge);
    const closeX = doc.createElement('button');
    closeX.className = 'tp-modal-header-close';
    closeX.innerHTML = '&times;';
    closeX.addEventListener('click', closeModal);
    header.appendChild(closeX);
    modal.appendChild(header);

    // Body
    const body = doc.createElement('div');
    body.className = 'tp-modal-body';

    // Tabs
    const tabs = doc.createElement('div');
    tabs.className = 'tp-tabs';
    const tabSettings = doc.createElement('div');
    tabSettings.className = 'tp-tab tp-tab--active';
    tabSettings.textContent = 'Ustawienia';
    tabSettings.dataset.tab = 'settings';
    const tabCsv = doc.createElement('div');
    tabCsv.className = 'tp-tab';
    tabCsv.textContent = 'Import CSV';
    tabCsv.dataset.tab = 'csv';
    tabs.appendChild(tabSettings);
    tabs.appendChild(tabCsv);
    body.appendChild(tabs);

    // Tab content: Settings
    const settingsContent = doc.createElement('div');
    settingsContent.className = 'tp-tab-content tp-tab-content--active';
    settingsContent.dataset.tabContent = 'settings';

    const settingsInfo = doc.createElement('div');
    settingsInfo.className = 'tp-info-bar';
    settingsInfo.innerHTML = 'Wlacz przelacznik obok pola, aby je zmienic.<br>Wyroznik, Ukryty, Aukcje, Konfigurator cen \u2014 zmiana zostanie zastosowana <b>we wszystkich towarach</b> do ktorych parametr jest przypisany.<br>Priorytet \u2014 zmiana globalna definicji parametru.';
    settingsContent.appendChild(settingsInfo);

    const fieldToggles = {};

    for (const field of PARAM_SETTINGS_FIELDS) {
      const row = doc.createElement('div');
      row.className = 'tp-field-row';

      // Toggle switch
      const sw = doc.createElement('label');
      sw.className = 'tp-switch';
      const swInput = doc.createElement('input');
      swInput.type = 'checkbox';
      const swTrack = doc.createElement('span');
      swTrack.className = 'tp-switch-track';
      sw.appendChild(swInput);
      sw.appendChild(swTrack);
      row.appendChild(sw);

      // Label
      const label = doc.createElement('span');
      label.className = 'tp-field-label';
      label.textContent = field.label;
      row.appendChild(label);

      // Value selector
      let valueEl;
      if (field.type === 'number') {
        valueEl = doc.createElement('input');
        valueEl.type = 'number';
        valueEl.className = 'tp-field-select';
        valueEl.style.width = '80px';
        valueEl.value = '0';
        valueEl.disabled = true;
      } else {
        valueEl = doc.createElement('select');
        valueEl.className = 'tp-field-select';
        valueEl.disabled = true;
        for (const [val, text] of field.options) {
          const opt = doc.createElement('option');
          opt.value = val;
          opt.textContent = text;
          valueEl.appendChild(opt);
        }
      }
      row.appendChild(valueEl);

      swInput.addEventListener('change', () => {
        valueEl.disabled = !swInput.checked;
      });

      fieldToggles[field.key] = { toggle: swInput, value: valueEl };
      settingsContent.appendChild(row);
    }

    body.appendChild(settingsContent);

    // Tab content: CSV Import
    const csvContent = doc.createElement('div');
    csvContent.className = 'tp-tab-content';
    csvContent.dataset.tabContent = 'csv';

    const csvInfo = doc.createElement('div');
    csvInfo.className = 'tp-info-bar';
    csvInfo.innerHTML = 'Wgraj plik CSV z kolumnami: <b>ID</b> lub <b>nazwa</b> (do dopasowania) i <b>nowa_nazwa</b> (nowa wartosc).<br>Separator: <b>;</b> lub <b>,</b>. Pierwszy wiersz = naglowki.';
    csvContent.appendChild(csvInfo);

    // Upload area
    const uploadArea = doc.createElement('div');
    uploadArea.className = 'tp-upload-area';
    uploadArea.id = 'tp-csv-upload';
    uploadArea.innerHTML = 'Kliknij lub przeciagnij plik CSV';

    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.txt';
    fileInput.style.display = 'none';

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = '#1a73e8'; });
    uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '#dadce0'; });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#dadce0';
      if (e.dataTransfer.files.length) handleCsvFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length) handleCsvFile(fileInput.files[0]);
    });

    csvContent.appendChild(uploadArea);
    csvContent.appendChild(fileInput);

    // CSV Preview area
    const csvPreview = doc.createElement('div');
    csvPreview.id = 'tp-csv-preview';
    csvContent.appendChild(csvPreview);

    let parsedCsvData = null;

    function handleCsvFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        parsedCsvData = parseCsv(text, doc);
        renderCsvPreview(doc, csvPreview, parsedCsvData);
        uploadArea.innerHTML = 'Plik: <b>' + file.name + '</b> (' + parsedCsvData.length + ' wierszy)';
      };
      reader.readAsText(file, 'UTF-8');
    }

    body.appendChild(csvContent);

    // Tab switching
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tp-tab');
      if (!tab) return;
      const tabName = tab.dataset.tab;

      tabs.querySelectorAll('.tp-tab').forEach(t => t.classList.remove('tp-tab--active'));
      tab.classList.add('tp-tab--active');

      body.querySelectorAll('.tp-tab-content').forEach(c => c.classList.remove('tp-tab-content--active'));
      const content = body.querySelector('[data-tab-content="' + tabName + '"]');
      if (content) content.classList.add('tp-tab-content--active');
    });

    modal.appendChild(body);

    // Footer
    const footer = doc.createElement('div');
    footer.className = 'tp-modal-footer';

    const cancelBtnE = doc.createElement('button');
    cancelBtnE.textContent = 'Anuluj';
    cancelBtnE.className = 'tp-btn-modal-secondary';
    cancelBtnE.addEventListener('click', closeModal);

    const applyBtn = doc.createElement('button');
    applyBtn.textContent = 'Zastosuj';
    applyBtn.className = 'tp-btn-modal-primary';
    applyBtn.addEventListener('click', async () => {
      // Determine active tab
      const activeTab = body.querySelector('.tp-tab--active');
      const tabName = activeTab ? activeTab.dataset.tab : 'settings';

      if (tabName === 'settings') {
        await applySettingsChanges(doc, fieldToggles, body, footer, closeModal);
      } else if (tabName === 'csv') {
        if (!parsedCsvData || parsedCsvData.length === 0) {
          alert('Najpierw wgraj plik CSV');
          return;
        }
        await applyCsvChanges(doc, parsedCsvData, body, footer, closeModal);
      }
    });

    footer.appendChild(cancelBtnE);
    footer.appendChild(applyBtn);
    modal.appendChild(footer);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    doc.body.appendChild(overlay);
  }

  // =========================================================================
  // CSV PARSING
  // =========================================================================

  function parseCsv(text, doc) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    // Detect separator
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());

    // Find columns
    const idCol = headers.findIndex(h => h === 'id');
    const nameCol = headers.findIndex(h => h === 'nazwa' || h === 'name');
    const newNameCol = headers.findIndex(h => h === 'nowa_nazwa' || h === 'new_name' || h === 'nowa nazwa');

    if (newNameCol === -1) return [];
    if (idCol === -1 && nameCol === -1) return [];

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(sep).map(c => c.trim());
      const row = {
        id: idCol !== -1 ? cols[idCol] : null,
        name: nameCol !== -1 ? cols[nameCol] : null,
        newName: cols[newNameCol] || '',
      };

      if (!row.newName) continue;

      // Try to match to a node
      if (row.id) {
        row.matchedId = row.id;
        row.matchedName = getNodeName(doc, row.id);
      } else if (row.name) {
        // Search by name in DOM
        const allNames = doc.querySelectorAll('.showMenuSub');
        for (const el of allNames) {
          if (el.textContent.trim().toLowerCase() === row.name.toLowerCase()) {
            const idMatch = el.id.match(/\d+/);
            if (idMatch) {
              row.matchedId = idMatch[0];
              row.matchedName = el.textContent.trim();
              break;
            }
          }
        }
      }

      rows.push(row);
    }

    return rows;
  }

  function renderCsvPreview(doc, container, rows) {
    if (!rows || rows.length === 0) {
      container.innerHTML = '<div class="tp-warning-bar" style="margin-top:12px;">Brak danych do wyswietlenia lub nieprawidlowy format CSV.</div>';
      return;
    }

    let html = '<table class="tp-csv-table"><thead><tr>';
    html += '<th>ID</th><th>Nazwa</th><th>Nowa nazwa</th><th>Dopasowanie</th>';
    html += '</tr></thead><tbody>';

    for (const row of rows) {
      const matched = row.matchedId ? 'color:#27ae60' : 'color:#e74c3c';
      const matchText = row.matchedId ? ('\u2713 ' + (row.matchedName || row.matchedId)) : '\u2717 Nie znaleziono';
      html += '<tr>';
      html += '<td>' + (row.id || '-') + '</td>';
      html += '<td>' + (row.name || '-') + '</td>';
      html += '<td><b>' + row.newName + '</b></td>';
      html += '<td style="' + matched + '">' + matchText + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
    container.style.marginTop = '12px';
  }

  // =========================================================================
  // APPLY SETTINGS CHANGES
  // =========================================================================

  async function applySettingsChanges(doc, fieldToggles, body, footer, closeModal) {
    // Collect active overrides
    const overrides = {};
    for (const [key, { toggle, value }] of Object.entries(fieldToggles)) {
      if (toggle.checked) {
        overrides[key] = value.value;
      }
    }

    if (Object.keys(overrides).length === 0) {
      alert('Wlacz przynajmniej jedno pole do zmiany');
      return;
    }

    // Only apply to parameters (not values)
    const paramIds = [...selectedNodes].filter(id => isParameter(doc, id));
    if (paramIds.length === 0) {
      alert('Brak zaznaczonych parametrow (ustawienia dotycza tylko parametrow, nie wartosci)');
      return;
    }

    // These operations are per-product (saveParametersChanges), not global (setSettings)
    const PER_PRODUCT_OPS = ['distinction', 'projector_hide', 'auction_template_hide', 'price_config', 'group_distinction'];
    const perProductOverrides = {};
    const globalOverrides = {};
    for (const [key, val] of Object.entries(overrides)) {
      if (PER_PRODUCT_OPS.includes(key)) {
        perProductOverrides[key] = val;
      } else {
        globalOverrides[key] = val;
      }
    }

    bulkAbortController = new AbortController();
    const signal = bulkAbortController.signal;

    // Show progress
    body.innerHTML = '';
    const progressWrap = doc.createElement('div');
    progressWrap.style.cssText = 'padding:20px;';

    const statusText = doc.createElement('div');
    statusText.className = 'tp-progress-text';
    statusText.style.marginBottom = '12px';
    statusText.textContent = 'Rozpoczynanie...';
    progressWrap.appendChild(statusText);

    const barOuter = doc.createElement('div');
    barOuter.className = 'tp-progress';
    barOuter.style.height = '20px';
    const barInner = doc.createElement('div');
    barInner.className = 'tp-progress-fill';
    barInner.style.background = '#1a73e8';
    barOuter.appendChild(barInner);
    progressWrap.appendChild(barOuter);
    body.appendChild(progressWrap);

    footer.innerHTML = '';
    const stopBtn = doc.createElement('button');
    stopBtn.textContent = 'Stop';
    stopBtn.className = 'tp-btn-modal-stop';
    stopBtn.addEventListener('click', () => { if (bulkAbortController) bulkAbortController.abort(); });
    footer.appendChild(stopBtn);

    const results = { success: 0, errors: [], total: 0, aborted: false };

    // Phase 1: Per-product operations (distinction, projector_hide, auction_template_hide, price_config)
    if (Object.keys(perProductOverrides).length > 0) {
      statusText.textContent = 'Pobieranie listy towarow...';

      // Collect product IDs for all params
      const paramProducts = {};
      let totalProducts = 0;

      for (let pi = 0; pi < paramIds.length; pi++) {
        if (signal.aborted) { results.aborted = true; break; }
        const pid = paramIds[pi];
        const pname = getNodeName(doc, pid);
        statusText.textContent = 'Pobieranie towarow dla "' + pname + '" (' + (pi + 1) + '/' + paramIds.length + ')...';
        barInner.style.width = Math.round(((pi + 1) / paramIds.length) * 15) + '%';

        try {
          const productIds = await getProductIdsForParam(doc, pid);
          paramProducts[pid] = productIds;
          totalProducts += productIds.length;
        } catch (e) {
          paramProducts[pid] = [];
        }
        if (pi < paramIds.length - 1) await sleep(200);
      }

      if (totalProducts > 0 && !signal.aborted) {
        results.total += totalProducts;
        statusText.textContent = 'Znaleziono ' + totalProducts + ' powiazan. Zmiana ustawien w towarach...';

        let processed = 0;
        for (const paramId of Object.keys(paramProducts)) {
          if (signal.aborted) { results.aborted = true; break; }
          const products = paramProducts[paramId];
          const paramName = getNodeName(doc, paramId);

          for (let j = 0; j < products.length; j++) {
            if (signal.aborted) { results.aborted = true; break; }
            processed++;

            statusText.textContent = 'Zmiana w "' + paramName + '" (' + processed + '/' + totalProducts + ')...';
            barInner.style.width = (15 + Math.round((processed / totalProducts) * 55)) + '%'; // 15-70%

            try {
              // Build operations array for this product
              const ops = [];
              for (const [key, val] of Object.entries(perProductOverrides)) {
                ops.push({ operation: key, parameter: String(paramId), value: val });
              }

              await fetchAjaxRaw(
                AJAX_URL + '?action=saveParametersChanges&productId=' + products[j],
                'data=' + encodeURIComponent(JSON.stringify(ops)) + '&columns=[]'
              );
              results.success++;
            } catch (e) {
              results.errors.push({ name: paramName + ' (towar ' + products[j] + ')', error: e.message });
            }

            if (j < products.length - 1) await sleep(200);
          }
        }
      }
    }

    // Phase 2: Global operations (priority, etc.) via setSettings
    if (Object.keys(globalOverrides).length > 0 && !signal.aborted) {
      results.total += paramIds.length;

      for (let i = 0; i < paramIds.length; i++) {
        if (signal.aborted) { results.aborted = true; break; }

        const paramId = paramIds[i];
        const paramName = getNodeName(doc, paramId);

        statusText.textContent = 'Ustawienia globalne (' + (i + 1) + '/' + paramIds.length + ') ' + paramName + '...';
        barInner.style.width = (70 + Math.round(((i + 1) / paramIds.length) * 30)) + '%'; // 70-100%

        try {
          let bodyStr = 'action=setSettings&node=' + paramId + '&lang=' + LANG;
          for (const [key, val] of Object.entries(globalOverrides)) {
            bodyStr += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(val);
          }

          const resp = await fetchAjax(bodyStr);
          if (resp.errno && resp.errno !== 0) {
            results.errors.push({ name: paramName, error: resp.error || 'errno ' + resp.errno });
          } else {
            results.success++;
          }
        } catch (e) {
          results.errors.push({ name: paramName, error: e.message });
        }

        if (i < paramIds.length - 1) await sleep(200);
      }
    }

    bulkAbortController = null;
    showBulkResults(doc, body, footer, results, closeModal);
  }

  // =========================================================================
  // APPLY CSV CHANGES
  // =========================================================================

  async function applyCsvChanges(doc, csvData, body, footer, closeModal) {
    const matchedRows = csvData.filter(r => r.matchedId);
    if (matchedRows.length === 0) {
      alert('Brak dopasowanych wierszy');
      return;
    }

    bulkAbortController = new AbortController();
    const signal = bulkAbortController.signal;

    body.innerHTML = '';
    const progressWrap = doc.createElement('div');
    progressWrap.style.cssText = 'padding:20px;';

    const statusText = doc.createElement('div');
    statusText.className = 'tp-progress-text';
    statusText.style.marginBottom = '12px';
    statusText.textContent = 'Rozpoczynanie...';
    progressWrap.appendChild(statusText);

    const barOuter = doc.createElement('div');
    barOuter.className = 'tp-progress';
    barOuter.style.height = '20px';
    const barInner = doc.createElement('div');
    barInner.className = 'tp-progress-fill';
    barInner.style.background = '#1a73e8';
    barOuter.appendChild(barInner);
    progressWrap.appendChild(barOuter);
    body.appendChild(progressWrap);

    footer.innerHTML = '';
    const stopBtn = doc.createElement('button');
    stopBtn.textContent = 'Stop';
    stopBtn.className = 'tp-btn-modal-stop';
    stopBtn.addEventListener('click', () => { if (bulkAbortController) bulkAbortController.abort(); });
    footer.appendChild(stopBtn);

    const results = { success: 0, errors: [], total: matchedRows.length, aborted: false };

    for (let i = 0; i < matchedRows.length; i++) {
      if (signal.aborted) { results.aborted = true; break; }

      const row = matchedRows[i];
      const nodeName = row.matchedName || row.matchedId;

      statusText.textContent = 'Zmiana nazwy (' + (i + 1) + '/' + matchedRows.length + ') ' + nodeName + ' -> ' + row.newName + '...';
      barInner.style.width = Math.round(((i + 1) / matchedRows.length) * 100) + '%';

      try {
        const bodyStr = 'action=setDescription&node=' + row.matchedId + '&lang=' + LANG +
          '&name=' + encodeURIComponent(row.newName);

        const resp = await fetchAjax(bodyStr);
        if (resp.errno && resp.errno !== 0) {
          results.errors.push({ name: nodeName, error: resp.error || 'errno ' + resp.errno });
        } else {
          results.success++;
          // Update DOM name
          const nameEl = doc.getElementById('showMenuSub_' + row.matchedId);
          if (nameEl) nameEl.textContent = row.newName;
        }
      } catch (e) {
        results.errors.push({ name: nodeName, error: e.message });
      }

      if (i < matchedRows.length - 1) await sleep(200);
    }

    bulkAbortController = null;
    showBulkResults(doc, body, footer, results, closeModal);
  }

  // =========================================================================
  // RESULTS SUMMARY
  // =========================================================================

  function showBulkResults(doc, body, footer, results, closeModal) {
    body.innerHTML = '';
    const summary = doc.createElement('div');
    summary.style.cssText = 'padding:20px;';

    let html = '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">Zakonczone</div>';
    html += '<div style="color:#27ae60;margin-bottom:6px;">Sukces: <b>' + results.success + '</b> / ' + results.total + '</div>';
    if (results.errors.length > 0) {
      html += '<div style="color:#e74c3c;margin-bottom:6px;">Bledy: <b>' + results.errors.length + '</b></div>';
      html += '<div style="max-height:120px;overflow-y:auto;font-size:12px;border:1px solid #eee;padding:8px;border-radius:4px;margin-top:8px;">';
      results.errors.forEach(e => {
        html += '<div>\u2022 ' + e.name + ': ' + e.error + '</div>';
      });
      html += '</div>';
    }
    if (results.aborted) {
      html += '<div style="color:#e67e22;margin-top:8px;">Operacja przerwana przez uzytkownika.</div>';
    }
    summary.innerHTML = html;
    body.appendChild(summary);

    footer.innerHTML = '';
    const closeBtn = doc.createElement('button');
    closeBtn.textContent = 'Zamknij';
    closeBtn.className = 'tp-btn-modal-primary';
    closeBtn.addEventListener('click', () => closeModal());
    footer.appendChild(closeBtn);
  }

  // =========================================================================
  // BULK DISTINCTION (set/unset wyróżniony across all products)
  // =========================================================================

  async function getProductIdsForParam(doc, paramId) {
    // First check product count via numberOfOccurrence
    const countResult = await fetchAjax('action=numberOfOccurrence&id=' + paramId);
    var count = 0;
    if (countResult.data && countResult.data.numberOfProduct) {
      count = parseInt(countResult.data.numberOfProduct, 10) || 0;
    }
    if (count === 0) return [];

    // Check if response already contains product IDs
    if (countResult.data && countResult.data.products && Array.isArray(countResult.data.products)) {
      return countResult.data.products.map(function(p) { return String(typeof p === 'object' ? p.id || p.product_id : p); });
    }

    // Fallback: call removeParam which fails with errno 235, returning product IDs in error message
    // Safe because parameter has products (count > 0), so removeParam ALWAYS fails - never deletes
    var parentId = getParentId(doc, paramId);
    const removeResult = await fetchAjax(
      'action=removeParam&node=' + paramId + '&tree=0&shop=2&parent=' + parentId
    );
    if (String(removeResult.errno) === '235') {
      var idsSection = removeResult.error.split(/towar[óo]w:\s*/i)[1] || '';
      var productIds = idsSection.match(/\d+/g) || [];
      return productIds;
    }

    return [];
  }

  async function applyDistinctionChanges(doc, enable, body, footer, closeModal) {
    var paramIds = [...selectedNodes].filter(function(id) { return isParameter(doc, id); });
    if (paramIds.length === 0) {
      alert('Brak zaznaczonych parametrow (wyroznienie dotyczy tylko parametrow, nie wartosci)');
      return;
    }

    bulkAbortController = new AbortController();
    var signal = bulkAbortController.signal;

    // Show progress
    body.innerHTML = '';
    var progressWrap = doc.createElement('div');
    progressWrap.style.cssText = 'padding:20px;';

    var statusText = doc.createElement('div');
    statusText.className = 'tp-progress-text';
    statusText.style.marginBottom = '12px';
    statusText.textContent = 'Pobieranie listy towarow...';
    progressWrap.appendChild(statusText);

    var barOuter = doc.createElement('div');
    barOuter.className = 'tp-progress';
    barOuter.style.height = '20px';
    var barInner = doc.createElement('div');
    barInner.className = 'tp-progress-fill';
    barInner.style.background = enable ? '#e67e22' : '#7f8c8d';
    barOuter.appendChild(barInner);
    progressWrap.appendChild(barOuter);
    body.appendChild(progressWrap);

    footer.innerHTML = '';
    var stopBtn = doc.createElement('button');
    stopBtn.textContent = 'Stop';
    stopBtn.className = 'tp-btn-modal-stop';
    stopBtn.addEventListener('click', function() {
      if (bulkAbortController) bulkAbortController.abort();
    });
    footer.appendChild(stopBtn);

    // Phase 1: Collect product IDs for all parameters
    var paramProducts = {};
    var totalProducts = 0;

    for (var pi = 0; pi < paramIds.length; pi++) {
      if (signal.aborted) break;
      var pid = paramIds[pi];
      var pname = getNodeName(doc, pid);
      statusText.textContent = 'Pobieranie towarow dla "' + pname + '" (' + (pi + 1) + '/' + paramIds.length + ')...';
      barInner.style.width = Math.round(((pi + 1) / paramIds.length) * 30) + '%';

      try {
        var productIds = await getProductIdsForParam(doc, pid);
        paramProducts[pid] = productIds;
        totalProducts += productIds.length;
      } catch (e) {
        paramProducts[pid] = [];
      }
      if (pi < paramIds.length - 1) await sleep(200);
    }

    if (totalProducts === 0 && !signal.aborted) {
      body.innerHTML = '';
      var noProducts = doc.createElement('div');
      noProducts.style.cssText = 'padding:20px;text-align:center;color:#666;';
      noProducts.textContent = 'Zaznaczone parametry nie sa przypisane do zadnych towarow.';
      body.appendChild(noProducts);
      footer.innerHTML = '';
      var closeBtnEmpty = doc.createElement('button');
      closeBtnEmpty.textContent = 'Zamknij';
      closeBtnEmpty.className = 'tp-btn-modal-primary';
      closeBtnEmpty.addEventListener('click', function() { closeModal(); });
      footer.appendChild(closeBtnEmpty);
      bulkAbortController = null;
      return;
    }

    statusText.textContent = 'Znaleziono ' + totalProducts + ' powiazan. Zmiana wyroznienia...';

    // Phase 2: Set distinction for each param × product
    var results = { success: 0, errors: [], total: totalProducts, aborted: false };
    var processed = 0;
    var distinctionValue = enable ? 'y' : 'n';

    for (var paramId in paramProducts) {
      if (signal.aborted) { results.aborted = true; break; }
      var products = paramProducts[paramId];
      var paramName = getNodeName(doc, paramId);

      for (var j = 0; j < products.length; j++) {
        if (signal.aborted) { results.aborted = true; break; }
        processed++;

        statusText.textContent = (enable ? 'Wyroznianie' : 'Wylaczanie') + ' "' + paramName + '" (' + processed + '/' + totalProducts + ')...';
        barInner.style.width = (30 + Math.round((processed / totalProducts) * 70)) + '%';

        try {
          await fetchAjaxRaw(
            AJAX_URL + '?action=saveParametersChanges&productId=' + products[j],
            'data=' + encodeURIComponent(JSON.stringify([
              { operation: 'distinction', parameter: String(paramId), value: distinctionValue }
            ])) + '&columns=[]'
          );
          results.success++;
        } catch (e) {
          results.errors.push({ param: paramName, product: products[j], error: e.message });
        }

        if (j < products.length - 1) await sleep(200);
      }
    }

    bulkAbortController = null;

    // Show results
    body.innerHTML = '';
    var summary = doc.createElement('div');
    summary.style.cssText = 'padding:20px;';

    var html = '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">Zakonczone</div>';
    html += '<div style="color:#27ae60;margin-bottom:6px;">Zmieniono: <b>' + results.success + '</b> / ' + results.total + '</div>';
    if (results.errors.length > 0) {
      html += '<div style="color:#e74c3c;margin-bottom:6px;">Bledy: <b>' + results.errors.length + '</b></div>';
      html += '<div style="max-height:100px;overflow-y:auto;font-size:12px;border:1px solid #eee;padding:8px;border-radius:4px;margin-top:8px;">';
      results.errors.forEach(function(e) {
        html += '<div>\u2022 ' + e.param + ' (towar ' + e.product + '): ' + e.error + '</div>';
      });
      html += '</div>';
    }
    if (results.aborted) {
      html += '<div style="color:#e67e22;margin-top:8px;">Operacja przerwana przez uzytkownika.</div>';
    }
    summary.innerHTML = html;
    body.appendChild(summary);

    footer.innerHTML = '';
    var closeBtn2 = doc.createElement('button');
    closeBtn2.textContent = 'Zamknij';
    closeBtn2.className = 'tp-btn-modal-primary';
    closeBtn2.addEventListener('click', function() { closeModal(); });
    footer.appendChild(closeBtn2);
  }

  // =========================================================================
  // SORT ALPHABETICALLY
  // =========================================================================

  let sortAscending = true;
  let idAscending = true; // v4.6.0: sortowanie po ID

  function sortAlphabetically(doc) {
    var ul = doc.querySelector('#block_group0') || doc.querySelector('ul[id^="block_group"]');
    if (!ul) return;

    var items = Array.prototype.slice.call(ul.querySelectorAll(':scope > li[id^="m_"]'));
    if (items.length === 0) return;

    items.sort(function(a, b) {
      var nameA = getNodeName(doc, getNodeId(a));
      var nameB = getNodeName(doc, getNodeId(b));
      var cmp = nameA.localeCompare(nameB, 'pl', { numeric: true, sensitivity: 'base' });
      return sortAscending ? cmp : -cmp;
    });

    // Re-append in sorted order (also move associated space_ elements)
    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var nodeId = getNodeId(li);
      var space = doc.getElementById('space_' + nodeId);
      if (space) ul.appendChild(space);
      ul.appendChild(li);
    }

    // v4.5.14: persist sort order on the server via saveManualSort so it survives reload
    var sortOrder = [];
    for (var k = 0; k < items.length; k++) {
      var nid = getNodeId(items[k]);
      if (nid) sortOrder.push({ id: Number(nid), sortOrder: k + 1 });
    }
    var win = getIframeWin() || (doc.defaultView || window);
    var xhr = new win.XMLHttpRequest();
    xhr.open('POST', '/panel/ajax/parameters.php', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onload = function () {
      if (_panel && _panel.showStatus) {
        if (xhr.status >= 200 && xhr.status < 300) {
          _panel.showStatus('Posortowano alfabetycznie (' + (sortAscending ? 'Z\u2192A' : 'A\u2192Z') + ') \u2014 zapisano');
        } else {
          _panel.showStatus('Posortowano w widoku, ale b\u0142\u0105d zapisu (HTTP ' + xhr.status + ')', true);
        }
      }
    };
    xhr.onerror = function () { if (_panel) _panel.showStatus('Posortowano w widoku, ale b\u0142\u0105d sieci', true); };
    xhr.send('action=saveManualSort&parameters=' + encodeURIComponent(JSON.stringify(sortOrder)));

    sortAscending = !sortAscending;
    showForceDeleteStatus(doc, 'Sortowanie alfabetyczne \u2014 zapisywanie...');
  }

  // v4.6.0: sortowanie parametr\u00f3w wg ID (rosn\u0105co; kolejne klikni\u0119cia odwracaj\u0105)
  function sortById(doc) {
    var ul = doc.querySelector('#block_group0') || doc.querySelector('ul[id^="block_group"]');
    if (!ul) return;
    var items = Array.prototype.slice.call(ul.querySelectorAll(':scope > li[id^="m_"]'));
    if (items.length === 0) return;

    items.sort(function (a, b) {
      var ia = parseInt(getNodeId(a), 10) || 0;
      var ib = parseInt(getNodeId(b), 10) || 0;
      return idAscending ? (ia - ib) : (ib - ia);
    });

    for (var i = 0; i < items.length; i++) {
      var li = items[i];
      var nodeId = getNodeId(li);
      var space = doc.getElementById('space_' + nodeId);
      if (space) ul.appendChild(space);
      ul.appendChild(li);
    }

    var sortOrder = [];
    for (var k = 0; k < items.length; k++) {
      var nid = getNodeId(items[k]);
      if (nid) sortOrder.push({ id: Number(nid), sortOrder: k + 1 });
    }
    var win = getIframeWin() || (doc.defaultView || window);
    var xhr = new win.XMLHttpRequest();
    xhr.open('POST', '/panel/ajax/parameters.php', true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    xhr.onload = function () {
      if (_panel && _panel.showStatus) {
        if (xhr.status >= 200 && xhr.status < 300) {
          _panel.showStatus('Posortowano wg ID (' + (idAscending ? 'rosn\u0105co' : 'malej\u0105co') + ') \u2014 zapisano');
        } else {
          _panel.showStatus('Posortowano w widoku, ale b\u0142\u0105d zapisu (HTTP ' + xhr.status + ')', true);
        }
      }
    };
    xhr.onerror = function () { if (_panel) _panel.showStatus('Posortowano w widoku, ale b\u0142\u0105d sieci', true); };
    xhr.send('action=saveManualSort&parameters=' + encodeURIComponent(JSON.stringify(sortOrder)));

    idAscending = !idAscending;
    showForceDeleteStatus(doc, 'Sortowanie wg ID \u2014 zapisywanie...');
    if (typeof applyPagination === 'function') { _paginationState.currentPage = 1; applyPagination(doc); }
  }

  // v4.6.0: sortowanie listy sekcji wg ID (klient \u2014 reorder + repaginacja)
  function sortSectionsById(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var ul = _sectionsMount.listEl;
    var items = Array.prototype.slice.call(ul.querySelectorAll(':scope > li'));
    if (items.length === 0) return;
    items.sort(function (a, b) {
      var ia = parseInt(a.dataset.sectionId, 10) || 0;
      var ib = parseInt(b.dataset.sectionId, 10) || 0;
      return idAscending ? (ia - ib) : (ib - ia);
    });
    items.forEach(function (li) { ul.appendChild(li); });
    idAscending = !idAscending;
    _secPagination.currentPage = 1;
    applySectionsPagination(doc);
    if (_panel) _panel.showStatus('Sekcje posortowane wg ID');
  }

  // =========================================================================
  // TOOLBAR
  // =========================================================================

  // Per-parameter child value sort (natural ordering: 1, 2, 10, 20, 100)
  // Sorts DOM + saves order to server via saveManualSort API
  function sortChildValuesNatural(doc, parentNodeId, mode) {
    // v4.6.1: mode 'name' (domyślny, naturalny) lub 'id' (po ID rosnąco)
    mode = mode || 'name';
    var childUl = doc.getElementById('block_group' + parentNodeId);
    var _modeLabel = mode === 'id' ? 'wg ID' : 'naturalnie';

    function doNaturalSort(ul) {
      var items = Array.prototype.slice.call(ul.querySelectorAll(':scope > li[id^="m_"]'));
      if (items.length === 0) return;
      items.sort(function(a, b) {
        if (mode === 'id') {
          return (parseInt(getNodeId(a), 10) || 0) - (parseInt(getNodeId(b), 10) || 0);
        }
        var nameA = getNodeName(doc, getNodeId(a));
        var nameB = getNodeName(doc, getNodeId(b));
        return nameA.localeCompare(nameB, 'pl', { numeric: true, sensitivity: 'base' });
      });
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        var nid = getNodeId(li);
        var space = doc.getElementById('space_' + nid);
        if (space) ul.appendChild(space);
        ul.appendChild(li);
      }

      // Save new order to server
      var sortOrder = [];
      for (var j = 0; j < items.length; j++) {
        sortOrder.push({ id: Number(getNodeId(items[j])), sortOrder: j + 1 });
      }
      var xhr = new (doc.defaultView || window).XMLHttpRequest();
      xhr.open('POST', '/panel/ajax/parameters.php', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = function() {
        if (xhr.status === 200) {
          showForceDeleteStatus(doc, 'Posortowano ' + _modeLabel + ' i zapisano (' + items.length + ' wartości)');
        } else {
          showForceDeleteStatus(doc, 'Posortowano w widoku, ale błąd zapisu na serwerze');
        }
      };
      xhr.onerror = function() {
        showForceDeleteStatus(doc, 'Posortowano w widoku, ale błąd połączenia z serwerem');
      };
      xhr.send('action=saveManualSort&parameters=' + encodeURIComponent(JSON.stringify(sortOrder)));

      showForceDeleteStatus(doc, 'Sortowanie ' + _modeLabel + ' — zapisywanie...');
    }

    if (childUl && childUl.querySelectorAll(':scope > li[id^="m_"]').length > 0) {
      doNaturalSort(childUl);
      return;
    }

    // Children not loaded — expand first, then sort
    var showBtn = doc.getElementById('showChildren_' + parentNodeId);
    if (!showBtn) return;
    showBtn.click();
    showForceDeleteStatus(doc, 'Rozwijanie wartości przed sortowaniem...');
    var checks = 0;
    var interval = setInterval(function() {
      checks++;
      var ul = doc.getElementById('block_group' + parentNodeId);
      if (ul && ul.querySelectorAll(':scope > li[id^="m_"]').length > 0) {
        clearInterval(interval);
        doNaturalSort(ul);
      }
      if (checks > 100) {
        clearInterval(interval);
        showForceDeleteStatus(doc, 'Timeout — nie udało się rozwinąć wartości');
      }
    }, 100);
  }

  // =========================================================================

  // Export tree as JSON (v3.4.0)
  // v4.5.8: Full export — fetches all child values for every parameter (no need to expand)
  async function fetchFullTree(doc, onProgress) {
    var root = doc.querySelector('#block_group0');
    if (!root) return [];
    var roots = Array.prototype.slice.call(root.querySelectorAll(':scope > li[id^="m_"]'));
    var total = roots.length;
    if (onProgress) onProgress(0, total, 0);
    var BATCH = 5;
    var result = [];
    var totalValues = 0;
    for (var i = 0; i < roots.length; i += BATCH) {
      var batch = roots.slice(i, i + BATCH);
      var batchData = await Promise.all(batch.map(async function (li) {
        var nid = getNodeId(li); if (!nid) return null;
        var name = getNodeName(doc, nid);
        var values = [];
        try {
          var children = await loadChildValues(nid);
          values = (children || []).map(function (c) { return { id: Number(c.id), name: c.name }; });
        } catch (e) {}
        return { id: Number(nid), name: name, values: values };
      }));
      batchData.forEach(function (x) { if (x) { result.push(x); totalValues += x.values.length; } });
      if (onProgress) onProgress(Math.min(i + BATCH, total), total, totalValues);
    }
    return result;
  }

  function downloadBlob(doc, content, mime, filename) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  function csvEsc(v) {
    if (v == null) return '';
    var s = String(v);
    if (/[,"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function xmlEsc(v) {
    if (v == null) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  // v4.5.46: ujednolicony eksport — modal z wyborem zakresu, formatu i języków
  var COMMON_LANGS = [
    { code: 'pol', label: 'Polski' }, { code: 'eng', label: 'Angielski' }, { code: 'ger', label: 'Niemiecki' },
    { code: 'fra', label: 'Francuski' }, { code: 'ita', label: 'Włoski' }, { code: 'esp', label: 'Hiszpański' },
    { code: 'ces', label: 'Czeski' }, { code: 'slk', label: 'Słowacki' }, { code: 'hun', label: 'Węgierski' },
    { code: 'rum', label: 'Rumuński' }, { code: 'rus', label: 'Rosyjski' }, { code: 'ukr', label: 'Ukraiński' },
    { code: 'ara', label: 'Arabski' }
  ];

  // v4.5.66: parametry wynikające z zaznaczenia = zaznaczone parametry
  // + rodzice zaznaczonych wartości (nie da się eksportować wartości bez parametru)
  function getSelectedParamIds(doc) {
    var set = {};
    selectedNodes.forEach(function (nid) {
      if (isParameter(doc, nid)) {
        set[String(nid)] = true;
      } else if (isValue(doc, nid)) {
        var pId = getParentId(doc, nid);
        if (pId && pId !== '0') set[String(pId)] = true;
      } else {
        // typ nieznany (np. drzewo jeszcze nie w pełni odczytane) — traktuj jak parametr
        set[String(nid)] = true;
      }
    });
    return Object.keys(set);
  }

  // v4.5.72: ID zaznaczonych sekcji (analogicznie do getSelectedParamIds)
  function getSelectedSectionIds(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return [];
    return Array.from(_sectionsMount.listEl.querySelectorAll(':scope > li')).filter(function (li) {
      if (li.classList.contains('panel-pro--filter-hidden')) return false;
      var cb = li.querySelector('input.tp-checkbox');
      return cb && cb.checked;
    }).map(function (li) { return li.dataset.sectionId; });
  }

  // v4.5.63: UI portowane ze skryptu IdoSell Menu (Shadow DOM, karta TYP / pills / chipy języków).
  // Dla parametrów mamy tylko typ "Pełny" — sekcja typu pokazana dla spójności wizualnej, ale
  // jedyna karta jest aktywna.
  function showExportModal(targetDoc, defaultScope, kind) {
    kind = kind || 'params';
    var isSec = (kind === 'sections');
    var existing = document.getElementById('tp-export-chooser-host');
    if (existing) existing.remove();

    var host = document.createElement('div');
    host.id = 'tp-export-chooser-host';
    host.style.cssText = 'all:initial;';
    document.body.appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });

    var selIds = isSec ? getSelectedSectionIds(targetDoc) : getSelectedParamIds(targetDoc);
    var hasSelection = selIds.length > 0;
    var selCount = selIds.length;
    var currentScope = (defaultScope === 'selected' && hasSelection) ? 'selected' : 'all';
    var currentFormat = 'json';
    var L = isSec ? {
      title: 'Eksport sekcji',
      sub: 'Wybierz format, zakres i języki eksportu sekcji',
      typeName: 'Pełny',
      typeDesc: 'Sekcje + nazwy per język' ,
      scopeAll: 'Wszystkie sekcje',
      info: 'Eksport zawiera <strong>nazwy sekcji</strong> per język. Listę przypisanych produktów (ID + kody) wybierasz powyżej.'
    } : {
      title: 'Eksport',
      sub: 'Wybierz format, zakres i języki eksportu',
      typeName: 'Pełny',
      typeDesc: 'Parametry + wartości + priorytety + kontekst',
      scopeAll: 'Całe drzewo',
      info: 'Eksport zawiera <strong>nazwy</strong> per język. Dodatkowe pola (priorytety, konteksty, lista produktów) wybierasz powyżej.'
    };

    var LANG_COUNTRY = { pol:'PL', eng:'GB', ger:'DE', deu:'DE', fra:'FR', ces:'CZ', cze:'CZ', ukr:'UA', ita:'IT', esp:'ES', rus:'RU', por:'PT', nld:'NL', hun:'HU', swe:'SE', nor:'NO', dan:'DK', fin:'FI', rum:'RO', rom:'RO', bul:'BG', hrv:'HR', slk:'SK', slv:'SI', lit:'LT', lav:'LV', est:'EE', ara:'SA' };
    function langFlag(code) {
      var cc = LANG_COUNTRY[code]; if (!cc) return '';
      return String.fromCodePoint.apply(String, cc.split('').map(function (c) { return 0x1F1E6 + c.charCodeAt(0) - 65; }));
    }
    var stateLangs = COMMON_LANGS.map(function (l) { return { code: l.code, label: l.label, on: l.code === LANG }; });
    var stateExtras = isSec ? [
      { key: 'products', label: 'Lista produktów (ID + kody)', desc: 'ID przypisanych towarów per sekcja; kody przez Admin API (opcjonalnie)', on: false }
    ] : [
      { key: 'priority', label: 'Priorytety', desc: 'Pozycja parametru/wartości w drzewie', on: true },
      { key: 'context', label: 'Konteksty specjalne', desc: 'context_id parametrów + context_value_id wartości', on: true },
      { key: 'products', label: 'Lista produktów (ID + kody)', desc: 'ID przypisanych towarów per wartość; kody przez Admin API (opcjonalnie)', on: false }
    ];
    var savedApiKey = '';
    try { savedApiKey = localStorage.getItem('tp.adminApiKey') || ''; } catch (e) {}

    var CSS = [
      ':host { all: initial; }',
      '*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: \'DM Sans\', system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }',
      'button, input, select { font-family: inherit; }',
      '.ov { position: fixed; inset: 0; z-index: 280000; background: rgba(26,26,46,.45); display: flex; align-items: flex-start; justify-content: center; padding: 30px 16px; overflow-y: auto; }',
      '.mb { width: 100%; max-width: 680px; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.08); }',
      '.hd { padding: 20px 22px 16px; display: flex; align-items: flex-start; gap: 14px; border-bottom: 1px solid #eef0f4; position: relative; }',
      '.hd-ic { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #e8eeff; color: #4f8cff; }',
      '.hd-t { font-size: 16px; font-weight: 700; color: #1a1a2e; }',
      '.hd-s { font-size: 12.5px; color: #98a2b3; margin-top: 2px; }',
      '.hd-x { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #b0b8c9; padding: 0; }',
      '.hd-x:hover { background: #f0f2f5; color: #344054; }',
      '.bd { padding: 16px 22px 6px; max-height: 70vh; overflow-y: auto; }',
      '.sec { margin-bottom: 14px; }',
      '.lbl { font-size: 11.5px; color: #667085; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .4px; }',
      '.lbl-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }',
      '.lbl-row .lbl { margin-bottom: 0; }',
      '.lbl-row .col-toggle { font-size: 11px; border: none; background: transparent; color: #4f8cff; cursor: pointer; padding: 2px 8px; border-radius: 4px; font-weight: 600; }',
      '.lbl-row .col-toggle:hover { background: #dbe6ff; }',
      '.types { display: grid; grid-template-columns: 1fr; gap: 8px; }',
      '.type-card { padding: 14px 12px; border-radius: 10px; border: 2px solid #4f8cff; background: #f5f8ff; text-align: center; display: flex; align-items: center; gap: 12px; }',
      '.type-ic { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: #dbe6ff; color: #4f8cff; flex-shrink: 0; }',
      '.type-text { text-align: left; }',
      '.type-t { font-size: 13px; font-weight: 600; color: #1a1a2e; }',
      '.type-d { font-size: 11px; color: #98a2b3; margin-top: 3px; line-height: 1.3; }',
      '.pills { display: flex; gap: 6px; flex-wrap: wrap; }',
      '.pill { flex: 1 1 auto; padding: 8px 14px; border-radius: 8px; border: 1px solid #e0e3ea; background: #fff; cursor: pointer; text-align: center; font-size: 13px; font-weight: 500; color: #667085; transition: all .15s; min-width: 90px; }',
      '.pill:hover { background: #fafbfd; }',
      '.pill.active { border: 2px solid #4f8cff; padding: 7px 13px; background: #f5f8ff; color: #1a1a2e; font-weight: 600; }',
      '.pill.disabled { opacity: .4; cursor: not-allowed; pointer-events: none; }',
      '.lang-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 6px; margin-top: 8px; }',
      '.lang-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #e0e3ea; border-radius: 8px; cursor: pointer; font-size: 12.5px; color: #344054; transition: all .15s; user-select: none; }',
      '.lang-item:hover { background: #fafbfd; }',
      '.lang-item.checked { border: 2px solid #4f8cff; padding: 5px 9px; background: #f5f8ff; }',
      '.lang-flag { font-size: 14px; }',
      '.lang-name { flex: 1; }',
      '.lang-item input { display: none; }',
      '.lang-check { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid #c6d0e0; flex-shrink: 0; position: relative; }',
      '.lang-item.checked .lang-check { background: #4f8cff; border-color: #4f8cff; }',
      '.lang-item.checked .lang-check::after { content: \'\'; position: absolute; left: 3.5px; top: 0.5px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }',
      '.extras { display: flex; flex-direction: column; gap: 4px; border: 1px solid #eef0f4; border-radius: 10px; padding: 10px 12px; background: #fafbfd; }',
      '.toggle-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; background: #fff; transition: background .15s; }',
      '.toggle-row:hover { background: #f5f8ff; }',
      '.toggle-row input { display: none; }',
      '.toggle-sw { position: relative; width: 30px; height: 17px; border-radius: 9px; background: #d0d5dd; transition: background .2s; flex-shrink: 0; }',
      '.toggle-sw::after { content: \'\'; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.15); transition: left .2s; }',
      '.toggle-row.on .toggle-sw { background: #4f8cff; }',
      '.toggle-row.on .toggle-sw::after { left: 15px; }',
      '.toggle-text { flex: 1; }',
      '.toggle-label { font-size: 12.5px; font-weight: 500; color: #344054; line-height: 1.3; }',
      '.toggle-row.on .toggle-label { color: #1a1a2e; }',
      '.toggle-desc { font-size: 11px; color: #98a2b3; margin-top: 2px; line-height: 1.3; }',
      '.api-row { display: flex; gap: 8px; align-items: stretch; }',
      '.api-input { flex: 1; padding: 9px 11px; border: 1px solid #d0d5dd; border-radius: 8px; font-size: 13px; color: #1a1a2e; }',
      '.api-input:focus { outline: none; border-color: #4f8cff; box-shadow: 0 0 0 3px rgba(79,140,255,.15); }',
      '.b-mini { padding: 0 14px; border-radius: 8px; border: 1px solid #4f8cff; background: #eef3ff; color: #2f6ad6; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap; }',
      '.b-mini:hover { background: #dbe6ff; }',
      '.b-mini[disabled] { opacity: .6; cursor: progress; }',
      '.api-hint { font-size: 11px; color: #98a2b3; margin-top: 6px; line-height: 1.4; }',
      '.api-hint code { background: #f0f2f5; padding: 1px 5px; border-radius: 3px; font-size: 11px; }',
      '.info { padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; background: #eef3ff; border: 1px solid #d6e2ff; color: #3b5998; }',
      '.info strong { font-weight: 700; }',
      '.ft { padding: 14px 22px; border-top: 1px solid #eef0f4; background: #fafbfc; display: flex; gap: 8px; justify-content: flex-end; align-items: center; }',
      '.b { padding: 9px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }',
      '.b-c { background: #fff; border: 1px solid #d0d5dd; color: #344054; }',
      '.b-c:hover { background: #f8f9fb; }',
      '.b-p { background: linear-gradient(135deg, #4f8cff, #3b6de0); color: #fff; border: none; box-shadow: 0 2px 8px rgba(79,140,255,.35); }',
      '.b-p:hover { box-shadow: 0 4px 12px rgba(79,140,255,.45); }'
    ].join('\n');

    var ICON_DOWN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    var ICON_CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    var ICON_FULL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';

    var st = document.createElement('style'); st.textContent = CSS; shadow.appendChild(st);

    function buildLangHtml() {
      return stateLangs.map(function (l) {
        return '<label class="lang-item' + (l.on ? ' checked' : '') + '" data-lang="' + l.code + '">' +
          '<span class="lang-check"></span>' +
          '<span class="lang-flag">' + langFlag(l.code) + '</span>' +
          '<span class="lang-name">' + l.label + '</span>' +
          '<input type="checkbox"' + (l.on ? ' checked' : '') + '>' +
        '</label>';
      }).join('');
    }
    function buildExtrasHtml() {
      return stateExtras.map(function (f) {
        return '<label class="toggle-row' + (f.on ? ' on' : '') + '" data-extra="' + f.key + '">' +
          '<span class="toggle-sw"></span>' +
          '<span class="toggle-text"><div class="toggle-label">' + f.label + '</div><div class="toggle-desc">' + f.desc + '</div></span>' +
          '<input type="checkbox"' + (f.on ? ' checked' : '') + '>' +
        '</label>';
      }).join('');
    }

    var overlay = document.createElement('div');
    overlay.className = 'ov';
    overlay.innerHTML =
      '<div class="mb">' +
        '<div class="hd">' +
          '<div class="hd-ic">' + ICON_DOWN + '</div>' +
          '<div><div class="hd-t">' + L.title + '</div><div class="hd-s">' + L.sub + '</div></div>' +
          '<button type="button" class="hd-x" aria-label="Zamknij">' + ICON_CLOSE + '</button>' +
        '</div>' +
        '<div class="bd">' +
          '<div class="sec">' +
            '<div class="lbl">Typ eksportu</div>' +
            '<div class="types">' +
              '<div class="type-card">' +
                '<div class="type-ic">' + ICON_FULL + '</div>' +
                '<div class="type-text"><div class="type-t">' + L.typeName + '</div><div class="type-d">' + L.typeDesc + '</div></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sec">' +
            '<div class="lbl">Format pliku</div>' +
            '<div class="pills">' +
              '<button type="button" class="pill active" data-fmt="json">JSON</button>' +
              '<button type="button" class="pill" data-fmt="csv">CSV</button>' +
              '<button type="button" class="pill" data-fmt="xml">XML</button>' +
            '</div>' +
          '</div>' +
          '<div class="sec">' +
            '<div class="lbl">Zakres</div>' +
            '<div class="pills">' +
              '<button type="button" class="pill' + (currentScope === 'all' ? ' active' : '') + '" data-scope="all">' + L.scopeAll + '</button>' +
              '<button type="button" class="pill' + (currentScope === 'selected' ? ' active' : '') + (hasSelection ? '' : ' disabled') + '" data-scope="selected">Tylko zaznaczone' + (hasSelection ? ' (' + selCount + ')' : '') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="sec">' +
            '<div class="lbl-row"><div class="lbl">Języki</div><button type="button" class="col-toggle" data-toggle-all="langs">Zaznacz</button></div>' +
            '<div class="lang-list" data-role="lang-list">' + buildLangHtml() + '</div>' +
          '</div>' +
          '<div class="sec">' +
            '<div class="lbl">Dodatkowe dane</div>' +
            '<div class="extras" data-role="extras-list">' + buildExtrasHtml() + '</div>' +
          '</div>' +
          '<div class="sec" data-role="api-sec" style="display:none">' +
            '<div class="lbl">Kody produktów przez Admin API (opcjonalnie)</div>' +
            '<div class="api-row"><input type="text" class="api-input" data-role="api-key" placeholder="X-API-KEY (klucz Admin API z prawami do produktów)" value="' + (savedApiKey || '') + '">' +
            '<button type="button" class="b-mini" data-role="api-create">Utwórz klucz</button></div>' +
            '<div class="api-hint">Gdy klucz podany — do każdego produktu dociągane są <code>kod zewnętrzny</code> i <code>kod producenta</code> przez <code>/api/admin/v5/products/products/search</code>. „Utwórz klucz" tworzy automatycznie klucz z prawem odczytu produktów (PIM). Klucz zapisywany lokalnie w przeglądarce.</div>' +
          '</div>' +
          '<div class="info">' + L.info + '</div>' +
        '</div>' +
        '<div class="ft">' +
          '<button type="button" class="b b-c" data-role="cancel">Anuluj</button>' +
          '<button type="button" class="b b-p" data-role="ok">Eksportuj</button>' +
        '</div>' +
      '</div>';
    shadow.appendChild(overlay);

    function close() { try { host.remove(); } catch (e) {} }
    shadow.querySelector('.hd-x').addEventListener('click', close);
    shadow.querySelector('[data-role="cancel"]').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    shadow.querySelectorAll('[data-fmt]').forEach(function (p) {
      p.addEventListener('click', function () {
        if (p.classList.contains('disabled')) return;
        currentFormat = p.dataset.fmt;
        shadow.querySelectorAll('[data-fmt]').forEach(function (x) { x.classList.remove('active'); });
        p.classList.add('active');
      });
    });
    shadow.querySelectorAll('[data-scope]').forEach(function (p) {
      p.addEventListener('click', function () {
        if (p.classList.contains('disabled')) return;
        currentScope = p.dataset.scope;
        shadow.querySelectorAll('[data-scope]').forEach(function (x) { x.classList.remove('active'); });
        p.classList.add('active');
      });
    });
    shadow.querySelectorAll('.lang-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var code = item.dataset.lang;
        var s = stateLangs.find(function (x) { return x.code === code; });
        if (!s) return;
        s.on = !s.on;
        item.classList.toggle('checked', s.on);
        var cb = item.querySelector('input'); if (cb) cb.checked = s.on;
        var btn = shadow.querySelector('[data-toggle-all="langs"]');
        if (btn) btn.textContent = stateLangs.every(function (l) { return l.on; }) ? 'Odznacz' : 'Zaznacz';
      });
    });
    shadow.querySelectorAll('[data-toggle-all="langs"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newState = btn.textContent.trim() !== 'Odznacz';
        stateLangs.forEach(function (l) { l.on = newState; });
        shadow.querySelectorAll('.lang-item').forEach(function (item) {
          item.classList.toggle('checked', newState);
          var cb = item.querySelector('input'); if (cb) cb.checked = newState;
        });
        btn.textContent = newState ? 'Odznacz' : 'Zaznacz';
      });
    });
    (function syncLangBtn() {
      var btn = shadow.querySelector('[data-toggle-all="langs"]');
      if (btn) btn.textContent = stateLangs.every(function (l) { return l.on; }) ? 'Odznacz' : 'Zaznacz';
    })();

    function syncApiSec() {
      var prodOn = stateExtras.find(function (x) { return x.key === 'products'; });
      var sec = shadow.querySelector('[data-role="api-sec"]');
      if (sec) sec.style.display = (prodOn && prodOn.on) ? '' : 'none';
    }
    var createBtn = shadow.querySelector('[data-role="api-create"]');
    if (createBtn) createBtn.addEventListener('click', async function () {
      createBtn.disabled = true;
      var orig = createBtn.textContent;
      createBtn.textContent = 'Tworzę...';
      try {
        var k = await createAdminApiKey();
        var inp = shadow.querySelector('[data-role="api-key"]');
        if (inp) inp.value = k;
        try { localStorage.setItem('tp.adminApiKey', k); } catch (e) {}
        createBtn.textContent = 'Utworzono ✓';
        setTimeout(function () { createBtn.textContent = orig; createBtn.disabled = false; }, 2000);
      } catch (e) {
        alert('Nie udało się utworzyć klucza API: ' + (e.message || e));
        createBtn.textContent = orig; createBtn.disabled = false;
      }
    });
    shadow.querySelectorAll('[data-extra]').forEach(function (row) {
      row.addEventListener('click', function (e) {
        e.preventDefault();
        var key = row.dataset.extra;
        var s = stateExtras.find(function (x) { return x.key === key; });
        if (!s) return;
        s.on = !s.on;
        row.classList.toggle('on', s.on);
        var cb = row.querySelector('input'); if (cb) cb.checked = s.on;
        if (key === 'products') syncApiSec();
      });
    });
    syncApiSec();

    shadow.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var langs = stateLangs.filter(function (l) { return l.on; }).map(function (l) { return l.code; });
      if (!langs.length) { alert('Wybierz przynajmniej jeden język'); return; }
      var extras = {};
      stateExtras.forEach(function (f) { extras[f.key] = !!f.on; });
      var apiKeyInput = shadow.querySelector('[data-role="api-key"]');
      var apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      if (apiKey) { try { localStorage.setItem('tp.adminApiKey', apiKey); } catch (e) {} }
      close();
      var runner = isSec ? runSectionsExport : runExport;
      runner(targetDoc, { scope: currentScope, format: currentFormat, langs: langs, extras: extras, apiKey: apiKey }).catch(function (e) {
        alert('Błąd eksportu: ' + (e.message || e));
      });
    });
  }

  // Fetch parameter tree for given language. Returns flat array of {id, name, priority, values:[{id, name, priority}]}.
  async function fetchTreeMultiLang(doc, paramIds, langs, onProgress) {
    // dataByLang[lang][paramId] = { name, values: { valueId: name } }
    var dataByLang = {};
    for (var li = 0; li < langs.length; li++) {
      var lang = langs[li];
      onProgress && onProgress('Pobieranie parametrów w języku ' + lang + '...', li, langs.length);
      try {
        var listResp = await fetchAjax('action=getList&type=parameter&parent=0&lang=' + encodeURIComponent(lang));
        var paramsForLang = (listResp && listResp.data) ? listResp.data : [];
        dataByLang[lang] = {};
        paramsForLang.forEach(function (p) {
          dataByLang[lang][String(p.id)] = { name: String(p.name || '').trim(), values: {} };
        });
      } catch (e) { dataByLang[lang] = {}; }
    }
    // Determine which param IDs to actually export
    var allParamIds;
    if (paramIds && paramIds.length) {
      allParamIds = paramIds.slice();
    } else {
      // All root params from primary lang
      var primary = dataByLang[langs[0]] || {};
      allParamIds = Object.keys(primary);
    }
    // Fetch values for each param × lang
    var total = allParamIds.length * langs.length;
    var done = 0;
    for (var i = 0; i < allParamIds.length; i++) {
      var pid = allParamIds[i];
      for (var lj = 0; lj < langs.length; lj++) {
        var l = langs[lj];
        onProgress && onProgress('Wartości parametru ' + pid + ' (' + l + ')...', done, total);
        try {
          var children = await fetchValuesForLang(pid, l);
          if (!dataByLang[l][pid]) dataByLang[l][pid] = { name: '', values: {} };
          children.forEach(function (c, idx) {
            dataByLang[l][pid].values[String(c.id)] = { name: String(c.name || '').trim(), priority: idx + 1 };
          });
        } catch (e) {}
        done++;
      }
    }
    // Build merged structure
    var primaryLang = langs[0];
    var primary = dataByLang[primaryLang] || {};
    var paramsOrdered = allParamIds.map(function (pid, idx) {
      var entry = primary[pid] || { name: '', values: {} };
      var names = {};
      langs.forEach(function (l) { names[l] = (dataByLang[l][pid] && dataByLang[l][pid].name) || ''; });
      // Collect all value IDs across languages
      var valueIdSet = {};
      langs.forEach(function (l) {
        var lv = dataByLang[l][pid] && dataByLang[l][pid].values || {};
        Object.keys(lv).forEach(function (vid) { valueIdSet[vid] = true; });
      });
      var valueIds = Object.keys(valueIdSet);
      // Get priority from primary lang ordering
      var primaryValues = entry.values;
      valueIds.sort(function (a, b) {
        var pa = primaryValues[a] ? primaryValues[a].priority : 9999;
        var pb = primaryValues[b] ? primaryValues[b].priority : 9999;
        return pa - pb;
      });
      var values = valueIds.map(function (vid, vi) {
        var vnames = {};
        langs.forEach(function (l) {
          vnames[l] = (dataByLang[l][pid] && dataByLang[l][pid].values && dataByLang[l][pid].values[vid] && dataByLang[l][pid].values[vid].name) || '';
        });
        return { id: Number(vid), names: vnames, priority: vi + 1, context_id: null };
      });
      return { id: Number(pid), names: names, priority: idx + 1, context_id: null, values: values };
    });
    return { langs: langs, parameters: paramsOrdered };
  }

  function fetchValuesForLang(paramId, lang) {
    return new Promise(function (resolve, reject) {
      var win = getIframeWin();
      if (!win) return reject(new Error('Brak iframe'));
      var xhr = new win.XMLHttpRequest();
      xhr.open('POST', AJAX_URL);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = function () {
        try {
          var resp = JSON.parse(xhr.responseText);
          var html = resp.treeCode || '';
          var children = [];
          var regex = /id="m_(\d+)"[\s\S]*?class="showMenuSub\s+value[^"]*">([^<]+)/g;
          var match;
          while ((match = regex.exec(html)) !== null) children.push({ id: match[1], name: match[2].trim() });
          resolve(children);
        } catch (e) { reject(e); }
      };
      xhr.onerror = function () { reject(new Error('Sieć')); };
      xhr.send('action=getTreeForSection&parameter=group' + paramId + '&lang=' + encodeURIComponent(lang));
    });
  }

  // v4.5.69: auto-tworzenie klucza Admin API (port z "IdoSell - Masowe stany magazynowe").
  // Uprawnienia tylko PIM=r (odczyt) — eksport potrzebuje wyłącznie products/search.
  async function createAdminApiKey() {
    var html = await new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/panel/users-api.php?operation=add', true);
      xhr.onload = function () { xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error('GET HTTP ' + xhr.status)); };
      xhr.onerror = function () { reject(new Error('Błąd sieci (GET)')); };
      xhr.send();
    });
    function parseHidden(h, f) {
      var re1 = new RegExp('name=["\']' + f + '["\'][^>]*value=["\']([^"\']+)', 'i');
      var re2 = new RegExp('value=["\']([^"\']+)["\'][^>]*name=["\']' + f + '["\']', 'i');
      var m = h.match(re1); if (m) return m[1];
      m = h.match(re2); if (m) return m[1];
      return null;
    }
    var apiKeyGen = parseHidden(html, 'api_key_generated');
    var passGen = parseHidden(html, 'password_generated');
    if (!apiKeyGen || !passGen) throw new Error('Nie znaleziono pre-generated key w formularzu users-api.php');

    var params = new URLSearchParams();
    params.append('__iai_shop_panel[__encoding]', 'utf-8');
    params.append('authorization_type', 'key');
    params.append('app_name', 'PanelPro Parametry Export');
    params.append('email', 'panelpro@local');
    params.append('active', 'y');
    params.append('host_active', 'n');
    params.append('host', '');
    params.append('limited', 'n');
    params.append('time_zone', 'Europe/Warsaw');
    params.append('panel_language_default', 'pol');
    params.append('panel_language', 'pol');
    params.append('locale', 'pl_PL');
    params.append('perms_system', 'none');
    params.append('perms_cms', 'none');
    params.append('perms_crm', 'none');
    params.append('perms_pim', 'r');
    params.append('perms_oms', 'none');
    params.append('perms_wms', 'none');
    params.append('add_user', 'true');
    params.append('password_generated', passGen);
    params.append('api_key_generated', apiKeyGen);
    params.append('change_api_key', '0');
    params.append('editid', '');

    var resp = await new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/panel/users-api.php', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = function () { xhr.status === 200 ? resolve({ text: xhr.responseText, url: xhr.responseURL }) : reject(new Error('POST HTTP ' + xhr.status)); };
      xhr.onerror = function () { reject(new Error('Błąd sieci (POST)')); };
      xhr.send(params.toString());
    });
    var url = resp.url || '', text = resp.text || '';
    var login = (url.match(/[?&]id=(application\d+)/) || [])[1]
      || (url.match(/[?&]editid=(application\d+)/) || [])[1]
      || (text.match(/Username[\s\S]{0,80}?(application\d+)/i) || [])[1];
    if (!login) {
      var m2 = text.match(/X-API-KEY[\s:]*([A-Za-z0-9+/=]{20,})/i);
      if (m2) { try { var lm = atob(m2[1]).match(/(application\d+):/); if (lm) login = lm[1]; } catch (e) {} }
    }
    if (!login) login = (text.match(/(application\d+)/) || [])[1];
    if (!login) {
      var limitHit = /maksymalnie dwa|too many keys|przekroczono.*limit|limit.*kluczy/i.test(text);
      throw new Error(limitHit ? 'Limit aktywnych kluczy API osiągnięty — zdezaktywuj istniejący lub wpisz klucz ręcznie.' : 'Nie udało się sparsować loginu z odpowiedzi panelu.');
    }
    return btoa(login + ':' + apiKeyGen);
  }

  async function runExport(doc, opts) {
    var extras = opts.extras || { priority: true, context: true, products: false };
    var paramIds = [];
    var selValuesByParam = {}; // paramId -> { valueId: true } — gdy zaznaczono konkretne wartości
    if (opts.scope === 'selected') {
      // v4.5.66: zaznaczone parametry + rodzice zaznaczonych wartości
      paramIds = getSelectedParamIds(doc);
      if (!paramIds.length) { alert('Brak zaznaczenia — zaznacz parametr lub przynajmniej jedną jego wartość'); return; }
      // v4.5.68: które wartości zaznaczono explicite (do filtrowania per parametr)
      selectedNodes.forEach(function (nid) {
        if (isValue(doc, nid)) {
          var pid = getParentId(doc, nid);
          if (pid && pid !== '0') {
            (selValuesByParam[String(pid)] = selValuesByParam[String(pid)] || {})[String(nid)] = true;
          }
        }
      });
    }

    if (_panel) _panel.showStatus('Eksport: rozpoczynanie...');

    var data = await fetchTreeMultiLang(doc, paramIds, opts.langs, function (msg, done, total) {
      if (_panel) {
        var pct = total > 0 ? Math.round(done / total * 100) : 0;
        _panel.showStatus('Eksport ' + opts.format.toUpperCase() + ': ' + msg + ' (' + pct + '%)');
      }
    });

    // v4.5.68: jeśli dla parametru zaznaczono konkretne wartości — eksportuj tylko je.
    // Brak zaznaczonych wartości (zaznaczony sam parametr / collapsed) => wszystkie wartości.
    if (opts.scope === 'selected') {
      data.parameters.forEach(function (p) {
        var sel = selValuesByParam[String(p.id)];
        if (sel && Object.keys(sel).length) {
          p.values = p.values.filter(function (v) { return sel[String(v.id)]; });
        }
      });
    }

    // v4.5.64: opcjonalnie dociągnij konteksty per parametr+wartość gdy ekstras.context
    if (extras.context) {
      var ctxTargets = [];
      data.parameters.forEach(function (p) {
        ctxTargets.push({ ref: p, isValue: false, id: p.id });
        p.values.forEach(function (v) { ctxTargets.push({ ref: v, isValue: true, id: v.id }); });
      });
      var BATCH = 15;
      for (var ci = 0; ci < ctxTargets.length; ci += BATCH) {
        var batch = ctxTargets.slice(ci, ci + BATCH);
        await Promise.all(batch.map(async function (t) {
          try {
            var info = await fetchContextForNode(t.id);
            t.ref.context_id = info && info.ctx ? info.ctx : null;
          } catch (e) {}
        }));
        if (_panel) _panel.showStatus('Eksport: konteksty (' + Math.min(ci + BATCH, ctxTargets.length) + '/' + ctxTargets.length + ')');
      }
    }

    // v4.5.67: lista produktów per wartość.
    // numberOfOccurrence czasem zwraca puste mimo że IdoSell natywnie pokazuje "towary: N"
    // (rozjazd po stronie IdoSella). Fallback: probe removeParam (errno 235 zwraca ID;
    // usunięcie jest zablokowane bo wartość MA produkty — więc to bezpieczne, gdy nativeCnt > 0).
    if (extras.products) {
      // Mapy native productCount per wartość (z treeCode)
      var nativeCnts = {};
      var paramList = data.parameters;
      for (var npi = 0; npi < paramList.length; npi += 8) {
        var npBatch = paramList.slice(npi, npi + 8);
        await Promise.all(npBatch.map(async function (p) {
          try {
            var kids = await loadChildValues(p.id);
            (kids || []).forEach(function (c) { nativeCnts[String(c.id)] = Number(c.productCount) || 0; });
          } catch (e) {}
        }));
      }

      async function resolveProductIds(nodeId, parentId) {
        var r = await fetchValueProductCount(nodeId);
        if (r && r.productIds && r.productIds.length) return r.productIds.slice();
        // Probe removeParam tylko gdy native count > 0 (deletion zablokowane => bezpieczne)
        var nc = nativeCnts[String(nodeId)] || 0;
        if (nc > 0 && parentId && parentId !== '0') {
          try {
            var rm = await fetchAjax('action=removeParam&node=' + nodeId + '&tree=0&shop=2&parent=' + parentId);
            if (String(rm.errno) === '235' && rm.error) {
              var seg = rm.error.split(/towar[óo]w:\s*/i)[1] || '';
              return seg.match(/\d+/g) || [];
            }
          } catch (e) {}
        }
        return [];
      }

      var prodTargets = [];
      data.parameters.forEach(function (p) {
        p.values.forEach(function (v) { prodTargets.push({ ref: v, id: v.id, parentId: p.id }); });
      });
      var BATCH2 = 10;
      for (var pi = 0; pi < prodTargets.length; pi += BATCH2) {
        var batch2 = prodTargets.slice(pi, pi + BATCH2);
        await Promise.all(batch2.map(async function (t) {
          try { t.ref.products = await resolveProductIds(t.id, t.parentId); }
          catch (e) { t.ref.products = []; }
        }));
        if (_panel) _panel.showStatus('Eksport: produkty (' + Math.min(pi + BATCH2, prodTargets.length) + '/' + prodTargets.length + ')');
      }
      // Parametr: union ID z wartości (+ direct gdy API zwraca dla parametru)
      for (var dpi = 0; dpi < data.parameters.length; dpi++) {
        var pp = data.parameters[dpi];
        var directP = await fetchValueProductCount(pp.id);
        var seenP = {};
        if (directP && directP.productIds) directP.productIds.forEach(function (pid) { seenP[pid] = true; });
        pp.values.forEach(function (v) { (v.products || []).forEach(function (pid) { seenP[pid] = true; }); });
        pp.products = Object.keys(seenP);
      }

      // v4.5.69: opcjonalnie — kody przez Admin API (/api/admin/v5/products/products/search)
      if (opts.apiKey) {
        var allIdsMap = {};
        data.parameters.forEach(function (p) {
          (p.products || []).forEach(function (id) { allIdsMap[id] = true; });
          p.values.forEach(function (v) { (v.products || []).forEach(function (id) { allIdsMap[id] = true; }); });
        });
        var allIds = Object.keys(allIdsMap);
        var codeMap = {};
        var API_BATCH = 100;
        for (var ai = 0; ai < allIds.length; ai += API_BATCH) {
          var idChunk = allIds.slice(ai, ai + API_BATCH);
          if (_panel) _panel.showStatus('Eksport: kody produktów (' + Math.min(ai + API_BATCH, allIds.length) + '/' + allIds.length + ')');
          try {
            var resp = await fetch('/api/admin/v5/products/products/search', {
              method: 'POST',
              headers: { 'X-API-KEY': opts.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ params: {
                returnElements: ['productId', 'code', 'sizes_attributes'],
                identType: 'id',
                products: idChunk.map(function (id) { return { productId: Number(id) }; })
              }})
            });
            var jr = await resp.json();
            (jr.results || []).forEach(function (pr) {
              var sa = (pr.productSizesAttributes || [])[0] || {};
              codeMap[String(pr.productId)] = {
                codeExternal: sa.productSizeCodeExternal || '',
                codeProducer: sa.productSizeCodeProducer || '',
                displayedCode: pr.productDisplayedCode || ''
              };
            });
          } catch (e) { /* brak kodów dla tej paczki */ }
        }
        // Wstrzyknij kody do struktur
        function attachCodes(arr) {
          (arr || []).forEach(function (node) {
            if (!node.products) return;
            node._productCodes = node.products.map(function (id) {
              var c = codeMap[String(id)] || {};
              return { id: String(id), codeExternal: c.codeExternal || '', codeProducer: c.codeProducer || '', displayedCode: c.displayedCode || '' };
            });
          });
        }
        data.parameters.forEach(function (p) {
          attachCodes([p]);
          attachCodes(p.values);
        });
      }
    }

    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    var fileBase = 'parametry_' + opts.langs.join('-') + '_' + ts;
    var content, mime, ext;

    // Helper — buduje obiekt dla parametru / wartości z włączonymi extras
    function buildNode(n, isValue) {
      var obj = { id: n.id, names: n.names };
      if (extras.priority) obj.priority = n.priority;
      if (extras.context) obj.context_id = n.context_id || null;
      if (extras.products) {
        if (n._productCodes) {
          obj.products = n._productCodes.map(function (c) {
            return { id: c.id, codeExternal: c.codeExternal, codeProducer: c.codeProducer, displayedCode: c.displayedCode };
          });
        } else {
          obj.products = (n.products || []).map(function (pid) { return { id: String(pid) }; });
        }
      }
      return obj;
    }

    if (opts.format === 'json') {
      var jsonParams = data.parameters.map(function (p) {
        var po = buildNode(p, false);
        po.values = p.values.map(function (v) { return buildNode(v, true); });
        return po;
      });
      content = JSON.stringify({ exportedAt: new Date().toISOString(), langs: data.langs, extras: extras, parameters: jsonParams }, null, 2);
      mime = 'application/json;charset=utf-8'; ext = 'json';
    } else if (opts.format === 'csv') {
      var withCodes = !!opts.apiKey;
      function prodIds(n) { return csvEsc((n._productCodes ? n._productCodes.map(function (c) { return c.id; }) : (n.products || [])).join(';')); }
      function prodExt(n) { return csvEsc((n._productCodes || []).map(function (c) { return c.codeExternal; }).join(';')); }
      function prodProd(n) { return csvEsc((n._productCodes || []).map(function (c) { return c.codeProducer; }).join(';')); }

      var header = ['parameter_id'];
      if (extras.priority) header.push('parameter_priority');
      opts.langs.forEach(function (l) { header.push('parameter_name_' + l); });
      if (extras.context) header.push('parameter_context_id');
      if (extras.products) { header.push('parameter_product_ids'); if (withCodes) header.push('parameter_product_codes_external', 'parameter_product_codes_producer'); }
      header.push('value_id');
      if (extras.priority) header.push('value_priority');
      opts.langs.forEach(function (l) { header.push('value_name_' + l); });
      if (extras.context) header.push('value_context_id');
      if (extras.products) { header.push('value_product_ids'); if (withCodes) header.push('value_product_codes_external', 'value_product_codes_producer'); }
      var rows = [header.join(',')];

      function paramCols(p) {
        var r = [p.id];
        if (extras.priority) r.push(p.priority);
        opts.langs.forEach(function (l) { r.push(csvEsc(p.names[l])); });
        if (extras.context) r.push(p.context_id || '');
        if (extras.products) { r.push(prodIds(p)); if (withCodes) { r.push(prodExt(p)); r.push(prodProd(p)); } }
        return r;
      }

      data.parameters.forEach(function (p) {
        if (!p.values.length) {
          var row = paramCols(p);
          row.push(''); // value_id
          if (extras.priority) row.push('');
          opts.langs.forEach(function () { row.push(''); });
          if (extras.context) row.push('');
          if (extras.products) { row.push(''); if (withCodes) { row.push(''); row.push(''); } }
          rows.push(row.join(','));
        } else {
          p.values.forEach(function (v) {
            var row = paramCols(p);
            row.push(v.id);
            if (extras.priority) row.push(v.priority);
            opts.langs.forEach(function (l) { row.push(csvEsc(v.names[l])); });
            if (extras.context) row.push(v.context_id || '');
            if (extras.products) { row.push(prodIds(v)); if (withCodes) { row.push(prodExt(v)); row.push(prodProd(v)); } }
            rows.push(row.join(','));
          });
        }
      });
      content = '﻿' + rows.join('\r\n');
      mime = 'text/csv;charset=utf-8'; ext = 'csv';
    } else if (opts.format === 'xml') {
      function attr(node) {
        var a = ' id="' + node.id + '"';
        if (extras.priority) a += ' priority="' + node.priority + '"';
        if (extras.context && node.context_id) a += ' contextId="' + xmlEsc(node.context_id) + '"';
        return a;
      }
      function productsXml(node, indent) {
        if (!extras.products) return '';
        if (node._productCodes && node._productCodes.length) {
          var ls = [indent + '<products>'];
          node._productCodes.forEach(function (c) {
            ls.push(indent + '  <product id="' + xmlEsc(c.id) + '" codeExternal="' + xmlEsc(c.codeExternal) + '" codeProducer="' + xmlEsc(c.codeProducer) + '" displayedCode="' + xmlEsc(c.displayedCode) + '"/>');
          });
          ls.push(indent + '</products>');
          return '\n' + ls.join('\n');
        }
        var arr = node.products || [];
        if (!arr.length) return '';
        var lines = [indent + '<products>'];
        arr.forEach(function (pid) { lines.push(indent + '  <product id="' + xmlEsc(pid) + '"/>'); });
        lines.push(indent + '</products>');
        return '\n' + lines.join('\n');
      }
      var x = ['<?xml version="1.0" encoding="UTF-8"?>'];
      x.push('<parameters exportedAt="' + xmlEsc(new Date().toISOString()) + '" langs="' + xmlEsc(opts.langs.join(',')) + '">');
      data.parameters.forEach(function (p) {
        x.push('  <parameter' + attr(p) + '>');
        opts.langs.forEach(function (l) { x.push('    <name lang="' + l + '">' + xmlEsc(p.names[l]) + '</name>'); });
        var pProducts = productsXml(p, '    ');
        if (pProducts) x.push(pProducts.slice(1));
        if (p.values.length) {
          x.push('    <values>');
          p.values.forEach(function (v) {
            x.push('      <value' + attr(v) + '>');
            opts.langs.forEach(function (l) { x.push('        <name lang="' + l + '">' + xmlEsc(v.names[l]) + '</name>'); });
            var vProducts = productsXml(v, '        ');
            if (vProducts) x.push(vProducts.slice(1));
            x.push('      </value>');
          });
          x.push('    </values>');
        }
        x.push('  </parameter>');
      });
      x.push('</parameters>');
      content = x.join('\n');
      mime = 'application/xml;charset=utf-8'; ext = 'xml';
    } else {
      throw new Error('Nieznany format: ' + opts.format);
    }

    downloadBlob(doc, content, mime, fileBase + '.' + ext);
    if (_panel) _panel.showStatus('Eksport ' + opts.format.toUpperCase() + ': ' + data.parameters.length + ' parametrów');
  }

  // v4.5.72: eksport sekcji — ten sam modal/UI co parametry (format/zakres/języki/produkty)
  async function runSectionsExport(doc, opts) {
    var extras = opts.extras || { products: false };
    var langs = opts.langs && opts.langs.length ? opts.langs : [LANG];

    function statusEl(m) { if (_panel) _panel.showStatus(m); }
    statusEl('Eksport sekcji: rozpoczynanie...');

    // Nazwy sekcji per język
    var byLang = {};       // lang -> { id: name }
    var orderIds = [];     // kolejność wg języka głównego
    for (var li = 0; li < langs.length; li++) {
      var lang = langs[li];
      statusEl('Eksport sekcji: pobieranie (' + lang + ')...');
      try {
        var resp = await fetchAjax('action=getList&type=section&parent=0&lang=' + encodeURIComponent(lang));
        var arr = (resp && resp.data) ? resp.data : [];
        byLang[lang] = {};
        arr.forEach(function (s) {
          var id = String(s.id);
          byLang[lang][id] = String(s.name || '').trim();
          if (li === 0) orderIds.push(id);
        });
      } catch (e) { byLang[lang] = {}; }
    }

    // Zakres: tylko zaznaczone
    if (opts.scope === 'selected') {
      var sel = {};
      getSelectedSectionIds(doc).forEach(function (id) { sel[String(id)] = true; });
      orderIds = orderIds.filter(function (id) { return sel[id]; });
      if (!orderIds.length) { alert('Brak zaznaczonych sekcji'); return; }
    }

    var sections = orderIds.map(function (id) {
      var names = {};
      langs.forEach(function (l) { names[l] = (byLang[l] && byLang[l][id]) || ''; });
      return { id: id, names: names, products: [], _productCodes: null };
    });

    // Lista produktów (ID + kody)
    if (extras.products) {
      var BATCH = 5;
      for (var si = 0; si < sections.length; si += BATCH) {
        var batch = sections.slice(si, si + BATCH);
        await Promise.all(batch.map(async function (sec) {
          try {
            var r = await fetchAjax('action=numberOfOccurrence&id=' + encodeURIComponent(sec.id));
            var raw = r && r.data && r.data.products ? r.data.products : null;
            var ids = [];
            if (Array.isArray(raw)) ids = raw.map(function (p) { return String(typeof p === 'object' ? (p.id || p.product_id) : p); });
            else if (raw && typeof raw === 'object') ids = Object.values(raw).map(function (p) { return String(typeof p === 'object' ? (p.id || p.product_id) : p); });
            sec.products = ids;
          } catch (e) { sec.products = []; }
        }));
        statusEl('Eksport sekcji: produkty (' + Math.min(si + BATCH, sections.length) + '/' + sections.length + ')');
      }

      if (opts.apiKey) {
        var allIdsMap = {};
        sections.forEach(function (s) { (s.products || []).forEach(function (id) { allIdsMap[id] = true; }); });
        var allIds = Object.keys(allIdsMap);
        var codeMap = {};
        var API_BATCH = 100;
        for (var ai = 0; ai < allIds.length; ai += API_BATCH) {
          var idChunk = allIds.slice(ai, ai + API_BATCH);
          statusEl('Eksport sekcji: kody produktów (' + Math.min(ai + API_BATCH, allIds.length) + '/' + allIds.length + ')');
          try {
            var aresp = await fetch('/api/admin/v5/products/products/search', {
              method: 'POST',
              headers: { 'X-API-KEY': opts.apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ params: {
                returnElements: ['productId', 'code', 'sizes_attributes'],
                identType: 'id',
                products: idChunk.map(function (id) { return { productId: Number(id) }; })
              }})
            });
            var jr = await aresp.json();
            (jr.results || []).forEach(function (pr) {
              var sa = (pr.productSizesAttributes || [])[0] || {};
              codeMap[String(pr.productId)] = {
                codeExternal: sa.productSizeCodeExternal || '',
                codeProducer: sa.productSizeCodeProducer || '',
                displayedCode: pr.productDisplayedCode || ''
              };
            });
          } catch (e) {}
        }
        sections.forEach(function (s) {
          s._productCodes = (s.products || []).map(function (id) {
            var c = codeMap[String(id)] || {};
            return { id: String(id), codeExternal: c.codeExternal || '', codeProducer: c.codeProducer || '', displayedCode: c.displayedCode || '' };
          });
        });
      }
    }

    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    var fileBase = 'sekcje_' + langs.join('-') + '_' + ts;
    var content, mime, ext;
    var withCodes = !!opts.apiKey;

    function secProducts(s) {
      if (s._productCodes) return s._productCodes.map(function (c) {
        return { id: c.id, codeExternal: c.codeExternal, codeProducer: c.codeProducer, displayedCode: c.displayedCode };
      });
      return (s.products || []).map(function (pid) { return { id: String(pid) }; });
    }

    if (opts.format === 'json') {
      var jsonSecs = sections.map(function (s) {
        var o = { id: s.id, names: s.names };
        if (extras.products) o.products = secProducts(s);
        return o;
      });
      content = JSON.stringify({ exportedAt: new Date().toISOString(), langs: langs, extras: extras, sections: jsonSecs }, null, 2);
      mime = 'application/json;charset=utf-8'; ext = 'json';
    } else if (opts.format === 'csv') {
      var header = ['section_id'];
      langs.forEach(function (l) { header.push('section_name_' + l); });
      if (extras.products) { header.push('section_product_ids'); if (withCodes) header.push('section_product_codes_external', 'section_product_codes_producer'); }
      var rows = [header.join(',')];
      sections.forEach(function (s) {
        var row = [s.id];
        langs.forEach(function (l) { row.push(csvEsc(s.names[l])); });
        if (extras.products) {
          row.push(csvEsc((s._productCodes ? s._productCodes.map(function (c) { return c.id; }) : (s.products || [])).join(';')));
          if (withCodes) {
            row.push(csvEsc((s._productCodes || []).map(function (c) { return c.codeExternal; }).join(';')));
            row.push(csvEsc((s._productCodes || []).map(function (c) { return c.codeProducer; }).join(';')));
          }
        }
        rows.push(row.join(','));
      });
      content = '﻿' + rows.join('\r\n');
      mime = 'text/csv;charset=utf-8'; ext = 'csv';
    } else if (opts.format === 'xml') {
      var x = ['<?xml version="1.0" encoding="UTF-8"?>'];
      x.push('<sections exportedAt="' + xmlEsc(new Date().toISOString()) + '" langs="' + xmlEsc(langs.join(',')) + '">');
      sections.forEach(function (s) {
        x.push('  <section id="' + xmlEsc(s.id) + '">');
        langs.forEach(function (l) { x.push('    <name lang="' + l + '">' + xmlEsc(s.names[l]) + '</name>'); });
        if (extras.products) {
          var pc = s._productCodes;
          if (pc && pc.length) {
            x.push('    <products>');
            pc.forEach(function (c) {
              x.push('      <product id="' + xmlEsc(c.id) + '" codeExternal="' + xmlEsc(c.codeExternal) + '" codeProducer="' + xmlEsc(c.codeProducer) + '" displayedCode="' + xmlEsc(c.displayedCode) + '"/>');
            });
            x.push('    </products>');
          } else if ((s.products || []).length) {
            x.push('    <products>');
            s.products.forEach(function (pid) { x.push('      <product id="' + xmlEsc(pid) + '"/>'); });
            x.push('    </products>');
          }
        }
        x.push('  </section>');
      });
      x.push('</sections>');
      content = x.join('\n');
      mime = 'application/xml;charset=utf-8'; ext = 'xml';
    } else {
      throw new Error('Nieznany format: ' + opts.format);
    }

    downloadBlob(doc, content, mime, fileBase + '.' + ext);
    statusEl('Eksport ' + opts.format.toUpperCase() + ': ' + sections.length + ' sekcji');
  }

  async function exportTreeFull(doc, format) {
    var fmtLabel = format === 'csv' ? 'CSV' : 'JSON';
    function progress(done, total, vals) {
      if (!_panel) return;
      var pct = total > 0 ? Math.round(done / total * 100) : 0;
      _panel.showStatus('Eksport ' + fmtLabel + ': ' + done + '/' + total + ' parametr\u00f3w (' + pct + '%) \u2014 ' + vals + ' warto\u015bci');
    }
    progress(0, 0, 0);
    var tree;
    try {
      tree = await fetchFullTree(doc, progress);
    } catch (e) {
      if (_panel) _panel.showStatus('B\u0142\u0105d eksportu: ' + (e.message || e), true);
      return;
    }
    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') {
      var rows = ['parameter_id,parameter_name,value_id,value_name'];
      tree.forEach(function (p) {
        if (!p.values || p.values.length === 0) {
          rows.push([p.id, csvEsc(p.name), '', ''].join(','));
        } else {
          p.values.forEach(function (v) {
            rows.push([p.id, csvEsc(p.name), v.id, csvEsc(v.name)].join(','));
          });
        }
      });
      downloadBlob(doc, '\uFEFF' + rows.join('\r\n'), 'text/csv;charset=utf-8', 'parametry_' + ts + '.csv');
      if (_panel) _panel.showStatus('Eksport CSV: ' + tree.length + ' parametr\u00f3w, ' + (rows.length - 1) + ' wierszy danych');
    } else {
      var json = JSON.stringify({ exported: new Date().toISOString(), parameters: tree }, null, 2);
      downloadBlob(doc, json, 'application/json', 'parametry_' + ts + '.json');
      if (_panel) _panel.showStatus('Eksport JSON: ' + tree.length + ' parametr\u00f3w');
    }
  }

  // v4.5.12: Export only selected items
  async function exportSelected(doc, format) {
    if (selectedNodes.size === 0) { alert('Najpierw zaznacz elementy'); return; }
    var ids = Array.from(selectedNodes);
    var fmtLabel = format === 'csv' ? 'CSV' : 'JSON';
    function progress(done, total, vals) {
      if (!_panel) return;
      var pct = total > 0 ? Math.round(done / total * 100) : 0;
      _panel.showStatus('Eksport zaznaczonych ' + fmtLabel + ': ' + done + '/' + total + ' (' + pct + '%) \u2014 ' + vals + ' warto\u015bci');
    }
    progress(0, ids.length, 0);

    var BATCH = 5;
    var result = [];
    var totalValues = 0;
    var done = 0;
    for (var i = 0; i < ids.length; i += BATCH) {
      var batch = ids.slice(i, i + BATCH);
      var batchData = await Promise.all(batch.map(async function (nid) {
        var name = getNodeName(doc, nid);
        var li = doc.getElementById('m_' + nid);
        var isPar = li ? isParameter(doc, nid) : true;
        var values = [];
        if (isPar) {
          try {
            var children = await loadChildValues(nid);
            values = (children || []).map(function (c) { return { id: Number(c.id), name: c.name }; });
          } catch (e) {}
        }
        return { id: Number(nid), name: name, type: isPar ? 'parameter' : 'value', values: values };
      }));
      batchData.forEach(function (x) { result.push(x); totalValues += x.values.length; done++; });
      progress(done, ids.length, totalValues);
    }

    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'csv') {
      var rows = ['parameter_id,parameter_name,value_id,value_name'];
      result.forEach(function (p) {
        if (!p.values || p.values.length === 0) {
          rows.push([p.id, csvEsc(p.name), '', ''].join(','));
        } else {
          p.values.forEach(function (v) { rows.push([p.id, csvEsc(p.name), v.id, csvEsc(v.name)].join(',')); });
        }
      });
      downloadBlob(doc, '\uFEFF' + rows.join('\r\n'), 'text/csv;charset=utf-8', 'parametry_zaznaczone_' + ts + '.csv');
      if (_panel) _panel.showStatus('Eksport CSV (zaznaczone): ' + result.length + ' element\u00f3w, ' + (rows.length - 1) + ' wierszy');
    } else {
      var json = JSON.stringify({ exported: new Date().toISOString(), selected: result }, null, 2);
      downloadBlob(doc, json, 'application/json', 'parametry_zaznaczone_' + ts + '.json');
      if (_panel) _panel.showStatus('Eksport JSON (zaznaczone): ' + result.length + ' element\u00f3w');
    }
  }

  // v4.5.13: Import parameters + values from JSON or CSV
  function openImportFilePicker(doc) {
    var input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv,application/json,text/csv';
    input.style.display = 'none';
    doc.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) { input.remove(); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var text = reader.result;
        var parsed;
        try {
          if (/\.csv$/i.test(file.name)) {
            parsed = parseImportCsv(text);
          } else {
            parsed = parseImportJson(text);
          }
        } catch (e) {
          alert('B\u0142\u0105d parsowania pliku: ' + (e && e.message || e));
          input.remove();
          return;
        }
        input.remove();
        if (!parsed || !parsed.length) { alert('Plik pusty lub nieprawid\u0142owy'); return; }
        var total = parsed.reduce(function (s, p) { return s + 1 + (p.values ? p.values.length : 0); }, 0);
        if (!confirm('Import: ' + parsed.length + ' parametr\u00f3w, ' + (total - parsed.length) + ' warto\u015bci.\nKontynuowa\u0107?')) return;
        runImport(doc, parsed);
      };
      reader.onerror = function () { alert('B\u0142\u0105d odczytu pliku'); input.remove(); };
      reader.readAsText(file, 'utf-8');
    });
    input.click();
  }

  function parseImportJson(text) {
    var obj = JSON.parse(text);
    // Accept either { parameters: [...] }, { selected: [...] }, or array directly
    var arr = Array.isArray(obj) ? obj : (obj.parameters || obj.selected || obj.tree || []);
    return arr.map(function (p) {
      return {
        name: String(p.name || '').trim(),
        values: (p.values || []).map(function (v) { return { name: String(v.name || '').trim() }; }).filter(function (v) { return v.name; })
      };
    }).filter(function (p) { return p.name; });
  }

  function parseImportCsv(text) {
    // Strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
    var lines = text.split(/\r\n|\n/);
    if (lines.length < 2) return [];
    // Header: parameter_id,parameter_name,value_id,value_name
    var groups = {};
    for (var i = 1; i < lines.length; i++) {
      var row = parseCsvRow(lines[i]);
      if (!row || row.length < 2) continue;
      var pName = (row[1] || '').trim();
      var vName = (row[3] || '').trim();
      if (!pName) continue;
      if (!groups[pName]) groups[pName] = { name: pName, values: [] };
      if (vName) groups[pName].values.push({ name: vName });
    }
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  function parseCsvRow(line) {
    if (!line) return null;
    var out = []; var cur = ''; var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function runImport(doc, items) {
    var created = { params: 0, values: 0 };
    var skipped = { params: 0, values: 0 };
    var errors = [];

    // Cache existing parameters by name (case-insensitive)
    var existing = getAllParameters(doc);
    var byName = {};
    existing.forEach(function (p) { byName[p.name.toLowerCase()] = p; });

    function progress(i, total) {
      if (!_panel) return;
      var pct = total > 0 ? Math.round(i / total * 100) : 0;
      _panel.showStatus('Import: ' + i + '/' + total + ' (' + pct + '%) \u2014 +' + created.params + ' param, +' + created.values + ' wart.');
    }
    progress(0, items.length);

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var paramName = item.name;
      var paramId = null;
      var key = paramName.toLowerCase();

      try {
        if (byName[key]) {
          paramId = byName[key].id;
          skipped.params++;
        } else {
          // Create parameter
          var resp = await fetchAjax('action=checkEl&type=parameter&lang=' + LANG + '&name=' + encodeURIComponent(paramName));
          if (resp.error) throw new Error(resp.error);
          // Extract new id — response may vary; try common shapes
          if (resp.data && resp.data.id) paramId = resp.data.id;
          else if (resp.data && resp.data.children && resp.data.children.length) paramId = resp.data.children[resp.data.children.length - 1].id;
          else if (resp.id) paramId = resp.id;
          if (!paramId) throw new Error('Nie uda\u0142o si\u0119 utworzy\u0107 parametru');
          created.params++;
          byName[key] = { id: paramId, name: paramName };
        }

        // Load existing values for this parameter (case-insensitive)
        var children = [];
        try { children = await loadChildValues(paramId); } catch (e) {}
        var valByName = {};
        children.forEach(function (c) { valByName[(c.name || '').toLowerCase()] = c.id; });

        for (var j = 0; j < (item.values || []).length; j++) {
          var vName = item.values[j].name;
          var vKey = vName.toLowerCase();
          if (valByName[vKey]) { skipped.values++; continue; }
          try {
            var vResp = await fetchAjax('action=checkElValues&type=value&lang=' + LANG + '&parameter_id=' + paramId + '&product=0&value[]=' + encodeURIComponent(vName));
            if (vResp.error) throw new Error(vResp.error);
            created.values++;
            // Track so duplicates in file are skipped
            if (vResp.data && vResp.data.children && vResp.data.children.length) {
              valByName[vKey] = vResp.data.children[vResp.data.children.length - 1].id;
            } else {
              valByName[vKey] = true;
            }
          } catch (e) {
            errors.push(paramName + ' / ' + vName + ': ' + (e.message || e));
          }
        }
      } catch (e) {
        errors.push(paramName + ': ' + (e.message || e));
      }
      progress(i + 1, items.length);
    }

    var summary = 'Import zako\u0144czony.\n' +
      'Utworzone parametry: ' + created.params + ' (pomini\u0119te: ' + skipped.params + ')\n' +
      'Utworzone warto\u015bci: ' + created.values + ' (pomini\u0119te: ' + skipped.values + ')';
    if (errors.length) summary += '\n\nB\u0142\u0119dy (' + errors.length + '):\n' + errors.slice(0, 10).join('\n');
    alert(summary);
    if (_panel) _panel.showStatus('Import: +' + created.params + ' param / +' + created.values + ' wart. \u2014 od\u015bwie\u017cam...');
    try { sessionStorage.setItem('tp.autoSortAfterReload', '1'); } catch (e) {}
    setTimeout(function () { (doc.defaultView || window).location.reload(); }, 1000);
  }

  function exportTreeAsJson(doc) {
    function serializeLi(li) {
      var nid = getNodeId(li);
      if (!nid) return null;
      var name = getNodeName(doc, nid);
      var isPar = isParameter(doc, nid);
      var obj = { id: Number(nid), name: name, type: isPar ? 'parameter' : 'value' };
      var childUl = doc.getElementById('block_group' + nid);
      if (childUl) {
        var kids = Array.prototype.slice.call(childUl.querySelectorAll(':scope > li[id^="m_"]'));
        if (kids.length > 0) {
          obj.children = kids.map(serializeLi).filter(Boolean);
        }
      }
      return obj;
    }
    var root = doc.querySelector('#block_group0');
    if (!root) { alert('Nie znaleziono drzewa'); return; }
    var roots = Array.prototype.slice.call(root.querySelectorAll(':scope > li[id^="m_"]'));
    var tree = roots.map(serializeLi).filter(Boolean);
    var json = JSON.stringify({ exported: new Date().toISOString(), tree: tree }, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = 'parametry_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    doc.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 100);
    showForceDeleteStatus(doc, 'Eksport JSON \u2014 ' + tree.length + ' parametr\u00f3w g\u0142\u00f3wnych');
  }

  // View modes for tree filtering (v3.4.0)
  var _viewMode = 'all'; // 'all' | 'params' | 'values'

  // v4.1.0: trigger native "Dodaj element" link from opsBar button
  function triggerNativeAddParameter(doc) {
    var nativeAdd = doc.querySelector('#product_parameters a');
    if (nativeAdd) nativeAdd.click();
    else if (_panel && _panel.showStatus) _panel.showStatus('Nie znaleziono natywnego "Dodaj element"', true);
  }

  // v4.5.18: Saved views (like in idosell-menu). Each view = { id, name, nodes: [ids] }
  var VIEWS_KEY = 'tp.views.v2';
  var _activeViewId = null;

  function loadSavedViews() {
    try { return JSON.parse(localStorage.getItem(VIEWS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function storeSavedViews(arr) {
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  // v4.5.80: ID zaznaczonych węzłów wprost z DOM (źródło prawdy = zaznaczone checkboxy).
  // selectedNodes bywa rozjechany po re-renderach drzewa — to liczy realnie zaznaczone.
  function getCheckedTreeNodeIds(doc) {
    var set = {};
    var root = doc.getElementById('block_group0');
    if (!root) return [];
    var cbs = root.querySelectorAll('input.tp-checkbox');
    for (var i = 0; i < cbs.length; i++) {
      var cb = cbs[i];
      if (!cb.checked) continue;
      var id = cb.dataset.nodeId;
      if (!id) {
        var li = cb.closest('li[id^="m_"]');
        if (li) id = getNodeId(li);
      }
      if (id) set[String(id)] = true;
    }
    return Object.keys(set);
  }

  // v4.5.78: ładny modal do wpisania nazwy (zamiast natywnego prompt())
  function showInputModal(doc, opts) {
    opts = opts || {};
    var d = doc || document;
    var overlay = d.createElement('div');
    overlay.className = 'tp-overlay';
    var modal = d.createElement('div');
    modal.className = 'tp-modal';
    modal.style.width = '460px';
    modal.style.maxWidth = 'calc(100vw - 32px)';

    var header = d.createElement('div');
    header.className = 'tp-modal-header';
    header.style.cssText = 'background:#fff;color:#202124;border-bottom:1px solid #eef0f4;';
    header.innerHTML =
      '<span style="width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#e8eeff;color:#1a73e8;">' +
        '<span class="material-symbols-outlined" style="font-size:22px">' + (opts.icon || 'bookmark_add') + '</span>' +
      '</span>' +
      '<span style="display:flex;flex-direction:column;gap:2px;min-width:0;">' +
        '<span style="font-size:16px;font-weight:600;color:#1a1a2e;">' + escapeHtml(opts.title || 'Nazwa') + '</span>' +
        (opts.subtitle ? '<span style="font-size:12.5px;font-weight:400;color:#98a2b3;">' + escapeHtml(opts.subtitle) + '</span>' : '') +
      '</span>' +
      '<button type="button" class="tp-modal-header-close" aria-label="Zamknij" style="color:#b0b8c9;">✕</button>';

    var body = d.createElement('div');
    body.className = 'tp-modal-body';
    body.style.background = '#fff';
    if (opts.label) {
      var lbl = d.createElement('div');
      lbl.textContent = opts.label;
      lbl.style.cssText = 'font-size:12.5px;color:#667085;font-weight:600;margin-bottom:8px;';
      body.appendChild(lbl);
    }
    var input = d.createElement('input');
    input.type = 'text';
    input.value = opts.value || '';
    input.placeholder = opts.placeholder || '';
    // !important — panel IdoSell agresywnie nadpisuje style inputów (m.in. border-radius:0)
    input.style.cssText = [
      'width:100% !important', 'box-sizing:border-box !important',
      'padding:10px 12px !important', 'margin:0 !important',
      'border:1px solid #d0d5dd !important', 'border-radius:8px !important',
      'background:#fff !important', 'font-size:14px !important',
      'color:#1a1a2e !important', 'font-family:inherit !important',
      'height:auto !important', 'outline:none !important', 'box-shadow:none !important',
      '-webkit-appearance:none !important', 'appearance:none !important',
      'transition:border-color .15s, box-shadow .15s'
    ].join(';') + ';';
    input.addEventListener('focus', function () {
      input.style.setProperty('border-color', '#1a73e8', 'important');
      input.style.setProperty('box-shadow', '0 0 0 3px rgba(26,115,232,.15)', 'important');
    });
    input.addEventListener('blur', function () {
      input.style.setProperty('border-color', '#d0d5dd', 'important');
      input.style.setProperty('box-shadow', 'none', 'important');
    });
    body.appendChild(input);

    var footer = d.createElement('div');
    footer.className = 'tp-modal-footer';
    var cancel = d.createElement('button');
    cancel.className = 'tp-btn-modal-secondary';
    cancel.type = 'button';
    cancel.textContent = opts.cancelLabel || 'Anuluj';
    var ok = d.createElement('button');
    ok.className = 'tp-btn-modal-primary';
    ok.type = 'button';
    ok.textContent = opts.okLabel || 'Utwórz';
    footer.appendChild(cancel);
    footer.appendChild(ok);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    d.body.appendChild(overlay);

    function close() {
      overlay.classList.add('tp-closing');
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 180);
    }
    function submit() {
      var val = input.value.trim();
      if (!val) { input.focus(); input.style.setProperty('border-color', '#d93025', 'important'); return; }
      close();
      if (opts.onOk) opts.onOk(val);
    }
    header.querySelector('.tp-modal-header-close').addEventListener('click', close);
    cancel.addEventListener('click', close);
    ok.addEventListener('click', submit);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    setTimeout(function () { input.focus(); input.select(); }, 30);
  }

  // v4.5.82: ładny modal potwierdzenia (zamiast natywnego confirm())
  function showConfirmModal(doc, opts) {
    opts = opts || {};
    var d = doc || document;
    var danger = opts.okVariant === 'danger';
    var overlay = d.createElement('div');
    overlay.className = 'tp-overlay';
    var modal = d.createElement('div');
    modal.className = 'tp-modal';
    modal.style.width = '440px';
    modal.style.maxWidth = 'calc(100vw - 32px)';

    var accent = danger ? { bg: '#fdecea', fg: '#d93025' } : { bg: '#e8eeff', fg: '#1a73e8' };
    var header = d.createElement('div');
    header.className = 'tp-modal-header';
    header.style.cssText = 'background:#fff;color:#202124;border-bottom:1px solid #eef0f4;';
    header.innerHTML =
      '<span style="width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:' + accent.bg + ';color:' + accent.fg + ';">' +
        '<span class="material-symbols-outlined" style="font-size:22px">' + (opts.icon || (danger ? 'delete' : 'sync')) + '</span>' +
      '</span>' +
      '<span style="display:flex;flex-direction:column;gap:2px;min-width:0;">' +
        '<span style="font-size:16px;font-weight:600;color:#1a1a2e;">' + escapeHtml(opts.title || 'Potwierdź') + '</span>' +
        (opts.subtitle ? '<span style="font-size:12.5px;font-weight:400;color:#98a2b3;">' + escapeHtml(opts.subtitle) + '</span>' : '') +
      '</span>' +
      '<button type="button" class="tp-modal-header-close" aria-label="Zamknij" style="color:#b0b8c9;">✕</button>';

    var body = d.createElement('div');
    body.className = 'tp-modal-body';
    body.style.background = '#fff';
    var msg = d.createElement('div');
    msg.style.cssText = 'font-size:13.5px;color:#344054;line-height:1.5;';
    if (opts.message || !opts.bodyEl) {
      msg.textContent = opts.message || 'Czy na pewno?';
      body.appendChild(msg);
    }
    if (opts.bodyEl) body.appendChild(opts.bodyEl);

    var footer = d.createElement('div');
    footer.className = 'tp-modal-footer';
    var cancel = d.createElement('button');
    cancel.className = 'tp-btn-modal-secondary';
    cancel.type = 'button';
    cancel.textContent = opts.cancelLabel || 'Anuluj';
    var ok = d.createElement('button');
    ok.className = danger ? 'tp-btn-modal-danger' : 'tp-btn-modal-primary';
    ok.type = 'button';
    ok.textContent = opts.okLabel || 'OK';
    footer.appendChild(cancel);
    footer.appendChild(ok);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    d.body.appendChild(overlay);

    function close() {
      overlay.classList.add('tp-closing');
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 180);
    }
    function confirmIt() { close(); if (opts.onOk) opts.onOk(); }
    header.querySelector('.tp-modal-header-close').addEventListener('click', close);
    cancel.addEventListener('click', close);
    ok.addEventListener('click', confirmIt);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    d.addEventListener('keydown', function onKey(e) {
      if (!overlay.parentNode) { d.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Enter') { e.preventDefault(); d.removeEventListener('keydown', onKey); confirmIt(); }
      else if (e.key === 'Escape') { e.preventDefault(); d.removeEventListener('keydown', onKey); close(); }
    });
    setTimeout(function () { ok.focus(); }, 30);
  }

  function applyViewFilter(doc, view) {
    var items = doc.querySelectorAll('li[id^="m_"]');
    if (!view) {
      for (var i = 0; i < items.length; i++) items[i].classList.remove('tp-row--view-hidden');
      _paginationState.currentPage = 1;
      applyPagination(doc);
      return;
    }
    var want = {};
    view.nodes.forEach(function (id) { want[String(id)] = true; });
    for (var k = 0; k < items.length; k++) {
      var li = items[k];
      var nid = getNodeId(li);
      if (want[String(nid)]) {
        var p = li.parentElement;
        while (p) {
          if (p.tagName === 'LI' && /^m_/.test(p.id)) want[String(getNodeId(p))] = true;
          p = p.parentElement;
        }
      }
    }
    for (var j = 0; j < items.length; j++) {
      var li2 = items[j];
      var id = getNodeId(li2);
      if (want[String(id)]) li2.classList.remove('tp-row--view-hidden');
      else li2.classList.add('tp-row--view-hidden');
    }
    // v4.5.78: widok zmienia zbiór widocznych — przelicz paginację od strony 1
    _paginationState.currentPage = 1;
    applyPagination(doc);
  }

  function rebuildViewsDropdown(doc) {
    if (!_panel) return;
    var triggers = _panel.toolbar.querySelectorAll('.panel-pro__dropdown__toggle');
    var widokDropdown = null;
    triggers.forEach(function (t) {
      var ico = t.querySelector('.material-symbols-outlined');
      if (ico && ico.textContent === 'visibility') widokDropdown = t.closest('.panel-pro__dropdown');
    });
    if (!widokDropdown) return;
    var menu = widokDropdown.querySelector('.panel-pro__dropdown__menu');
    var label = widokDropdown.querySelector('.panel-pro__dropdown__label');
    if (!menu) return;

    var views = loadSavedViews();
    var activeView = _activeViewId ? views.find(function (v) { return v.id === _activeViewId; }) : null;

    menu.innerHTML = '';

    var allItem = doc.createElement('div');
    allItem.className = 'panel-pro__dropdown__item' + (!activeView ? ' panel-pro--active' : '');
    allItem.innerHTML = '<span class="material-symbols-outlined">check</span>Wszystko';
    allItem.addEventListener('click', function (e) {
      e.stopPropagation();
      _activeViewId = null;
      applyViewFilter(doc, null);
      menu.classList.remove('panel-pro--open');
      rebuildViewsDropdown(doc);
    });
    menu.appendChild(allItem);

    if (views.length > 0) {
      var sep = doc.createElement('div');
      sep.style.cssText = 'height:1px;background:#e2e8f0;margin:4px 0;';
      menu.appendChild(sep);
      views.forEach(function (v) {
        var item = doc.createElement('div');
        var isActive = v.id === _activeViewId;
        item.className = 'panel-pro__dropdown__item' + (isActive ? ' panel-pro--active' : '');
        item.style.cssText = 'display:flex; align-items:center; gap:8px;';
        item.innerHTML =
          '<span class="material-symbols-outlined">' + (isActive ? 'check' : 'bookmark') + '</span>' +
          '<span style="flex:1">' + escapeHtml(v.name) + '</span>' +
          '<span style="background:#f1f5f9;color:#64748b;font-size:11px;padding:1px 6px;border-radius:10px;">' + v.nodes.length + '</span>' +
          '<button class="tp-view-update" data-view-id="' + v.id + '" title="Zaktualizuj widok aktualnie zaznaczonymi" style="width:22px;height:22px;padding:0;border:none;background:transparent;cursor:pointer;color:#1a73e8;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;"><span class="material-symbols-outlined" style="font-size:16px">sync</span></button>' +
          '<button class="tp-view-delete" data-view-id="' + v.id + '" title="Usu\u0144 widok" style="width:22px;height:22px;padding:0;border:none;background:transparent;cursor:pointer;color:#d93025;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>';
        item.addEventListener('click', function (e) {
          if (e.target.closest('.tp-view-delete') || e.target.closest('.tp-view-update')) return;
          e.stopPropagation();
          _activeViewId = v.id;
          applyViewFilter(doc, v);
          menu.classList.remove('panel-pro--open');
          rebuildViewsDropdown(doc);
        });
        var updBtn = item.querySelector('.tp-view-update');
        if (updBtn) updBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var sel = getCheckedTreeNodeIds(doc);
          if (!sel.length) { alert('Najpierw zaznacz parametry/warto\u015bci, kt\u00f3rymi chcesz nadpisa\u0107 widok'); return; }
          menu.classList.remove('panel-pro--open');
          showConfirmModal(doc, {
            icon: 'sync',
            title: 'Zaktualizowa\u0107 widok?',
            subtitle: '\u201e' + v.name + '\u201d',
            message: 'Zapisa\u0107 aktualnie zaznaczone (' + sel.length + ') jako now\u0105 zawarto\u015b\u0107 tego widoku? Poprzednia zawarto\u015b\u0107 zostanie nadpisana.',
            okLabel: 'Zaktualizuj',
            onOk: function () {
              var list = loadSavedViews();
              var t = list.find(function (x) { return x.id === v.id; });
              if (t) { t.nodes = sel; t.updated = Date.now(); storeSavedViews(list); }
              if (_activeViewId === v.id && t) applyViewFilter(doc, t);
              if (_panel) _panel.showStatus('Zaktualizowano widok "' + v.name + '" (' + sel.length + ')');
              rebuildViewsDropdown(doc);
            }
          });
        });
        var delBtn = item.querySelector('.tp-view-delete');
        if (delBtn) delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          menu.classList.remove('panel-pro--open');
          showConfirmModal(doc, {
            icon: 'delete',
            okVariant: 'danger',
            title: 'Usun\u0105\u0107 widok?',
            subtitle: '\u201e' + v.name + '\u201d',
            message: 'Widok zostanie trwale usuni\u0119ty. Tej operacji nie mo\u017cna cofn\u0105\u0107.',
            okLabel: 'Usu\u0144',
            onOk: function () {
              var list = loadSavedViews().filter(function (x) { return x.id !== v.id; });
              storeSavedViews(list);
              if (_activeViewId === v.id) { _activeViewId = null; applyViewFilter(doc, null); }
              rebuildViewsDropdown(doc);
            }
          });
        });
        menu.appendChild(item);
      });
    }

    var sep2 = doc.createElement('div');
    sep2.style.cssText = 'height:1px;background:#e2e8f0;margin:4px 0;';
    menu.appendChild(sep2);

    var saveItem = doc.createElement('div');
    var disabled = getCheckedTreeNodeIds(doc).length === 0;
    saveItem.className = 'panel-pro__dropdown__item';
    saveItem.style.cssText = disabled ? 'opacity:.45;cursor:not-allowed;' : '';
    saveItem.innerHTML = '<span class="material-symbols-outlined" style="opacity:1">bookmark_add</span>Zapisz zaznaczone jako widok\u2026';
    saveItem.addEventListener('click', function (e) {
      e.stopPropagation();
      // v4.5.80: licz zaznaczenie z DOM w momencie kliknięcia
      var snapshot = getCheckedTreeNodeIds(doc);
      if (!snapshot.length) { alert('Najpierw zaznacz parametry/wartości do zapisania w widoku'); return; }
      menu.classList.remove('panel-pro--open');
      showInputModal(doc, {
        icon: 'bookmark_add',
        title: 'Zapisz widok',
        subtitle: snapshot.length + ' zaznaczonych elementów',
        label: 'Nazwa widoku',
        placeholder: 'np. Parametry sezonowe',
        okLabel: 'Zapisz',
        onOk: function (name) {
          var list = loadSavedViews();
          var id = 'view_' + Date.now();
          list.push({ id: id, name: name, nodes: snapshot, created: Date.now() });
          storeSavedViews(list);
          if (_panel) _panel.showStatus('Zapisano widok "' + name + '"');
          rebuildViewsDropdown(doc);
        }
      });
    });
    menu.appendChild(saveItem);

    if (label) label.textContent = activeView ? activeView.name : 'Wszystko';
  }

  function applyViewMode(doc) { /* superseded by applyViewFilter (v4.5.18) */ }

  // v4.5.73: zapisane widoki dla SEKCJI (parytet z drzewem parametrów)
  var SECTION_VIEWS_KEY = 'tp.views.sections.v1';
  var _activeSectionViewId = null;

  function loadSavedSectionViews() {
    try { return JSON.parse(localStorage.getItem(SECTION_VIEWS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function storeSavedSectionViews(arr) {
    try { localStorage.setItem(SECTION_VIEWS_KEY, JSON.stringify(arr)); } catch (e) {}
  }

  function applySectionViewFilter(doc, view) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var items = _sectionsMount.listEl.querySelectorAll(':scope > li');
    if (!view) {
      items.forEach(function (li) { li.classList.remove('panel-pro--view-hidden'); });
      _secPagination.currentPage = 1;
      applySectionsPagination(doc);
      return;
    }
    var want = {};
    view.nodes.forEach(function (id) { want[String(id)] = true; });
    items.forEach(function (li) {
      if (want[String(li.dataset.sectionId)]) li.classList.remove('panel-pro--view-hidden');
      else li.classList.add('panel-pro--view-hidden');
    });
    _secPagination.currentPage = 1;
    applySectionsPagination(doc);
  }

  function reapplyActiveSectionView(doc) {
    if (!_activeSectionViewId) return;
    var v = loadSavedSectionViews().find(function (x) { return x.id === _activeSectionViewId; });
    if (v) applySectionViewFilter(doc, v);
    else { _activeSectionViewId = null; }
  }

  function rebuildSectionsViewsDropdown(doc) {
    if (!_sectionsMount || !_sectionsMount.panel || !_sectionsMount.panel.toolbar) return;
    var triggers = _sectionsMount.panel.toolbar.querySelectorAll('.panel-pro__dropdown__toggle');
    var dd = null;
    triggers.forEach(function (t) {
      var ico = t.querySelector('.material-symbols-outlined');
      if (ico && ico.textContent === 'visibility') dd = t.closest('.panel-pro__dropdown');
    });
    if (!dd) return;
    var menu = dd.querySelector('.panel-pro__dropdown__menu');
    var label = dd.querySelector('.panel-pro__dropdown__label');
    if (!menu) return;

    var views = loadSavedSectionViews();
    var activeView = _activeSectionViewId ? views.find(function (v) { return v.id === _activeSectionViewId; }) : null;

    menu.innerHTML = '';

    var allItem = doc.createElement('div');
    allItem.className = 'panel-pro__dropdown__item' + (!activeView ? ' panel-pro--active' : '');
    allItem.innerHTML = '<span class="material-symbols-outlined">check</span>Wszystko';
    allItem.addEventListener('click', function (e) {
      e.stopPropagation();
      _activeSectionViewId = null;
      applySectionViewFilter(doc, null);
      menu.classList.remove('panel-pro--open');
      rebuildSectionsViewsDropdown(doc);
    });
    menu.appendChild(allItem);

    if (views.length > 0) {
      var sep = doc.createElement('div');
      sep.style.cssText = 'height:1px;background:#e2e8f0;margin:4px 0;';
      menu.appendChild(sep);
      views.forEach(function (v) {
        var item = doc.createElement('div');
        var isActive = v.id === _activeSectionViewId;
        item.className = 'panel-pro__dropdown__item' + (isActive ? ' panel-pro--active' : '');
        item.style.cssText = 'display:flex; align-items:center; gap:8px;';
        item.innerHTML =
          '<span class="material-symbols-outlined">' + (isActive ? 'check' : 'bookmark') + '</span>' +
          '<span style="flex:1">' + escapeHtml(v.name) + '</span>' +
          '<span style="background:#f1f5f9;color:#64748b;font-size:11px;padding:1px 6px;border-radius:10px;">' + v.nodes.length + '</span>' +
          '<button class="tp-view-update" data-view-id="' + v.id + '" title="Zaktualizuj widok aktualnie zaznaczonymi" style="width:22px;height:22px;padding:0;border:none;background:transparent;cursor:pointer;color:#1a73e8;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;"><span class="material-symbols-outlined" style="font-size:16px">sync</span></button>' +
          '<button class="tp-view-delete" data-view-id="' + v.id + '" title="Usuń widok" style="width:22px;height:22px;padding:0;border:none;background:transparent;cursor:pointer;color:#d93025;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>';
        item.addEventListener('click', function (e) {
          if (e.target.closest('.tp-view-delete') || e.target.closest('.tp-view-update')) return;
          e.stopPropagation();
          _activeSectionViewId = v.id;
          applySectionViewFilter(doc, v);
          menu.classList.remove('panel-pro--open');
          rebuildSectionsViewsDropdown(doc);
        });
        var updBtn = item.querySelector('.tp-view-update');
        if (updBtn) updBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var sel = getSelectedSectionIds(doc);
          if (!sel.length) { alert('Najpierw zaznacz sekcje, którymi chcesz nadpisać widok'); return; }
          menu.classList.remove('panel-pro--open');
          showConfirmModal(doc, {
            icon: 'sync',
            title: 'Zaktualizować widok sekcji?',
            subtitle: '„' + v.name + '”',
            message: 'Zapisać aktualnie zaznaczone (' + sel.length + ') jako nową zawartość tego widoku? Poprzednia zawartość zostanie nadpisana.',
            okLabel: 'Zaktualizuj',
            onOk: function () {
              var list = loadSavedSectionViews();
              var t = list.find(function (x) { return x.id === v.id; });
              if (t) { t.nodes = sel.slice(); t.updated = Date.now(); storeSavedSectionViews(list); }
              if (_activeSectionViewId === v.id && t) applySectionViewFilter(doc, t);
              if (_panel) _panel.showStatus('Zaktualizowano widok sekcji "' + v.name + '" (' + sel.length + ')');
              rebuildSectionsViewsDropdown(doc);
            }
          });
        });
        var delBtn = item.querySelector('.tp-view-delete');
        if (delBtn) delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          menu.classList.remove('panel-pro--open');
          showConfirmModal(doc, {
            icon: 'delete',
            okVariant: 'danger',
            title: 'Usunąć widok sekcji?',
            subtitle: '„' + v.name + '”',
            message: 'Widok zostanie trwale usunięty. Tej operacji nie można cofnąć.',
            okLabel: 'Usuń',
            onOk: function () {
              var list = loadSavedSectionViews().filter(function (x) { return x.id !== v.id; });
              storeSavedSectionViews(list);
              if (_activeSectionViewId === v.id) { _activeSectionViewId = null; applySectionViewFilter(doc, null); }
              rebuildSectionsViewsDropdown(doc);
            }
          });
        });
        menu.appendChild(item);
      });
    }

    var sep2 = doc.createElement('div');
    sep2.style.cssText = 'height:1px;background:#e2e8f0;margin:4px 0;';
    menu.appendChild(sep2);

    var saveItem = doc.createElement('div');
    saveItem.className = 'panel-pro__dropdown__item';
    saveItem.innerHTML = '<span class="material-symbols-outlined" style="opacity:1">bookmark_add</span>Zapisz zaznaczone jako widok…';
    saveItem.addEventListener('click', function (e) {
      e.stopPropagation();
      var selIds = getSelectedSectionIds(doc);
      if (!selIds.length) { alert('Najpierw zaznacz sekcje do zapisania w widoku'); return; }
      menu.classList.remove('panel-pro--open');
      var snapshot = selIds.slice();
      showInputModal(doc, {
        icon: 'bookmark_add',
        title: 'Zapisz widok sekcji',
        subtitle: snapshot.length + ' zaznaczonych sekcji',
        label: 'Nazwa widoku',
        placeholder: 'np. Sekcje sezonowe',
        okLabel: 'Zapisz',
        onOk: function (name) {
          var list = loadSavedSectionViews();
          var id = 'secview_' + Date.now();
          list.push({ id: id, name: name, nodes: snapshot, created: Date.now() });
          storeSavedSectionViews(list);
          if (_panel) _panel.showStatus('Zapisano widok sekcji "' + name + '"');
          rebuildSectionsViewsDropdown(doc);
        }
      });
    });
    menu.appendChild(saveItem);

    if (label) label.textContent = activeView ? activeView.name : 'Wszystko';
  }

  function buildToolbar(doc) {
    const existing = doc.querySelector('.tp-toolbar');
    if (existing) existing.remove();

    const toolbar = doc.createElement('div');
    toolbar.className = 'tp-toolbar';
    toolbar.innerHTML =
      // Search
      '<div class="tp-toolbar__group">' +
        '<div class="tp-search-box">' +
          '<span class="material-symbols-outlined">search</span>' +
          '<input type="text" id="tp-search" placeholder="Szukaj w drzewie..." class="tp-search-input" autocomplete="off">' +
        '</div>' +
      '</div>' +
      '<div class="tp-toolbar__spacer"></div>' +
      // ZAZNACZANIE
      '<div class="tp-toolbar__group">' +
        '<span class="tp-toolbar__label">Zaznaczanie:</span>' +
        '<button class="tp-btn tp-btn--text" data-action="select-all" data-tooltip="Zaznacz wszystkie widoczne">' +
          '<span class="material-symbols-outlined">select_all</span> Zaznacz' +
        '</button>' +
        '<button class="tp-btn tp-btn--text" data-action="deselect-all" data-tooltip="Odznacz wszystko">' +
          '<span class="material-symbols-outlined">deselect</span> Odznacz' +
        '</button>' +
        '<button class="tp-btn tp-btn--text" data-action="invert-selection" data-tooltip="Odwr\u00f3\u0107 zaznaczenie">' +
          '<span class="material-symbols-outlined">swap_horiz</span> Odwr\u00f3\u0107' +
        '</button>' +
      '</div>' +
      '<div class="tp-toolbar__separator"></div>' +
      // TRANSFER (Eksport/Import)
      '<div class="tp-toolbar__group">' +
        '<span class="tp-toolbar__label">Transfer:</span>' +
        '<button class="tp-btn tp-btn--text" data-action="export-json" data-tooltip="Eksport drzewa do JSON">' +
          '<span class="material-symbols-outlined">download</span> Eksport' +
        '</button>' +
        '<button class="tp-btn tp-btn--text" data-action="import-json" data-tooltip="Import drzewa z JSON">' +
          '<span class="material-symbols-outlined">upload</span> Import' +
        '</button>' +
      '</div>' +
      '<div class="tp-toolbar__separator"></div>' +
      // WIDOK
      '<div class="tp-toolbar__group">' +
        '<span class="tp-toolbar__label">Widok:</span>' +
        '<div class="tp-view-dropdown">' +
          '<button class="tp-view-dropdown__toggle" data-action="view-toggle">' +
            '<span class="material-symbols-outlined">visibility</span>' +
            '<span class="tp-view-dropdown__label">Wszystko</span>' +
            '<span class="material-symbols-outlined">expand_more</span>' +
          '</button>' +
          '<div class="tp-view-dropdown__menu">' +
            '<div class="tp-view-dropdown__item tp-active" data-view="all"><span class="material-symbols-outlined">check</span>Wszystko</div>' +
            '<div class="tp-view-dropdown__item" data-view="params"><span class="material-symbols-outlined">check</span>Tylko parametry</div>' +
            '<div class="tp-view-dropdown__item" data-view="values"><span class="material-symbols-outlined">check</span>Tylko warto\u015bci</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tp-toolbar__separator"></div>' +
      // DRZEWO
      '<div class="tp-toolbar__group">' +
        '<span class="tp-toolbar__label">Drzewo:</span>' +
        '<button class="tp-btn tp-btn--icon" data-action="expand-all" data-tooltip="Rozwi\u0144 wszystko">' +
          '<span class="material-symbols-outlined">unfold_more</span>' +
        '</button>' +
        '<button class="tp-btn tp-btn--icon" data-action="collapse-all" data-tooltip="Zwi\u0144 wszystko">' +
          '<span class="material-symbols-outlined">unfold_less</span>' +
        '</button>' +
        '<button class="tp-btn tp-btn--icon tp-btn--danger" data-action="stop-expand" data-tooltip="Przerwij" style="display:none">' +
          '<span class="material-symbols-outlined">stop</span>' +
        '</button>' +
        '<button class="tp-btn tp-btn--icon" data-action="sort-alpha" data-tooltip="Sortuj alfabetycznie">' +
          '<span class="material-symbols-outlined">sort_by_alpha</span>' +
        '</button>' +
      '</div>' +
      // EDYCJA GRUPOWA (bulk ops) on new row
      '<div class="tp-toolbar__break"></div>' +
      '<div class="tp-toolbar__group tp-toolbar__group--bulk">' +
        '<span class="tp-toolbar__label">Edycja grupowa:</span>' +
        '<button class="tp-btn tp-btn--primary" data-action="bulk-edit" data-tooltip="Grupowa edycja zaznaczonych">' +
          '<span class="material-symbols-outlined">edit</span> Edytuj' +
        '</button>' +
        '<button class="tp-btn tp-btn--move" data-action="bulk-move" data-tooltip="Przenie\u015b zaznaczone wartosci do innego parametru">' +
          '<span class="material-symbols-outlined">drive_file_move</span> Przenie\u015b' +
        '</button>' +
        '<button class="tp-btn tp-btn--danger" data-action="bulk-delete" data-tooltip="Usu\u0144 zaznaczone">' +
          '<span class="material-symbols-outlined">delete</span> Usu\u0144' +
        '</button>' +
      '</div>';

    // Event delegation
    toolbar.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      switch (action) {
        case 'expand-all':
          var stopBtn = toolbar.querySelector('[data-action="stop-expand"]');
          if (stopBtn) stopBtn.style.display = '';
          expandAll(doc).then(function() { if (stopBtn) stopBtn.style.display = 'none'; });
          break;
        case 'collapse-all':
          collapseAll(doc);
          break;
        case 'stop-expand':
          stopExpand();
          btn.style.display = 'none';
          break;
        case 'sort-alpha':
          sortAlphabetically(doc);
          break;
        case 'select-all':
          selectAll(doc);
          break;
        case 'deselect-all':
          deselectAll(doc);
          break;
        case 'invert-selection':
          invertSelection(doc);
          break;
        case 'bulk-edit':
          if (selectedNodes.size === 0) { alert('Najpierw zaznacz elementy!'); return; }
          showBulkEditModal(doc);
          break;
        case 'bulk-move':
          if (selectedNodes.size === 0) { alert('Najpierw zaznacz elementy!'); return; }
          showBulkMoveModal(doc);
          break;
        case 'bulk-delete':
          if (selectedNodes.size === 0) { alert('Najpierw zaznacz elementy!'); return; }
          showBulkDeleteModal(doc);
          break;
        case 'export-json':
          exportTreeAsJson(doc);
          break;
        case 'import-json':
          alert('Import JSON \u2014 funkcja w przygotowaniu.\n\nU\u017cyj dedykowanego skryptu "IdoSell - Szablony Parametr\u00f3w" do import/export szablon\u00f3w.');
          break;
        case 'view-toggle':
          var menu = toolbar.querySelector('.tp-view-dropdown__menu');
          if (menu) menu.classList.toggle('tp-open');
          break;
      }
    });

    // View dropdown: item select
    toolbar.querySelectorAll('.tp-view-dropdown__item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        var view = item.dataset.view;
        _viewMode = view;
        // Update label
        var labelEl = toolbar.querySelector('.tp-view-dropdown__label');
        if (labelEl) labelEl.textContent = item.textContent.trim();
        // Update active state
        toolbar.querySelectorAll('.tp-view-dropdown__item').forEach(function(i) { i.classList.remove('tp-active'); });
        item.classList.add('tp-active');
        // Close menu
        var menu = toolbar.querySelector('.tp-view-dropdown__menu');
        if (menu) menu.classList.remove('tp-open');
        // Apply filter
        applyViewMode(doc);
      });
    });

    // Close dropdown on outside click
    doc.addEventListener('click', function(e) {
      if (!e.target.closest('.tp-view-dropdown')) {
        var menu = toolbar.querySelector('.tp-view-dropdown__menu');
        if (menu) menu.classList.remove('tp-open');
      }
    });

    // Search input
    var searchInput = toolbar.querySelector('#tp-search');
    if (searchInput) {
      searchInput.addEventListener('input', function() { filterTree(doc, searchInput.value); });
    }

    // Insert after page header or h1
    var pageHeader = doc.querySelector('.tp-page-header');
    var insertAfter = pageHeader || doc.querySelector('h1');
    if (insertAfter) {
      insertAfter.parentNode.insertBefore(toolbar, insertAfter.nextSibling);
    } else {
      doc.body.insertBefore(toolbar, doc.body.firstChild);
    }
  }

  // =========================================================================
  // OBSERVE DOM FOR NEW NODES (from expand)
  // =========================================================================

  function observeNewNodes(doc) {
    var pendingNodes = [];
    var pendingParents = [];
    var rafScheduled = false;

    function processPending() {
      rafScheduled = false;
      var nodes = pendingNodes.splice(0);
      var parents = pendingParents.splice(0);
      for (var i = 0; i < nodes.length; i++) {
        enhanceRow(nodes[i], doc);
      }
      for (var i = 0; i < parents.length; i++) {
        updateExpandIcon(parents[i], doc);
      }
      // Update product counts for newly loaded values
      if (nodes.length > 0) {
        updateProductCounts(doc);
        // v4.5.49: wczytaj konteksty dla świeżo dodanych wartości
        try { loadContextsInBackground(doc, nodes); } catch (e) {}
        // Refresh priority cells for affected parents (children may have been added)
        var seenParents = new Set();
        for (var p = 0; p < nodes.length; p++) {
          var pul = nodes[p].parentNode;
          if (pul && pul.id && /^block_group/.test(pul.id) && !seenParents.has(pul.id)) {
            seenParents.add(pul.id);
            refreshSiblingPriorityCells(pul);
          }
        }
        updateCounter(doc);
        // Disable native drag-merge to prevent accidental value merging
        setTimeout(function() { disableNativeDraggable(doc); }, 300);
      }
    }

    function scheduleProcess() {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(processPending);
      }
    }

    const observer = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        for (var j = 0; j < mutation.addedNodes.length; j++) {
          var node = mutation.addedNodes[j];
          if (node.nodeType !== 1) continue;
          if (node.id && node.id.startsWith('m_')) {
            pendingNodes.push(node);
          }
          var items = node.querySelectorAll ? node.querySelectorAll('li[id^="m_"]') : [];
          for (var k = 0; k < items.length; k++) {
            pendingNodes.push(items[k]);
          }
          if (node.id && node.id.startsWith('block_group')) {
            var parentLi = node.closest('li[id^="m_"]');
            if (parentLi) pendingParents.push(parentLi);
          }
        }
      }
      if (pendingNodes.length > 0 || pendingParents.length > 0) scheduleProcess();
    });

    observer.observe(doc.body, { childList: true, subtree: true });
  }

  // =========================================================================
  // INIT
  // =========================================================================

  // v4.5.22: Sections panel — mounted below the main parameters list
  var _sectionsMount = null;
  var _sectionsSearch = '';
  function mountSectionsPanel(doc) {
    if (typeof PanelPro === 'undefined') return;
    // Remove old mount if any (e.g. re-render)
    var existing = doc.getElementById('tp-sections-mount');
    if (existing) existing.remove();
    var mount = doc.createElement('div');
    mount.id = 'tp-sections-mount';
    mount.style.cssText = 'margin: 24px 0 0 0;';

    // Header "Sekcje" — matches the main "Parametry" header style
    // v4.5.70: duplikujemy przełącznik języka pod nagłówkiem Sekcji
    var header = doc.createElement('div');
    header.className = 'tp-page-header';
    header.style.cssText = 'margin: 24px 0 12px 0;';
    header.innerHTML =
      '<div class="tp-page-header__top">' +
        '<h1 class="tp-page-header__title">Sekcje</h1>' +
      '</div>' +
      '<div class="tp-page-header__meta">' +
        buildLangSwitcherHtml(doc, 'tp-lang-dropdown-sec') +
      '</div>';
    mount.appendChild(header);

    // Inner panel target (so mount contains header + panel card)
    var cardTarget = doc.createElement('div');
    mount.appendChild(cardTarget);

    var mainMount = doc.querySelector('#product_parameters_container');
    if (!mainMount) return;
    mainMount.parentNode.insertBefore(mount, mainMount.nextSibling);

    var sectionsPanel = PanelPro.mount(doc, {
      mountTarget: cardTarget,
      opsBar: {
        right: { label: 'Operacje na sekcjach', buttons: [
          { icon: 'sort_by_alpha', label: 'Sortuj alfabetycznie', variant: 'text',    onClick: function () { refreshSectionsPanel(doc); } },
          { icon: 'tag',           label: 'Sortuj po ID',        tooltip: 'Sortuj wg ID (rosn\u0105co / malej\u0105co)', variant: 'text', onClick: function () { sortSectionsById(doc); } },
          { icon: 'add',           label: 'Dodaj sekcj\u0119',    variant: 'primary', onClick: function () { createNewSection(doc); } }
        ] }
      },
      toolbar: {
        search: {
          placeholder: 'Szukaj sekcji po nazwie lub id',
          onChange: function (q) { _sectionsSearch = (q || '').toLowerCase(); filterSectionsList(doc); }
        },
        sections: [
          { buttons: [
            { icon: 'select_all', tooltip: 'Zaznacz wszystkie widoczne', variant: 'icon', onClick: function () { toggleAllSections(doc, true); } },
            { icon: 'deselect',   tooltip: 'Odznacz wszystko',           variant: 'icon', onClick: function () { toggleAllSections(doc, false); } },
            { icon: 'swap_horiz', tooltip: 'Odwr\u00f3\u0107 zaznaczenie', variant: 'icon', onClick: function () { invertSectionsSelection(doc); } }
          ] },
          { buttons: [
            { icon: 'download', label: 'Eksport', tooltip: 'Eksport sekcji — wybór zakresu, formatu i języków', variant: 'text', onClick: function () { showExportModal(doc, 'all', 'sections'); } },
            { icon: 'upload',   label: 'Import',  tooltip: 'Import sekcji z pliku JSON lub CSV', variant: 'text', onClick: function () { openSectionsImportPicker(doc); } }
          ] },
          { dropdown: {
            icon: 'visibility',
            options: [ { value: 'all', label: 'Wszystko', active: true } ],
            onChange: function () { /* obsługa w rebuildSectionsViewsDropdown */ }
          } },
          { columnsMenu: true }
        ]
      },
      columnsMenu: {
        key: 'tp.cols.sekcje',
        toggleable: ['id', 'products'],
        tooltip: 'Poka\u017c / ukryj kolumny'
      },
      columns: [
        { id: 'drag',     label: '',             width: '24px' },
        { id: 'check',    label: '',             width: '40px' },
        { id: 'expand',   label: '',             width: '32px' },
        { id: 'name',     label: 'Nazwa', hint: '(Dwuklik na nazwę = edycja)', width: '1fr' },
        { id: 'id',       label: 'ID',           width: '80px' },
        { id: 'products', label: 'Produktów', width: '110px' },
        { id: 'actions',  label: 'Akcje',        width: '160px' }
      ],
      selectionBar: {
        selectedLabel: 'Liczba wybranych elementów {n}',
        actions: [
          { icon: 'delete', label: 'Usu\u0144', tooltip: 'Usu\u0144 zaznaczone sekcje', variant: 'danger', onClick: function () { bulkDeleteSelectedSections(doc); } }
        ],
        extraActions: [
          { icon: 'download', label: 'Eksport', tooltip: 'Eksport zaznaczonych sekcji (format / języki / produkty)', onClick: function () { showExportModal(doc, 'selected', 'sections'); } }
        ],
        onClear: function () { toggleAllSections(doc, false); }
      },
      pagination: { perPage: loadPerPagePref('Sec') },
      footer: {
        version: 'v4.6.27',
        links: []
      }
    });

    // v4.5.70: nagłówek "Sekcje" + przełącznik języka w jednej linii z belką operacji na sekcjach
    relocateHeaderIntoOpsBar(sectionsPanel, header);
    wireLangDropdown(doc, header, 'tp-lang-dropdown-sec');

    // Select-all checkbox in the header
    var hCheck = sectionsPanel.tableHeader.querySelector('.panel-pro__col--check');
    if (hCheck) {
      hCheck.innerHTML = '';
      var hcb = doc.createElement('input');
      hcb.type = 'checkbox';
      hcb.className = 'tp-checkbox';
      hcb.title = 'Zaznacz/Odznacz wszystko';
      hcb.addEventListener('change', function () { toggleAllSections(doc, hcb.checked); });
      hCheck.appendChild(hcb);
    }

    // Render section rows — initially empty, fill after async fetch
    var ul = doc.createElement('ul');
    ul.style.cssText = 'list-style:none; margin:0; padding:0;';
    sectionsPanel.body.appendChild(ul);
    sectionsPanel.setCounter('Wszystkich sekcji: <span class="panel-pro__counter--total">\u2026</span>');
    _sectionsMount = { mount: mount, panel: sectionsPanel, listEl: ul, totalCount: 0 };
    rebuildSectionsViewsDropdown(doc);

    getAllSections(doc).then(function (sections) {
      renderSectionRows(doc, sectionsPanel, ul, sections);
      _sectionsMount.totalCount = sections.length;
      reapplyActiveSectionView(doc);
      _secPagination.currentPage = 1;
      applySectionsPagination(doc);
      loadSectionsProductCountsInBackground(doc, sections);
    }).catch(function (e) {
      sectionsPanel.setCounter('Wszystkich sekcji: <span class="panel-pro__counter--total">b\u0142\u0105d</span>');
      console.error('[parametry] sections load failed:', e);
    });
  }

  // v4.5.73: inline edycja nazwy sekcji z poziomu listy (jak w drzewie parametrów — bez prompt())
  function startSectionInlineRename(doc, li, sec) {
    var span = li.querySelector('.tp-sec-name');
    if (!span) return;
    startInlineRename(doc, li, null, span, sec.id, function (id, newName) {
      return fetchAjax('action=setSettings&id=' + encodeURIComponent(id) + '&menuSection=true&names[' + LANG + ']=' + encodeURIComponent(newName))
        .then(function (resp) {
          if (resp && resp.errno && resp.errno !== 0) throw new Error(resp.message || ('errno ' + resp.errno));
          sec.name = newName;
          li.dataset.sectionName = newName.toLowerCase();
        });
    });
  }

  function renderSectionRows(doc, sectionsPanel, ul, sections) {
    ul.innerHTML = '';
    sections.forEach(function (sec) {
      var li = doc.createElement('li');
      sectionsPanel.applyRowGrid(li);
      li.dataset.sectionId = sec.id;
      li.dataset.sectionName = (sec.name || '').toLowerCase();

      li.innerHTML =
        '<div></div>' +
        '<div style="display:flex;align-items:center;justify-content:center"><input type="checkbox" class="tp-checkbox" data-section-id="' + sec.id + '"></div>' +
        '<div style="display:flex;align-items:center;justify-content:center"><span class="material-symbols-outlined" style="color:#1d4ed8;font-size:22px" title="Sekcja">folder_special</span></div>' +
        '<div style="display:flex;align-items:center;gap:6px"><span class="tp-sec-name" style="font-weight:500;font-size:15px;cursor:pointer" title="Dwuklik = zmiana nazwy">' + escapeHtml(sec.name) + '</span></div>' +
        '<div class="tp-sec-id tp-copyable" title="Kliknij aby skopiować" style="text-align:center;font-family:Roboto Mono,monospace;font-size:12px;color:#5f6368">' + sec.id + '</div>' +
        '<div class="tp-sec-products" data-section-id="' + sec.id + '" style="text-align:center;color:#5f6368">…</div>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:6px">' +
          '<span class="material-symbols-outlined" data-act="products" title="Poka\u017c produkty u\u017cywaj\u0105ce sekcji" style="cursor:pointer;color:#5f6368;font-size:20px">inventory_2</span>' +
          '<span class="material-symbols-outlined" data-act="rename" title="Zmie\u0144 nazw\u0119" style="cursor:pointer;color:#5f6368;font-size:20px">edit</span>' +
          '<span class="material-symbols-outlined" data-act="delete" title="Usu\u0144 sekcj\u0119" style="cursor:pointer;color:#dc2626;font-size:20px">delete</span>' +
        '</div>';

      // v4.5.75: kopiowanie ID sekcji (jak w kolumnie ID parametrów)
      var idCell = li.querySelector('.tp-sec-id');
      if (idCell) idCell.addEventListener('click', function (e) {
        e.stopPropagation();
        var val = String(sec.id);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(val);
        } else {
          var ta = doc.createElement('textarea');
          ta.value = val;
          ta.style.cssText = 'position:fixed;left:-9999px;';
          doc.body.appendChild(ta);
          ta.select();
          doc.execCommand('copy');
          ta.remove();
        }
        idCell.style.background = '#c8e6c9';
        setTimeout(function () { idCell.style.background = ''; }, 600);
      });

      // v4.5.37: checkbox drives row highlight (same classes parameters use)
      var rowCb = li.querySelector('input.tp-checkbox');
      if (rowCb) {
        rowCb.addEventListener('click', function (e) { e.stopPropagation(); });
        rowCb.addEventListener('change', function () {
          li.classList.toggle('tp-row--selected', rowCb.checked);
          li.classList.toggle('panel-pro--selected', rowCb.checked);
          updateSectionsSelection();
        });
      }

      li.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var act = btn.dataset.act;
          if (act === 'products') {
            showSectionProductsModal(doc, sec);
          } else if (act === 'rename') {
            startSectionInlineRename(doc, li, sec);
          } else if (act === 'delete') {
            if (!confirm('Usun\u0105\u0107 sekcj\u0119 "' + sec.name + '"? Je\u015bli jest przypisana do produkt\u00f3w, skrypt odepnie j\u0105 najpierw.')) return;
            forceDeleteNode(doc, sec.id, '0', sec.name, false, function (msg) { if (_panel) _panel.showStatus(msg); })
              .then(function (ok) { if (ok) refreshSectionsPanel(doc); })
              .catch(function (e) { alert('B\u0142\u0105d usuwania sekcji: ' + (e.message || e)); });
          }
        });
      });

      var nameSpan = li.querySelector('.tp-sec-name');
      if (nameSpan) nameSpan.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        e.preventDefault();
        startSectionInlineRename(doc, li, sec);
      });

      ul.appendChild(li);
    });
    filterSectionsList(doc);
  }

  function filterSectionsList(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var q = _sectionsSearch || '';
    var items = _sectionsMount.listEl.querySelectorAll(':scope > li');
    items.forEach(function (li) {
      var name = li.dataset.sectionName || '';
      var id = li.dataset.sectionId || '';
      var match = !q || name.indexOf(q) !== -1 || id.indexOf(q) !== -1;
      li.classList.toggle('panel-pro--filter-hidden', !match);
    });
    // v4.5.94: po filtrze przelicz paginację od strony 1
    _secPagination.currentPage = 1;
    applySectionsPagination(doc);
  }

  function _setSectionRowSelected(li, on) {
    li.classList.toggle('tp-row--selected', !!on);
    li.classList.toggle('panel-pro--selected', !!on);
  }

  function toggleAllSections(doc, on) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var items = _sectionsMount.listEl.querySelectorAll(':scope > li');
    items.forEach(function (li) {
      if (li.classList.contains('panel-pro--filter-hidden') ||
          li.classList.contains('panel-pro--view-hidden') ||
          li.classList.contains('panel-pro--page-hidden')) return;
      var cb = li.querySelector('input.tp-checkbox');
      if (cb) { cb.checked = !!on; _setSectionRowSelected(li, on); }
    });
    updateSectionsSelection();
  }

  function invertSectionsSelection(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var items = _sectionsMount.listEl.querySelectorAll(':scope > li');
    items.forEach(function (li) {
      if (li.classList.contains('panel-pro--filter-hidden') ||
          li.classList.contains('panel-pro--view-hidden') ||
          li.classList.contains('panel-pro--page-hidden')) return;
      var cb = li.querySelector('input.tp-checkbox');
      if (cb) { cb.checked = !cb.checked; _setSectionRowSelected(li, cb.checked); }
    });
    updateSectionsSelection();
  }

  function updateSectionsSelection() {
    if (!_sectionsMount || !_sectionsMount.listEl || !_sectionsMount.panel) return;
    var n = _sectionsMount.listEl.querySelectorAll(':scope > li input.tp-checkbox:checked').length;
    _sectionsMount.panel.setSelection(n);
    updateSectionsCounter();
  }

  // v4.5.93: footer sekcji = Wszystkich sekcji: X [| Zaznaczone: Y]
  function updateSectionsCounter() {
    if (!_sectionsMount || !_sectionsMount.panel) return;
    var total = _sectionsMount.totalCount || 0;
    var sel = _sectionsMount.listEl
      ? _sectionsMount.listEl.querySelectorAll(':scope > li input.tp-checkbox:checked').length : 0;
    var h = 'Wszystkich sekcji: <span class="panel-pro__counter--total">' + total + '</span>';
    if (sel > 0) h += '<span class="panel-pro__sep">|</span>Zaznaczone: <span class="panel-pro__counter--selected">' + sel + '</span>';
    _sectionsMount.panel.setCounter(h);
  }

  // v4.5.94: paginacja listy sekcji (analogiczna do drzewa parametrów)
  var _secPagination = { currentPage: 1, perPage: loadPerPagePref('Sec') };

  function _sectionVisiblePool() {
    if (!_sectionsMount || !_sectionsMount.listEl) return [];
    return Array.prototype.slice.call(_sectionsMount.listEl.querySelectorAll(':scope > li')).filter(function (li) {
      return !li.classList.contains('panel-pro--filter-hidden') && !li.classList.contains('panel-pro--view-hidden');
    });
  }

  function applySectionsPagination(doc) {
    if (!_sectionsMount || !_sectionsMount.panel) return;
    var pool = _sectionVisiblePool();
    var pp = _secPagination.perPage;
    var total = pool.length;
    var totalPages = pp === 0 ? 1 : Math.max(1, Math.ceil(total / pp));
    if (_secPagination.currentPage > totalPages) _secPagination.currentPage = totalPages;
    if (_secPagination.currentPage < 1) _secPagination.currentPage = 1;
    var start = pp === 0 ? 0 : (_secPagination.currentPage - 1) * pp;
    var end = pp === 0 ? total : start + pp;
    pool.forEach(function (li, idx) {
      if (idx >= start && idx < end) li.classList.remove('panel-pro--page-hidden');
      else li.classList.add('panel-pro--page-hidden');
    });
    // li poza pulą (filter/view-hidden) — zdejmij page-hidden (i tak ukryte inną klasą)
    Array.prototype.slice.call(_sectionsMount.listEl.querySelectorAll(':scope > li.panel-pro--page-hidden')).forEach(function (li) {
      if (li.classList.contains('panel-pro--filter-hidden') || li.classList.contains('panel-pro--view-hidden')) li.classList.remove('panel-pro--page-hidden');
    });
    if (_sectionsMount.panel.renderPagination) {
      _sectionsMount.panel.renderPagination(
        { page: _secPagination.currentPage, perPage: pp, total: total },
        {
          perPageOptions: [10, 25, 50, 100, 200, 0],
          onPageChange: function (p) { _secPagination.currentPage = p; applySectionsPagination(doc); },
          onPerPageChange: function (n) { _secPagination.perPage = n; _secPagination.currentPage = 1; savePerPagePref(n, 'Sec'); applySectionsPagination(doc); }
        }
      );
    }
    updateSectionsCounter();
  }

  async function bulkDeleteSelectedSections(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var items = Array.from(_sectionsMount.listEl.querySelectorAll(':scope > li'));
    var selected = items.filter(function (li) {
      var cb = li.querySelector('input.tp-checkbox');
      return cb && cb.checked;
    }).map(function (li) {
      return { id: li.dataset.sectionId, name: (li.querySelector('.tp-sec-name') || {}).textContent || '' };
    });
    if (selected.length === 0) return;
    if (!confirm('Usunąć ' + selected.length + ' sekcji? Jeśli któraś jest przypisana do produktów, skrypt odepnie ją najpierw.')) return;
    var ok = 0, fail = 0;
    for (var i = 0; i < selected.length; i++) {
      var sec = selected[i];
      try {
        var r = await forceDeleteNode(doc, sec.id, '0', sec.name, true, function (msg) { if (_panel) _panel.showStatus(msg); });
        if (r) ok++; else fail++;
      } catch (e) { fail++; }
    }
    if (_panel) _panel.showStatus('Usunięto ' + ok + ' sekcji' + (fail ? ' (' + fail + ' błędów)' : ''));
    refreshSectionsPanel(doc);
  }

  // v4.5.32: export sections (selected or all visible) to JSON/CSV
  function collectSectionsForExport(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return [];
    var items = Array.from(_sectionsMount.listEl.querySelectorAll(':scope > li'));
    var visible = items.filter(function (li) { return !li.classList.contains('panel-pro--filter-hidden'); });
    var selected = visible.filter(function (li) {
      var cb = li.querySelector('input.tp-checkbox');
      return cb && cb.checked;
    });
    var pool = selected.length > 0 ? selected : visible;
    return pool.map(function (li) {
      return { id: li.dataset.sectionId, name: (li.querySelector('.tp-sec-name') || {}).textContent || '' };
    });
  }

  function exportSections(doc, format) {
    var rows = collectSectionsForExport(doc);
    if (rows.length === 0) { alert('Brak sekcji do eksportu.'); return; }
    var filename, content, mime;
    var stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      var lines = ['id;name'];
      rows.forEach(function (r) {
        var n = String(r.name || '').replace(/"/g, '""');
        if (n.indexOf(';') !== -1 || n.indexOf('"') !== -1 || n.indexOf('\n') !== -1) n = '"' + n + '"';
        lines.push(r.id + ';' + n);
      });
      content = '\uFEFF' + lines.join('\r\n');
      filename = 'sekcje_' + stamp + '.csv';
      mime = 'text/csv;charset=utf-8';
    } else {
      content = JSON.stringify({ exportedAt: new Date().toISOString(), lang: LANG, sections: rows }, null, 2);
      filename = 'sekcje_' + stamp + '.json';
      mime = 'application/json;charset=utf-8';
    }
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url; a.download = filename;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (_panel) _panel.showStatus('Wyeksportowano ' + rows.length + ' sekcji (' + format.toUpperCase() + ')');
  }

  function openSectionsImportPicker(doc) {
    var inp = doc.createElement('input');
    inp.type = 'file'; inp.accept = '.json,.csv,application/json,text/csv';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        var names = [];
        try {
          if (f.name.toLowerCase().endsWith('.csv')) {
            var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
            if (lines.length > 1) {
              var header = lines[0].toLowerCase();
              var sep = header.indexOf(';') !== -1 ? ';' : ',';
              var nameIdx = header.split(sep).indexOf('name');
              if (nameIdx < 0) nameIdx = 1;
              for (var i = 1; i < lines.length; i++) {
                var parts = lines[i].split(sep);
                var n = (parts[nameIdx] || '').replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim();
                if (n) names.push(n);
              }
            }
          } else {
            var parsed = JSON.parse(text);
            var arr = Array.isArray(parsed) ? parsed : (parsed && parsed.sections ? parsed.sections : []);
            names = arr.map(function (s) { return typeof s === 'string' ? s : String(s.name || '').trim(); }).filter(Boolean);
          }
        } catch (e) { alert('B\u0142\u0105d parsowania pliku: ' + e.message); return; }
        if (!names.length) { alert('Plik nie zawiera nazw sekcji.'); return; }
        if (!confirm('Zaimportowa\u0107 ' + names.length + ' sekcji? Brakuj\u0105ce zostan\u0105 utworzone, istniej\u0105ce (po nazwie) b\u0119d\u0105 pomini\u0119te.')) return;
        importSectionsByName(doc, names);
      };
      reader.readAsText(f, 'utf-8');
    });
    inp.click();
  }

  async function importSectionsByName(doc, names) {
    var existing = await getAllSections(doc);
    var existSet = {};
    existing.forEach(function (s) { existSet[s.name.toLowerCase()] = true; });
    var toCreate = names.filter(function (n) { return !existSet[n.toLowerCase()]; });
    var created = 0, failed = 0;
    for (var i = 0; i < toCreate.length; i++) {
      var name = toCreate[i];
      try {
        var r = await fetchAjax('action=checkEl&type=section&lang=' + LANG + '&name=' + encodeURIComponent(name));
        if (r && r.error) { failed++; } else { created++; }
      } catch (e) { failed++; }
    }
    var msg = 'Import sekcji: utworzono ' + created + ', pomini\u0119to ' + (names.length - toCreate.length) + (failed ? ', b\u0142\u0119d\u00f3w ' + failed : '');
    if (_panel) _panel.showStatus(msg);
    refreshSectionsPanel(doc);
  }

  function refreshSectionsPanel(doc) {
    mountSectionsPanel(doc);
  }

  // v4.5.84: globalny pasek footer na samym dole strony
  function mountGlobalFooter(doc) {
    var ex = doc.getElementById('tp-global-footer');
    if (ex) ex.remove();
    var f = doc.createElement('div');
    f.id = 'tp-global-footer';
    f.className = 'tp-global-footer';

    var links = doc.createElement('div');
    links.className = 'tp-global-footer__links';
    function mk(label, icon, variant, href) {
      var a = doc.createElement('a');
      a.className = 'tp-global-footer__link tp-global-footer__link--' + variant;
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = label;
      a.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span><span>' + label + '</span>';
      return a;
    }
    links.appendChild(mk('Propozycja', 'star', 'feature', 'https://github.com/design4artPl/tampermonkey/issues/new?labels=enhancement'));
    links.appendChild(mk('Zgłoś błąd', 'bug_report', 'bug', 'https://github.com/design4artPl/tampermonkey/issues/new?labels=bug'));

    var brand = doc.createElement('div');
    brand.className = 'tp-global-footer__brand';
    brand.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 238 44" width="238" height="44" role="img" aria-label="Made by Panel Pro">' +
        '<defs><style>' +
          '@import url(\'https://fonts.googleapis.com/css2?family=Syne:wght@400;700\');' +
          '.tpfb-lbl{font-family:\'Syne\',sans-serif;font-size:9px;font-weight:400;fill:#aaaaaa;letter-spacing:2.34px;}' +
          '.tpfb-nm{font-family:\'Syne\',sans-serif;font-size:14px;font-weight:700;fill:#111111;letter-spacing:1.4px;}' +
        '</style></defs>' +
        '<text class="tpfb-lbl" x="16" y="22" dominant-baseline="middle">MADE BY</text>' +
        '<rect x="82.02" y="19" width="22" height="1.5" fill="#c0392b"/>' +
        '<rect x="82.02" y="23.5" width="13" height="1.5" fill="#dddddd"/>' +
        '<text class="tpfb-nm" x="116.02" y="22" dominant-baseline="middle">PANEL PRO</text>' +
      '</svg>';
    f.appendChild(links);
    f.appendChild(brand);
    doc.body.appendChild(f);
  }

  // v4.5.39: background loader for section product counts (numberOfOccurrence works on real panels)
  async function loadSectionsProductCountsInBackground(doc, sections) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var BATCH = 5;
    for (var i = 0; i < sections.length; i += BATCH) {
      var batch = sections.slice(i, i + BATCH);
      await Promise.all(batch.map(async function (sec) {
        try {
          var r = await fetchAjax('action=numberOfOccurrence&id=' + encodeURIComponent(sec.id));
          var count = (r && r.data && r.data.numberOfProduct) ? Number(r.data.numberOfProduct) : 0;
          var productsRaw = r && r.data && r.data.products ? r.data.products : null;
          var productIds = [];
          if (Array.isArray(productsRaw)) productIds = productsRaw.map(function (p) { return String(typeof p === 'object' ? (p.id || p.product_id) : p); });
          else if (productsRaw && typeof productsRaw === 'object') productIds = Object.values(productsRaw).map(function (p) { return String(typeof p === 'object' ? (p.id || p.product_id) : p); });
          sec.productCount = count;
          sec.products = productIds;
          var cell = _sectionsMount.listEl.querySelector('.tp-sec-products[data-section-id="' + sec.id + '"]');
          if (!cell) return;
          cell.textContent = '';
          if (count > 0) {
            var link = doc.createElement('a');
            link.href = 'javascript:void(0)';
            link.textContent = String(count);
            link.title = 'Poka\u017c produkty u\u017cywaj\u0105ce sekcji';
            link.style.cssText = 'color:#2563eb;text-decoration:none;font-weight:500;cursor:pointer';
            link.addEventListener('click', function (e) { e.stopPropagation(); showSectionProductsModal(doc, sec); });
            cell.appendChild(link);
          } else {
            cell.textContent = '0';
          }
        } catch (e) { /* leave placeholder */ }
      }));
    }
  }

  // v4.5.27: modal listing products using a section
  // v4.5.31: fetch product list on demand (sections panel no longer preloads)
  function showSectionProductsModal(doc, sec) {
    if (!sec.products) {
      fetchAjax('action=numberOfOccurrence&id=' + encodeURIComponent(sec.id))
        .then(function (r) {
          sec.products = (r && r.data && Array.isArray(r.data.products)) ? r.data.products : [];
          showSectionProductsModal(doc, sec);
        })
        .catch(function () {
          alert('Nie uda\u0142o si\u0119 pobra\u0107 produkt\u00f3w dla sekcji "' + sec.name + '".');
        });
      return;
    }
    if (sec.products.length === 0) {
      alert('Sekcja "' + sec.name + '" (ID: ' + sec.id + ') nie jest przypisana do \u017cadnego produktu (lub IdoSell nie udost\u0119pnia tej informacji dla sekcji).');
      return;
    }
    var ov = doc.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';
    var modal = doc.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:8px;width:600px;max-height:80vh;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-family:inherit;';
    var rows = sec.products.map(function (p) {
      var pid = typeof p === 'object' ? (p.id || p) : p;
      var pname = typeof p === 'object' ? (p.name || '') : '';
      return '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:6px 12px;font-family:Roboto Mono,monospace;font-size:12px;color:#5f6368">' + pid + '</td><td style="padding:6px 12px">' + escapeHtml(pname) + '</td><td style="padding:6px 12px"><a href="/panel/app/product-edit.php?idt=' + pid + '" target="_blank" style="color:#2563eb;text-decoration:none">Otw\u00f3rz \u2197</a></td></tr>';
    }).join('');
    modal.innerHTML =
      '<div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between">' +
        '<h2 style="margin:0;font-size:16px;font-weight:600">Produkty u\u017cywaj\u0105ce sekcji &quot;' + escapeHtml(sec.name) + '&quot;</h2>' +
        '<button class="tp-sec-modal-close" style="border:none;background:transparent;cursor:pointer;font-size:20px;color:#64748b">&times;</button>' +
      '</div>' +
      '<div style="padding:12px 20px;color:#64748b;font-size:13px">Znaleziono ' + sec.products.length + ' produkt\u00f3w.</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="background:#f1f5f9"><th style="padding:8px 12px;text-align:left">ID</th><th style="padding:8px 12px;text-align:left">Nazwa</th><th style="padding:8px 12px"></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
    ov.appendChild(modal);
    doc.body.appendChild(ov);
    function close() { ov.remove(); }
    modal.querySelector('.tp-sec-modal-close').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  }

  function createNewSection(doc) {
    showInputModal(doc, {
      icon: 'create_new_folder',
      title: 'Dodaj sekcj\u0119',
      subtitle: 'Nowa sekcja na poziomie g\u0142\u00f3wnym',
      label: 'Nazwa sekcji',
      placeholder: 'np. Sekcja techniczna',
      okLabel: 'Utw\u00f3rz',
      onOk: function (name) {
        fetchAjax('action=checkEl&type=section&lang=' + LANG + '&name=' + encodeURIComponent(name))
          .then(function (resp) {
            if (resp && resp.error) { alert('B\u0142\u0105d: ' + resp.error); return; }
            if (_panel) _panel.showStatus('Utworzono sekcj\u0119 "' + name + '"');
            setTimeout(function () { (doc.defaultView || window).location.reload(); }, 900);
          })
          .catch(function (e) { alert('B\u0142\u0105d tworzenia sekcji: ' + (e.message || e)); });
      }
    });
  }

  // v4.5.99: dodawanie parametru przez ujednolicony modal (zamiast natywnego dialogu)
  function createNewParameter(doc) {
    showInputModal(doc, {
      icon: 'add',
      title: 'Dodaj parametr',
      subtitle: 'Nowy parametr na poziomie g\u0142\u00f3wnym',
      label: 'Nazwa parametru',
      placeholder: 'np. Kolor',
      okLabel: 'Utw\u00f3rz',
      onOk: function (name) {
        fetchAjax('action=checkEl&type=parameter&lang=' + LANG + '&name=' + encodeURIComponent(name))
          .then(function (resp) {
            if (resp && resp.error) { alert('B\u0142\u0105d: ' + resp.error); return; }
            if (_panel) _panel.showStatus('Utworzono parametr "' + name + '"');
            setTimeout(function () { (doc.defaultView || window).location.reload(); }, 900);
          })
          .catch(function (e) { alert('B\u0142\u0105d tworzenia parametru: ' + (e.message || e)); });
      }
    });
  }

  // v4.6.2: dodawanie warto\u015bci przez ujednolicony modal (zamiast natywnego "Dodaj potomka")
  function createNewValue(doc, paramId, paramName) {
    showInputModal(doc, {
      icon: 'add',
      title: 'Dodaj warto\u015b\u0107',
      subtitle: 'do parametru \u201e' + paramName + '\u201d',
      label: 'Nazwa warto\u015bci',
      placeholder: 'np. Czerwony',
      okLabel: 'Utw\u00f3rz',
      onOk: function (name) {
        fetchAjax('action=checkElValues&type=value&lang=' + LANG + '&parameter_id=' + encodeURIComponent(paramId) + '&product=0&value[]=' + encodeURIComponent(name))
          .then(function (resp) {
            if (resp && resp.error) { alert('B\u0142\u0105d: ' + resp.error); return; }
            if (_panel) _panel.showStatus('Dodano warto\u015b\u0107 "' + name + '" do \u201e' + paramName + '\u201d');
            try { tpCacheDel('ch2', paramId + '_' + LANG); } catch (e) {}
            setTimeout(function () { (doc.defaultView || window).location.reload(); }, 900);
          })
          .catch(function (e) { alert('B\u0142\u0105d dodawania warto\u015bci: ' + (e.message || e)); });
      }
    });
  }

  // v4.6.5: widget edytora opisu \u2014 \u0179r\u00f3d\u0142o HTML <-> Edytor wizualny.
  // U\u017cywa TinyMCE z iframe panelu je\u015bli dost\u0119pny, w przeciwnym razie contentEditable.
  function createEditorWidget(doc, initialHtml, rows) {
    var wrap = doc.createElement('div');
    wrap.className = 'tp-ed-wrap';
    var bar = doc.createElement('div');
    bar.className = 'tp-ed-bar';
    var srcBtn = doc.createElement('button');
    srcBtn.type = 'button'; srcBtn.className = 'tp-ed-btn tp-ed-on'; srcBtn.textContent = '\u0179r\u00f3d\u0142o HTML';
    var wysBtn = doc.createElement('button');
    wysBtn.type = 'button'; wysBtn.className = 'tp-ed-btn'; wysBtn.textContent = 'Edytor wizualny';
    bar.appendChild(srcBtn); bar.appendChild(wysBtn); wrap.appendChild(bar);

    var elId = 'tp_ed_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
    var src = doc.createElement('textarea');
    src.className = 'tp-ed-src'; src.id = elId; src.rows = rows || 7; src.value = initialHtml || '';
    wrap.appendChild(src);

    var wysEl = doc.createElement('div');
    wysEl.className = 'tp-ed-wys'; wysEl.contentEditable = 'true'; wysEl.style.display = 'none';
    wysEl.style.minHeight = ((rows || 7) * 22) + 'px';
    wrap.appendChild(wysEl);
    // `src` (textarea) jest KANONICZNYM źródłem prawdy. Tryb wizualny na bieżąco
    // zapisuje do niego (input), więc getValue()=src.value nigdy nie jest nieaktualny.
    wysEl.addEventListener('input', function () { src.value = wysEl.innerHTML; });
    wysEl.addEventListener('blur', function () { src.value = wysEl.innerHTML; });

    // Panelowy TinyMCE to wersja 6 — nasza konfiguracja (usunięty w v6 plugin
    // `paste`, brak license_key) NIE tworzy edytora (zweryfikowane na demo37:
    // init zwraca brak edytora). W trybie „wizualnym" treść nie była odczytana
    // → opis się nie zapisywał. Dlatego NIE używamy panelowego TinyMCE —
    // własny, niezawodny edytor contentEditable (ten sam dokument).
    var iwin = (typeof getIframeWin === 'function') ? getIframeWin() : null;
    var tmce = null; // świadomie wyłączone — patrz komentarz wyżej
    var tiny = null, tinyInited = false;
    // Panel IdoSell ma GLOBALNY TinyMCE (autodiscover) który potrafi sam przejąć
    // nasz <textarea>. Wtedy nasza zmienna `tiny` jest null, a textarea jest
    // nieaktualny → „opis się nie zapisuje". getTiny() zwraca NASZ edytor LUB
    // ten przypięty przez panel (tinymce.get(id)).
    function getTiny() {
      if (tiny) return tiny;
      try { if (tmce && tmce.get) { var e = tmce.get(elId); if (e) return e; } } catch (_) {}
      return null;
    }

    function actSrc() {
      var t0 = getTiny();
      if (t0) { try { src.value = t0.getContent(); } catch (e) {} try { t0.hide(); } catch (e) {} }
      else if (wysEl.style.display !== 'none') { src.value = wysEl.innerHTML; wysEl.style.display = 'none'; }
      src.style.display = '';
      srcBtn.classList.add('tp-ed-on'); wysBtn.classList.remove('tp-ed-on');
    }
    function initTiny() {
      if (!tmce) return;
      try {
        tmce.init({
          target: src,
          menubar: false,
          plugins: 'lists link table code paste autolink',
          toolbar: 'bold italic underline | bullist numlist | link table | removeformat | code',
          height: Math.max(220, (rows || 7) * 32),
          convert_urls: false,
          entity_encoding: 'raw',
          branding: false,
          setup: function (ed) {
            tiny = ed;
            ed.on('init', function () {
              try { ed.setContent(src.value || ''); } catch (e) {}
              src.style.display = 'none';
              srcBtn.classList.remove('tp-ed-on'); wysBtn.classList.add('tp-ed-on');
            });
          }
        });
      } catch (e) { tmce = null; }
    }
    function actWys() {
      var t0 = getTiny();
      if (t0) { try { t0.setContent(src.value); } catch (e) {} src.style.display = 'none'; try { t0.show(); } catch (e) {} }
      else if (tmce) {
        if (!tinyInited) { tinyInited = true; initTiny(); return; }
      } else {
        wysEl.innerHTML = src.value;
        src.style.display = 'none';
        wysEl.style.display = '';
      }
      srcBtn.classList.remove('tp-ed-on'); wysBtn.classList.add('tp-ed-on');
    }
    srcBtn.addEventListener('click', actSrc);
    wysBtn.addEventListener('click', actWys);

    return {
      container: wrap,
      getValue: function () {
        // tryb wizualny widoczny → zsynchronizuj do kanonicznego src; zwróć src
        if (wysEl.style.display !== 'none') src.value = wysEl.innerHTML;
        return src.value;
      },
      setValue: function (h) {
        src.value = h || '';
        wysEl.innerHTML = h || '';
      },
      destroy: function () { var t = getTiny(); if (t) { try { t.remove(); } catch (e) {} } }
    };
  }

  // v4.6.3: ujednolicony modal edycji parametru/warto\u015bci (zak\u0142adki j\u0119zyk\u00f3w, Nazwa + Opis od razu widoczne)
  // API: load getParameterLangData; zapis nazw setSettings&names[lang]; opis setDescription per j\u0119zyk.
  function showEditElementModal(doc, nodeId) {
    if (_panel && _panel.showStatus) _panel.showStatus('Wczytywanie danych elementu\u2026');
    fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(nodeId)).then(function (resp) {
      var dt = resp && resp.data ? resp.data : null;
      if (!dt || !dt.langData) { alert('Nie uda\u0142o si\u0119 wczyta\u0107 danych elementu'); return; }
      var isVal = String(dt.type) === 'value';
      var ctx = dt.context_id || (dt.context_value_id || '');
      var ctxLabel = (typeof CONTEXT_LABELS !== 'undefined' && CONTEXT_LABELS[ctx]) ? CONTEXT_LABELS[ctx] : ctx;

      // kolejno\u015b\u0107 j\u0119zyk\u00f3w: pol, eng, ger, lit, rus, reszta
      var order = ['pol', 'eng', 'ger', 'fra', 'ces', 'ukr', 'ita', 'esp', 'rus', 'lit', 'lav', 'est', 'nld', 'hun', 'swe', 'slk', 'slv', 'bul', 'hrv', 'rum', 'por', 'dan', 'fin', 'nor'];
      var langs = Object.keys(dt.langData);
      langs.sort(function (a, b) {
        var ia = order.indexOf(a); var ib = order.indexOf(b);
        if (ia < 0) ia = 999;
        if (ib < 0) ib = 999;
        return (ia - ib) || a.localeCompare(b);
      });

      var st = {};
      langs.forEach(function (lg) {
        var L = dt.langData[lg] || {};
        st[lg] = { name: L.name || '', description: L.description || '', oName: L.name || '', oDesc: L.description || '' };
      });
      var curLang = langs.indexOf('pol') >= 0 ? 'pol' : langs[0];
      var displayName = (st[LANG] && st[LANG].name) || (st[curLang] && st[curLang].name) || ('ID ' + nodeId);

      var d = doc || document;
      var overlay = d.createElement('div');
      overlay.className = 'tp-overlay';
      var modal = d.createElement('div');
      modal.className = 'tp-modal';
      modal.style.width = '950px';
      modal.style.maxWidth = 'calc(100vw - 32px)';

      var header = d.createElement('div');
      header.className = 'tp-modal-header';
      header.style.cssText = 'background:#fff;color:#202124;border-bottom:1px solid #eef0f4;';
      header.innerHTML =
        '<span style="width:40px;height:40px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#e8eeff;color:#1a73e8;">' +
          '<span class="material-symbols-outlined" style="font-size:22px">settings</span>' +
        '</span>' +
        '<span style="display:flex;flex-direction:column;gap:2px;min-width:0;">' +
          '<span style="font-size:16px;font-weight:600;color:#1a1a2e;">Edycja ' + (isVal ? 'warto\u015bci' : 'parametru') + '</span>' +
          '<span style="font-size:12.5px;font-weight:400;color:#98a2b3;">\u201e' + escapeHtml(displayName) + '\u201d \u00b7 ID ' + escapeHtml(String(nodeId)) + (ctx ? ' \u00b7 kontekst: ' + escapeHtml(ctxLabel) : '') + '</span>' +
        '</span>' +
        '<button type="button" class="tp-modal-header-close" aria-label="Zamknij" style="color:#b0b8c9;">\u2715</button>';

      var body = d.createElement('div');
      body.className = 'tp-modal-body tp-se';

      // ===== KARTA: Język edycji (osobny blok nad treścią — dotyczy całego modalu) =====
      var cardL = d.createElement('div'); cardL.className = 'tp-se-card';
      cardL.innerHTML = '<div class="tp-se-head"><span class="material-symbols-outlined">translate</span>Język edycji</div>';
      var bodyL = d.createElement('div'); bodyL.className = 'tp-se-body';
      // emoji flagi 1:1 jak w modalu eksportu
      var SE_LC = { pol:'PL', eng:'GB', ger:'DE', deu:'DE', fra:'FR', ces:'CZ', cze:'CZ', ukr:'UA', ita:'IT', esp:'ES', rus:'RU', por:'PT', nld:'NL', hun:'HU', swe:'SE', nor:'NO', dan:'DK', fin:'FI', rum:'RO', rom:'RO', bul:'BG', hrv:'HR', slk:'SK', slv:'SI', lit:'LT', lav:'LV', est:'EE', ara:'SA' };
      function seFlag(code) {
        var cc = SE_LC[code]; if (!cc) return '';
        return String.fromCodePoint.apply(String, cc.split('').map(function (c) { return 0x1F1E6 + c.charCodeAt(0) - 65; }));
      }
      var tabs = d.createElement('div'); tabs.className = 'lang-list';
      langs.forEach(function (lg) {
        var t = d.createElement('label');
        t.className = 'lang-item'; t.dataset.lang = lg;
        t.innerHTML = '<span class="lang-check"></span>' +
          '<span class="lang-flag">' + seFlag(lg) + '</span>' +
          '<span class="lang-name">' + escapeHtml(getLangName(lg)) + '</span>' +
          '<input type="radio" name="tp-se-lang">';
        tabs.appendChild(t);
      });
      bodyL.appendChild(tabs);
      var copyRow = d.createElement('div');
      copyRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 2px;flex-wrap:wrap;';
      var copyHint = d.createElement('span');
      copyHint.style.cssText = 'font-size:11.5px;color:#98a2b3;';
      copyHint.textContent = 'Powiel nazwę, opis i ustawienia grafik na pozostałe języki.';
      var copyBtn = d.createElement('button');
      copyBtn.type = 'button';
      copyBtn.style.cssText = 'background:none;border:none;padding:0;font:600 12.5px/1 inherit;color:#4f8cff;cursor:pointer;font-family:inherit;';
      copyBtn.textContent = 'Powiel na wszystkie języki';
      copyBtn.addEventListener('mouseenter', function () { copyBtn.style.textDecoration = 'underline'; });
      copyBtn.addEventListener('mouseleave', function () { copyBtn.style.textDecoration = 'none'; });
      copyBtn.addEventListener('click', function () { copyActiveLangToAll(); });
      copyRow.appendChild(copyHint); copyRow.appendChild(copyBtn);
      bodyL.appendChild(copyRow);
      cardL.appendChild(bodyL);
      body.appendChild(cardL);

      var cardC = d.createElement('div'); cardC.className = 'tp-se-card';
      cardC.innerHTML = '<div class="tp-se-head"><span class="material-symbols-outlined">edit_note</span>Treść</div>';
      var bodyC = d.createElement('div'); bodyC.className = 'tp-se-body';
      cardC.appendChild(bodyC);

      var rowN = d.createElement('div'); rowN.className = 'tp-se-row';
      var lblN = d.createElement('span'); lblN.className = 'tp-se-lbl'; lblN.textContent = 'Nazwa';
      var ctlN = d.createElement('div'); ctlN.className = 'tp-se-ctl';
      var inN = d.createElement('input'); inN.type = 'text';
      ctlN.appendChild(inN);
      rowN.appendChild(lblN); rowN.appendChild(ctlN);
      bodyC.appendChild(rowN);

      var rowD = d.createElement('div'); rowD.className = 'tp-se-row tp-se-row--col';
      var edD = createEditorWidget(d, st[curLang].description, 8);
      var edHead = d.createElement('div'); edHead.className = 'tp-ed-v2head';
      var edLbl = d.createElement('span'); edLbl.className = 'tp-ed-v2lbl'; edLbl.textContent = 'Opis (HTML)';
      edHead.appendChild(edLbl);
      var edBar = edD.container.querySelector('.tp-ed-bar');
      if (edBar) edHead.appendChild(edBar);
      edD.container.insertBefore(edHead, edD.container.firstChild);
      rowD.appendChild(edD.container);
      bodyC.appendChild(rowD);
      body.appendChild(cardC);

      var cardG = d.createElement('div'); cardG.className = 'tp-se-card';
      cardG.innerHTML = '<div class="tp-se-head"><span class="material-symbols-outlined">image</span>Grafiki</div>';
      var bodyG = d.createElement('div'); bodyG.className = 'tp-se-body';
      cardG.appendChild(bodyG);
      var gHint = d.createElement('div'); gHint.className = 'tp-se-hint';
      gHint.innerHTML = '<span>ℹ</span><span>Zalecany format: trzy wielkości (RWD) dla komputerów, tabletów i smartfonów. Grafikę ustawiasz dla wybranego języka w konkretnym sklepie (tylko sklepy, w których ten język jest dostępny).</span>';
      bodyG.appendChild(gHint);
      var rowShop = d.createElement('div'); rowShop.className = 'tp-se-row';
      var lblShop = d.createElement('span'); lblShop.className = 'tp-se-lbl'; lblShop.textContent = 'Sklep';
      var ctlShop = d.createElement('div'); ctlShop.className = 'tp-se-ctl';
      var gfxShopSel = d.createElement('select');
      gfxShopSel.innerHTML = '<option>Wczytywanie…</option>'; gfxShopSel.disabled = true;
      ctlShop.appendChild(gfxShopSel);
      rowShop.appendChild(lblShop); rowShop.appendChild(ctlShop);
      bodyG.appendChild(rowShop);
      var gfxHost = d.createElement('div'); gfxHost.style.cssText = 'margin-top:10px;';
      bodyG.appendChild(gfxHost);
      body.appendChild(cardG);

      var GW = (typeof getIframeWin === 'function') ? getIframeWin() : window;
      var GIDOC = (typeof getIframeDoc === 'function') ? getIframeDoc() : (doc || document);
      var GCTX = [{ k: 'search', t: 'Grafika wyświetlana na liście towarów' }, { k: 'projector', t: 'Grafika wyświetlana na karcie towaru' }];
      var GORIGIN = '';
      try { GORIGIN = (GW && GW.location && GW.location.origin) || (GIDOC && GIDOC.location && GIDOC.location.origin) || location.origin || ''; } catch (e) { GORIGIN = location.origin || ''; }
      function gfxAbsUrl(u) {
        if (!u) return '';
        u = String(u).split('?')[0];
        if (/^https?:\/\//i.test(u)) return u;
        // ZAWSZE root-relative (wiodący '/'); z originem gdy znany. Bez tego
        // przy pustym GORIGIN powstawał URL względny → /panel/data/... → 404.
        var path = '/' + u.replace(/^\/+/, '');
        return (GORIGIN || '') + path;
      }
      var gfxType = {};   // lang -> shop -> {search,projector}
      var gfxEnable = {}; // lang -> shop -> {search,projector} : 'n'|'y_manual'|'y_folder'
      var gfxData = {};   // lang -> { shops:[{idx,domain}], paths/spans:{shop:{ctx:{single,desktop,tablet,mobile}}}, img:{shop:{ctx:url}} }
      var gfxReady = false;
      // Natywny formularz grafik trzymamy ŻYWY offscreen do zamknięcia modalu —
      // tylko jego oryginalne spany zapisują grafikę przez IAI.PictureUploader.
      var _nativeGfxKillIv = null, _nativeGfxSty = null;
      function cleanupNativeGfx() {
        try { if (_nativeGfxKillIv) clearInterval(_nativeGfxKillIv); } catch (e) {}
        _nativeGfxKillIv = null;
        try {
          var f = GIDOC.querySelector('form[id^="form_editEl_"]');
          var c = f;
          while (c && c.parentElement && c.parentElement.tagName !== 'BODY') c = c.parentElement;
          if (c && c !== GIDOC.body && c.parentNode) c.parentNode.removeChild(c);
        } catch (e) {}
        try { GIDOC.querySelectorAll('.tp-gfx-killed').forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); } catch (e) {}
        try { GIDOC.querySelectorAll('[id^="longdesc_edit_window"]').forEach(function (n) { n.remove(); }); } catch (e) {}
        try { GIDOC.documentElement.classList.remove('tp-gfx-loading'); } catch (e) {}
        try { if (_nativeGfxSty && _nativeGfxSty.parentNode) _nativeGfxSty.parentNode.removeChild(_nativeGfxSty); } catch (e) {}
        _nativeGfxSty = null;
      }

      function parsePathFromOnclick(s) {
        var m = /IAI\.PictureUploader\.select\([^,]+,\s*'[^']*'\s*,\s*'([^']+)'/.exec(s || '');
        return m ? m[1] : null;
      }
      function slotFromSuffix(suf) {
        return suf === '_desktop' ? 'desktop' : suf === '_tablet' ? 'tablet' : suf === '_mobile' ? 'mobile' : 'single';
      }
      function parseNativeGfx() {
        langs.forEach(function (lg) {
          var g = GIDOC.getElementById('fg_id_shopsTr_' + lg);
          var entry = { shops: [], paths: {}, img: {}, spans: {} };
          gfxType[lg] = gfxType[lg] || {};
          if (g) {
            var anchors = g.querySelectorAll('ul.yui3-tabview-list li a, .yui3-tabview-list > li > a');
            [].forEach.call(anchors, function (a, i) {
              entry.shops.push({ idx: i + 1, domain: (a.textContent || '').trim() });
            });
            // Skan natywnych spanów „wgraj plik" — zachowujemy ŻYWE referencje elementów,
            // bo tylko ich własny onclick IAI.PictureUploader.select(this,...) zapisuje grafikę.
            function scanSpans() {
              [].forEach.call(g.querySelectorAll('[onclick*="IAI.PictureUploader.select"]'), function (el) {
                var p = parsePathFromOnclick(el.getAttribute('onclick'));
                if (!p) return;
                var mm = /\/traits\/gfx\/(search|projector)\/\d+_(\d+)(_desktop|_tablet|_mobile)?$/.exec(p);
                if (!mm) return;
                var cx = mm[1], sh = mm[2], slot = slotFromSuffix(mm[3] || '');
                if (!entry.paths[sh]) entry.paths[sh] = {};
                if (!entry.paths[sh][cx]) entry.paths[sh][cx] = { single: null, desktop: null, tablet: null, mobile: null };
                if (!entry.spans[sh]) entry.spans[sh] = {};
                if (!entry.spans[sh][cx]) entry.spans[sh][cx] = { single: null, desktop: null, tablet: null, mobile: null };
                entry.paths[sh][cx][slot] = p;
                entry.spans[sh][cx][slot] = el;
              });
            }
            // Iterujemy zakładki sklepów (YUI renderuje pola tylko aktywnego sklepu) —
            // dzięki temu zbieramy radia/obrazki/spany dla WSZYSTKICH sklepów.
            entry.shops.forEach(function (sp, i) {
              try { if (anchors[i]) anchors[i].click(); } catch (e) {}
              var sh = String(sp.idx);
              ['search', 'projector'].forEach(function (cx) {
                gfxType[lg][sh] = gfxType[lg][sh] || {};
                gfxEnable[lg] = gfxEnable[lg] || {};
                gfxEnable[lg][sh] = gfxEnable[lg][sh] || {};
                var rsel = g.querySelector('input[name="icon_type_' + lg + '_' + sh + '_' + cx + '"]:checked');
                gfxType[lg][sh][cx] = (rsel && (rsel.value === 'img' || rsel.value === 'img_rwd')) ? rsel.value : 'img_rwd';
                var im = g.querySelector('#img_' + cx + '_' + nodeId + '_' + lg + '_' + sh + ', img[id="img_' + cx + '_' + nodeId + '_' + lg + '_' + sh + '"]');
                if (!entry.img[sh]) entry.img[sh] = {};
                entry.img[sh][cx] = im ? (im.getAttribute('src') || '') : '';
                // istniejąca grafika => kontekst domyślnie „Włączona — wskaż grafiki"
                gfxEnable[lg][sh][cx] = (entry.img[sh][cx]) ? 'y_manual' : 'n';
                if (!entry.paths[sh]) entry.paths[sh] = {};
                if (!entry.paths[sh][cx]) entry.paths[sh][cx] = { single: null, desktop: null, tablet: null, mobile: null };
              });
              scanSpans();
            });
            try { if (anchors[0]) anchors[0].click(); } catch (e) {}
          }
          gfxData[lg] = entry;
        });
        gfxReady = true;
      }
      // Żywy span „wgraj plik" dla (język, kontekst, sklep, wariant). Aktywuje zakładkę
      // sklepu i wyszukuje element w natywnym (offscreen) formularzu; fallback do parsu.
      function nativeSpanFor(lg, cx, sh, kind) {
        var g = GIDOC.getElementById('fg_id_shopsTr_' + lg);
        if (g) {
          try {
            var anchors = g.querySelectorAll('ul.yui3-tabview-list li a, .yui3-tabview-list > li > a');
            var ai = (parseInt(sh, 10) || 1) - 1;
            if (anchors[ai]) anchors[ai].click();
          } catch (e) {}
          var wantSuf = (kind === 'single') ? '' : ('_' + kind);
          var found = null;
          [].forEach.call(g.querySelectorAll('[onclick*="IAI.PictureUploader.select"]'), function (el) {
            var p = parsePathFromOnclick(el.getAttribute('onclick'));
            if (!p) return;
            var mm = /\/traits\/gfx\/(search|projector)\/\d+_(\d+)(_desktop|_tablet|_mobile)?$/.exec(p);
            if (!mm) return;
            if (mm[1] === cx && mm[2] === String(sh) && (mm[3] || '') === wantSuf) found = el;
          });
          if (found) return found;
        }
        var sp = gfxData[lg] && gfxData[lg].spans && gfxData[lg].spans[sh] && gfxData[lg].spans[sh][cx];
        return (sp && sp[kind]) || null;
      }

      function gfxPath(lg, cx, sh, kind) {
        var pd = gfxData[lg] && gfxData[lg].paths[sh] && gfxData[lg].paths[sh][cx];
        if (pd && pd[kind]) return pd[kind];
        // rekonstrukcja jeśli brak w parsie
        var suf = kind === 'single' ? '' : ('_' + kind);
        return '/data/lang/' + lg + '/traits/gfx/' + cx + '/' + nodeId + '_' + sh + suf;
      }
      function mkUploadBtn(cx, sh, kind) {
        var b = d.createElement('button');
        b.type = 'button'; b.className = 'tp-btn-modal-secondary';
        b.style.cssText = 'font-size:12px;padding:6px 12px;';
        b.textContent = 'Wgraj plik';
        b.addEventListener('click', function () {
          try {
            if (GW && GW.IAI && GW.IAI.PictureUploader) {
              GW.IAI.PictureUploader.select(b, '/panel/ajax/parameters.php', gfxPath(curLang, cx, sh, kind));
            } else { alert('Uploader panelu (IAI.PictureUploader) niedostępny.'); }
          } catch (e) { alert('Błąd uploadu: ' + (e.message || e)); }
        });
        return b;
      }
      function mkUploadRow(labelTxt, cx, sh, kind) {
        var row = d.createElement('div'); row.className = 'tp-gfx-upload-row';
        var lab = d.createElement('span'); lab.className = 'tp-gfx-upload-label'; lab.textContent = labelTxt;
        var btn = d.createElement('button'); btn.type = 'button'; btn.className = 'tp-gfx-browse'; btn.textContent = 'Przeglądaj…';
        var stt = d.createElement('span'); stt.className = 'tp-gfx-upload-state'; stt.textContent = 'Nie wybrano pliku.';
        var fin = d.createElement('input');
        fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
        btn.addEventListener('click', function () { fin.value = ''; fin.click(); });
        fin.addEventListener('change', function () {
          var f = fin.files && fin.files[0];
          if (!f) return;
          var lg = curLang;
          stt.textContent = f.name + ' — wgrywanie…';
          btn.disabled = true;
          uploadOneFile(f, cx, sh, kind).then(function (res) {
            stt.textContent = f.name + ' — wgrano i zapisano ✓';
            btn.disabled = false;
            var url = (res && res.path) ? res.path : gfxPath(lg, cx, sh, kind);
            url += (url.indexOf('?') > -1 ? '&' : '?') + 'tpv=' + Date.now();
            if (gfxData[lg]) {
              gfxData[lg].img[sh] = gfxData[lg].img[sh] || {};
              gfxData[lg].img[sh][cx] = url;
            }
            gfxEnable[lg] = gfxEnable[lg] || {};
            gfxEnable[lg][sh] = gfxEnable[lg][sh] || {};
            gfxEnable[lg][sh][cx] = 'y_manual';
            if (_panel) _panel.showStatus('Wgrano grafikę „' + f.name + '" (zapisane w panelu)');
            if (lg === curLang) renderGfxBody(sh);
          }).catch(function (e) {
            btn.disabled = false;
            stt.textContent = f.name + ' — błąd';
            alert('Błąd wgrywania „' + f.name + '": ' + (e.message || e));
          });
        });
        row.appendChild(lab); row.appendChild(btn); row.appendChild(stt); row.appendChild(fin);
        return row;
      }
      function mkFolderUpload(cx, sh) {
        var wrap = d.createElement('div');
        var guide = d.createElement('div');
        guide.style.cssText = 'font-size:12px;color:#667085;background:#f8f9fb;border:1px solid #e8ebf0;border-radius:8px;padding:10px 12px;margin-bottom:8px;line-height:1.5;';
        guide.innerHTML = '<strong>Schemat nazw plików:</strong> <code>' + nodeId + '_' + sh + '[_desktop|_tablet|_mobile].jpg</code>' +
          '<br>Pliki z folderu zostaną dopasowane do slotów po nazwie (brak sufiksu = jedna wielkość).';
        wrap.appendChild(guide);
        var fi = d.createElement('input');
        fi.type = 'file'; fi.setAttribute('webkitdirectory', ''); fi.setAttribute('multiple', '');
        fi.style.cssText = 'font-size:12px;margin-bottom:8px;';
        wrap.appendChild(fi);
        var mapBox = d.createElement('div');
        mapBox.style.cssText = 'display:none;font-size:12px;color:#344054;background:#fff;border:1px solid #e8ebf0;border-radius:8px;padding:10px 12px;';
        wrap.appendChild(mapBox);
        function classify(name) {
          var n = name.toLowerCase();
          if (/_desktop\.[a-z0-9]+$/.test(n)) return 'desktop';
          if (/_tablet\.[a-z0-9]+$/.test(n)) return 'tablet';
          if (/_mobile\.[a-z0-9]+$/.test(n)) return 'mobile';
          return 'single';
        }
        fi.addEventListener('change', function () {
          var files = [].slice.call(fi.files || []).filter(function (f) { return /^image\//.test(f.type); });
          if (!files.length) { mapBox.style.display = 'none'; return; }
          mapBox.style.display = '';
          var rwd = (gfxType[curLang][sh] && gfxType[curLang][sh][cx]) === 'img_rwd';
          var rows = [];
          files.forEach(function (f) {
            var slot = classify(f.name);
            if (!rwd) slot = 'single';
            rows.push({ f: f, slot: slot });
          });
          var html = '<strong>Dopasowanie:</strong><div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">';
          rows.forEach(function (r) {
            html += '<div>✓ ' + escapeHtml(r.slot) + ' ← ' + escapeHtml(r.f.name) + ' (' + (r.f.size / 1024).toFixed(1) + ' KB)</div>';
          });
          html += '</div>';
          mapBox.innerHTML = html;
          var go = d.createElement('button');
          go.type = 'button'; go.className = 'tp-btn-modal-primary'; go.style.cssText = 'margin-top:10px;font-size:12px;padding:6px 14px;';
          go.textContent = 'Wgraj dopasowane (' + rows.length + ')';
          go.addEventListener('click', function () {
            go.disabled = true; go.textContent = 'Wgrywanie…';
            (function next(i) {
              if (i >= rows.length) { go.textContent = 'Gotowe ✓'; if (_panel) _panel.showStatus('Wgrano ' + rows.length + ' grafik z katalogu'); return; }
              var r = rows[i];
              uploadOneFile(r.f, cx, sh, r.slot).then(function () { next(i + 1); })
                .catch(function (e) { go.disabled = false; go.textContent = 'Wgraj dopasowane (' + rows.length + ')'; alert('Błąd wgrywania „' + r.f.name + '": ' + (e.message || e)); });
            })(0);
          });
          mapBox.appendChild(go);
        });
        return wrap;
      }
      // ZWERYFIKOWANY przepis (demo37 2026-05-19, realny upload + reload getParameterLangData):
      // 1) chunk -> /panel/ajax/uploadLargeFile.php  => {name:'IAI_…',status:'OK'}
      // 2) skojarzenie -> POST /panel/ajax/parameters.php MULTIPART z polami z data-* spana:
      //    action=saveParamGfx, shop, lang, id, type(=cx), version(=desktop|tablet|mobile;
      //    pomijane dla 'single'), completed_fileUploaderField=[[fileName,tempName]]
      // Zapisuje od razu (niezależnie od głównego „Zapisz"). cx = 'search'|'projector'.
      function uploadOneFile(file, cx, sh, kind, lang) {
        var lg = lang || curLang;
        var fn = (file.name || ('gfx_' + nodeId + '_' + sh + '.jpg')).replace(/\.jpe?g$/i, '.jpg');
        var url = '/panel/ajax/uploadLargeFile.php?largeFileMode=1&fileSize=' + file.size +
          '&fileName=' + encodeURIComponent(fn) + '&dir=&offset=0&chunkSize=' + file.size;
        return file.arrayBuffer().then(function (ab) {
          return fetch(url, { method: 'POST', credentials: 'same-origin', body: ab });
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (!data || data.status !== 'OK' || !data.name) throw new Error((data && data.errmsg) || 'Upload odrzucony');
          var fd = new FormData();
          fd.append('action', 'saveParamGfx');
          fd.append('shop', String(sh));
          fd.append('lang', lg);
          fd.append('id', String(nodeId));
          fd.append('type', cx);
          if (kind && kind !== 'single') fd.append('version', kind);
          fd.append('completed_fileUploaderField', JSON.stringify([[fn, data.name]]));
          return fetch('/panel/ajax/parameters.php', { method: 'POST', credentials: 'same-origin', body: fd });
        }).then(function (r) { return r.text(); }).then(function (txt) {
          var j; try { j = JSON.parse(txt); } catch (e) { j = null; }
          if (j && j.status === 'error') throw new Error(j.error || ('errno ' + j.errno));
          // sukces: { data: { icon_<cx>[ _<ver> ]: "data/lang/…/<id>_<sh>[…].<ext>" } }
          var p = null;
          if (j && j.data) { for (var k in j.data) { if (/^icon_/.test(k) && j.data[k]) { p = j.data[k]; break; } } }
          return { path: p ? ('/' + String(p).replace(/^\/+/, '')) : null, raw: j };
        });
      }
      // Zweryfikowane (demo37): action=removeParamGfx&id=&lang=&shop=&type=[&version=] -> {errno:0}
      function removeParamGfx(lang, sh, cx, version) {
        var body = 'action=removeParamGfx&id=' + encodeURIComponent(nodeId) +
          '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(sh) +
          '&type=' + encodeURIComponent(cx) + (version ? '&version=' + encodeURIComponent(version) : '');
        return fetch('/panel/ajax/parameters.php', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
          body: body
        }).then(function (r) { return r.text(); }).then(function (txt) {
          var j; try { j = JSON.parse(txt); } catch (e) { j = null; }
          if (j && j.errno && j.errno !== 0) throw new Error(j.error || ('errno ' + j.errno));
          return j || {};
        });
      }
      // Normalizacja URL grafiki -> poprawny absolutny /data/lang/... (naprawa „podglądu")
      function normGfxUrl(u) {
        if (!u) return '';
        u = String(u).split('?')[0];
        if (/^https?:\/\//i.test(u)) return u;
        u = u.replace(/^(\.\.\/)+/, '');
        return '/' + u.replace(/^\/+/, '');
      }
      // Kanoniczna ścieżka grafiki z getParameterLangData (autorytatywna, per sklep)
      function canonGfx(lg, cx, sh) {
        var L = (dt.langData && dt.langData[lg]) || {};
        var s = L['icon_' + cx] && L['icon_' + cx][sh];
        if (s) return normGfxUrl(s);
        var v = ['desktop', 'tablet', 'mobile'];
        for (var i = 0; i < v.length; i++) {
          var o = L['icon_' + cx + '_' + v[i]];
          if (o && o[sh]) return normGfxUrl(o[sh]);
        }
        return '';
      }
      function clearLangDataGfx(lg, cx, sh) {
        var L = (dt.langData && dt.langData[lg]) || null;
        if (!L) return;
        ['icon_' + cx, 'icon_' + cx + '_desktop', 'icon_' + cx + '_tablet', 'icon_' + cx + '_mobile'].forEach(function (key) {
          if (L[key] && L[key][sh] != null) L[key][sh] = '';
        });
      }

      function renderCtxBlock(host, cx, label, sh) {
        gfxType[curLang] = gfxType[curLang] || {};
        gfxType[curLang][sh] = gfxType[curLang][sh] || {};
        gfxEnable[curLang] = gfxEnable[curLang] || {};
        gfxEnable[curLang][sh] = gfxEnable[curLang][sh] || {};
        if (!gfxEnable[curLang][sh][cx]) gfxEnable[curLang][sh][cx] = 'n';

        var hd = d.createElement('div'); hd.className = 'tp-gfx-slot-header'; hd.textContent = label;
        host.appendChild(hd);

        // Selektor stanu: Wyłączona / Włączona — wskaż grafiki / Włączona — wgraj z katalogu
        var re = d.createElement('div'); re.className = 'tp-gfx-subfield';
        var rel = d.createElement('span'); rel.className = 'tp-se-lbl'; rel.textContent = 'Grafika';
        var rec = d.createElement('div'); rec.className = 'tp-se-ctl';
        var enSel = d.createElement('select');
        enSel.innerHTML = '<option value="n">Wyłączona</option>' +
          '<option value="y_manual">Włączona — wskaż grafiki</option>' +
          '<option value="y_folder">Włączona — wgraj z katalogu</option>';
        enSel.value = gfxEnable[curLang][sh][cx];
        rec.appendChild(enSel);
        re.appendChild(rel); re.appendChild(rec);
        host.appendChild(re);

        // Typ grafiki (warunkowy)
        var rt = d.createElement('div'); rt.className = 'tp-gfx-subfield';
        var rl = d.createElement('span'); rl.className = 'tp-se-lbl'; rl.textContent = 'Typ grafiki';
        var rc = d.createElement('div'); rc.className = 'tp-se-ctl';
        var sel = d.createElement('select');
        sel.innerHTML = '<option value="img_rwd">Obrazek (trzy wielkości — RWD)</option><option value="img">Obrazek (jedna wielkość — niezalecany, chyba że SVG)</option>';
        sel.value = gfxType[curLang][sh][cx] || 'img_rwd';
        rc.appendChild(sel);
        rt.appendChild(rl); rt.appendChild(rc);
        host.appendChild(rt);

        var slots = d.createElement('div'); slots.className = 'tp-gfx-slot-upload';
        host.appendChild(slots);

        function renderSlots() {
          slots.innerHTML = '';
          var mode = enSel.value;
          rt.style.display = (mode === 'n') ? 'none' : '';
          if (mode === 'n') return;
          var rawCur = (gfxData[curLang] && gfxData[curLang].img[sh] && gfxData[curLang].img[sh][cx]) || '';
          var known = canonGfx(curLang, cx, sh) || normGfxUrl(rawCur);
          if (known) {
            var stem = known.replace(/\.[a-z0-9]{2,4}$/i, '');
            var hadExt = stem !== known;
            var exts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
            var cands = [];
            if (hadExt) cands.push(gfxAbsUrl(known));
            exts.forEach(function (e) { var u = gfxAbsUrl(stem + '.' + e); if (cands.indexOf(u) < 0) cands.push(u); });
            var bust = 't=' + Date.now();
            var ex = d.createElement('div'); ex.className = 'tp-gfx-existing';
            ex.innerHTML =
              '<span class="tp-gfx-existing-label">Aktualna grafika:</span>' +
              '<img class="tp-gfx-thumb" alt="">' +
              '<span class="tp-gfx-existing-actions">' +
                '<a class="tp-gfx-link" target="_blank" rel="noopener">podgląd</a>' +
                '<span class="tp-gfx-del" role="button" tabindex="0">Usuń</span>' +
              '</span>';
            slots.appendChild(ex);
            var thumb = ex.querySelector('.tp-gfx-thumb');
            var link = ex.querySelector('.tp-gfx-link');
            var ci = 0;
            function tryCand() {
              if (ci >= cands.length) { thumb.style.display = 'none'; link.textContent = 'plik niedostępny'; link.removeAttribute('href'); return; }
              var clean = cands[ci];
              link.href = clean;
              thumb.src = clean + (clean.indexOf('?') > -1 ? '&' : '?') + bust;
            }
            thumb.addEventListener('error', function () { ci++; tryCand(); });
            thumb.addEventListener('load', function () { link.href = cands[ci]; });
            tryCand();
            var delEl = ex.querySelector('.tp-gfx-del');
            function doDelete() {
              var rwd = (sel.value === 'img_rwd');
              showConfirmModal(doc, {
                icon: 'delete', okVariant: 'danger', okLabel: 'Usuń',
                title: 'Usunąć grafikę?',
                subtitle: label + ' — ' + getLangName(curLang) + ', sklep ' + sh,
                message: 'Grafika zostanie trwale usunięta z panelu dla tego języka i sklepu' + (rwd ? ' (wszystkie wielkości RWD)' : '') + '. Operacja jest natychmiastowa.',
                onOk: function () {
                  delEl.textContent = 'Usuwanie…';
                  var lg = curLang;
                  var chain = removeParamGfx(lg, sh, cx, null);
                  if (rwd) {
                    ['desktop', 'tablet', 'mobile'].forEach(function (v) {
                      chain = chain.then(function () { return removeParamGfx(lg, sh, cx, v); });
                    });
                  }
                  chain.then(function () {
                    if (gfxData[lg] && gfxData[lg].img[sh]) gfxData[lg].img[sh][cx] = '';
                    clearLangDataGfx(lg, cx, sh);
                    gfxEnable[lg] = gfxEnable[lg] || {}; gfxEnable[lg][sh] = gfxEnable[lg][sh] || {};
                    gfxEnable[lg][sh][cx] = 'n';
                    if (_panel) _panel.showStatus('Usunięto grafikę (' + label + ', ' + getLangName(lg) + ', sklep ' + sh + ')');
                    if (lg === curLang) renderGfxBody(sh);
                  }).catch(function (e) {
                    delEl.textContent = 'Usuń';
                    alert('Błąd usuwania grafiki: ' + (e.message || e));
                  });
                }
              });
            }
            delEl.addEventListener('click', doDelete);
            delEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doDelete(); } });
          }
          if (mode === 'y_folder') {
            slots.appendChild(mkFolderUpload(cx, sh));
            return;
          }
          var rows = (sel.value === 'img_rwd')
            ? [{ k: 'desktop', l: 'Nowa grafika (komputer):' }, { k: 'tablet', l: 'Nowa grafika (tablet):' }, { k: 'mobile', l: 'Nowa grafika (smartfon):' }]
            : [{ k: 'single', l: 'Nowa grafika:' }];
          rows.forEach(function (r) { slots.appendChild(mkUploadRow(r.l, cx, sh, r.k)); });
        }
        enSel.addEventListener('change', function () {
          gfxEnable[curLang][sh][cx] = enSel.value;
          renderSlots();
        });
        sel.addEventListener('change', function () {
          gfxType[curLang][sh][cx] = sel.value;
          renderSlots();
        });
        renderSlots();
      }
      function renderGfxBody(sh) {
        gfxHost.innerHTML = '';
        if (!sh) {
          gfxHost.innerHTML = '<div style="font-size:12.5px;color:#98a2b3;padding:6px 0;">Dla języka „' + escapeHtml(getLangName(curLang)) + '" brak sklepów z dostępną grafiką.</div>';
          return;
        }
        GCTX.forEach(function (c) { renderCtxBlock(gfxHost, c.k, c.t, sh); });
      }
      function renderShopSelect() {
        if (!gfxReady) { gfxShopSel.innerHTML = '<option>Wczytywanie…</option>'; gfxShopSel.disabled = true; return; }
        var shops = (gfxData[curLang] && gfxData[curLang].shops) || [];
        if (!shops.length) {
          gfxShopSel.innerHTML = '<option>Brak sklepów z językiem ' + escapeHtml(getLangName(curLang)) + '</option>';
          gfxShopSel.disabled = true; renderGfxBody(null); return;
        }
        gfxShopSel.disabled = false;
        gfxShopSel.innerHTML = shops.map(function (s) {
          return '<option value="' + s.idx + '">' + escapeHtml(s.domain || ('Sklep ' + s.idx)) + '</option>';
        }).join('');
        gfxShopSel.value = String(shops[0].idx);
        renderGfxBody(String(shops[0].idx));
      }
      gfxShopSel.addEventListener('change', function () { renderGfxBody(gfxShopSel.value); });
      function showGfxForLang() { renderShopSelect(); }

      // Jednorazowe, offscreen: otwórz natywny edytor, sparsuj, zniszcz (bez migania, bez przycisku)
      (function initNativeGfx() {
        // Brak migania: klasę 'tp-gfx-loading' ustawiamy na <html> SYNCHRONICZNIE,
        // ZANIM natywny dialog się pojawi. Reguły celują w stałe kontenery YUI
        // (#windowTopLayer_c, #wait_c/#wait_mask, #ajax_c) + form/longdesc, więc
        // dopasowanie następuje w momencie wstawienia DOM (brak luki czasowej JS).
        var HIDE = 'position:fixed !important;left:-99999px !important;top:-99999px !important;width:1px !important;height:1px !important;max-height:1px !important;overflow:hidden !important;opacity:0 !important;visibility:hidden !important;pointer-events:none !important;z-index:-2147483647 !important;';
        var SEL = ['#windowTopLayer_c', '#wait_c', '#wait_mask', '#ajax_c',
          '[id^="form_editEl_"]', '[id^="editElWindow"]', '[id^="longdesc_edit_window"]',
          '.yui-panel-container.shadow', '.yui-dialog', '.mask',
          '.yui3-widget-mask', '.ui-widget-overlay', '.tp-gfx-killed'];
        var css = SEL.map(function (s) { return 'html.tp-gfx-loading ' + s; }).join(',') + '{' + HIDE + '}';
        var sty = GIDOC.getElementById('tp-gfx-hide');
        if (!sty) {
          sty = GIDOC.createElement('style');
          sty.id = 'tp-gfx-hide';
          GIDOC.head.appendChild(sty);
        }
        sty.textContent = css;
        _nativeGfxSty = sty;
        try { GIDOC.documentElement.classList.add('tp-gfx-loading'); } catch (e) {}
        function kill() {
          var f = GIDOC.querySelector('form[id^="form_editEl_"]');
          if (f) {
            var c = f;
            while (c && c.parentElement && c.parentElement.tagName !== 'BODY') c = c.parentElement;
            if (c && c !== GIDOC.body && !c.classList.contains('tp-gfx-killed')) c.classList.add('tp-gfx-killed');
          }
          GIDOC.querySelectorAll('[id^="longdesc_edit_window"], .yui3-widget-mask, .ui-widget-overlay').forEach(function (n) {
            if (!n.classList.contains('tp-gfx-killed')) n.classList.add('tp-gfx-killed');
          });
        }
        var killIv = setInterval(kill, 25);
        _nativeGfxKillIv = killIv;
        var p1 = 0;
        var ivOpen = setInterval(function () {
          p1++;
          var nm = GIDOC.getElementById('showMenuSub_' + nodeId);
          if (nm) { try { nm.click(); } catch (e) {} }
          var edl = GIDOC.getElementById('editEl_' + nodeId);
          if (edl) { clearInterval(ivOpen); try { edl.click(); } catch (e) {} kill(); waitForm(); }
          else if (p1 > 30) { clearInterval(ivOpen); finish(false); }
        }, 120);
        function waitForm() {
          var t = 0;
          var iv = setInterval(function () {
            t++; kill();
            var any = langs.map(function (l) { return GIDOC.getElementById('fg_id_shopsTr_' + l); }).filter(Boolean)[0];
            if (any || t > 45) { clearInterval(iv); finish(!!any); }
          }, 150);
        }
        function finish(ok) {
          // Upload idzie teraz czystym fetch (zweryfikowany saveParamGfx) — natywny
          // formularz służy już TYLKO do detekcji (sklepy/typy/istniejące grafiki),
          // więc po sparsowaniu niszczymy go: brak migania, brak wiecznego killIv.
          clearInterval(killIv);
          try { if (ok) parseNativeGfx(); } catch (e) {}
          try {
            var f = GIDOC.querySelector('form[id^="form_editEl_"]');
            var c = f;
            while (c && c.parentElement && c.parentElement.tagName !== 'BODY') c = c.parentElement;
            if (c && c !== GIDOC.body && c.parentNode) c.parentNode.removeChild(c);
          } catch (e) {}
          try { GIDOC.querySelectorAll('.tp-gfx-killed').forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); }); } catch (e) {}
          try { GIDOC.querySelectorAll('[id^="longdesc_edit_window"]').forEach(function (n) { n.remove(); }); } catch (e) {}
          try { GIDOC.documentElement.classList.remove('tp-gfx-loading'); } catch (e) {}
          try { if (_nativeGfxSty && _nativeGfxSty.parentNode) _nativeGfxSty.parentNode.removeChild(_nativeGfxSty); } catch (e) {}
          _nativeGfxSty = null;
          gfxReady = true;
          renderShopSelect();
        }
      })();

      function stash() { if (curLang) { st[curLang].name = inN.value; st[curLang].description = edD.getValue(); } }
      function paintTabs() {
        [].forEach.call(tabs.children, function (t) {
          t.classList.toggle('checked', t.dataset.lang === curLang);
        });
      }
      function loadLang(lg) { curLang = lg; inN.value = st[lg].name; edD.setValue(st[lg].description); paintTabs(); showGfxForLang(); }
      // Zbiera realne pliki grafik języka źródłowego z dt.langData[src] (icon_* per sklep),
      // pobiera je i wgrywa do każdego języka docelowego (tylko sklepy dostępne w tym języku)
      // zweryfikowanym przepisem saveParamGfx — czyli grafiki SĄ przenoszone fizycznie.
      function copyGfxFilesToLangs(src, others, ctxFilter) {
        var ctxAllow = ctxFilter && ctxFilter.length ? ctxFilter : ['search', 'projector'];
        var L = (dt.langData && dt.langData[src]) || {};
        function abs(u) { return u ? ('/' + String(u).replace(/^\/+/, '')) : ''; }
        function base(u) { return String(u).split('?')[0].split('/').pop() || ('gfx_' + nodeId + '.jpg'); }
        var jobs = []; // {ctx,sh,kind,url}
        ctxAllow.forEach(function (ctx) {
          var typeObj = L['icon_' + ctx + '_type'] || {};
          var single = L['icon_' + ctx] || {};
          var dObj = L['icon_' + ctx + '_desktop'] || {};
          var tObj = L['icon_' + ctx + '_tablet'] || {};
          var mObj = L['icon_' + ctx + '_mobile'] || {};
          var shset = {};
          [single, dObj, tObj, mObj].forEach(function (o) { Object.keys(o).forEach(function (s) { if (o[s]) shset[s] = true; }); });
          Object.keys(shset).forEach(function (sh) {
            var rwd = (typeObj[sh] === 'img_rwd') || (!typeObj[sh] && (dObj[sh] || tObj[sh] || mObj[sh]));
            if (rwd) {
              [['desktop', dObj], ['tablet', tObj], ['mobile', mObj]].forEach(function (pr) {
                if (pr[1][sh]) jobs.push({ ctx: ctx, sh: String(sh), kind: pr[0], url: abs(pr[1][sh]) });
              });
            } else if (single[sh]) {
              jobs.push({ ctx: ctx, sh: String(sh), kind: 'single', url: abs(single[sh]) });
            }
          });
        });
        if (!jobs.length && gfxData[src] && gfxData[src].img) {
          // fallback: realne URL-e z natywnego podglądu (po jednej grafice na sklep/kontekst)
          Object.keys(gfxData[src].img).forEach(function (sh) {
            ctxAllow.forEach(function (ctx) {
              var u = gfxData[src].img[sh] && gfxData[src].img[sh][ctx];
              if (u) jobs.push({ ctx: ctx, sh: String(sh), kind: 'single', url: String(u).split('?')[0] });
            });
          });
        }
        if (!jobs.length) return Promise.resolve({ ok: 0, fail: 0, total: 0 });
        // pary (job × język docelowy) z filtrem sklepów dostępnych w danym języku
        var tasks = [];
        others.forEach(function (lg) {
          var allowed = (gfxData[lg] && gfxData[lg].shops) ? gfxData[lg].shops.map(function (s) { return String(s.idx); }) : null;
          jobs.forEach(function (jb) {
            if (allowed && allowed.indexOf(jb.sh) === -1) return;
            tasks.push({ lg: lg, job: jb });
          });
        });
        if (!tasks.length) return Promise.resolve({ ok: 0, fail: 0, total: 0 });
        var blobCache = {};
        function getBlob(u) {
          if (blobCache[u]) return blobCache[u];
          blobCache[u] = fetch(u, { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' przy pobraniu ' + u);
            return r.blob();
          });
          return blobCache[u];
        }
        var ok = 0, fail = 0, i = 0;
        function next() {
          if (i >= tasks.length) return Promise.resolve({ ok: ok, fail: fail, total: tasks.length });
          var t = tasks[i++];
          if (_panel) _panel.showStatus('Kopiuję grafiki… ' + i + '/' + tasks.length + ' (' + getLangName(t.lg) + ', sklep ' + t.job.sh + ')');
          return getBlob(t.job.url).then(function (blob) {
            var f = new File([blob], base(t.job.url), { type: blob.type || 'image/jpeg' });
            return uploadOneFile(f, t.job.ctx, t.job.sh, t.job.kind, t.lg);
          }).then(function (res) {
            ok++;
            gfxData[t.lg] = gfxData[t.lg] || { shops: [], paths: {}, img: {}, spans: {} };
            gfxData[t.lg].img[t.job.sh] = gfxData[t.lg].img[t.job.sh] || {};
            gfxData[t.lg].img[t.job.sh][t.job.ctx] = ((res && res.path) || t.job.url) + (((res && res.path) || t.job.url).indexOf('?') > -1 ? '&' : '?') + 'tpv=' + Date.now();
            gfxEnable[t.lg] = gfxEnable[t.lg] || {}; gfxEnable[t.lg][t.job.sh] = gfxEnable[t.lg][t.job.sh] || {};
            gfxEnable[t.lg][t.job.sh][t.job.ctx] = 'y_manual';
            return next();
          }).catch(function (e) {
            fail++;
            if (typeof console !== 'undefined') console.warn('[parametry] kopia grafiki nieudana', t, e);
            return next();
          });
        }
        return next();
      }
      function copyActiveLangToAll() {
        stash();
        var src = curLang;
        var others = langs.filter(function (l) { return l !== src; });
        if (!others.length) { if (_panel) _panel.showStatus('Tylko jeden język — nie ma dokąd kopiować'); return; }

        function swRow(labelTxt, checked) {
          var row = d.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 2px;';
          var sw = d.createElement('label'); sw.className = 'tp-switch';
          var inp = d.createElement('input'); inp.type = 'checkbox'; inp.checked = !!checked;
          var tr = d.createElement('span'); tr.className = 'tp-switch-track';
          sw.appendChild(inp); sw.appendChild(tr);
          var lb = d.createElement('span');
          lb.style.cssText = 'font-size:13px;color:#344054;cursor:pointer;';
          lb.textContent = labelTxt;
          lb.addEventListener('click', function () { inp.checked = !inp.checked; });
          row.appendChild(sw); row.appendChild(lb);
          return { row: row, input: inp };
        }
        var box = d.createElement('div');
        var intro = d.createElement('div');
        intro.style.cssText = 'font-size:13px;color:#344054;line-height:1.5;margin-bottom:8px;';
        intro.innerHTML = 'Z języka <b>' + escapeHtml(getLangName(src)) + '</b> do <b>' + others.length +
          '</b> pozostałych. Zaznacz, co skopiować — nadpisze dane w językach docelowych (grafiki tylko dla sklepów, w których dany język jest dostępny):';
        box.appendChild(intro);
        var rName = swRow('Nazwa', true);
        var rDesc = swRow('Opis', true);
        var rList = swRow('Grafika na liście towarów', true);
        var rCard = swRow('Grafika na karcie towaru', true);
        [rName, rDesc, rList, rCard].forEach(function (r) { box.appendChild(r.row); });

        showConfirmModal(doc, {
          icon: 'content_copy',
          title: 'Powielić język?',
          subtitle: 'z „' + escapeHtml(getLangName(src)) + '" do ' + others.length + ' pozostałych',
          bodyEl: box,
          okLabel: 'Powiel',
          onOk: function () {
            var doName = rName.input.checked, doDesc = rDesc.input.checked;
            var ctxFilter = [];
            if (rList.input.checked) ctxFilter.push('search');
            if (rCard.input.checked) ctxFilter.push('projector');
            if (!doName && !doDesc && !ctxFilter.length) {
              if (_panel) _panel.showStatus('Nie wybrano nic do powielenia');
              return;
            }
            others.forEach(function (lg) {
              if (doName) st[lg].name = st[src].name;
              if (doDesc) st[lg].description = st[src].description;
              if (ctxFilter.length) {
                var tgtShops = (gfxData[lg] && gfxData[lg].shops) ? gfxData[lg].shops.map(function (s) { return String(s.idx); }) : Object.keys(gfxType[src] || {});
                gfxType[lg] = gfxType[lg] || {};
                tgtShops.forEach(function (sh) {
                  var sT = (gfxType[src] && gfxType[src][sh]) || {};
                  gfxType[lg][sh] = gfxType[lg][sh] || {};
                  ctxFilter.forEach(function (cx) { gfxType[lg][sh][cx] = sT[cx] || 'img_rwd'; });
                });
              }
            });
            var parts = [];
            if (doName) parts.push('nazwa');
            if (doDesc) parts.push('opis');
            if (ctxFilter.length) parts.push('grafiki');
            if (_panel) _panel.showStatus('Powielanie języka „' + getLangName(src) + '"… (' + parts.join(', ') + ')');

            function finishMsg(r) {
              loadLang(src);
              if (!_panel) return;
              var head = 'Powielono („' + getLangName(src) + '"): ' + (doName ? 'nazwa' : '') + (doName && doDesc ? ', ' : '') + (doDesc ? 'opis' : '');
              if (!ctxFilter.length) { _panel.showStatus((doName || doDesc) ? head : 'Powielono'); return; }
              if (r.total === 0) _panel.showStatus(((doName || doDesc) ? head + '; ' : '') + 'brak grafik do skopiowania');
              else if (r.fail) _panel.showStatus('Powielono. Grafiki: ' + r.ok + '/' + r.total + ' OK, ' + r.fail + ' błędów', true);
              else _panel.showStatus(((doName || doDesc) ? head + ' + ' : 'Powielono ') + r.ok + ' grafik');
            }
            if (!ctxFilter.length) { finishMsg({ ok: 0, fail: 0, total: 0 }); return; }
            copyGfxFilesToLangs(src, others, ctxFilter).then(finishMsg).catch(function (e) {
              loadLang(src);
              if (_panel) _panel.showStatus('Powielono nazwę/opis; kopiowanie grafik przerwane: ' + (e.message || e), true);
            });
          }
        });
      }
      [].forEach.call(tabs.children, function (t) {
        t.addEventListener('click', function () { stash(); loadLang(t.dataset.lang); inN.focus(); });
      });
      loadLang(curLang);
      var footer = d.createElement('div');
      footer.className = 'tp-modal-footer';
      var cancel = d.createElement('button');
      cancel.className = 'tp-btn-modal-secondary'; cancel.type = 'button'; cancel.textContent = 'Anuluj';
      var ok = d.createElement('button');
      ok.className = 'tp-btn-modal-primary'; ok.type = 'button'; ok.textContent = 'Zapisz';
      footer.appendChild(cancel); footer.appendChild(ok);

      modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer);
      overlay.appendChild(modal); d.body.appendChild(overlay);

      function close() { try { edD.destroy(); } catch (e) {} try { cleanupNativeGfx(); } catch (e) {} overlay.classList.add('tp-closing'); setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 180); }
      header.querySelector('.tp-modal-header-close').addEventListener('click', close);
      cancel.addEventListener('click', close);
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
      setTimeout(function () { inN.focus(); inN.select(); }, 30);

      ok.addEventListener('click', function () {
        stash();
        // DIAGNOSTYKA v4.6.27: co realnie przechwyci\u0142 edytor (do raportu u\u017cytkownika)
        var _dCur = (st[curLang] && st[curLang].description) || '';
        var _dSample = _dCur.replace(/\s+/g, ' ').slice(0, 60);
        try {
          console.log('[parametry][opis] v4.6.27 nodeId=' + nodeId + ' curLang=' + curLang +
            ' len=' + _dCur.length + ' sample="' + _dSample + '"',
            { allLangsLen: langs.map(function (l) { return l + ':' + ((st[l] && st[l].description) || '').length; }) });
        } catch (e) {}
        ok.disabled = true; ok.textContent = 'Zapisywanie\u2026';
        var nameBody = 'action=setSettings&id=' + encodeURIComponent(nodeId) + '&menuSection=true';
        langs.forEach(function (lg) { nameBody += '&names[' + lg + ']=' + encodeURIComponent(st[lg].name); });
        // v4.6.6: typy grafik z natywnych radiów (icon_type_<lang>_<shop>_<ctx>)
        // v4.6.14: typ grafiki wysyłany tylko gdy kontekst włączony (Wyłączona = pomijamy)
        langs.forEach(function (lg) {
          var sh = gfxType[lg] || {};
          Object.keys(sh).forEach(function (shop) {
            ['search', 'projector'].forEach(function (cx) {
              var en = gfxEnable[lg] && gfxEnable[lg][shop] && gfxEnable[lg][shop][cx];
              if (!en || en === 'n') return;
              var v = sh[shop] && sh[shop][cx];
              if (v) nameBody += '&icon_' + cx + '_type[' + lg + '][' + shop + ']=' + encodeURIComponent(v);
            });
          });
        });
        // v4.6.22: zawsze wysyłaj opis dla wszystkich języków (setDescription jest
        // idempotentne i zweryfikowane) — filtr po różnicy bywał zawodny (edytor
        // nie zawsze flushował zmiany na czas) i opis się „nie zapisywał".
        var descLangs = langs.slice();
        // v4.6.25: OPIS zapisujemy NIEZALE\u017bNIE od wyniku setSettings \u2014 b\u0142\u0105d nazw/
        // typ\u00f3w grafik NIE mo\u017ce blokowa\u0107 zapisu opisu (wcze\u015bniej throw przerywa\u0142
        // \u0142a\u0144cuch przed setDescription \u2192 \u201eopis si\u0119 nie zapisuje").
        var settingsErr = null;
        try { console.log('[parametry][opis] v4.6.27 nameBody=', nameBody.slice(0, 300)); } catch (e) {}
        fetchAjax(nameBody).then(function (r1) {
          try { console.log('[parametry][opis] v4.6.27 setSettings resp=', r1); } catch (e) {}
          if (r1 && r1.errno && r1.errno !== 0) settingsErr = (r1.message || ('errno ' + r1.errno));
        }, function (e) { settingsErr = (e && e.message) || String(e); try { console.warn('[parametry][opis] v4.6.27 setSettings REJECT', e); } catch (_) {} }).then(function () {
          return descLangs.reduce(function (p, lg) {
            return p.then(function () {
              var dBody = 'action=setDescription&id=' + encodeURIComponent(nodeId) + '&lang=' + lg + '&description=' + encodeURIComponent(st[lg].description || '');
              try { console.log('[parametry][opis] v4.6.27 ->setDescription', lg, 'len=' + ((st[lg].description || '').length), 'body=' + dBody.slice(0, 200)); } catch (e) {}
              return fetchAjax(dBody)
                .then(function (rd) {
                  try { console.log('[parametry][opis] v4.6.27 <-setDescription', lg, 'resp=', rd); } catch (e) {}
                  if (rd && rd.errno && rd.errno !== 0) throw new Error('opis ' + lg + ': ' + (rd.error || rd.message || ('errno ' + rd.errno)));
                }, function (e) { try { console.warn('[parametry][opis] v4.6.27 setDescription REJECT', lg, e); } catch (_) {} throw e; });
            });
          }, Promise.resolve());
        }).then(function () {
          var newName = (st[LANG] && st[LANG].name) || st[curLang].name;
          var sm = doc.getElementById('showMenuSub_' + nodeId);
          if (sm) sm.textContent = newName;
          var li = doc.getElementById('m_' + nodeId);
          if (li) { var lbl = li.querySelector(':scope > .tp-col-name .tp-row-label'); if (lbl) lbl.textContent = newName; }
          try { tpCacheClearAll(); } catch (e) {}
          var _opisInfo = ' [v4.6.27 opis ' + curLang + ': ' + _dCur.length + ' zn.]';
          if (_panel) _panel.showStatus((settingsErr
            ? ('Zapisano opis; ustawienia nazw/grafik z b\u0142\u0119dem: ' + settingsErr)
            : ('Zapisano zmiany elementu \u201e' + newName + '\u201d')) + _opisInfo, !!settingsErr);
          close();
        }).catch(function (e) {
          ok.disabled = false; ok.textContent = 'Zapisz';
          alert('B\u0142\u0105d zapisu opisu: ' + (e.message || e));
        });
      });
    }).catch(function (e) { alert('B\u0142\u0105d wczytywania: ' + (e.message || e)); });
  }

  // v4.5.47: bardziej cierpliwe + reaktywne wykrywanie #block_group0. Bez sztywnego limitu
  // attempts: polling co 250 ms + MutationObserver na document + iframe.load — żeby skrypt
  // odpalił się gdy IdoSell w końcu wstrzyknie drzewo, bez konieczności drugiego refresha.
  function waitForIframe(cb) {
    var fired = false;

    function findDoc() {
      if (document.querySelector('#block_group0')) return document;
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          var d = iframes[i].contentDocument;
          if (d && d.querySelector('#block_group0')) return d;
        } catch (e) {}
      }
      return null;
    }

    function tryFire() {
      if (fired) return false;
      var doc = findDoc();
      if (!doc) return false;
      fired = true;
      try { cb(doc); } catch (e) { console.error('[parametry] init error', e); }
      return true;
    }

    if (tryFire()) return;

    var pollTimer = setInterval(function () { if (tryFire()) clearInterval(pollTimer); }, 250);

    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () { if (tryFire()) { mo.disconnect(); clearInterval(pollTimer); } });
      try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    }

    function bindIframeLoads() {
      document.querySelectorAll('iframe').forEach(function (ifr) {
        if (ifr.__tpLoadHooked) return;
        ifr.__tpLoadHooked = true;
        ifr.addEventListener('load', function () { setTimeout(tryFire, 50); }, true);
      });
    }
    bindIframeLoads();
    var rebindTimer = setInterval(bindIframeLoads, 500);
    setTimeout(function () { clearInterval(rebindTimer); }, 60000);
  }

  // ============================================================
  // v4.0.0: panel-pro widget integration
  // ============================================================
  var _panel = null;
  function getPanel() { return _panel; }

  function mountPanelPro(doc, attempt) {
    attempt = attempt || 0;
    if (typeof PanelPro === 'undefined') {
      console.error('[parametry] PanelPro widget not loaded (@require failed)');
      return null;
    }
    var mountTarget = doc.querySelector('#product_parameters_container');
    var treeRoot = doc.querySelector('#block_group0');
    if (!mountTarget || !treeRoot) {
      if (attempt > 30) {
        console.error('[parametry] mountTarget or treeRoot not found after 30 retries');
        return null;
      }
      setTimeout(function () { _panel = mountPanelPro(doc, attempt + 1); enhanceAllRows(doc); }, 500);
      return null;
    }

    var panel = PanelPro.mount(doc, {
      mountTarget: mountTarget,
      treeRoot: treeRoot,
      opsBar: {
        right: {
          label: 'Operacje na drzewie',
          buttons: [
            { icon: 'sort_by_alpha', label: 'Sortuj alfabetycznie', tooltip: 'Posortuj wg nazwy (A→Z / Z→A)', variant: 'text',    onClick: function () { sortAlphabetically(doc); } },
            { icon: 'tag',           label: 'Sortuj po ID',        tooltip: 'Posortuj wg ID (rosnąco / malejąco)', variant: 'text', onClick: function () { sortById(doc); } },
            { icon: 'add',           label: 'Dodaj parametr',       tooltip: 'Dodaj nowy parametr', variant: 'primary', onClick: function () { createNewParameter(doc); } }
          ]
        }
      },
      toolbar: {
        search: {
          placeholder: 'Szukaj parametrów i ich wartości po nazwie lub id',
          onChange: function (q) { filterTree(doc, q); }
        },
        sections: [
          { buttons: [
            { icon: 'select_all', tooltip: 'Zaznacz wszystkie widoczne', variant: 'icon', onClick: function () { selectAll(doc); } },
            { icon: 'deselect',   tooltip: 'Odznacz wszystko',           variant: 'icon', onClick: function () { deselectAll(doc); } },
            { icon: 'swap_horiz', tooltip: 'Odwr\u00f3\u0107 zaznaczenie', variant: 'icon', onClick: function () { invertSelection(doc); } }
          ] },
          { buttons: [
            { icon: 'download', label: 'Eksport', tooltip: 'Eksport parametr\u00f3w \u2014 wyb\u00f3r zakresu, formatu i j\u0119zyk\u00f3w', variant: 'text', onClick: function () { showExportModal(doc, 'all'); } },
            { icon: 'upload',   label: 'Import',  tooltip: 'Import parametr\u00f3w z pliku JSON lub CSV',   variant: 'text', onClick: function () { openImportFilePicker(doc); } }
          ] },
          { dropdown: {
            icon: 'visibility',
            options: [ { value: 'all', label: 'Wszystko', active: true } ],
            onChange: function (v) { /* handled by rebuildViewsDropdown */ }
          } },
          { columnsMenu: true },
          { buttons: [
            { id: 'expand-all',   icon: 'keyboard_double_arrow_up',   tooltip: 'Zwi\u0144 wszystko',   variant: 'icon', onClick: function () { collapseAll(doc); } },
            { id: 'collapse-all', icon: 'keyboard_double_arrow_down', tooltip: 'Rozwi\u0144 wszystko', variant: 'icon', onClick: function (e, api) {
                var stop = api.findToolbarBtn('stop-expand'); if (stop) stop.style.display = '';
                expandAll(doc).then(function () { if (stop) stop.style.display = 'none'; });
              } },
            { id: 'stop-expand',  icon: 'stop',                       tooltip: 'Przerwij',             variant: 'icon', onClick: function (e, api) { stopExpand(); var b = api.findToolbarBtn('stop-expand'); if (b) b.style.display = 'none'; } }
          ] }
        ]
      },
      columnsMenu: {
        key: 'tp.cols.parametry',
        toggleable: ['id', 'children', 'products', 'context', 'gfx', 'desc'],
        tooltip: 'Poka\u017c / ukryj kolumny'
      },
      selectionBar: {
        selectedLabel: 'Liczba wybranych element\u00f3w {n}',
        actions: [
          { icon: 'edit',            label: 'Edytuj',   tooltip: 'Grupowa edycja zaznaczonych',     variant: 'primary', onClick: function () { showBulkEditModal(doc); } },
          { icon: 'drive_file_move', label: 'Przenie\u015b', tooltip: 'Przenie\u015b zaznaczone warto\u015bci', variant: 'accent',  onClick: function () { showBulkMoveModal(doc); } },
          { icon: 'delete',        label: 'Usu\u0144', tooltip: 'Usu\u0144 zaznaczone',           variant: 'danger',  onClick: function () { showBulkDeleteModal(doc); } }
        ],
        extraActions: [
          { icon: 'download', label: 'Eksport', tooltip: 'Eksport zaznaczonych (wybór formatu i języków)', onClick: function () { showExportModal(doc, 'selected'); } }
        ],
        onClear: function () { deselectAll(doc); }
      },
      columns: [
        { id: 'drag',     label: '',         width: '24px' },
        { id: 'check',    label: '',         width: '40px' },
        { id: 'expand',   label: '',         width: '32px' },
        { id: 'name',     label: 'Nazwa',    hint: '(Dwuklik na nazw\u0119 = edycja)', width: '1fr' },
        { id: 'id',       label: 'ID',       width: '80px' },
        { id: 'children', label: 'Dzieci',   width: '80px' },
        { id: 'products', label: 'Produkty', width: '90px' },
        { id: 'context',  label: 'Kontekst', width: '90px' },
        { id: 'gfx',      label: 'Grafika',  width: '95px' },
        { id: 'desc',     label: 'Opis',     width: '60px' },
        { id: 'actions',  label: 'Akcje',    width: '220px' }
      ],
      pagination: { perPage: 50 },
      footer: {
        version: 'v4.6.27',
        links: []
      }
    });
    var stopBtn = panel.findToolbarBtn('stop-expand');
    if (stopBtn) stopBtn.style.display = 'none';

    injectHeaderSelectAll(doc, panel);
    refreshPagination(doc, panel);

    // v4.5.54: odsłaniamy widok od razu po mount. Kolumny doczytają się w tle.
    try { console.log('[parametry v4.5.54] mount success — reveal'); } catch (e) {}
    _tpRevealReadyView();

    return panel;
  }

  function injectHeaderSelectAll(doc, panel) {
    var checkCol = panel.tableHeader.querySelector('.panel-pro__col--check');
    if (!checkCol) return;
    checkCol.innerHTML = '';
    var cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'tp-checkbox';
    cb.title = 'Zaznacz/Odznacz wszystko';
    cb.addEventListener('change', function () {
      if (cb.checked) selectAll(doc); else deselectAll(doc);
    });
    checkCol.appendChild(cb);
  }

  function refreshPagination(doc, panel) {
    if (!panel || !panel.paginationContainer) return;
    panel.renderPagination(
      { page: _paginationState.currentPage, perPage: _paginationState.perPage, total: _paginationState.totalVisible },
      {
        perPageOptions: [10, 25, 50, 100, 200, 0],
        onPageChange: function (p) { _paginationState.currentPage = p; applyPagination(doc); },
        onPerPageChange: function (n) { _paginationState.perPage = n; _paginationState.currentPage = 1; savePerPagePref(n); applyPagination(doc); }
      }
    );
  }

  // v4.5.2 / v4.5.53: background loader for children counts.
  // Akceptuje opcjonalną listę wierszy (do priorytetu strony widocznej).
  async function loadChildrenCountsInBackground(doc, rowsList) {
    if (!_panel) return;
    var rootItems = rowsList || getRootItems(doc);
    var BATCH = 20;
    for (var i = 0; i < rootItems.length; i += BATCH) {
      var batch = rootItems.slice(i, i + BATCH);
      await Promise.all(batch.map(async function (li) {
        var nid = getNodeId(li); if (!nid) return;
        var cell = li.querySelector(':scope > .tp-col-children');
        if (!cell || !cell.classList.contains('tp-col-children--empty')) return;
        try {
          var children = await loadChildValues(nid);
          if (children && children.length > 0) {
            cell.textContent = String(children.length);
            cell.classList.remove('tp-col-children--empty');
          } else {
            cell.textContent = '0';
          }
        } catch (e) {}
      }));
      // v4.5.93: po każdej paczce odśwież licznik "Wszystkich wartości"
      try { updateCounter(doc); } catch (e) {}
    }
  }

  // v4.5.31: background loader for parameter product counts
  // Native IdoSell exposes #products_<id> only for values; parameters start with \u2014.
  // Fill via numberOfOccurrence so users can see how many products use each parameter.
  // v4.5.31 -> v4.5.35: product count for parameters.
  // numberOfOccurrence returns 0 for parameter nodes (IdoSell only populates it for values),
  // so sum up the counts from the parameter's child values instead.
  async function fetchValueProductCount(valueId) {
    // v4.5.55: cache TTL 30 min
    var cached = tpCacheGet('pr', valueId, TP_TTL_PRODUCTS);
    if (cached !== null) return cached;
    try {
      var r = await fetchAjax('action=numberOfOccurrence&id=' + encodeURIComponent(valueId));
      var n = (r && r.data && r.data.numberOfProduct) ? Number(r.data.numberOfProduct) : 0;
      var raw = r && r.data ? r.data.products : null;
      var ids = [];
      if (Array.isArray(raw)) {
        ids = raw.map(function (p) { return String(typeof p === 'object' ? (p.id || p.product_id) : p); });
      } else if (raw && typeof raw === 'object') {
        ids = Object.keys(raw).map(function (k) {
          var p = raw[k];
          return String(typeof p === 'object' ? (p.id || p.product_id) : p);
        });
      }
      var result = { count: n, productIds: ids };
      tpCacheSet('pr', valueId, result);
      return result;
    } catch (e) { return { count: 0, productIds: [] }; }
  }

  // v4.5.48: kontekst specjalny per parametr/wartość
  // Endpoint: action=getParameterLangData&id=<nodeId> zwraca context_id (parametr) / context_value_id (wartość)
  var _ctxCache = {}; // nodeId -> { ctx: 'CONTEXT_X' | null, labelType: 'param' | 'value' }
  var CONTEXT_LABELS = {
    'CONTEXT_COLOR': 'Kolor',
    'CONTEXT_MODEL': 'Model',
    'CONTEXT_SEASON': 'Sezon',
    'CONTEXT_SEX': 'Płeć',
    'CONTEXT_STATE': 'Stan',
    'CONTEXT_AGE_GROUP': 'Grupa wiekowa',
    'CONTEXT_ONLY_ADULTS': 'Tylko dla dorosłych',
    'HEEL_HEIGHT': 'Wysokość obcasa (cm)',
    'CONTEXT_ENERGY_EFFICIENCY_CLASS': 'Klasa energetyczna',
    'CONTEXT_DOCUMENTS_JPK_VAT': 'Oznaczenie JPK_VAT',
    'CONTEXT_MOVIE_RELEASE_DATE': 'Film: data wydania',
    'CONTEXT_MOVIE_ORIGINAL_TITLE': 'Film: tytuł oryginalny',
    'CONTEXT_BOOK_AUTHOR': 'Książka: autor',
    'CONTEXT_BOOK_PUBLICATION_DATE': 'Książka: data wydania',
    'CONTEXT_BOOK_PAGES_NUMBER': 'Książka: liczba stron',
    'CONTEXT_BOOK_PUBLICATION_LANGUAGE': 'Książka: język wydania',
    'CONTEXT_PRESCRIPTION_MEDICINE': 'Lek na receptę',
    'CONTEXT_STD_UNIT_LENGTH': 'Długość (m)',
    'CONTEXT_STD_UNIT_LENGTH_CM': 'Długość (cm)',
    'CONTEXT_STD_UNIT_HEIGHT_CM': 'Wysokość (cm)',
    'CONTEXT_STD_UNIT_WIDTH_CM': 'Szerokość (cm)',
    'CONTEXT_STD_UNIT_AREA_M2': 'Powierzchnia (m²)',
    'CONTEXT_STD_UNIT_VOLUME': 'Objętość (ml)',
    'CONTEXT_STD_UNIT_VOLUME_SI': 'Objętość (l)',
    'CONTEXT_STD_UNIT_VOLUME_M3': 'Objętość (m³)',
    'CONTEXT_STD_UNIT_WEIGHT': 'Waga (g)',
    'CONTEXT_STD_UNIT_WEIGHT_SI': 'Waga (kg)',
    'CONTEXT_STD_UNIT_QUANTITY_PACKAGE': 'Sztuk w opakowaniu',
    'CONTEXT_STD_OVERHEAD_WEIGHT': 'Waga gabarytowa',
    'CONTEXT_WEIGHT_NET': 'Waga netto',
    'CONTEXT_WEIGHT_PACKAGING': 'Waga opakowania',
    'CONTEXT_MAX_QUANTITY_PER_RETAIL_ORDER': 'Max ilość / zamów. detal',
    'CONTEXT_MAX_QUANTITY_PER_WHOLESALE_ORDER': 'Max ilość / zamów. hurt',
    'CONTEXT_MAX_SIZE_QUANTITY_PER_RETAIL_ORDER': 'Max rozmiar / zamów. detal',
    'CONTEXT_MAX_SIZE_QUANTITY_PER_WHOLESALE_ORDER': 'Max rozmiar / zamów. hurt',
    'CONTEXT_MIN_QUANTITY_PER_RETAIL_ORDER': 'Min ilość / zamów. detal',
    'CONTEXT_MIN_QUANTITY_PER_WHOLESALE_ORDER': 'Min ilość / zamów. hurt',
    'CONTEXT_MIN_SIZE_QUANTITY_PER_RETAIL_ORDER': 'Min rozmiar / zamów. detal',
    'CONTEXT_MIN_SIZE_QUANTITY_PER_WHOLESALE_ORDER': 'Min rozmiar / zamów. hurt',
    'CONTEXT_AGE_GROUP_ADULT': 'Dorośli',
    'CONTEXT_AGE_GROUP_MINOR': 'Dzieci',
    'CONTEXT_SEX_MAN': 'Mężczyzna',
    'CONTEXT_SEX_WOMAN': 'Kobieta',
    'CONTEXT_SEX_UNISEX': 'Unisex',
    'CONTEXT_STATE_NEW': 'Nowy',
    'CONTEXT_STATE_NEW_OTHERS': 'Nowy: inne',
    'CONTEXT_STATE_NEW_WITH_DEFECTS': 'Nowy z wadą',
    'CONTEXT_STATE_USED': 'Używany',
    'CONTEXT_STATE_REFURBISHED_BY_PRODUCER': 'Odnowiony przez producenta',
    'CONTEXT_STATE_REFURBISHED_BY_SELLER': 'Odnowiony przez sprzedawcę',
    'CONTEXT_STATE_FOR_PARTS_OR_BROKEN': 'Na części / zepsuty',
    'CONTEXT_SEASON_SPRING': 'Wiosna',
    'CONTEXT_SEASON_SUMMER': 'Lato',
    'CONTEXT_SEASON_FALL': 'Jesień',
    'CONTEXT_SEASON_WINTER': 'Zima',
    'CONTEXT_SEASON_SPRING_SUMMER': 'Wiosna/Lato',
    'CONTEXT_SEASON_FALL_WINTER': 'Jesień/Zima',
    'CONTEXT_ONLY_ADULTS_YES': 'Tak (dla dorosłych)',
    'CONTEXT_ONLY_ADULTS_NO': 'Nie (dla dorosłych)',
    'CONTEXT_PRESCRIPTION_MEDICINE_YES': 'Tak (recepta)',
    'CONTEXT_PRESCRIPTION_MEDICINE_NO': 'Nie (recepta)',
    'CONTEXT_STD_UNIT_DEFAULT': 'Domyślnie',
    'CONTEXT_STD_UNIT_WHOLE': 'Cena za jednostkę',
    'CONTEXT_STD_UNIT_TENS': 'Cena za 10 jednostek',
    'CONTEXT_STD_UNIT_HUNDREDS': 'Cena za 100 jednostek',
    'CONTEXT_STD_UNIT_ONES': 'Cena za 1 jednostkę'
  };
  function contextLabel(ctx) { return ctx ? (CONTEXT_LABELS[ctx] || ctx) : ''; }

  // v4.6.16: jedno żądanie getParameterLangData dostarcza: kontekst, status opisu i grafik
  function _metaFromLangData(d) {
    var ctx = (d.type === 'value' ? d.context_value_id : d.context_id) || null;
    var descSet = false, anyGfxField = false, hasList = false, hasCard = false;
    var ld = d.langData || {};
    Object.keys(ld).forEach(function (lg) {
      var L = ld[lg] || {};
      if (L.description != null && String(L.description).replace(/<[^>]*>/g, '').trim() !== '') descSet = true;
      ['icon_search', 'icon_projector'].forEach(function (kk) {
        if (L[kk] && typeof L[kk] === 'object') {
          anyGfxField = true;
          Object.keys(L[kk]).forEach(function (sh) {
            if (L[kk][sh] && String(L[kk][sh]).trim() !== '') {
              if (kk === 'icon_search') hasList = true; else hasCard = true;
            }
          });
        }
      });
    });
    var gfx = !anyGfxField ? null : (hasList && hasCard ? 'both' : hasList ? 'list' : hasCard ? 'card' : 'none');
    return { ctx: ctx, type: d.type, descSet: descSet, gfx: gfx };
  }
  async function fetchContextForNode(nodeId) {
    if (_ctxCache[nodeId]) return _ctxCache[nodeId];
    // v4.6.16: cache scope 'cx2' (stare 'ctx' bez descSet/gfx ignorujemy)
    var cached = tpCacheGet('cx2', nodeId, TP_TTL_CTX);
    if (cached !== null) { _ctxCache[nodeId] = cached; return cached; }
    try {
      var r = await fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(nodeId));
      var d = r && r.data ? r.data : null;
      if (!d) { _ctxCache[nodeId] = { ctx: null, descSet: false, gfx: null }; tpCacheSet('cx2', nodeId, _ctxCache[nodeId]); return _ctxCache[nodeId]; }
      _ctxCache[nodeId] = _metaFromLangData(d);
      tpCacheSet('cx2', nodeId, _ctxCache[nodeId]);
      return _ctxCache[nodeId];
    } catch (e) {
      _ctxCache[nodeId] = { ctx: null, descSet: false, gfx: null };
      return _ctxCache[nodeId];
    }
  }

  function renderContextCell(cell, ctx) {
    if (!cell) return;
    cell.innerHTML = '';
    if (!ctx) return;
    var label = contextLabel(ctx);
    var icon = cell.ownerDocument.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = 'verified';
    icon.style.cssText = 'font-size:18px;color:#7c3aed;cursor:help';
    icon.setAttribute('data-pp-tooltip', label + ' (' + ctx + ')');
    cell.appendChild(icon);
  }

  function renderGfxCell(cell, gfx) {
    if (!cell) return;
    cell.innerHTML = '';
    var map = {
      both: { t: 'obie', c: '#137333', i: 'check_circle' },
      list: { t: 'na liście', c: '#1a73e8', i: 'image' },
      card: { t: 'na karcie', c: '#1a73e8', i: 'image' },
      none: { t: 'brak', c: '#9aa0a6', i: 'block' }
    };
    if (gfx == null) { cell.textContent = '–'; cell.setAttribute('data-pp-tooltip', 'Status grafik niedostępny w API'); return; }
    var m = map[gfx] || map.none;
    var s = cell.ownerDocument.createElement('span');
    s.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:' + m.c + ';';
    s.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;color:' + m.c + '">' + m.i + '</span>' + m.t;
    s.setAttribute('data-pp-tooltip', 'Grafiki: ' + m.t);
    cell.appendChild(s);
  }

  function renderDescCell(cell, descSet) {
    if (!cell) return;
    cell.innerHTML = '';
    var s = cell.ownerDocument.createElement('span');
    if (descSet) {
      s.className = 'material-symbols-outlined';
      s.textContent = 'description';
      s.style.cssText = 'font-size:17px;color:#137333;cursor:help';
      s.setAttribute('data-pp-tooltip', 'Opis ustawiony');
    } else {
      s.textContent = '–';
      s.style.cssText = 'font-size:13px;color:#9aa0a6;cursor:help';
      s.setAttribute('data-pp-tooltip', 'Brak opisu');
    }
    cell.appendChild(s);
  }

  // v4.5.49: skanujemy WSZYSTKIE wiersze (parametry + wartości) — fetchContextForNode rozróżnia
  // context_id vs context_value_id po polu type. BATCH 5 -> 15.
  async function loadContextsInBackground(doc, liList) {
    if (!_panel) return;
    var items = liList || Array.from(doc.querySelectorAll('#block_group0 li[id^="m_"]'));
    var targets = [];
    items.forEach(function (li) {
      var nid = getNodeId(li); if (!nid) return;
      var cell = li.querySelector(':scope > .tp-col-context');
      if (!cell) return;
      if (cell.dataset.ctxLoaded === '1') return;
      targets.push({ nid: nid, cell: cell, li: li });
    });
    var BATCH = 20;
    for (var i = 0; i < targets.length; i += BATCH) {
      var batch = targets.slice(i, i + BATCH);
      await Promise.all(batch.map(async function (t) {
        try {
          var info = await fetchContextForNode(t.nid);
          t.cell.dataset.ctxLoaded = '1';
          renderContextCell(t.cell, info.ctx);
          var gC = t.li.querySelector(':scope > .tp-col-gfx');
          if (gC) renderGfxCell(gC, info.gfx);
          var dC = t.li.querySelector(':scope > .tp-col-desc');
          if (dC) renderDescCell(dC, info.descSet);
        } catch (e) {}
      }));
    }
  }

  // v4.5.49 / v4.5.53: batched-parallel, akceptuje opcjonaln\u0105 list\u0119 wierszy
  async function loadParameterProductCountsInBackground(doc, rowsList) {
    if (!_panel) return;
    var rootItems = rowsList || getRootItems(doc);
    var targets = [];
    rootItems.forEach(function (li) {
      var nid = getNodeId(li); if (!nid) return;
      if (!isParameter(doc, nid)) return;
      var cell = li.querySelector(':scope > .tp-col-products');
      if (!cell) return;
      if (cell.dataset.countLoaded === '1') return;
      if (cell.querySelector('a')) { cell.dataset.countLoaded = '1'; return; }
      targets.push({ nid: nid, cell: cell });
    });

    async function processOne(t) {
      try {
        // v4.5.92: liczba przy parametrze = SUMA natywnych "towary: N" jego warto\u015bci
        // (z treeCode). Zweryfikowane na \u017cywym panelu: numberOfOccurrence jest
        // zawodne w obie strony \u2014 zawy\u017ca (warto\u015b\u0107 "Nie": natywnie 6, occ=11;
        // parametr-level=15) lub zwraca 0 (demo37). Natywne "towary: N" pokrywa
        // si\u0119 z wierszami warto\u015bci i z list\u0105 towar\u00f3w po klikni\u0119ciu (trait=).
        var total = 0;
        var children = await loadChildValues(t.nid);
        if (children && children.length > 0) {
          for (var k = 0; k < children.length; k++) {
            total += Number(children[k].productCount) || 0;
          }
        }
        t.cell.dataset.countLoaded = '1';
        t.cell.textContent = '';
        if (total > 0) {
          var link = doc.createElement('a');
          link.href = 'products-list.php?trait=' + encodeURIComponent(t.nid);
          link.target = '_blank';
          link.rel = 'noopener';
          link.textContent = String(total);
          link.title = 'Poka\u017c produkty u\u017cywaj\u0105ce parametru (nowa karta)';
          link.addEventListener('click', function (e) { e.stopPropagation(); });
          t.cell.appendChild(link);
        } else {
          t.cell.textContent = '0';
        }
      } catch (e) {}
    }

    var BATCH = 20;
    for (var i = 0; i < targets.length; i += BATCH) {
      var batch = targets.slice(i, i + BATCH);
      await Promise.all(batch.map(processOne));
    }
  }

  waitForIframe(function (doc) {
    loadMaterialFont(doc);
    injectStyles(doc);
    var _pageHeaderEl = buildPageHeader(doc);
    _panel = mountPanelPro(doc);
    // v4.5.70: nagłówek "Parametry" + przełącznik języka w jednej linii z belką operacji
    if (_pageHeaderEl) relocateHeaderIntoOpsBar(_panel, _pageHeaderEl);
    enhanceAllRows(doc);
    observeNewNodes(doc);
    hookNativeDeleteButtons(doc);
    updateCounter(doc);
    if (_panel) rebuildViewsDropdown(doc);
    // v4.5.36: initial pagination — without this, totalVisible=0 -> pager empty until first search
    applyPagination(doc);

    // v4.5.54: loadery w tle, niemal natychmiast po reveal (widok ju\u017c widoczny)
    setTimeout(function () {
      loadChildrenCountsInBackground(doc);
      loadParameterProductCountsInBackground(doc);
      loadContextsInBackground(doc);
    }, 50);
    // v4.5.31: sections panel below parameters list — mount immediately
    mountSectionsPanel(doc);
    // v4.5.84: globalny footer na samym dole strony
    mountGlobalFooter(doc);
    // v4.5.14: auto-sort after import
    try {
      if (sessionStorage.getItem('tp.autoSortAfterReload') === '1') {
        sessionStorage.removeItem('tp.autoSortAfterReload');
        setTimeout(function () {
          sortAlphabetically(doc);
          if (_panel) _panel.showStatus('Import zakończony — posortowano alfabetycznie');
        }, 500);
      }
    } catch (e) {}
  });

})();
