// ==UserScript==
// @name         Parametry PRO
// @namespace    https://idosell.com/
// @version      4.6.175
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

  // ═════════════════════════════════════════════════════════════════════════
  // LICENSING — system tierów i feature flags
  // Docelowo (CF Worker): JWT przy starcie + okazjonalna walidacja online.
  // Aktualnie: dev mode = enterprise (wszystkie funkcje). Override przez
  //   localStorage.setItem('tp-license-dev-tier', 'basic'); // lub trial/pro/own
  //   localStorage.setItem('tp-license-own-features', JSON.stringify([...]));
  // i przeładuj stronę.
  // ═════════════════════════════════════════════════════════════════════════
  var FEATURES = {
    // === Core (zawsze) ===
    TREE_VIEW: 'tree_view',
    SEARCH: 'search',
    INLINE_RENAME: 'inline_rename',
    COPY_ID: 'copy_id',
    // === Sort / view ===
    SORT_ALPHABETICALLY: 'sort_alphabetically',
    SORT_BY_ID: 'sort_by_id',
    SORT_VALUES_ALPHA: 'sort_values_alpha',
    SORT_VALUES_BY_ID: 'sort_values_by_id',
    EXPAND_ALL: 'expand_all',
    COLLAPSE_ALL: 'collapse_all',
    SECTION_VIEWS: 'section_views',
    COLUMNS_MENU: 'columns_menu',
    // === Element creation / deletion ===
    CREATE_PARAMETER: 'create_parameter',
    ADD_VALUE: 'add_value',
    DELETE_ELEMENT: 'delete_element',
    SET_DEFAULT_VALUE: 'set_default_value',
    MERGE_VALUES: 'merge_values',
    // === Modal Settings (edit per element) ===
    SETTINGS_MODAL: 'settings_modal',
    SETTINGS_GRAPHICS: 'settings_graphics',
    SETTINGS_DISPLAY: 'settings_display',
    SETTINGS_FILTERING: 'settings_filtering',
    COPY_TO_LANGUAGES: 'copy_to_languages',
    // === Modal SEO ===
    SEO_MODAL: 'seo_modal',
    SEO_REDIRECTS: 'seo_redirects',
    // === Modal Tłumaczeń ===
    TRANSLATIONS: 'translations',
    TRANSLATIONS_BULK_COPY: 'translations_bulk_copy',
    // === Bulk operations ===
    SELECTION_OPS: 'selection_ops',
    BULK_EDIT: 'bulk_edit',
    BULK_DELETE: 'bulk_delete',
    BULK_MOVE: 'bulk_move',
    BULK_EXPORT: 'bulk_export',
    // === Export / import ===
    EXPORT_PARAMETERS: 'export_parameters',
    IMPORT_PARAMETERS: 'import_parameters'
  };

  // Tier → lista feature ID. „enterprise" zawiera wszystko (kompostowany dynamicznie).
  // „own" — pusta lista; faktyczne features ładowane z JWT/CF Worker.
  var TIERS = {
    trial: [
      FEATURES.TREE_VIEW, FEATURES.SEARCH, FEATURES.INLINE_RENAME, FEATURES.COPY_ID,
      FEATURES.SETTINGS_MODAL // basic edit only
    ],
    basic: [
      FEATURES.TREE_VIEW, FEATURES.SEARCH, FEATURES.INLINE_RENAME, FEATURES.COPY_ID,
      FEATURES.SORT_ALPHABETICALLY, FEATURES.SORT_BY_ID, FEATURES.SORT_VALUES_ALPHA, FEATURES.SORT_VALUES_BY_ID,
      FEATURES.EXPAND_ALL, FEATURES.COLLAPSE_ALL, FEATURES.SECTION_VIEWS, FEATURES.COLUMNS_MENU,
      FEATURES.CREATE_PARAMETER, FEATURES.ADD_VALUE, FEATURES.DELETE_ELEMENT, FEATURES.SET_DEFAULT_VALUE,
      FEATURES.SETTINGS_MODAL, FEATURES.SETTINGS_DISPLAY, FEATURES.COPY_TO_LANGUAGES,
      FEATURES.SEO_MODAL
    ],
    pro: null /* computed: basic + */,
    enterprise: null /* computed: pro + reszta */,
    own: [] // ustawiane z JWT
  };
  // Pro = basic + masowe ops + grafiki + tłumaczenia + filtrowanie + merge + eksport/import
  TIERS.pro = (TIERS.basic || []).concat([
    FEATURES.MERGE_VALUES,
    FEATURES.SETTINGS_GRAPHICS, FEATURES.SETTINGS_FILTERING,
    FEATURES.SEO_REDIRECTS,
    FEATURES.SELECTION_OPS, FEATURES.BULK_EDIT, FEATURES.BULK_DELETE, FEATURES.BULK_MOVE, FEATURES.BULK_EXPORT,
    FEATURES.EXPORT_PARAMETERS, FEATURES.IMPORT_PARAMETERS,
    FEATURES.TRANSLATIONS
  ]);
  // Enterprise = pro + reszta (bulk copy tłumaczeń itd.)
  TIERS.enterprise = TIERS.pro.concat([
    FEATURES.TRANSLATIONS_BULK_COPY
  ]);

  var LICENSE = {
    tier: 'enterprise',          // DEV default: wszystko aktywne
    key: null,
    validUntil: null,
    features: null,              // populowane w initLicense()
    source: 'dev'                // 'dev' | 'jwt-cache' | 'cf-worker'
  };

  function initLicense() {
    // DEV override (do testów per-tier z konsoli):
    //   localStorage.setItem('tp-license-dev-tier', 'pro'); location.reload();
    try {
      var devTier = localStorage.getItem('tp-license-dev-tier');
      if (devTier && TIERS[devTier] !== undefined) {
        LICENSE.tier = devTier;
        LICENSE.source = 'dev-override';
      }
    } catch (e) {}
    if (LICENSE.tier === 'own') {
      // OWN: features z JWT (DEV: z localStorage)
      try {
        var raw = localStorage.getItem('tp-license-own-features');
        LICENSE.features = raw ? JSON.parse(raw) : [];
      } catch (e) { LICENSE.features = []; }
    } else {
      LICENSE.features = (TIERS[LICENSE.tier] || []).slice();
    }
    // TODO (prod): tutaj wstrzykiwana będzie walidacja JWT + CF Worker.
    // Hybryda:
    //   1) Spróbuj cached JWT z GM_getValue('tp-license-jwt'); validate signature.
    //   2) Jeśli ważny i validUntil > now: użyj features z JWT payload.
    //   3) Co 24h asynchronicznie odpytaj CF Worker o refresh + revoke check.
    //   4) Domain binding: JWT zawiera dozwolone domeny; sprawdź location.hostname.
    try { console.log('[Parametry PRO] License tier =', LICENSE.tier, '|', LICENSE.features.length, 'features |', LICENSE.source); } catch (e) {}
  }
  initLicense();

  function hasFeature(id) {
    return !!(LICENSE.features && LICENSE.features.indexOf(id) >= 0);
  }
  function requireFeature(id, label) {
    if (hasFeature(id)) return true;
    var msg = (label || 'Ta funkcja') + ' wymaga wyższej licencji (' + LICENSE.tier + ')';
    try { if (typeof _panel !== 'undefined' && _panel && _panel.showStatus) _panel.showStatus(msg, true); } catch (e) {}
    try { console.warn('[Parametry PRO]', msg, '— required:', id); } catch (e) {}
    return false;
  }
  // Helper: filtr przycisków w opsBar/toolbar — usuwa nulle z arraya
  function gated(items) { return items.filter(function (x) { return !!x; }); }
  // Helper: zwraca obiekt jeśli feature dostępne; inaczej null (usuwane w filter)
  function ifFeat(id, obj) { return hasFeature(id) ? obj : null; }

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
    '.panel-pro__search-hint { background: #efefef; color: #5f6368; font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 4px; flex-shrink: 0; white-space: nowrap; }',
    /* v4.6.110: edytor filtrow wartosci (zakladka Filtrowanie w modalu ustawien) */
    '.tp-fv-wrap { display:flex; flex-direction:column; gap:12px; }',
    '.tp-fv-mode { display:flex; gap:16px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; }',
    '.tp-fv-mode label { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-size:13px; }',
    '.tp-fv-cols { display:grid; grid-template-columns:1fr 1fr; gap:12px; }',
    '.tp-fv-col { border:1px solid #e2e8f0; border-radius:6px; overflow:hidden; background:#fff; }',
    '.tp-fv-col-title { padding:8px 12px; background:#f1f5f9; font-size:12px; font-weight:600; color:#475569; text-transform:uppercase; letter-spacing:0.5px; }',
    '.tp-fv-list { max-height:340px; overflow:auto; padding:4px; }',
    '.tp-fv-row { display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border-bottom:1px solid #f1f5f9; gap:8px; font-size:13px; }',
    '.tp-fv-row:last-child { border-bottom:none; }',
    '.tp-fv-row:hover { background:#f8fafc; }',
    '.tp-fv-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.tp-fv-badge { color:#2563eb; font-size:11.5px; font-style:italic; flex-shrink:0; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.tp-fv-btn-rm, .tp-fv-btn-add, .tp-fv-btn-edit { width:24px; height:24px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; cursor:pointer; font-weight:700; line-height:1; flex-shrink:0; font-size:14px; padding:0; display:inline-flex; align-items:center; justify-content:center; }',
    '.tp-fv-btn-rm, .tp-fv-btn-add { border-radius:50%; }',
    '.tp-fv-btn-rm { color:#dc2626; border-color:#fecaca; }',
    '.tp-fv-btn-rm:hover { background:#fef2f2; }',
    '.tp-fv-btn-add { color:#16a34a; border-color:#bbf7d0; }',
    '.tp-fv-btn-add:hover { background:#f0fdf4; }',
    '.tp-fv-btn-edit { color:#475569; }',
    '.tp-fv-btn-edit:hover { background:#f1f5f9; color:#1e293b; border-color:#94a3b8; }',
    '.tp-fv-empty { padding:18px; text-align:center; color:#94a3b8; font-size:12px; }',
    '.tp-fv-pricestep { display:flex; align-items:center; gap:8px; padding:8px 0; font-size:13px; color:#475569; }',
    '.tp-fv-pricestep input { width:90px; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; }',
    // v4.6.126: CSS tm-fe-filter-* dla wierszy filtrow (transfer z Menu 13-css-settings-v2.js)
    '.tm-fe-filter-row { display:flex !important; align-items:center !important; gap:8px !important; padding:9px 12px !important; border-bottom:1px solid #f0f2f5 !important; font-size:13px !important; color:#344054 !important; }',
    '.tm-fe-filter-row:last-child { border-bottom:none !important; }',
    '.tm-fe-filter-row-name { flex:1 !important; min-width:0 !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }',
    '.tm-fe-filter-badge { font-size:11px !important; color:#98a2b3 !important; font-style:italic !important; flex-shrink:0 !important; max-width:200px !important; overflow:hidden !important; text-overflow:ellipsis !important; white-space:nowrap !important; }',
    '.tm-fe-filter-action { width:28px !important; height:28px !important; border-radius:6px !important; border:1px solid #e8ebf0 !important; background:#fafbfc !important; cursor:pointer !important; display:flex !important; align-items:center !important; justify-content:center !important; flex-shrink:0 !important; padding:0 !important; color:#667085 !important; transition:all .15s !important; font-family:inherit !important; font-size:14px !important; line-height:1 !important; }',
    '.tm-fe-filter-action svg { width:12px !important; height:12px !important; fill:none !important; stroke:currentColor !important; stroke-width:2 !important; stroke-linecap:round !important; stroke-linejoin:round !important; }',
    '.tm-fe-filter-action--edit:hover { border-color:#c0cfff !important; color:#4f8cff !important; background:#eef3ff !important; }',
    '.tm-fe-filter-action--remove { border-color:#fde2e2 !important; background:#fef5f5 !important; color:#d32f2f !important; }',
    '.tm-fe-filter-action--remove:hover { background:#fef2f2 !important; border-color:#fecaca !important; color:#b91c1c !important; }',
    '.tm-fe-filter-action--add { border-color:#d6e2ff !important; background:#eef3ff !important; color:#4f8cff !important; font-weight:700 !important; font-size:16px !important; }',
    '.tm-fe-filter-action--add:hover { background:#dbeafe !important; border-color:#bfdbfe !important; color:#1d4ed8 !important; }',
    // v4.6.130: hint bar + pricestep fields (z Menu 11-css-domain.js, BEZ prefix tm-fe-overlay bo te elementy sa w karcie Filtrowanie a nie w modalu pricerange)
    '.tm-fe-hint-bar { display:flex !important; align-items:flex-start !important; gap:8px !important; padding:10px 14px !important; background:#fffbeb !important; border:1px solid #fde68a !important; border-radius:8px !important; font-size:12px !important; color:#92400e !important; line-height:1.5 !important; }',
    '.tm-fe-hint-bar b { font-weight:600 !important; }',
    '.tm-fe-pricestep-row { display:flex !important; gap:16px !important; }',
    '.tm-fe-pricestep-field { flex:1 !important; }',
    '.tm-fe-pricestep-label { font-size:12px !important; font-weight:500 !important; color:#4a5568 !important; display:block !important; margin-bottom:6px !important; }',
    // v4.6.125: CSS tm-fe-* dla dialogow edycji filtrow (transfer z Menu 11-css-domain.js)
    '@keyframes tmFeOverlayIn { from { opacity:0 } to { opacity:1 } }',
    '@keyframes tmFeModalIn { from { opacity:0; transform:translateY(10px) scale(.96) } to { opacity:1; transform:translateY(0) scale(1) } }',
    '.tm-fe-overlay { position:fixed !important; top:0 !important; left:0 !important; width:100% !important; height:100% !important; background:rgba(15,20,35,.35) !important; backdrop-filter:blur(4px) !important; z-index:9999999 !important; display:flex !important; align-items:center !important; justify-content:center !important; padding:16px !important; animation:tmFeOverlayIn .2s ease !important; font-family:\'Segoe UI\',Roboto,Arial,sans-serif !important; }',
    '.tm-fe-overlay .tm-fe-modal, .tp-fv-wrap .tm-fe-modal { background:#fff !important; border:1px solid #e4e7ec !important; border-radius:14px !important; width:100% !important; max-width:480px !important; box-shadow:0 4px 6px -1px rgba(0,0,0,.06),0 20px 60px -10px rgba(0,0,0,.14) !important; overflow:hidden !important; animation:tmFeModalIn .28s cubic-bezier(.34,1.4,.64,1) !important; max-height:90vh !important; display:flex !important; flex-direction:column !important; }',
    '.tm-fe-overlay .tm-fe-modal--wide, .tp-fv-wrap .tm-fe-modal--wide { max-width:520px !important; }',
    '.tm-fe-overlay .tm-fe-header, .tp-fv-wrap .tm-fe-header { display:flex !important; align-items:center !important; gap:12px !important; padding:16px 20px !important; border-bottom:1px solid #e4e7ec !important; flex-shrink:0 !important; }',
    '.tm-fe-overlay .tm-fe-icon, .tp-fv-wrap .tm-fe-icon { width:36px !important; height:36px !important; background:#eff4ff !important; border:1px solid #bfcffd !important; border-radius:8px !important; display:flex !important; align-items:center !important; justify-content:center !important; flex-shrink:0 !important; }',
    '.tm-fe-overlay .tm-fe-icon svg, .tp-fv-wrap .tm-fe-icon svg { width:17px !important; height:17px !important; stroke:#2563eb !important; fill:none !important; }',
    '.tm-fe-overlay .tm-fe-title-group h2, .tp-fv-wrap .tm-fe-title-group h2 { font-size:15px !important; font-weight:600 !important; letter-spacing:-.2px !important; color:#1a202c !important; margin:0 !important; }',
    '.tm-fe-overlay .tm-fe-title-group p, .tp-fv-wrap .tm-fe-title-group p { font-size:12px !important; color:#9aa3b0 !important; margin:2px 0 0 !important; }',
    '.tm-fe-overlay .tm-fe-close, .tp-fv-wrap .tm-fe-close { margin-left:auto !important; width:30px !important; height:30px !important; background:none !important; border:1px solid transparent !important; border-radius:7px !important; cursor:pointer !important; display:flex !important; align-items:center !important; justify-content:center !important; color:#9aa3b0 !important; transition:all .15s !important; }',
    '.tm-fe-overlay .tm-fe-close:hover, .tp-fv-wrap .tm-fe-close:hover { background:#eef0f3 !important; border-color:#e4e7ec !important; color:#1a202c !important; }',
    '.tm-fe-overlay .tm-fe-close svg, .tp-fv-wrap .tm-fe-close svg { width:14px !important; height:14px !important; stroke:currentColor !important; stroke-width:2 !important; fill:none !important; }',
    '.tm-fe-overlay .tm-fe-body, .tp-fv-wrap .tm-fe-body { flex:1 !important; min-height:0 !important; overflow-y:auto !important; }',
    '.tm-fe-overlay .tm-fe-footer, .tp-fv-wrap .tm-fe-footer { display:flex !important; gap:8px !important; justify-content:flex-end !important; padding:14px 20px !important; border-top:1px solid #e4e7ec !important; background:#fafbfc !important; flex-shrink:0 !important; }',
    '.tm-fe-overlay .tm-fe-field-block, .tp-fv-wrap .tm-fe-field-block { padding:16px 24px !important; border-bottom:1px solid #e4e7ec !important; }',
    '.tm-fe-overlay .tm-fe-field-block:last-child, .tp-fv-wrap .tm-fe-field-block:last-child { border-bottom:none !important; }',
    '.tm-fe-overlay .tm-fe-field-label, .tp-fv-wrap .tm-fe-field-label { font-size:10.5px !important; font-weight:600 !important; text-transform:uppercase !important; letter-spacing:.7px !important; color:#9aa3b0 !important; margin-bottom:10px !important; }',
    '.tm-fe-overlay .tm-fe-radio-group, .tp-fv-wrap .tm-fe-radio-group { display:flex !important; flex-direction:column !important; gap:4px !important; }',
    '.tm-fe-overlay .tm-fe-radio-group-row, .tp-fv-wrap .tm-fe-radio-group-row { display:flex !important; flex-direction:row !important; gap:6px !important; }',
    '.tm-fe-overlay .tm-fe-radio-option, .tp-fv-wrap .tm-fe-radio-option { position:relative !important; cursor:pointer !important; display:block !important; }',
    '.tm-fe-overlay .tm-fe-radio-option input, .tp-fv-wrap .tm-fe-radio-option input { position:absolute !important; opacity:0 !important; width:0 !important; height:0 !important; }',
    '.tm-fe-overlay .tm-fe-radio-inner, .tp-fv-wrap .tm-fe-radio-inner { display:flex !important; align-items:center !important; gap:9px !important; padding:7px 10px !important; border-radius:7px !important; border:1.5px solid transparent !important; transition:all .15s !important; }',
    '.tm-fe-overlay .tm-fe-radio-inner:hover, .tp-fv-wrap .tm-fe-radio-inner:hover { background:#f7f8fa !important; }',
    '.tm-fe-overlay .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner, .tp-fv-wrap .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner { background:#eff4ff !important; border-color:#bfcffd !important; }',
    '.tm-fe-overlay .tm-fe-radio-dot, .tp-fv-wrap .tm-fe-radio-dot { width:15px !important; height:15px !important; border-radius:50% !important; border:2px solid #b0bac8 !important; flex-shrink:0 !important; display:flex !important; align-items:center !important; justify-content:center !important; transition:all .18s !important; }',
    '.tm-fe-overlay .tm-fe-radio-dot-inner, .tp-fv-wrap .tm-fe-radio-dot-inner { width:6px !important; height:6px !important; border-radius:50% !important; background:#2563eb !important; transform:scale(0) !important; transition:transform .2s !important; }',
    '.tm-fe-overlay .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner .tm-fe-radio-dot, .tp-fv-wrap .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner .tm-fe-radio-dot { border-color:#2563eb !important; }',
    '.tm-fe-overlay .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner .tm-fe-radio-dot-inner, .tp-fv-wrap .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner .tm-fe-radio-dot-inner { transform:scale(1) !important; }',
    '.tm-fe-overlay .tm-fe-radio-text, .tp-fv-wrap .tm-fe-radio-text { font-size:13px !important; color:#4a5568 !important; }',
    '.tm-fe-overlay .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner .tm-fe-radio-text, .tp-fv-wrap .tm-fe-radio-option input:checked ~ .tm-fe-radio-inner .tm-fe-radio-text { color:#2563eb !important; font-weight:500 !important; }',
    '.tm-fe-overlay .tm-fe-input-reveal, .tp-fv-wrap .tm-fe-input-reveal { overflow:hidden !important; max-height:0 !important; opacity:0 !important; transition:max-height .28s ease, opacity .22s ease, margin .28s ease !important; margin-top:0 !important; }',
    '.tm-fe-overlay .tm-fe-input-reveal.open, .tp-fv-wrap .tm-fe-input-reveal.open { max-height:60px !important; opacity:1 !important; margin-top:4px !important; }',
    '.tm-fe-overlay .tm-fe-input-full, .tp-fv-wrap .tm-fe-input-full { width:100% !important; padding:8px 12px !important; border:1.5px solid #e4e7ec !important; border-radius:8px !important; font-size:13px !important; color:#1a202c !important; background:#fff !important; outline:none !important; transition:border-color .15s, box-shadow .15s !important; box-sizing:border-box !important; }',
    '.tm-fe-overlay .tm-fe-input-full:focus, .tp-fv-wrap .tm-fe-input-full:focus { border-color:#2563eb !important; box-shadow:0 0 0 3px rgba(37,99,235,.08) !important; }',
    '.tm-fe-overlay .tm-fe-input-full::placeholder, .tp-fv-wrap .tm-fe-input-full::placeholder { color:#9aa3b0 !important; }',
    '.tm-fe-overlay .tm-fe-input-full[readonly], .tp-fv-wrap .tm-fe-input-full[readonly] { background:#eef0f3 !important; color:#9aa3b0 !important; cursor:default !important; border-color:#e4e7ec !important; }',
    '.tm-fe-overlay .tm-fe-input-full[readonly]:focus, .tp-fv-wrap .tm-fe-input-full[readonly]:focus { border-color:#e4e7ec !important; box-shadow:none !important; }',
    '.tm-fe-overlay .tm-fe-btn, .tp-fv-wrap .tm-fe-btn { font-size:13px !important; font-weight:500 !important; padding:8px 20px !important; border-radius:8px !important; cursor:pointer !important; border:none !important; transition:all .17s !important; letter-spacing:-.1px !important; font-family:inherit !important; }',
    '.tm-fe-overlay .tm-fe-btn-ghost, .tp-fv-wrap .tm-fe-btn-ghost { background:transparent !important; border:1.5px solid #e4e7ec !important; color:#4a5568 !important; }',
    '.tm-fe-overlay .tm-fe-btn-ghost:hover, .tp-fv-wrap .tm-fe-btn-ghost:hover { border-color:#b0bac8 !important; background:#eef0f3 !important; color:#1a202c !important; }',
    '.tm-fe-overlay .tm-fe-btn-primary, .tp-fv-wrap .tm-fe-btn-primary { background:#2563eb !important; color:#fff !important; box-shadow:0 1px 3px rgba(37,99,235,.3),0 4px 12px rgba(37,99,235,.2) !important; }',
    '.tm-fe-overlay .tm-fe-btn-primary:hover, .tp-fv-wrap .tm-fe-btn-primary:hover { background:#1d4ed8 !important; transform:translateY(-1px) !important; box-shadow:0 1px 4px rgba(37,99,235,.35),0 6px 16px rgba(37,99,235,.25) !important; }',
    '.tm-fe-overlay .tm-fe-btn-primary:active, .tp-fv-wrap .tm-fe-btn-primary:active { transform:translateY(0) !important; }',
    '.tm-fe-overlay .tm-fe-name-block, .tp-fv-wrap .tm-fe-name-block { background:#f7f8fa !important; border:1px solid #e4e7ec !important; border-radius:8px !important; padding:14px 16px !important; }',
    '.tm-fe-overlay .tm-fe-name-label, .tp-fv-wrap .tm-fe-name-label { font-size:12px !important; font-weight:500 !important; color:#9aa3b0 !important; margin-bottom:10px !important; text-transform:uppercase !important; letter-spacing:.6px !important; }',
    '.tm-fe-overlay .tm-fe-currencies, .tp-fv-wrap .tm-fe-currencies { display:flex !important; flex-direction:column !important; gap:10px !important; padding:0 24px 20px !important; }',
    '.tm-fe-overlay .tm-fe-cur-section, .tp-fv-wrap .tm-fe-cur-section { border:1px solid #e4e7ec !important; border-radius:8px !important; overflow:hidden !important; }',
    '.tm-fe-overlay .tm-fe-cur-header, .tp-fv-wrap .tm-fe-cur-header { display:flex !important; align-items:center !important; gap:10px !important; padding:11px 16px !important; background:#f7f8fa !important; border-bottom:1px solid #e4e7ec !important; }',
    '.tm-fe-overlay .tm-fe-cur-badge, .tp-fv-wrap .tm-fe-cur-badge { font-size:11px !important; font-weight:700 !important; font-family:\'Courier New\',monospace !important; padding:3px 8px !important; border-radius:5px !important; letter-spacing:.5px !important; background:#fff !important; border:1px solid #e4e7ec !important; color:#4a5568 !important; }',
    '.tm-fe-overlay .tm-fe-badge-pln, .tp-fv-wrap .tm-fe-badge-pln { background:#ecfdf5 !important; color:#065f46 !important; border:1px solid #a7f3d0 !important; }',
    '.tm-fe-overlay .tm-fe-badge-eur, .tp-fv-wrap .tm-fe-badge-eur { background:#fefce8 !important; color:#854d0e !important; border:1px solid #fde68a !important; }',
    '.tm-fe-overlay .tm-fe-badge-gbp, .tp-fv-wrap .tm-fe-badge-gbp { background:#eff4ff !important; color:#1e40af !important; border:1px solid #bfdbfe !important; }',
    '.tm-fe-overlay .tm-fe-cur-title, .tp-fv-wrap .tm-fe-cur-title { font-size:12.5px !important; font-weight:600 !important; color:#4a5568 !important; }',
    '.tm-fe-overlay .tm-fe-field-row, .tp-fv-wrap .tm-fe-field-row { display:flex !important; align-items:center !important; justify-content:space-between !important; padding:10px 16px !important; border-bottom:1px solid #e4e7ec !important; gap:12px !important; transition:background .12s !important; }',
    '.tm-fe-overlay .tm-fe-field-row:last-child, .tp-fv-wrap .tm-fe-field-row:last-child { border-bottom:none !important; }',
    '.tm-fe-overlay .tm-fe-field-row:hover, .tp-fv-wrap .tm-fe-field-row:hover { background:#f7f8fa !important; }',
    '.tm-fe-overlay .tm-fe-field-row-label, .tp-fv-wrap .tm-fe-field-row-label { font-size:12.5px !important; color:#4a5568 !important; flex:1 !important; }',
    '.tm-fe-overlay .tm-fe-num-wrap, .tp-fv-wrap .tm-fe-num-wrap { position:relative !important; display:flex !important; align-items:center !important; }',
    '.tm-fe-overlay .tm-fe-num-input, .tp-fv-wrap .tm-fe-num-input { width:90px !important; padding:6px 28px 6px 10px !important; border:1.5px solid #e4e7ec !important; border-radius:8px !important; font-family:\'Courier New\',monospace !important; font-size:13px !important; font-weight:500 !important; color:#1a202c !important; background:#fff !important; outline:none !important; transition:all .15s !important; text-align:right !important; -moz-appearance:textfield !important; appearance:textfield !important; box-sizing:border-box !important; }',
    '.tm-fe-overlay .tm-fe-num-input::-webkit-inner-spin-button, .tm-fe-num-input::-webkit-outer-spin-button, .tp-fv-wrap .tm-fe-num-input::-webkit-inner-spin-button, .tm-fe-num-input::-webkit-outer-spin-button { -webkit-appearance:none !important; }',
    '.tm-fe-overlay .tm-fe-num-input:focus, .tp-fv-wrap .tm-fe-num-input:focus { border-color:#2563eb !important; box-shadow:0 0 0 3px rgba(37,99,235,.08) !important; }',
    '.tm-fe-overlay .tm-fe-spin-btns, .tp-fv-wrap .tm-fe-spin-btns { position:absolute !important; right:1px !important; top:1px !important; bottom:1px !important; display:flex !important; flex-direction:column !important; width:22px !important; }',
    '.tm-fe-overlay .tm-fe-spin-btn, .tp-fv-wrap .tm-fe-spin-btn { flex:1 !important; background:none !important; border:none !important; border-left:1px solid #e4e7ec !important; cursor:pointer !important; display:flex !important; align-items:center !important; justify-content:center !important; color:#9aa3b0 !important; transition:all .12s !important; padding:0 !important; }',
    '.tm-fe-overlay .tm-fe-spin-btn:first-child, .tp-fv-wrap .tm-fe-spin-btn:first-child { border-bottom:1px solid #e4e7ec !important; border-radius:0 5px 0 0 !important; }',
    '.tm-fe-overlay .tm-fe-spin-btn:last-child, .tp-fv-wrap .tm-fe-spin-btn:last-child { border-radius:0 0 5px 0 !important; }',
    '.tm-fe-overlay .tm-fe-spin-btn:hover, .tp-fv-wrap .tm-fe-spin-btn:hover { background:#eef0f3 !important; color:#1a202c !important; }',
    '.tm-fe-overlay .tm-fe-spin-btn svg, .tp-fv-wrap .tm-fe-spin-btn svg { width:8px !important; height:8px !important; stroke:currentColor !important; stroke-width:2.5 !important; fill:none !important; }',
    '.tp-fv-actions { display:flex; gap:8px; }',
    '.tp-fv-save { padding:8px 16px; background:#2563eb; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:500; font-size:13px; }',
    '.tp-fv-save:hover { background:#1d4ed8; }',
    '.tp-fv-save:disabled { opacity:0.5; cursor:default; }',
    '.tp-fv-loading, .tp-fv-error { padding:20px; text-align:center; color:#64748b; font-size:13px; }',
    '.tp-fv-error { color:#dc2626; }',

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
    '.panel-pro__thead > div { padding: 0; text-align: center; min-width: 0; }',
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
    'li.panel-pro__row { display: grid !important; column-gap: 10px; align-items: center; padding: 4px 0 !important; border: none !important; border-radius: 0 !important; border-bottom: 1px solid #e2e8f0 !important; min-height: 37px; transition: background 0.1s; list-style: none !important; margin: 0 !important; box-sizing: border-box; position: relative; }',
    'li.panel-pro__row > div { padding: 0; min-width: 0; }',
    /* Defensive: native IdoSell elements that sneak into the row should not occupy grid tracks */
    'li.panel-pro__row > .clear, li.panel-pro__row > [id^="iteminfo_"], li.panel-pro__row > [id^="space_"] { display: none !important; }',
    'li.panel-pro__row > ul, li.panel-pro__row > [id^="block_group"] { grid-column: 1 / -1; padding: 0 !important; margin: 0 !important; list-style: none !important; }',
    /* v4.5.21: avoid double separator when a parameter has expanded children. Parent row drops its bottom border; the last child row inside the nested ul still has one. */
    'li.panel-pro__row:has(> ul[id^="block_group"]:not([style*="none"]):not(:empty)) { border-bottom: none !important; }',
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
      if (cfg.search.hint) {
        sb.appendChild(el(doc, 'span', { className: 'panel-pro__search-hint', textContent: cfg.search.hint }));
      }
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

  // v4.6.157: GET przez iframe XHR — sesja panelu jest w iframe, outer fetch zwraca login page
  function fetchTextFromIframe(url) {
    return new Promise(function (resolve, reject) {
      var win = getIframeWin();
      if (!win) return reject(new Error('Brak iframe'));
      var xhr = new win.XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = function () { resolve(xhr.responseText); };
      xhr.onerror = function () { reject(new Error('Blad sieci')); };
      xhr.send();
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
/* v4.6.86: natywny IdoSell daje zagnieżdżonym ul[id^=block_group] padding-left: 40px
   — to wcina wartości 40px w prawo I skraca ich row o 40px (cell tp-col-actions
   wartości ląduje 40px na lewo od param). Override: padding-left 0. */
ul[id^="block_group"] { padding-left: 0 !important; }

/* Drag handle — slot zachowuje szerokość 32px (taką samą jak check w columns config),
   żeby checkbox/folder param były w spójnej kolumnie z drag-handle wartości. */
.tp-col-drag {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  height: 100%;
}
/* v4.6.85: cofnięte CSS rearranging (popsuł grid auto-placement w v4.6.84 —
   name/id/products kolumny przesunięte). Zostawiamy natural DOM order:
   drag(1), check(2), expand(3), name(4), ... */
.tp-drag-handle {
  /* v4.6.122: ⠿ STALE widoczne w naturalnej kolumnie drag (24px na lewej krawedzi
     wiersza, na lewo od checkboxa wartosci). Parametry maja ta kolumne pusta. */
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 18px !important;
  height: 18px !important;
  font-size: 18px !important;
  color: #94a3b8 !important;
  cursor: grab !important;
  border-radius: 4px !important;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
.tp-drag-handle:hover {
  color: #5f6368 !important;
  background: #e8eaed !important;
}
.tp-drag-handle:active {
  cursor: grabbing !important;
}
/* Move mode (przenoszenie wartosci pod inny parametr) */
.tp-action-btn--move { color: #1d4ed8 !important; }
.tp-action-btn--move:hover { background: #dbeafe !important; color: #1e40af !important; }
li.tp-move-source {
  background: #dbeafe !important;
  outline: 2px solid #3b82f6 !important;
  outline-offset: -2px;
  z-index: 2;
  position: relative;
}
li.tp-move-target {
  cursor: pointer !important;
  transition: background 0.15s !important;
}
li.tp-move-target:hover {
  background: #dbeafe !important;
  outline: 2px solid #2563eb !important;
  outline-offset: -2px;
}
#tp-move-banner {
  position: fixed !important;
  top: 8px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  background: #2563eb !important;
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
/* v4.6.132: flex children kasuja whitespace miedzy text-node i <strong>; dodajemy margines */
#tp-move-banner strong,
#tp-merge-banner strong {
  margin-left: 4px !important;
  margin-right: 4px !important;
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
/* v4.6.82: ikony akcji ZWARTE od prawej (flex flex-end). Delete zawsze ostatni
   (najbardziej w prawo). Brak sztywnych slotów → brak luk u wartości (która ma
   mniej ikon niż parametr). Padding-right zapewnia mały odstęp od krawędzi cell. */
.tp-col-actions {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 4px !important;
  padding-right: 4px !important;
  height: 100%;
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
  min-width: 32px !important;
  flex: 0 0 32px !important;
  box-sizing: border-box !important;
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

/* v4.6.52: te same style edytora + grafik dla nowego modalu (tm-settings-v2) */
.tm-settings-v2 .tp-ed-v2head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; gap:12px; }
.tm-settings-v2 .tp-ed-v2head .tp-ed-v2lbl { font-size:13px; color:#344054; font-weight:500; }
.tm-settings-v2 .tp-ed-wrap { border:none; background:transparent; }
.tm-settings-v2 .tp-ed-wrap .tp-ed-bar { display:inline-flex; border:none; background:#f0f2f5; border-radius:8px; padding:3px; overflow:visible; }
.tm-settings-v2 .tp-ed-wrap .tp-ed-btn { flex:none; padding:5px 14px; border-radius:6px; color:#98a2b3; }
.tm-settings-v2 .tp-ed-wrap .tp-ed-btn:hover { background:rgba(255,255,255,.5); color:#344054; }
.tm-settings-v2 .tp-ed-wrap .tp-ed-btn.tp-ed-on { background:#fff; color:#1a1a2e; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.tm-settings-v2 .tp-ed-src { border:1px solid #e0e3ea !important; border-radius:10px !important; background:#f8f9fb !important; }
.tm-settings-v2 .tp-ed-wys { border:1px solid #e0e3ea; border-radius:10px; background:#f8f9fb; }
.tm-settings-v2 .tp-ed-fmt { background:#f8f9fb !important; border:1px solid #e0e3ea !important; border-bottom:none !important; border-radius:10px 10px 0 0 !important; }
.tm-settings-v2 .tp-ed-fmt + .tp-ed-wys, .tm-settings-v2 .tp-ed-fmt + .tp-ed-src { border-top-left-radius:0; border-top-right-radius:0; }
.tm-settings-v2 .tp-gfx-slot-header { font-size:11.5px; font-weight:700; color:#e65100; text-transform:uppercase; letter-spacing:.05em; padding:14px 0 6px; }
.tm-settings-v2 .tp-gfx-subfield { display:flex; align-items:center; justify-content:space-between; padding:8px 0; gap:16px; }
.tm-settings-v2 .tp-gfx-subfield > .tm-field-label { font-size:13.5px; color:#344054; flex:1 1 auto; }
.tm-settings-v2 .tp-gfx-subfield > .tm-input-wrap, .tm-settings-v2 .tp-gfx-subfield > .tp-gfx-ctl { flex:0 0 420px; max-width:420px; }
.tm-settings-v2 .tp-gfx-slot-upload { padding:4px 0 8px; }
.tm-settings-v2 .tp-gfx-upload-row { display:flex; align-items:center; gap:12px; padding:10px 14px; background:#f8f9fb; border:1px dashed #d0d5dd; border-radius:8px; margin-bottom:8px; transition:border-color .15s; }
.tm-settings-v2 .tp-gfx-upload-row:hover { border-color:#4f8cff; }
.tm-settings-v2 .tp-gfx-upload-label { font-size:12.5px; color:#667085; flex-shrink:0; min-width:120px; }
.tm-settings-v2 .tp-gfx-browse { padding:5px 14px; border-radius:6px; border:1px solid #d0d5dd; background:#fff; font-size:12px; color:#344054; cursor:pointer; font-weight:500; font-family:inherit; }
.tm-settings-v2 .tp-gfx-browse:hover { background:#f8f9fb; border-color:#b0b7c3; }
.tm-settings-v2 .tp-gfx-upload-state { font-size:12px; color:#98a2b3; flex:1; }
.tm-settings-v2 .tp-gfx-existing { display:flex; align-items:center; gap:10px; padding:8px 12px; background:#fff; border:1px solid #e8ebf0; border-radius:8px; margin-bottom:8px; font-size:12.5px; }
.tm-settings-v2 .tp-gfx-existing-label { font-size:12px; color:#667085; font-weight:500; flex-shrink:0; }
.tm-settings-v2 .tp-gfx-thumb { height:40px; width:auto; max-width:120px; border-radius:4px; border:1px solid #e8ebf0; object-fit:contain; background:#fff; }
.tm-settings-v2 .tp-gfx-existing-actions { display:flex; align-items:center; gap:10px; margin-left:auto; }
.tm-settings-v2 .tp-gfx-link { font-size:12px; color:#4f8cff; text-decoration:none; font-weight:500; cursor:pointer; }
.tm-settings-v2 .tp-gfx-link:hover { text-decoration:underline; }
.tm-settings-v2 .tp-gfx-del { font-size:12px; color:#d32f2f; cursor:pointer; font-weight:500; }
.tm-settings-v2 .tp-gfx-del:hover { text-decoration:underline; }
.tm-settings-v2 .tp-gfx-folder-guide { font-size:12px; color:#667085; background:#f8f9fb; border:1px solid #e8ebf0; border-radius:8px; padding:10px 12px; margin-bottom:8px; line-height:1.5; }
.tm-settings-v2 .tp-gfx-folder-map { display:none; font-size:12px; color:#344054; background:#fff; border:1px solid #e8ebf0; border-radius:8px; padding:10px 12px; }

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
      '<span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;">cell_merge</span>' +
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

  // v4.6.97: merge wartosci + przekierowania 301 (zrodlowa wartosc znika -> jej
  // URL trzeba przekierowac na URL wartosci docelowej; repoint zapobiega lancuchom).
  async function mergeTargetClickHandler(e) {
    if (!_mergeState.active) return;

    var targetLi = e.target.closest('li.tp-merge-target');
    if (!targetLi) {
      if (e.target.closest('#tp-merge-banner')) return;
      return;
    }

    e.stopPropagation();
    e.preventDefault();

    var targetId = getNodeId(targetLi);
    if (!targetId) return;

    var targetNameEl = _mergeState.doc.getElementById('showMenuSub_' + targetId);
    var targetName = targetNameEl ? targetNameEl.textContent.trim() : 'ID ' + targetId;
    var sourceId = _mergeState.sourceId;
    var sourceName = _mergeState.sourceName;
    var doc = _mergeState.doc;

    var msg = 'UWAGA: Operacja jest NIEODWRACALNA!\n\n' +
      'Połączyć wartość:\n' +
      '  „' + sourceName + '” (ID: ' + sourceId + ')\n' +
      'z wartością:\n' +
      '  „' + targetName + '” (ID: ' + targetId + ')?\n\n' +
      'Produkty zostaną przepisane, wartość „' + sourceName + '” usunięta,\n' +
      'a jej adresy URL przekierowane (301) na „' + targetName + '”.';

    if (!confirm(msg)) return;
    exitMergeMode();

    try {
      // 1) adresy URL obu wartosci PRZED polaczeniem
      showForceDeleteStatus(doc, 'Zbieranie adresów URL...');
      var win = getIframeWin();
      var shops = (win && win.IAI && win.IAI.shops_list) ? win.IAI.shops_list.map(function (sh) { return String(sh.id); }) : ['1'];
      var ldResp = await fetchAjax('action=getParameterLangData&id=' + sourceId);
      var langs = (ldResp && ldResp.data && ldResp.data.langData) ? Object.keys(ldResp.data.langData) : [LANG];
      var oldUrls = await _collectValueUrls(sourceId, shops, langs);
      var destUrls = await _collectValueUrls(targetId, shops, langs);

      // v4.6.174: jesli to cross-parameter merge, zbierz produkty PRZED merge (mergeParam
      // nie zaklada parameter→product w target — sprawdzone live demo37 2026-06-08)
      var srcParentForFix = getParentId(doc, sourceId);
      var tgtParentForFix = getParentId(doc, targetId);
      var crossParamMerge = srcParentForFix && tgtParentForFix && srcParentForFix !== tgtParentForFix;
      var affectedProductsForFix = crossParamMerge ? await _getProductIdsForNode(sourceId) : [];

      // 2) polaczenie
      showForceDeleteStatus(doc, 'Łączenie wartości...');
      var mergeResp = await fetchAjax('action=mergeParam&id=' + sourceId + '&idExist=' + targetId);
      if (mergeResp && mergeResp.error && mergeResp.error !== '') throw new Error(mergeResp.error);

      // v4.6.174: po merge — dopnij parameter→product w target dla produktow z source
      if (affectedProductsForFix.length) {
        showForceDeleteStatus(doc, 'Dopinanie parametru docelowego do ' + affectedProductsForFix.length + ' towar(ów)...');
        await _attachParameterValueToProducts(affectedProductsForFix, tgtParentForFix, targetId);
      }

      // 3) DOM: usun zrodlo, ewentualnie pusty parametr-rodzic
      var sourceParentId = getParentId(doc, sourceId);
      var sourceLi = doc.getElementById('m_' + sourceId);
      if (sourceLi) {
        var space = doc.getElementById('space_' + sourceId);
        if (space) space.remove();
        sourceLi.remove();
      }
      updateCounter(doc);
      if (sourceParentId && sourceParentId !== '0') {
        var parentBlock = doc.getElementById('block_group' + sourceParentId);
        var remainingValues = parentBlock ? parentBlock.querySelectorAll(':scope > li[id^="m_"]').length : 0;
        if (remainingValues === 0) {
          var parentName = getNodeName(doc, sourceParentId);
          var okDel = await forceDeleteNode(doc, sourceParentId, getParentId(doc, sourceParentId), parentName, true);
          if (okDel) {
            var paramLi = doc.getElementById('m_' + sourceParentId);
            if (paramLi) {
              var paramSpace = doc.getElementById('space_' + sourceParentId);
              if (paramSpace) paramSpace.remove();
              paramLi.remove();
            }
            updateCounter(doc);
          }
        }
      }

      // 4) aktualizacja licznika produktow na wartosci docelowej
      try {
        var occ = await fetchAjax('action=numberOfOccurrence&id=' + targetId);
        var newCount = (occ && occ.data && occ.data.numberOfProduct) ? occ.data.numberOfProduct : null;
        if (newCount != null) {
          var tLi = doc.getElementById('m_' + targetId);
          if (tLi) {
            var prodCell = tLi.querySelector('.tp-col-products');
            if (prodCell) { var lnk = prodCell.querySelector('a'); if (lnk) lnk.textContent = newCount; else prodCell.textContent = newCount; }
          }
          var nativeLink = doc.getElementById('products_' + targetId);
          if (nativeLink) nativeLink.textContent = nativeLink.textContent.replace(/\d+/, newCount);
        }
      } catch (ec) {}

      // 5) przekierowania 301: adresy starej wartosci -> adresy docelowej (+ repoint, bez lancuchow)
      showForceDeleteStatus(doc, 'Zakładanie przekierowań 301...');
      var redirOk = 0, repointed = 0;
      var keys = Object.keys(oldUrls);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var fromP = oldUrls[key], toP = destUrls[key];
        if (!toP || toP === fromP) continue;
        var shopId = key.split('|')[0];
        repointed += await _repointRedirects(shopId, fromP, toP);
        if (await _addRedirect(shopId, fromP, toP)) redirOk++;
      }
      try { tpCacheClearAll(); } catch (ex) {}
      showForceDeleteStatus(doc, 'Połączono „' + sourceName + '” → „' + targetName +
        '” — przekierowań 301: ' + redirOk + (repointed ? (', przepięto: ' + repointed) : ''));
    } catch (err) {
      showForceDeleteStatus(doc, 'Błąd łączenia: ' + (err && err.message || err), true);
    }
  }

  /* === v4.6.94: Przenoszenie wartosci pod inny parametr =================
     UX analogiczny do trybu laczenia (enterMergeMode). Sekwencja przeniesienia
     jak w showBulkMoveModal: checkElValues -> mergeParam -> removeParam.
     Dodatkowo: przed przeniesieniem zbiera URL-e starej wartosci per sklep x
     jezyk (getNode -> seolink), a po przeniesieniu (nowe ID = nowy URL) zaklada
     przekierowania 301 stary->nowy w kazdym sklepie. */
  var _moveState = { active: false, sourceId: null, sourceName: null, parentId: null, doc: null };

  function enterMoveMode(doc, sourceId, sourceName, parentId) {
    if (_moveState.active) exitMoveMode();
    if (_mergeState && _mergeState.active) exitMergeMode();
    _moveState = { active: true, sourceId: sourceId, sourceName: sourceName, parentId: parentId, doc: doc };
    var sourceLi = doc.getElementById('m_' + sourceId);
    if (sourceLi) sourceLi.classList.add('tp-move-source');
    // podswietl WSZYSTKIE parametry jako cele (oprocz rodzica zrodla)
    var items = doc.querySelectorAll('li[id^="m_"]');
    for (var i = 0; i < items.length; i++) {
      var nid = getNodeId(items[i]);
      if (!nid || nid === parentId || nid === sourceId) continue;
      if (isParameter(doc, nid)) items[i].classList.add('tp-move-target');
    }
    var existing = doc.getElementById('tp-move-banner');
    if (existing) existing.remove();
    var banner = doc.createElement('div');
    banner.id = 'tp-move-banner';
    banner.innerHTML =
      '<span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;">drive_file_move</span>' +
      'Tryb przenoszenia: kliknij parametr docelowy dla <strong>' + escapeHtml(sourceName) + '</strong>' +
      '<span id="tp-move-cancel" style="margin-left:12px;cursor:pointer;font-weight:bold;padding:4px 10px;border-radius:4px;background:rgba(255,255,255,0.3);">\u2715 Anuluj</span>';
    var toolbar = doc.getElementById('tp-toolbar');
    if (toolbar) { toolbar.parentNode.insertBefore(banner, toolbar.nextSibling); }
    else { doc.body.insertBefore(banner, doc.body.firstChild); }
    banner.querySelector('#tp-move-cancel').addEventListener('click', function () { exitMoveMode(); });
    doc.addEventListener('click', moveTargetClickHandler, true);
  }

  function exitMoveMode() {
    if (!_moveState.doc) return;
    var doc = _moveState.doc;
    var src = doc.querySelectorAll('.tp-move-source');
    for (var i = 0; i < src.length; i++) src[i].classList.remove('tp-move-source');
    var tgt = doc.querySelectorAll('.tp-move-target');
    for (var j = 0; j < tgt.length; j++) tgt[j].classList.remove('tp-move-target');
    var banner = doc.getElementById('tp-move-banner');
    if (banner) banner.remove();
    doc.removeEventListener('click', moveTargetClickHandler, true);
    _moveState = { active: false, sourceId: null, sourceName: null, parentId: null, doc: null };
  }

  function moveTargetClickHandler(e) {
    if (!_moveState.active) return;
    var targetLi = e.target.closest('li.tp-move-target');
    if (!targetLi) { if (e.target.closest('#tp-move-banner')) return; return; }
    e.stopPropagation();
    e.preventDefault();
    var targetId = getNodeId(targetLi);
    if (!targetId) return;
    var targetName = getNodeName(_moveState.doc, targetId) || ('ID ' + targetId);
    var sId = _moveState.sourceId, sName = _moveState.sourceName, sParent = _moveState.parentId;
    var doc = _moveState.doc;
    exitMoveMode();
    performValueMove(doc, sId, sName, sParent, targetId, targetName);
  }

  // Zbiera sciezki URL wartosci per sklep x jezyk (getNode -> seolink[0]). Pomija puste.
  async function _collectValueUrls(valueId, shops, langs) {
    var map = {};
    for (var si = 0; si < shops.length; si++) {
      for (var li = 0; li < langs.length; li++) {
        var sh = shops[si], lg = langs[li];
        try {
          var r = await fetchAjax('action=getNode&node_id=' + valueId + '&lang=' + lg + '&shop=' + sh + '&tree=parameters&parent=0');
          var seo = r && r.data && r.data.seolink && r.data.seolink[0];
          if (seo) {
            var path;
            try { path = new URL(seo).pathname; } catch (e) { path = seo; }
            map[sh + '|' + lg] = path;
          }
        } catch (e) {}
      }
    }
    return map;
  }

  // Dodaje przekierowanie 301 w danym sklepie (config-system-services.php).
  // v4.6.172: usuwa host z fromPath (IdoSell przyjmuje TYLKO path bez domeny);
  // uzywa iframe XHR (sesja config-system) zamiast outer fetch.
  function _addRedirect(shop, fromPath, toPath) {
    // Normalizacja: usun protokol + host, zostaw tylko path
    function _stripHost(u) {
      if (!u) return '';
      u = String(u).trim();
      var m = u.match(/^https?:\/\/[^\/]+(\/.*)?$/i);
      if (m) return m[1] || '/';
      return u;
    }
    fromPath = _stripHost(fromPath);
    toPath = _stripHost(toPath);
    var url = '/panel/config-system-services.php?shop=' + encodeURIComponent(shop) + '&action=redirects';
    var body = 'tmp_id=' + Date.now() + '&uri=' + encodeURIComponent(fromPath) +
      '&destination=' + encodeURIComponent(toPath) + '&type=301';
    // Iframe XHR (sesja jest w iframe)
    var iWin = (typeof getIframeWin === 'function') ? getIframeWin() : null;
    return new Promise(function (resolve) {
      var xhr = iWin ? new iWin.XMLHttpRequest() : new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.onload = function () {
        var t = xhr.responseText || '';
        var j; try { j = JSON.parse(t); } catch (e) { j = null; }
        resolve(!!(j && (j.error === 0 || j.error === '0')));
      };
      xhr.onerror = function () { resolve(false); };
      xhr.send(body);
    });
  }

  // v4.6.96: przepina istniejace przekierowania wskazujace na stary URL wartosci
  // na nowy URL — zapobiega lancuchom przekierowan przy wielokrotnym przenoszeniu
  // tej samej wartosci (urlA->urlB->urlC staje sie urlA->urlC, urlB->urlC).
  // Zwraca liczbe przepietych przekierowan.
  async function _repointRedirects(shop, oldDest, newDest) {
    var gate = '/panel/config-system-services.php?shop=' + encodeURIComponent(shop) + '&action=redirects';
    var count = 0;
    try {
      var html = await fetch(gate, { credentials: 'same-origin' }).then(function (r) { return r.text(); });
      var map = {};
      html.replace(/span_uri_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (map[id] = map[id] || {}).uri = v.replace(/<[^>]*>/g, '').trim(); });
      html.replace(/span_dest_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (map[id] = map[id] || {}).dest = v.replace(/<[^>]*>/g, '').trim(); });
      html.replace(/span_type_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (map[id] = map[id] || {}).type = v.replace(/<[^>]*>/g, '').trim(); });
      var ids = Object.keys(map);
      for (var i = 0; i < ids.length; i++) {
        var rd = map[ids[i]];
        if (!rd || rd.dest !== oldDest) continue;
        if (rd.uri === newDest) continue;
        var body = 'operation=edit&id=' + encodeURIComponent(ids[i]) +
          '&uri=' + encodeURIComponent(rd.uri) +
          '&destination=' + encodeURIComponent(newDest) +
          '&type=' + encodeURIComponent(rd.type || '301');
        var ok = await fetch(gate, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
          body: body
        }).then(function (r) { return r.text(); }).then(function (t) {
          var j; try { j = JSON.parse(t); } catch (e) { j = null; }
          return !!(j && j.error === 0);
        }).catch(function () { return false; });
        if (ok) count++;
      }
    } catch (e) {}
    return count;
  }

  async function performValueMove(doc, sourceId, sourceName, sourceParamId, targetParamId, targetParamName) {
    if (!confirm('Przeniesc wartosc \u201e' + sourceName + '\u201d do parametru \u201e' + targetParamName + '\u201d?\n\n' +
      'Towary zostana przepisane, a stare adresy URL wartosci \u2014 przekierowane (301) na nowe.\n' +
      'Operacja jest nieodwracalna.')) return;
    showForceDeleteStatus(doc, 'Przenoszenie \u201e' + sourceName + '\u201d \u2014 przygotowanie...');
    try {
      var win = getIframeWin();
      var shops = (win && win.IAI && win.IAI.shops_list) ? win.IAI.shops_list.map(function (sh) { return String(sh.id); }) : ['1'];
      var ldResp = await fetchAjax('action=getParameterLangData&id=' + sourceId);
      var langs = (ldResp && ldResp.data && ldResp.data.langData) ? Object.keys(ldResp.data.langData) : [LANG];

      // 1) stare adresy URL przed przeniesieniem
      showForceDeleteStatus(doc, 'Zbieranie adresow URL wartosci...');
      var oldUrls = await _collectValueUrls(sourceId, shops, langs);

      // 2) kolizja nazw w parametrze docelowym
      var targetChildren = [];
      try { targetChildren = await loadChildValues(targetParamId); } catch (e) {}
      var existing = null;
      for (var c = 0; c < targetChildren.length; c++) {
        if ((targetChildren[c].name || '').toLowerCase() === (sourceName || '').toLowerCase()) { existing = targetChildren[c]; break; }
      }
      var targetValueId;
      if (existing) {
        if (!confirm('Parametr \u201e' + targetParamName + '\u201d ma juz wartosc \u201e' + sourceName + '\u201d (ID: ' + existing.id + ').\n\n' +
          'Scalic przenoszona wartosc z istniejaca?\nAnuluj = przerwij przenoszenie.')) {
          showForceDeleteStatus(doc, 'Przenoszenie anulowane', true);
          return;
        }
        targetValueId = existing.id;
      } else {
        showForceDeleteStatus(doc, 'Tworzenie wartosci w \u201e' + targetParamName + '\u201d...');
        var createResp = await fetchAjax('action=checkElValues&type=value&lang=' + LANG +
          '&parameter_id=' + targetParamId + '&product=0&value[]=' + encodeURIComponent(sourceName));
        if (createResp && createResp.error) throw new Error(createResp.error);
        if (createResp && createResp.data && createResp.data.children && createResp.data.children.length) {
          targetValueId = createResp.data.children[createResp.data.children.length - 1].id;
        } else {
          throw new Error('Nie udalo sie utworzyc wartosci w parametrze docelowym');
        }
      }

      // 3) przepisanie towarow + usuniecie zrodla
      // v4.6.174: PRZED merge zbierz produkty — mergeParam nie zaklada parameter→product w target
      var affectedForMove = await _getProductIdsForNode(sourceId);
      showForceDeleteStatus(doc, 'Przepisywanie towarow...');
      var mergeResp = await fetchAjax('action=mergeParam&id=' + sourceId + '&idExist=' + targetValueId);
      if (mergeResp && mergeResp.error && mergeResp.error !== '') throw new Error(mergeResp.error);
      await fetchAjax('action=removeParam&node=' + sourceId + '&tree=0&shop=2&parent=' + sourceParamId);
      // v4.6.174: dopnij parameter→product w target dla produktow z source
      if (affectedForMove.length) {
        showForceDeleteStatus(doc, 'Dopinanie parametru docelowego do ' + affectedForMove.length + ' towar(ów)...');
        await _attachParameterValueToProducts(affectedForMove, targetParamId, targetValueId);
      }

      // 4) nowe adresy URL + przekierowania 301
      showForceDeleteStatus(doc, 'Zakladanie przekierowan 301...');
      var newUrls = await _collectValueUrls(targetValueId, shops, langs);
      var redirOk = 0, redirFail = 0, repointed = 0;
      var keys = Object.keys(oldUrls);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var fromP = oldUrls[key], toP = newUrls[key];
        if (!toP || toP === fromP) continue;
        var shopId = key.split('|')[0];
        // przepnij istniejace przekierowania wskazujace na stary URL -> nowy (bez lancuchow)
        repointed += await _repointRedirects(shopId, fromP, toP);
        // dodaj nowe przekierowanie stary -> nowy
        var ok = await _addRedirect(shopId, fromP, toP);
        if (ok) redirOk++; else redirFail++;
      }

      // 5) DOM + cache
      var srcLi = doc.getElementById('m_' + sourceId);
      if (srcLi) {
        var space = doc.getElementById('space_' + sourceId);
        if (space) space.remove();
        srcLi.remove();
      }
      try { tpCacheClearAll(); } catch (e) {}
      updateCounter(doc);
      var msg = 'Przeniesiono \u201e' + sourceName + '\u201d do \u201e' + targetParamName +
        '\u201d \u2014 przekierowan 301: ' + redirOk + (repointed ? (', przepieto: ' + repointed) : '') + (redirFail ? (', nieudanych: ' + redirFail) : '');
      showForceDeleteStatus(doc, msg, !!redirFail);
    } catch (e) {
      showForceDeleteStatus(doc, 'Blad przenoszenia: ' + (e && e.message || e), true);
    }
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
      // v4.6.81: toast feedback
      try { if (_panel && _panel.showStatus) _panel.showStatus('Skopiowano ID: ' + nodeId); } catch (e) {}
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
    if (isPar && hasFeature(FEATURES.ADD_VALUE)) {
      var addAction = doc.createElement('span');
      addAction.className = 'material-symbols-outlined tp-action-btn tp-act-add';
      addAction.textContent = 'add_circle';
      addAction.title = 'Dodaj warto\u015b\u0107';
      addAction.dataset.tooltip = 'Dodaj warto\u015b\u0107';
      addAction.addEventListener('click', function(e) {
        e.stopPropagation();
        createNewValue(doc, nodeId, nodeName);
      });
      actionsCell.appendChild(addAction);
    }

    // v4.6.83: kolejność dla parametru: + ★ ⚙ AZ # 🗑 (zamiast + ⚙ ★ AZ # 🗑).
    // Dzięki temu zębatka parametru (3. od lewej) i zębatka wartości (1. od lewej)
    // wyrównują się w tej samej kolumnie X (4. od prawej w obu wierszach).
    // c) Set as default (ustaw jako domyślny) — only for parameters [TERAZ PRZED settings]
    if (isPar && hasFeature(FEATURES.SET_DEFAULT_VALUE)) {
      var defaultActionEarly = doc.createElement('span');
      defaultActionEarly.className = 'material-symbols-outlined tp-action-btn tp-act-star';
      defaultActionEarly.textContent = 'star';
      defaultActionEarly.title = 'Ustaw jako domyślny';
      defaultActionEarly.dataset.tooltip = 'Ustaw jako domyślny';
      defaultActionEarly.addEventListener('click', function(e) {
        e.stopPropagation();
        ensureOptionsAndClick('default_' + nodeId);
      });
      actionsCell.appendChild(defaultActionEarly);
    }

    // b) Settings (edytuj) — triggers native editEl
    if (hasFeature(FEATURES.SETTINGS_MODAL)) {
      var editAction = doc.createElement('span');
      editAction.className = 'material-symbols-outlined tp-action-btn tp-act-settings';
      editAction.textContent = 'settings';
      editAction.title = 'Edytuj';
      editAction.dataset.tooltip = 'Edytuj';
      editAction.addEventListener('click', function(e) {
        e.stopPropagation();
        showEditElementModal(doc, nodeId);
      });
      actionsCell.appendChild(editAction);
    }

    // b2) SEO (tylko wartości) — osobny modal SEO (Meta/Robots/Adres URL/Przekierowania)
    if (isVal && hasFeature(FEATURES.SEO_MODAL)) {
      var seoAction = doc.createElement('span');
      seoAction.className = 'material-symbols-outlined tp-action-btn tp-act-seo';
      seoAction.textContent = 'travel_explore';
      seoAction.title = 'SEO';
      seoAction.dataset.tooltip = 'SEO';
      seoAction.addEventListener('click', function (e) {
        e.stopPropagation();
        showValueSeoModal(doc, nodeId);
      });
      actionsCell.appendChild(seoAction);
    }

    // c) [PRZENIESIONE WYŻEJ] — pozostaje stub dla zachowania numeracji
    if (false && isPar && hasFeature(FEATURES.SET_DEFAULT_VALUE)) {
      var defaultAction = doc.createElement('span');
      defaultAction.className = 'material-symbols-outlined tp-action-btn tp-act-star';
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
    if (isPar && hasFeature(FEATURES.SORT_VALUES_ALPHA)) {
      var sortAction = doc.createElement('span');
      sortAction.className = 'material-symbols-outlined tp-action-btn tp-act-sort-alpha';
      sortAction.textContent = 'sort_by_alpha';
      sortAction.title = 'Posortuj warto\u015bci (sortowanie naturalne)';
      sortAction.dataset.tooltip = 'Posortuj warto\u015bci';
      sortAction.addEventListener('click', function(e) {
        e.stopPropagation();
        sortChildValuesNatural(doc, nodeId, 'name');
      });
      actionsCell.appendChild(sortAction);
    }
    if (isPar && hasFeature(FEATURES.SORT_VALUES_BY_ID)) {
      // v4.6.1: sortowanie wartości po ID (rosnąco)
      var sortIdAction = doc.createElement('span');
      sortIdAction.className = 'material-symbols-outlined tp-action-btn tp-act-sort-id';
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
    if (isVal && hasFeature(FEATURES.MERGE_VALUES)) {
      var mergeAction = doc.createElement('span');
      mergeAction.className = 'material-symbols-outlined tp-action-btn tp-action-btn--merge tp-act-merge';
      mergeAction.textContent = 'cell_merge';
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

    // f) Move element (przenies do innego parametru) — only for values
    if (isVal && hasFeature(FEATURES.MERGE_VALUES)) {
      var moveAction = doc.createElement('span');
      moveAction.className = 'material-symbols-outlined tp-action-btn tp-action-btn--move tp-act-move';
      moveAction.textContent = 'drive_file_move';
      moveAction.title = 'Przenie\u015b do innego parametru';
      moveAction.dataset.tooltip = 'Przenie\u015b';
      moveAction.addEventListener('click', function(e) {
        e.stopPropagation();
        var parentUl = li.closest('ul[id^="block_group"]');
        var parentId = parentUl ? parentUl.id.replace('block_group', '') : '0';
        enterMoveMode(doc, nodeId, nodeName, parentId);
      });
      actionsCell.appendChild(moveAction);
    }

    // g) Delete (always red)
    if (hasFeature(FEATURES.DELETE_ELEMENT)) {
      var deleteAction = doc.createElement('span');
      deleteAction.className = 'material-symbols-outlined tp-action-btn tp-action-btn--danger tp-act-delete';
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
    }

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
    var cachedCtx = _ctxCache[nodeId + '@' + LANG];
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

  // v4.6.81: multi-search. q może być pojedynczym terminem LUB listą oddzieloną | lub ,
  //   "kolor" — pojedynczy token
  //   "20926|20960|kolor" — OR match (rząd widoczny jak DOWOLNY z tokenów pasuje)
  function _qTokens(q) {
    var s = String(q || '').toLowerCase();
    if (s.indexOf('|') < 0 && s.indexOf(',') < 0) return [s];
    var out = [];
    s.split(/[|,]/).forEach(function (t) { var x = t.trim(); if (x) out.push(x); });
    return out.length ? out : [s];
  }
  function _qHit(name, id, q) {
    var nm = String(name || '').toLowerCase();
    var idStr = String(id || '');
    var tokens = _qTokens(q);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (nm.indexOf(t) !== -1 || idStr.indexOf(t) !== -1) return true;
    }
    return false;
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

  // v4.6.174: po mergeParam (cross-parameter) trzeba osobno dopiac parameter→product
  // bo natywny mergeParam jest plytki — przepina tylko value→product. Per produkt z source
  // value wywolujemy saveParametersChanges z add (parametr) + changeParent (wartosc) — to
  // ten sam payload co natywna edycja towaru (sprawdzone live demo37 2026-06-08:
  // products-list.php?trait=<paramId> po naprawie zaczyna zwracac produkt).
  async function _attachParameterValueToProducts(productIds, paramId, valueId, onStep) {
    if (!productIds || !productIds.length) return { ok: 0, errs: [] };
    var ok = 0, errs = [];
    var data = JSON.stringify([
      { operation: 'add', parameter: String(paramId) },
      { operation: 'changeParent', parameter: String(paramId), value: String(valueId) }
    ]);
    var body = 'data=' + encodeURIComponent(data) + '&columns=' + encodeURIComponent('[]');
    for (var i = 0; i < productIds.length; i++) {
      if (onStep) try { onStep(i + 1, productIds.length, productIds[i]); } catch (e) {}
      try {
        var resp = await fetchAjaxRaw(AJAX_URL + '?action=saveParametersChanges&productId=' + encodeURIComponent(productIds[i]), body);
        if (resp && resp.errno && Number(resp.errno) !== 0) errs.push({ pid: productIds[i], msg: resp.error || ('errno ' + resp.errno) });
        else ok++;
      } catch (e) {
        errs.push({ pid: productIds[i], msg: e.message || String(e) });
      }
      if (i < productIds.length - 1) await sleep(150);
    }
    return { ok: ok, errs: errs };
  }

  // v4.6.174: pobierz liste ID produktow dla wartosci/parametru
  async function _getProductIdsForNode(nodeId) {
    try {
      var occ = await fetchAjax('action=numberOfOccurrence&id=' + encodeURIComponent(nodeId));
      var raw = occ && occ.data ? occ.data.products : null;
      var out = [];
      if (Array.isArray(raw)) raw.forEach(function (p) { out.push(String(typeof p === 'object' ? (p.id || p.product_id) : p)); });
      else if (raw && typeof raw === 'object') Object.values(raw).forEach(function (p) { out.push(String(typeof p === 'object' ? (p.id || p.product_id) : p)); });
      return out;
    } catch (e) { return []; }
  }

  // v4.6.175: pobierz liste ID produktow dla wezla przez natywna strone products-list?trait=
  // To jest source of truth dla parameter→product (relacja w bazie), w przeciwienstwie do
  // numberOfOccurrence ktore bywa zawodne. Patrz [[mergeparam-shallow-parameter-product]].
  async function _getProductIdsViaProductsList(nodeId) {
    var url = '/panel/products-list.php?trait=' + encodeURIComponent(nodeId);
    var iWin = (typeof getIframeWin === 'function') ? getIframeWin() : null;
    return new Promise(function (resolve) {
      var xhr = iWin ? new iWin.XMLHttpRequest() : new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.onload = function () {
        var txt = xhr.responseText || '';
        var ids = [];
        var seen = {};
        var re = /idt=(\d+)/g, m;
        while ((m = re.exec(txt)) !== null) { if (!seen[m[1]]) { seen[m[1]] = 1; ids.push(m[1]); } }
        resolve(ids);
      };
      xhr.onerror = function () { resolve([]); };
      xhr.send();
    });
  }

  // v4.6.175: skanuje cale drzewo szukajac rozjazdow parameter→product i naprawia.
  // Dla kazdej wartosci V z parent P: produkty(V) - produkty(P) = sieroty → attach.
  async function scanAndRepairParameterProductAssignments(doc, onProgress) {
    var d = doc || getIframeDoc() || document;
    var rootBlock = d.getElementById('block_group0');
    if (!rootBlock) return { error: 'brak drzewa' };
    // 1) lista wszystkich parametrow root (te ktore moga miec wartosci)
    var rootLis = Array.from(rootBlock.querySelectorAll(':scope > li[id^="m_"]'));
    var params = [];
    rootLis.forEach(function (li) {
      var pid = li.id.replace('m_', '');
      var sub = d.getElementById('showMenuSub_' + pid);
      var cls = sub ? sub.className : '';
      if (/section/.test(cls)) return; // sekcje pomijamy
      var name = sub ? sub.textContent.trim() : '';
      params.push({ id: pid, name: name });
    });
    if (onProgress) try { onProgress({ stage: 'init', total: params.length }); } catch (e) {}

    var fixed = 0, scanned = 0, errors = [], details = [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      if (onProgress) try { onProgress({ stage: 'param', index: i + 1, total: params.length, name: p.name }); } catch (e) {}
      try {
        // 2) produkty parametru (parameter→product)
        var paramProducts = await _getProductIdsViaProductsList(p.id);
        var paramSet = {};
        paramProducts.forEach(function (id) { paramSet[id] = 1; });
        // 3) wartosci tego parametru (z drzewa — jesli rozwiniete) lub przez expand
        await ensureNodeExpanded(d, p.id);
        var block = d.getElementById('block_group' + p.id);
        if (!block) continue;
        var valueLis = block.querySelectorAll(':scope > li[id^="m_"]');
        for (var v = 0; v < valueLis.length; v++) {
          var vid = valueLis[v].id.replace('m_', '');
          var vSub = d.getElementById('showMenuSub_' + vid);
          var vname = vSub ? vSub.textContent.trim() : vid;
          if (onProgress) try { onProgress({ stage: 'value', paramName: p.name, valueName: vname, valueIndex: v + 1, valueTotal: valueLis.length }); } catch (e) {}
          // 4) produkty wartosci (value→product)
          var valProducts = await _getProductIdsViaProductsList(vid);
          scanned++;
          // 5) sieroty = produkty wartosci ktore NIE sa w parametrze
          var orphans = valProducts.filter(function (pid) { return !paramSet[pid]; });
          if (orphans.length) {
            details.push({ paramId: p.id, paramName: p.name, valueId: vid, valueName: vname, orphans: orphans.slice() });
            // 6) napraw: attach per produkt
            var res = await _attachParameterValueToProducts(orphans, p.id, vid);
            fixed += res.ok;
            if (res.errs && res.errs.length) res.errs.forEach(function (e) { errors.push({ vid: vid, vname: vname, pid: e.pid, msg: e.msg }); });
            // dodaj naprawione do setu parametru, zeby nie powtarzac
            orphans.forEach(function (pid) { paramSet[pid] = 1; });
          }
          await sleep(50);
        }
      } catch (e) {
        errors.push({ paramId: p.id, paramName: p.name, msg: e.message || String(e) });
      }
    }
    return { fixed: fixed, scanned: scanned, errors: errors, details: details, paramCount: params.length };
  }

  // v4.6.175: modal diagnostyczny "Napraw przypisania parametr↔towar"
  function showRepairAssignmentsModal(doc) {
    var d = doc || getIframeDoc() || document;
    if (!d.getElementById('tpcd-dmsans-link')) {
      var lnk = d.createElement('link'); lnk.id = 'tpcd-dmsans-link'; lnk.rel = 'stylesheet';
      lnk.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      d.head.appendChild(lnk);
    }
    var overlay = d.createElement('div'); overlay.className = 'tm-fe-overlay';
    var modal = d.createElement('div'); modal.className = 'tm-fe-modal tm-fe-modal--wide';

    var header = d.createElement('div'); header.className = 'tm-fe-header';
    var icon = d.createElement('div'); icon.className = 'tm-fe-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>';
    var titleGroup = d.createElement('div'); titleGroup.className = 'tm-fe-title-group';
    var h2 = d.createElement('h2'); h2.textContent = 'Napraw przypisania parametr↔towar';
    var pEl = d.createElement('p'); pEl.textContent = 'Skanuje drzewo i dopina brakujące relacje parameter→product';
    titleGroup.appendChild(h2); titleGroup.appendChild(pEl);
    var closeBtn = d.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'tm-fe-close';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    header.appendChild(icon); header.appendChild(titleGroup); header.appendChild(closeBtn);
    modal.appendChild(header);

    var body = d.createElement('div'); body.className = 'tm-fe-body';
    body.innerHTML =
      '<div class="tm-fe-field-block" style="padding:18px 24px;">' +
      '<div style="font-size:13.5px;color:#4a5568;line-height:1.55;">' +
      'Operacja przeskanuje wszystkie parametry i ich wartości. Dla każdej wartości pobierze listę towarów, ' +
      'porówna ze stanem parameter→product i automatycznie naprawi brakujące przypisania ' +
      '(natywny payload <code>saveParametersChanges</code>).' +
      '<br><br><b>Bezpieczeństwo:</b> operacja jest idempotentna — produkty już prawidłowo przypisane są pomijane.' +
      '<br><b>Czas:</b> ~1-3 s na parametr × liczba parametrów.' +
      '</div></div>' +
      '<div class="tm-fe-field-block tpra-status" style="padding:16px 24px;display:none;">' +
      '<div class="tm-fe-field-label">Postęp</div>' +
      '<div class="tpra-progress-text" style="font-size:13px;color:#1a202c;margin-bottom:8px;">Inicjalizacja…</div>' +
      '<div style="height:6px;background:#eef0f3;border-radius:3px;overflow:hidden;">' +
      '<div class="tpra-progress-bar" style="height:100%;width:0%;background:#2563eb;transition:width .2s;"></div>' +
      '</div>' +
      '</div>' +
      '<div class="tpra-result" style="display:none;"></div>';
    modal.appendChild(body);

    var footer = d.createElement('div'); footer.className = 'tm-fe-footer';
    var cancelBtn = d.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'tm-fe-btn tm-fe-btn-ghost'; cancelBtn.textContent = 'Anuluj';
    var startBtn = d.createElement('button'); startBtn.type = 'button'; startBtn.className = 'tm-fe-btn tm-fe-btn-primary'; startBtn.textContent = 'Skanuj i napraw';
    footer.appendChild(cancelBtn); footer.appendChild(startBtn);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    d.body.appendChild(overlay);

    function close() { overlay.remove(); }
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    var statusBlock = body.querySelector('.tpra-status');
    var progressText = body.querySelector('.tpra-progress-text');
    var progressBar = body.querySelector('.tpra-progress-bar');
    var resultBlock = body.querySelector('.tpra-result');

    startBtn.addEventListener('click', async function () {
      startBtn.disabled = true; cancelBtn.disabled = true;
      statusBlock.style.display = '';
      var lastTotal = 0;
      var res = await scanAndRepairParameterProductAssignments(d, function (ev) {
        if (ev.stage === 'init') {
          progressText.textContent = 'Parametrów do sprawdzenia: ' + ev.total;
          lastTotal = ev.total;
        } else if (ev.stage === 'param') {
          progressText.textContent = '[' + ev.index + '/' + ev.total + '] ' + ev.name;
          progressBar.style.width = Math.round((ev.index / ev.total) * 100) + '%';
        } else if (ev.stage === 'value') {
          progressText.textContent = ev.paramName + ' → ' + ev.valueName + ' (' + ev.valueIndex + '/' + ev.valueTotal + ')';
        }
      });
      progressBar.style.width = '100%';
      progressText.textContent = 'Gotowe.';
      // Render wynik
      var html = '<div class="tm-fe-field-block" style="padding:16px 24px;">' +
        '<div class="tm-fe-field-label">Wynik skanu</div>' +
        '<div style="font-size:13.5px;color:#1a202c;line-height:1.6;">' +
        'Parametry: <b>' + res.paramCount + '</b><br>' +
        'Wartości sprawdzonych: <b>' + res.scanned + '</b><br>' +
        'Naprawionych przypisań: <b style="color:' + (res.fixed ? '#16a34a' : '#9aa3b0') + ';">' + res.fixed + '</b>' +
        '</div></div>';
      if (res.details && res.details.length) {
        html += '<div class="tm-fe-field-block" style="padding:16px 24px;"><div class="tm-fe-field-label">Naprawione wartości (' + res.details.length + ')</div>' +
          '<div style="max-height:240px;overflow-y:auto;background:#fafbfc;border:1px solid #e4e7ec;border-radius:8px;padding:8px 12px;">';
        res.details.forEach(function (de) {
          html += '<div style="font-size:12.5px;color:#4a5568;padding:5px 0;border-bottom:1px solid #eef0f3;">' +
            '<b style="color:#1a202c;">' + (de.paramName || de.paramId) + '</b> → ' + (de.valueName || de.valueId) +
            ' <span style="color:#9aa3b0;">— dopięto do ' + de.orphans.length + ' towar(ów)</span>' +
            '</div>';
        });
        html += '</div></div>';
      }
      if (res.errors && res.errors.length) {
        html += '<div class="tm-fe-field-block" style="padding:16px 24px;"><div class="tm-fe-field-label">Błędy (' + res.errors.length + ')</div>' +
          '<div style="max-height:200px;overflow-y:auto;background:#fafbfc;border:1px solid #e4e7ec;border-radius:8px;padding:8px 12px;">';
        res.errors.forEach(function (er) {
          html += '<div style="font-size:12.5px;color:#4a5568;padding:5px 0;border-bottom:1px solid #eef0f3;">' +
            '<b>' + (er.vname || er.paramName || '?') + '</b> <span style="color:#9aa3b0;">— ' + (er.msg || '') + '</span>' +
            '</div>';
        });
        html += '</div></div>';
      }
      resultBlock.innerHTML = html;
      resultBlock.style.display = '';
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Zamknij';
      startBtn.style.display = 'none';
    });
  }

  // v4.6.173: soft refresh wartosci parametru w drzewie (bez location.reload)
  function refreshParamValuesInTree(doc, pid) {
    return new Promise(function (resolve) {
      var block = doc.getElementById('block_group' + pid);
      var btn = doc.getElementById('showChildren_' + pid);
      if (!btn || !block) return resolve();
      var wasExpanded = !!block.querySelector(':scope > li[id^="m_"]');
      if (!wasExpanded) return resolve();
      btn.click(); // collapse — czyści DOM dzieci
      setTimeout(function () {
        btn.click(); // expand — IdoSell pobiera dzieci na nowo
        var checks = 0;
        var iv = setInterval(function () {
          checks++;
          var b = doc.getElementById('block_group' + pid);
          if ((b && b.querySelector(':scope > li[id^="m_"]')) || checks > 100) {
            clearInterval(iv);
            resolve();
          }
        }, 30);
      }, 150);
    });
  }

  // v4.6.173: custom modal podsumowania bulk operacji (zastepuje natywny alert())
  function _showBulkSummaryModal(doc, paramName, summary, errors, onClose) {
    var overlay = doc.createElement('div'); overlay.className = 'tm-fe-overlay';
    var modal = doc.createElement('div'); modal.className = 'tm-fe-modal' + (errors && errors.length ? ' tm-fe-modal--wide' : '');
    var header = doc.createElement('div'); header.className = 'tm-fe-header';
    var icon = doc.createElement('div'); icon.className = 'tm-fe-icon';
    var iconOk = !errors || !errors.length;
    icon.innerHTML = iconOk
      ? '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    if (!iconOk) {
      icon.style.background = '#fef3c7';
      icon.style.borderColor = '#fcd34d';
      var svg = icon.querySelector('svg'); if (svg) svg.style.stroke = '#d97706';
    }
    var titleGroup = doc.createElement('div'); titleGroup.className = 'tm-fe-title-group';
    var h2 = doc.createElement('h2'); h2.textContent = iconOk ? 'Operacja zakończona' : 'Operacja zakończona z błędami';
    var pEl = doc.createElement('p'); pEl.textContent = 'Parametr „' + paramName + '"';
    titleGroup.appendChild(h2); titleGroup.appendChild(pEl);
    var closeBtn = doc.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'tm-fe-close';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    header.appendChild(icon); header.appendChild(titleGroup); header.appendChild(closeBtn);
    modal.appendChild(header);

    var body = doc.createElement('div'); body.className = 'tm-fe-body';
    var sumBlock = doc.createElement('div'); sumBlock.className = 'tm-fe-field-block';
    sumBlock.style.padding = '18px 24px';
    var sumText = doc.createElement('div');
    sumText.style.cssText = 'font-size:14px;color:#1a202c;line-height:1.5;';
    sumText.textContent = summary + '.';
    sumBlock.appendChild(sumText);
    body.appendChild(sumBlock);

    if (errors && errors.length) {
      var errBlock = doc.createElement('div'); errBlock.className = 'tm-fe-field-block';
      var errLabel = doc.createElement('div'); errLabel.className = 'tm-fe-field-label';
      errLabel.textContent = 'Błędy (' + errors.length + ')';
      errBlock.appendChild(errLabel);
      var errList = doc.createElement('div');
      errList.style.cssText = 'max-height:300px;overflow-y:auto;background:#fafbfc;border:1px solid #e4e7ec;border-radius:8px;padding:8px 12px;';
      for (var i = 0; i < errors.length; i++) {
        var row = doc.createElement('div');
        row.style.cssText = 'font-size:12.5px;color:#4a5568;padding:6px 0;border-bottom:1px solid #eef0f3;line-height:1.4;';
        if (i === errors.length - 1) row.style.borderBottom = 'none';
        var nm = doc.createElement('strong');
        nm.style.cssText = 'color:#1a202c;font-weight:600;';
        nm.textContent = errors[i].name || '?';
        var msg = doc.createElement('span');
        msg.style.cssText = 'color:#9aa3b0;margin-left:6px;';
        msg.textContent = '— ' + (errors[i].msg || '');
        row.appendChild(nm); row.appendChild(msg);
        errList.appendChild(row);
      }
      errBlock.appendChild(errList);
      body.appendChild(errBlock);
    }
    modal.appendChild(body);

    var footer = doc.createElement('div'); footer.className = 'tm-fe-footer';
    var okBtn = doc.createElement('button'); okBtn.type = 'button';
    okBtn.className = 'tm-fe-btn tm-fe-btn-primary';
    okBtn.textContent = 'OK';
    footer.appendChild(okBtn);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    function _close() {
      overlay.remove();
      if (typeof onClose === 'function') try { onClose(); } catch (e) {}
    }
    closeBtn.addEventListener('click', _close);
    okBtn.addEventListener('click', _close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _close(); });

    doc.body.appendChild(overlay);
    setTimeout(function () { try { okBtn.focus(); } catch (e) {} }, 50);
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
      // v4.6.81: multi-search (q może zawierać tokeny oddzielone | lub ,)
      var paramMatch = _qHit(pname, pid, q);
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

          // v4.6.174: PRZED mergeParam zbierz produkty dotkniete (zeby po merge dopiac
          // parameter→product w target, czego natywny mergeParam nie robi — sprawdzone live)
          var affectedProducts = (sourceParamId !== selectedParamId) ? await _getProductIdsForNode(valId) : [];

          // Merge source → target (moves products automatically)
          var mergeResp = await fetchAjax(
            'action=mergeParam&id=' + valId + '&idExist=' + targetValueId
          );
          if (mergeResp.error && mergeResp.error !== '') throw new Error(mergeResp.error);

          // Remove source value from tree (mergeParam doesn't auto-delete)
          await fetchAjax(
            'action=removeParam&node=' + valId + '&tree=0&shop=2&parent=' + sourceParamId
          );

          // v4.6.174: domknij relacje parameter→product w target dla produktow z source
          if (affectedProducts.length) {
            statusText.textContent = 'Dopinanie parametru docelowego do ' + affectedProducts.length + ' towar(ów)...';
            await _attachParameterValueToProducts(affectedProducts, selectedParamId, targetValueId);
          }

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
  let alphaSectionsAscending = true; // v4.6.113: sortowanie alfabetyczne sekcji

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
          _panel.showStatus('Posortowano alfabetycznie (' + (sortAscending ? 'Z\u2192A' : 'A\u2192Z') + ') \u2014 tylko bieżący widok');
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
          _panel.showStatus('Posortowano wg ID (' + (idAscending ? 'rosn\u0105co' : 'malej\u0105co') + ') \u2014 tylko bieżący widok');
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
    if (_panel) _panel.showStatus('Sekcje posortowane wg ID — tylko bieżący widok');
  }

  // v4.6.113: sortowanie sekcji alfabetycznie (analog sortSectionsById; tylko DOM —
  // saveManualSort nie obsluguje top-level sekcji)
  function sortSectionsAlphabetically(doc) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var ul = _sectionsMount.listEl;
    var items = Array.prototype.slice.call(ul.querySelectorAll(':scope > li'));
    if (items.length === 0) return;
    items.sort(function (a, b) {
      var na = a.dataset.sectionName || '';
      var nb = b.dataset.sectionName || '';
      return alphaSectionsAscending ? na.localeCompare(nb, 'pl') : nb.localeCompare(na, 'pl');
    });
    items.forEach(function (li) { ul.appendChild(li); });
    alphaSectionsAscending = !alphaSectionsAscending;
    _secPagination.currentPage = 1;
    applySectionsPagination(doc);
    if (_panel) _panel.showStatus('Sekcje posortowane alfabetycznie (' + (alphaSectionsAscending ? 'Z\u2192A' : 'A\u2192Z') + ') — tylko bieżący widok');
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
    // v4.6.148: lista sklepow z IAI.shops_list — wybor ktorych eksportowac
    var _winSE = (typeof getIframeWin === 'function') ? getIframeWin() : window;
    var _slSE = (_winSE && _winSE.IAI && _winSE.IAI.shops_list) ? _winSE.IAI.shops_list : [];
    var stateShops = _slSE.length
      ? _slSE.map(function (s) { return { code: String(s.id), label: s.name || ('Sklep ' + s.id), on: true }; })
      : [{ code: '1', label: 'Sklep 1', on: true }];
    // v4.6.145: redesign na wzor Menu — 3 sekcje (General/SEO/Extras)
    // v4.6.146: rozbicie na granularne pola (display + filtry + typ grafiki)
    var stateGeneral = isSec ? [
      { key: 'node_name', label: 'Nazwa sekcji', on: true }
    ] : [
      { key: 'node_name', label: 'Nazwa elementu', on: true },
      { key: 'node_description', label: 'Opis elementu', on: true },
      { key: 'headline_name', label: 'Nazwa w nagłówku strony', on: false },
      { key: 'node_desc', label: 'Opis na liście towarów', on: false },
      { key: 'display_mode', label: 'Tryb wyświetlania', on: false },
      { key: 'sort', label: 'Sortowanie', on: false },
      { key: 'display_limit', label: 'Limit na stronie', on: false },
      { key: 'filter_default', label: 'Filtry: tryb (domyślny / własny)', on: false },
      { key: 'filter_active', label: 'Filtry: lista aktywnych + kolejność', on: false },
      { key: 'filter_pricestep', label: 'Filtry: krok przedziału brutto', on: false },
      { key: 'filter_pricestepnet', label: 'Filtry: krok przedziału netto', on: false },
      { key: 'filter_name', label: 'Filtry: własne nazwy', on: false },
      { key: 'filter_display', label: 'Filtry: forma wyświetlania (Marka / Seria)', on: false },
      { key: 'filter_default_enabled', label: 'Filtry: domyślnie włączone', on: false },
      { key: 'filter_pricerange', label: 'Filtry: przedziały cenowe brutto', on: false },
      { key: 'filter_pricerangenet', label: 'Filtry: przedziały cenowe netto', on: false },
      { key: 'icon_search_type', label: 'Typ grafiki na liście towarów', on: false },
      { key: 'icon_projector_type', label: 'Typ grafiki na karcie towaru', on: false }
    ];
    var stateSeo = isSec ? [] : [
      { key: 'meta_title', label: 'Meta tytuł', on: false },
      { key: 'meta_description', label: 'Meta opis', on: false },
      { key: 'meta_keywords', label: 'Meta słowa kluczowe', on: false },
      { key: 'meta_robots_index', label: 'Meta robots index', on: false },
      { key: 'meta_robots_follow', label: 'Meta robots follow', on: false },
      { key: 'redirects', label: 'Przekierowania 301', on: false }
    ];
    var stateExtras = isSec ? [
      { key: 'products', label: 'Lista produktów (ID + kody)', desc: 'ID przypisanych towarów per sekcja; kody przez Admin API (opcjonalnie)', on: false }
    ] : [
      { key: 'priority', label: 'Priorytety', desc: 'Pozycja parametru/wartości w drzewie', on: true },
      { key: 'context', label: 'Konteksty specjalne', desc: 'context_id parametrów + context_value_id wartości', on: true },
      { key: 'products', label: 'Lista produktów (ID + kody)', desc: 'ID przypisanych towarów per wartość; kody przez Admin API (opcjonalnie)', on: false },
      // v4.6.156: zamiast osobnego "icon_files" — switch base64 (URLe ikon eksportowane
      // automatycznie gdy icon_search_type lub icon_projector_type zaznaczone)
      { key: 'gfx_base64', label: 'Grafiki jako base64', desc: 'Zamiast URLi konwertuje pliki ikon na base64 (zwiększa rozmiar JSON). Wymaga aktywnego "Typ grafiki na liście / karcie".', on: false }
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
      // v4.6.150: lista sklepow — wertykalna (1 kolumna), zeby id po prawej zawsze widoczne
      '.lang-list[data-role="shop-list"] { grid-template-columns: 1fr; }',
      '.shop-item .lang-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }',
      '.lang-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid #e0e3ea; border-radius: 8px; cursor: pointer; font-size: 12.5px; color: #344054; transition: all .15s; user-select: none; }',
      '.lang-item:hover { background: #fafbfd; }',
      '.lang-item.checked { border: 2px solid #4f8cff; padding: 5px 9px; background: #f5f8ff; }',
      '.lang-flag { font-size: 14px; }',
      '.lang-name { flex: 1; }',
      '.lang-item input { display: none; }',
      '.lang-check { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid #c6d0e0; flex-shrink: 0; position: relative; }',
      '.lang-item.checked .lang-check { background: #4f8cff; border-color: #4f8cff; }',
      '.lang-item.checked .lang-check::after { content: \'\'; position: absolute; left: 3.5px; top: 0.5px; width: 4px; height: 8px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }',
      // v4.6.145: kolumny general/seo + toggle list + switch + extras cards (z Menu tmx-*)
      '.tmx-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 14px; }',
      '.tmx-col { padding-right: 20px; }',
      '.tmx-col + .tmx-col { padding-left: 20px; padding-right: 0; border-left: 1px solid #e4e7ec; }',
      '.tmx-group-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }',
      '.tmx-group-title { font-size: 11.5px; color: #667085; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }',
      '.tmx-toggle-all { font-size: 10.5px; color: #2563eb; background: none; border: none; cursor: pointer; font-family: inherit; font-weight: 500; padding: 2px 6px; border-radius: 4px; transition: background .15s; }',
      '.tmx-toggle-all:hover { background: #eff4ff; }',
      '.tmx-toggle-list { display: flex; flex-direction: column; gap: 1px; }',
      '.tmx-toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 7px 9px; border-radius: 7px; cursor: pointer; transition: background .12s; gap: 8px; }',
      '.tmx-toggle-row:hover { background: #f7f8fa; }',
      '.tmx-toggle-label { font-size: 12.5px; color: #9aa3b0; line-height: 1.35; flex: 1; transition: color .15s; user-select: none; }',
      '.tmx-toggle-row.tmx-active .tmx-toggle-label { color: #4a5568; }',
      '.tmx-sw { position: relative; width: 34px; height: 19px; flex-shrink: 0; }',
      '.tmx-sw input { opacity: 0; width: 0; height: 0; position: absolute; }',
      '.tmx-sw-track { position: absolute; inset: 0; background: #eef0f3; border: 1.5px solid #e4e7ec; border-radius: 99px; cursor: pointer; transition: all .2s; }',
      '.tmx-sw-thumb { position: absolute; top: 3px; left: 3px; width: 11px; height: 11px; border-radius: 50%; background: #9aa3b0; transition: all .22s cubic-bezier(.34,1.2,.64,1); box-shadow: 0 1px 2px rgba(0,0,0,.15); }',
      '.tmx-sw input:checked ~ .tmx-sw-track { background: #16a34a; border-color: #16a34a; }',
      '.tmx-sw input:checked ~ .tmx-sw-track .tmx-sw-thumb { left: 18px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); }',
      '.tmx-extra-section { margin-top: 6px; }',
      '.tmx-section-label { font-size: 11.5px; color: #667085; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: .4px; }',
      '.tmx-extra-cards { display: flex; flex-direction: column; gap: 6px; }',
      '.tmx-extra-card { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid #eef0f4; border-radius: 10px; background: #fafbfd; cursor: pointer; transition: all .15s; }',
      '.tmx-extra-card:hover { border-color: #d6e2ff; }',
      '.tmx-extra-card.tmx-active { border-color: #4f8cff; background: #f5f8ff; }',
      '.tmx-warn-icon { width: 22px; height: 22px; color: #d97706; flex-shrink: 0; }',
      '.tmx-warn-icon svg { width: 100%; height: 100%; }',
      '.tmx-extra-card-text { flex: 1; }',
      '.tmx-extra-card-text strong { display: block; font-size: 12.5px; color: #1a1a2e; font-weight: 600; }',
      '.tmx-extra-card-text span { display: block; font-size: 11px; color: #98a2b3; margin-top: 2px; line-height: 1.4; }',
      '.tmx-extra-card .tmx-sw { margin-left: auto; margin-top: 2px; }',
      '.tmx-extra-card .tmx-sw input:checked ~ .tmx-sw-track { background: #d97706; border-color: #d97706; }',
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

    // v4.6.150: lista sklepow — wertykalna (1 kolumna), bez ikon, label "id: X"
    function buildShopHtml() {
      return stateShops.map(function (s) {
        return '<label class="lang-item shop-item' + (s.on ? ' checked' : '') + '" data-shop="' + s.code + '">' +
          '<span class="lang-check"></span>' +
          '<span class="lang-name">' + s.label + '</span>' +
          '<span style="color:#9aa0a6;font-size:11px;flex-shrink:0">id: ' + s.code + '</span>' +
          '<input type="checkbox"' + (s.on ? ' checked' : '') + '>' +
        '</label>';
      }).join('');
    }
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
      // v4.6.145: extras jako tmx-extra-card (z ostrzezeniem ⚠ + label + desc + switch)
      var warnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><path d="M12 16h.01"/></svg>';
      return stateExtras.map(function (f) {
        var swInner = '<div class="tmx-sw"><input type="checkbox"' + (f.on ? ' checked' : '') + '><div class="tmx-sw-track"><div class="tmx-sw-thumb"></div></div></div>';
        return '<label class="tmx-extra-card' + (f.on ? ' tmx-active' : '') + '" data-extra="' + f.key + '">' +
          '<div class="tmx-warn-icon" style="stroke:#d97706">' + warnIcon + '</div>' +
          '<div class="tmx-extra-card-text"><strong>' + f.label + '</strong><span>' + f.desc + '</span></div>' +
          swInner +
        '</label>';
      }).join('');
    }
    // v4.6.145: kolumna ustawien (General lub SEO) z toggle list
    function buildTogglesHtml(arr, sectionKey) {
      var allOn = arr.length > 0 && arr.every(function (f) { return f.on; });
      var titleMap = { general: 'Ustawienia ogólne', seo: 'Ustawienia SEO' };
      var rows = arr.map(function (f) {
        var sw = '<div class="tmx-sw"><input type="checkbox" data-key="' + f.key + '"' + (f.on ? ' checked' : '') + '><div class="tmx-sw-track"><div class="tmx-sw-thumb"></div></div></div>';
        return '<label class="tmx-toggle-row' + (f.on ? ' tmx-active' : '') + '" data-field="' + f.key + '" data-section="' + sectionKey + '">' +
          '<span class="tmx-toggle-label">' + f.label + '</span>' + sw +
        '</label>';
      }).join('');
      return '<div class="tmx-col">' +
        '<div class="tmx-group-header">' +
          '<span class="tmx-group-title">' + titleMap[sectionKey] + '</span>' +
          '<button type="button" class="tmx-toggle-all" data-toggle-section="' + sectionKey + '">' + (allOn ? 'Odznacz' : 'Zaznacz') + '</button>' +
        '</div>' +
        '<div class="tmx-toggle-list">' + rows + '</div>' +
      '</div>';
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
          // v4.6.148: Sklepy PRZED jezykami (kolejnosc: scope → format → SKLEPY → jezyki → ...)
          '<div class="sec">' +
            '<div class="lbl-row"><div class="lbl">Sklepy</div><button type="button" class="col-toggle" data-toggle-all="shops">Odznacz</button></div>' +
            '<div class="lang-list" data-role="shop-list">' + buildShopHtml() + '</div>' +
          '</div>' +
          '<div class="sec">' +
            '<div class="lbl-row"><div class="lbl">Języki</div><button type="button" class="col-toggle" data-toggle-all="langs">Zaznacz</button></div>' +
            '<div class="lang-list" data-role="lang-list">' + buildLangHtml() + '</div>' +
          '</div>' +
          // v4.6.145: 2 kolumny pol (General + SEO) jak w Menu — tylko dla parametrow (nie sekcji)
          (!isSec ? ('<div class="sec"><div class="tmx-cols" data-role="field-cols">' +
            buildTogglesHtml(stateGeneral, 'general') +
            buildTogglesHtml(stateSeo, 'seo') +
          '</div></div>') : '') +
          '<div class="sec">' +
            '<div class="tmx-section-label">Dodatkowe dane</div>' +
            '<div class="tmx-extra-cards" data-role="extras-list">' + buildExtrasHtml() + '</div>' +
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
    shadow.querySelectorAll('.lang-item[data-lang]').forEach(function (item) {
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
    // v4.6.148: listener dla wierszy sklepow (analogicznie jak langi)
    shadow.querySelectorAll('.lang-item[data-shop]').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var code = item.dataset.shop;
        var s = stateShops.find(function (x) { return x.code === code; });
        if (!s) return;
        s.on = !s.on;
        item.classList.toggle('checked', s.on);
        var cb = item.querySelector('input'); if (cb) cb.checked = s.on;
        var btn = shadow.querySelector('[data-toggle-all="shops"]');
        if (btn) btn.textContent = stateShops.every(function (l) { return l.on; }) ? 'Odznacz' : 'Zaznacz';
      });
    });
    shadow.querySelectorAll('[data-toggle-all="shops"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newState = btn.textContent.trim() !== 'Odznacz';
        stateShops.forEach(function (s) { s.on = newState; });
        shadow.querySelectorAll('.lang-item[data-shop]').forEach(function (item) {
          item.classList.toggle('checked', newState);
          var cb = item.querySelector('input'); if (cb) cb.checked = newState;
        });
        btn.textContent = newState ? 'Odznacz' : 'Zaznacz';
      });
    });
    shadow.querySelectorAll('[data-toggle-all="langs"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newState = btn.textContent.trim() !== 'Odznacz';
        stateLangs.forEach(function (l) { l.on = newState; });
        shadow.querySelectorAll('.lang-item[data-lang]').forEach(function (item) {
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
        // v4.6.145: tmx-extra-card click — pomijamy gdy klik w sam switch (inputu)
        if (e.target && e.target.tagName === 'INPUT') return;
        e.preventDefault();
        var key = row.dataset.extra;
        var s = stateExtras.find(function (x) { return x.key === key; });
        if (!s) return;
        s.on = !s.on;
        row.classList.toggle('tmx-active', s.on);
        var cb = row.querySelector('input'); if (cb) cb.checked = s.on;
        if (key === 'products') syncApiSec();
      });
    });
    syncApiSec();

    // v4.6.145: toggle row dla pol w kolumnach general/seo
    function findFieldDef(key, section) {
      var arr = section === 'seo' ? stateSeo : stateGeneral;
      for (var i = 0; i < arr.length; i++) if (arr[i].key === key) return arr[i];
      return null;
    }
    function updateToggleAllBtn(section) {
      var arr = section === 'seo' ? stateSeo : stateGeneral;
      var btn = shadow.querySelector('[data-toggle-section="' + section + '"]');
      if (!btn || arr.length === 0) return;
      var allOn = arr.every(function (f) { return f.on; });
      btn.textContent = allOn ? 'Odznacz' : 'Zaznacz';
    }
    shadow.querySelectorAll('.tmx-toggle-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'INPUT') return;
        e.preventDefault();
        var key = row.getAttribute('data-field');
        var section = row.getAttribute('data-section');
        var fd = findFieldDef(key, section); if (!fd) return;
        fd.on = !fd.on;
        row.classList.toggle('tmx-active', fd.on);
        var cb = row.querySelector('input'); if (cb) cb.checked = fd.on;
        updateToggleAllBtn(section);
      });
    });
    shadow.querySelectorAll('[data-toggle-section]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var section = btn.getAttribute('data-toggle-section');
        var arr = section === 'seo' ? stateSeo : stateGeneral;
        if (!arr.length) return;
        var allOn = arr.every(function (f) { return f.on; });
        arr.forEach(function (fd) { fd.on = !allOn; });
        shadow.querySelectorAll('.tmx-toggle-row[data-section="' + section + '"]').forEach(function (row) {
          var key = row.getAttribute('data-field');
          var fd = findFieldDef(key, section); if (!fd) return;
          row.classList.toggle('tmx-active', fd.on);
          var cb = row.querySelector('input'); if (cb) cb.checked = fd.on;
        });
        updateToggleAllBtn(section);
      });
    });

    shadow.querySelector('[data-role="ok"]').addEventListener('click', function () {
      var langs = stateLangs.filter(function (l) { return l.on; }).map(function (l) { return l.code; });
      if (!langs.length) { alert('Wybierz przynajmniej jeden język'); return; }
      var shops = stateShops.filter(function (s) { return s.on; }).map(function (s) { return s.code; });
      if (!shops.length) { alert('Wybierz przynajmniej jeden sklep'); return; }
      var extras = {};
      stateExtras.forEach(function (f) { extras[f.key] = !!f.on; });
      // v4.6.145: dodaj pola general + seo do extras (jako extras.<key> = bool)
      stateGeneral.forEach(function (f) { extras[f.key] = !!f.on; });
      stateSeo.forEach(function (f) { extras[f.key] = !!f.on; });
      // v4.6.146: shopSettings on, jezeli ktorekolwiek z per-shop pol (granularnych)
      extras.shopSettings = !!(extras.headline_name || extras.node_desc ||
        extras.display_mode || extras.sort || extras.display_limit ||
        extras.filter_default || extras.filter_active || extras.filter_pricestep || extras.filter_pricestepnet ||
        extras.filter_name || extras.filter_display || extras.filter_default_enabled ||
        extras.filter_pricerange || extras.filter_pricerangenet ||
        extras.icon_search_type || extras.icon_projector_type ||
        extras.meta_title || extras.meta_description || extras.meta_keywords ||
        extras.meta_robots_index || extras.meta_robots_follow);
      var apiKeyInput = shadow.querySelector('[data-role="api-key"]');
      var apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      if (apiKey) { try { localStorage.setItem('tp.adminApiKey', apiKey); } catch (e) {} }
      close();
      var runner = isSec ? runSectionsExport : runExport;
      runner(targetDoc, { scope: currentScope, format: currentFormat, langs: langs, shops: shops, extras: extras, apiKey: apiKey }).catch(function (e) {
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

    // v4.6.152: redirecty osadzone w shopSettings per element per (shop, lang).
    // Strategia: pobierz pelna liste redirectow per shop, potem cross-reference z seolinkami
    // wezlow i osadz pasujace w element.shopSettings[shop][lang].redirects.
    if (extras.redirects) {
      var redirShops;
      if (opts.shops && opts.shops.length) {
        redirShops = opts.shops;
      } else {
        var _winR = (typeof getIframeWin === 'function') ? getIframeWin() : window;
        var _slR = (_winR && _winR.IAI && _winR.IAI.shops_list) ? _winR.IAI.shops_list : [];
        redirShops = _slR.length ? _slR.map(function (s) { return String(s.id); }) : ['1'];
      }
      function _norm(u) {
        if (!u) return '';
        u = String(u).trim();
        var m = u.match(/^https?:\/\/[^\/]+(\/.*)$/i);
        if (m) u = m[1];
        return u;
      }

      // 1) Pobierz liste redirectow per shop (jednorazowo)
      var redirectsPerShop = {};
      for (var rsi = 0; rsi < redirShops.length; rsi++) {
        var rsh = redirShops[rsi];
        if (_panel) _panel.showStatus('Eksport: lista przekierowań (sklep ' + (rsi + 1) + '/' + redirShops.length + ')');
        try {
          var gate = '/panel/config-system-services.php?shop=' + encodeURIComponent(rsh) + '&action=redirects';
          var html = await fetchTextFromIframe(gate);
          var redirMap = {};
          html.replace(/span_uri_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (redirMap[id] = redirMap[id] || {}).uri = v.replace(/<[^>]*>/g, '').trim(); });
          html.replace(/span_dest_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (redirMap[id] = redirMap[id] || {}).dest = v.replace(/<[^>]*>/g, '').trim(); });
          html.replace(/span_type_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (redirMap[id] = redirMap[id] || {}).type = v.replace(/<[^>]*>/g, '').trim(); });
          var list = [];
          Object.keys(redirMap).forEach(function (id) {
            var r = redirMap[id];
            if (!r || !r.uri) return;
            list.push({ id: id, uri: r.uri, destination: r.dest || '', type: r.type || '301', _uriN: _norm(r.uri), _destN: _norm(r.dest || '') });
          });
          redirectsPerShop[rsh] = list;
        } catch (e) {
          redirectsPerShop[rsh] = [];
        }
      }

      // 2) Per element x shop: znajdz redirecty ktorych URL (uri lub destination) zawiera ID
      //    elementu jako segment URL (np. /tra-pol-20927-slug.html dla id=20927).
      //    To dziala nawet gdy seolink pusty (np. wartosc bez towarow).
      var allElements = [];
      data.parameters.forEach(function (p) {
        if (!p.shopSettings) p.shopSettings = {};
        allElements.push(p);
        (p.values || []).forEach(function (v) {
          if (!v.shopSettings) v.shopSettings = {};
          allElements.push(v);
        });
      });

      // Dla kazdej kombinacji (element, shop): cross-reference po ID w URL
      function _urlHasId(url, id) {
        if (!url) return false;
        // Segment ID: poprzedzone /-lub_ , nastepnie [.-/_] lub koniec
        var pattern = new RegExp('(?:^|[/\\-_])' + id + '(?:[\\-./_]|$)');
        return pattern.test(url);
      }
      var totalMatched = 0;
      var matchedRedirIds = {}; // shop → Set of redirect ids
      allElements.forEach(function (el) {
        var elId = String(el.id);
        redirShops.forEach(function (sh) {
          var pool = redirectsPerShop[sh] || [];
          if (!pool.length) return;
          var matches = pool.filter(function (r) {
            return _urlHasId(r._uriN, elId) || _urlHasId(r._destN, elId);
          });
          if (!matches.length) return;
          if (!matchedRedirIds[sh]) matchedRedirIds[sh] = {};
          matches.forEach(function (r) { matchedRedirIds[sh][r.id] = true; });
          // Per lang osadzamy te same matche (bo redirecty nie sa per-lang w IdoSell — sa per shop)
          opts.langs.forEach(function (lg) {
            if (!el.shopSettings[sh]) el.shopSettings[sh] = {};
            if (!el.shopSettings[sh][lg]) el.shopSettings[sh][lg] = {};
            el.shopSettings[sh][lg].redirects = matches.map(function (r) {
              return { id: r.id, uri: r.uri, destination: r.destination, type: r.type };
            });
          });
          totalMatched += matches.length;
        });
      });

      // v4.6.161: diagnostyczny log + top-level redirectsByShop tylko z MATCHEM
      try {
        var diag = {};
        Object.keys(redirectsPerShop).forEach(function (sh) {
          diag[sh] = { total: (redirectsPerShop[sh] || []).length, matched: matchedRedirIds[sh] ? Object.keys(matchedRedirIds[sh]).length : 0 };
        });
        console.log('[Parametry PRO eksport redirects diagnostyka]', diag);
      } catch (e) {}

      if (_panel) _panel.showStatus('Eksport: dopasowano ' + totalMatched + ' przekierowań do elementów');
    }

    // v4.6.153: cache langData (reuse miedzy icon_files i node_description)
    var _langDataCache = {};
    async function _fetchLangData(id) {
      if (_langDataCache[id]) return _langDataCache[id];
      try {
        var ld = await fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(id));
        _langDataCache[id] = (ld && ld.data && ld.data.langData) || {};
      } catch (e) { _langDataCache[id] = {}; }
      return _langDataCache[id];
    }

    // v4.6.153: opisy per lang (z getParameterLangData)
    if (extras.node_description) {
      var descTargets = [];
      data.parameters.forEach(function (p) {
        descTargets.push({ ref: p, id: p.id });
        (p.values || []).forEach(function (v) { descTargets.push({ ref: v, id: v.id }); });
      });
      var BATCH_DESC = 10;
      for (var dti = 0; dti < descTargets.length; dti += BATCH_DESC) {
        var batchD = descTargets.slice(dti, dti + BATCH_DESC);
        await Promise.all(batchD.map(async function (t) {
          var langData = await _fetchLangData(t.id);
          var descs = {};
          opts.langs.forEach(function (lang) {
            var L = langData[lang] || {};
            descs[lang] = L.description || '';
          });
          t.ref.descriptions = descs;
        }));
        if (_panel) _panel.showStatus('Eksport: opisy (' + Math.min(dti + BATCH_DESC, descTargets.length) + '/' + descTargets.length + ')');
      }
    }

    // v4.6.156: URLe ikon eksportowane automatycznie gdy icon_search_type lub icon_projector_type on.
    // gfx_base64 switch — konwersja URLi na base64 po pobraniu.
    var _wantGfx = !!(extras.icon_search_type || extras.icon_projector_type);
    if (_wantGfx) {
      var gfxTargets = [];
      data.parameters.forEach(function (p) {
        p.icons = {};
        gfxTargets.push({ ref: p, id: p.id });
        p.values.forEach(function (v) {
          v.icons = {};
          gfxTargets.push({ ref: v, id: v.id });
        });
      });
      // Filtruj klucze: jesli tylko search type on → tylko icon_search*, analogicznie dla projector
      var ICON_KEYS = [];
      if (extras.icon_search_type) ICON_KEYS.push('icon_search', 'icon_search_desktop', 'icon_search_tablet', 'icon_search_mobile');
      if (extras.icon_projector_type) ICON_KEYS.push('icon_projector', 'icon_projector_desktop', 'icon_projector_tablet', 'icon_projector_mobile');
      function _absUrl(u) {
        if (!u) return '';
        u = String(u);
        if (/^https?:\/\//i.test(u)) return u;
        return location.protocol + '//' + location.host + (u.charAt(0) === '/' ? u : '/' + u);
      }
      var BATCH_GFX = 10;
      for (var gi = 0; gi < gfxTargets.length; gi += BATCH_GFX) {
        var batchGfx = gfxTargets.slice(gi, gi + BATCH_GFX);
        await Promise.all(batchGfx.map(async function (t) {
          try {
            var langData = await _fetchLangData(t.id);
            var icons = {};
            var shopFilter = (opts.shops && opts.shops.length) ? opts.shops : null;
            opts.langs.forEach(function (lang) {
              var L = langData[lang] || {};
              ICON_KEYS.forEach(function (key) {
                var perShop = L[key];
                if (!perShop || typeof perShop !== 'object') return;
                Object.keys(perShop).forEach(function (shop) {
                  if (shopFilter && shopFilter.indexOf(String(shop)) < 0) return;
                  var url = perShop[shop];
                  if (!url) return;
                  if (!icons[shop]) icons[shop] = {};
                  if (!icons[shop][lang]) icons[shop][lang] = {};
                  icons[shop][lang][key] = _absUrl(url);
                });
              });
            });
            t.ref.icons = icons;
          } catch (e) {}
        }));
        if (_panel) _panel.showStatus('Eksport: grafiki (' + Math.min(gi + BATCH_GFX, gfxTargets.length) + '/' + gfxTargets.length + ')');
      }

      // v4.6.156: opcjonalna konwersja URLi na base64 (gdy gfx_base64 zaznaczone)
      if (extras.gfx_base64) {
        async function _urlToBase64(url) {
          try {
            var resp = await fetch(url, { credentials: 'same-origin' });
            if (!resp.ok) return null;
            var blob = await resp.blob();
            return await new Promise(function (r) {
              var fr = new FileReader();
              fr.onload = function () { r(fr.result); };
              fr.onerror = function () { r(null); };
              fr.readAsDataURL(blob);
            });
          } catch (e) { return null; }
        }
        // Zbierz wszystkie pary { container, key, url }
        var b64Jobs = [];
        gfxTargets.forEach(function (t) {
          if (!t.ref.icons) return;
          Object.keys(t.ref.icons).forEach(function (shop) {
            Object.keys(t.ref.icons[shop]).forEach(function (lang) {
              Object.keys(t.ref.icons[shop][lang]).forEach(function (key) {
                b64Jobs.push({ container: t.ref.icons[shop][lang], key: key, url: t.ref.icons[shop][lang][key] });
              });
            });
          });
        });
        var BATCH_B64 = 5; // mniej concurrent bo to dane plikow
        for (var bi = 0; bi < b64Jobs.length; bi += BATCH_B64) {
          var batchB = b64Jobs.slice(bi, bi + BATCH_B64);
          await Promise.all(batchB.map(async function (job) {
            var b64 = await _urlToBase64(job.url);
            if (b64) job.container[job.key] = b64;
          }));
          if (_panel) _panel.showStatus('Eksport: konwersja base64 (' + Math.min(bi + BATCH_B64, b64Jobs.length) + '/' + b64Jobs.length + ')');
        }
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

    // v4.6.144: per-shop ustawienia (display + headline + listDesc + filtry per shop×lang)
    // v4.6.148: uzywa opts.shops (wybor uzytkownika) zamiast wszystkich z IAI.shops_list
    if (extras.shopSettings) {
      var allShops;
      if (opts.shops && opts.shops.length) {
        allShops = opts.shops;
      } else {
        var _winE = (typeof getIframeWin === 'function') ? getIframeWin() : window;
        var _slE = (_winE && _winE.IAI && _winE.IAI.shops_list) ? _winE.IAI.shops_list : [];
        allShops = _slE.length ? _slE.map(function (s) { return String(s.id); }) : ['1'];
      }
      // v4.6.154: dla parametrow zbieramy tylko wtedy gdy ktores z pol icon_*_type on
      // (pozostale pola sa specyficzne dla wartosci).
      var paramNeeded = !!(extras.icon_search_type || extras.icon_projector_type);
      var ssTargets = [];
      data.parameters.forEach(function (p) {
        if (paramNeeded) { p.shopSettings = {}; ssTargets.push({ ref: p, id: p.id, isParam: true }); }
        p.values.forEach(function (v) {
          v.shopSettings = {};
          ssTargets.push({ ref: v, id: v.id, isParam: false });
        });
      });
      var ssTasks = [];
      ssTargets.forEach(function (t) {
        allShops.forEach(function (s) {
          opts.langs.forEach(function (lg) {
            ssTasks.push({ t: t, shop: s, lang: lg });
          });
        });
      });
      var BATCH_SS = 8;
      var doneSS = 0;
      for (var si = 0; si < ssTasks.length; si += BATCH_SS) {
        var batchSS = ssTasks.slice(si, si + BATCH_SS);
        await Promise.all(batchSS.map(async function (job) {
          try {
            var rN = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(job.t.id) + '&lang=' + encodeURIComponent(job.lang) + '&shop=' + encodeURIComponent(job.shop) + '&tree=parameters&parent=0');
            var dN = (rN && rN.data) || {};
            if (!job.t.ref.shopSettings[job.shop]) job.t.ref.shopSettings[job.shop] = {};
            var ss = {
              display_mode: dN.display_mode || null,
              sort: dN.sort || null,
              display_limit: dN.display_limit || null,
              headline_name: dN.headline_name || null,
              meta_title: dN.meta_title || null,
              meta_description: dN.meta_description || null,
              meta_keywords: dN.meta_keywords || null,
              meta_robots_index: dN.meta_robots_index || null,
              meta_robots_follow: dN.meta_robots_follow || null,
              filter_default: !!dN.filter_default,
              filter_pricestep: (dN.filter_pricestep != null ? String(dN.filter_pricestep) : null),
              filter_pricestepnet: (dN.filter_pricestepnet != null ? String(dN.filter_pricestepnet) : null),
              filter_active: (dN.filter && Array.isArray(dN.filter.active)) ? dN.filter.active.map(function (f) { return { id: f.id, name: f.name }; }) : [],
              filter_name: dN.filter_name || null,
              filter_display: dN.filter_display || null,
              filter_default_enabled: dN.filter_default_enabled || null,
              filter_pricerange: dN.filter_pricerange || null,
              filter_pricerangenet: dN.filter_pricerangenet || null,
              seolink: (dN.seolink && dN.seolink[0]) || null,
              node_desc: null
            };
            try {
              // v4.6.161: fetchAjaxRaw zwraca juz sparsowany JSON, bez JSON.parse na obiekcie
              var rd = await fetchAjaxRaw('/panel/ajax/parameters.php', 'action=getNodeDesc&node=' + encodeURIComponent(job.t.id) + '&lang=' + encodeURIComponent(job.lang) + '&shop=' + encodeURIComponent(job.shop) + '&tree=parameters&parent=0');
              ss.node_desc = (rd && rd.data && (rd.data.desc || rd.data.description || rd.data.value)) || null;
            } catch (e) {}
            job.t.ref.shopSettings[job.shop][job.lang] = ss;
          } catch (e) {}
        }));
        doneSS += batchSS.length;
        if (_panel) _panel.showStatus('Eksport: ustawienia per shop (' + doneSS + '/' + ssTasks.length + ')');
      }
    }

    var ts = new Date().toISOString().replace(/[:.]/g, '-');
    var fileBase = 'parametry_' + opts.langs.join('-') + '_' + ts;
    var content, mime, ext;

    // v4.6.153: lista wybranych sklepow (do duplikacji name/description per shop)
    var _shopsForBuild;
    if (opts.shops && opts.shops.length) {
      _shopsForBuild = opts.shops;
    } else {
      var _winB = (typeof getIframeWin === 'function') ? getIframeWin() : window;
      var _slB = (_winB && _winB.IAI && _winB.IAI.shops_list) ? _winB.IAI.shops_list : [];
      _shopsForBuild = _slB.length ? _slB.map(function (s) { return String(s.id); }) : ['1'];
    }

    // Helper — buduje obiekt dla parametru / wartości z włączonymi extras
    // v4.6.153: struktura perShop[shop][lang] = { name, description, headline_name, display_mode, filter_*, meta_*, icons, redirects, ... }
    function buildNode(n, isValue) {
      var obj = { id: n.id };
      if (extras.priority) obj.priority = n.priority;
      if (extras.context) obj.context_id = n.context_id || null;

      // Buduj perShop[shop][lang]
      var perShop = {};
      function ensure(shop, lang) {
        if (!perShop[shop]) perShop[shop] = {};
        if (!perShop[shop][lang]) perShop[shop][lang] = {};
        return perShop[shop][lang];
      }
      // 1) Pola per LANG (duplikowane do kazdego shopu): name, description
      if (extras.node_name && n.names) {
        _shopsForBuild.forEach(function (shop) {
          opts.langs.forEach(function (lang) {
            if (n.names[lang] != null && n.names[lang] !== '') ensure(shop, lang).name = n.names[lang];
          });
        });
      }
      if (extras.node_description && n.descriptions) {
        _shopsForBuild.forEach(function (shop) {
          opts.langs.forEach(function (lang) {
            if (n.descriptions[lang] != null && n.descriptions[lang] !== '') ensure(shop, lang).description = n.descriptions[lang];
          });
        });
      }
      // 2) Pola per SHOP+LANG z shopSettings
      // v4.6.154: pola nawigacyjne (headline/listdesc/display/filtry/meta/redirects/seolink)
      // dotycza TYLKO wartosci (maja strony /tra-...html). Parametry to grupy bez stron.
      if ((extras.shopSettings || extras.redirects) && n.shopSettings) {
        Object.keys(n.shopSettings).forEach(function (shop) {
          Object.keys(n.shopSettings[shop]).forEach(function (lang) {
            var ss = n.shopSettings[shop][lang]; if (!ss) return;
            var dst = ensure(shop, lang);
            // icon_*_type — dla obu (parametr i wartosc maja swoja ikone)
            if (extras.icon_search_type && ss.icon_search_type) dst.icon_search_type = ss.icon_search_type;
            if (extras.icon_projector_type && ss.icon_projector_type) dst.icon_projector_type = ss.icon_projector_type;
            // Reszta pol — tylko dla wartosci
            if (!isValue) return;
            if (extras.headline_name && ss.headline_name != null) dst.headline_name = ss.headline_name;
            if (extras.node_desc && ss.node_desc != null) dst.node_desc = ss.node_desc;
            if (extras.display_mode && ss.display_mode != null) dst.display_mode = ss.display_mode;
            if (extras.sort && ss.sort != null) dst.sort = ss.sort;
            if (extras.display_limit && ss.display_limit != null) dst.display_limit = ss.display_limit;
            if (extras.filter_default) dst.filter_default = !!ss.filter_default;
            if (extras.filter_active && ss.filter_active) dst.filter_active = ss.filter_active;
            if (extras.filter_pricestep && ss.filter_pricestep != null) dst.filter_pricestep = ss.filter_pricestep;
            if (extras.filter_pricestepnet && ss.filter_pricestepnet != null) dst.filter_pricestepnet = ss.filter_pricestepnet;
            if (extras.filter_name && ss.filter_name) dst.filter_name = ss.filter_name;
            if (extras.filter_display && ss.filter_display) dst.filter_display = ss.filter_display;
            if (extras.filter_default_enabled && ss.filter_default_enabled) dst.filter_default_enabled = ss.filter_default_enabled;
            if (extras.filter_pricerange && ss.filter_pricerange) dst.filter_pricerange = ss.filter_pricerange;
            if (extras.filter_pricerangenet && ss.filter_pricerangenet) dst.filter_pricerangenet = ss.filter_pricerangenet;
            if (extras.meta_title && ss.meta_title != null) dst.meta_title = ss.meta_title;
            if (extras.meta_description && ss.meta_description != null) dst.meta_description = ss.meta_description;
            if (extras.meta_keywords && ss.meta_keywords != null) dst.meta_keywords = ss.meta_keywords;
            if (extras.meta_robots_index && ss.meta_robots_index != null) dst.meta_robots_index = ss.meta_robots_index;
            if (extras.meta_robots_follow && ss.meta_robots_follow != null) dst.meta_robots_follow = ss.meta_robots_follow;
            if (extras.redirects && ss.redirects) { dst.redirects = ss.redirects; if (ss.seolink) dst.seolink = ss.seolink; }
          });
        });
      }
      // 3) Icons (z n.icons → osobno per shop+lang). v4.6.156: gdy icon_*_type on (zamiast icon_files)
      if ((extras.icon_search_type || extras.icon_projector_type) && n.icons) {
        Object.keys(n.icons).forEach(function (shop) {
          Object.keys(n.icons[shop]).forEach(function (lang) {
            ensure(shop, lang).icons = n.icons[shop][lang];
          });
        });
      }
      if (Object.keys(perShop).length) obj.perShop = perShop;

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
      // v4.6.155: meta eksportu — info o wybranych sklepach + uzytkowniku ktory wygenerowal
      var _winM = (typeof getIframeWin === 'function') ? getIframeWin() : window;
      var _IAI = (_winM && _winM.IAI) || {};
      var _shopsMeta = (_winM && _winM.IAI && _winM.IAI.shops_list) || [];
      var _shopsByIdM = {};
      for (var _msi = 0; _msi < _shopsMeta.length; _msi++) if (_shopsMeta[_msi]) _shopsByIdM[String(_shopsMeta[_msi].id)] = _shopsMeta[_msi].name || '';
      var _shopsList = (opts.shops || []).map(function (sid) { return { id: sid, domain: _shopsByIdM[sid] || '' }; });
      var _userName = null;
      try {
        var _doc = (_winM && _winM.document) || document;
        var _allEls = _doc.querySelectorAll('a.dropdown-toggle');
        for (var _ui = 0; _ui < _allEls.length; _ui++) {
          var _t = (_allEls[_ui].textContent || '').trim();
          if (_t.indexOf('Zalogowany jako') === 0) {
            _userName = _t.replace(/^Zalogowany jako[\s\xa0]*/, '').trim();
            break;
          }
        }
      } catch (e) {}
      var jsonOut = {
        exportedAt: new Date().toISOString(),
        generatedBy: {
          user: _userName || null,
          panelId: _IAI.panel_id || null,
          sessionId: _IAI.session_id || null,
          panelLanguage: _IAI.panel_language || null
        },
        shops: _shopsList,
        langs: data.langs,
        extras: extras,
        parameters: jsonParams
      };
      // v4.6.160: redirects tylko per-element (top-level redirectsByShop USUNIETE — user chce tylko powiazane)
      // v4.6.152: redirects osadzone w element.shopSettings[shop][lang].redirects (nie top-level)
      content = JSON.stringify(jsonOut, null, 2);
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
          { icon: 'sort_by_alpha', label: 'Sortuj alfabetycznie', tooltip: 'Posortuj sekcje wg nazwy (A→Z / Z→A) — tylko bieżący widok', variant: 'text', onClick: function () { sortSectionsAlphabetically(doc); } },
          { icon: 'tag',           label: 'Sortuj po ID',        tooltip: 'Sortuj wg ID (rosn\u0105co / malej\u0105co)', variant: 'text', onClick: function () { sortSectionsById(doc); } },
          { icon: 'add',           label: 'Dodaj sekcj\u0119',    variant: 'primary', onClick: function () { createNewSection(doc); } }
        ] }
      },
      toolbar: {
        search: {
          placeholder: 'Szukaj sekcji po nazwie lub id',
          hint: 'wiele oddziel: | lub ,',
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
        toggleable: ['id', 'products', 'gfx', 'desc'],
        tooltip: 'Poka\u017c / ukryj kolumny'
      },
      columns: [
        // v4.6.123: drag=24px (przywrocone) — kolumna potrzebna do widocznosci ⠿ wartosci.
        // W panelu sekcji wartosci sa rzadkie, ale kolumna musi byc zachowana dla spojnosci z parametrami.
        { id: 'drag',     label: '',             width: '24px' },
        { id: 'check',    label: '',             width: '32px' },
        { id: 'expand',   label: '',             width: '32px' },
        { id: 'name',     label: 'Nazwa', hint: '(Dwuklik na nazwę = edycja)', width: '1fr' },
        { id: 'id',       label: 'ID',           width: '80px' },
        // v4.6.104: children + context — puste placeholdery, zeby kolumny panelu
        // sekcji pokrywaly sie 1:1 z kolumnami panelu parametrow (te maja Dzieci/Kontekst)
        { id: 'children', label: '',             width: '80px' },
        { id: 'products', label: 'Produkty', width: '90px' },
        { id: 'context',  label: '',             width: '90px' },
        { id: 'gfx',      label: 'Grafika',  width: '95px' },
        { id: 'desc',     label: 'Opis',     width: '60px' },
        { id: 'actions',  label: 'Akcje',        width: '220px' }
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
        version: 'v4.6.175',
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
      loadSectionsMetaInBackground(doc, sections);
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
        '<div></div>' +
        '<div class="tp-sec-products" data-section-id="' + sec.id + '" style="text-align:center;color:#5f6368">…</div>' +
        '<div></div>' +
        '<div class="tp-sec-gfx" data-section-id="' + sec.id + '" style="display:flex;align-items:center;justify-content:center;color:#5f6368">…</div>' +
        '<div class="tp-sec-desc" data-section-id="' + sec.id + '" style="display:flex;align-items:center;justify-content:center;color:#5f6368">…</div>' +
        '<div class="tp-col-actions">' +
          '<span class="material-symbols-outlined tp-action-btn" data-act="settings" title="Edytuj ustawienia (opis, grafiki)">settings</span>' +
          '<span class="material-symbols-outlined tp-action-btn" data-act="merge" title="Połącz z inną sekcją">cell_merge</span>' +
          '<span class="material-symbols-outlined tp-action-btn tp-action-btn--danger" data-act="delete" title="Usuń sekcję">delete</span>' +
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
        // v4.6.92: toast feedback — taki sam jak przy kopiowaniu ID parametrów/wartości
        try {
          if (_sectionsMount && _sectionsMount.panel && _sectionsMount.panel.showStatus) {
            _sectionsMount.panel.showStatus('Skopiowano ID: ' + val);
          }
        } catch (e) {}
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
          if (act === 'settings') {
            showEditElementModal(doc, sec.id);
          } else if (act === 'merge') {
            enterSectionMergeMode(doc, sec.id, sec.name);
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
    // v4.6.107: multi-search — rozdziel zapytanie po | lub , (dopasowanie OR)
    var terms = [];
    if (q) {
      var rawT = q.split(/[|,]/);
      for (var ti = 0; ti < rawT.length; ti++) {
        var tt = rawT[ti].trim();
        if (tt) terms.push(tt);
      }
    }
    items.forEach(function (li) {
      var name = li.dataset.sectionName || '';
      var id = li.dataset.sectionId || '';
      var match = true;
      if (terms.length) {
        match = false;
        for (var k = 0; k < terms.length; k++) {
          if (name.indexOf(terms[k]) !== -1 || id.indexOf(terms[k]) !== -1) { match = true; break; }
        }
      }
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

  // v4.6.91: liczba towar\u00f3w sekcji przez view-manager (trait=<sectionId>) \u2014 to samo
  // wiarygodne \u017ar\u00f3d\u0142o co dla parametr\u00f3w. numberOfOccurrence by\u0142o zawodne (zwraca\u0142o 0
  // dla wi\u0119kszo\u015bci sekcji). List\u0119 ID towar\u00f3w pobieramy on-demand przy otwarciu modalu
  // (fetchTraitProductIds), nie z g\u00f3ry \u2014 sekcja mo\u017ce mie\u0107 wiele stron towar\u00f3w.
  async function loadSectionsProductCountsInBackground(doc, sections) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var BATCH = 6;
    for (var i = 0; i < sections.length; i += BATCH) {
      var batch = sections.slice(i, i + BATCH);
      await Promise.all(batch.map(async function (sec) {
        try {
          var count = await fetchTraitProductCount(sec.id);
          var cell = _sectionsMount.listEl.querySelector('.tp-sec-products[data-section-id="' + sec.id + '"]');
          if (!cell) return;
          if (count === null) {
            cell.textContent = '\u2013';
            cell.title = 'Nie uda\u0142o si\u0119 pobra\u0107 liczby towar\u00f3w';
            return;
          }
          sec.productCount = count;
          cell.textContent = '';
          cell.title = '';
          if (count > 0) {
            var link = doc.createElement('a');
            link.href = '/panel/products-list.php?trait=' + encodeURIComponent(sec.id);
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = String(count);
            link.title = 'Poka\u017c produkty u\u017cywaj\u0105ce sekcji (nowa karta)';
            link.style.cssText = 'color:#2563eb;text-decoration:none;font-weight:500;cursor:pointer';
            link.addEventListener('click', function (e) { e.stopPropagation(); });
            cell.appendChild(link);
          } else {
            cell.textContent = '0';
          }
        } catch (e) { /* leave placeholder */ }
      }));
    }
  }

  // v4.6.92: status grafik i opisu sekcji w tle. fetchContextForNode jest
  // ID-agnostyczne, a sekcja ma identyczna strukture langData co parametr
  // (icon_search/icon_projector per shop + description) - wiec reuzywamy je.
  async function loadSectionsMetaInBackground(doc, sections) {
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    var BATCH = 8;
    for (var i = 0; i < sections.length; i += BATCH) {
      var batch = sections.slice(i, i + BATCH);
      await Promise.all(batch.map(async function (sec) {
        try {
          var info = await fetchContextForNode(sec.id);
          var gC = _sectionsMount.listEl.querySelector('.tp-sec-gfx[data-section-id="' + sec.id + '"]');
          if (gC) renderGfxCell(gC, info.gfx);
          var dC = _sectionsMount.listEl.querySelector('.tp-sec-desc[data-section-id="' + sec.id + '"]');
          if (dC) renderDescCell(dC, info.descSet);
        } catch (e) {}
      }));
    }
  }

  /* === v4.6.98: Laczenie sekcji ========================================
     mergeParam dziala dla sekcji (zweryfikowane demo37: type:"section",
     errno:0 — sekcja zrodlowa znika, jej parametry trafiaja do docelowej).
     Sekcje nie maja podstron w sklepie, wiec bez przekierowan.
     UX jak przy laczeniu wartosci: tryb klikania w panelu sekcji. */
  var _secMergeState = { active: false, sourceId: null, sourceName: null, doc: null };

  function enterSectionMergeMode(doc, sourceId, sourceName) {
    if (_secMergeState.active) exitSectionMergeMode();
    if (!_sectionsMount || !_sectionsMount.listEl) return;
    _secMergeState = { active: true, sourceId: sourceId, sourceName: sourceName, doc: doc };
    var rows = _sectionsMount.listEl.querySelectorAll(':scope > li');
    for (var i = 0; i < rows.length; i++) {
      var sid = rows[i].dataset.sectionId;
      if (sid === sourceId) rows[i].classList.add('tp-merge-source');
      else if (sid) rows[i].classList.add('tp-merge-target');
    }
    var existing = doc.getElementById('tp-merge-banner');
    if (existing) existing.remove();
    var banner = doc.createElement('div');
    banner.id = 'tp-merge-banner';
    banner.innerHTML =
      '<span class="material-symbols-outlined" style="font-size:20px;vertical-align:middle;margin-right:6px;">cell_merge</span>' +
      'Tryb łączenia sekcji: kliknij sekcję docelową dla <strong>' + escapeHtml(sourceName) + '</strong>' +
      '<span id="tp-merge-cancel" style="margin-left:12px;cursor:pointer;font-weight:bold;padding:4px 10px;border-radius:4px;background:rgba(255,255,255,0.3);">✕ Anuluj</span>';
    doc.body.insertBefore(banner, doc.body.firstChild);
    banner.querySelector('#tp-merge-cancel').addEventListener('click', function () { exitSectionMergeMode(); });
    doc.addEventListener('click', sectionMergeTargetClickHandler, true);
  }

  function exitSectionMergeMode() {
    if (!_secMergeState.doc) return;
    var doc = _secMergeState.doc;
    if (_sectionsMount && _sectionsMount.listEl) {
      var rows = _sectionsMount.listEl.querySelectorAll(':scope > li');
      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.remove('tp-merge-source');
        rows[i].classList.remove('tp-merge-target');
      }
    }
    var banner = doc.getElementById('tp-merge-banner');
    if (banner) banner.remove();
    doc.removeEventListener('click', sectionMergeTargetClickHandler, true);
    _secMergeState = { active: false, sourceId: null, sourceName: null, doc: null };
  }

  async function sectionMergeTargetClickHandler(e) {
    if (!_secMergeState.active) return;
    var row = e.target.closest('li.tp-merge-target');
    if (!row) { if (e.target.closest('#tp-merge-banner')) return; return; }
    e.stopPropagation();
    e.preventDefault();
    var targetId = row.dataset.sectionId;
    if (!targetId) return;
    var tnEl = row.querySelector('.tp-sec-name');
    var targetName = tnEl ? tnEl.textContent.trim() : ('ID ' + targetId);
    var sourceId = _secMergeState.sourceId, sourceName = _secMergeState.sourceName, doc = _secMergeState.doc;
    exitSectionMergeMode();
    if (!confirm('UWAGA: Operacja jest NIEODWRACALNA!\n\n' +
      'Połączyć sekcję:\n  „' + sourceName + '” (ID: ' + sourceId + ')\n' +
      'z sekcją:\n  „' + targetName + '” (ID: ' + targetId + ')?\n\n' +
      'Parametry z „' + sourceName + '” zostaną przeniesione do „' + targetName + '”,\n' +
      'a sekcja „' + sourceName + '” usunięta.')) return;
    try {
      var resp = await fetchAjax('action=mergeParam&id=' + sourceId + '&idExist=' + targetId);
      if (resp && resp.error && resp.error !== '') throw new Error(resp.error);
      // v4.6.99: mergeParam dla sekcji NIE usuwa zrodla (zostaje pusta, name=null) -
      // trzeba ja usunac jawnie. Zweryfikowane demo37.
      await fetchAjax('action=removeParam&node=' + sourceId + '&tree=0&shop=2&parent=0');
      if (_sectionsMount && _sectionsMount.panel) _sectionsMount.panel.showStatus('Połączono sekcję „' + sourceName + '” → „' + targetName + '”');
      try { tpCacheClearAll(); } catch (ex) {}
      refreshSectionsPanel(doc);
    } catch (err) {
      alert('Błąd łączenia sekcji: ' + (err && err.message || err));
    }
  }

  // v4.5.27: modal listing products using a section
  // v4.5.31: fetch product list on demand (sections panel no longer preloads)
  function showSectionProductsModal(doc, sec) {
    if (!sec.products) {
      // v4.6.91: lista ID przez view-manager (fetchTraitProductIds) — numberOfOccurrence zawodne
      fetchTraitProductIds(sec.id)
        .then(function (res) {
          sec.products = res.ids;
          sec.productCount = res.total;
          sec.productsTruncated = res.truncated;
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

  // v4.6.169: dodawanie wartosci z bulk import (CSV/JSON/XML/TXT) + drop zone
  function createNewValue(doc, paramId, paramName) {
    showAddValueModal(doc, paramId, paramName);
  }

  // v4.6.170: parser zwraca Array<{paramName?, name, redirectFrom?}>
  // Modal jest per parametr \u2014 caller filtruje po paramName === current paramName.
  // Plik moze miec 1-3 kolumny:
  //   1 kol  \u2192 (name)                              \u2014 paramName brak, akceptowane
  //   2 kol  \u2192 (name, url)                          \u2014 paramName brak, akceptowane
  //   3 kol  \u2192 (paramName, name, url)               \u2014 filter po paramName
  function _parseValuesFile(content, filename) {
    var ext = (filename || '').toLowerCase().split('.').pop();
    var records = [];
    function cleanCol(c) { return (c == null ? '' : String(c)).trim().replace(/^["']|["']$/g, ''); }
    try {
      if (ext === 'json') {
        var arr = JSON.parse(content);
        if (!Array.isArray(arr)) {
          if (arr && Array.isArray(arr.values)) arr = arr.values;
          else if (arr && Array.isArray(arr.names)) arr = arr.names;
          else throw new Error('JSON musi by\u0107 tablic\u0105 lub obiektem z polem "values"/"names"');
        }
        records = arr.map(function (it) {
          if (typeof it === 'string') return { name: it };
          if (it && typeof it === 'object') {
            return {
              paramName: it.paramName || it.param || it.parameter || '',
              name: it.name || it.value || it.label || '',
              redirectFrom: it.redirectFrom || it.url || it.from || it.uri || ''
            };
          }
          return { name: '' };
        });
      } else if (ext === 'xml') {
        var parser = new DOMParser();
        var xmlDoc = parser.parseFromString(content, 'text/xml');
        var nodes = xmlDoc.querySelectorAll('entry, item, value, row');
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          var nm = (n.getAttribute('name') || (n.querySelector('name, value') || {}).textContent || n.textContent || '').trim();
          var url = ((n.querySelector('url, redirect, from') || {}).textContent || n.getAttribute('url') || n.getAttribute('redirect') || '').trim();
          var pn = ((n.querySelector('param, parameter, paramName') || {}).textContent || n.getAttribute('param') || '').trim();
          if (nm) records.push({ paramName: pn, name: nm, redirectFrom: url });
        }
      } else {
        // CSV / TXT
        var lines = content.split(/\r?\n/);
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li].trim();
          if (!line) continue;
          if (li === 0 && /^(name|nazwa|wartosc|warto\u015b\u0107|value|parametr|param)/i.test(line)) continue;
          var cols = line.split(/[,;\t]/).map(cleanCol);
          var rec;
          if (cols.length >= 3) {
            // (paramName, name, url) \u2014 paramName w pliku ma znaczenie
            rec = { paramName: cols[0], name: cols[1], redirectFrom: cols[2] };
          } else if (cols.length === 2) {
            // (name, url) \u2014 bez paramName
            rec = { name: cols[0], redirectFrom: cols[1] };
          } else {
            rec = { name: cols[0] };
          }
          if (rec.name) records.push(rec);
        }
      }
    } catch (e) {
      throw new Error('B\u0142\u0105d parsowania pliku: ' + (e.message || e));
    }
    // Dedup po nazwie + trim + przygotuj
    var seen = {};
    var out = [];
    for (var j = 0; j < records.length; j++) {
      var r = records[j];
      var n = String(r.name || '').trim();
      if (!n || seen[n]) continue;
      seen[n] = true;
      out.push({
        paramName: r.paramName ? String(r.paramName).trim() : '',
        name: n,
        redirectFrom: r.redirectFrom ? String(r.redirectFrom).trim() : ''
      });
    }
    return out;
  }

  function showAddValueModal(doc, paramId, paramName) {
    var d = doc || document;
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    var FONT = "'DM Sans', sans-serif";
    if (!d.getElementById('tpcd-dmsans-link')) {
      var lnk = d.createElement('link'); lnk.id = 'tpcd-dmsans-link'; lnk.rel = 'stylesheet';
      lnk.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      d.head.appendChild(lnk);
    }

    var overlay = d.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,26,46,.45);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:30px 16px;font-family:' + FONT;
    var modal = d.createElement('div');
    modal.style.cssText = 'width:100%;max-width:520px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;font-family:' + FONT + ';max-height:90vh;display:flex;flex-direction:column';
    overlay.appendChild(modal);
    d.body.appendChild(overlay);
    function close() { overlay.remove(); }

    // State
    var bulkRecords = []; // lista { name, redirectFrom?, paramName?, existingId? } z pliku
    var bulkInfo = null;  // { total, accepted, rejected }

    function _normParamName(s) {
      if (!s) return '';
      return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
    }

    function render() {
      var hasBulk = bulkRecords.length > 0;
      var infoHtml = '';
      if (bulkInfo) {
        if (bulkInfo.rejected > 0) {
          infoHtml = '<div style="font-size:11.5px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;padding:8px 12px;border-radius:8px;margin-bottom:10px">' +
            'Z pliku za\u0142adowano ' + bulkInfo.accepted + ' z ' + bulkInfo.total + ' rekord\u00f3w (pasuj\u0105 do parametru \u201e' + esc(paramName) + '"). Odrzucono ' + bulkInfo.rejected + ' (inna nazwa parametru w pliku).' +
            '</div>';
        }
      }
      var bulkListHtml = hasBulk ? bulkRecords.map(function (r, idx) {
        var hasRedir = !!r.redirectFrom;
        var exists = !!r.existingId;
        // v4.6.171: badge "nowy" (zielony) / "istnieje \u2014 dodam redirect" (niebieski)
        var badge = exists
          ? '<span style="font-size:10.5px;color:#1e40af;background:#eff4ff;border:1px solid #bfdbfe;padding:2px 7px;border-radius:10px;font-weight:600;white-space:nowrap">istnieje \u00b7 ID ' + esc(r.existingId) + '</span>'
          : '<span style="font-size:10.5px;color:#065f46;background:#ecfdf5;border:1px solid #a7f3d0;padding:2px 7px;border-radius:10px;font-weight:600;white-space:nowrap">nowy</span>';
        return '<div class="tpav-item" data-idx="' + idx + '" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #f0f2f5;font-size:13px;color:#344054">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:center;gap:8px;overflow:hidden">' +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name) + '</span>' +
              badge +
            '</div>' +
            (hasRedir ? '<div style="font-size:11px;color:#9aa3b0;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u21aa redirect z: ' + esc(r.redirectFrom) + '</div>' : '') +
          '</div>' +
          '<button type="button" class="tpav-rm" data-idx="' + idx + '" style="width:22px;height:22px;border-radius:5px;border:1px solid #fecaca;background:#fef5f5;color:#dc2626;cursor:pointer;font-weight:700;line-height:1;padding:0;font-size:12px">\u00d7</button>' +
        '</div>';
      }).join('') : '';

      modal.innerHTML =
        // Header
        '<div style="padding:20px 22px 16px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #eef0f4;flex-shrink:0">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<div style="width:42px;height:42px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#eef3ff;color:#4f8cff;font-size:24px;font-weight:300">+</div>' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:#1a1a2e">Dodaj warto\u015b\u0107</div>' +
              '<div style="font-size:12.5px;color:#98a2b3;margin-top:2px">do parametru \u201e' + esc(paramName) + '"</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="tpav-close" style="width:32px;height:32px;border-radius:8px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#b0b8c9;padding:0">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        // Body
        '<div style="padding:16px 22px;overflow-y:auto;flex:1;min-height:0">' +
          (hasBulk ? '' :
            '<div style="margin-bottom:10px">' +
              '<div style="font-size:11.5px;font-weight:600;color:#667085;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Nazwa warto\u015bci</div>' +
              '<input type="text" class="tpav-name" placeholder="np. Czerwony" style="width:100%;padding:12px 14px;border:1px solid #e0e3ea;border-radius:8px;font-size:14px;color:#1a1a2e;background:#fff;outline:none;box-sizing:border-box;font-family:' + FONT + '">' +
            '</div>' +
            '<div style="text-align:center;font-size:11px;color:#9aa3b0;margin:14px 0 10px;text-transform:uppercase;letter-spacing:.5px">\u2014 lub za\u0142aduj list\u0119 z pliku \u2014</div>'
          ) +
          // Drop zone (zawsze widoczna, kompaktowa gdy hasBulk)
          (hasBulk ?
            // Lista wyparsowanych nazw
            '<div style="margin-bottom:10px">' +
              infoHtml +
              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
                '<div style="font-size:11.5px;font-weight:600;color:#667085;text-transform:uppercase;letter-spacing:.5px">Za\u0142adowano ' + bulkRecords.length + ' warto\u015bci' + (bulkRecords.filter(function (r) { return r.redirectFrom; }).length ? ' \u00b7 ' + bulkRecords.filter(function (r) { return r.redirectFrom; }).length + ' z przekierowaniem' : '') + '</div>' +
                '<button type="button" class="tpav-clear" style="font-size:11px;color:#dc2626;background:none;border:none;cursor:pointer;font-weight:600">Wyczy\u015b\u0107</button>' +
              '</div>' +
              '<div style="border:1px solid #e8ebf0;border-radius:10px;max-height:280px;overflow-y:auto;background:#fafbfd">' + bulkListHtml + '</div>' +
            '</div>'
            :
            '<div class="tpav-dropzone" style="border:2px dashed #d0d5dd;border-radius:10px;padding:24px;text-align:center;cursor:pointer;background:#fafbfd;transition:all .15s">' +
              '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#98a2b3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px;display:block"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
              '<div style="font-size:13px;color:#344054;font-weight:500">Upu\u015b\u0107 plik lub <span style="color:#4f8cff;text-decoration:underline">wybierz</span></div>' +
              '<div style="font-size:11px;color:#9aa3b0;margin-top:4px">CSV, JSON, XML, TXT \u2014 ka\u017cda linia / element to osobna warto\u015b\u0107</div>' +
              '<input type="file" class="tpav-file" accept=".csv,.json,.xml,.txt,text/csv,application/json,text/xml,text/plain" style="display:none">' +
            '</div>'
          ) +
        '</div>' +
        // Footer
        '<div style="padding:14px 22px;border-top:1px solid #eef0f4;background:#fafbfc;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">' +
          '<button type="button" class="tpav-cancel" style="padding:9px 20px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-size:13px;font-weight:600;cursor:pointer">Anuluj</button>' +
          '<button type="button" class="tpav-ok" style="padding:9px 22px;border-radius:8px;border:none;background:linear-gradient(135deg,#4f8cff,#3b6de0);color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(79,140,255,.35)">' + (function () {
            if (!hasBulk) return 'Utw\u00f3rz';
            var newCount = bulkRecords.filter(function (r) { return !r.existingId; }).length;
            var reuseCount = bulkRecords.length - newCount;
            if (newCount && reuseCount) return 'Utw\u00f3rz ' + newCount + ', zaktualizuj ' + reuseCount;
            if (newCount) return 'Utw\u00f3rz ' + newCount + ' warto\u015bci';
            return 'Zaktualizuj ' + reuseCount + ' istniej\u0105cych';
          })() + '</button>' +
        '</div>';

      bindEvents();
      if (!hasBulk) {
        var nameInp = modal.querySelector('.tpav-name');
        if (nameInp) setTimeout(function () { nameInp.focus(); }, 50);
      }
    }

    function bindEvents() {
      modal.querySelector('.tpav-close').addEventListener('click', close);
      modal.querySelector('.tpav-cancel').addEventListener('click', close);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

      var dz = modal.querySelector('.tpav-dropzone');
      var fileInput = modal.querySelector('.tpav-file');
      if (dz && fileInput) {
        dz.addEventListener('click', function () { fileInput.click(); });
        dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.style.borderColor = '#4f8cff'; dz.style.background = '#eff4ff'; });
        dz.addEventListener('dragleave', function () { dz.style.borderColor = '#d0d5dd'; dz.style.background = '#fafbfd'; });
        dz.addEventListener('drop', function (e) {
          e.preventDefault();
          dz.style.borderColor = '#d0d5dd'; dz.style.background = '#fafbfd';
          var f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) handleFile(f);
        });
        fileInput.addEventListener('change', function () {
          var f = fileInput.files && fileInput.files[0];
          if (f) handleFile(f);
        });
      }

      var clearBtn = modal.querySelector('.tpav-clear');
      if (clearBtn) clearBtn.addEventListener('click', function () { bulkRecords = []; bulkInfo = null; render(); });

      modal.querySelectorAll('.tpav-rm').forEach(function (b) {
        b.addEventListener('click', function () {
          var idx = parseInt(b.getAttribute('data-idx'), 10);
          bulkRecords.splice(idx, 1);
          render();
        });
      });

      modal.querySelector('.tpav-ok').addEventListener('click', function () {
        var hasBulk = bulkRecords.length > 0;
        if (hasBulk) {
          doCreateBulk(bulkRecords);
        } else {
          var name = ((modal.querySelector('.tpav-name') || {}).value || '').trim();
          if (!name) { alert('Wpisz nazw\u0119 warto\u015bci lub za\u0142aduj plik'); return; }
          doCreateBulk([{ name: name }]);
        }
      });
    }

    function handleFile(file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = _parseValuesFile(reader.result, file.name);
          if (!parsed.length) { alert('Plik nie zawiera \u017cadnych nazw warto\u015bci'); return; }
          var modalParamNorm = _normParamName(paramName);
          var accepted = [];
          var rejected = 0;
          for (var i = 0; i < parsed.length; i++) {
            var r = parsed[i];
            if (r.paramName) {
              if (_normParamName(r.paramName) === modalParamNorm) {
                accepted.push(r);
              } else {
                rejected++;
              }
            } else {
              accepted.push(r);
            }
          }
          if (!accepted.length) {
            alert('Plik nie zawiera warto\u015bci dla parametru \u201e' + paramName + '". W kolumnie nazwy parametru musz\u0105 by\u0107 nazwy pasuj\u0105ce do bie\u017c\u0105cego parametru.');
            return;
          }
          // v4.6.171: pre-load istniejacych wartosci parametru \u2014 oznacz ktore juz istnieja
          (async function () {
            var existingByNorm = {};
            try {
              var kids = await loadChildValues(paramId);
              (kids || []).forEach(function (c) {
                var key = _normParamName(c.name);
                if (key && !existingByNorm[key]) existingByNorm[key] = String(c.id);
              });
            } catch (e) {}
            accepted.forEach(function (r) {
              var key = _normParamName(r.name);
              if (existingByNorm[key]) r.existingId = existingByNorm[key];
            });
            bulkRecords = accepted;
            bulkInfo = { total: parsed.length, accepted: accepted.length, rejected: rejected };
            render();
          })();
        } catch (e) {
          alert(e.message || String(e));
        }
      };
      reader.onerror = function () { alert('B\u0142\u0105d odczytu pliku'); };
      reader.readAsText(file, 'utf-8');
    }

    async function doCreateBulk(records) {
      var okBtn = modal.querySelector('.tpav-ok');
      var cancelBtn = modal.querySelector('.tpav-cancel');
      okBtn.disabled = true; cancelBtn.disabled = true;
      var _winRS = (typeof getIframeWin === 'function') ? getIframeWin() : window;
      var _slRS = (_winRS && _winRS.IAI && _winRS.IAI.shops_list) || [];
      var currentShop = _slRS.length ? String(_slRS[0].id) : '1';
      var created = 0, reused = 0, redirsAdded = 0, errors = [];
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        var n = rec.name;
        var valueId = rec.existingId || null;
        try {
          // v4.6.171: jesli wartosc juz istnieje (pre-load wykryl) \u2014 POMIN tworzenie, uzyj istniejacego ID
          if (!valueId) {
            okBtn.textContent = 'Tworzenie ' + (i + 1) + '/' + records.length + '\u2026';
            var resp = await fetchAjax('action=checkElValues&type=value&lang=' + LANG + '&parameter_id=' + encodeURIComponent(paramId) + '&product=0&value[]=' + encodeURIComponent(n));
            if (resp && resp.error) throw new Error(resp.error);
            if (resp && resp.data && Array.isArray(resp.data.children) && resp.data.children.length) {
              valueId = resp.data.children[resp.data.children.length - 1].id;
            }
            created++;
          } else {
            reused++;
          }
          // 2. Redirect (jesli redirectFrom)
          if (rec.redirectFrom && valueId) {
            okBtn.textContent = 'Redirect ' + (i + 1) + '/' + records.length + '\u2026';
            try {
              var rN = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(valueId) + '&lang=' + encodeURIComponent(LANG) + '&shop=' + encodeURIComponent(currentShop) + '&tree=parameters&parent=0');
              var seo = (rN && rN.data && rN.data.seolink && rN.data.seolink[0]) || '';
              if (seo) {
                var newPath = seo;
                var m = seo.match(/^https?:\/\/[^\/]+(\/.*)$/i);
                if (m) newPath = m[1];
                var ok = await _addRedirect(currentShop, rec.redirectFrom, newPath);
                if (ok) redirsAdded++;
                else errors.push({ name: n, msg: 'Redirect: nie uda\u0142o si\u0119 doda\u0107 (' + rec.redirectFrom + ' \u2192 ' + newPath + ')' });
              } else {
                errors.push({ name: n, msg: 'Redirect: brak seolink dla warto\u015bci (' + valueId + ')' });
              }
            } catch (eR) {
              errors.push({ name: n, msg: 'Redirect: ' + (eR.message || eR) });
            }
          }
        } catch (e) {
          errors.push({ name: n, msg: e.message || String(e) });
        }
      }
      try { tpCacheDel('ch2', paramId + '_' + LANG); } catch (e) {}
      var parts = [];
      if (created) parts.push('utworzono ' + created);
      if (reused) parts.push('zaktualizowano ' + reused + ' istniej\u0105cych');
      if (redirsAdded) parts.push('dodano ' + redirsAdded + ' przekierowa\u0144');
      var summaryText = parts.length ? (parts.join(', ').charAt(0).toUpperCase() + parts.join(', ').slice(1)) : 'Brak zmian';
      // v4.6.173: custom modal podsumowania + soft refresh (bez location.reload)
      _showBulkSummaryModal(d, paramName, summaryText, errors, function () {
        close(); // zamknij glowny modal "Dodaj wartosc"
        if (_panel) _panel.showStatus(summaryText + ' (parametr \u201e' + paramName + '")');
        // Soft refresh drzewa wartosci tylko gdy stworzono nowe (jesli tylko redirecty \u2014 DOM bez zmian)
        if (created > 0) refreshParamValuesInTree(d, paramId);
      });
    }

    render();
  }

  // v4.6.55: widget edytora opisu — Źródło HTML <-> Edytor wizualny.
  // Wzorzec 1:1 z Menu: lazy TinyMCE init (panelowy, target: el) przy kliknięciu
  // „Edytor wizualny"; fallback contentEditable gdy tinymce niedostępne lub init
  // nie powiedzie się (np. quirks-mode iframe). Klasy CSS: tp-ed-*.
  function createEditorWidget(doc, initialHtml, rows) {
    var wrap = doc.createElement('div');
    wrap.className = 'tp-ed-wrap';
    var bar = doc.createElement('div');
    bar.className = 'tp-ed-bar';
    var srcBtn = doc.createElement('button');
    srcBtn.type = 'button'; srcBtn.className = 'tp-ed-btn tp-ed-on'; srcBtn.textContent = 'Źródło HTML';
    var wysBtn = doc.createElement('button');
    wysBtn.type = 'button'; wysBtn.className = 'tp-ed-btn'; wysBtn.textContent = 'Edytor wizualny';
    bar.appendChild(srcBtn); bar.appendChild(wysBtn); wrap.appendChild(bar);

    var elId = 'tp_ed_' + Date.now() + '_' + Math.floor(Math.random() * 1e5);
    var src = doc.createElement('textarea');
    src.className = 'tp-ed-src'; src.id = elId; src.rows = rows || 7; src.value = initialHtml || '';
    wrap.appendChild(src);

    // TinyMCE — z naszego window (jeśli skrypt w iframe panelu) lub iframe rodzica
    var GW = (typeof getIframeWin === 'function') ? (getIframeWin() || window) : window;
    var tinyMCE = GW && GW.tinymce;
    if (!tinyMCE) {
      var iframeEl = document.querySelector('iframe[title="Old Panel Page"]') || document.querySelector('iframe');
      var iframeWin = iframeEl && iframeEl.contentWindow;
      tinyMCE = iframeWin && iframeWin.tinymce;
    }

    var tinyEditor = null, tinyInited = false, fallbackInited = false;
    var wysiwygFallback = null, fmtFallback = null;

    function activateSource() {
      if (tinyEditor) { try { src.value = tinyEditor.getContent(); tinyEditor.hide(); } catch (e) {} }
      else if (wysiwygFallback && wysiwygFallback.style.display !== 'none') {
        src.value = wysiwygFallback.innerHTML;
        wysiwygFallback.style.display = 'none';
        if (fmtFallback) fmtFallback.style.display = 'none';
      }
      src.style.display = '';
      srcBtn.classList.add('tp-ed-on'); wysBtn.classList.remove('tp-ed-on');
    }
    function activateWysiwyg() {
      if (tinyMCE) {
        if (!tinyInited) { tinyInited = true; initTinyMCE(); return; }
        if (tinyEditor) { try { tinyEditor.setContent(src.value); src.style.display = 'none'; tinyEditor.show(); } catch (e) {} }
      } else {
        if (!fallbackInited) { initFallback(); fallbackInited = true; }
        if (wysiwygFallback) { wysiwygFallback.innerHTML = src.value; src.style.display = 'none'; wysiwygFallback.style.display = ''; if (fmtFallback) fmtFallback.style.display = ''; }
      }
      srcBtn.classList.remove('tp-ed-on'); wysBtn.classList.add('tp-ed-on');
    }
    srcBtn.addEventListener('click', activateSource);
    wysBtn.addEventListener('click', activateWysiwyg);

    function initTinyMCE() {
      try {
        tinyMCE.init({
          target: src,
          theme: 'silver',
          language: (GW && GW.panelLanguage2) || 'pl',
          plugins: 'advlist,lists,table,preview,media,searchreplace,fullscreen,image,anchor,code,visualchars,charmap,link,insertdatetime,visualblocks,wordcount',
          menubar: false,
          toolbar1: 'bold italic underline | fontsize fontfamily styles | forecolor backcolor | removeformat',
          toolbar2: 'alignleft aligncenter alignright alignjustify | bullist numlist | undo redo | link image wordcount | more-options',
          toolbar_mode: 'floating',
          font_size_formats: '10px 9pt 10pt 12pt 14pt 18pt 24pt 36pt',
          forced_root_block: 'p',
          convert_urls: false,
          resize: 'both',
          browser_spellcheck: true,
          height: Math.max(220, (rows || 7) * 40),
          entity_encoding: 'raw',
          extended_valid_elements: '@[style|id|class],a[name|href|target|title|onclick|class|rel],img[class|src|border=0|alt|title|hspace|vspace|width|height|align|name|loading],hr[class|width|size|noshade],span[class|align|onclick],div[class|onclick],iframe[src|frameborder|width|height|loading],video[controls],audio[controls|src|style]',
          valid_children: '+body[style],+style',
          contextmenu: 'cut copy paste',
          paste_data_images: false,
          setup: function (editor) {
            tinyEditor = editor;
            try {
              editor.ui.registry.addGroupToolbarButton('more-options', { icon: 'more-drawer', tooltip: '...', items: 'strikethrough lineheight indent outdent unlink charmap anchor hr table media preview code' });
            } catch (e) {}
            editor.on('init', function () {
              src.style.display = 'none';
              srcBtn.classList.remove('tp-ed-on'); wysBtn.classList.add('tp-ed-on');
              var auxId = 'tp-tox-zfix';
              var toxCss = '.tox-tinymce-aux { z-index: 200000 !important; } .tox-dialog-wrap { z-index: 200000 !important; } .tox-dialog-wrap--backdrop { z-index: 199999 !important; } .tox-tinymce { border: 1px solid #d0d5dd !important; border-radius: 10px !important; }';
              [doc, document].forEach(function (d2) {
                try { if (!d2.getElementById(auxId)) { var s2 = d2.createElement('style'); s2.id = auxId; s2.textContent = toxCss; d2.head.appendChild(s2); } } catch (e) {}
              });
            });
            editor.on('LoadError InitError', function () {
              tinyMCE = null; tinyEditor = null; tinyInited = false;
              if (!fallbackInited) { initFallback(); fallbackInited = true; }
              activateWysiwyg();
            });
          }
        });
      } catch (err) {
        tinyMCE = null; tinyInited = false;
        if (!fallbackInited) { initFallback(); fallbackInited = true; }
        activateWysiwyg();
      }
    }

    function initFallback() {
      wysiwygFallback = doc.createElement('div');
      wysiwygFallback.className = 'tp-ed-wys'; wysiwygFallback.contentEditable = 'true';
      wysiwygFallback.style.minHeight = ((rows || 7) * 22) + 'px';
      wysiwygFallback.style.display = 'none';
      fmtFallback = doc.createElement('div');
      fmtFallback.className = 'tp-ed-fmt';
      fmtFallback.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;padding:6px;background:#f8f9fb;border:1px solid #e0e3ea;border-bottom:none;border-radius:10px 10px 0 0;';
      function syncFb() { src.value = wysiwygFallback.innerHTML; }
      function cmdFb(c, v) { try { doc.execCommand(c, false, v); } catch (e) {} }
      function mkBtnFb(html, title, fn) {
        var b = doc.createElement('button');
        b.type = 'button'; b.title = title; b.innerHTML = html;
        b.style.cssText = 'font:600 12px/1 inherit;min-width:28px;padding:6px 9px;border:1px solid #d9dce3;background:#fff;border-radius:6px;cursor:pointer;color:#344054;';
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function (e) { e.preventDefault(); wysiwygFallback.focus(); try { fn(); } catch (_) {} syncFb(); });
        return b;
      }
      fmtFallback.appendChild(mkBtnFb('<b>B</b>', 'Pogrubienie', function () { cmdFb('bold'); }));
      fmtFallback.appendChild(mkBtnFb('<i>I</i>', 'Kursywa', function () { cmdFb('italic'); }));
      fmtFallback.appendChild(mkBtnFb('<u>U</u>', 'Podkreślenie', function () { cmdFb('underline'); }));
      fmtFallback.appendChild(mkBtnFb('&bull; lista', 'Lista punktowana', function () { cmdFb('insertUnorderedList'); }));
      fmtFallback.appendChild(mkBtnFb('1. lista', 'Lista numerowana', function () { cmdFb('insertOrderedList'); }));
      fmtFallback.appendChild(mkBtnFb('Akapit', 'Akapit', function () { cmdFb('formatBlock', 'p'); }));
      fmtFallback.appendChild(mkBtnFb('Link', 'Wstaw link', function () { var u = (typeof prompt === 'function') ? prompt('Adres URL linku:', 'https://') : null; if (u) cmdFb('createLink', u); }));
      fmtFallback.appendChild(mkBtnFb('Usuń link', 'Usuń link', function () { cmdFb('unlink'); }));
      fmtFallback.appendChild(mkBtnFb('✕ format', 'Wyczyść formatowanie', function () { cmdFb('removeFormat'); cmdFb('unlink'); }));
      wrap.appendChild(fmtFallback);
      wrap.appendChild(wysiwygFallback);
      wysiwygFallback.addEventListener('input', syncFb);
      wysiwygFallback.addEventListener('blur', syncFb);
    }

    return {
      container: wrap,
      getValue: function () {
        if (tinyEditor) { try { tinyEditor.save(); return tinyEditor.getContent(); } catch (e) { return src.value; } }
        if (wysiwygFallback && wysiwygFallback.style.display !== 'none') return wysiwygFallback.innerHTML;
        return src.value;
      },
      setValue: function (h) {
        src.value = h || '';
        if (tinyEditor) { try { tinyEditor.setContent(h || ''); } catch (e) {} }
        if (wysiwygFallback) wysiwygFallback.innerHTML = h || '';
      },
      destroy: function () { if (tinyEditor) { try { tinyEditor.remove(); } catch (e) {} } }
    };
  }

  // v4.6.3: ujednolicony modal edycji parametru/warto\u015bci (zak\u0142adki j\u0119zyk\u00f3w, Nazwa + Opis od razu widoczne)
  // API: load getParameterLangData; zapis nazw setSettings&names[lang]; opis setDescription per j\u0119zyk.
  var TP_SEO_V2_CSS = "\n        /* Animations */\n        @keyframes tmFadeIn { from { opacity: 0; } to { opacity: 1; } }\n        @keyframes tmSlideUp { from { opacity: 0; transform: translateY(30px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }\n        @keyframes tmFadeOut { from { opacity: 1; } to { opacity: 0; } }\n        @keyframes tmSlideDown { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(30px) scale(0.97); } }\n        @keyframes tmShimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }\n        @keyframes tmSpin { to { transform: rotate(360deg); } }\n\n        /* Overlay */\n        .tm-overlay {\n            position: fixed;\n            top: 0; left: 0; right: 0; bottom: 0;\n            background: rgba(0,0,0,0.5);\n            z-index: 99999;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            font-family: 'Segoe UI', Roboto, Arial, sans-serif;\n            animation: tmFadeIn 0.2s ease;\n        }\n        .tm-overlay.tm-closing {\n            animation: tmFadeOut 0.16s ease forwards;\n        }\n        .tm-overlay.tm-closing .tm-modal,\n        .tm-overlay.tm-closing .tm-modal-content {\n            animation: tmSlideDown 0.16s ease forwards;\n        }\n\n        /* Modal container */\n        .tm-modal,\n        .tm-modal-content {\n            background: #f8f9fa;\n            border-radius: 12px;\n            box-shadow: 0 11px 15px -7px rgba(0,0,0,0.2), 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12);\n            max-height: 85vh;\n            display: flex;\n            flex-direction: column;\n            overflow: hidden;\n            animation: tmSlideUp 0.25s ease;\n        }\n\n        /* Dialog (small modal without header/footer) */\n        .tm-dialog {\n            background: #fff;\n            border-radius: 12px;\n            padding: 24px;\n            min-width: 380px;\n            box-shadow: 0 8px 32px rgba(0,0,0,0.25);\n            animation: tmSlideUp 0.25s ease;\n        }\n        .tm-dialog-title {\n            font-size: 15px;\n            font-weight: 600;\n            margin-bottom: 16px;\n        }\n        .tm-dialog-section {\n            margin-bottom: 16px;\n        }\n        .tm-dialog-section-label {\n            font-size: 13px;\n            font-weight: 500;\n            margin-bottom: 8px;\n        }\n        .tm-dialog-row {\n            display: flex;\n            align-items: center;\n            gap: 8px;\n            padding: 4px 0;\n            cursor: pointer;\n            font-size: 13px;\n        }\n        .tm-dialog-row--disabled {\n            opacity: 0.5;\n        }\n        .tm-dialog-cb-label {\n            display: flex;\n            align-items: flex-start;\n            gap: 10px;\n            cursor: pointer;\n            margin-bottom: 10px;\n        }\n        .tm-dialog-cb-label:last-child { margin-bottom: 0; }\n        .tm-dialog-cb-title {\n            font-size: 13px;\n            font-weight: 500;\n        }\n        .tm-dialog-cb-desc {\n            font-size: 11px;\n            color: #5f6368;\n            margin-top: 2px;\n        }\n        .tm-dialog-footer {\n            display: flex;\n            gap: 8px;\n            justify-content: flex-end;\n        }\n\n        /* Header */\n        .tm-modal-header {\n            background: none;\n            padding: 18px 24px;\n            display: flex;\n            align-items: center;\n            gap: 12px;\n            color: #000;\n            font-size: 18px;\n            font-weight: 500;\n            flex-shrink: 0;\n        }\n        .tm-modal-header--danger {\n            background: #c0392b;\n            color: #fff;\n            border-radius: 12px 12px 0 0;\n            padding: 16px 20px;\n            font-size: 16px;\n            font-weight: 600;\n        }\n        .tm-modal-header--colored {\n            background: var(--tm-header-bg, #1a73e8);\n            color: #fff;\n            border-radius: 12px 12px 0 0;\n            padding: 14px 20px;\n            font-size: 15px;\n            font-weight: 600;\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n        }\n        .tm-modal-header-close {\n            cursor: pointer;\n            font-size: 18px;\n            opacity: 0.8;\n            background: none;\n            border: none;\n            color: inherit;\n            line-height: 1;\n            transition: opacity 0.15s;\n        }\n        .tm-modal-header-close:hover { opacity: 1; }\n        .tm-modal-count-badge {\n            background: rgba(255,255,255,0.15);\n            color: white;\n            font-size: 13px;\n            font-weight: 400;\n            padding: 4px 12px;\n            border-radius: 20px;\n        }\n\n        /* Body */\n        .tm-modal-body {\n            flex: 1;\n            overflow-y: auto;\n            padding: 20px 24px;\n            background: #f8f9fa;\n        }\n\n        /* Footer */\n        .tm-modal-footer {\n            padding: 14px 24px;\n            border-top: 1px solid #e8eaed;\n            display: flex;\n            gap: 8px;\n            justify-content: flex-end;\n            align-items: center;\n            background: white;\n            flex-shrink: 0;\n        }\n\n        /* Section cards */\n        .tm-card,\n        .tm-section-card {\n            background: white;\n            border-radius: 8px;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);\n            border: 1px solid #e8eaed;\n            margin-bottom: 16px;\n            overflow: hidden;\n        }\n        .tm-card:last-of-type,\n        .tm-section-card:last-of-type { margin-bottom: 0; }\n        .tm-card-header,\n        .tm-section-header {\n            padding: 10px 16px;\n            font-size: 11px;\n            font-weight: 700;\n            text-transform: uppercase;\n            letter-spacing: 0.8px;\n            background: none;\n            color: #000;\n            display: flex;\n            align-items: center;\n            gap: 8px;\n        }\n        .tm-card-header .material-symbols-outlined,\n        .tm-section-header .material-symbols-outlined {\n            font-size: 18px;\n            color: #1a73e8;\n        }\n        .tm-card-body,\n        .tm-section-body { padding: 4px 0; }\n\n        /* Section color variants */\n        .tm-section-card--behavior { --section-color: #1a73e8; --section-active-bg: #e8f0fe; }\n        .tm-section-card--content { --section-color: #00897b; --section-active-bg: #e0f7f5; }\n        .tm-section-card--display { --section-color: #0d904f; --section-active-bg: #e6f4ea; }\n        .tm-section-card--graphics { --section-color: #e8710a; --section-active-bg: #fef3e0; }\n        .tm-section-card--visibility { --section-color: #9334e6; --section-active-bg: #f3e8fd; }\n        .tm-section-card--translations { --section-color: #6a1b9a; --section-active-bg: #f3e5f9; }\n        .tm-section-card--seo { --section-color: #0277bd; --section-active-bg: #e1f5fe; }\n        .tm-section-card--cleanup { --section-color: #d93025; --section-active-bg: #fce8e6; }\n        .tm-section-card--descriptions { --section-color: #546e7a; --section-active-bg: #eceff1; }\n\n        /* Field rows */\n        .tm-field-row {\n            display: flex;\n            align-items: center;\n            gap: 12px;\n            padding: 8px 16px;\n            border-bottom: 1px solid #f1f3f4;\n            transition: background 0.15s ease;\n        }\n        .tm-field-row:last-child { border-bottom: none; }\n        .tm-field-row:hover { background: #f8f9fa; }\n        .tm-field-active { background: var(--section-active-bg) !important; }\n\n        /* Field labels */\n        .tm-field-label {\n            flex: 1;\n            font-size: 13px;\n            color: #202124;\n            cursor: pointer;\n            user-select: none;\n            line-height: 1.4;\n        }\n\n        /* Toggle switch — 3-part pattern (span > input + track) */\n        .tm-switch {\n            position: relative;\n            width: 36px;\n            height: 20px;\n            flex-shrink: 0;\n            display: inline-block;\n        }\n        .tm-switch input {\n            opacity: 0;\n            width: 0;\n            height: 0;\n            position: absolute;\n        }\n        .tm-switch-track {\n            position: absolute;\n            inset: 0;\n            background: #dadce0;\n            border-radius: 10px;\n            transition: background 0.2s;\n            cursor: pointer;\n        }\n        .tm-switch-track::after {\n            content: '';\n            position: absolute;\n            top: 2px;\n            left: 2px;\n            width: 16px;\n            height: 16px;\n            background: #fff;\n            border-radius: 50%;\n            transition: transform 0.2s;\n            box-shadow: 0 1px 3px rgba(0,0,0,0.2);\n        }\n        .tm-switch input:checked + .tm-switch-track {\n            background: var(--section-color, #2e7d32);\n        }\n        .tm-switch input:checked + .tm-switch-track::after {\n            transform: translateX(16px);\n        }\n\n        /* Input/select wrapper with icon */\n        .tm-input-wrap {\n            display: flex;\n            align-items: center;\n            background: #f0f4f8;\n            border: 1px solid transparent;\n            border-radius: 8px;\n            transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;\n            width: 100%;\n            box-sizing: border-box;\n        }\n        .tm-field-row .tm-input-wrap {\n            width: auto;\n            flex: 0 1 540px;\n        }\n        .tm-input-wrap:focus-within {\n            background: #fff;\n            border-color: #0277bd;\n            box-shadow: 0 0 0 2px rgba(2,119,189,0.12);\n        }\n        .tm-input-wrap .tm-input-icon {\n            font-size: 18px;\n            color: #7b8794;\n            padding: 0 0 0 10px;\n            flex-shrink: 0;\n        }\n        .tm-input-wrap:focus-within .tm-input-icon { color: #0277bd; }\n        .tm-input-wrap .tm-select {\n            flex: 1;\n            border: none;\n            background-color: transparent;\n            box-shadow: none;\n            padding: 9px 32px 9px 10px;\n            font-size: 13px;\n            line-height: 1.4;\n            min-height: 38px;\n            width: 0;\n            min-width: 0;\n            outline: none;\n            -webkit-appearance: none;\n            -moz-appearance: none;\n            appearance: none;\n            background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%235f6368' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\");\n            background-repeat: no-repeat;\n            background-position: right 10px center;\n        }\n        .tm-input-wrap .tm-text-input {\n            flex: 1;\n            border: none;\n            background: transparent;\n            box-shadow: none;\n            padding: 9px 10px;\n            font-size: 13px;\n            width: 0;\n            min-width: 0;\n            outline: none;\n            font-family: inherit;\n        }\n        .tm-input-wrap .tm-textarea {\n            flex: 1;\n            border: none;\n            background: transparent;\n            box-shadow: none;\n            padding: 9px 10px;\n            font-size: 13px;\n            width: 0;\n            min-width: 0;\n            outline: none;\n            font-family: inherit;\n            min-height: 44px;\n            resize: vertical;\n            align-self: stretch;\n        }\n        .tm-input-wrap .tm-textarea::placeholder,\n        .tm-input-wrap .tm-text-input::placeholder,\n        .tm-input-wrap input::placeholder { color: #9ca3af; }\n        .tm-input-wrap--ta { align-items: flex-start; }\n        .tm-input-wrap--ta .tm-input-icon { padding-top: 10px; }\n\n        /* Buttons — base */\n        .tm-btn {\n            padding: 9px 24px;\n            border-radius: 6px;\n            cursor: pointer;\n            font-size: 13px;\n            font-weight: 500;\n            font-family: inherit;\n            transition: all 0.15s ease;\n            border: none;\n        }\n        .tm-btn:active { transform: scale(0.97); }\n        .tm-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }\n        .tm-btn-primary {\n            background: #1a73e8;\n            color: white;\n            box-shadow: 0 1px 3px rgba(26,115,232,0.3);\n        }\n        .tm-btn-primary:hover:not(:disabled) { background: #1557b0; box-shadow: 0 2px 6px rgba(26,115,232,0.4); }\n        .tm-btn-secondary {\n            background: transparent;\n            color: #5f6368;\n            border: 1px solid #dadce0;\n        }\n        .tm-btn-secondary:hover:not(:disabled) { background: #f1f3f4; color: #202124; }\n        .tm-btn-danger {\n            background: #d93025;\n            color: white;\n        }\n        .tm-btn-danger:hover:not(:disabled) { background: #b3261e; }\n        .tm-btn-apply {\n            background: #059669;\n            color: white;\n        }\n        .tm-btn-apply:hover:not(:disabled) { background: #047857; }\n\n        /* Legacy button aliases used in existing modals */\n        .tm-modal-footer button {\n            padding: 9px 24px;\n            border-radius: 6px;\n            cursor: pointer;\n            font-size: 13px;\n            font-weight: 500;\n            font-family: inherit;\n            transition: all 0.15s ease;\n            border: none;\n        }\n        .tm-modal-footer button:active { transform: scale(0.97); }\n        .tm-modal-footer button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }\n        .tm-btn-save {\n            background: #1a73e8;\n            color: white;\n            box-shadow: 0 1px 3px rgba(26,115,232,0.3);\n        }\n        .tm-btn-save:hover:not(:disabled) { background: #1557b0; box-shadow: 0 2px 6px rgba(26,115,232,0.4); }\n        .tm-btn-cancel,\n        .tm-btn-close-modal {\n            background: transparent;\n            color: #5f6368;\n            border: 1px solid #dadce0 !important;\n        }\n        .tm-btn-cancel:hover:not(:disabled),\n        .tm-btn-close-modal:hover:not(:disabled) { background: #f1f3f4; color: #202124; }\n        .tm-btn-stop-edit { background: #d93025; color: white; }\n        .tm-btn-stop-edit:hover:not(:disabled) { background: #b3261e; }\n\n        /* Info & warning bars */\n        .tm-info-bar {\n            padding: 12px;\n            background: #f8f9fa;\n            border-radius: 6px;\n            border: 1px solid #dee2e6;\n            margin-bottom: 16px;\n            font-size: 13px;\n        }\n        .tm-warning-bar {\n            padding: 12px;\n            background: #fdf2f2;\n            border: 1px solid #e74c3c;\n            border-radius: 6px;\n            color: #c0392b;\n            font-size: 13px;\n            margin-bottom: 16px;\n        }\n\n        /* Spinner */\n        .tm-spinner {\n            width: 16px;\n            height: 16px;\n            border: 2px solid #e8eaed;\n            border-top-color: #1a73e8;\n            border-radius: 50%;\n            animation: tmSpin 0.8s linear infinite;\n            flex-shrink: 0;\n        }\n\n        /* Progress bar */\n        .tm-modal-progress { padding: 12px 24px; }\n        .tm-progress-bar,\n        .tm-progress {\n            height: 8px;\n            background: #e8eaed;\n            border-radius: 4px;\n            overflow: hidden;\n            margin-bottom: 8px;\n            position: relative;\n        }\n        .tm-progress-fill {\n            height: 100%;\n            background: linear-gradient(90deg, #1a73e8, #34a853);\n            width: 0%;\n            transition: width 0.3s ease;\n            border-radius: 4px;\n            position: relative;\n        }\n        .tm-progress-fill::after {\n            content: '';\n            position: absolute;\n            top: 0; left: 0; right: 0; bottom: 0;\n            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);\n            animation: tmShimmer 1.5s infinite;\n        }\n        .tm-progress-text { font-size: 12px; color: #5f6368; }\n\n        /* Results */\n        .tm-modal-results {\n            padding: 12px 24px;\n            font-size: 12px;\n            color: #202124;\n        }\n        .tm-modal-results ul { margin: 4px 0; padding-left: 20px; }\n\n        /* Success feedback */\n        .tm-save-success {\n            background: #e6f4ea;\n            color: #137333;\n            padding: 8px 16px;\n            border-radius: 4px;\n            font-size: 13px;\n            text-align: center;\n            margin: 8px 24px;\n        }\n\n        /* Material Symbols */\n        .material-symbols-outlined {\n            font-family: 'Material Symbols Outlined';\n            font-weight: normal;\n            font-style: normal;\n            font-size: 24px;\n            line-height: 1;\n            letter-spacing: normal;\n            text-transform: none;\n            display: inline-block;\n            white-space: nowrap;\n            direction: ltr;\n            -webkit-font-smoothing: antialiased;\n        }\n    \n\n        /* Tło strony (overlay) — bez backdrop-filter (powodował lag natywnego file pickera) */\n        .tm-overlay.tm-settings-v2 {\n            background: rgba(27, 32, 45, .42);\n            font-family: 'DM Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;\n            padding: 30px 16px;\n            align-items: flex-start;\n            overflow-y: auto;\n        }\n\n        /* Modal container */\n        .tm-settings-v2 .tm-modal-content {\n            background: #f4f5f7;\n            border-radius: 18px;\n            box-shadow: 0 8px 40px rgba(0,0,0,.12), 0 1px 3px rgba(0,0,0,.06);\n            max-width: 950px;\n            width: 100%;\n            max-height: none;\n            display: flex;\n            flex-direction: column;\n            font-family: 'DM Sans', system-ui, sans-serif;\n        }\n\n        /* ===== HEADER ===== */\n        .tm-settings-v2 .tm-modal-header {\n            padding: 18px 24px;\n            background: #fff;\n            border-bottom: 1px solid #eef0f4;\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            color: #1a1a2e;\n            font-weight: 700;\n            gap: 12px;\n            font-size: 16px;\n        }\n        .tm-settings-v2 .tm-settings-header-left {\n            display: flex;\n            align-items: center;\n            gap: 12px;\n            min-width: 0;\n        }\n        .tm-settings-v2 .tm-settings-header-icon {\n            width: 38px; height: 38px; border-radius: 10px;\n            display: flex; align-items: center; justify-content: center;\n            background: #f0f2f5;\n            color: #667085;\n            flex-shrink: 0;\n        }\n        .tm-settings-v2 .tm-settings-header-icon .material-symbols-outlined {\n            font-size: 20px;\n            color: #667085;\n        }\n        .tm-settings-v2 .tm-settings-header-text { min-width: 0; }\n        .tm-settings-v2 .tm-settings-header-title {\n            font-size: 16px;\n            font-weight: 700;\n            color: #1a1a2e;\n            line-height: 1.25;\n            font-family: 'DM Sans', sans-serif;\n        }\n        .tm-settings-v2 .tm-settings-header-subtitle {\n            font-size: 12px;\n            color: #98a2b3;\n            margin-top: 1px;\n            font-weight: 400;\n        }\n        .tm-settings-v2 .tm-settings-close {\n            width: 34px; height: 34px;\n            border-radius: 8px;\n            border: none;\n            background: transparent;\n            cursor: pointer;\n            display: flex; align-items: center; justify-content: center;\n            color: #b0b8c9;\n            transition: all .2s;\n            padding: 0;\n            flex-shrink: 0;\n        }\n        .tm-settings-v2 .tm-settings-close:hover {\n            background: #f0f2f5;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-settings-close .material-symbols-outlined {\n            font-size: 20px;\n            color: inherit;\n        }\n\n        /* ===== BODY ===== */\n        .tm-settings-v2 .tm-modal-body {\n            flex: 1;\n            overflow-y: auto;\n            padding: 14px 16px 6px;\n            background: #f4f5f7;\n            max-height: calc(90vh - 140px);\n        }\n\n        /* ===== SECTION CARD ===== */\n        .tm-settings-v2 .tm-section-card {\n            background: #fff;\n            border-radius: 14px;\n            border: 1px solid #eef0f4;\n            box-shadow: none;\n            margin-bottom: 14px;\n            overflow: hidden;\n        }\n        .tm-settings-v2 .tm-section-card:last-of-type { margin-bottom: 0; }\n        .tm-settings-v2 .tm-section-header {\n            padding: 14px 22px;\n            border-bottom: 1px solid #eef0f4;\n            background: #fafbfc;\n            font-family: 'DM Sans', sans-serif;\n            font-size: 12px;\n            font-weight: 700;\n            color: #344054;\n            text-transform: uppercase;\n            letter-spacing: 0.06em;\n            display: flex;\n            align-items: center;\n            gap: 10px;\n        }\n        .tm-settings-v2 .tm-section-header .material-symbols-outlined {\n            font-size: 16px;\n            color: #667085;\n            opacity: 0.75;\n        }\n        .tm-settings-v2 .tm-section-body {\n            padding: 4px 22px 8px;\n        }\n\n        /* ===== FIELD ROW ===== */\n        .tm-settings-v2 .tm-field-row {\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            padding: 11px 0;\n            border-bottom: 1px solid #f0f2f5;\n            gap: 16px;\n            transition: none;\n        }\n        .tm-settings-v2 .tm-section-body > .tm-field-row:last-child { border-bottom: none; }\n        .tm-settings-v2 .tm-field-row:hover { background: transparent; }\n        .tm-settings-v2 .tm-field-row.tm-field-active { background: transparent !important; }\n\n        .tm-settings-v2 .tm-field-label {\n            flex: 1 1 auto;\n            font-size: 13.5px;\n            color: #344054;\n            font-family: 'DM Sans', sans-serif;\n            font-weight: 400;\n        }\n\n        /* ===== INPUT WRAP (select/input/textarea) ===== */\n        .tm-settings-v2 .tm-input-wrap {\n            flex: 0 0 420px;\n            width: 420px;\n            background: #f8f9fb;\n            border: 1px solid #e0e3ea;\n            border-radius: 8px;\n            transition: border-color .2s;\n            box-shadow: none;\n        }\n        .tm-settings-v2 .tm-field-row .tm-input-wrap {\n            flex: 0 0 420px;\n        }\n        .tm-settings-v2 .tm-input-wrap:focus-within {\n            background: #f8f9fb;\n            border-color: #4f8cff;\n            box-shadow: none;\n        }\n        .tm-settings-v2 .tm-input-wrap .tm-input-icon {\n            font-size: 14px;\n            color: #98a2b3;\n            opacity: 0.7;\n            padding: 0 0 0 10px;\n        }\n        .tm-settings-v2 .tm-input-wrap:focus-within .tm-input-icon {\n            color: #98a2b3;\n        }\n        .tm-settings-v2 .tm-input-wrap .tm-select,\n        .tm-settings-v2 .tm-input-wrap .tm-field-select {\n            font-family: 'DM Sans', sans-serif;\n            font-size: 13px;\n            color: #1a1a2e;\n            padding: 8px 32px 8px 10px;\n            min-height: 36px;\n            background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' fill='none' stroke='%2398a2b3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");\n            background-repeat: no-repeat;\n            background-position: right 10px center;\n        }\n        .tm-settings-v2 .tm-input-wrap .tm-text-input,\n        .tm-settings-v2 .tm-input-wrap .tm-textarea,\n        .tm-settings-v2 .tm-input-wrap .tm-node-text-input {\n            font-family: 'DM Sans', sans-serif;\n            font-size: 13px;\n            color: #1a1a2e;\n            padding: 8px 10px;\n            background: transparent;\n        }\n\n        /* Select bez wrappera */\n        .tm-settings-v2 .tm-field-select {\n            font-family: 'DM Sans', sans-serif;\n            font-size: 13px;\n            color: #1a1a2e;\n        }\n\n        /* Radio group (auto/manual) */\n        .tm-settings-v2 .tm-headline-radio-group {\n            display: flex;\n            gap: 20px;\n            flex: 0 0 420px;\n            width: 420px;\n        }\n        .tm-settings-v2 .tm-headline-radio-group label {\n            display: flex;\n            align-items: center;\n            gap: 6px;\n            cursor: pointer;\n            font-size: 13px;\n            font-family: 'DM Sans', sans-serif;\n            color: #98a2b3;\n            font-weight: 400;\n        }\n        .tm-settings-v2 .tm-headline-radio-group label:has(input:checked) {\n            color: #1a1a2e;\n            font-weight: 600;\n        }\n        .tm-settings-v2 .tm-headline-radio-group input[type=\"radio\"] {\n            accent-color: #4f8cff;\n        }\n\n        /* Conditional rows (hidden by default unless .tm-field-visible) */\n        .tm-settings-v2 .tm-field-conditional:not(.tm-field-visible) {\n            display: none;\n        }\n\n        /* Hint bar — InfoBox z szablonu (base — bez conditional) */\n        .tm-settings-v2 .tm-hint-bar,\n        .tm-settings-v2 .tm-subfields-container .tm-hint-bar {\n            margin: 10px 0 4px;\n            padding: 11px 14px;\n            border-radius: 9px;\n            font-size: 12px;\n            display: flex;\n            gap: 10px;\n            align-items: flex-start;\n            line-height: 1.5;\n            font-family: 'DM Sans', sans-serif;\n            border: 1px solid;\n        }\n        /* Hint bar w conditional container (tm-subfields-container) — większy margin-top dla odstępu od rodzica */\n        .tm-settings-v2 .tm-subfields-container > .tm-hint-bar,\n        .tm-settings-v2 .tm-subfields-container > * > .tm-hint-bar:first-child,\n        .tm-settings-v2 .tm-subfields-container .tm-fe-hint-bar:first-child {\n            margin-top: 14px;\n        }\n        .tm-settings-v2 .tm-hint-bar--info,\n        .tm-settings-v2 .tm-subfields-container .tm-hint-bar--info {\n            background: #eef3ff;\n            border-color: #d6e2ff;\n            color: #3b5998;\n        }\n        .tm-settings-v2 .tm-hint-bar--warn,\n        .tm-settings-v2 .tm-subfields-container .tm-hint-bar--warn {\n            background: #fef9ec;\n            border-color: #faecc8;\n            color: #8a6d3b;\n        }\n        /* Ikona info w hint barach — SVG okrągła (Lucide info-circle), identyczna z .tm-fe-hint-bar */\n        .tm-settings-v2 .tm-hint-bar .tm-hint-icon {\n            display: inline-block;\n            width: 16px;\n            height: 16px;\n            flex-shrink: 0;\n            font-size: 0;\n            color: transparent;\n            background-repeat: no-repeat;\n            background-position: center;\n            background-size: 16px 16px;\n        }\n        .tm-settings-v2 .tm-hint-bar--info .tm-hint-icon {\n            background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234f8cff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='16' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8'/%3E%3C/svg%3E\");\n        }\n        .tm-settings-v2 .tm-hint-bar--warn .tm-hint-icon {\n            background-image: url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23d4a017' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/%3E%3Cline x1='12' y1='9' x2='12' y2='13'/%3E%3Cline x1='12' y1='17' x2='12.01' y2='17'/%3E%3C/svg%3E\");\n        }\n\n        /* Textarea row — opisy HTML */\n        .tm-settings-v2 .tm-field-row--textarea {\n            display: block;\n            padding: 12px 0 6px;\n        }\n        .tm-settings-v2 .tm-field-row--textarea .tm-field-label {\n            display: block;\n            margin-bottom: 8px;\n            font-weight: 500;\n            color: #344054;\n        }\n\n        /* Default filters info box */\n        .tm-settings-v2 .tm-filter-default-info {\n            margin: 10px 0 8px;\n            padding: 11px 14px;\n            border-radius: 9px;\n            background: #f8f9fb;\n            border: 1px solid #e8ebf0;\n            font-size: 12.5px;\n            color: #344054;\n            font-family: 'DM Sans', sans-serif;\n            line-height: 1.6;\n        }\n\n        /* ===== FOOTER ===== */\n        .tm-settings-v2 .tm-modal-footer {\n            padding: 14px 24px;\n            background: #fff;\n            border-top: 1px solid #eef0f4;\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n            gap: 8px;\n        }\n        .tm-settings-v2 .tm-footer-right {\n            display: flex;\n            gap: 8px;\n        }\n        .tm-settings-v2 .tm-ai-footer-btn {\n            display: flex;\n            align-items: center;\n            gap: 7px;\n            padding: 7px 14px;\n            border-radius: 8px;\n            border: 1px solid #e0e3ea;\n            background: #fafbfc;\n            color: #667085;\n            font-size: 12.5px;\n            font-weight: 500;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            transition: all .2s;\n        }\n        .tm-settings-v2 .tm-ai-footer-btn .material-symbols-outlined {\n            font-size: 16px;\n        }\n        .tm-settings-v2 .tm-ai-footer-btn:hover {\n            border-color: #c0cfff;\n            color: #4f8cff;\n            background: #f0f4ff;\n        }\n        .tm-settings-v2 .tm-modal-footer .tm-btn-cancel {\n            padding: 9px 20px;\n            border-radius: 8px;\n            border: 1px solid #d0d5dd !important;\n            background: #fff;\n            color: #344054;\n            font-size: 13px;\n            font-weight: 600;\n            font-family: 'DM Sans', sans-serif;\n            box-shadow: none;\n        }\n        .tm-settings-v2 .tm-modal-footer .tm-btn-cancel:hover {\n            background: #f8f9fb;\n            border-color: #b0b7c3 !important;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-modal-footer .tm-btn-save {\n            padding: 9px 24px;\n            border-radius: 8px;\n            border: none;\n            background: linear-gradient(135deg, #4f8cff, #3b6de0);\n            color: #fff;\n            font-size: 13px;\n            font-weight: 600;\n            font-family: 'DM Sans', sans-serif;\n            box-shadow: 0 2px 8px rgba(79,140,255,.35);\n        }\n        .tm-settings-v2 .tm-modal-footer .tm-btn-save:hover {\n            background: linear-gradient(135deg, #4f8cff, #3b6de0);\n            box-shadow: 0 4px 12px rgba(79,140,255,.45);\n        }\n\n        /* Legacy AI toggle (in-header) — ukryj w v2 (AI przesunięte do footera) */\n        .tm-settings-v2 .tm-ai-toggle-btn { display: none; }\n\n        /* ===== ETAP 2: GRAFIKI ===== */\n\n        /* SubSection — pomarańczowy uppercase header (Kiedy kursor poza linkiem, itd.) */\n        .tm-settings-v2 .tm-gfx-slot-header {\n            font-size: 11.5px;\n            font-weight: 700;\n            color: #e65100;\n            text-transform: uppercase;\n            letter-spacing: 0.05em;\n            padding: 14px 0 6px;\n            font-family: 'DM Sans', sans-serif;\n            border: none;\n            background: none;\n            margin: 0;\n        }\n        .tm-settings-v2 .tm-gfx-slot-header:not(:first-child) {\n            border-top: none;\n        }\n\n        /* Type selector row — identyczny styl jak tm-field-row */\n        .tm-settings-v2 .tm-gfx-subfield {\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            padding: 8px 0;\n            gap: 16px;\n            border: none;\n        }\n        .tm-settings-v2 .tm-gfx-subfield .tm-field-label {\n            font-size: 13.5px;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-gfx-subfield .tm-input-wrap {\n            flex: 0 0 420px;\n            width: 420px;\n        }\n\n        /* Slot upload container */\n        .tm-settings-v2 .tm-gfx-slot-upload {\n            padding: 4px 0 8px;\n        }\n\n        /* FileUpload — dashed border, Przeglądaj button */\n        .tm-settings-v2 .tm-gfx-upload-row {\n            display: flex;\n            align-items: center;\n            gap: 12px;\n            padding: 10px 14px;\n            background: #f8f9fb;\n            border: 1px dashed #d0d5dd;\n            border-radius: 8px;\n            margin-bottom: 8px;\n            transition: border-color .15s;\n        }\n        .tm-settings-v2 .tm-gfx-upload-row:hover {\n            border-color: #4f8cff;\n        }\n        .tm-settings-v2 .tm-gfx-upload-row-label {\n            font-size: 12.5px;\n            color: #667085;\n            font-family: 'DM Sans', sans-serif;\n            flex-shrink: 0;\n        }\n        /* Custom file input: hide native, show Przeglądaj button */\n        .tm-settings-v2 .tm-gfx-upload-input {\n            font-size: 0;\n            color: transparent;\n            width: auto;\n            max-width: 100px;\n        }\n        .tm-settings-v2 .tm-gfx-upload-input::-webkit-file-upload-button,\n        .tm-settings-v2 .tm-gfx-upload-input::file-selector-button {\n            padding: 5px 14px;\n            border-radius: 6px;\n            border: 1px solid #d0d5dd;\n            background: #fff;\n            font-size: 12px;\n            color: #344054;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            font-weight: 500;\n            margin-right: 8px;\n        }\n        .tm-settings-v2 .tm-gfx-upload-input::-webkit-file-upload-button:hover,\n        .tm-settings-v2 .tm-gfx-upload-input::file-selector-button:hover {\n            background: #f8f9fb;\n            border-color: #b0b7c3;\n        }\n        .tm-settings-v2 .tm-gfx-upload-preview {\n            font-size: 12px;\n            color: #98a2b3;\n            font-family: 'DM Sans', sans-serif;\n            flex: 1;\n        }\n        .tm-settings-v2 .tm-gfx-upload-preview:empty::before {\n            content: 'Nie wybrano pliku.';\n            color: #98a2b3;\n        }\n\n        /* SchemaBox — niebieski left-border box z code */\n        .tm-settings-v2 .tm-folder-section {\n            padding: 8px 0;\n        }\n        .tm-settings-v2 .tm-folder-guide {\n            border-left: 3px solid #4f8cff;\n            background: #f0f4ff;\n            border-radius: 0 8px 8px 0;\n            padding: 12px 16px;\n            margin-bottom: 8px;\n            font-size: 12px;\n            color: #344054;\n            font-family: 'DM Sans', sans-serif;\n            border-top: none;\n            border-right: none;\n            border-bottom: none;\n        }\n        .tm-settings-v2 .tm-folder-guide strong {\n            color: #e65100;\n            font-weight: 700;\n        }\n        .tm-settings-v2 .tm-guide-code {\n            font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;\n            font-size: 11.5px;\n            color: #344054;\n            background: none;\n            padding: 0;\n        }\n        .tm-settings-v2 .tm-guide-examples {\n            margin-top: 6px;\n        }\n        .tm-settings-v2 .tm-guide-example {\n            padding: 2px 0;\n            font-size: 12px;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-guide-example code {\n            font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;\n            font-size: 11.5px;\n            color: #4f8cff;\n            text-decoration: underline;\n            background: none;\n            padding: 0;\n        }\n\n        /* Folder upload input + mapping */\n        .tm-settings-v2 .tm-upload-folder-input {\n            display: block;\n            margin-top: 8px;\n            padding: 8px 12px;\n            border: 1px dashed #d0d5dd;\n            background: #f8f9fb;\n            border-radius: 8px;\n            width: 100%;\n            font-size: 12.5px;\n            font-family: 'DM Sans', sans-serif;\n            color: #667085;\n            cursor: pointer;\n        }\n        .tm-settings-v2 .tm-upload-folder-input::-webkit-file-upload-button,\n        .tm-settings-v2 .tm-upload-folder-input::file-selector-button {\n            padding: 5px 14px;\n            border-radius: 6px;\n            border: 1px solid #d0d5dd;\n            background: #fff;\n            font-size: 12px;\n            color: #344054;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            font-weight: 500;\n            margin-right: 8px;\n        }\n        .tm-settings-v2 .tm-upload-mapping {\n            padding: 10px 14px;\n            background: #f8f9fb;\n            border: 1px solid #e8ebf0;\n            border-radius: 8px;\n            margin-top: 8px;\n            font-size: 12px;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-mapping-list {\n            margin-top: 6px;\n        }\n        .tm-settings-v2 .tm-mapping-match {\n            color: #137333;\n            font-family: 'JetBrains Mono', monospace;\n            font-size: 11.5px;\n            padding: 1px 0;\n        }\n        .tm-settings-v2 .tm-mapping-warn {\n            color: #d4a017;\n            font-family: 'JetBrains Mono', monospace;\n            font-size: 11.5px;\n            padding: 1px 0;\n        }\n        .tm-settings-v2 .tm-mapping-summary {\n            margin-top: 6px;\n            font-size: 12px;\n            color: #344054;\n        }\n\n        /* Existing gfx preview rows */\n        .tm-settings-v2 .tm-gfx-existing {\n            display: flex;\n            align-items: center;\n            gap: 10px;\n            padding: 8px 12px;\n            background: #fff;\n            border: 1px solid #e8ebf0;\n            border-radius: 8px;\n            margin-bottom: 8px;\n            font-size: 12.5px;\n        }\n        .tm-settings-v2 .tm-gfx-existing-label {\n            font-size: 12px;\n            color: #667085;\n            font-weight: 500;\n            flex-shrink: 0;\n        }\n        .tm-settings-v2 .tm-gfx-thumb {\n            height: 40px;\n            width: auto;\n            border-radius: 4px;\n            border: 1px solid #e8ebf0;\n            object-fit: contain;\n        }\n        .tm-settings-v2 .tm-gfx-existing-actions {\n            display: flex;\n            align-items: center;\n            gap: 8px;\n            margin-left: auto;\n        }\n        .tm-settings-v2 .tm-gfx-size-badge {\n            font-size: 11px;\n            color: #98a2b3;\n            padding: 2px 8px;\n            background: #f0f2f5;\n            border-radius: 10px;\n        }\n        .tm-settings-v2 .tm-gfx-size-badge.tm-gfx-size-warn {\n            color: #d4a017;\n            background: #fef9ec;\n        }\n        .tm-settings-v2 .tm-gfx-link {\n            font-size: 12px;\n            color: #4f8cff;\n            text-decoration: none;\n            font-weight: 500;\n        }\n        .tm-settings-v2 .tm-gfx-link:hover { text-decoration: underline; }\n        .tm-settings-v2 .tm-gfx-delete {\n            font-size: 12px;\n            color: #d32f2f;\n            cursor: pointer;\n            font-weight: 500;\n        }\n        .tm-settings-v2 .tm-gfx-delete:hover { text-decoration: underline; }\n\n        /* Subfields container (conditional visibility already handled by tm-subfields-container CSS) */\n        .tm-settings-v2 .tm-subfields-container {\n            padding: 0;\n            margin: 0;\n            background: transparent;\n        }\n\n        /* Textarea field row */\n        .tm-settings-v2 .tm-field-row--textarea {\n            display: block;\n            padding: 12px 0 6px;\n        }\n        /* Ukryj zewnętrzny label (jest teraz wewnątrz edytora w headerze) */\n        .tm-settings-v2 .tm-field-row--textarea > .tm-field-label {\n            display: none;\n        }\n\n        /* ===== ETAP 4: HtmlEditor (1:1 z szablonu) ===== */\n\n        /* Editor wrapper — relative dla absolute button siatki */\n        .tm-settings-v2 .tm-editor-wrap {\n            position: relative;\n            border: none;\n            border-radius: 10px;\n            overflow: visible;\n            background: transparent;\n        }\n\n        /* Header: label po lewej, toggle pill po prawej */\n        .tm-settings-v2 .tm-editor-v2-header {\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            margin-bottom: 8px;\n            gap: 12px;\n        }\n        .tm-settings-v2 .tm-editor-v2-label {\n            font-size: 13px;\n            color: #344054;\n            font-weight: 500;\n            font-family: 'DM Sans', sans-serif;\n        }\n\n        /* Toggle bar jako pill (HTML/Wizualny) */\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-toggle-bar {\n            display: inline-flex;\n            align-items: center;\n            gap: 0;\n            background: #f0f2f5;\n            border-radius: 8px;\n            padding: 3px;\n            border: none;\n            overflow: visible;\n        }\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-toggle-btn {\n            flex: none;\n            display: flex;\n            align-items: center;\n            gap: 5px;\n            padding: 5px 12px;\n            border-radius: 6px;\n            border: none;\n            cursor: pointer;\n            font-size: 12px;\n            font-weight: 600;\n            font-family: 'DM Sans', sans-serif;\n            background: transparent;\n            color: #98a2b3;\n            transition: all .2s;\n            box-shadow: none;\n        }\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-toggle-btn:hover {\n            background: rgba(255,255,255,0.5);\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-toggle-btn.tm-ed-active {\n            background: #fff;\n            color: #1a1a2e;\n            box-shadow: 0 1px 3px rgba(0,0,0,.1);\n        }\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-toggle-btn svg {\n            flex-shrink: 0;\n        }\n\n        /* Textarea container — border wokół + rounded */\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-source {\n            border: 1px solid #e0e3ea;\n            border-radius: 10px;\n            background: #f8f9fb;\n            padding: 12px 14px;\n            font-size: 12px;\n            color: #344054;\n            font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;\n            min-height: 90px;\n            outline: none;\n            resize: vertical;\n            width: 100%;\n            box-sizing: border-box;\n            transition: border-color .15s, box-shadow .15s;\n        }\n        .tm-settings-v2 .tm-editor-wrap .tm-editor-source:focus {\n            border-color: #4f8cff;\n            box-shadow: 0 0 0 3px rgba(79,140,255,.1);\n        }\n\n        /* Siatka podkategorii — przycisk pod polem edycji (aligned right) */\n        .tm-settings-v2 .tm-subcat-grid-btn {\n            display: inline-flex;\n            align-items: center;\n            gap: 5px;\n            margin: 8px 0 0 auto;\n            padding: 6px 12px;\n            border-radius: 8px;\n            border: 1px solid #d6e2ff;\n            background: #eef3ff;\n            color: #4f8cff;\n            font-size: 12px;\n            font-weight: 600;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            transition: all .15s;\n            float: right;\n        }\n        .tm-settings-v2 .tm-subcat-grid-btn:hover {\n            background: #dde7ff;\n            border-color: #b8cfff;\n        }\n        .tm-settings-v2 .tm-subcat-grid-icon {\n            font-size: 12px;\n        }\n        /* Clear float po przycisku siatki, żeby kolejny element nie wpadł obok */\n        .tm-settings-v2 .tm-editor-wrap::after {\n            content: '';\n            display: block;\n            clear: both;\n        }\n\n        /* Tryb Wizualny — TinyMCE overrides (inherit border z source) */\n        .tm-settings-v2 .tm-editor-wrap .mce-tinymce,\n        .tm-settings-v2 .tm-editor-wrap .tox-tinymce {\n            border: 1px solid #e0e3ea !important;\n            border-radius: 10px !important;\n            overflow: hidden;\n        }\n\n        /* ===== ETAP 3: FILTROWANIE ===== */\n\n        /* Filter Copy — bez inline paddingu, żeby ramka info była tak samo szeroka jak pozostałe */\n        .tm-settings-v2 .tm-filter-copy-inner {\n            padding: 0;\n        }\n\n        /* Hint bar z custom filter UI (tm-fe-hint-bar) — zestrój pod resztę sekcji */\n        .tm-settings-v2 .tm-fe-hint-bar {\n            margin: 10px 0 4px;\n            padding: 11px 14px;\n            border-radius: 9px;\n            font-size: 12px;\n            display: flex;\n            gap: 10px;\n            align-items: flex-start;\n            line-height: 1.5;\n            font-family: 'DM Sans', sans-serif;\n            border: 1px solid #d6e2ff;\n            background: #eef3ff;\n            color: #3b5998;\n        }\n        .tm-settings-v2 .tm-fe-hint-bar svg {\n            flex-shrink: 0;\n            stroke: #4f8cff;\n        }\n        .tm-settings-v2 .tm-fe-hint-bar b,\n        .tm-settings-v2 .tm-fe-hint-bar strong {\n            color: #3b5998;\n            font-weight: 700;\n        }\n\n        /* Filter source row (ID węzła + Podgląd) — padding boczny jak w kolumnach Niestandardowych */\n        .tm-settings-v2 .tm-filter-source-row {\n            display: flex;\n            align-items: center;\n            gap: 12px;\n            padding: 12px 16px;\n        }\n\n        /* Filter preview (wynik z węzła źródłowego) — też z bocznym paddingiem */\n        .tm-settings-v2 .tm-filter-copy-inner .tm-filter-preview {\n            margin: 4px 16px 10px;\n        }\n        .tm-settings-v2 .tm-filter-source-row > span {\n            font-size: 13px;\n            color: #344054;\n            font-family: 'DM Sans', sans-serif;\n        }\n        .tm-settings-v2 .tm-filter-source-input {\n            width: 120px;\n            padding: 8px 12px;\n            border-radius: 8px;\n            border: 1px solid #e0e3ea;\n            background: #f8f9fb;\n            font-size: 13px;\n            color: #1a1a2e;\n            font-family: 'DM Sans', sans-serif;\n            outline: none;\n            transition: border-color .2s;\n        }\n        .tm-settings-v2 .tm-filter-source-input:focus { border-color: #4f8cff; }\n\n        .tm-settings-v2 .tm-filter-preview-btn {\n            padding: 8px 18px;\n            border-radius: 8px;\n            border: none;\n            background: linear-gradient(135deg, #4f8cff, #3b6de0);\n            color: #fff;\n            font-size: 12.5px;\n            font-weight: 600;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            box-shadow: 0 2px 6px rgba(79,140,255,.3);\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-filter-preview-btn:hover {\n            box-shadow: 0 4px 10px rgba(79,140,255,.4);\n        }\n\n        /* Filter preview box (wynik z węzła źródłowego) */\n        .tm-settings-v2 .tm-filter-preview {\n            margin-top: 10px;\n            padding: 11px 14px;\n            border-radius: 9px;\n            background: #f8f9fb;\n            border: 1px solid #e8ebf0;\n            font-size: 12.5px;\n            color: #344054;\n            line-height: 1.6;\n            font-family: 'DM Sans', sans-serif;\n        }\n\n        /* Custom filter columns */\n        .tm-settings-v2 .tm-fe-filters-cols {\n            display: flex;\n            gap: 16px;\n            margin-top: 12px;\n        }\n        .tm-settings-v2 .tm-fe-filters-col {\n            flex: 1;\n            min-width: 0;\n        }\n        .tm-settings-v2 .tm-fe-filters-col-title {\n            font-size: 11px;\n            font-weight: 700;\n            text-transform: uppercase;\n            letter-spacing: 0.05em;\n            color: #667085;\n            padding: 0 0 8px;\n            font-family: 'DM Sans', sans-serif;\n        }\n        .tm-settings-v2 .tm-fe-filters-col-title--active { color: #4f8cff; }\n        .tm-settings-v2 .tm-fe-filters-list {\n            border: 1px solid #e8ebf0;\n            border-radius: 10px;\n            overflow-y: auto;\n            background: #fff;\n            max-height: 340px;\n        }\n        .tm-settings-v2 .tm-fe-filter-row {\n            display: flex;\n            align-items: center;\n            gap: 8px;\n            padding: 9px 12px;\n            border-bottom: 1px solid #f0f2f5;\n            font-size: 13px;\n            color: #344054;\n            font-family: 'DM Sans', sans-serif;\n        }\n        .tm-settings-v2 .tm-fe-filter-row:last-child { border-bottom: none; }\n        .tm-settings-v2 .tm-fe-filter-drag {\n            color: #d0d5dd;\n            cursor: grab;\n            flex-shrink: 0;\n            display: flex;\n            align-items: center;\n        }\n        .tm-settings-v2 .tm-fe-filter-drag svg {\n            width: 12px;\n            height: 12px;\n            fill: currentColor;\n        }\n        .tm-settings-v2 .tm-fe-filter-row-name {\n            flex: 1;\n            min-width: 0;\n            overflow: hidden;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n        }\n        .tm-settings-v2 .tm-fe-filter-badge {\n            font-size: 11px;\n            color: #98a2b3;\n            font-style: italic;\n        }\n        .tm-settings-v2 .tm-fe-filter-action {\n            width: 28px;\n            height: 28px;\n            border-radius: 6px;\n            border: 1px solid #e8ebf0;\n            background: #fafbfc;\n            cursor: pointer;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            flex-shrink: 0;\n            padding: 0;\n            color: #667085;\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-fe-filter-action svg {\n            width: 12px;\n            height: 12px;\n            fill: none;\n            stroke: currentColor;\n            stroke-width: 2;\n            stroke-linecap: round;\n            stroke-linejoin: round;\n        }\n        .tm-settings-v2 .tm-fe-filter-action--edit:hover {\n            border-color: #c0cfff;\n            color: #4f8cff;\n            background: #eef3ff;\n        }\n        .tm-settings-v2 .tm-fe-filter-action--remove {\n            border-color: #fde2e2;\n            background: #fef5f5;\n            color: #d32f2f;\n        }\n        .tm-settings-v2 .tm-fe-filter-action--add {\n            border-color: #d6e2ff;\n            background: #eef3ff;\n            color: #4f8cff;\n        }\n        .tm-settings-v2 .tm-fe-filters-list-empty {\n            padding: 14px;\n            text-align: center;\n            font-size: 12px;\n            color: #98a2b3;\n            font-family: 'DM Sans', sans-serif;\n        }\n\n        /* Pricestep inputs w custom filters */\n        .tm-settings-v2 .tm-fe-pricestep-row {\n            display: flex;\n            gap: 20px;\n            padding: 10px 0;\n        }\n        .tm-settings-v2 .tm-fe-pricestep-row .tm-fe-pricestep-field {\n            flex: 1;\n        }\n\n        /* ===== SEO modal specifics (seo-dialog.jsx) ===== */\n\n        /* Stacked field: label na górze + input/textarea pod spodem (cała szerokość) */\n        .tm-settings-v2 .tm-field-row--stacked {\n            display: block;\n            padding: 11px 0;\n            border-bottom: 1px solid #f0f2f5;\n        }\n        .tm-settings-v2 .tm-field-row--stacked > .tm-field-label {\n            display: block;\n            margin-bottom: 6px;\n            font-size: 13px;\n            color: #344054;\n            font-weight: 400;\n        }\n        .tm-settings-v2 .tm-field-row--stacked > .tm-input-wrap {\n            flex: none;\n            width: 100%;\n        }\n        .tm-settings-v2 .tm-field-row--stacked .tm-input-wrap .tm-node-text-input,\n        .tm-settings-v2 .tm-field-row--stacked .tm-input-wrap .tm-node-textarea {\n            padding: 9px 12px 9px 10px;\n        }\n\n        /* Textarea w SEO — minimalna wysokość */\n        .tm-settings-v2 .tm-input-wrap .tm-node-textarea {\n            min-height: 70px;\n            resize: vertical;\n            font-family: 'DM Sans', sans-serif;\n            font-size: 13px;\n            color: #1a1a2e;\n            padding: 10px 12px;\n            background: transparent;\n            border: none;\n            outline: none;\n            width: 100%;\n        }\n\n        /* ===== URL SEKCJA (seo-dialog.jsx) ===== */\n        /* Row z adresem URL — position relative dla dymka błędu */\n        .tm-settings-v2 .tm-seo-url-row {\n            position: relative;\n        }\n        /* Dymek błędu pod polem URL (validation tooltip) */\n        .tm-settings-v2 .tm-seo-url-row .tm-url-error {\n            position: absolute;\n            top: calc(100% - 6px);\n            right: 0;\n            margin: 0;\n            padding: 10px 14px;\n            max-width: 420px;\n            background: #fef2f2;\n            border: 1px solid #fecaca;\n            color: #b91c1c;\n            border-radius: 8px;\n            font-size: 12px;\n            line-height: 1.45;\n            font-family: 'DM Sans', sans-serif;\n            box-shadow: 0 4px 12px rgba(185,28,28,.12);\n            z-index: 10;\n        }\n        .tm-settings-v2 .tm-seo-url-row .tm-url-error::before {\n            content: '';\n            position: absolute;\n            top: -6px; right: 28px;\n            width: 0; height: 0;\n            border-left: 6px solid transparent;\n            border-right: 6px solid transparent;\n            border-bottom: 6px solid #fecaca;\n        }\n        .tm-settings-v2 .tm-seo-url-row .tm-url-error::after {\n            content: '';\n            position: absolute;\n            top: -5px; right: 29px;\n            width: 0; height: 0;\n            border-left: 5px solid transparent;\n            border-right: 5px solid transparent;\n            border-bottom: 5px solid #fef2f2;\n        }\n        /* Row z adresem URL — input + trash w jednym rounded wrapperze */\n        .tm-settings-v2 .tm-seo-url-input-wrap {\n            display: flex;\n            align-items: stretch;\n            flex: 0 0 420px;\n            width: 420px;\n            border: 1px solid #e0e3ea;\n            border-radius: 8px;\n            overflow: hidden;\n            background: #f8f9fb;\n            transition: border-color .2s;\n        }\n        .tm-settings-v2 .tm-seo-url-input-wrap:focus-within {\n            border-color: #4f8cff;\n        }\n        .tm-settings-v2 .tm-seo-url-input {\n            flex: 1;\n            padding: 8px 12px;\n            border: none;\n            background: transparent;\n            font-size: 13px;\n            color: #1a1a2e;\n            font-family: 'DM Sans', sans-serif;\n            outline: none;\n            min-width: 0;\n        }\n        .tm-settings-v2 .tm-seo-url-input::placeholder { color: #b0b8c9; }\n        .tm-settings-v2 .tm-seo-url-input:read-only { color: #667085; cursor: default; }\n        .tm-settings-v2 .tm-seo-url-trash {\n            padding: 0 12px;\n            border: none;\n            border-left: 1px solid #e0e3ea;\n            background: transparent;\n            color: #b0b8c9;\n            cursor: pointer;\n            display: flex;\n            align-items: center;\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-seo-url-trash .material-symbols-outlined {\n            font-size: 18px;\n            color: inherit;\n        }\n        .tm-settings-v2 .tm-seo-url-trash:hover:not(:disabled) {\n            color: #d32f2f;\n            background: #fef5f5;\n        }\n        .tm-settings-v2 .tm-seo-url-trash:disabled {\n            cursor: default;\n            opacity: 0.4;\n        }\n\n        /* Preview box — Oryginalny adres + Przyjazny adres */\n        .tm-settings-v2 .tm-seo-url-preview {\n            margin: 10px 0 4px;\n            padding: 10px 14px;\n            border-radius: 9px;\n            background: #f8f9fb;\n            border: 1px solid #e8ebf0;\n        }\n        .tm-settings-v2 .tm-seo-url-preview-line {\n            display: flex;\n            align-items: center;\n            gap: 6px;\n            font-size: 12.5px;\n            color: #344054;\n            font-family: 'DM Sans', sans-serif;\n            line-height: 1.6;\n            min-width: 0;\n        }\n        .tm-settings-v2 .tm-seo-url-preview-line + .tm-seo-url-preview-line {\n            margin-top: 2px;\n        }\n        .tm-settings-v2 .tm-seo-url-preview-line strong {\n            flex-shrink: 0;\n            font-weight: 700;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-seo-url-preview-line a {\n            color: #4f8cff;\n            text-decoration: none;\n            overflow: hidden;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n            min-width: 0;\n        }\n        .tm-settings-v2 .tm-seo-url-preview-line a:hover {\n            text-decoration: underline;\n        }\n        .tm-settings-v2 .tm-seo-url-placeholder {\n            color: #b0b8c9;\n            font-style: italic;\n            overflow: hidden;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n            min-width: 0;\n        }\n        .tm-settings-v2 .tm-seo-url-placeholder em {\n            font-style: italic;\n        }\n        .tm-settings-v2 .tm-seo-url-placeholder-empty {\n            color: #b0b8c9;\n            font-style: italic;\n        }\n\n        /* ===== POWIĄZANIA MENU SKLEPÓW ===== */\n        .tm-settings-v2 #tm-menu-mappings-list {\n            margin-top: 4px;\n        }\n        .tm-settings-v2 .tm-menu-mapping-row {\n            display: flex;\n            align-items: center;\n            gap: 8px;\n            padding: 8px 0;\n            border-bottom: 1px solid #f0f2f5;\n        }\n        .tm-settings-v2 .tm-menu-mapping-row:last-of-type { border-bottom: none; }\n        .tm-settings-v2 .tm-menu-mapping-shop {\n            flex: 0 0 260px;\n            max-width: 260px;\n            padding: 7px 30px 7px 10px;\n            border-radius: 6px;\n            border: 1px solid #e0e3ea;\n            background: #f8f9fb;\n            font-size: 13px;\n            color: #1a1a2e;\n            font-family: 'DM Sans', sans-serif;\n            outline: none;\n            cursor: pointer;\n            transition: border-color .2s;\n            -webkit-appearance: none;\n            -moz-appearance: none;\n            appearance: none;\n            background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' fill='none' stroke='%2398a2b3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\");\n            background-repeat: no-repeat;\n            background-position: right 10px center;\n        }\n        .tm-settings-v2 .tm-menu-mapping-shop:focus { border-color: #4f8cff; }\n        .tm-settings-v2 .tm-menu-mapping-ac {\n            position: relative;\n            width: 220px;\n            flex-shrink: 0;\n        }\n        .tm-settings-v2 .tm-menu-mapping-id {\n            width: 100%;\n            padding: 7px 10px;\n            border-radius: 6px;\n            border: 1px solid #e0e3ea;\n            background: #fff;\n            font-size: 13px;\n            color: #1a1a2e;\n            font-family: 'DM Sans', sans-serif;\n            outline: none;\n            transition: border-color .2s;\n            box-sizing: border-box;\n        }\n        .tm-settings-v2 .tm-menu-mapping-id:focus { border-color: #4f8cff; }\n        .tm-settings-v2 .tm-menu-mapping-ac-dropdown {\n            position: fixed;\n            min-width: 320px;\n            background: #fff;\n            border: 1px solid #e0e3ea;\n            border-radius: 8px;\n            box-shadow: 0 4px 16px rgba(0,0,0,.18);\n            z-index: 250000;\n            max-height: 260px;\n            overflow-y: auto;\n        }\n        .tm-settings-v2 .tm-menu-mapping-ac-item {\n            display: flex;\n            align-items: center;\n            gap: 10px;\n            padding: 8px 12px;\n            cursor: pointer;\n            font-size: 12.5px;\n            font-family: 'DM Sans', sans-serif;\n            border-bottom: 1px solid #f0f2f5;\n        }\n        .tm-settings-v2 .tm-menu-mapping-ac-item:last-child { border-bottom: none; }\n        .tm-settings-v2 .tm-menu-mapping-ac-item:hover {\n            background: #f5f8ff;\n        }\n        .tm-settings-v2 .tm-menu-mapping-ac-id {\n            flex-shrink: 0;\n            font-family: 'JetBrains Mono', 'Fira Code', monospace;\n            font-size: 11.5px;\n            color: #4f8cff;\n            font-weight: 600;\n            background: #eef3ff;\n            padding: 2px 8px;\n            border-radius: 10px;\n            min-width: 50px;\n            text-align: center;\n        }\n        .tm-settings-v2 .tm-menu-mapping-ac-path {\n            flex: 1;\n            min-width: 0;\n            color: #344054;\n            overflow: hidden;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n        }\n        .tm-settings-v2 .tm-menu-mapping-ac-info {\n            padding: 10px 12px;\n            font-size: 12.5px;\n            color: #98a2b3;\n            font-style: italic;\n            text-align: center;\n            font-family: 'DM Sans', sans-serif;\n        }\n        .tm-settings-v2 .tm-menu-mapping-name {\n            flex: 1;\n            min-width: 0;\n            font-size: 12.5px;\n            color: #667085;\n            font-style: italic;\n            overflow: hidden;\n            text-overflow: ellipsis;\n            white-space: nowrap;\n        }\n        .tm-settings-v2 .tm-menu-mapping-del {\n            width: 28px; height: 28px;\n            border-radius: 6px;\n            border: 1px solid #fde2e2;\n            background: #fef5f5;\n            color: #d32f2f;\n            cursor: pointer;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            flex-shrink: 0;\n            padding: 0;\n            transition: background .15s;\n        }\n        .tm-settings-v2 .tm-menu-mapping-del:hover { background: #fcdcdc; }\n        .tm-settings-v2 .tm-menu-mapping-del .material-symbols-outlined {\n            font-size: 16px;\n            color: inherit;\n        }\n        .tm-settings-v2 .tm-menu-mapping-add-btn {\n            display: inline-flex;\n            align-items: center;\n            gap: 6px;\n            margin-top: 10px;\n            padding: 7px 14px;\n            border: 1px dashed #c0cfff;\n            background: #f5f8ff;\n            color: #4f8cff;\n            font-size: 12.5px;\n            font-weight: 600;\n            border-radius: 8px;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-menu-mapping-add-btn:hover {\n            background: #eef3ff;\n            border-color: #4f8cff;\n        }\n        .tm-settings-v2 .tm-menu-mapping-add-btn .material-symbols-outlined {\n            font-size: 16px;\n        }\n\n        /* ===== PRZEKIEROWANIA (seo-dialog2.jsx) ===== */\n        .tm-settings-v2 #tm-seo-redirects-list {\n            padding: 8px 0 6px !important;\n            color: inherit !important;\n            font-size: inherit !important;\n        }\n        .tm-settings-v2 .tm-redirects-empty {\n            padding: 18px 0 14px;\n            text-align: center;\n            font-size: 13px;\n            color: #98a2b3;\n            font-family: 'DM Sans', sans-serif;\n        }\n\n        /* Inline form dodawania przekierowania (zamiast prompt) */\n        .tm-settings-v2 .tm-redirect-add-form {\n            padding: 10px 12px;\n            border: 1px dashed #c0cfff;\n            background: #f5f8ff;\n            border-radius: 8px;\n            margin-bottom: 10px;\n        }\n        .tm-settings-v2 .tm-redirect-add-row {\n            display: flex;\n            align-items: center;\n            gap: 8px;\n        }\n        .tm-settings-v2 .tm-redirect-add-input {\n            flex: 1;\n            min-width: 0;\n            padding: 7px 12px;\n            border-radius: 6px;\n            border: 1px solid #e0e3ea;\n            background: #fff;\n            font-size: 13px;\n            color: #1a1a2e;\n            font-family: 'DM Sans', sans-serif;\n            outline: none;\n            transition: border-color .15s, box-shadow .15s;\n        }\n        .tm-settings-v2 .tm-redirect-add-input:focus {\n            border-color: #4f8cff;\n            box-shadow: 0 0 0 3px rgba(79,140,255,.1);\n        }\n        .tm-settings-v2 .tm-redirect-add-input--error {\n            border-color: #d32f2f;\n        }\n        .tm-settings-v2 .tm-redirect-add-input--error:focus {\n            box-shadow: 0 0 0 3px rgba(211,47,47,.12);\n        }\n        .tm-settings-v2 .tm-redirect-add-submit {\n            display: inline-flex;\n            align-items: center;\n            gap: 5px;\n            padding: 7px 14px;\n            border-radius: 8px;\n            border: none;\n            background: linear-gradient(135deg, #4f8cff, #3b6de0);\n            color: #fff;\n            font-size: 12.5px;\n            font-weight: 600;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            box-shadow: 0 1px 3px rgba(79,140,255,.3);\n            flex-shrink: 0;\n        }\n        .tm-settings-v2 .tm-redirect-add-submit:hover:not(:disabled) {\n            box-shadow: 0 2px 6px rgba(79,140,255,.4);\n        }\n        .tm-settings-v2 .tm-redirect-add-submit:disabled {\n            opacity: .7; cursor: wait;\n        }\n        .tm-settings-v2 .tm-redirect-add-cancel {\n            width: 32px; height: 32px;\n            border-radius: 8px;\n            border: 1px solid #e0e3ea;\n            background: #fff;\n            color: #667085;\n            font-size: 14px;\n            cursor: pointer;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            font-family: 'DM Sans', sans-serif;\n            flex-shrink: 0;\n            padding: 0;\n        }\n        .tm-settings-v2 .tm-redirect-add-cancel:hover {\n            background: #f0f2f5;\n            color: #344054;\n            border-color: #b0b7c3;\n        }\n        .tm-settings-v2 .tm-redirect-add-error {\n            margin-top: 8px;\n            padding: 10px 14px;\n            background: #fef2f2;\n            border: 1px solid #fecaca;\n            color: #b91c1c;\n            border-radius: 8px;\n            font-size: 12px;\n            line-height: 1.45;\n            font-family: 'DM Sans', sans-serif;\n        }\n        .tm-settings-v2 .tm-redirect-add-error a {\n            color: #4f8cff;\n            text-decoration: underline;\n        }\n\n        /* Przycisk \"Dodaj przekierowanie\" (dashed) */\n        .tm-settings-v2 .tm-redirect-add-btn {\n            display: flex;\n            align-items: center;\n            gap: 6px;\n            padding: 7px 14px;\n            border-radius: 8px;\n            border: 1px dashed #c0cfff;\n            background: #f5f8ff;\n            color: #4f8cff;\n            font-size: 12.5px;\n            font-weight: 600;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            margin-bottom: 10px;\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-redirect-add-btn:hover {\n            background: #eef3ff;\n            border-color: #4f8cff;\n        }\n        .tm-settings-v2 .tm-redirect-add-btn:disabled {\n            opacity: .6;\n            cursor: wait;\n        }\n\n        /* Lista w rounded containerze */\n        .tm-settings-v2 .tm-redirects-list {\n            border: 1px solid #e8ebf0;\n            border-radius: 10px;\n            overflow: hidden;\n            background: #fff;\n        }\n\n        /* Row */\n        .tm-settings-v2 .tm-redirect-row {\n            display: flex;\n            align-items: center;\n            gap: 10px;\n            padding: 10px 14px;\n            border-bottom: 1px solid #f0f2f5;\n            background: transparent;\n            transition: background .15s;\n            font-family: 'DM Sans', sans-serif;\n            font-size: 13px;\n            color: #344054;\n        }\n        .tm-settings-v2 .tm-redirect-row:last-child { border-bottom: none; }\n        .tm-settings-v2 .tm-redirect-row--selected {\n            background: #f5f8ff;\n        }\n\n        /* Checkbox */\n        .tm-settings-v2 .tm-redirect-cb {\n            accent-color: #4f8cff;\n            width: 15px;\n            height: 15px;\n            cursor: pointer;\n            flex-shrink: 0;\n            margin: 0;\n        }\n\n        /* Fields container (from / arrow / to) */\n        .tm-settings-v2 .tm-redirect-fields {\n            display: flex;\n            align-items: center;\n            gap: 8px;\n            flex: 1;\n            min-width: 0;\n        }\n        /* Chip — kapsułka monospace z bg */\n        .tm-settings-v2 .tm-redirect-chip {\n            padding: 4px 10px;\n            border-radius: 6px;\n            background: #f4f5f7;\n            font-size: 12.5px;\n            color: #344054;\n            font-family: 'JetBrains Mono', 'Fira Code', monospace;\n            white-space: nowrap;\n            overflow: hidden;\n            text-overflow: ellipsis;\n            min-width: 80px;\n            max-width: 220px;\n        }\n        /* Input w trybie edit (styl taki sam jak chip ale z borderem) */\n        .tm-settings-v2 .tm-redirect-input {\n            flex: 1;\n            padding: 6px 10px;\n            border-radius: 6px;\n            border: 1px solid #e0e3ea;\n            background: #fff;\n            font-size: 12.5px;\n            color: #1a1a2e;\n            font-family: 'DM Sans', sans-serif;\n            outline: none;\n            min-width: 0;\n            transition: border-color .15s;\n        }\n        .tm-settings-v2 .tm-redirect-input:focus { border-color: #4f8cff; }\n\n        /* Arrow → */\n        .tm-settings-v2 .tm-redirect-arrow {\n            color: #98a2b3;\n            display: flex;\n            align-items: center;\n            flex-shrink: 0;\n        }\n\n        /* Data utworzenia (clock + date) */\n        .tm-settings-v2 .tm-redirect-date {\n            display: flex;\n            align-items: center;\n            gap: 4px;\n            font-size: 11.5px;\n            color: #98a2b3;\n            font-family: 'DM Sans', sans-serif;\n            flex-shrink: 0;\n            white-space: nowrap;\n        }\n        .tm-settings-v2 .tm-redirect-date svg {\n            opacity: .7;\n            flex-shrink: 0;\n        }\n        .tm-settings-v2 .tm-redirect-date--none {\n            width: 0;\n        }\n\n        /* Przyciski edit / delete / save */\n        .tm-settings-v2 .tm-redirect-btn {\n            width: 28px;\n            height: 28px;\n            border-radius: 6px;\n            background: #fafbfc;\n            border: 1px solid #e8ebf0;\n            cursor: pointer;\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            color: #667085;\n            font-family: 'DM Sans', sans-serif;\n            font-size: 12px;\n            flex-shrink: 0;\n            padding: 0;\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-redirect-btn--edit.tm-redirect-btn--editing {\n            background: #eef3ff;\n            border-color: #c0cfff;\n            color: #4f8cff;\n        }\n        .tm-settings-v2 .tm-redirect-btn--del {\n            border-color: #fde2e2;\n            background: #fef5f5;\n            color: #d32f2f;\n        }\n        .tm-settings-v2 .tm-redirect-btn--del:hover {\n            background: #fcdcdc;\n        }\n        .tm-settings-v2 .tm-redirect-btn--del .material-symbols-outlined {\n            font-size: 16px;\n            color: inherit;\n        }\n        .tm-settings-v2 .tm-redirect-btn svg {\n            fill: none;\n            stroke: currentColor;\n        }\n\n        /* Toolbar (pod listą) */\n        .tm-settings-v2 .tm-redirects-toolbar {\n            display: flex;\n            align-items: center;\n            justify-content: space-between;\n            margin-top: 10px;\n            gap: 8px;\n            flex-wrap: wrap;\n        }\n        .tm-settings-v2 .tm-redirects-toolbar-left,\n        .tm-settings-v2 .tm-redirects-toolbar-right {\n            display: flex;\n            gap: 8px;\n        }\n        .tm-settings-v2 .tm-redirects-tb-btn {\n            display: inline-flex;\n            align-items: center;\n            gap: 6px;\n            padding: 7px 14px;\n            border-radius: 8px;\n            border: 1px solid #d0d5dd;\n            background: #fff;\n            color: #344054;\n            font-size: 12.5px;\n            font-weight: 500;\n            cursor: pointer;\n            font-family: 'DM Sans', sans-serif;\n            transition: all .15s;\n        }\n        .tm-settings-v2 .tm-redirects-tb-btn:hover {\n            background: #f8f9fb;\n            border-color: #b0b7c3;\n        }\n        .tm-settings-v2 .tm-redirects-tb-btn--danger {\n            border-color: #fde2e2;\n            color: #d32f2f;\n        }\n        .tm-settings-v2 .tm-redirects-tb-btn--danger:hover {\n            background: #fef5f5;\n        }\n        .tm-settings-v2 .tm-redirects-tb-btn--disabled,\n        .tm-settings-v2 .tm-redirects-tb-btn:disabled {\n            border-color: #e8ebf0;\n            color: #b0b8c9;\n            cursor: not-allowed;\n            background: #fff;\n        }\n        .tm-settings-v2 .tm-redirects-tb-btn--disabled:hover,\n        .tm-settings-v2 .tm-redirects-tb-btn:disabled:hover {\n            background: #fff;\n            border-color: #e8ebf0;\n        }\n\n        /* Redirects list */\n        .tm-settings-v2 #tm-seo-redirects-list {\n            font-family: 'DM Sans', sans-serif;\n            padding: 8px 0 !important;\n            color: #98a2b3 !important;\n        }\n        .tm-settings-v2 #tm-seo-redirects-list:empty::before {\n            content: 'Brak przekierowań';\n            display: block;\n            padding: 18px 0 14px;\n            text-align: center;\n            font-size: 13px;\n            color: #98a2b3;\n        }\n    \n\n/* === v4.6.35 override: wygraj z ACE theme panelu (1:1 wartości z Menu) === */\n.tm-settings-v2 .tm-input-wrap{display:flex!important;align-items:center!important;box-sizing:border-box!important;background:#f8f9fb!important;border:1px solid #e0e3ea!important;border-radius:8px!important;flex:0 0 420px!important;width:420px!important;}\n.tm-settings-v2 .tm-field-row--stacked>.tm-input-wrap{flex:none!important;width:100%!important;}\n.tm-settings-v2 .tm-input-wrap>select.tm-field-select,\n.tm-settings-v2 .tm-input-wrap>input.tm-node-text-input,\n.tm-settings-v2 .tm-input-wrap>input.tm-seo-url-input,\n.tm-settings-v2 .tm-input-wrap>textarea.tm-node-textarea{flex:1 1 auto!important;width:100%!important;min-width:0!important;border:0!important;outline:0!important;background:transparent!important;box-shadow:none!important;margin:0!important;color:#1a1a2e!important;font:13px/1.4 'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif!important;-webkit-appearance:none!important;-moz-appearance:none!important;appearance:none!important;height:auto!important;}\n.tm-settings-v2 .tm-input-wrap>select.tm-field-select{padding:8px 30px 8px 10px!important;min-height:36px!important;cursor:pointer!important;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' fill='none' stroke='%2398a2b3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")!important;background-repeat:no-repeat!important;background-position:right 10px center!important;}\n.tm-settings-v2 .tm-input-wrap>input.tm-node-text-input,\n.tm-settings-v2 .tm-input-wrap>input.tm-seo-url-input{padding:8px 10px!important;min-height:36px!important;}\n.tm-settings-v2 .tm-field-row--stacked .tm-input-wrap>input.tm-node-text-input,\n.tm-settings-v2 .tm-field-row--stacked .tm-input-wrap>textarea.tm-node-textarea{padding:9px 12px 9px 10px!important;}\n.tm-settings-v2 .tm-input-wrap>textarea.tm-node-textarea{min-height:70px!important;resize:vertical!important;display:block!important;}\n.tm-settings-v2 .tm-input-wrap .tm-input-icon{font-size:14px!important;color:#98a2b3!important;opacity:.7!important;padding:0 0 0 10px!important;flex-shrink:0!important;}\n.tm-settings-v2 .tm-input-wrap .tm-seo-url-trash{flex:0 0 auto!important;background:transparent!important;border:0!important;box-shadow:none!important;}\n.tm-settings-v2 .tm-modal-content select,.tm-settings-v2 .tm-modal-content input,.tm-settings-v2 .tm-modal-content textarea{box-sizing:border-box!important;}\n\n\n/* === v4.6.36: etykiety/teksty zaznaczalne (w Menu były klikalne — u nas nie) === */\n.tm-settings-v2 .tm-field-label,\n.tm-settings-v2 .tm-section-header,\n.tm-settings-v2 .tm-settings-header-title,\n.tm-settings-v2 .tm-settings-header-subtitle,\n.tm-settings-v2 .tm-seo-url-preview,\n.tm-settings-v2 .tm-seo-url-preview strong,\n.tm-settings-v2 .tm-redirects-empty{cursor:text!important;user-select:text!important;-webkit-user-select:text!important;-moz-user-select:text!important;}\n.tm-settings-v2 .tm-modal-body, .tm-settings-v2 .tm-modal-body *{ -webkit-user-select:auto; }\n.tm-settings-v2 .tm-seo-url-preview a{cursor:pointer!important;}\n\n\n/* === v4.6.37: wyłączony select (Tryb adresu URL) — bez strzałki rozwijania === */\n.tm-settings-v2 .tm-input-wrap>select.tm-field-select:disabled{background-image:none!important;padding-right:10px!important;cursor:default!important;color:#475467!important;opacity:1!important;}\n\n\n/* === v4.6.38: footer przyciski do prawej + przycisk kopiowania URL === */\n.tm-settings-v2 .tm-modal-footer{justify-content:flex-end!important;}\n.tm-settings-v2 .tm-modal-footer .tm-footer-right{margin-left:auto!important;display:flex!important;gap:10px!important;}\n.tm-settings-v2 .tm-seo-url-trash.tp-seo-url-copy{color:#7b8794!important;cursor:pointer!important;opacity:1!important;}\n.tm-settings-v2 .tm-seo-url-trash.tp-seo-url-copy:hover{color:#1a73e8!important;background:#eef4ff!important;}\n\n\n/* === v4.6.40: skeleton + brak przeskoków przy zmianie sklepu/języka === */\n.tm-settings-v2 .tp-skl{display:inline-block;background:#e9edf2;border-radius:6px;position:relative;overflow:hidden;vertical-align:middle;}\n.tm-settings-v2 .tp-skl::after{content:\"\";position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);transform:translateX(-100%);animation:tmShimmer 1.2s infinite;}\n.tm-settings-v2 .tm-modal-body.tp-seo-busy{opacity:.55;pointer-events:none;transition:opacity .12s;}\n.tm-settings-v2 .tm-modal-body{transition:opacity .12s;}\n\n\n/* === v4.6.48: odstęp przycisku „Dodaj przekierowanie\" od nagłówka (jak w Menu) === */\n.tm-settings-v2 #tp-seo-redirects{padding-top:8px!important;}\n.tm-settings-v2 #tp-seo-redirects .tm-redirect-add-btn{margin-top:2px!important;}\n";
  function ensureSeoV2Css(dd) {
    try {
      var docs = [];
      if (dd) docs.push(dd);
      if (typeof document !== 'undefined' && docs.indexOf(document) < 0) docs.push(document);
      try { var idoc = (typeof getIframeDoc === 'function') ? getIframeDoc() : null; if (idoc && docs.indexOf(idoc) < 0) docs.push(idoc); } catch (e) {}
      docs.forEach(function (D) {
        if (!D || D.getElementById('tp-seo-v2-css')) return;
        var st = D.createElement('style'); st.id = 'tp-seo-v2-css'; st.textContent = TP_SEO_V2_CSS;
        (D.head || D.documentElement).appendChild(st);
      });
    } catch (e) {}
  }

  // v4.6.34: osobny modal SEO dla WARTOŚCI — markup/CSS 1:1 z Menu (tm-settings-v2).
  // API navigation.php (tree=parameters, parent=0) zweryfikowane. Wartości nie mają
  // własnego URL/redirects (Adres URL read-only, Przekierowania = szkielet).
  function showValueSeoModal(doc, nodeId) {
    var d = doc || document;
    ensureSeoV2Css(d);
    if (_panel && _panel.showStatus) _panel.showStatus('Wczytywanie SEO…');
    function navPost(b) { return fetchAjaxRaw('/panel/ajax/parameters.php', b); }
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

    fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(nodeId)).then(function (resp) {
      var dt = resp && resp.data ? resp.data : null;
      if (!dt || !dt.langData) { alert('Nie udało się wczytać danych elementu'); return; }
      var order = ['pol', 'eng', 'ger', 'fra', 'ces', 'ukr', 'ita', 'esp', 'rus', 'lit', 'lav', 'est', 'nld', 'hun', 'swe', 'slk', 'slv', 'bul', 'hrv', 'rum', 'por', 'dan', 'fin', 'nor'];
      var langs = Object.keys(dt.langData).sort(function (a, b) { var ia = order.indexOf(a), ib = order.indexOf(b); if (ia < 0) ia = 999; if (ib < 0) ib = 999; return (ia - ib) || a.localeCompare(b); });
      var curLang = (langs.indexOf(LANG) >= 0 ? LANG : (langs.indexOf('pol') >= 0 ? 'pol' : langs[0]));
      var elName = (dt.langData[LANG] && dt.langData[LANG].name) || (dt.langData[curLang] && dt.langData[curLang].name) || ('ID ' + nodeId);
      var ss = {};
      langs.forEach(function (lg) { var L = dt.langData[lg] || {}; ['icon_search_type', 'icon_projector_type', 'display_mode', 'icon_search', 'icon_projector'].forEach(function (k) { if (L[k] && typeof L[k] === 'object') Object.keys(L[k]).forEach(function (s) { if (/^\d+$/.test(s)) ss[s] = true; }); }); });
      var shops = Object.keys(ss).sort(function (a, b) { return (+a) - (+b); });
      if (!shops.length) shops = ['1', '2', '3', '4', '5', '6', '7'];
      var curShop = shops[0];
      // domeny sklepów z IAI.shops_list (jak w grafikach) — zamiast „Sklep N"
      var _shopNames = {};
      try {
        var _GW = (typeof getIframeWin === 'function') ? getIframeWin() : window;
        var _sl = _GW && _GW.IAI && _GW.IAI.shops_list;
        if (_sl && _sl.length) for (var _i = 0; _i < _sl.length; _i++) if (_sl[_i]) _shopNames[String(_sl[_i].id)] = _sl[_i].name || '';
      } catch (e) {}
      function shopLabel(s) { return _shopNames[String(s)] || ('Sklep ' + s); }

      var overlay = d.createElement('div');
      overlay.className = 'tm-node-modal-overlay tm-overlay tm-settings-v2';
      var modal = d.createElement('div');
      modal.className = 'tm-modal-content';

      function subtitleHtml() {
        var hl = 'font-weight:700;color:#5f5f5f;';
        return 'ID: <span class="tp-seo-copyid" title="Kliknij, aby skopiować ID" style="cursor:pointer;' + hl + '">' + esc(nodeId) + '</span>' +
          ' · wartość parametru „' + esc(elName) + '"' +
          ' · Sklep: <span style="' + hl + '">' + esc(shopLabel(curShop)) + '</span>' +
          ' · Język: <span style="' + hl + '">' + esc(getLangName(curLang)) + '</span>';
      }
      var header = d.createElement('div');
      header.className = 'tm-modal-header';
      header.innerHTML =
        '<div class="tm-settings-header-left">' +
          '<div class="tm-settings-header-icon"><span class="material-symbols-outlined">search</span></div>' +
          '<div class="tm-settings-header-text">' +
            '<div class="tm-settings-header-title">SEO — ' + esc(elName) + '</div>' +
            '<div class="tm-settings-header-subtitle" id="tp-seo-sub">' + subtitleHtml() + '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="tm-settings-close" aria-label="Zamknij"><span class="material-symbols-outlined">close</span></button>';
      modal.appendChild(header);
      function refreshSubtitle() { var _s = header.querySelector('#tp-seo-sub'); if (_s) _s.innerHTML = subtitleHtml(); }
      header.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== header && !(t.classList && t.classList.contains('tp-seo-copyid'))) t = t.parentNode;
        if (!t || t === header) return;
        ev.preventDefault(); ev.stopPropagation();
        var txt = String(nodeId);
        function done() {
          if (_panel) _panel.showStatus('Skopiowano ID: ' + txt);
        }
        function fb() {
          try {
            var ta = d.createElement('textarea'); ta.value = txt;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
            d.body.appendChild(ta); ta.focus(); ta.select();
            d.execCommand('copy'); d.body.removeChild(ta); done();
          } catch (e2) { alert('Nie udało się skopiować ID: ' + (e2.message || e2)); }
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fb);
          else fb();
        } catch (e) { fb(); }
      });

      var bodyEl = d.createElement('div');
      bodyEl.className = 'tm-modal-body';
      modal.appendChild(bodyEl);

      function ic(name) { return name ? ('<span class="material-symbols-outlined tm-input-icon">' + name + '</span>') : ''; }
      function makeSelect(name, options, selected, icon, disabled) {
        var opts = '';
        for (var i = 0; i < options.length; i++) { var v = options[i][0], lab = options[i][1]; opts += '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(lab) + '</option>'; }
        return '<div class="tm-input-wrap">' + ic(icon) + '<select class="tm-field-select" name="' + name + '"' + (disabled ? ' disabled' : '') + '>' + opts + '</select></div>';
      }
      function makeInput(name, value, icon, opts) {
        opts = opts || {};
        return '<div class="tm-input-wrap">' + ic(icon) + '<input class="tm-node-text-input" name="' + name + '" value="' + esc(value) + '"' + (opts.readonly ? ' readonly' : '') + (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '></div>';
      }
      function makeTextarea(name, value, icon, opts) {
        opts = opts || {};
        return '<div class="tm-input-wrap">' + (icon ? '<span class="material-symbols-outlined tm-input-icon" style="align-self:flex-start;margin-top:8px">' + icon + '</span>' : '') + '<textarea class="tm-node-textarea" name="' + name + '" rows="' + (opts.rows || 3) + '">' + esc(value) + '</textarea></div>';
      }
      var ICON_PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';

      function sectionsHtml(dnode) {
        var seo = (dnode.seolink && dnode.seolink[0]) || '';
        var slug = seo; try { slug = new URL(seo).pathname; } catch (e) {}
        var metaDefault = (dnode.meta_title || dnode.meta_description || dnode.meta_keywords) ? 'n' : 'y';
        var ctxCard =
          '<div class="tm-section-card tm-section-card--seo">' +
            '<div class="tm-section-header"><span class="material-symbols-outlined">storefront</span>Sklep i język</div>' +
            '<div class="tm-section-body">' +
              '<div class="tm-field-row"><span class="tm-field-label">Sklep</span>' +
                makeSelect('tp_shop', shops.map(function (s) { return [s, shopLabel(s)]; }), curShop, 'storefront') + '</div>' +
              '<div class="tm-field-row"><span class="tm-field-label">Język</span>' +
                makeSelect('tp_lang', langs.map(function (lg) { return [lg, getLangName(lg)]; }), curLang, 'translate') + '</div>' +
            '</div>' +
          '</div>';
        var metaCard =
          '<div class="tm-section-card tm-section-card--seo">' +
            '<div class="tm-section-header"><span class="material-symbols-outlined">code</span>Meta tagi</div>' +
            '<div class="tm-section-body">' +
              '<div class="tm-field-row"><span class="tm-field-label">Ustawienia meta</span>' +
                makeSelect('meta_default', [['y', 'Wygeneruj automatycznie'], ['n', 'Użyj podanych poniżej']], metaDefault, 'tune') + '</div>' +
              '<div class="tm-meta-fields"' + (metaDefault === 'n' ? '' : ' style="display:none"') + '>' +
                '<div class="tm-field-row tm-field-row--stacked"><span class="tm-field-label">Meta title</span>' + makeInput('meta_title', dnode.meta_title, 'title') + '</div>' +
                '<div class="tm-field-row tm-field-row--stacked"><span class="tm-field-label">Meta description</span>' + makeTextarea('meta_description', dnode.meta_description, 'description') + '</div>' +
                '<div class="tm-field-row tm-field-row--stacked"><span class="tm-field-label">Meta keywords</span>' + makeInput('meta_keywords', dnode.meta_keywords, 'sell') + '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
        var robotsCard =
          '<div class="tm-section-card tm-section-card--seo">' +
            '<div class="tm-section-header"><span class="material-symbols-outlined">smart_toy</span>Robots</div>' +
            '<div class="tm-section-body">' +
              '<div class="tm-field-row"><span class="tm-field-label">Meta robots index</span>' +
                makeSelect('meta_index', [['default', 'Automatycznie (domyślne)'], ['index', 'index'], ['noindex', 'noindex']], dnode.meta_robots_index || 'default', 'visibility') + '</div>' +
              '<div class="tm-field-row"><span class="tm-field-label">Meta robots follow</span>' +
                makeSelect('meta_follow', [['default', 'Automatycznie (domyślne)'], ['follow', 'follow'], ['nofollow', 'nofollow']], dnode.meta_robots_follow || 'default', 'share') + '</div>' +
            '</div>' +
          '</div>';
        var urlCard =
          '<div class="tm-section-card tm-section-card--seo">' +
            '<div class="tm-section-header"><span class="material-symbols-outlined">link</span>Adres URL</div>' +
            '<div class="tm-section-body">' +
              '<div class="tm-field-row"><span class="tm-field-label">Tryb adresu URL</span>' +
                makeSelect('tp_urlmode', [['auto', 'Automatyczny']], 'auto', 'tune', true) + '</div>' +
              '<div class="tm-field-row tm-seo-url-row"><span class="tm-field-label">Adres URL</span>' +
                '<div class="tm-seo-url-input-wrap">' +
                  '<input class="tm-seo-url-input" name="tp_url" value="' + esc(slug) + '" readonly>' +
                  '<button type="button" class="tm-seo-url-trash tp-seo-url-copy" title="Kopiuj adres"><span class="material-symbols-outlined">content_copy</span></button>' +
                '</div>' +
              '</div>' +
              '<div class="tm-seo-url-preview"><div class="tm-seo-url-preview-line"><strong>Oryginalny adres:</strong> ' +
                (seo ? '<a href="' + esc(seo) + '" target="_blank" rel="noopener noreferrer">' + esc(seo) + '</a>' : '<span class="tm-seo-url-placeholder-empty">(brak)</span>') +
              '</div></div>' +
            '</div>' +
          '</div>';
        var redirCard =
          '<div class="tm-section-card tm-section-card--seo">' +
            '<div class="tm-section-header"><span class="material-symbols-outlined">redo</span>Przekierowania</div>' +
            '<div class="tm-section-body">' +
              '<div id="tp-seo-redirects"><div class="tm-redirects-empty tm-redirects-loading">Ładowanie…</div></div>' +
            '</div>' +
          '</div>';
        return ctxCard + metaCard + robotsCard + urlCard + redirCard;
      }

      var footer = d.createElement('div');
      footer.className = 'tm-modal-footer';
      footer.innerHTML = '<div class="tm-footer-right"><button type="button" class="tm-btn-cancel">Anuluj</button><button type="button" class="tm-btn-save">Zapisz</button></div>';
      modal.appendChild(footer);
      overlay.appendChild(modal);
      d.body.appendChild(overlay);

      var saveBtn = footer.querySelector('.tm-btn-save');
      var cancelBtn = footer.querySelector('.tm-btn-cancel');
      function close() { overlay.classList.add('tm-closing'); setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 200); }
      header.querySelector('.tm-settings-close').addEventListener('click', close);
      cancelBtn.addEventListener('click', close);

      var loaded = null;
      var ICON_ARROW = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
      function redirGate() { return '/panel/config-system-services.php?shop=' + encodeURIComponent(curShop) + '&action=redirects'; }
      function redirValuePath() {
        var s = (loaded && loaded.seolink && loaded.seolink[0]) || '';
        try { return new URL(s).pathname; } catch (e) { return (s && s.charAt(0) === '/') ? s : ''; }
      }
      function rPost(b) {
        return fetch(redirGate(), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: b }).then(function (r) { return r.text(); });
      }
      function rParseList(html) {
        var map = {};
        html.replace(/span_uri_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (map[id] = map[id] || {}).uri = v.replace(/<[^>]*>/g, '').trim(); });
        html.replace(/span_dest_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (map[id] = map[id] || {}).dest = v.replace(/<[^>]*>/g, '').trim(); });
        html.replace(/span_type_(\d+)"[^>]*>([\s\S]*?)<\/span>/g, function (_, id, v) { (map[id] = map[id] || {}).type = v.replace(/<[^>]*>/g, '').trim(); });
        return map;
      }
      function renderRedirects() {
        var box = bodyEl.querySelector('#tp-seo-redirects');
        if (!box) return;
        var vpath = redirValuePath();
        if (!vpath) {
          box.innerHTML = '<div class="tm-redirects-empty">Brak adresu docelowego — ta wartość nie ma podstrony w tym sklepie/języku.</div>';
          return;
        }
        box.innerHTML = '<div class="tm-redirects-empty tm-redirects-loading">Ładowanie…</div>';
        fetch(redirGate(), { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
          var map = rParseList(html);
          var arr = [];
          Object.keys(map).forEach(function (id) { if (map[id] && map[id].dest === vpath) arr.push({ id: id, uri: map[id].uri || '', type: map[id].type || '301' }); });
          paint(arr);
        }).catch(function (e) {
          box.innerHTML = '<div class="tm-redirects-empty">Nie udało się wczytać przekierowań: ' + esc(e && e.message || e) + '</div>';
        });

        function paint(arr) {
          var h = '<button type="button" class="tm-redirect-add-btn">' + ICON_PLUS + ' Dodaj przekierowanie</button>';
          if (!arr.length) {
            h += '<div class="tm-redirects-empty">Brak przekierowań</div>';
          } else {
            h += '<div class="tm-redirects-list">';
            arr.forEach(function (rd) {
              h += '<div class="tm-redirect-row" data-id="' + esc(rd.id) + '">' +
                '<div class="tm-redirect-fields">' +
                  '<span class="tm-redirect-chip" title="' + esc(rd.uri) + '">' + esc(rd.uri) + '</span>' +
                  '<span class="tm-redirect-arrow">' + ICON_ARROW + '</span>' +
                  '<span class="tm-redirect-chip tm-redirect-chip--to" title="' + esc(vpath) + '">' + esc(vpath) + '</span>' +
                  '<span style="font-size:11px;color:#98a2b3;margin-left:6px;">' + esc(rd.type) + '</span>' +
                '</div>' +
                '<button type="button" class="tm-redirect-btn tm-redirect-btn--edit" data-action="edit" title="Edytuj"><span class="material-symbols-outlined">edit</span></button>' +
                '<button type="button" class="tm-redirect-btn tm-redirect-btn--del" data-action="del" title="Usuń"><span class="material-symbols-outlined">delete</span></button>' +
              '</div>';
            });
            h += '</div>';
          }
          box.innerHTML = h;
          var addBtn = box.querySelector('.tm-redirect-add-btn');
          if (addBtn) addBtn.addEventListener('click', openAddForm);
          box.querySelectorAll('.tm-redirect-btn--del').forEach(function (b) {
            b.addEventListener('click', function () {
              var row = b.closest('.tm-redirect-row'); if (!row) return;
              var id = row.getAttribute('data-id');
              if (!confirm('Usunąć przekierowanie?')) return;
              row.style.opacity = '0.5'; row.style.pointerEvents = 'none';
              rPost('remove[]=' + encodeURIComponent(id)).then(function (t) {
                var j; try { j = JSON.parse(t); } catch (e) { j = null; }
                if (j && j.error === 0) { if (_panel) _panel.showStatus('Usunięto przekierowanie'); renderRedirects(); }
                else { row.style.opacity = ''; row.style.pointerEvents = ''; alert('Nie udało się usunąć przekierowania.'); }
              }).catch(function (e) { row.style.opacity = ''; row.style.pointerEvents = ''; alert('Błąd: ' + (e.message || e)); });
            });
          });
          box.querySelectorAll('.tm-redirect-btn--edit').forEach(function (b) {
            b.addEventListener('click', function () {
              var row = b.closest('.tm-redirect-row'); if (!row) return;
              var id = row.getAttribute('data-id');
              var rd = null;
              for (var x = 0; x < arr.length; x++) { if (String(arr[x].id) === String(id)) { rd = arr[x]; break; } }
              if (rd) openEditForm(row, rd);
            });
          });
        }

        function openAddForm() {
          var addBtn = box.querySelector('.tm-redirect-add-btn');
          if (!addBtn || box.querySelector('.tm-redirect-add-form')) return;
          var form = d.createElement('div');
          form.className = 'tm-redirect-add-form';
          form.innerHTML =
            '<div class="tm-redirect-add-row">' +
              '<input type="text" class="tm-redirect-add-input" placeholder="np. /stary-adres" autocomplete="off">' +
              '<select class="tm-field-select tp-rdr-type" style="min-width:80px;"><option value="301">301</option><option value="302">302</option></select>' +
              '<button type="button" class="tm-redirect-add-submit">' + ICON_PLUS + ' Dodaj</button>' +
              '<button type="button" class="tm-redirect-add-cancel" title="Anuluj">✕</button>' +
            '</div>' +
            '<div class="tm-redirect-add-error" style="display:none"></div>';
          addBtn.replaceWith(form);
          var inp = form.querySelector('.tm-redirect-add-input');
          var typeSel = form.querySelector('.tp-rdr-type');
          var sub = form.querySelector('.tm-redirect-add-submit');
          var canc = form.querySelector('.tm-redirect-add-cancel');
          var errEl = form.querySelector('.tm-redirect-add-error');
          inp.focus();
          function norm() {
            var s = (inp.value || '').trim();
            try { s = new URL(s).pathname; } catch (e) {}
            s = s.replace(/^\/+/, '').replace(/\s+/g, '');
            return s ? ('/' + s) : '';
          }
          function submit() {
            if (sub.disabled) return;
            var src = norm();
            errEl.style.display = 'none';
            if (!src) { errEl.textContent = 'Podaj adres źródłowy.'; errEl.style.display = ''; return; }
            if (src === vpath) { errEl.textContent = 'Adres źródłowy nie może być taki sam jak docelowy.'; errEl.style.display = ''; return; }
            sub.disabled = true; sub.innerHTML = ICON_PLUS + ' Dodawanie…';
            rPost('tmp_id=' + Date.now() + '&uri=' + encodeURIComponent(src) + '&destination=' + encodeURIComponent(vpath) + '&type=' + encodeURIComponent(typeSel.value)).then(function (t) {
              var j; try { j = JSON.parse(t); } catch (e) { j = null; }
              if (j && j.error === 0) { if (_panel) _panel.showStatus('Dodano przekierowanie: ' + src + ' → ' + vpath); renderRedirects(); }
              else {
                sub.disabled = false; sub.innerHTML = ICON_PLUS + ' Dodaj';
                errEl.textContent = (j && (j.message || j.errorMessage)) || 'Nie udało się dodać przekierowania (adres może już istnieć).';
                errEl.style.display = '';
              }
            }).catch(function (e) {
              sub.disabled = false; sub.innerHTML = ICON_PLUS + ' Dodaj';
              errEl.textContent = 'Błąd: ' + (e.message || e); errEl.style.display = '';
            });
          }
          sub.addEventListener('click', submit);
          canc.addEventListener('click', function () { renderRedirects(); });
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { e.preventDefault(); renderRedirects(); } });
        }

        // v4.6.95: edycja istniejacego przekierowania (operation=edit zachowuje ID)
        function openEditForm(row, rd) {
          if (box.querySelector('.tm-redirect-add-form')) return;
          var form = d.createElement('div');
          form.className = 'tm-redirect-add-form';
          form.innerHTML =
            '<div class="tm-redirect-add-row">' +
              '<input type="text" class="tm-redirect-add-input" placeholder="np. /stary-adres" autocomplete="off">' +
              '<select class="tm-field-select tp-rdr-type" style="min-width:80px;"><option value="301">301</option><option value="302">302</option></select>' +
              '<button type="button" class="tm-redirect-add-submit">' + ICON_PLUS + ' Zapisz</button>' +
              '<button type="button" class="tm-redirect-add-cancel" title="Anuluj">\u2715</button>' +
            '</div>' +
            '<div class="tm-redirect-add-error" style="display:none"></div>';
          row.replaceWith(form);
          var inp = form.querySelector('.tm-redirect-add-input');
          var typeSel = form.querySelector('.tp-rdr-type');
          var sub = form.querySelector('.tm-redirect-add-submit');
          var canc = form.querySelector('.tm-redirect-add-cancel');
          var errEl = form.querySelector('.tm-redirect-add-error');
          inp.value = rd.uri || '';
          typeSel.value = (String(rd.type) === '302') ? '302' : '301';
          inp.focus();
          function norm() {
            var v = (inp.value || '').trim();
            try { v = new URL(v).pathname; } catch (e) {}
            v = v.replace(/^\/+/, '').replace(/\s+/g, '');
            return v ? ('/' + v) : '';
          }
          function submit() {
            if (sub.disabled) return;
            var src = norm();
            errEl.style.display = 'none';
            if (!src) { errEl.textContent = 'Podaj adres \u017ar\u00f3d\u0142owy.'; errEl.style.display = ''; return; }
            if (src === vpath) { errEl.textContent = 'Adres \u017ar\u00f3d\u0142owy nie mo\u017ce by\u0107 taki sam jak docelowy.'; errEl.style.display = ''; return; }
            sub.disabled = true; sub.innerHTML = ICON_PLUS + ' Zapisywanie\u2026';
            rPost('operation=edit&id=' + encodeURIComponent(rd.id) + '&uri=' + encodeURIComponent(src) + '&destination=' + encodeURIComponent(vpath) + '&type=' + encodeURIComponent(typeSel.value)).then(function (t) {
              var j; try { j = JSON.parse(t); } catch (e) { j = null; }
              if (j && j.error === 0) { if (_panel) _panel.showStatus('Zapisano przekierowanie: ' + src + ' \u2192 ' + vpath); renderRedirects(); }
              else {
                sub.disabled = false; sub.innerHTML = ICON_PLUS + ' Zapisz';
                errEl.textContent = (j && (j.message || j.errorMessage)) || 'Nie uda\u0142o si\u0119 zapisa\u0107 przekierowania.';
                errEl.style.display = '';
              }
            }).catch(function (e) {
              sub.disabled = false; sub.innerHTML = ICON_PLUS + ' Zapisz';
              errEl.textContent = 'B\u0142\u0105d: ' + (e.message || e); errEl.style.display = '';
            });
          }
          sub.addEventListener('click', submit);
          canc.addEventListener('click', function () { renderRedirects(); });
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } else if (e.key === 'Escape') { e.preventDefault(); renderRedirects(); } });
        }
      }
      function wire() {
        var msel = bodyEl.querySelector('[name=meta_default]');
        var mfields = bodyEl.querySelector('.tm-meta-fields');
        if (msel && mfields) msel.addEventListener('change', function () { mfields.style.display = msel.value === 'n' ? '' : 'none'; });
        var shopSel = bodyEl.querySelector('[name=tp_shop]');
        if (shopSel) shopSel.addEventListener('change', function () { curShop = shopSel.value; load(); });
        var lngSel = bodyEl.querySelector('[name=tp_lang]');
        if (lngSel) lngSel.addEventListener('change', function () { curLang = lngSel.value; load(); });
        renderRedirects();
        var copyBtn = bodyEl.querySelector('.tp-seo-url-copy');
        if (copyBtn) copyBtn.addEventListener('click', function () {
          var inp = bodyEl.querySelector('[name=tp_url]');
          var txt = inp ? inp.value : '';
          function done() {
            var ic = copyBtn.querySelector('.material-symbols-outlined');
            var prev = ic ? ic.textContent : '';
            if (ic) ic.textContent = 'check';
            copyBtn.style.color = '#1aa251';
            setTimeout(function () { if (ic) ic.textContent = prev || 'content_copy'; copyBtn.style.color = ''; }, 1200);
            if (_panel) _panel.showStatus('Skopiowano adres');
          }
          function fallback() {
            try {
              if (!inp) throw new Error('brak pola');
              inp.removeAttribute('readonly'); inp.focus(); inp.select();
              d.execCommand('copy');
              inp.setAttribute('readonly', '');
              try { var sel = (d.defaultView || window).getSelection(); if (sel && sel.removeAllRanges) sel.removeAllRanges(); } catch (e) {}
              done();
            } catch (e2) { alert('Nie udało się skopiować: ' + (e2.message || e2)); }
          }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(done, fallback);
            } else { fallback(); }
          } catch (e) { fallback(); }
        });
      }
      var _seoFirst = true;
      function skelCard(icon, title, rows) {
        var b = '';
        for (var i = 0; i < rows; i++) {
          b += '<div class="tm-field-row"><span class="tm-field-label"><span class="tp-skl" style="width:' + (90 + i * 40) + 'px;height:13px"></span></span>' +
            '<span class="tp-skl" style="flex:0 0 420px;width:420px;height:36px;border-radius:8px"></span></div>';
        }
        return '<div class="tm-section-card tm-section-card--seo"><div class="tm-section-header"><span class="material-symbols-outlined">' + icon + '</span>' + title + '</div><div class="tm-section-body">' + b + '</div></div>';
      }
      function seoSkeleton() {
        return skelCard('storefront', 'Sklep i język', 2) +
          skelCard('code', 'Meta tagi', 4) +
          skelCard('smart_toy', 'Robots', 2) +
          skelCard('link', 'Adres URL', 3) +
          skelCard('redo', 'Przekierowania', 2);
      }
      function load() {
        saveBtn.disabled = true;
        refreshSubtitle();
        var freezeH = 0;
        if (_seoFirst) {
          bodyEl.innerHTML = seoSkeleton();
        } else {
          // zamiana sklepu/języka: NIE czyść treści — zamroź wysokość i przygaś,
          // żeby modal nie skakał; podmiana dopiero po danych.
          freezeH = bodyEl.offsetHeight;
          if (freezeH) bodyEl.style.minHeight = freezeH + 'px';
          bodyEl.classList.add('tp-seo-busy');
        }
        function release() {
          bodyEl.classList.remove('tp-seo-busy');
          (window.requestAnimationFrame || setTimeout)(function () { bodyEl.style.minHeight = ''; });
        }
        navPost('action=getNode&tes=t&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0').then(function (r) {
          var dn = (r && r.data) || {};
          loaded = dn;
          bodyEl.innerHTML = sectionsHtml(dn);
          wire();
          _seoFirst = false;
          saveBtn.disabled = false;
          release();
        }).catch(function (e) {
          bodyEl.innerHTML = '<div style="padding:24px;color:#d93025;text-align:center">Błąd wczytywania: ' + esc(e && e.message || e) + '</div>';
          _seoFirst = false;
          release();
        });
      }
      load();

      saveBtn.addEventListener('click', function () {
        function val(n) { var el = bodyEl.querySelector('[name="' + n + '"]'); return el ? el.value : ''; }
        var md = val('meta_default') || 'y';
        var mt = val('meta_title'), mdsc = val('meta_description'), mk = val('meta_keywords');
        var mi = val('meta_index') || 'default', mf = val('meta_follow') || 'default';
        saveBtn.disabled = true; saveBtn.textContent = 'Zapisywanie...';
        navPost('action=getNode&tes=t&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0').then(function (r) {
          var dn = (r && r.data) || loaded || {};
          var keepFD = dn.filter_default ? 'y' : 'n';
          var keepView = (dn.display_limit || dn.sort || (dn.display_mode && dn.display_mode_default && dn.display_mode !== dn.display_mode_default)) ? 'own' : 'default';
          var keepHl = dn.headline_name || '';
          if (md === 'y') { mt = ''; mdsc = ''; mk = ''; }
          var b = 'action=editNodeShopData&node_type=false&filter_default=' + keepFD +
            '&target=false&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) +
            '&tree=parameters&node=' + encodeURIComponent(nodeId) + '&view=' + keepView + '&parent=0' +
            '&click_action=false&element_hidden=false&displayShowAll=false&showAllIs=false&expand=false' +
            '&node_gfx=false&gfx_active_type=false&gfx_inactive_type=false&gfx_omo_type=false&gfx_type=false' +
            '&meta_default=' + md + '&meta_keywords=' + encodeURIComponent(mk) +
            '&meta_title=' + encodeURIComponent(mt) + '&meta_desc=' + encodeURIComponent(mdsc) +
            '&meta_index=' + mi + '&meta_follow=' + mf + '&headline_name=' + encodeURIComponent(keepHl);
          return navPost(b);
        }).then(function (r2) {
          if (!r2 || r2.status !== 'ok') throw new Error((r2 && (r2.error || r2.message)) || 'editNodeShopData');
          saveBtn.disabled = false; saveBtn.textContent = 'Zapisz';
          if (_panel) _panel.showStatus('Zapisano SEO (' + shopLabel(curShop) + ', ' + getLangName(curLang) + ')');
          close();
        }).catch(function (e) {
          saveBtn.disabled = false; saveBtn.textContent = 'Zapisz';
          alert('Błąd zapisu SEO: ' + (e && e.message || e));
        });
      });
    }).catch(function (e) { alert('Błąd wczytywania: ' + (e && e.message || e)); });
  }

  // v4.6.57: Modal Tłumaczenia — bulk edycja nazw parametrów i wartości aktywnej
  // sekcji we wszystkich językach. Endpoint: getParameterLangData (load), setSettings
  // names[lang]= (save). Bulk save z progress barem. Auto-paralelizacja 6 requestów.
  // v4.6.68: podstrona Tłumaczeń (zastąpiła modal). Ukrywa kartę drzewa (.panel-pro)
  // i wstawia siebie w to samo miejsce — pełna szerokość iframe, sidebar panelu zostaje.
  // Powrót: przycisk „Powrót do drzewa" restoruje widoczność drzewa.
  function showTranslationsPage(doc) {
    var d = doc || document;
    if (typeof ensureSeoV2Css === 'function') ensureSeoV2Css(d);
    // Wstrzyknij CSS tłumaczeń (tylko raz). v4.6.59: stylistyka spójna z UI (search jak na drzewie, inputy round jak w modalu ustawień).
    if (!d.getElementById('tp-tr-css')) {
      var st = d.createElement('style'); st.id = 'tp-tr-css';
      st.textContent = [
        // PODSTRONA (block w iframe body, zastępuje kartę drzewa).
        '.tp-tr-page { display:flex; flex-direction:column; background:#fff; padding:14px 16px 0; min-height:calc(100vh - 80px); font-family:"DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; animation:tp-tr-fadeIn .12s ease-out; }',
        '@keyframes tp-tr-fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }',
        // Nagłówek strony: powrót + ikona + tytuł + sub
        '.tp-tr-page-header { display:flex; align-items:center; gap:14px; padding:14px 16px; border:1px solid #dadce0; border-radius:8px; background:#fff; margin-bottom:16px; }',
        '.tp-tr-back-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; background:#fff; border:1px solid #dadce0; border-radius:6px; color:#334155; font-size:13px; font-weight:500; cursor:pointer; font-family:inherit; transition:background .15s, border-color .15s; }',
        '.tp-tr-back-btn:hover { background:#f8fafc; border-color:#94a3b8; }',
        '.tp-tr-back-btn .material-symbols-outlined { font-size:18px; }',
        '.tp-tr-page-header-sep { width:1px; height:24px; background:#dadce0; }',
        '.tp-tr-header-icon { width:36px; height:36px; background:#eff6ff; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#2563eb; flex-shrink:0; }',
        '.tp-tr-header-icon .material-symbols-outlined { font-size:20px; }',
        '.tp-tr-header-text { flex:1; min-width:0; }',
        '.tp-tr-header-title { font-size:16px; font-weight:600; color:#111827; }',
        '.tp-tr-header-sub { font-size:12px; color:#6b7280; margin-top:2px; }',
        // Body strony = wrapper karty .panel-pro (bez nakładki / paddingu zewnętrznego)
        '.tp-tr-body { display:block; }',
        '.tp-tr-card { margin:0 !important; box-shadow:0 1px 2px rgba(0,0,0,0.04); overflow:hidden; }',
        // Scroll poziomy WEWNĄTRZ karty. UWAGA: panel-pro ma globalną regułę
        // `.panel-pro > *:not(.panel-pro__header-wrapper) { overflow: visible }`
        // która ma większą specyficzność — musimy nadpisać !important.
        '.tp-tr-card-body { background:#fff; overflow-x:auto !important; overflow-y:visible; width:100%; box-sizing:border-box; min-width:0; }',
        // Search-hint i filter-wrap w toolbarze panel-pro
        '.tp-tr-search-help { font-size:18px !important; color:#9aa0a6 !important; cursor:help; flex-shrink:0; transition:color .15s; }',
        '.tp-tr-search-help:hover { color:#5f6368 !important; }',
        '.tp-tr-filter-wrap { flex:0 0 220px; }',
        '.tp-tr-loading { padding:60px 20px; text-align:center; color:#6b7280; font-size:14px; }',
        '.tp-tr-progress-wrap { max-width:400px; margin:14px auto 0; }',
        '.tp-tr-progress-bar { height:6px; background:#e5e7eb; border-radius:3px; overflow:hidden; }',
        '.tp-tr-progress-fill { height:100%; background:#2563eb; transition:width .2s; }',
        '.tp-tr-progress-text { font-size:12px; color:#6b7280; margin-top:8px; }',
        // Tabela używa ISTNIEJĄCYCH klas .panel-pro__thead + .panel-pro__row (taka sama
        // otoczka co tabela drzewa). Tylko nadpisujemy text-align i padding komórek.
        '.tp-tr-grid { background:#fff; }',
        '.tp-tr-grid .panel-pro__thead { position:sticky; top:0; z-index:2; }',
        '.tp-tr-grid .panel-pro__thead > div { padding:0 12px; text-align:left; }',
        '.tp-tr-grid ul { list-style:none; padding:0; margin:0; }',
        '.tp-tr-grid li.panel-pro__row { padding:6px 0 !important; }',
        // v4.6.75: LAZY HYDRATION zamiast content-visibility (flash przy scrollu).
        // Komórki domyślnie pokazują tekst (tani span). Klik → swap na input.
        // contain:layout style zostawione — izoluje repaint poszczególnych rzędów.
        '.tp-tr-grid li.panel-pro__row { contain:layout style; }',
        // v4.6.79: wymuś min-width:max-content na rzędach + thead. Bez tego grid
        // zmniejsza kolumny do parent width i scroll poziomy nie aktywuje się przy
        // wielu językach (>5-6 na 1920px). Z max-content tabela ma rzeczywistą
        // szerokość = suma minów kolumn → .tp-tr-card-body overflow-x:auto pokaże scrollbar.
        '.tp-tr-grid li.panel-pro__row, .tp-tr-grid .panel-pro__thead { min-width:max-content; }',
        // v4.6.76: wymiary span IDENTYCZNE jak input.tm-node-text-input (padding 8/10,
        // min-height 36) — brak skoku wysokości wiersza przy hydratacji span→input.
        '.tp-tr-cell-text { flex:1 1 auto; display:flex; align-items:center; padding:8px 10px; font-size:13px; color:#1a1a2e; min-width:0; min-height:36px; box-sizing:border-box; line-height:1.4; cursor:text; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
        '.tp-tr-cell-text:empty::before { content:"—"; color:#cbd5e1; }',
        '.tp-tr-cell .tm-input-wrap { cursor:text; }',
        '.tp-tr-grid li.panel-pro__row > div { padding:0 12px; }',
        '.tp-tr-grid li.panel-pro__row.tp-tr-row-param > div:first-child { font-weight:500; color:#202124; font-size:14px; }',
        '.tp-tr-grid li.panel-pro__row.tp-tr-row-value > div:first-child { color:#3c4043; }',
        '.tp-tr-elem-name { display:inline-flex; align-items:center; gap:6px; }',
        '.tp-tr-elem-name .material-symbols-outlined { font-size:18px; color:#bbb; flex-shrink:0; }',
        '.tp-tr-elem-id { color:#5f6368; font-size:12px; margin-left:8px; font-weight:400; font-family:"Roboto Mono",monospace; }',
        // Inputy edycji używają ISTNIEJĄCYCH .tm-input-wrap + .tm-node-text-input
        // z SHARED_MODAL_CSS (te same co modal ustawień). Modyfikatory dirty/saved/error
        // nakładane na .tm-input-wrap (sam wrap zmienia kolor ramki).
        // Override: SHARED_MODAL_CSS ma .tm-settings-v2 .tm-input-wrap { flex:0 0 420px;
        // width:420px !important } — dla modali ustawień z labelem po lewej. W modalu
        // Tłumaczeń wraps mają być auto (rozciągają się w komórce gridu / toolbarze).
        '.tp-tr-page.tm-settings-v2 .tm-input-wrap { flex:1 1 auto !important; width:auto !important; }',
        '.tp-tr-page.tm-settings-v2 .tp-tr-cell .tm-input-wrap { width:100% !important; flex:1 1 auto !important; }',
        '.tp-tr-page.tm-settings-v2 .tp-tr-filter-wrap { flex:0 0 220px !important; width:220px !important; }',
        '.tp-tr-cell .tm-input-wrap.tp-tr-dirty { border-color:#f59e0b !important; background:#fffbeb !important; }',
        '.tp-tr-cell .tm-input-wrap.tp-tr-saving { background:#eff6ff !important; }',
        '.tp-tr-cell .tm-input-wrap.tp-tr-saving .tm-node-text-input { color:#9ca3af !important; }',
        '.tp-tr-cell .tm-input-wrap.tp-tr-saved { border-color:#10b981 !important; background:#ecfdf5 !important; transition:border-color .8s, background .8s; }',
        '.tp-tr-cell .tm-input-wrap.tp-tr-error { border-color:#dc2626 !important; background:#fef2f2 !important; }',
        // === BULK COPY: selekcja komórek + pasek + popover języków docelowych ===
        '.tp-tr-cell { position:relative; }',
        '.tp-tr-cell-check { position:absolute; top:50%; right:10px; transform:translateY(-50%); width:18px; height:18px; border:1.5px solid #cbd5e1; border-radius:4px; background:#fff; cursor:pointer; opacity:0; transition:opacity .12s, border-color .12s, background .12s; z-index:3; }',
        '.tp-tr-cell:hover .tp-tr-cell-check, .tp-tr-cell.tp-tr-selected .tp-tr-cell-check { opacity:1; }',
        '.tp-tr-cell-check:hover { border-color:#2563eb; }',
        '.tp-tr-cell.tp-tr-selected .tp-tr-cell-check { background:#2563eb; border-color:#2563eb; }',
        '.tp-tr-cell.tp-tr-selected .tp-tr-cell-check::after { content:""; position:absolute; left:5px; top:2px; width:5px; height:9px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }',
        '.tp-tr-cell.tp-tr-selected .tm-input-wrap { border-color:#2563eb !important; box-shadow:0 0 0 2px rgba(37,99,235,.18) !important; }',
        // Placeholder „Wczytywanie wartości…" pod parametrem (progressive display)
        '.tp-tr-row-loading { display:block; padding:10px 16px 10px 40px; font-size:12.5px; color:#9ca3af; font-style:italic; border-bottom:1px solid #f1f5f9; background:#fafbfc; }',
        '.tp-tr-row-loading::before { content:""; display:inline-block; width:10px; height:10px; margin-right:8px; border:2px solid #cbd5e1; border-right-color:#2563eb; border-radius:50%; vertical-align:middle; animation:tp-tr-spin .8s linear infinite; }',
        '@keyframes tp-tr-spin { to { transform:rotate(360deg); } }',
        // Pasek selekcji (te same kolory co .panel-pro__selection-bar)
        '.tp-tr-selbar { display:none; align-items:center; gap:12px; padding:10px 14px; background:#eff6ff; border-bottom:1px solid #bfdbfe; }',
        '.tp-tr-selbar.tp-tr-selbar--visible { display:flex; }',
        '.tp-tr-selbar-text { font-size:13px; color:#1d4ed8; flex:1; min-width:0; }',
        '.tp-tr-selbar-count { background:#fff; color:#1d4ed8; padding:2px 10px; border-radius:12px; border:1px solid #bfdbfe; font-size:12px; font-weight:700; margin-right:6px; }',
        '.tp-tr-selbar-actions { display:flex; align-items:center; gap:8px; position:relative; }',
        '.tp-tr-selbar-actions .tp-tr-btn .material-symbols-outlined { font-size:16px; }',
        // Popover „Kopiuj do innych języków"
        '.tp-tr-copytarget { position:absolute; top:calc(100% + 6px); right:0; background:#fff; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 12px 32px rgba(0,0,0,.16); padding:16px; min-width:300px; max-width:380px; z-index:50; }',
        '.tp-tr-copytarget-title { font-size:13px; font-weight:600; color:#111827; margin-bottom:4px; }',
        '.tp-tr-copytarget-helper { font-size:11.5px; color:#6b7280; margin-bottom:10px; }',
        '.tp-tr-copytarget-quick { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }',
        '.tp-tr-copytarget-quick button { padding:3px 10px; border-radius:12px; background:#f1f5f9; border:1px solid #e2e8f0; font-size:11.5px; color:#475569; cursor:pointer; font-family:inherit; }',
        '.tp-tr-copytarget-quick button:hover { background:#e2e8f0; }',
        '.tp-tr-copytarget-list { display:flex; flex-direction:column; gap:2px; max-height:280px; overflow-y:auto; margin:0 -6px; padding:0 6px; }',
        '.tp-tr-copytarget-list label { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:6px; font-size:13px; cursor:pointer; color:#334155; }',
        '.tp-tr-copytarget-list label:hover { background:#f8fafc; }',
        '.tp-tr-copytarget-list input { accent-color:#2563eb; width:15px; height:15px; cursor:pointer; }',
        '.tp-tr-copytarget-actions { display:flex; gap:8px; margin-top:12px; padding-top:10px; border-top:1px solid #f1f5f9; justify-content:flex-end; }',
        // Stopka strony: sticky na dole iframe — Save zawsze widoczny
        '.tp-tr-footer { position:sticky; bottom:0; padding:14px 16px; margin-top:16px; border:1px solid #dadce0; border-radius:8px; background:#fafbfc; display:flex; align-items:center; justify-content:space-between; gap:14px; box-shadow:0 -2px 8px rgba(0,0,0,0.04); z-index:5; }',
        '.tp-tr-dirty-count { font-size:13px; color:#6b7280; }',
        '.tp-tr-dirty-count .tp-tr-dc-num { font-weight:600; color:#f59e0b; }',
        '.tp-tr-btn { padding:8px 18px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:1px solid transparent; font-family:inherit; display:inline-flex; align-items:center; gap:6px; transition:background .12s, border-color .12s; }',
        '.tp-tr-btn-cancel { background:#fff; border-color:#d1d5db; color:#374151; }',
        '.tp-tr-btn-cancel:hover { background:#f9fafb; border-color:#9ca3af; }',
        '.tp-tr-btn-save { background:#2563eb; color:#fff; }',
        '.tp-tr-btn-save:hover { background:#1d4ed8; }',
        '.tp-tr-btn-save:disabled { background:#9ca3af; cursor:not-allowed; }'
      ].join('\n');
      d.head.appendChild(st);
    }

    // Wyciągnij parametry z drzewa (aktywna sekcja)
    var paramLis = Array.prototype.slice.call(d.querySelectorAll('#block_group0 > li[id^="m_"]'));
    if (!paramLis.length) { alert('Brak parametrów do edycji.'); return; }
    var paramList = paramLis.map(function (li) {
      var id = li.id.replace(/^m_/, '');
      var nm = ''; try { nm = (li.querySelector('.tp-row-label') || li.querySelector('.showMenuSub') || li).textContent.trim().slice(0, 80); } catch (e) {}
      return { id: id, name: nm };
    });

    // Schowaj WSZYSTKIE elementy treści iframe body (poza script/style/meta) i wstaw
    // nasz widok — wrażenie pełnej podstrony, jakby się przeszło na inny URL.
    var iframeBody = d.body;
    var prevScrollY = (d.defaultView || window).scrollY || 0;
    var hiddenChildren = []; // [{el, prevDisplay}]
    Array.prototype.slice.call(iframeBody.children).forEach(function (el) {
      var tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'LINK' || tag === 'META' || tag === 'TEMPLATE') return;
      hiddenChildren.push({ el: el, prevDisplay: el.style.display || '' });
      el.style.display = 'none';
    });

    // Page skeleton (zamiast overlay+modal). tm-settings-v2 — żeby reguły
    // .tm-input-wrap/.tm-field-select/.tm-node-text-input z SHARED_MODAL_CSS
    // zadziałały na inputy i filtr.
    var modal = d.createElement('div'); modal.className = 'tp-tr-page tm-settings-v2';
    modal.innerHTML =
      '<div class="tp-tr-page-header">' +
        '<button type="button" class="tp-tr-back-btn" id="tp-tr-back"><span class="material-symbols-outlined">arrow_back</span><span>Powrót do drzewa</span></button>' +
        '<div class="tp-tr-page-header-sep"></div>' +
        '<div class="tp-tr-header-icon"><span class="material-symbols-outlined">translate</span></div>' +
        '<div class="tp-tr-header-text">' +
          '<div class="tp-tr-header-title">Tłumaczenia — nazwy parametrów i wartości</div>' +
          '<div class="tp-tr-header-sub" id="tp-tr-sub">Wczytywanie…</div>' +
        '</div>' +
      '</div>' +
      // Body = karta .panel-pro (otoczka jak tabela drzewa / lista sekcji).
      // W środku: .panel-pro__toolbar (z .panel-pro__search + filtr), .panel-pro__thead,
      // ul z .panel-pro__row, .panel-pro__footer ze statystyką. Save+Cancel zostają
      // w modal-level footerze (zawsze widoczne).
      '<div class="tp-tr-body" id="tp-tr-body">' +
        '<div class="panel-pro tp-tr-card">' +
          '<div class="panel-pro__toolbar">' +
            '<div class="panel-pro__toolbar__left">' +
              '<div class="panel-pro__search">' +
                '<span class="material-symbols-outlined">search</span>' +
                '<input type="search" class="tp-tr-search" placeholder="Szukaj parametrów i ich wartości po nazwie lub id" autocomplete="off">' +
                '<span class="material-symbols-outlined tp-tr-search-help" title="Wiele wartości naraz: oddziel symbolem | lub , (np. 20926|20960|kolor)">help</span>' +
              '</div>' +
            '</div>' +
            '<div class="panel-pro__toolbar__right">' +
              '<div class="tm-input-wrap tp-tr-filter-wrap"><span class="material-symbols-outlined tm-input-icon">filter_alt</span>' +
                '<select class="tm-field-select tp-tr-filter" id="tp-tr-filter" aria-label="Filtr pól">' +
                  '<option value="all">Wszystkie pola</option>' +
                  '<option value="dirty">Pola zmienione</option>' +
                  '<option value="clean">Pola niezmienione</option>' +
                  '<option value="empty">Pola puste</option>' +
                '</select>' +
              '</div>' +
              // Dropdown widocznych języków (te same klasy co columnsMenu PanelPro)
              '<div class="panel-pro__dropdown" id="tp-tr-langs-dd">' +
                '<button type="button" class="panel-pro__btn panel-pro__btn--icon" data-pp-tooltip="Pokaż / ukryj języki" aria-label="Widoczne języki">' +
                  '<span class="material-symbols-outlined">view_week</span>' +
                '</button>' +
                '<div class="panel-pro__dropdown__menu panel-pro__dropdown__menu--cols" id="tp-tr-langs-menu"></div>' +
              '</div>' +
              // Odśwież dane — manual invalidate całego cache + reload strony
              '<button type="button" class="panel-pro__btn panel-pro__btn--icon" id="tp-tr-refresh" data-pp-tooltip="Odśwież dane (wyczyść cache i wczytaj na nowo)" aria-label="Odśwież dane">' +
                '<span class="material-symbols-outlined">refresh</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
          // Pasek selekcji (pojawia się gdy zaznaczono ≥1 komórkę)
          '<div class="tp-tr-selbar" id="tp-tr-selbar">' +
            '<span class="tp-tr-selbar-text"></span>' +
            '<div class="tp-tr-selbar-actions">' +
              '<button type="button" class="tp-tr-btn tp-tr-btn-cancel" id="tp-tr-sel-clear">Odznacz</button>' +
              '<button type="button" class="tp-tr-btn tp-tr-btn-save" id="tp-tr-sel-copy"><span class="material-symbols-outlined">content_copy</span>Kopiuj do innych języków</button>' +
              '<div class="tp-tr-copytarget" id="tp-tr-copytarget" style="display:none;"></div>' +
            '</div>' +
          '</div>' +
          '<div class="tp-tr-card-body" id="tp-tr-card-body">' +
            '<div class="tp-tr-loading">' +
              '<div>Wczytywanie nazw we wszystkich językach…</div>' +
              '<div class="tp-tr-progress-wrap">' +
                '<div class="tp-tr-progress-bar"><div class="tp-tr-progress-fill" id="tp-tr-fill" style="width:0%"></div></div>' +
                '<div class="tp-tr-progress-text" id="tp-tr-ptext">0 / 0</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="panel-pro__footer" id="tp-tr-card-footer"></div>' +
        '</div>' +
      '</div>' +
      '<div class="tp-tr-footer">' +
        '<div class="tp-tr-dirty-count"><span class="tp-tr-dc-num" id="tp-tr-dc">0</span> niezapisanych zmian</div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button type="button" class="tp-tr-btn tp-tr-btn-cancel" id="tp-tr-cancel">Zamknij</button>' +
          '<button type="button" class="tp-tr-btn tp-tr-btn-save" id="tp-tr-save" disabled>Zapisz wszystkie</button>' +
        '</div>' +
      '</div>';
    // Wstawiamy stronę bezpośrednio do iframe body (wszystkie inne dzieci ukryte).
    iframeBody.appendChild(modal);
    try { (d.defaultView || window).scrollTo(0, 0); } catch (e) {}

    var closeBtn = modal.querySelector('#tp-tr-back');
    var cancelBtn = modal.querySelector('#tp-tr-cancel');
    var saveBtn = modal.querySelector('#tp-tr-save');
    var dcEl = modal.querySelector('#tp-tr-dc');
    // bodyEl wskazuje na środek karty .panel-pro (tam wstawiamy thead+ul rzędów).
    // outerBodyEl = scrollowalny kontener (#tp-tr-body) — używany do scroll.
    var bodyEl = modal.querySelector('#tp-tr-card-body');
    var outerBodyEl = modal.querySelector('#tp-tr-body');
    var cardFooterEl = modal.querySelector('#tp-tr-card-footer');
    var subEl = modal.querySelector('#tp-tr-sub');
    var fillEl = modal.querySelector('#tp-tr-fill');
    var ptextEl = modal.querySelector('#tp-tr-ptext');
    var searchEl = modal.querySelector('.tp-tr-search');

    function close() {
      // Przywróć widoczność wszystkich oryginalnych elementów body i przywróć scroll
      hiddenChildren.forEach(function (h) { try { h.el.style.display = h.prevDisplay; } catch (e) {} });
      if (modal.parentNode) modal.remove();
      try { (d.defaultView || window).scrollTo(0, prevScrollY); } catch (e) {}
    }
    closeBtn.addEventListener('click', function () {
      if (dirtyCount() > 0 && !confirm('Masz niezapisane zmiany. Zamknąć bez zapisu?')) return;
      close();
    });
    cancelBtn.addEventListener('click', function () {
      if (dirtyCount() > 0 && !confirm('Masz niezapisane zmiany. Zamknąć bez zapisu?')) return;
      close();
    });

    // Ładowanie wszystkich (parametry + wartości) z paralelizacją
    var loaded = []; // {id, type:'param'|'value', parentId, names:{lang:name}}
    var totalToLoad = paramList.length;
    var doneCount = 0;
    function updateProgress() {
      var pct = totalToLoad ? Math.round(100 * doneCount / totalToLoad) : 0;
      fillEl.style.width = pct + '%';
      ptextEl.textContent = doneCount + ' / ' + totalToLoad;
    }
    function fetchLangData(id) {
      return fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(id)).then(function (resp) {
        var ld = (resp && resp.data && resp.data.langData) || {};
        var names = {};
        Object.keys(ld).forEach(function (lg) { names[lg] = (ld[lg] && ld[lg].name) || ''; });
        return names;
      });
    }
    // Paralelizacja (concurrency N). Prototype.js na parameters.php psuje Array.slice/map
    // (zweryfikowane) — używamy ręcznych pętli for.
    function chunkAll(items, concurrency, fn) {
      var i = 0;
      function next() {
        if (i >= items.length) return Promise.resolve();
        var batch = []; var n = Math.min(items.length, i + concurrency);
        for (var k = i; k < n; k++) batch.push(items[k]);
        i = n;
        var promises = [];
        for (var j = 0; j < batch.length; j++) promises.push(fn(batch[j]));
        return Promise.all(promises).then(next);
      }
      return next();
    }

    // BATCH ŁADOWANIE (massive speedup vs single-id requests).
    // Zamiast 1 request na każdą wartość (57k+ reqów) używamy:
    //   - fetchLangData(paramId) → 1 req zwraca nazwę parametru we WSZYSTKICH językach.
    //   - getTreeForLang(paramId, lang) → 1 req zwraca WSZYSTKIE wartości parametru
    //     w danym języku. Łącznie: paramCount + paramCount × langCount reqów
    //     (np. 141 + 141×5 = 846 reqów zamiast 57847).
    function getTreeForLang(paramId, lang) {
      var GW = (typeof getIframeWin === 'function') ? getIframeWin() : window;
      return new Promise(function (resolve, reject) {
        var xhr = new GW.XMLHttpRequest();
        xhr.open('POST', '/panel/ajax/parameters.php');
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function () {
          try {
            var resp = JSON.parse(xhr.responseText);
            var html = resp.treeCode || '';
            var children = [];
            var rx = /id="m_(\d+)"[\s\S]*?class="showMenuSub\s+value[^"]*">([^<]+)/g;
            var m;
            while ((m = rx.exec(html)) !== null) {
              var nm = m[2].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
              children.push({ id: m[1], name: nm });
            }
            resolve(children);
          } catch (e) { reject(e); }
        };
        xhr.onerror = function () { reject(new Error('network')); };
        xhr.send('action=getTreeForSection&parameter=group' + paramId + '&lang=' + encodeURIComponent(lang));
      });
    }

    // Set parametrów których wartości zostały już załadowane (do placeholderów w renderTable)
    var paramValuesLoaded = {};

    // v4.6.78: SMART CACHE — persistent (TTL 30 dni), index dla szybkiego diff,
    // manual refresh button. Cache aktualizowany inkrementalnie:
    //   - pierwsze otwarcie: fetch wszystkich, cache całość
    //   - kolejne: porównaj cached z aktualnym drzewem; pobierz tylko nowe; usuń wykasowane
    //   - Save: invalidate edytowany param (auto re-fetch następnym razem)
    //   - Odśwież: czyści cały cache (gdy user wie że coś poza modalem się zmieniło)
    var TR_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 dni
    var TR_CACHE_INDEX_KEY = 'tp-tr-cache-index-v1';
    function trCacheKey(paramId) { return 'tp-tr-cache-v1:' + paramId; }
    function trCacheIndexLoad() {
      try { var raw = localStorage.getItem(TR_CACHE_INDEX_KEY); return raw ? JSON.parse(raw) : { ids: [] }; } catch (e) { return { ids: [] }; }
    }
    function trCacheIndexSave(ids) { try { localStorage.setItem(TR_CACHE_INDEX_KEY, JSON.stringify({ ids: ids })); } catch (e) {} }
    function trCacheIndexAdd(paramId) {
      var idx = trCacheIndexLoad();
      if (idx.ids.indexOf(paramId) < 0) { idx.ids.push(paramId); trCacheIndexSave(idx.ids); }
    }
    function trCacheIndexRemove(paramId) {
      var idx = trCacheIndexLoad();
      var i = idx.ids.indexOf(paramId);
      if (i >= 0) { idx.ids.splice(i, 1); trCacheIndexSave(idx.ids); }
    }
    function trCacheLoad(paramId) {
      try {
        var raw = localStorage.getItem(trCacheKey(paramId));
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !obj.ts) return null;
        if (Date.now() - obj.ts > TR_CACHE_TTL) { trCacheInvalidate(paramId); return null; }
        return obj;
      } catch (e) { return null; }
    }
    function trCacheSave(paramId, paramNames, pvByLang) {
      // Defer (setTimeout 0) — JSON.stringify + setItem są synchroniczne i blokują wątek
      setTimeout(function () {
        try {
          localStorage.setItem(trCacheKey(paramId), JSON.stringify({ ts: Date.now(), paramNames: paramNames || {}, pvByLang: pvByLang || {} }));
          trCacheIndexAdd(paramId);
        } catch (e) {}
      }, 0);
    }
    function trCacheInvalidate(paramId) {
      try { localStorage.removeItem(trCacheKey(paramId)); } catch (e) {}
      trCacheIndexRemove(paramId);
    }
    function trCacheClearAll() {
      var idx = trCacheIndexLoad();
      idx.ids.forEach(function (id) { try { localStorage.removeItem(trCacheKey(id)); } catch (e) {} });
      try { localStorage.removeItem(TR_CACHE_INDEX_KEY); } catch (e) {}
    }
    // SMART DIFF: usuwa z cache paramy które już nie istnieją w drzewie
    function trCachePrune(currentIds) {
      var idx = trCacheIndexLoad();
      var toRemove = idx.ids.filter(function (id) { return currentIds.indexOf(id) < 0; });
      if (!toRemove.length) return 0;
      toRemove.forEach(function (id) { try { localStorage.removeItem(trCacheKey(id)); } catch (e) {} });
      var remaining = idx.ids.filter(function (id) { return currentIds.indexOf(id) >= 0; });
      trCacheIndexSave(remaining);
      return toRemove.length;
    }

    // v4.6.77: O(N×L) zamiast O(N²×L). Dla 400 values × 5 langs × 141 params
    // poprzednio ~113M ops (~kilka sekund blokowania), teraz ~282k (instant).
    function buildValueRecords(paramId, byLang, langsArr) {
      var seenIds = {}, orderedIds = [];
      var idxByLang = {}; // lang → {id: name} (O(1) lookup)
      for (var li = 0; li < langsArr.length; li++) {
        var lg = langsArr[li];
        var langKids = byLang[lg] || [];
        var idx = {};
        for (var ki = 0; ki < langKids.length; ki++) {
          var k = langKids[ki];
          idx[k.id] = k.name;
          if (!seenIds[k.id]) { seenIds[k.id] = true; orderedIds.push(k.id); }
        }
        idxByLang[lg] = idx;
      }
      var out = [];
      for (var oi = 0; oi < orderedIds.length; oi++) {
        var vid = orderedIds[oi];
        var nmsByLang = {};
        for (var lj = 0; lj < langsArr.length; lj++) {
          nmsByLang[langsArr[lj]] = idxByLang[langsArr[lj]][vid] || '';
        }
        out.push({ id: vid, type: 'value', parentId: paramId, names: nmsByLang });
      }
      return out;
    }

    function insertValuesUnderParam(paramId, values) {
      if (!bodyEl) return;
      // Usuń placeholder loading
      var phs = bodyEl.querySelectorAll('li.tp-tr-row-loading[data-pid="' + paramId + '"]');
      for (var pi = 0; pi < phs.length; pi++) phs[pi].remove();
      if (!values || !values.length) return;
      var paramRow = bodyEl.querySelector('li.panel-pro__row[data-id="' + paramId + '"][data-type="param"]');
      if (!paramRow) return;
      // Sortuj alfabetycznie po pol name
      values.sort(function (a, b) { return (a.names.pol || '').localeCompare(b.names.pol || '', 'pl', { sensitivity: 'base' }); });
      var gridCols = 'minmax(260px,1fr) ' + visibleLangs.map(function () { return 'minmax(280px,1fr)'; }).join(' ');
      var rowsHtml = '';
      for (var i = 0; i < values.length; i++) {
        var v = values[i];
        var vName = v.names.pol || ('ID ' + v.id);
        rowsHtml += '<li class="panel-pro__row tp-tr-row-value" data-id="' + esc(v.id) + '" data-type="value" data-name="' + esc(vName.toLowerCase()) + '" style="grid-template-columns:' + gridCols + ';">';
        rowsHtml += '<div><span class="tp-tr-elem-name"><span class="material-symbols-outlined">subdirectory_arrow_right</span><span>' + esc(vName) + '</span></span><span class="tp-tr-elem-id">#' + esc(v.id) + '</span></div>';
        for (var lj = 0; lj < visibleLangs.length; lj++) {
          var lg = visibleLangs[lj];
          var cv = esc(v.names[lg] || '');
          rowsHtml += '<div class="tp-tr-cell" data-id="' + esc(v.id) + '" data-lang="' + esc(lg) + '" data-orig="' + cv + '" data-current="' + cv + '">' +
            '<span class="tp-tr-cell-check" title="Zaznacz komórkę do skopiowania"></span>' +
            '<div class="tm-input-wrap"><span class="material-symbols-outlined tm-input-icon">title</span>' +
            '<span class="tp-tr-cell-text">' + cv + '</span>' +
            '</div>' +
          '</div>';
        }
        rowsHtml += '</li>';
      }
      paramRow.insertAdjacentHTML('afterend', rowsHtml);
    }

    function updateFooterStats() {
      var paramCnt = 0, valCnt = 0;
      for (var i = 0; i < loaded.length; i++) { if (loaded[i].type === 'param') paramCnt++; else valCnt++; }
      var s = paramCnt + ' parametrów · ' + valCnt + ' wartości · ' + visibleLangs.length + '/' + allLangs.length + ' języków';
      if (subEl) subEl.textContent = s;
      if (cardFooterEl) cardFooterEl.innerHTML = '<div class="panel-pro__footer__left">' + s + '</div>';
    }

    // PROGRESSIVE BATCH LOADING:
    // 1) Faza A: paramNames concurrency 30 → renderujemy TABELĘ z paramami + placeholderami
    // 2) Faza B: getTreeForLang per (param, lang); jak WSZYSTKIE langi danego paramu się
    //    skończą → wstawiamy jego wartości do DOM pod jego wierszem (incremental insert).
    // User widzi rosnącą tabelę w trakcie ładowania.
    function loadBatched() {
      var paramNames = {};
      // v4.6.77: NIE preloadujemy cache synchronicznie (każdy JSON.parse ~50-100ms,
      // 141 × ~75KB = 10-15s zablokowania wątku). Cache czytamy LAZY — per task w queue.
      var cachedParams = {}; // paramId -> {paramNames, pvByLang}

      // v4.6.78: SMART DIFF — usuń z cache paramy które już nie istnieją w drzewie
      var currentIds = paramList.map(function (p) { return p.id; });
      var prunedCount = trCachePrune(currentIds);
      if (prunedCount > 0 && _panel && _panel.showStatus) _panel.showStatus('Usunięto ' + prunedCount + ' nieistniejących parametrów z cache');

      if (ptextEl) ptextEl.textContent = 'Faza 1/2: wczytywanie nazw parametrów…';
      totalToLoad = paramList.length;
      doneCount = 0;
      updateProgress();
      return chunkAll(paramList, 30, function (p) {
        // Sprawdź cache lazy — kiedy task już startuje (więc rozłożone w czasie, nie blokuje startu)
        var cached = trCacheLoad(p.id);
        if (cached && cached.paramNames && Object.keys(cached.paramNames).length) {
          cachedParams[p.id] = cached;
          paramNames[p.id] = cached.paramNames;
          doneCount++; updateProgress();
          return Promise.resolve();
        }
        return fetchLangData(p.id).then(function (names) {
          paramNames[p.id] = names;
          doneCount++; updateProgress();
        }, function () { paramNames[p.id] = {}; doneCount++; updateProgress(); });
      }).then(function () {
        // Wykryj zbiór języków
        var langSet = {};
        Object.keys(paramNames).forEach(function (pid) { Object.keys(paramNames[pid] || {}).forEach(function (lg) { langSet[lg] = true; }); });
        var langsArr = Object.keys(langSet);
        if (!langsArr.length) langsArr = ['pol'];

        // Dodajemy paramy do loaded i renderujemy NATYCHMIAST (z placeholderami pod każdym)
        for (var ip = 0; ip < paramList.length; ip++) {
          var p = paramList[ip];
          loaded.push({ id: p.id, type: 'param', parentId: null, names: paramNames[p.id] || {} });
        }
        // v4.6.75: dla cached params od razu wstaw wartości do loaded + ustaw paramValuesLoaded
        Object.keys(cachedParams).forEach(function (pid) {
          var c = cachedParams[pid];
          if (c.pvByLang) {
            var values = buildValueRecords(pid, c.pvByLang, langsArr);
            for (var vi = 0; vi < values.length; vi++) loaded.push(values[vi]);
            paramValuesLoaded[pid] = true;
          }
        });
        renderTable(); // user widzi paramy + cached wartości + placeholdery dla niecached

        // Faza B: per (param, lang) — TYLKO dla niecached params
        var pvByLang = {};
        // Skopiuj cached pvByLang do pvByLang (dla późniejszego saveCache)
        Object.keys(cachedParams).forEach(function (pid) { if (cachedParams[pid].pvByLang) pvByLang[pid] = cachedParams[pid].pvByLang; });

        var uncachedParams = paramList.filter(function (p) { return !cachedParams[p.id]; });
        var tasks = [];
        for (var i2 = 0; i2 < uncachedParams.length; i2++) {
          for (var j2 = 0; j2 < langsArr.length; j2++) tasks.push({ paramId: uncachedParams[i2].id, lang: langsArr[j2] });
        }
        if (!tasks.length) return; // wszystko z cache — koniec
        if (ptextEl) ptextEl.textContent = 'Faza 2/2: wczytywanie wartości we wszystkich językach… (' + uncachedParams.length + ' parametrów × ' + langsArr.length + ' języków)';
        totalToLoad = tasks.length;
        doneCount = 0;
        updateProgress();

        var paramLangsRem = {};
        for (var ki = 0; ki < uncachedParams.length; ki++) paramLangsRem[uncachedParams[ki].id] = langsArr.length;

        return chunkAll(tasks, 30, function (t) {
          function tryFinishParam() {
            paramLangsRem[t.paramId]--;
            if (paramLangsRem[t.paramId] === 0) {
              var values = buildValueRecords(t.paramId, pvByLang[t.paramId] || {}, langsArr);
              for (var vi = 0; vi < values.length; vi++) loaded.push(values[vi]);
              paramValuesLoaded[t.paramId] = true;
              insertValuesUnderParam(t.paramId, values);
              updateFooterStats();
              // v4.6.75: zapisz do cache (param + jego pvByLang)
              trCacheSave(t.paramId, paramNames[t.paramId] || {}, pvByLang[t.paramId] || {});
            }
          }
          return getTreeForLang(t.paramId, t.lang).then(function (kids) {
            (pvByLang[t.paramId] = pvByLang[t.paramId] || {})[t.lang] = kids;
            doneCount++; updateProgress();
            tryFinishParam();
          }, function () {
            (pvByLang[t.paramId] = pvByLang[t.paramId] || {})[t.lang] = [];
            doneCount++; updateProgress();
            tryFinishParam();
          });
        });
      });
    }

    updateProgress();
    loadBatched().then(function () {
      // Wszystko załadowane — pasek progress znika (renderTable już wywołane po fazie A)
      if (ptextEl) ptextEl.textContent = '';
      var pwrap = modal.querySelector('.tp-tr-progress-wrap'); if (pwrap) pwrap.style.display = 'none';
      var lwrap = modal.querySelector('.tp-tr-loading'); if (lwrap) lwrap.style.display = 'none';
    }, function (e) { if (_panel) _panel.showStatus('Błąd ładowania: ' + (e && e.message || e), true); });

    // Render po załadowaniu
    var allLangs = [];        // wszystkie wykryte języki (zachowane w sortowaniu)
    var visibleLangs = [];    // do renderTable (after hiddenLangs filter)
    var hiddenLangs = (function () {
      try { var raw = localStorage.getItem('tp-translations-hidden-langs-v1'); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
    })();
    function isLangHidden(lg) { return hiddenLangs.indexOf(lg) >= 0; }
    function saveHiddenLangs() { try { localStorage.setItem('tp-translations-hidden-langs-v1', JSON.stringify(hiddenLangs)); } catch (e) {} }
    function computeLangs() {
      var set = {};
      loaded.forEach(function (item) { Object.keys(item.names || {}).forEach(function (lg) { set[lg] = true; }); });
      var order = ['pol','eng','ger','fra','ces','ukr','ita','esp','rus','lit','lav','est','nld','hun','swe','slk','slv','bul','hrv','rum','por','dan','fin','nor'];
      allLangs = Object.keys(set).sort(function (a, b) { var ia=order.indexOf(a), ib=order.indexOf(b); if (ia<0) ia=999; if (ib<0) ib=999; return (ia-ib) || a.localeCompare(b); });
      // Bezpiecznik: nigdy nie ukrywamy ostatniego widocznego języka
      visibleLangs = allLangs.filter(function (lg) { return !isLangHidden(lg); });
      if (!visibleLangs.length && allLangs.length) { hiddenLangs = []; saveHiddenLangs(); visibleLangs = allLangs.slice(); }
    }
    function renderLangsMenu() {
      var menu = modal.querySelector('#tp-tr-langs-menu');
      if (!menu) return;
      menu.innerHTML = '';
      allLangs.forEach(function (lg) {
        var label = d.createElement('label'); label.className = 'panel-pro__dropdown__check';
        var cb = d.createElement('input'); cb.type = 'checkbox'; cb.checked = !isLangHidden(lg); cb.dataset.lang = lg;
        cb.addEventListener('click', function (e) { e.stopPropagation(); });
        cb.addEventListener('change', function () {
          if (cb.checked) { hiddenLangs = hiddenLangs.filter(function (x) { return x !== lg; }); }
          else { if (hiddenLangs.indexOf(lg) < 0) hiddenLangs.push(lg); }
          saveHiddenLangs();
          renderTable(); // re-render z aktualnym visibleLangs
        });
        label.appendChild(cb);
        label.appendChild(d.createTextNode(' ' + getLangName(lg)));
        menu.appendChild(label);
      });
    }
    // v4.6.78: przycisk „Odśwież dane" — czyści cały cache + ponownie ładuje stronę
    (function wireRefreshBtn() {
      var btn = modal.querySelector('#tp-tr-refresh');
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (dirtyCount() > 0 && !confirm('Masz niezapisane zmiany. Odświeżyć mimo to (zmiany zostaną utracone)?')) return;
        if (!confirm('Wyczyścić cały cache i pobrać dane na nowo z serwera?')) return;
        trCacheClearAll();
        if (_panel && _panel.showStatus) _panel.showStatus('Cache wyczyszczony — wczytywanie ponowne…');
        // Zamknij stronę i otwórz na nowo (najprostsza pełna re-inicjalizacja)
        close();
        setTimeout(function () { showTranslationsPage(doc); }, 50);
      });
    })();

    // Toggle menu (klik na przycisk) + zamykanie po klik na zewnątrz
    (function wireLangsDropdown() {
      var dd = modal.querySelector('#tp-tr-langs-dd');
      if (!dd) return;
      var menu = dd.querySelector('#tp-tr-langs-menu');
      var btn = dd.querySelector('button');
      btn.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('panel-pro--open'); });
      d.addEventListener('click', function (e) { if (!e.target.closest('#tp-tr-langs-dd')) menu.classList.remove('panel-pro--open'); });
    })();
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
    var dirty = {}; // key 'id@lang' -> newValue
    function dirtyCount() { return Object.keys(dirty).length; }
    function updDirtyUi() {
      var n = dirtyCount();
      dcEl.textContent = String(n);
      saveBtn.disabled = (n === 0);
    }

    function renderTable() {
      computeLangs();
      // Sortuj loaded: parametry alfabetycznie (po pol name), wartości w obrębie parametru po pol name
      var paramItems = loaded.filter(function (it) { return it.type === 'param'; });
      var valueItems = loaded.filter(function (it) { return it.type === 'value'; });
      var valuesByParent = {};
      valueItems.forEach(function (v) { (valuesByParent[v.parentId] = valuesByParent[v.parentId] || []).push(v); });
      paramItems.sort(function (a, b) { return (a.names.pol || '').localeCompare(b.names.pol || '', 'pl', { sensitivity: 'base' }); });
      Object.keys(valuesByParent).forEach(function (k) {
        valuesByParent[k].sort(function (a, b) { return (a.names.pol || '').localeCompare(b.names.pol || '', 'pl', { sensitivity: 'base' }); });
      });

      // v4.6.75: LAZY HYDRATION. Komórka domyślnie pokazuje tekst (span). Klik → swap na input.
      // data-orig = wartość oryginalna; data-current = aktualna (po edycji/kopiowaniu).
      function cellHtml(id, lang, v) {
        var ev = esc(v || '');
        return '<div class="tp-tr-cell" data-id="' + esc(id) + '" data-lang="' + esc(lang) + '" data-orig="' + ev + '" data-current="' + ev + '">' +
          '<span class="tp-tr-cell-check" title="Zaznacz komórkę do skopiowania"></span>' +
          '<div class="tm-input-wrap"><span class="material-symbols-outlined tm-input-icon">title</span>' +
          '<span class="tp-tr-cell-text">' + ev + '</span>' +
          '</div>' +
        '</div>';
      }
      // Etykieta elementu: ikona subdirectory_arrow_right tylko dla wartości (jak na głównej).
      function elemNameHtml(name, id, isValue) {
        var arrow = isValue ? '<span class="material-symbols-outlined">subdirectory_arrow_right</span>' : '';
        return '<span class="tp-tr-elem-name">' + arrow + '<span>' + esc(name) + '</span></span><span class="tp-tr-elem-id">#' + esc(id) + '</span>';
      }
      // Grid template: kolumny rozciągają się (1fr) wypełniając widok; minimum 280px każda.
      // Pokazujemy tylko visibleLangs (po filtracji hiddenLangs z konfiguratora widoczności).
      // Gdy łączny min > viewport → scroll poziomy WEWNĄTRZ .tp-tr-card-body.
      var gridCols = 'minmax(260px,1fr) ' + visibleLangs.map(function () { return 'minmax(280px,1fr)'; }).join(' ');
      var html = '<div class="tp-tr-grid">';
      // Thead (te same klasy co główne drzewo)
      html += '<div class="panel-pro__header-wrapper"><div class="panel-pro__thead" style="grid-template-columns:' + gridCols + ';">';
      html += '<div class="panel-pro__col panel-pro__col--name">Element</div>';
      visibleLangs.forEach(function (lg) { html += '<div class="panel-pro__col">' + esc(getLangName(lg)) + '</div>'; });
      html += '</div></div>';
      // Rows (ul + li.panel-pro__row, te same klasy co główne drzewo)
      html += '<ul>';
      paramItems.forEach(function (p) {
        var pName = p.names.pol || ('ID ' + p.id);
        html += '<li class="panel-pro__row tp-tr-row-param" data-id="' + esc(p.id) + '" data-type="param" data-name="' + esc(pName.toLowerCase()) + '" style="grid-template-columns:' + gridCols + ';">';
        html += '<div>' + elemNameHtml(pName, p.id, false) + '</div>';
        visibleLangs.forEach(function (lg) { html += cellHtml(p.id, lg, p.names[lg]); });
        html += '</li>';
        var hasValuesLoaded = paramValuesLoaded[p.id];
        if (!hasValuesLoaded) {
          // Placeholder z animowanym spinnerem - wartości jeszcze ładują się w tle
          html += '<li class="tp-tr-row-loading" data-pid="' + esc(p.id) + '">Wczytywanie wartości…</li>';
        }
        (valuesByParent[p.id] || []).forEach(function (v) {
          var vName = v.names.pol || ('ID ' + v.id);
          html += '<li class="panel-pro__row tp-tr-row-value" data-id="' + esc(v.id) + '" data-type="value" data-name="' + esc(vName.toLowerCase()) + '" style="grid-template-columns:' + gridCols + ';">';
          html += '<div>' + elemNameHtml(vName, v.id, true) + '</div>';
          visibleLangs.forEach(function (lg) { html += cellHtml(v.id, lg, v.names[lg]); });
          html += '</li>';
        });
      });
      html += '</ul></div>';
      bodyEl.innerHTML = html;
      // Re-aplikuj selekcję komórek (cellEl-e zniknęły po innerHTML; jeśli kolumna
      // ukryta, usuwamy z selectedCells).
      Object.keys(selectedCells).forEach(function (k) {
        var s = selectedCells[k];
        var nc = bodyEl.querySelector('.tp-tr-cell[data-id="' + s.id + '"][data-lang="' + s.lang + '"]');
        if (nc) { s.cellEl = nc; nc.classList.add('tp-tr-selected'); }
        else delete selectedCells[k];
      });
      if (!selCount()) selectionLang = null;
      updateSelbar();
      var summaryTxt = paramItems.length + ' parametrów · ' + valueItems.length + ' wartości · ' + visibleLangs.length + '/' + allLangs.length + ' języków';
      subEl.textContent = summaryTxt;
      if (cardFooterEl) cardFooterEl.innerHTML = '<div class="panel-pro__footer__left">' + summaryTxt + '</div>';
      renderLangsMenu();

      // LAZY HYDRATION: klik na komórkę → swap span→input + focus; blur → swap z powrotem
      bodyEl.addEventListener('click', function (ev) {
        // Pomiń kliknięcie na checkbox selekcji (osobny handler)
        if (ev.target.closest('.tp-tr-cell-check')) return;
        // Pomiń klik w już-hydrowany input
        if (ev.target.closest('input.tp-tr-input')) return;
        var cellEl = ev.target.closest('.tp-tr-cell');
        if (!cellEl) return;
        hydrateCell(cellEl);
      });

      function hydrateCell(cellEl) {
        var wrap = cellEl.querySelector('.tm-input-wrap');
        if (!wrap || wrap.querySelector('input.tp-tr-input')) return;
        var span = wrap.querySelector('.tp-tr-cell-text');
        var current = cellEl.dataset.current || '';
        var input = d.createElement('input');
        input.type = 'text';
        input.className = 'tm-node-text-input tp-tr-input';
        input.value = current;
        input.dataset.id = cellEl.dataset.id;
        input.dataset.lang = cellEl.dataset.lang;
        input.dataset.orig = cellEl.dataset.orig || '';
        if (span) span.replaceWith(input); else wrap.appendChild(input);
        try { input.focus(); input.select(); } catch (e) {}

        input.addEventListener('input', function () {
          var newVal = input.value;
          cellEl.dataset.current = newVal;
          var k = cellEl.dataset.id + '@' + cellEl.dataset.lang;
          var orig = cellEl.dataset.orig || '';
          if (newVal === orig) {
            delete dirty[k];
            wrap.classList.remove('tp-tr-dirty');
          } else {
            dirty[k] = { id: cellEl.dataset.id, lang: cellEl.dataset.lang, val: newVal, el: cellEl };
            wrap.classList.add('tp-tr-dirty');
            wrap.classList.remove('tp-tr-saved', 'tp-tr-error');
          }
          updDirtyUi();
          if (filterMode === 'dirty' || filterMode === 'clean') applyFilters();
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); input.blur(); }
        });
        input.addEventListener('blur', function () {
          var newVal = input.value;
          cellEl.dataset.current = newVal;
          // Swap input → span (z aktualną wartością)
          var ns = d.createElement('span');
          ns.className = 'tp-tr-cell-text';
          ns.textContent = newVal;
          input.replaceWith(ns);
        });
      }

      applyFilters();
    }

    // Tryb filtra pól
    var filterMode = 'all';
    var filterEl = modal.querySelector('#tp-tr-filter');
    // Listenery PRZED renderTable — atakowalne nawet jeśli renderTable jeszcze nie odpalił.
    // Wcześniej były wewnątrz renderTable — przy każdym wywołaniu dodawały duplikat
    // i nie były aktywne gdy ładowanie trwało lub padło.
    searchEl.addEventListener('input', function () { try { applyFilters(); } catch (e) {} });
    filterEl.addEventListener('change', function () { filterMode = filterEl.value; try { applyFilters(); } catch (e) {} });

    // === BULK COPY: selekcja komórek + kopiowanie do wybranych języków ===
    var selectedCells = {}; // key 'id@lang' -> { id, lang, cellEl }
    var selectionLang = null;
    function selCount() { return Object.keys(selectedCells).length; }
    function clearSelection() {
      Object.keys(selectedCells).forEach(function (k) { var s = selectedCells[k]; if (s.cellEl) s.cellEl.classList.remove('tp-tr-selected'); });
      selectedCells = {};
      selectionLang = null;
      updateSelbar();
      closeCopyTarget();
    }
    function toggleCellSelection(cellEl, id, lang) {
      var key = id + '@' + lang;
      if (selectedCells[key]) {
        delete selectedCells[key];
        cellEl.classList.remove('tp-tr-selected');
        if (!selCount()) selectionLang = null;
      } else {
        // Auto-clear jeśli zmiana języka źródłowego
        if (selectionLang && selectionLang !== lang) clearSelection();
        selectedCells[key] = { id: id, lang: lang, cellEl: cellEl };
        selectionLang = lang;
        cellEl.classList.add('tp-tr-selected');
      }
      updateSelbar();
    }
    function updateSelbar() {
      var bar = modal.querySelector('#tp-tr-selbar');
      if (!bar) return;
      var n = selCount();
      if (n === 0) { bar.classList.remove('tp-tr-selbar--visible'); return; }
      bar.classList.add('tp-tr-selbar--visible');
      var txt = bar.querySelector('.tp-tr-selbar-text');
      if (txt) txt.innerHTML = '<span class="tp-tr-selbar-count">' + n + '</span>zaznaczonych w „<strong>' + esc(getLangName(selectionLang)) + '</strong>"';
    }

    function openCopyTarget() {
      var pop = modal.querySelector('#tp-tr-copytarget');
      if (!pop || !selCount()) return;
      // Lista języków docelowych — z visibleLangs lub allLangs jeśli nic widocznego
      var srcList = (visibleLangs && visibleLangs.length ? visibleLangs : allLangs).filter(function (lg) { return lg !== selectionLang; });
      if (!srcList.length) srcList = allLangs.filter(function (lg) { return lg !== selectionLang; });
      var html = '<div class="tp-tr-copytarget-title">Kopiuj z „' + esc(getLangName(selectionLang)) + '" do:</div>';
      html += '<div class="tp-tr-copytarget-helper">' + selCount() + ' zaznaczonych komórek. Wybierz docelowe języki:</div>';
      html += '<div class="tp-tr-copytarget-quick"><button type="button" data-act="all">Zaznacz wszystkie</button><button type="button" data-act="none">Odznacz</button></div>';
      html += '<div class="tp-tr-copytarget-list">';
      srcList.forEach(function (lg) {
        html += '<label><input type="checkbox" data-lang="' + esc(lg) + '"> ' + esc(getLangName(lg)) + '</label>';
      });
      html += '</div>';
      html += '<div class="tp-tr-copytarget-actions"><button type="button" class="tp-tr-btn tp-tr-btn-cancel" id="tp-tr-copytarget-cancel">Anuluj</button><button type="button" class="tp-tr-btn tp-tr-btn-save" id="tp-tr-copytarget-apply">Kopiuj</button></div>';
      pop.innerHTML = html;
      pop.style.display = '';
      pop.querySelector('#tp-tr-copytarget-cancel').addEventListener('click', closeCopyTarget);
      pop.querySelector('#tp-tr-copytarget-apply').addEventListener('click', applyCopyTarget);
      pop.querySelectorAll('.tp-tr-copytarget-quick button').forEach(function (b) {
        b.addEventListener('click', function () {
          var on = b.dataset.act === 'all';
          pop.querySelectorAll('.tp-tr-copytarget-list input[type=checkbox]').forEach(function (cb) { cb.checked = on; });
        });
      });
    }
    function closeCopyTarget() {
      var pop = modal.querySelector('#tp-tr-copytarget');
      if (pop) pop.style.display = 'none';
    }
    function applyCopyTarget() {
      var pop = modal.querySelector('#tp-tr-copytarget');
      if (!pop) return;
      var checkedLangs = [];
      pop.querySelectorAll('.tp-tr-copytarget-list input[type=checkbox]:checked').forEach(function (cb) { checkedLangs.push(cb.dataset.lang); });
      if (!checkedLangs.length) { alert('Wybierz przynajmniej jeden język docelowy.'); return; }
      var copiedCells = 0;
      // v4.6.75: pracujemy na cellEl + data-current (lazy hydration — większość cell to spany, nie inputy).
      Object.keys(selectedCells).forEach(function (key) {
        var sel = selectedCells[key];
        if (!sel.cellEl) return;
        // Aktualna wartość źródłowej komórki (z hydrowanego inputu jeśli edytowana, lub z data-current)
        var srcInput = sel.cellEl.querySelector('input.tp-tr-input');
        var value = srcInput ? srcInput.value : (sel.cellEl.dataset.current || '');
        checkedLangs.forEach(function (tgt) {
          var tgtCell = bodyEl.querySelector('.tp-tr-cell[data-id="' + sel.id + '"][data-lang="' + tgt + '"]');
          if (!tgtCell) return;
          var curr = tgtCell.dataset.current || '';
          if (curr === value) return;
          // Aktualizuj wartość
          tgtCell.dataset.current = value;
          var tgtInputEl = tgtCell.querySelector('input.tp-tr-input');
          var tgtSpan = tgtCell.querySelector('.tp-tr-cell-text');
          if (tgtInputEl) { tgtInputEl.value = value; tgtInputEl.dispatchEvent(new Event('input', { bubbles: true })); }
          else if (tgtSpan) tgtSpan.textContent = value;
          // Dirty state
          var k = sel.id + '@' + tgt;
          var orig = tgtCell.dataset.orig || '';
          var wrap = tgtCell.querySelector('.tm-input-wrap');
          if (value !== orig) {
            dirty[k] = { id: sel.id, lang: tgt, val: value, el: tgtCell };
            if (wrap) { wrap.classList.add('tp-tr-dirty'); wrap.classList.remove('tp-tr-saved', 'tp-tr-error'); }
          } else {
            delete dirty[k];
            if (wrap) wrap.classList.remove('tp-tr-dirty');
          }
          copiedCells++;
        });
      });
      updDirtyUi();
      if (filterMode === 'dirty' || filterMode === 'clean') applyFilters();
      closeCopyTarget();
      if (_panel && _panel.showStatus) _panel.showStatus('Skopiowano do ' + checkedLangs.length + ' języków (' + copiedCells + ' komórek). Kliknij „Zapisz wszystkie" aby zatwierdzić.');
    }

    // Event delegation: klik w checkbox komórki + klik na guziki paska
    function wireSelection() {
      bodyEl.addEventListener('click', function (ev) {
        var check = ev.target.closest('.tp-tr-cell-check');
        if (!check) return;
        ev.stopPropagation(); ev.preventDefault();
        var cell = check.closest('.tp-tr-cell');
        if (cell) toggleCellSelection(cell, cell.dataset.id, cell.dataset.lang);
      });
      var clearBtn = modal.querySelector('#tp-tr-sel-clear');
      if (clearBtn) clearBtn.addEventListener('click', clearSelection);
      var copyBtn = modal.querySelector('#tp-tr-sel-copy');
      if (copyBtn) copyBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var pop = modal.querySelector('#tp-tr-copytarget');
        if (pop && pop.style.display !== 'none') closeCopyTarget(); else openCopyTarget();
      });
      // Klik poza popoverem — zamykaj
      d.addEventListener('click', function (ev) {
        var pop = modal.querySelector('#tp-tr-copytarget');
        if (!pop || pop.style.display === 'none') return;
        if (ev.target.closest('#tp-tr-copytarget') || ev.target.closest('#tp-tr-sel-copy')) return;
        closeCopyTarget();
      });
    }
    wireSelection();

    function parseTokens(q) {
      if (!q) return [];
      // Split po | lub , — usuwamy puste
      var raw = q.split(/[|,]/);
      var out = [];
      for (var i = 0; i < raw.length; i++) { var t = raw[i].trim().toLowerCase(); if (t) out.push(t); }
      return out;
    }
    function rowMatchesTokens(r, tokens) {
      if (!tokens.length) return true;
      var id = (r.dataset.id || '').toLowerCase();
      // v4.6.63: data-name na <li> ustawiane w renderTable (zawiera czystą nazwę pol).
      // Fallback: pierwszy <div> rzędu (omija material-symbols text z ikony L-arrow).
      var name = (r.dataset.name || '').toLowerCase();
      if (!name) {
        var firstDiv = r.querySelector(':scope > div');
        var nameSpan = firstDiv && firstDiv.querySelector('.tp-tr-elem-name > span:last-child');
        name = (nameSpan ? nameSpan.textContent : (firstDiv ? firstDiv.textContent : '')).toLowerCase();
      }
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (name.indexOf(t) >= 0 || id.indexOf(t) >= 0) return true;
      }
      return false;
    }
    function rowMatchesFieldFilter(r, mode) {
      if (mode === 'all') return true;
      // v4.6.75: lazy hydration — czytamy data-current/data-orig z cellEl, nie z input.value
      var cells = r.querySelectorAll('.tp-tr-cell');
      for (var i = 0; i < cells.length; i++) {
        var v = cells[i].dataset.current || '';
        var o = cells[i].dataset.orig || '';
        if (mode === 'dirty' && v !== o) return true;
        if (mode === 'clean' && v === o) return true;
        if (mode === 'empty' && v === '') return true;
      }
      return false;
    }
    function applyFilters() {
      var mode = filterEl.value || 'all';
      filterMode = mode;
      var tokens = parseTokens(searchEl.value);
      var rows = bodyEl.querySelectorAll('li.panel-pro__row');
      // Pierwszy przebieg: oznacz rzędy które match'ują samodzielnie
      var selfMatch = {}; // id -> true
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (rowMatchesTokens(r, tokens) && rowMatchesFieldFilter(r, mode)) selfMatch[r.dataset.id] = true;
      }
      // Drugi przebieg: pokaż także powiązanego parametru/wartość (parametr widoczny gdy jakaś wartość matchuje; wartość widoczna gdy parametr matchuje)
      for (var j = 0; j < rows.length; j++) {
        var rr = rows[j];
        var show = !!selfMatch[rr.dataset.id];
        if (!show && rr.dataset.type === 'param') {
          var nx = rr.nextElementSibling;
          while (nx && nx.dataset && nx.dataset.type === 'value') { if (selfMatch[nx.dataset.id]) { show = true; break; } nx = nx.nextElementSibling; }
        }
        if (!show && rr.dataset.type === 'value') {
          var prev = rr.previousElementSibling;
          while (prev && prev.dataset && prev.dataset.type === 'value') prev = prev.previousElementSibling;
          if (prev && selfMatch[prev.dataset.id]) show = true;
        }
        rr.style.display = show ? '' : 'none';
      }
    }

    // Save all
    saveBtn.addEventListener('click', function () {
      var items = Object.keys(dirty).map(function (k) { return dirty[k]; });
      if (!items.length) return;
      saveBtn.disabled = true; saveBtn.textContent = 'Zapisywanie 0/' + items.length + '…';
      // Grupuj po id: nazwy[lang] do jednego setSettings request
      var byId = {};
      items.forEach(function (it) { (byId[it.id] = byId[it.id] || []).push(it); });
      var groupKeys = Object.keys(byId);
      var groupDone = 0;
      function saveGroup(i) {
        if (i >= groupKeys.length) {
          saveBtn.textContent = 'Zapisz wszystkie'; saveBtn.disabled = (dirtyCount() === 0);
          if (_panel) _panel.showStatus('Zapisano ' + groupDone + '/' + groupKeys.length + ' elementów');
          return;
        }
        var id = groupKeys[i]; var arr = byId[id];
        var body = 'action=setSettings&id=' + encodeURIComponent(id) + '&menuSection=true';
        arr.forEach(function (it) {
          body += '&names[' + it.lang + ']=' + encodeURIComponent(it.val);
          // v4.6.75: it.el = cellEl; wrap to .tm-input-wrap wewnątrz niej
          var w = it.el.querySelector ? it.el.querySelector('.tm-input-wrap') : null;
          if (w) { w.classList.remove('tp-tr-dirty', 'tp-tr-error'); w.classList.add('tp-tr-saving'); }
        });
        fetchAjax(body).then(function (r) {
          if (r && r.errno && r.errno !== 0) throw new Error(r.message || ('errno ' + r.errno));
          arr.forEach(function (it) {
            var w = it.el.querySelector ? it.el.querySelector('.tm-input-wrap') : null;
            if (w) { w.classList.remove('tp-tr-saving'); w.classList.add('tp-tr-saved'); }
            // Aktualizuj orig (teraz "czysta"). data-current zostaje.
            it.el.dataset.orig = it.val;
            // Update span text jeśli istnieje (komórka nie jest hydrowana)
            var span = it.el.querySelector('.tp-tr-cell-text');
            if (span) span.textContent = it.val;
            // Update input.dataset.orig jeśli komórka jest hydrowana
            var inp = it.el.querySelector('input.tp-tr-input');
            if (inp) inp.dataset.orig = it.val;
            delete dirty[it.id + '@' + it.lang];
          });
          // v4.6.75: invalidate cache dla zapisanego elementu (id to paramId LUB valueId)
          // Dla bezpieczeństwa: invalidate cały param (per param-id) — w obu przypadkach
          // unieważnia zarówno bezpośredni paramId jak i parent-paramId danej wartości.
          trCacheInvalidate(id);
          // Jeśli zapisana wartość — invalidate cache jej parametru
          var firstEl = arr[0] && arr[0].el;
          if (firstEl) {
            var rowLi = firstEl.closest('li.panel-pro__row');
            if (rowLi && rowLi.dataset.type === 'value') {
              // Znajdź najbliższy poprzedzający parametr w drzewie
              var prevRow = rowLi.previousElementSibling;
              while (prevRow) {
                if (prevRow.dataset && prevRow.dataset.type === 'param') { trCacheInvalidate(prevRow.dataset.id); break; }
                prevRow = prevRow.previousElementSibling;
              }
            }
          }
          groupDone++;
          saveBtn.textContent = 'Zapisywanie ' + (i + 1) + '/' + groupKeys.length + '…';
          updDirtyUi();
          saveGroup(i + 1);
        }, function (err) {
          arr.forEach(function (it) { var w = it.el.querySelector ? it.el.querySelector('.tm-input-wrap') : null; if (w) { w.classList.remove('tp-tr-saving'); w.classList.add('tp-tr-error'); } });
          if (_panel) _panel.showStatus('Błąd zapisu ID=' + id + ': ' + (err && err.message || err), true);
          saveGroup(i + 1);
        });
      }
      saveGroup(0);
    });
  }

  // v4.6.110: edytor filtrow wartosci — zapis i renderowanie (zakladka Filtrowanie w showEditElementModal)
  // Endpoint: parameters.php (tree=parameters). Flow: editNodeShopData filter_default + setNodeFilters.
  // Zweryfikowane na demo37 (patrz pamiec project_value_navigation_node_api FILTRY).

  function _filtersEditShopBody(d, shop, lang, nodeId, filterDefault) {
    var hasMeta = !!(d.meta_title || d.meta_description || d.meta_keywords);
    var view = (d.display_limit || d.sort || (d.display_mode && d.display_mode_default && d.display_mode !== d.display_mode_default)) ? 'own' : 'default';
    return 'action=editNodeShopData&node_type=false&filter_default=' + filterDefault + '&target=false' +
      '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(shop) +
      '&tree=parameters&node=' + encodeURIComponent(nodeId) + '&view=' + view + '&parent=0' +
      '&click_action=false&element_hidden=false&displayShowAll=false&showAllIs=false&expand=false' +
      '&node_gfx=false&gfx_active_type=false&gfx_inactive_type=false&gfx_omo_type=false&gfx_type=false' +
      '&meta_default=' + (hasMeta ? 'n' : 'y') +
      '&meta_keywords=' + encodeURIComponent(d.meta_keywords || '') +
      '&meta_title=' + encodeURIComponent(d.meta_title || '') +
      '&meta_desc=' + encodeURIComponent(d.meta_description || '') +
      '&meta_index=' + (d.meta_robots_index || 'default') +
      '&meta_follow=' + (d.meta_robots_follow || 'default') +
      '&headline_name=' + encodeURIComponent(d.headline_name || '');
  }

  async function saveValueFiltersDefault(nodeId, shop, lang) {
    var r = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(shop) + '&tree=parameters&parent=0');
    var d = (r && r.data) || {};
    return fetchAjax(_filtersEditShopBody(d, shop, lang, nodeId, 'y'));
  }

  async function saveValueFilters(nodeId, shop, lang, activeIds, pricestep, pricestepnet, perOpts) {
    var r = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(shop) + '&tree=parameters&parent=0');
    var d = (r && r.data) || {};
    // 1) przelacz na tryb wlasny
    await fetchAjax(_filtersEditShopBody(d, shop, lang, nodeId, 'n'));
    // 2) zbuduj filter_sort jak natywny IAI._navigationNode.getFilterActive(shop)
    var parts = [];
    for (var i = 0; i < activeIds.length; i++) {
      parts.push('filter_' + shop + '_active_sort[' + activeIds[i] + ']');
    }
    var filterSort = parts.join(',');
    // v4.6.165: filter_pricestepnet usuniete (bug po stronie IdoSell — nie obsluguje dla tree=parameters)
    var body = 'action=setNodeFilters&node=' + encodeURIComponent(nodeId) +
      '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(shop) +
      '&tree=parameters&products_types_all=' +
      '&filter_sort=' + encodeURIComponent(filterSort) +
      '&filter_pricestep=' + encodeURIComponent(pricestep || '10');

    // v4.6.167: natywny format payload (potwierdzone live na demo37):
    // filter_name[<id>], filter_display[<id>], filter_default_enabled[<id>], filter_alphabetical[<id>]
    if (perOpts) {
      for (var fid in perOpts) {
        var op = perOpts[fid]; if (!op) continue;
        if (op.custom_name) body += '&filter_name[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(op.custom_name);
        if (op.display) body += '&filter_display[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(op.display);
        if (op.default_enabled) body += '&filter_default_enabled[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(op.default_enabled);
        if (op.alphabetical) body += '&filter_alphabetical[' + encodeURIComponent(fid) + ']=' + encodeURIComponent(op.alphabetical);
        if (op.pricerange) for (var prC in op.pricerange) {
          var prObj = op.pricerange[prC] || {};
          for (var prF in prObj) body += '&filter_pricerange[' + encodeURIComponent(prC) + '][' + encodeURIComponent(prF) + ']=' + encodeURIComponent(prObj[prF]);
        }
      }
    }
    return fetchAjax(body);
  }

  async function renderValueFiltersEditor(host, doc, nodeId, shop, lang) {
    if (!host) return;
    host.innerHTML = '<div class="tp-fv-loading">Ładowanie filtrów…</div>';
    var r;
    try {
      r = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(shop) + '&tree=parameters&parent=0');
    } catch (e) {
      host.innerHTML = '<div class="tp-fv-error">Błąd ładowania filtrów: ' + escapeHtml(String(e && e.message || e)) + '</div>';
      return;
    }
    var d = (r && r.data) || {};
    var filter = d.filter || { active: [], src: [], defaults: [] };
    var initActive = Array.isArray(filter.active) ? filter.active.slice() : [];
    var initSrc = Array.isArray(filter.src) ? filter.src.slice() : [];
    var pricestep = (d.filter_pricestep != null && d.filter_pricestep !== '') ? String(d.filter_pricestep) : '10';
    var pricestepnet = (d.filter_pricestepnet != null && d.filter_pricestepnet !== '') ? String(d.filter_pricestepnet) : '10';
    var isDefault = !!d.filter_default;

    var stateActive = initActive.slice();
    var stateSrc = initSrc.slice();

    // v4.6.125: load _filterPerFilterOpts (global, jak w Menu) z odpowiedzi getNode.
    _filterPerFilterOpts = {};
    _filterDefaultNames = {};
    var _loadObj = function (key, prop) {
      if (d[key] && typeof d[key] === 'object') {
        for (var k in d[key]) if (d[key][k] != null && d[key][k] !== '') {
          if (!_filterPerFilterOpts[k]) _filterPerFilterOpts[k] = {};
          _filterPerFilterOpts[k][prop] = d[key][k];
        }
      }
    };
    _loadObj('filter_name', 'custom_name');
    _loadObj('filter_display', 'display');
    _loadObj('filter_default_enabled', 'default_enabled');
    _loadObj('filter_alphabetical', 'alphabetical');
    // Pricerange: d.filter_pricerange = { CUR: { minPrice, range, maxPrice } } → pricerange_0
    if (d.filter_pricerange && typeof d.filter_pricerange === 'object') {
      if (!_filterPerFilterOpts['pricerange_0']) _filterPerFilterOpts['pricerange_0'] = {};
      _filterPerFilterOpts['pricerange_0'].pricerange = d.filter_pricerange;
    }
    if (d.filter_pricerangenet && typeof d.filter_pricerangenet === 'object') {
      if (!_filterPerFilterOpts['pricerangenet_0']) _filterPerFilterOpts['pricerangenet_0'] = {};
      _filterPerFilterOpts['pricerangenet_0'].pricerangenet = d.filter_pricerangenet;
    }
    // Default names z filter.active/src (do podgladu w dialogu)
    for (var _di = 0; _di < initActive.length; _di++) _filterDefaultNames[initActive[_di].id] = initActive[_di].name;
    for (var _ds = 0; _ds < initSrc.length; _ds++) _filterDefaultNames[initSrc[_ds].id] = initSrc[_ds].name;

    function buildHtml() {
      var html = '<div class="tp-fv-wrap">';
      html += '<div class="tp-gfx-subfield">';
      html += '<span class="tm-field-label">Ustawienia filtrów</span>';
      html += '<div class="tm-input-wrap"><span class="material-symbols-outlined tm-input-icon">filter_alt</span>';
      html += '<select class="tm-field-select tp-fv-mode-sel" name="tpfv_mode_' + nodeId + '">';
      html += '<option value="default"' + (isDefault ? ' selected' : '') + '>Użyj ustawień domyślnych</option>';
      html += '<option value="custom"' + (isDefault ? '' : ' selected') + '>Niestandardowy zestaw filtrów</option>';
      html += '</select></div>';
      html += '</div>';
      html += '<div class="tp-fv-editor"' + (isDefault ? ' style="display:none"' : '') + '>';
      html += '<div class="tp-fv-cols">';
      html += '<div class="tp-fv-col"><div class="tp-fv-col-title">Aktywne (<span class="tp-fv-cnt-a">0</span>)</div><div class="tp-fv-list tp-fv-list-active"></div></div>';
      html += '<div class="tp-fv-col"><div class="tp-fv-col-title">Dostępne (<span class="tp-fv-cnt-s">0</span>)</div><div class="tp-fv-list tp-fv-list-src"></div></div>';
      html += '</div>';
      // v4.6.130: 2 pola pricestep (brutto + netto) z hint barem — jak w Menu
      html += '<div class="tm-fe-hint-bar tm-fe-hint-bar--inline" style="margin:14px 0 8px">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        '<span>Minimalna r\u00f3\u017cnica ceny okre\u015bla krok przedzia\u0142\u00f3w cenowych. Warto\u015b\u0107 <b>0</b> = automatyczny podzia\u0142.</span>' +
      '</div>';
      html += '<div class="tm-fe-pricestep-row">';
      // v4.6.165: tylko pole brutto. Natywny panel IdoSell tez pokazuje "undefined" dla netto
      // (zweryfikowane na demo37 \u2014 fg_filter_pricestepnet.value === "undefined" string literal).
      // Backend nie zwraca filter_pricestepnet w getNode response \u2014 bug po stronie IdoSell.
      html += '<div class="tm-fe-pricestep-field"><span class="tm-fe-pricestep-label">Minimalna r\u00f3\u017cnica ceny:</span><input id="tpfv_ps_' + nodeId + '" type="number" min="0" value="' + escapeHtml(pricestep) + '" class="tm-fe-input-full"></div>';
      html += '</div>';
      html += '</div>';
      html += '</div>';
      return html;
    }

    host.innerHTML = buildHtml();
    var elA = host.querySelector('.tp-fv-list-active');
    var elS = host.querySelector('.tp-fv-list-src');
    var cntA = host.querySelector('.tp-fv-cnt-a');
    var cntS = host.querySelector('.tp-fv-cnt-s');
    var editor = host.querySelector('.tp-fv-editor');
    var psInput = host.querySelector('#tpfv_ps_' + nodeId);

    function badgeFor(filterId) {
      var op = _filterPerFilterOpts[filterId];
      if (!op) return '';
      var bits = [];
      if (op.custom_name) bits.push('nazwa: ' + op.custom_name);
      if (op.display && op.display !== 'name') bits.push('forma: ' + op.display);
      if (op.default_enabled === 'y') bits.push('domyślnie wł.');
      if (op.alphabetical === 'y') bits.push('sortowanie alfa');
      if (op.pricerange) bits.push('przedziały');
      return bits.length ? '<span class="tm-fe-filter-badge">' + escapeHtml('(' + bits.join(', ') + ')') + '</span>' : '';
    }
    // v4.6.126: wiersz w stylu Menu (tm-fe-filter-row + tm-fe-filter-action--{edit,remove,add})
    var SVG_EDIT = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    var SVG_TRASH = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
    function rowHtml(f, idx, isActive) {
      var rmOrAdd = isActive
        ? '<button type="button" class="tm-fe-filter-action tm-fe-filter-action--remove" data-act="rm" title="Usuń">' + SVG_TRASH + '</button>'
        : '<button type="button" class="tm-fe-filter-action tm-fe-filter-action--add" data-act="add" title="Dodaj">+</button>';
      return '<div class="tm-fe-filter-row" data-idx="' + idx + '">' +
        '<span class="tm-fe-filter-row-name">' + escapeHtml(f.name) + '</span>' +
        badgeFor(f.id) +
        '<button type="button" class="tm-fe-filter-action tm-fe-filter-action--edit" data-act="edit" title="Edytuj">' + SVG_EDIT + '</button>' +
        rmOrAdd +
      '</div>';
    }
    function renderLists() {
      var html, i, f;
      if (stateActive.length === 0) {
        html = '<div class="tp-fv-empty">Brak aktywnych filtrów</div>';
      } else {
        html = '';
        for (i = 0; i < stateActive.length; i++) html += rowHtml(stateActive[i], i, true);
      }
      elA.innerHTML = html;
      if (stateSrc.length === 0) {
        html = '<div class="tp-fv-empty">Wszystkie filtry aktywne</div>';
      } else {
        html = '';
        for (i = 0; i < stateSrc.length; i++) html += rowHtml(stateSrc[i], i, false);
      }
      elS.innerHTML = html;
      cntA.textContent = String(stateActive.length);
      cntS.textContent = String(stateSrc.length);
      // wire buttons
      function wire(listEl, arr, otherArr) {
        var rows = listEl.querySelectorAll('.tm-fe-filter-row');
        for (var k = 0; k < rows.length; k++) (function (row) {
          var idx = parseInt(row.getAttribute('data-idx'), 10);
          var f = arr[idx];
          var rmAdd = row.querySelector('.tm-fe-filter-action--remove, .tm-fe-filter-action--add');
          var editBtn = row.querySelector('.tm-fe-filter-action--edit');
          if (rmAdd) rmAdd.addEventListener('click', function () {
            var moved = arr.splice(idx, 1)[0];
            if (moved) otherArr.push(moved);
            renderLists();
          });
          if (editBtn) editBtn.addEventListener('click', function () {
            openFilterEditDialog(doc, f.id, f.name, function () { renderLists(); });
          });
        })(rows[k]);
      }
      wire(elA, stateActive, stateSrc);
      wire(elS, stateSrc, stateActive);
    }
    renderLists();

    // przelacznik trybu (v4.6.121: select zamiast radio)
    var modeSel = host.querySelector('.tp-fv-mode-sel');
    if (modeSel) {
      modeSel.addEventListener('change', function () {
        editor.style.display = (modeSel.value === 'custom') ? '' : 'none';
      });
    }

    // v4.6.111: zwracamy handle — zapis dokonywany przez doSave modalu
    return {
      getMode: function () {
        return modeSel ? modeSel.value : 'default';
      },
      getActiveIds: function () {
        var ids = [];
        for (var k = 0; k < stateActive.length; k++) ids.push(stateActive[k].id);
        return ids;
      },
      getPricestep: function () {
        return (psInput && psInput.value) || '10';
      },
      // v4.6.125: per-filter options (custom_name, display, default_enabled, pricerange[_net])
      getPerOpts: function () { return _filterPerFilterOpts; }
    };
  }


  // ═════════════════════════════════════════════════════════════════════════
  // v4.6.125: EDYTOR FILTROW per-filter — transfer 1:1 z modulu Menu
  // (J:\IdoSell\Menu\src\53-filter-ui-helpers.js). Obejmuje:
  //   - filterPerFilterOpts / filterDefaultNames (storage)
  //   - openFilterEditDialog (modal: nazwa wlasna + opcjonalnie display + default_enabled)
  //   - openPriceRangeFilterDialog (modal: nazwa + przedzialy cen per waluta PLN/EUR/GBP)
  //   - helpers createFE* (radio, modal shell, name block, spinner input)
  // CSS tm-fe-* dodane do injectStyles.
  // ═════════════════════════════════════════════════════════════════════════
  var _filterPerFilterOpts = {};
  var _filterDefaultNames = {};
  var FILTER_HAS_DISPLAY = ['producers_0', 'series_0'];
  var FILTER_HAS_DEFAULT_ENABLED = ['instock_0', 'availability_0', 'promotion_0', 'distinguished_0', 'discount_0', 'special_0', 'new_0', 'bestseller_0', 'bonus_0'];

  function _feCreateRadioEl(doc, groupName, value, labelText, isChecked) {
    var lbl = doc.createElement('label');
    lbl.className = 'tm-fe-radio-option';
    var inp = doc.createElement('input');
    inp.type = 'radio'; inp.name = groupName; inp.value = value;
    if (isChecked) inp.checked = true;
    var inner = doc.createElement('div'); inner.className = 'tm-fe-radio-inner';
    var dot = doc.createElement('div'); dot.className = 'tm-fe-radio-dot';
    var dotInner = doc.createElement('div'); dotInner.className = 'tm-fe-radio-dot-inner';
    dot.appendChild(dotInner);
    var txt = doc.createElement('span'); txt.className = 'tm-fe-radio-text'; txt.textContent = labelText;
    inner.appendChild(dot); inner.appendChild(txt);
    lbl.appendChild(inp); lbl.appendChild(inner);
    return lbl;
  }
  function _feCreateModalShell(doc, subtitle, widthClass) {
    var overlay = doc.createElement('div'); overlay.className = 'tm-fe-overlay';
    var modal = doc.createElement('div'); modal.className = 'tm-fe-modal' + (widthClass ? ' ' + widthClass : '');
    var header = doc.createElement('div'); header.className = 'tm-fe-header';
    var icon = doc.createElement('div'); icon.className = 'tm-fe-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="10" y2="18"/><circle cx="18" cy="16" r="4"/></svg>';
    var titleGroup = doc.createElement('div'); titleGroup.className = 'tm-fe-title-group';
    var h2 = doc.createElement('h2'); h2.textContent = 'Edycja filtra';
    var pEl = doc.createElement('p'); pEl.textContent = subtitle;
    titleGroup.appendChild(h2); titleGroup.appendChild(pEl);
    var closeBtn = doc.createElement('button'); closeBtn.type = 'button'; closeBtn.className = 'tm-fe-close';
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    header.appendChild(icon); header.appendChild(titleGroup); header.appendChild(closeBtn);
    modal.appendChild(header);
    var body = doc.createElement('div'); body.className = 'tm-fe-body';
    modal.appendChild(body);
    var footer = doc.createElement('div'); footer.className = 'tm-fe-footer';
    var cancelBtn = doc.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'tm-fe-btn tm-fe-btn-ghost'; cancelBtn.textContent = 'Anuluj';
    var saveBtn = doc.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'tm-fe-btn tm-fe-btn-primary'; saveBtn.textContent = 'Zapisz';
    footer.appendChild(cancelBtn); footer.appendChild(saveBtn);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    cancelBtn.addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    return { overlay: overlay, modal: modal, body: body, saveBtn: saveBtn };
  }
  function _feCreateNameBlock(doc, filterId, defaultName, customName) {
    var label = doc.createElement('div'); label.className = 'tm-fe-field-label'; label.textContent = 'Nazwa filtra na stronie';
    var group = doc.createElement('div'); group.className = 'tm-fe-radio-group';
    var hasCustom = !!customName;
    var defOpt = _feCreateRadioEl(doc, 'fe_name_' + filterId, 'd', 'Domyślna', !hasCustom);
    group.appendChild(defOpt);
    // v4.6.128: klasa .open zamiast inline (bo CSS ma !important na max-height/opacity)
    var defReveal = doc.createElement('div'); defReveal.className = 'tm-fe-input-reveal' + (!hasCustom ? ' open' : '');
    var defInput = doc.createElement('input'); defInput.type = 'text'; defInput.className = 'tm-fe-input-full'; defInput.value = defaultName; defInput.readOnly = true;
    defReveal.appendChild(defInput);
    group.appendChild(defReveal);
    var customOpt = _feCreateRadioEl(doc, 'fe_name_' + filterId, 'o', 'Własna', hasCustom);
    customOpt.style.marginTop = '4px';
    group.appendChild(customOpt);
    var customReveal = doc.createElement('div'); customReveal.className = 'tm-fe-input-reveal' + (hasCustom ? ' open' : '');
    var customInput = doc.createElement('input'); customInput.type = 'text'; customInput.className = 'tm-fe-input-full';
    customInput.placeholder = 'Wpisz własną nazwę filtra…';
    customInput.value = customName || '';
    customReveal.appendChild(customInput);
    group.appendChild(customReveal);
    defOpt.querySelector('input').addEventListener('change', function () {
      defReveal.className = 'tm-fe-input-reveal open';
      customReveal.className = 'tm-fe-input-reveal';
    });
    customOpt.querySelector('input').addEventListener('change', function () {
      defReveal.className = 'tm-fe-input-reveal';
      customReveal.className = 'tm-fe-input-reveal open';
      setTimeout(function () { customInput.focus(); }, 280);
    });
    return { label: label, group: group, customInput: customInput };
  }
  function _feCreateSpinnerInput(doc, initialValue) {
    var wrap = doc.createElement('div'); wrap.className = 'tm-fe-num-wrap';
    var input = doc.createElement('input'); input.type = 'text'; input.className = 'tm-fe-num-input'; input.value = initialValue;
    var spinWrap = doc.createElement('div'); spinWrap.className = 'tm-fe-spin-btns';
    var up = doc.createElement('button'); up.type = 'button'; up.className = 'tm-fe-spin-btn';
    up.innerHTML = '<svg viewBox="0 0 10 10" fill="none"><polyline points="2,7 5,3 8,7"/></svg>';
    up.addEventListener('click', function () { input.value = (parseInt(input.value) || 0) + 100; });
    var down = doc.createElement('button'); down.type = 'button'; down.className = 'tm-fe-spin-btn';
    down.innerHTML = '<svg viewBox="0 0 10 10" fill="none"><polyline points="2,3 5,7 8,3"/></svg>';
    down.addEventListener('click', function () { var v = (parseInt(input.value) || 0) - 100; input.value = v < 0 ? 0 : v; });
    spinWrap.appendChild(up); spinWrap.appendChild(down);
    wrap.appendChild(input); wrap.appendChild(spinWrap);
    return { wrap: wrap, input: input };
  }
  function openPriceRangeFilterDialog(doc, filterId, filterName, defaultName, opts, onSave) {
    var prKey = filterId === 'pricerange_0' ? 'pricerange' : 'pricerangenet';
    var shell = _feCreateModalShell(doc, filterName, 'tm-fe-modal--wide');
    var nameSection = doc.createElement('div'); nameSection.style.padding = '20px 24px';
    var nameCard = doc.createElement('div'); nameCard.className = 'tm-fe-name-block';
    var nameCardLabel = doc.createElement('div'); nameCardLabel.className = 'tm-fe-name-label';
    nameCardLabel.textContent = 'Nazwa filtra na stronie';
    nameCard.appendChild(nameCardLabel);
    var nb = _feCreateNameBlock(doc, filterId, defaultName, opts.custom_name || '');
    nameCard.appendChild(nb.group);
    nameSection.appendChild(nameCard);
    shell.body.appendChild(nameSection);
    var currencies = [
      { code: 'PLN', cls: 'tm-fe-badge-pln' },
      { code: 'EUR', cls: 'tm-fe-badge-eur' },
      { code: 'GBP', cls: 'tm-fe-badge-gbp' }
    ];
    var existingRanges = opts[prKey] || {};
    var fields = [
      ['minPrice', 'Cena pierwszego przedziału (od 0 do…)'],
      ['range', 'Co ile generować przedziały'],
      ['maxPrice', 'Cena ostatniego przedziału (od…)']
    ];
    var curContainer = doc.createElement('div'); curContainer.className = 'tm-fe-currencies';
    for (var ci = 0; ci < currencies.length; ci++) {
      var cur = currencies[ci];
      var curData = existingRanges[cur.code] || { minPrice: '100', range: '100', maxPrice: '1000' };
      var section = doc.createElement('div'); section.className = 'tm-fe-cur-section';
      var curHeader = doc.createElement('div'); curHeader.className = 'tm-fe-cur-header';
      var badge = doc.createElement('span'); badge.className = 'tm-fe-cur-badge ' + cur.cls; badge.textContent = cur.code;
      var curTitle = doc.createElement('span'); curTitle.className = 'tm-fe-cur-title'; curTitle.textContent = 'Przedziały dla ' + cur.code;
      curHeader.appendChild(badge); curHeader.appendChild(curTitle);
      section.appendChild(curHeader);
      for (var fi = 0; fi < fields.length; fi++) {
        var row = doc.createElement('div'); row.className = 'tm-fe-field-row';
        var rowLabel = doc.createElement('span'); rowLabel.className = 'tm-fe-field-row-label'; rowLabel.textContent = fields[fi][1];
        var defVal = curData[fields[fi][0]] || (fields[fi][0] === 'maxPrice' ? '1000' : '100');
        var spinner = _feCreateSpinnerInput(doc, defVal);
        spinner.input.dataset.currency = cur.code;
        spinner.input.dataset.priceField = fields[fi][0];
        spinner.input.dataset.priceType = prKey;
        row.appendChild(rowLabel); row.appendChild(spinner.wrap);
        section.appendChild(row);
      }
      curContainer.appendChild(section);
    }
    shell.body.appendChild(curContainer);
    doc.body.appendChild(shell.overlay);
    shell.saveBtn.addEventListener('click', function () {
      var result = {};
      var nameRadio = shell.overlay.querySelector('input[name="fe_name_' + filterId + '"]:checked');
      if (nameRadio && nameRadio.value === 'o' && nb.customInput.value.trim()) result.custom_name = nb.customInput.value.trim();
      else result.custom_name = '';
      var prRanges = {};
      var prInputs = shell.overlay.querySelectorAll('input[data-price-type]');
      for (var pi = 0; pi < prInputs.length; pi++) {
        var pInp = prInputs[pi];
        var pCur = pInp.dataset.currency, pField = pInp.dataset.priceField;
        if (!prRanges[pCur]) prRanges[pCur] = {};
        prRanges[pCur][pField] = pInp.value;
      }
      result[prKey] = prRanges;
      _filterPerFilterOpts[filterId] = result;
      if (onSave) onSave(result);
      shell.overlay.remove();
    });
  }
  function openFilterEditDialog(doc, filterId, filterName, onSave) {
    var opts = _filterPerFilterOpts[filterId] || {};
    var defaultName = _filterDefaultNames[filterId] || filterName;
    if (filterId === 'pricerange_0' || filterId === 'pricerangenet_0') {
      openPriceRangeFilterDialog(doc, filterId, filterName, defaultName, opts, onSave);
      return;
    }
    var hasDisplay = filterId === 'producers_0' || filterId === 'series_0';
    var hasDefaultEnabled = FILTER_HAS_DEFAULT_ENABLED.indexOf(filterId) !== -1;
    // v4.6.167: alphabetical (sortowanie) zawsze dostepne — wiec hasFieldBlocks = true
    var hasFieldBlocks = true;
    var shell = _feCreateModalShell(doc, filterName);
    var nb = _feCreateNameBlock(doc, filterId, defaultName, opts.custom_name || '');
    if (hasFieldBlocks) {
      shell.body.style.padding = '8px 0';
      var nameBlock = doc.createElement('div'); nameBlock.className = 'tm-fe-field-block';
      nameBlock.appendChild(nb.label); nameBlock.appendChild(nb.group);
      shell.body.appendChild(nameBlock);
      if (hasDisplay) {
        var dispBlock = doc.createElement('div'); dispBlock.className = 'tm-fe-field-block';
        var dispLabel = doc.createElement('div'); dispLabel.className = 'tm-fe-field-label'; dispLabel.textContent = 'Wyświetlaj na stronie w formie';
        dispBlock.appendChild(dispLabel);
        var dispGroup = doc.createElement('div'); dispGroup.className = 'tm-fe-radio-group';
        var dispOptions = [['name', 'Tekstowej'], ['gfx', 'Graficznej'], ['namegfx', 'Tekstowej i graficznej']];
        var dispVal = opts.display || 'name';
        for (var di = 0; di < dispOptions.length; di++) {
          dispGroup.appendChild(_feCreateRadioEl(doc, 'fe_display_' + filterId, dispOptions[di][0], dispOptions[di][1], dispVal === dispOptions[di][0]));
        }
        dispBlock.appendChild(dispGroup);
        shell.body.appendChild(dispBlock);
      }
      if (hasDefaultEnabled) {
        var deBlock = doc.createElement('div'); deBlock.className = 'tm-fe-field-block';
        var deLabel = doc.createElement('div'); deLabel.className = 'tm-fe-field-label'; deLabel.textContent = 'Domyślnie włączony';
        deBlock.appendChild(deLabel);
        var deGroup = doc.createElement('div'); deGroup.className = 'tm-fe-radio-group-row';
        var deOptions = [['n', 'Nie'], ['y', 'Tak']];
        var deVal = opts.default_enabled || 'n';
        for (var dei = 0; dei < deOptions.length; dei++) {
          deGroup.appendChild(_feCreateRadioEl(doc, 'fe_de_' + filterId, deOptions[dei][0], deOptions[dei][1], deVal === deOptions[dei][0]));
        }
        deBlock.appendChild(deGroup);
        shell.body.appendChild(deBlock);
      }
      // v4.6.167: sortowanie alfabetyczne dla wszystkich filtrow
      var alphaBlock = doc.createElement('div'); alphaBlock.className = 'tm-fe-field-block';
      var alphaLabel = doc.createElement('div'); alphaLabel.className = 'tm-fe-field-label'; alphaLabel.textContent = 'Sortowanie alfabetyczne';
      alphaBlock.appendChild(alphaLabel);
      var alphaGroup = doc.createElement('div'); alphaGroup.className = 'tm-fe-radio-group-row';
      var alphaOptions = [['n', 'Nie'], ['y', 'Tak']];
      var alphaVal = opts.alphabetical || 'n';
      for (var ai = 0; ai < alphaOptions.length; ai++) {
        alphaGroup.appendChild(_feCreateRadioEl(doc, 'fe_alpha_' + filterId, alphaOptions[ai][0], alphaOptions[ai][1], alphaVal === alphaOptions[ai][0]));
      }
      alphaBlock.appendChild(alphaGroup);
      shell.body.appendChild(alphaBlock);
    } else {
      shell.body.style.padding = '20px 24px';
      shell.body.appendChild(nb.label);
      shell.body.appendChild(nb.group);
    }
    doc.body.appendChild(shell.overlay);
    shell.saveBtn.addEventListener('click', function () {
      var result = {};
      var nameRadio = shell.overlay.querySelector('input[name="fe_name_' + filterId + '"]:checked');
      if (nameRadio && nameRadio.value === 'o' && nb.customInput.value.trim()) result.custom_name = nb.customInput.value.trim();
      else result.custom_name = '';
      if (hasDisplay) {
        var dispChecked = shell.overlay.querySelector('input[name="fe_display_' + filterId + '"]:checked');
        if (dispChecked) result.display = dispChecked.value;
      }
      if (hasDefaultEnabled) {
        var deChecked = shell.overlay.querySelector('input[name="fe_de_' + filterId + '"]:checked');
        if (deChecked) result.default_enabled = deChecked.value;
      }
      // v4.6.167: sortowanie alfabetyczne (wszystkie filtry)
      var alphaChecked = shell.overlay.querySelector('input[name="fe_alpha_' + filterId + '"]:checked');
      if (alphaChecked) result.alphabetical = alphaChecked.value;
      _filterPerFilterOpts[filterId] = result;
      if (onSave) onSave(result);
      shell.overlay.remove();
    });
  }

  // v4.6.135: dialog "Powiel teksty między językami" — przepisany 1:1 z JSX-a
  // (copy-texts-dialog.jsx): DM Sans, custom checkbox button, kolorowane wiersze
  // (zrodlowy szary, zaznaczony niebieski hint), gradient na przycisku Powiel.
  function openCopyTextsDialog(doc, langs, curLang, st, getLangName, onApply) {
    var d = doc || document;
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    var FONT = "'DM Sans', sans-serif";

    // v4.6.139: zaladuj DM Sans z Google Fonts (tak jak w JSX) — bez tego browser
    // uzywa fallback sans-serif z inna metryka co psuje wysokosc selecta.
    if (!d.getElementById('tpcd-dmsans-link')) {
      var link = d.createElement('link');
      link.id = 'tpcd-dmsans-link';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      d.head.appendChild(link);
    }
    // v4.6.139: !important na padding/height selecta — natywne CSS panelu IdoSell
    // ma reguly select { height/padding ... } ktore by inaczej nadpisaly inline style.
    if (!d.getElementById('tpcd-styles')) {
      var st1 = d.createElement('style');
      st1.id = 'tpcd-styles';
      st1.textContent =
        '.tpcd-src { padding: 14px 36px 14px 14px !important; min-height: 48px !important; line-height: 1.4 !important; box-sizing: border-box !important; }';
      d.head.appendChild(st1);
    }

    var copyName = true, copyDesc = true;
    // v4.6.142: opcje per-shop (sklep aktualny modalu, kopiowane na inne jezyki w tym sklepie)
    var copyHeadline = false, copyListDesc = false;
    var sourceLang = curLang;
    var targetLangs = langs.filter(function (lg) { return lg !== curLang; });

    var overlay = d.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,26,46,.45);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:30px 16px;font-family:' + FONT;
    var modal = d.createElement('div');
    modal.style.cssText = 'width:100%;max-width:480px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.15),0 4px 12px rgba(0,0,0,.06);overflow:hidden;font-family:' + FONT;
    overlay.appendChild(modal);
    d.body.appendChild(overlay);

    function checkboxBtn(checked, disabled) {
      var bg = checked ? '#4f8cff' : '#fff';
      var bd = checked ? 'none' : '1.5px solid #d0d5dd';
      var op = disabled ? '.4' : '1';
      var cur = disabled ? 'default' : 'pointer';
      var inner = checked
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '';
      return '<button type="button" class="tpcd-cb" data-checked="' + (checked ? '1' : '0') + '"' + (disabled ? ' disabled' : '') + ' style="width:20px;height:20px;border-radius:5px;flex-shrink:0;border:' + bd + ';background:' + bg + ';cursor:' + cur + ';display:flex;align-items:center;justify-content:center;transition:all .15s;opacity:' + op + ';padding:0">' + inner + '</button>';
    }

    function render() {
      var canSubmit = (copyName || copyDesc || copyHeadline || copyListDesc) && targetLangs.length > 0;
      var srcOpts = langs.map(function (lg) {
        return '<option value="' + esc(lg) + '"' + (lg === sourceLang ? ' selected' : '') + '>' + esc(getLangName(lg)) + ' (' + esc(lg) + ')</option>';
      }).join('');
      var tgtRowsHtml = langs.map(function (lg, i) {
        var isSource = lg === sourceLang;
        var isChecked = targetLangs.indexOf(lg) >= 0;
        var bg = isSource ? '#fafbfc' : (isChecked ? '#f5f8ff' : '#fff');
        var cur = isSource ? 'default' : 'pointer';
        var bb = (i < langs.length - 1) ? '1px solid #f0f2f5' : 'none';
        var nameColor = isSource ? '#b0b8c9' : '#1a1a2e';
        var nameWeight = isSource ? 400 : 500;
        return '<div class="tpcd-row" data-lang="' + esc(lg) + '" data-source="' + (isSource ? '1' : '0') + '" data-checked="' + (isChecked ? '1' : '0') + '" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:' + bb + ';background:' + bg + ';cursor:' + cur + ';transition:background .12s">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            checkboxBtn(isChecked, isSource) +
            '<span style="font-size:13.5px;color:' + nameColor + ';font-weight:' + nameWeight + '">' + esc(getLangName(lg)) + ' <span style="color:#b0b8c9;font-weight:400">(' + esc(lg) + ')</span></span>' +
          '</div>' +
          (isSource ? '<span style="font-size:11.5px;color:#b0b8c9;font-style:italic">źródłowy</span>' : '') +
        '</div>';
      }).join('');

      modal.innerHTML =
        // Header
        '<div style="padding:20px 22px 16px;display:flex;align-items:flex-start;justify-content:space-between">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<div style="width:42px;height:42px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#eef3ff;color:#4f8cff">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:#1a1a2e">Powiel teksty między językami</div>' +
              '<div style="font-size:12.5px;color:#98a2b3;margin-top:2px">Wybierz źródło, cel i co skopiować</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="tpcd-close" style="width:32px;height:32px;border-radius:8px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#b0b8c9;transition:all .2s;margin-top:-2px;padding:0">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        // Body
        '<div style="padding:0 22px 20px">' +
          // Co skopiować — lista wierszy w ramce (identyczna jak Jezyki docelowe ponizej)
          // v4.6.143: format listy z szarym tlem dla zaznaczonych + hover
          (function () {
            var rows = [
              { field: 'name',     label: 'Nazwa',              checked: copyName,     hint: '' },
              { field: 'desc',     label: 'Opis',               checked: copyDesc,     hint: '' },
              { field: 'headline', label: 'Nazwa w nagłówku',   checked: copyHeadline, hint: 'tylko bieżący sklep' },
              { field: 'listDesc', label: 'Opis na liście',     checked: copyListDesc, hint: 'tylko bieżący sklep' }
            ];
            var rowsHtml = rows.map(function (r, idx) {
              var bg = r.checked ? '#f5f8ff' : '#fff';
              var bb = (idx < rows.length - 1) ? '1px solid #f0f2f5' : 'none';
              return '<div class="tpcd-what" data-field="' + r.field + '" data-checked="' + (r.checked ? '1' : '0') + '" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:' + bb + ';background:' + bg + ';cursor:pointer;transition:background .12s">' +
                '<div style="display:flex;align-items:center;gap:10px">' +
                  checkboxBtn(r.checked, false) +
                  '<span style="font-size:13.5px;color:#1a1a2e;font-weight:500">' + esc(r.label) + '</span>' +
                '</div>' +
                (r.hint ? '<span style="font-size:11.5px;color:#b0b8c9;font-style:italic">' + esc(r.hint) + '</span>' : '') +
              '</div>';
            }).join('');
            return '<div style="padding:14px 0;border-top:1px solid #f0f2f5">' +
              '<div style="font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Co skopiować</div>' +
              '<div style="border:1px solid #e8ebf0;border-radius:10px;overflow:hidden">' + rowsHtml + '</div>' +
            '</div>';
          })() +
          // Język źródłowy
          '<div style="padding:14px 0;border-top:1px solid #f0f2f5">' +
            '<div style="font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Język źródłowy</div>' +
            '<div style="position:relative">' +
              '<select class="tpcd-src" style="display:block;width:100%;padding:12px 36px 12px 14px;line-height:1.4;border-radius:8px;border:1px solid #e0e3ea;background:#f8f9fb;font-size:13.5px;color:#1a1a2e;appearance:none;-webkit-appearance:none;-moz-appearance:none;outline:none;cursor:pointer;font-family:' + FONT + ';box-sizing:border-box;margin:0;transition:border-color .2s">' + srcOpts + '</select>' +
              '<span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:10px;color:#98a2b3">▼</span>' +
            '</div>' +
          '</div>' +
          // Języki docelowe
          '<div style="padding:14px 0 0;border-top:1px solid #f0f2f5">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.06em">Języki docelowe</div>' +
              '<div style="display:flex;gap:6px">' +
                '<button type="button" class="tpcd-all" style="padding:4px 12px;border-radius:6px;border:1px solid #e0e3ea;background:#fff;font-size:12px;font-weight:500;color:#344054;cursor:pointer;font-family:' + FONT + '">Wszystkie</button>' +
                '<button type="button" class="tpcd-none" style="padding:4px 12px;border-radius:6px;border:1px solid #e0e3ea;background:#fff;font-size:12px;font-weight:500;color:#344054;cursor:pointer;font-family:' + FONT + '">Żadne</button>' +
              '</div>' +
            '</div>' +
            '<div class="tpcd-tgts" style="border:1px solid #e8ebf0;border-radius:10px;overflow:hidden">' + tgtRowsHtml + '</div>' +
          '</div>' +
        '</div>' +
        // Footer
        '<div style="padding:14px 22px;border-top:1px solid #eef0f4;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:#fafbfc">' +
          '<button type="button" class="tpcd-cancel" style="padding:9px 20px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-size:13px;font-weight:600;cursor:pointer;font-family:' + FONT + '">Anuluj</button>' +
          '<button type="button" class="tpcd-apply"' + (canSubmit ? '' : ' disabled') + ' style="padding:9px 22px;border-radius:8px;border:none;background:' + (canSubmit ? 'linear-gradient(135deg,#4f8cff,#3b6de0)' : '#e0e3ea') + ';color:' + (canSubmit ? '#fff' : '#98a2b3') + ';font-size:13px;font-weight:600;cursor:' + (canSubmit ? 'pointer' : 'not-allowed') + ';box-shadow:' + (canSubmit ? '0 2px 8px rgba(79,140,255,.35)' : 'none') + ';font-family:' + FONT + ';transition:all .2s">Powiel</button>' +
        '</div>';

      bindEvents();
    }

    function close() { overlay.remove(); }

    function bindEvents() {
      modal.querySelector('.tpcd-close').addEventListener('click', close);
      modal.querySelector('.tpcd-cancel').addEventListener('click', close);
      // Hover ×
      var xb = modal.querySelector('.tpcd-close');
      xb.addEventListener('mouseenter', function () { xb.style.background = '#f0f2f5'; xb.style.color = '#344054'; });
      xb.addEventListener('mouseleave', function () { xb.style.background = 'transparent'; xb.style.color = '#b0b8c9'; });

      // Co skopiowac
      modal.querySelectorAll('.tpcd-what').forEach(function (lab) {
        lab.addEventListener('click', function () {
          var f = lab.getAttribute('data-field');
          if (f === 'name') copyName = !copyName;
          else if (f === 'desc') copyDesc = !copyDesc;
          else if (f === 'headline') copyHeadline = !copyHeadline;
          else if (f === 'listDesc') copyListDesc = !copyListDesc;
          render();
        });
        // hover (jak wiersze jezykow ponizej)
        lab.addEventListener('mouseenter', function () { if (lab.getAttribute('data-checked') === '0') lab.style.background = '#fafbfc'; });
        lab.addEventListener('mouseleave', function () { if (lab.getAttribute('data-checked') === '0') lab.style.background = '#fff'; });
      });

      // Zrodlo
      var srcSel = modal.querySelector('.tpcd-src');
      srcSel.addEventListener('focus', function () { srcSel.style.borderColor = '#4f8cff'; });
      srcSel.addEventListener('blur', function () { srcSel.style.borderColor = '#e0e3ea'; });
      srcSel.addEventListener('change', function () {
        sourceLang = srcSel.value;
        targetLangs = targetLangs.filter(function (lg) { return lg !== sourceLang; });
        render();
      });

      // Wszystkie/Zadne
      modal.querySelector('.tpcd-all').addEventListener('click', function () {
        targetLangs = langs.filter(function (lg) { return lg !== sourceLang; });
        render();
      });
      modal.querySelector('.tpcd-none').addEventListener('click', function () {
        targetLangs = [];
        render();
      });

      // Wiersze docelowe — klik na cały row
      modal.querySelectorAll('.tpcd-row').forEach(function (row) {
        if (row.getAttribute('data-source') === '1') return;
        var lg = row.getAttribute('data-lang');
        row.addEventListener('click', function () {
          if (targetLangs.indexOf(lg) >= 0) targetLangs = targetLangs.filter(function (l) { return l !== lg; });
          else targetLangs.push(lg);
          render();
        });
        // Hover
        row.addEventListener('mouseenter', function () {
          if (row.getAttribute('data-checked') === '0') row.style.background = '#fafbfc';
        });
        row.addEventListener('mouseleave', function () {
          if (row.getAttribute('data-checked') === '0') row.style.background = '#fff';
        });
      });

      // Hover Wszystkie/Zadne
      ['.tpcd-all', '.tpcd-none'].forEach(function (sel) {
        var btn = modal.querySelector(sel);
        btn.addEventListener('mouseenter', function () { btn.style.borderColor = '#c0cfff'; btn.style.color = '#4f8cff'; });
        btn.addEventListener('mouseleave', function () { btn.style.borderColor = '#e0e3ea'; btn.style.color = '#344054'; });
      });

      // Apply
      modal.querySelector('.tpcd-apply').addEventListener('click', function () {
        var canSubmit = (copyName || copyDesc || copyHeadline || copyListDesc) && targetLangs.length > 0;
        if (!canSubmit) return;
        onApply(sourceLang, targetLangs.slice(), { name: copyName, desc: copyDesc, headline: copyHeadline, listDesc: copyListDesc });
        close();
      });
    }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    render();
  }

  // v4.6.141: dialog "Powiel ustawienia między sklepami" — rozbicie na sub-opcje.
  // 3 grupy (Wyswietlanie, Filtry, Grafiki) z indywidualnymi sub-checkboxami.
  // Parent checkbox kazdej grupy = AND wszystkich sub (zaznaczony tylko gdy wszystkie zaznaczone).
  function openCopyShopsDialog(doc, shops, curShop, shopLabel, onApply) {
    var d = doc || document;
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    var FONT = "'DM Sans', sans-serif";

    if (!d.getElementById('tpcd-dmsans-link')) {
      var link = d.createElement('link'); link.id = 'tpcd-dmsans-link'; link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      d.head.appendChild(link);
    }
    if (!d.getElementById('tpcd-styles')) {
      var st1 = d.createElement('style'); st1.id = 'tpcd-styles';
      st1.textContent = '.tpcd-src { padding: 14px 36px 14px 14px !important; min-height: 48px !important; line-height: 1.4 !important; box-sizing: border-box !important; }';
      d.head.appendChild(st1);
    }

    // Struktura sub-opcji per grupa
    var GROUPS = [
      { key: 'display', label: 'Wyświetlanie', subs: [
        { key: 'mode',  label: 'Tryb wyświetlania' },
        { key: 'sort',  label: 'Sortowanie' },
        { key: 'limit', label: 'Limit na stronie' }
      ]},
      { key: 'filters', label: 'Filtry', subs: [
        { key: 'default',         label: 'Tryb (domyślny / własny)' },
        { key: 'active',          label: 'Lista aktywnych filtrów + kolejność' },
        { key: 'pricestep',       label: 'Krok przedziału cenowego brutto' },
        { key: 'pricestepnet',    label: 'Krok przedziału cenowego netto' },
        { key: 'name',            label: 'Własne nazwy filtrów' },
        { key: 'display',         label: 'Forma wyświetlania (Marka / Seria)' },
        { key: 'defaultEnabled',  label: 'Domyślnie włączone (Stocks / Promocje)' },
        { key: 'pricerange',      label: 'Przedziały cenowe brutto (PLN/EUR/GBP)' },
        { key: 'pricerangenet',   label: 'Przedziały cenowe netto' }
      ]},
      { key: 'gfx', label: 'Typ grafiki', subs: [
        { key: 'search',     label: 'Typ grafiki na liście towarów' },
        { key: 'projector',  label: 'Typ grafiki na karcie towaru' }
      ]},
      // v4.6.142: teksty per shop (headline_name + node_desc).
      // Wszystkie per-lang-per-shop, kopiowane dla biezacego jezyka modalu.
      { key: 'texts', label: 'Teksty per shop', subs: [
        { key: 'headline', label: 'Nazwa w nagłówku strony' },
        { key: 'listDesc', label: 'Opis na liście towarów' }
      ]}
    ];

    var what = {};
    GROUPS.forEach(function (g) {
      what[g.key] = {};
      g.subs.forEach(function (sub) { what[g.key][sub.key] = true; });
    });

    var sourceShop = curShop;
    var targetShops = shops.filter(function (s) { return s !== curShop; });

    var overlay = d.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,26,46,.45);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:30px 16px;font-family:' + FONT;
    var modal = d.createElement('div');
    modal.style.cssText = 'width:100%;max-width:560px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.15),0 4px 12px rgba(0,0,0,.06);overflow:hidden;font-family:' + FONT + ';max-height:90vh;display:flex;flex-direction:column';
    overlay.appendChild(modal);
    d.body.appendChild(overlay);

    function checkboxBtn(checked, disabled, dataAttrs) {
      var bg = checked ? '#4f8cff' : '#fff';
      var bd = checked ? 'none' : '1.5px solid #d0d5dd';
      var op = disabled ? '.4' : '1';
      var cur = disabled ? 'default' : 'pointer';
      var inner = checked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '';
      return '<button type="button" class="tpcs-cb"' + (dataAttrs || '') + (disabled ? ' disabled' : '') + ' style="width:20px;height:20px;border-radius:5px;flex-shrink:0;border:' + bd + ';background:' + bg + ';cursor:' + cur + ';display:flex;align-items:center;justify-content:center;transition:all .15s;opacity:' + op + ';padding:0">' + inner + '</button>';
    }

    function groupAllChecked(g) {
      return g.subs.every(function (sub) { return what[g.key][sub.key]; });
    }
    function groupAnyChecked(g) {
      return g.subs.some(function (sub) { return what[g.key][sub.key]; });
    }

    function canSubmit() {
      var anySub = GROUPS.some(function (g) { return groupAnyChecked(g); });
      return anySub && targetShops.length > 0;
    }

    function render() {
      var srcOpts = shops.map(function (s) {
        return '<option value="' + esc(s) + '"' + (s === sourceShop ? ' selected' : '') + '>' + esc(shopLabel(s)) + ' (id ' + esc(s) + ')</option>';
      }).join('');
      var tgtRowsHtml = shops.map(function (s, i) {
        var isSource = s === sourceShop;
        var isChecked = targetShops.indexOf(s) >= 0;
        var bg = isSource ? '#fafbfc' : (isChecked ? '#f5f8ff' : '#fff');
        var cur = isSource ? 'default' : 'pointer';
        var bb = (i < shops.length - 1) ? '1px solid #f0f2f5' : 'none';
        var nameColor = isSource ? '#b0b8c9' : '#1a1a2e';
        var nameWeight = isSource ? 400 : 500;
        return '<div class="tpcs-row" data-shop="' + esc(s) + '" data-source="' + (isSource ? '1' : '0') + '" data-checked="' + (isChecked ? '1' : '0') + '" style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-bottom:' + bb + ';background:' + bg + ';cursor:' + cur + ';transition:background .12s">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            checkboxBtn(isChecked, isSource) +
            '<span style="font-size:13.5px;color:' + nameColor + ';font-weight:' + nameWeight + '">' + esc(shopLabel(s)) + ' <span style="color:#b0b8c9;font-weight:400">(id ' + esc(s) + ')</span></span>' +
          '</div>' +
          (isSource ? '<span style="font-size:11.5px;color:#b0b8c9;font-style:italic">źródłowy</span>' : '') +
        '</div>';
      }).join('');

      // 3 grupy z sub-checkboxami
      var groupsHtml = GROUPS.map(function (g) {
        var allCh = groupAllChecked(g);
        var anyCh = groupAnyChecked(g);
        var parentSvg = allCh
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
          : (anyCh ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>' : '');
        var pBg = allCh ? '#4f8cff' : (anyCh ? '#4f8cff' : '#fff');
        var pBd = (allCh || anyCh) ? 'none' : '1.5px solid #d0d5dd';
        var subsHtml = g.subs.map(function (sub) {
          var ch = what[g.key][sub.key];
          return '<label class="tpcs-sub" data-grp="' + esc(g.key) + '" data-sub="' + esc(sub.key) + '" style="display:flex;align-items:center;gap:10px;padding:7px 0 7px 32px;cursor:pointer;font-size:13px;color:#344054">' +
            checkboxBtn(ch, false, ' data-grp="' + esc(g.key) + '" data-sub="' + esc(sub.key) + '"') +
            '<span>' + esc(sub.label) + '</span>' +
          '</label>';
        }).join('');
        return '<div style="border:1px solid #e8ebf0;border-radius:10px;overflow:hidden;margin-bottom:10px">' +
          '<label class="tpcs-grp-header" data-grp="' + esc(g.key) + '" style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:#fafbfc;border-bottom:1px solid #f0f2f5;cursor:pointer">' +
            '<button type="button" class="tpcs-grp-cb" data-grp="' + esc(g.key) + '" style="width:20px;height:20px;border-radius:5px;flex-shrink:0;border:' + pBd + ';background:' + pBg + ';cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;padding:0">' + parentSvg + '</button>' +
            '<span style="font-size:13.5px;font-weight:600;color:#1a1a2e">' + esc(g.label) + '</span>' +
          '</label>' +
          '<div style="padding:6px 14px 10px">' + subsHtml + '</div>' +
        '</div>';
      }).join('');

      var cs = canSubmit();
      modal.innerHTML =
        // Header
        '<div style="padding:20px 22px 16px;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<div style="width:42px;height:42px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#eef3ff;color:#4f8cff">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18l-1 11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L3 9z"/><path d="M16 9V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4"/></svg>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:#1a1a2e">Powiel ustawienia między sklepami</div>' +
              '<div style="font-size:12.5px;color:#98a2b3;margin-top:2px">Wybierz dokładnie co przenieść</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="tpcs-close" style="width:32px;height:32px;border-radius:8px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#b0b8c9;transition:all .2s;margin-top:-2px;padding:0">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        // Body
        '<div style="padding:0 22px 20px;overflow-y:auto;flex:1;min-height:0">' +
          // Co skopiowac
          '<div style="padding:14px 0;border-top:1px solid #f0f2f5">' +
            '<div style="font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Co skopiować</div>' +
            groupsHtml +
          '</div>' +
          // Sklep zrodlowy
          '<div style="padding:14px 0;border-top:1px solid #f0f2f5">' +
            '<div style="font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Sklep źródłowy</div>' +
            '<div style="position:relative">' +
              '<select class="tpcd-src" style="display:block;width:100%;padding:12px 36px 12px 14px;line-height:1.4;border-radius:8px;border:1px solid #e0e3ea;background:#f8f9fb;font-size:13.5px;color:#1a1a2e;appearance:none;-webkit-appearance:none;-moz-appearance:none;outline:none;cursor:pointer;font-family:' + FONT + ';box-sizing:border-box;margin:0;transition:border-color .2s">' + srcOpts + '</select>' +
              '<span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);pointer-events:none;font-size:10px;color:#98a2b3">▼</span>' +
            '</div>' +
          '</div>' +
          // Sklepy docelowe
          '<div style="padding:14px 0 0;border-top:1px solid #f0f2f5">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
              '<div style="font-size:11px;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.06em">Sklepy docelowe</div>' +
              '<div style="display:flex;gap:6px">' +
                '<button type="button" class="tpcs-all" style="padding:4px 12px;border-radius:6px;border:1px solid #e0e3ea;background:#fff;font-size:12px;font-weight:500;color:#344054;cursor:pointer;font-family:' + FONT + '">Wszystkie</button>' +
                '<button type="button" class="tpcs-none" style="padding:4px 12px;border-radius:6px;border:1px solid #e0e3ea;background:#fff;font-size:12px;font-weight:500;color:#344054;cursor:pointer;font-family:' + FONT + '">Żadne</button>' +
              '</div>' +
            '</div>' +
            '<div class="tpcs-tgts" style="border:1px solid #e8ebf0;border-radius:10px;overflow:hidden;max-height:260px;overflow-y:auto">' + tgtRowsHtml + '</div>' +
          '</div>' +
        '</div>' +
        // Footer
        '<div style="padding:14px 22px;border-top:1px solid #eef0f4;display:flex;align-items:center;justify-content:flex-end;gap:8px;background:#fafbfc;flex-shrink:0">' +
          '<button type="button" class="tpcs-cancel" style="padding:9px 20px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-size:13px;font-weight:600;cursor:pointer;font-family:' + FONT + '">Anuluj</button>' +
          '<button type="button" class="tpcs-apply"' + (cs ? '' : ' disabled') + ' style="padding:9px 22px;border-radius:8px;border:none;background:' + (cs ? 'linear-gradient(135deg,#4f8cff,#3b6de0)' : '#e0e3ea') + ';color:' + (cs ? '#fff' : '#98a2b3') + ';font-size:13px;font-weight:600;cursor:' + (cs ? 'pointer' : 'not-allowed') + ';box-shadow:' + (cs ? '0 2px 8px rgba(79,140,255,.35)' : 'none') + ';font-family:' + FONT + ';transition:all .2s">Powiel</button>' +
        '</div>';

      bindEvents();
    }

    function close() { overlay.remove(); }

    function bindEvents() {
      modal.querySelector('.tpcs-close').addEventListener('click', close);
      modal.querySelector('.tpcs-cancel').addEventListener('click', close);
      var xb = modal.querySelector('.tpcs-close');
      xb.addEventListener('mouseenter', function () { xb.style.background = '#f0f2f5'; xb.style.color = '#344054'; });
      xb.addEventListener('mouseleave', function () { xb.style.background = 'transparent'; xb.style.color = '#b0b8c9'; });

      // Group parent — toggle all subs
      modal.querySelectorAll('.tpcs-grp-header').forEach(function (hd) {
        hd.addEventListener('click', function () {
          var key = hd.getAttribute('data-grp');
          var grp = null;
          for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].key === key) { grp = GROUPS[i]; break; }
          if (!grp) return;
          var nowAll = groupAllChecked(grp);
          grp.subs.forEach(function (sub) { what[key][sub.key] = !nowAll; });
          render();
        });
      });

      // Sub-checkboxy
      modal.querySelectorAll('.tpcs-sub').forEach(function (lab) {
        lab.addEventListener('click', function () {
          var gKey = lab.getAttribute('data-grp');
          var sKey = lab.getAttribute('data-sub');
          what[gKey][sKey] = !what[gKey][sKey];
          render();
        });
      });

      var srcSel = modal.querySelector('.tpcd-src');
      srcSel.addEventListener('focus', function () { srcSel.style.borderColor = '#4f8cff'; });
      srcSel.addEventListener('blur', function () { srcSel.style.borderColor = '#e0e3ea'; });
      srcSel.addEventListener('change', function () {
        sourceShop = srcSel.value;
        targetShops = targetShops.filter(function (s) { return s !== sourceShop; });
        render();
      });

      modal.querySelector('.tpcs-all').addEventListener('click', function () {
        targetShops = shops.filter(function (s) { return s !== sourceShop; });
        render();
      });
      modal.querySelector('.tpcs-none').addEventListener('click', function () {
        targetShops = [];
        render();
      });

      modal.querySelectorAll('.tpcs-row').forEach(function (row) {
        if (row.getAttribute('data-source') === '1') return;
        var sh = row.getAttribute('data-shop');
        row.addEventListener('click', function () {
          if (targetShops.indexOf(sh) >= 0) targetShops = targetShops.filter(function (s) { return s !== sh; });
          else targetShops.push(sh);
          render();
        });
        row.addEventListener('mouseenter', function () { if (row.getAttribute('data-checked') === '0') row.style.background = '#fafbfc'; });
        row.addEventListener('mouseleave', function () { if (row.getAttribute('data-checked') === '0') row.style.background = '#fff'; });
      });

      ['.tpcs-all', '.tpcs-none'].forEach(function (sel) {
        var btn = modal.querySelector(sel);
        btn.addEventListener('mouseenter', function () { btn.style.borderColor = '#c0cfff'; btn.style.color = '#4f8cff'; });
        btn.addEventListener('mouseleave', function () { btn.style.borderColor = '#e0e3ea'; btn.style.color = '#344054'; });
      });

      modal.querySelector('.tpcs-apply').addEventListener('click', function () {
        if (!canSubmit()) return;
        onApply(sourceShop, targetShops.slice(), what);
        close();
      });
    }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    render();
  }

  // v4.6.141: faktyczne kopiowanie ustawien per shop z granularnymi sub-opcjami.
  // Per kazdy target: getNode tgt → merge wybrane pola z src → save.
  async function copyShopSettings(nodeId, srcShop, tgtShops, lang, what) {
    var errors = [];
    // 1) Pobierz dane sklepu zrodlowego raz
    var srcNode;
    try {
      var r = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(srcShop) + '&tree=parameters&parent=0');
      srcNode = (r && r.data) || {};
    } catch (e) {
      throw new Error('Nie udalo sie pobrac danych sklepu zrodlowego: ' + (e.message || e));
    }

    // 2) Pre-fetch icon types raz (jesli ktorykolwiek gfx zaznaczony)
    var srcIconSearchType, srcIconProjectorType;
    var anyGfx = (what.gfx && (what.gfx.search || what.gfx.projector));
    if (anyGfx) {
      try {
        var ldr = await fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(nodeId));
        var ld = (ldr && ldr.data && ldr.data.langData && ldr.data.langData[lang]) || {};
        srcIconSearchType = ld.icon_search_type && ld.icon_search_type[srcShop];
        srcIconProjectorType = ld.icon_projector_type && ld.icon_projector_type[srcShop];
      } catch (e) {}
    }

    // 3) Dla kazdego sklepu docelowego — merge sub-opcje i wykonaj save
    for (var i = 0; i < tgtShops.length; i++) {
      var tgt = tgtShops[i];

      // === Wyswietlanie (display) ===
      var anyDisplay = (what.display && (what.display.mode || what.display.sort || what.display.limit));
      if (anyDisplay) {
        try {
          // Pobierz tgt zeby zachowac pola NIE wybrane do kopiowania
          var rT = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(tgt) + '&tree=parameters&parent=0');
          var tgtNode = (rT && rT.data) || {};
          var dispMode = what.display.mode ? (srcNode.display_mode || '') : (tgtNode.display_mode || '');
          var sort = what.display.sort ? (srcNode.sort || '') : (tgtNode.sort || '');
          var displayLimit = what.display.limit ? (srcNode.display_limit || '') : (tgtNode.display_limit || '');
          var body = 'action=saveDisplayMode&node=' + encodeURIComponent(nodeId) +
            '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(tgt) +
            '&tree=parameters&display_mode=' + encodeURIComponent(dispMode) +
            '&sort=' + encodeURIComponent(sort) +
            '&display_limit=' + encodeURIComponent(displayLimit);
          await fetchAjaxRaw('/panel/ajax/navigation.php', body);
        } catch (e) { errors.push('Sklep ' + tgt + ' wyswietlanie: ' + (e.message || e)); }
      }

      // === Filtry ===
      var anyFilters = (what.filters && (what.filters.default || what.filters.active ||
        what.filters.pricestep || what.filters.pricestepnet || what.filters.name ||
        what.filters.display || what.filters.defaultEnabled || what.filters.pricerange ||
        what.filters.pricerangenet));
      if (anyFilters) {
        try {
          // Pobierz tgt jako baze
          var rT2 = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(tgt) + '&tree=parameters&parent=0');
          var tgtN = (rT2 && rT2.data) || {};

          // Tryb (default vs custom)
          var useDefault;
          if (what.filters.default) useDefault = !!srcNode.filter_default;
          else useDefault = !!tgtN.filter_default;

          if (useDefault) {
            await saveValueFiltersDefault(nodeId, tgt, lang);
          } else {
            // Aktywne filtry + kolejnosc
            var activeIds;
            if (what.filters.active) {
              activeIds = (srcNode.filter && Array.isArray(srcNode.filter.active))
                ? srcNode.filter.active.map(function (f) { return f.id; }) : [];
            } else {
              activeIds = (tgtN.filter && Array.isArray(tgtN.filter.active))
                ? tgtN.filter.active.map(function (f) { return f.id; }) : [];
            }
            var ps = what.filters.pricestep
              ? ((srcNode.filter_pricestep != null) ? String(srcNode.filter_pricestep) : '10')
              : ((tgtN.filter_pricestep != null) ? String(tgtN.filter_pricestep) : '10');
            var psn = what.filters.pricestepnet
              ? ((srcNode.filter_pricestepnet != null) ? String(srcNode.filter_pricestepnet) : '10')
              : ((tgtN.filter_pricestepnet != null) ? String(tgtN.filter_pricestepnet) : '10');

            // Per-filter opts — merge per sub-flag
            var perOpts = {};
            // Najpierw zaladuj z tgt (jako baza dla nie-zaznaczonych pol)
            var loadInto = function (src, key, prop, into) {
              if (src[key] && typeof src[key] === 'object') {
                for (var k in src[key]) if (src[key][k] != null && src[key][k] !== '') {
                  if (!into[k]) into[k] = {};
                  into[k][prop] = src[key][k];
                }
              }
            };
            // Name
            if (what.filters.name) loadInto(srcNode, 'filter_name', 'custom_name', perOpts);
            else loadInto(tgtN, 'filter_name', 'custom_name', perOpts);
            // Display (Marka/Seria)
            if (what.filters.display) loadInto(srcNode, 'filter_display', 'display', perOpts);
            else loadInto(tgtN, 'filter_display', 'display', perOpts);
            // Default enabled
            if (what.filters.defaultEnabled) loadInto(srcNode, 'filter_default_enabled', 'default_enabled', perOpts);
            else loadInto(tgtN, 'filter_default_enabled', 'default_enabled', perOpts);
            // Pricerange brutto
            var prSrc = what.filters.pricerange ? srcNode.filter_pricerange : tgtN.filter_pricerange;
            if (prSrc && typeof prSrc === 'object') {
              if (!perOpts['pricerange_0']) perOpts['pricerange_0'] = {};
              perOpts['pricerange_0'].pricerange = prSrc;
            }
            // Pricerange netto
            var pnSrc = what.filters.pricerangenet ? srcNode.filter_pricerangenet : tgtN.filter_pricerangenet;
            if (pnSrc && typeof pnSrc === 'object') {
              if (!perOpts['pricerangenet_0']) perOpts['pricerangenet_0'] = {};
              perOpts['pricerangenet_0'].pricerangenet = pnSrc;
            }
            await saveValueFilters(nodeId, tgt, lang, activeIds, ps, psn, perOpts);
          }
        } catch (e) { errors.push('Sklep ' + tgt + ' filtry: ' + (e.message || e)); }
      }

      // === Teksty per shop (headline_name + node_desc / opis listy) ===
      var anyTexts = (what.texts && (what.texts.headline || what.texts.listDesc));
      if (anyTexts) {
        try {
          // Pobierz tgt jako baza dla editNodeShopData (zachowanie pol nie wybranych)
          var rTx = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(tgt) + '&tree=parameters&parent=0');
          var tgtNT = (rTx && rTx.data) || {};

          if (what.texts.headline) {
            // editNodeShopData z headline_name z src + reszta pol tgt (zachowanie)
            var newHl = srcNode.headline_name || '';
            var hasMeta = !!(tgtNT.meta_title || tgtNT.meta_description || tgtNT.meta_keywords);
            var view = (tgtNT.display_limit || tgtNT.sort || (tgtNT.display_mode && tgtNT.display_mode_default && tgtNT.display_mode !== tgtNT.display_mode_default)) ? 'own' : 'default';
            var filterDef = (tgtNT.filter_default == null) ? 'y' : (tgtNT.filter_default ? 'y' : 'n');
            var b = 'action=editNodeShopData&node_type=false&filter_default=' + filterDef + '&target=false' +
              '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(tgt) +
              '&tree=parameters&node=' + encodeURIComponent(nodeId) + '&view=' + view + '&parent=0' +
              '&click_action=false&element_hidden=false&displayShowAll=false&showAllIs=false&expand=false' +
              '&node_gfx=false&gfx_active_type=false&gfx_inactive_type=false&gfx_omo_type=false&gfx_type=false' +
              '&meta_default=' + (hasMeta ? 'n' : 'y') +
              '&meta_keywords=' + encodeURIComponent(tgtNT.meta_keywords || '') +
              '&meta_title=' + encodeURIComponent(tgtNT.meta_title || '') +
              '&meta_desc=' + encodeURIComponent(tgtNT.meta_description || '') +
              '&meta_index=' + (tgtNT.meta_robots_index || 'default') +
              '&meta_follow=' + (tgtNT.meta_robots_follow || 'default') +
              '&headline_name=' + encodeURIComponent(newHl);
            await fetchAjaxRaw('/panel/ajax/parameters.php', b);
          }

          if (what.texts.listDesc) {
            // Pobierz opis listy ze srcShop, zapisz dla tgt (v4.6.161: bez JSON.parse — rd to obiekt)
            var rDesc = await fetchAjaxRaw('/panel/ajax/parameters.php', 'action=getNodeDesc&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(srcShop) + '&tree=parameters&parent=0');
            var srcListHtml = (rDesc && rDesc.data && (rDesc.data.desc || rDesc.data.description || rDesc.data.value)) || '';
            await fetchAjaxRaw('/panel/ajax/parameters.php', 'action=setNodeDesc&desc=' + encodeURIComponent(srcListHtml) + '&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lang) + '&shop=' + encodeURIComponent(tgt) + '&tree=parameters&parent=0');
          }
        } catch (e) { errors.push('Sklep ' + tgt + ' teksty: ' + (e.message || e)); }
      }

      // === Grafiki (typ) ===
      if (anyGfx) {
        try {
          var parts = [];
          if (what.gfx.search && srcIconSearchType) parts.push('icon_search_type[' + encodeURIComponent(lang) + '][' + encodeURIComponent(tgt) + ']=' + encodeURIComponent(srcIconSearchType));
          if (what.gfx.projector && srcIconProjectorType) parts.push('icon_projector_type[' + encodeURIComponent(lang) + '][' + encodeURIComponent(tgt) + ']=' + encodeURIComponent(srcIconProjectorType));
          if (parts.length) {
            await fetchAjax('action=setSettings&id=' + encodeURIComponent(nodeId) + '&' + parts.join('&'));
          }
        } catch (e) { errors.push('Sklep ' + tgt + ' typ grafik: ' + (e.message || e)); }
      }
    }

    if (errors.length) throw new Error(errors.join('; '));
  }

  // ═════════════════════════════════════════════════════════════════════════
  // v4.6.168: WYKRYWANIE I LACZENIE ZDUBLOWANYCH NAZW PARAMETROW
  // Norm. nazwy: trim + lowercase + bez diakrytykow. Per grupa user wybiera
  // target (zachowywany) + reszta (src) → mergeParam (przeniesienie wartosci)
  // + removeParam (usuniecie zrodla). UWAGA: mergeParam NIE usuwa zrodla
  // automatycznie — musi byc osobny removeParam (memory mergeParam).
  // ═════════════════════════════════════════════════════════════════════════
  function _dedupNormName(s) {
    if (!s) return '';
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function findDuplicateParameters(doc) {
    var roots = getRootItems(doc);
    var byNorm = {};
    for (var i = 0; i < roots.length; i++) {
      var li = roots[i];
      var pid = getNodeId(li);
      if (!pid) continue;
      // Pomijaj sekcje (parametry tylko)
      if (isSection(doc, pid)) continue;
      var name = getNodeName(doc, pid);
      var norm = _dedupNormName(name);
      if (!norm) continue;
      if (!byNorm[norm]) byNorm[norm] = [];
      byNorm[norm].push({ id: pid, name: name });
    }
    var groups = [];
    Object.keys(byNorm).forEach(function (k) {
      if (byNorm[k].length >= 2) groups.push({ norm: k, items: byNorm[k] });
    });
    // Posortuj alfabetycznie po znormalizowanej nazwie
    groups.sort(function (a, b) { return a.norm.localeCompare(b.norm, 'pl'); });
    return groups;
  }

  async function _dedupMergeGroup(doc, srcIds, targetId, onProgress) {
    var errors = [];
    var done = 0;
    for (var i = 0; i < srcIds.length; i++) {
      var sid = srcIds[i];
      try {
        // 1) Przepnij wartosci ze srcId do targetId
        var mr = await fetchAjax('action=mergeParam&id=' + encodeURIComponent(sid) + '&idExist=' + encodeURIComponent(targetId));
        if (mr && mr.error && mr.error !== '') throw new Error(mr.error);
        // 2) Usun zrodlo (mergeParam NIE usuwa automatycznie)
        var parentId = getParentId(doc, sid);
        await fetchAjax('action=removeParam&node=' + encodeURIComponent(sid) + '&tree=0&shop=2&parent=' + encodeURIComponent(parentId));
        // 3) DOM: usun li i space
        var li = doc.getElementById('m_' + sid);
        if (li) li.remove();
        var sp = doc.getElementById('space_' + sid);
        if (sp) sp.remove();
      } catch (e) {
        errors.push({ id: sid, msg: e.message || String(e) });
      }
      done++;
      if (onProgress) onProgress(done, srcIds.length);
    }
    return { done: done, errors: errors };
  }

  function showFindDuplicatesModal(doc) {
    var d = doc || document;
    var groups = findDuplicateParameters(d);
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    var FONT = "'DM Sans', sans-serif";
    if (!d.getElementById('tpcd-dmsans-link')) {
      var lnk = d.createElement('link'); lnk.id = 'tpcd-dmsans-link'; lnk.rel = 'stylesheet';
      lnk.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
      d.head.appendChild(lnk);
    }

    var overlay = d.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(26,26,46,.45);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:30px 16px;font-family:' + FONT;
    var modal = d.createElement('div');
    modal.style.cssText = 'width:100%;max-width:680px;background:#fff;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;font-family:' + FONT + ';max-height:90vh;display:flex;flex-direction:column';
    overlay.appendChild(modal);
    d.body.appendChild(overlay);
    function close() { overlay.remove(); }

    var selectedTargetByGroup = {}; // norm → targetId

    function render() {
      var groupsHtml = '';
      if (groups.length === 0) {
        groupsHtml = '<div style="padding:30px;text-align:center;color:#98a2b3;font-size:13px">Nie znaleziono zdublowanych parametrów ✓</div>';
      } else {
        groupsHtml = groups.map(function (g, gi) {
          var targetId = selectedTargetByGroup[g.norm] || g.items[0].id;
          selectedTargetByGroup[g.norm] = targetId;
          var rows = g.items.map(function (it) {
            var isTarget = (String(it.id) === String(targetId));
            return '<label class="tpdup-row" data-norm="' + esc(g.norm) + '" data-id="' + esc(it.id) + '" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;background:' + (isTarget ? '#f5f8ff' : '#fff') + ';border:1px solid ' + (isTarget ? '#bfcffd' : '#eef0f4') + '">' +
              '<input type="radio" name="tpdup_t_' + gi + '" value="' + esc(it.id) + '"' + (isTarget ? ' checked' : '') + '>' +
              '<span style="font-size:13px;color:#1a1a2e;flex:1">' + esc(it.name) + '</span>' +
              '<span style="font-size:11px;color:#9aa3b0">ID ' + esc(it.id) + '</span>' +
              (isTarget ? '<span style="font-size:11px;color:#2563eb;font-weight:600">→ zachowaj</span>' : '<span style="font-size:11px;color:#dc2626">→ scal i usuń</span>') +
            '</label>';
          }).join('');
          return '<div style="margin-bottom:14px;border:1px solid #e8ebf0;border-radius:10px;overflow:hidden">' +
            '<div style="padding:10px 14px;background:#fafbfc;border-bottom:1px solid #eef0f4;display:flex;align-items:center;justify-content:space-between;gap:10px">' +
              '<div style="font-size:12px;color:#1a1a2e"><strong>' + esc(g.items[0].name) + '</strong> <span style="color:#9aa3b0">— ' + g.items.length + ' parametrów</span></div>' +
              '<button type="button" class="tpdup-merge" data-group-idx="' + gi + '" style="padding:6px 14px;border-radius:6px;border:none;background:linear-gradient(135deg,#4f8cff,#3b6de0);color:#fff;font-size:12px;font-weight:600;cursor:pointer">Połącz w wybrany</button>' +
            '</div>' +
            '<div style="padding:8px 12px;display:flex;flex-direction:column;gap:4px">' + rows + '</div>' +
          '</div>';
        }).join('');
      }

      modal.innerHTML =
        // Header
        '<div style="padding:20px 22px 16px;display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #eef0f4;flex-shrink:0">' +
          '<div style="display:flex;align-items:center;gap:12px">' +
            '<div style="width:42px;height:42px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#fef3c7;color:#d97706">' +
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><path d="M10 14h4"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:16px;font-weight:700;color:#1a1a2e">Wykryte duplikaty parametrów</div>' +
              '<div style="font-size:12.5px;color:#98a2b3;margin-top:2px">Wybierz parametr docelowy w każdej grupie — pozostałe zostaną scalone (przeniesienie wartości) i usunięte</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="tpdup-close" style="width:32px;height:32px;border-radius:8px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#b0b8c9;padding:0">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        // Body
        '<div style="padding:16px 22px;overflow-y:auto;flex:1;min-height:0">' + groupsHtml + '</div>' +
        // Footer
        '<div style="padding:14px 22px;border-top:1px solid #eef0f4;background:#fafbfc;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">' +
          '<button type="button" class="tpdup-cancel" style="padding:9px 20px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-size:13px;font-weight:600;cursor:pointer">Zamknij</button>' +
        '</div>';
      bindEvents();
    }

    function bindEvents() {
      modal.querySelector('.tpdup-close').addEventListener('click', close);
      modal.querySelector('.tpdup-cancel').addEventListener('click', close);
      modal.querySelectorAll('.tpdup-row').forEach(function (row) {
        row.addEventListener('click', function () {
          var norm = row.getAttribute('data-norm');
          var id = row.getAttribute('data-id');
          selectedTargetByGroup[norm] = id;
          render();
        });
      });
      modal.querySelectorAll('.tpdup-merge').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          var gi = parseInt(btn.getAttribute('data-group-idx'), 10);
          var g = groups[gi]; if (!g) return;
          var targetId = selectedTargetByGroup[g.norm] || g.items[0].id;
          var srcIds = g.items.filter(function (it) { return String(it.id) !== String(targetId); }).map(function (it) { return it.id; });
          if (!srcIds.length) { alert('Brak źródłowych parametrów do scalenia.'); return; }
          var tgtName = (g.items.find(function (it) { return String(it.id) === String(targetId); }) || {}).name || ('ID ' + targetId);
          if (!confirm('Scalić ' + srcIds.length + ' parametr(y) do „' + tgtName + '" (ID ' + targetId + ')?\n\nWartości zostaną przeniesione, źródłowe parametry usunięte.\nOperacja nieodwracalna.')) return;
          btn.disabled = true; btn.textContent = 'Łączenie…';
          try {
            var res = await _dedupMergeGroup(d, srcIds, targetId, function (done, total) {
              btn.textContent = 'Łączenie ' + done + '/' + total + '…';
            });
            if (res.errors.length) {
              alert('Częściowy sukces: ' + (res.done - res.errors.length) + '/' + res.done + ' OK. Błędy:\n' + res.errors.map(function (e) { return 'ID ' + e.id + ': ' + e.msg; }).join('\n'));
            } else if (_panel) {
              _panel.showStatus('Scalono ' + srcIds.length + ' parametrów do „' + tgtName + '"');
            }
            // Usun grupe z widoku (already merged)
            groups.splice(gi, 1);
            render();
          } catch (e) {
            btn.disabled = false; btn.textContent = 'Połącz w wybrany';
            alert('Błąd łączenia: ' + (e.message || e));
          }
        });
      });
    }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    render();
  }

  // v4.6.49: modal USTAWIEŃ przebudowany 1:1 w stylu Menu (tm-settings-v2).
  // Układ: Sklep+Język · Treść (Nazwa, Nazwa w nagłówku, Opis, Opis na liście
  // towarów) · Wyświetlanie · Grafiki · Filtrowanie(wkrótce). Wszystko na
  // ZWERYFIKOWANYCH endpointach: setSettings(names+icon_*_type), setDescription,
  // editNodeShopData(anti-clobber), setNodeDesc, saveDisplayMode, saveParamGfx,
  // removeParamGfx, getParameterLangData, getNode.
  function showEditElementModal(doc, nodeId) {
    var d = doc || document;
    var _fvEditor = null; // v4.6.112: handle edytora filtrow widoczny w doSave (closure)
    if (typeof ensureSeoV2Css === 'function') ensureSeoV2Css(d);
    if (_panel && _panel.showStatus) _panel.showStatus('Wczytywanie ustawień…');
    function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
    function P(url, b) { return fetchAjaxRaw(url, b); }
    function navGetNode(shop, lg) { return P('/panel/ajax/parameters.php', 'action=getNode&tes=t&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lg) + '&shop=' + encodeURIComponent(shop) + '&tree=parameters&parent=0'); }

    fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(nodeId)).then(function (resp) {
      var dt = resp && resp.data ? resp.data : null;
      if (!dt || !dt.langData) { alert('Nie udało się wczytać danych elementu'); return; }
      var isVal = String(dt.type) === 'value';
      var order = ['pol', 'eng', 'ger', 'fra', 'ces', 'ukr', 'ita', 'esp', 'rus', 'lit', 'lav', 'est', 'nld', 'hun', 'swe', 'slk', 'slv', 'bul', 'hrv', 'rum', 'por', 'dan', 'fin', 'nor'];
      var langs = Object.keys(dt.langData).sort(function (a, b) { var ia = order.indexOf(a), ib = order.indexOf(b); if (ia < 0) ia = 999; if (ib < 0) ib = 999; return (ia - ib) || a.localeCompare(b); });
      var curLang = (langs.indexOf(LANG) >= 0 ? LANG : (langs.indexOf('pol') >= 0 ? 'pol' : langs[0]));
      var st = {};
      langs.forEach(function (lg) { var L = dt.langData[lg] || {}; st[lg] = { name: L.name || '', description: L.description || '' }; });
      var elName = st[curLang].name || st[(langs.indexOf(LANG) >= 0 ? LANG : langs[0])] && st[langs[0]].name || ('ID ' + nodeId);
      // sklepy z IAI.shops_list (domeny); fallback z kluczy langData
      var shopNames = {};
      try { var GW = (typeof getIframeWin === 'function') ? getIframeWin() : window; var sl = GW && GW.IAI && GW.IAI.shops_list; if (sl) for (var i = 0; i < sl.length; i++) if (sl[i]) shopNames[String(sl[i].id)] = sl[i].name || ''; } catch (e) {}
      // v4.6.133: lista sklepow — preferuj IAI.shops_list (wszystkie sklepy w systemie).
      // Wczesniej zbieralismy tylko klucze z langData[lang].icon_*/display_mode — ale wartosci
      // nie maja grafik ani display_mode per shop, wiec dla wartosci zwracalo tylko shopid1.
      var ss = {};
      Object.keys(shopNames).forEach(function (s) { if (/^\d+$/.test(s)) ss[s] = true; });
      langs.forEach(function (lg) { var L = dt.langData[lg] || {}; ['icon_search_type', 'icon_projector_type', 'display_mode', 'icon_search', 'icon_projector'].forEach(function (k) { if (L[k] && typeof L[k] === 'object') Object.keys(L[k]).forEach(function (s) { if (/^\d+$/.test(s)) ss[s] = true; }); }); });
      var shops = Object.keys(ss).sort(function (a, b) { return (+a) - (+b); });
      if (!shops.length) shops = ['1'];
      var curShop = shops[0];
      function shopLabel(s) { return shopNames[String(s)] || ('Sklep ' + s); }

      var SORT_OPTS = [['', 'domyślne'], ['d_relevance', 'najlepsza trafność'], ['d_date', 'dacie dodania - malejąco'], ['a_date', 'dacie dodania - rosnąco'], ['d_priority', 'priorytecie malejąco i dacie dodania malejąco'], ['a_priority', 'priorytecie malejąco i dacie dodania rosnąco'], ['a_priorityname', 'priorytecie malejąco i nazwie rosnąco'], ['d_priorityname', 'priorytecie malejąco i nazwie malejąco'], ['d_priorityonly', 'priorytecie - malejąco'], ['a_priorityonly', 'priorytecie - rosnąco'], ['a_name', 'nazwie, alfabetycznie - rosnąco'], ['d_name', 'nazwie, alfabetycznie - malejąco'], ['a_price', 'cenie - rosnąco'], ['d_price', 'cenie - malejąco']];

      var overlay = d.createElement('div'); overlay.className = 'tm-node-modal-overlay tm-overlay tm-settings-v2';
      var modal = d.createElement('div'); modal.className = 'tm-modal-content';
      function subtitleHtml() {
        var hl = 'font-weight:700;color:#5f5f5f;';
        return 'ID: <span class="tp-seo-copyid" title="Kliknij, aby skopiować ID" style="cursor:pointer;' + hl + '">' + esc(nodeId) + '</span>' +
          ' · ' + (isVal ? 'wartość parametru' : 'parametr') + ' „' + esc(elName) + '"' +
          ' · Sklep: <span style="' + hl + '">' + esc(shopLabel(curShop)) + '</span>' +
          ' · Język: <span style="' + hl + '">' + esc(getLangName(curLang)) + '</span>';
      }
      var header = d.createElement('div'); header.className = 'tm-modal-header';
      header.innerHTML =
        '<div class="tm-settings-header-left">' +
          '<div class="tm-settings-header-icon"><span class="material-symbols-outlined">settings</span></div>' +
          '<div class="tm-settings-header-text">' +
            '<div class="tm-settings-header-title">Ustawienia — ' + esc(elName) + '</div>' +
            '<div class="tm-settings-header-subtitle" id="tp-set-sub">' + subtitleHtml() + '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="tm-settings-close" aria-label="Zamknij"><span class="material-symbols-outlined">close</span></button>';
      modal.appendChild(header);
      function refreshSub() { var s = header.querySelector('#tp-set-sub'); if (s) s.innerHTML = subtitleHtml(); }
      header.addEventListener('click', function (ev) {
        var t = ev.target; while (t && t !== header && !(t.classList && t.classList.contains('tp-seo-copyid'))) t = t.parentNode;
        if (!t || t === header) return;
        var txt = String(nodeId);
        function ok2() { if (_panel) _panel.showStatus('Skopiowano ID: ' + txt); }
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok2, function () {}); else ok2(); } catch (e) {}
      });

      var bodyEl = d.createElement('div'); bodyEl.className = 'tm-modal-body';
      modal.appendChild(bodyEl);
      var footer = d.createElement('div'); footer.className = 'tm-modal-footer';
      footer.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="tm-ai-footer-btn tp-copylang"><span class="material-symbols-outlined">content_copy</span>Powiel teksty na języki</button><button type="button" class="tm-ai-footer-btn tp-copyshop"><span class="material-symbols-outlined">store</span>Powiel ustawienia na sklepy</button></div><div class="tm-footer-right"><button type="button" class="tm-btn-cancel">Anuluj</button><button type="button" class="tm-btn-save">Zapisz</button></div>';
      modal.appendChild(footer);
      overlay.appendChild(modal); d.body.appendChild(overlay);
      var saveBtn = footer.querySelector('.tm-btn-save');
      function close() { overlay.classList.add('tm-closing'); setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 200); }
      header.querySelector('.tm-settings-close').addEventListener('click', close);
      footer.querySelector('.tm-btn-cancel').addEventListener('click', close);

      function ic(n) { return n ? '<span class="material-symbols-outlined tm-input-icon">' + n + '</span>' : ''; }
      function mkSel(name, opts, selv, icon, dis) {
        var o = ''; for (var i = 0; i < opts.length; i++) o += '<option value="' + esc(opts[i][0]) + '"' + (String(opts[i][0]) === String(selv) ? ' selected' : '') + '>' + esc(opts[i][1]) + '</option>';
        return '<div class="tm-input-wrap">' + ic(icon) + '<select class="tm-field-select" name="' + name + '"' + (dis ? ' disabled' : '') + '>' + o + '</select></div>';
      }
      function mkInp(name, val, icon) { return '<div class="tm-input-wrap">' + ic(icon) + '<input class="tm-node-text-input" name="' + name + '" value="' + esc(val) + '"></div>'; }
      function card(icon, title, rowsHtml) { return '<div class="tm-section-card tm-section-card--seo"><div class="tm-section-header"><span class="material-symbols-outlined">' + icon + '</span>' + title + '</div><div class="tm-section-body">' + rowsHtml + '</div></div>'; }
      function rowF(label, ctrl) { return '<div class="tm-field-row"><span class="tm-field-label">' + esc(label) + '</span>' + ctrl + '</div>'; }
      function rowStacked(label, id) { return '<div class="tm-field-row tm-field-row--stacked"><span class="tm-field-label">' + esc(label) + '</span><div id="' + id + '"></div></div>'; }

      // edytory opisu (per lang) i opisu listy (per shop+lang) — createEditorWidget
      var edDesc = null, edList = null, navData = null;

      function buildBody(dn) {
        navData = dn || {};
        var ctxCard = card('storefront', 'Sklep i język',
          rowF('Sklep', mkSel('f_shop', shops.map(function (s) { return [s, shopLabel(s)]; }), curShop, 'storefront')) +
          rowF('Język', mkSel('f_lang', langs.map(function (lg) { return [lg, getLangName(lg)]; }), curLang, 'translate')));

        var hlAuto = !dn.headline_name;
        var contentCard = card('edit_note', 'Treść',
          rowF('Nazwa (' + getLangName(curLang) + ')', mkInp('f_name', st[curLang].name, 'title')) +
          (isVal ? (rowF('Nazwa w nagłówku', mkSel('f_hlmode', [['d', 'wygeneruj automatycznie'], ['o', 'własna nazwa']], hlAuto ? 'd' : 'o', 'tune')) +
            '<div class="tm-field-row" id="row_hltext"' + (hlAuto ? ' style="display:none"' : '') + '><span class="tm-field-label">Nazwa w nagłówku strony</span>' + mkInp('f_headline', dn.headline_name || '', 'badge') + '</div>') : '') +
          '<div class="tm-field-row tm-field-row--stacked"><div id="host_desc"></div></div>' +
          (isVal ? '<div class="tm-field-row tm-field-row--stacked"><div id="host_list"></div></div>' : ''));

        var view = (dn.display_limit || dn.sort || (dn.display_mode && dn.display_mode_default && dn.display_mode !== dn.display_mode_default)) ? 'own' : 'default';
        var dm = (dn.display_modes && dn.display_modes[0]) || { id: 'normal', display_limit_default: '24' };
        var curLimit = (dn.display_limit && dn.display_limit[dm.id]) || '';
        var curSort = (dn.sort && dn.sort[dm.id]) || '';
        var aSort = dn.allowMenuSortChange === 'y' ? 'y' : 'n';
        var aLim = dn.allowMenuLimitChange === 'y' ? 'y' : 'n';
        var dispCard = card('grid_view', 'Wyświetlanie',
          rowF('Ustawienia wyświetlania towarów', mkSel('f_view', [['default', 'Użyj ustawień domyślnych'], ['own', 'Użyj ustawień własnych']], view, 'tune')) +
          '<div id="disp_own"' + (view === 'own' ? '' : ' style="display:none"') + '>' +
            '<div class="tm-hint-bar tm-hint-bar--info"><span class="tm-hint-icon"></span><span>Ustawienia własne nadpisują domyślne sortowanie i limit towarów dla tego elementu.</span></div>' +
            rowF('Ilość wyświetlanych towarów', '<div class="tm-input-wrap"><input class="tm-node-text-input" name="f_limit" type="number" min="1" value="' + esc(curLimit || dm.display_limit_default || '24') + '"></div>') +
            rowF('Tryb sortowania', mkSel('f_sort', SORT_OPTS, curSort, 'sort')) +
          '</div>');

        var gfxCard = card('image', 'Grafiki', '<div id="host_gfx"></div>');
        var filterCard = card('filter_alt', 'Filtrowanie',
          '<div id="host_filters"></div>');

        bodyEl.innerHTML = ctxCard + contentCard + (isVal ? dispCard : '') + gfxCard + (isVal ? filterCard : '');

        // edytory
        function relocateEdBar(edW, labelText) {
          try {
            var head = d.createElement('div'); head.className = 'tp-ed-v2head';
            var lab = d.createElement('span'); lab.className = 'tp-ed-v2lbl'; lab.textContent = labelText;
            head.appendChild(lab);
            var bar = edW.container.querySelector('.tp-ed-bar');
            if (bar) head.appendChild(bar);
            edW.container.insertBefore(head, edW.container.firstChild);
          } catch (e) {}
        }
        var hd = bodyEl.querySelector('#host_desc');
        edDesc = createEditorWidget(d, st[curLang].description, 7);
        hd.appendChild(edDesc.container);
        relocateEdBar(edDesc, 'Opis (HTML)');
        var hl = bodyEl.querySelector('#host_list');
        if (hl) {
          edList = createEditorWidget(d, '', 6);
          hl.appendChild(edList.container);
          relocateEdBar(edList, 'Opis na liście towarów (HTML)');
          P('/panel/ajax/parameters.php', 'action=getNodeDesc&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0')
            .then(function (g) { try { edList.setValue((g && g.data && g.data.desc) || (g && g.desc) || ''); } catch (e) {} }, function () {});
        } else { edList = null; }

        wire();
        renderGfx();
        if (isVal) {
          var hf = bodyEl.querySelector('#host_filters');
          if (hf) renderValueFiltersEditor(hf, d, nodeId, curShop, curLang).then(function (h) { _fvEditor = h; });
        }
      }

      function wire() {
        var shopSel = bodyEl.querySelector('[name=f_shop]');
        if (shopSel) shopSel.addEventListener('change', function () { stashName(); curShop = shopSel.value; refreshSub(); reload(); });
        var lngSel = bodyEl.querySelector('[name=f_lang]');
        if (lngSel) lngSel.addEventListener('change', function () { stashName(); curLang = lngSel.value; refreshSub(); reload(); });
        var hlm = bodyEl.querySelector('[name=f_hlmode]'); var hlr = bodyEl.querySelector('#row_hltext');
        if (hlm && hlr) hlm.addEventListener('change', function () { hlr.style.display = hlm.value === 'o' ? '' : 'none'; });
        var vsel = bodyEl.querySelector('[name=f_view]'); var dOwn = bodyEl.querySelector('#disp_own');
        if (vsel && dOwn) vsel.addEventListener('change', function () { dOwn.style.display = vsel.value === 'own' ? '' : 'none'; });
      }
      function stashName() { var ni = bodyEl.querySelector('[name=f_name]'); if (ni) st[curLang].name = ni.value; if (edDesc) { try { st[curLang].description = edDesc.getValue(); } catch (e) {} } }

      function reload() {
        saveBtn.disabled = true;
        var h = bodyEl.offsetHeight; if (h) bodyEl.style.minHeight = h + 'px';
        bodyEl.classList.add('tp-seo-busy');
        navGetNode(curShop, curLang).then(function (r) {
          buildBody((r && r.data) || {});
          saveBtn.disabled = false;
          bodyEl.classList.remove('tp-seo-busy');
          (window.requestAnimationFrame || setTimeout)(function () { bodyEl.style.minHeight = ''; });
        }).catch(function () { bodyEl.classList.remove('tp-seo-busy'); bodyEl.style.minHeight = ''; saveBtn.disabled = false; });
      }

      // ===== GRAFIKI (czysto z getParameterLangData + saveParamGfx/removeParamGfx) =====
      function gfxUpload(file, cx, sh, kind, lg) {
        var fn = (file.name || ('g_' + nodeId + '.jpg')).replace(/\.jpe?g$/i, '.jpg');
        var u = '/panel/ajax/uploadLargeFile.php?largeFileMode=1&fileSize=' + file.size + '&fileName=' + encodeURIComponent(fn) + '&dir=&offset=0&chunkSize=' + file.size;
        return file.arrayBuffer().then(function (ab) { return fetch(u, { method: 'POST', credentials: 'same-origin', body: ab }); }).then(function (r) { return r.json(); }).then(function (data) {
          if (!data || data.status !== 'OK' || !data.name) throw new Error((data && data.errmsg) || 'Upload odrzucony');
          var fd = new FormData();
          fd.append('action', 'saveParamGfx'); fd.append('shop', String(sh)); fd.append('lang', lg); fd.append('id', String(nodeId)); fd.append('type', cx);
          if (kind && kind !== 'single') fd.append('version', kind);
          fd.append('completed_fileUploaderField', JSON.stringify([[fn, data.name]]));
          return fetch('/panel/ajax/parameters.php', { method: 'POST', credentials: 'same-origin', body: fd });
        }).then(function (r) { return r.text(); }).then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { j = null; } if (j && j.status === 'error') throw new Error(j.error || ('errno ' + j.errno)); var p = null; if (j && j.data) for (var k in j.data) if (/^icon_/.test(k) && j.data[k]) { p = j.data[k]; break; } return { path: p ? ('/' + String(p).replace(/^\/+/, '')) : null }; });
      }
      function gfxRemove(cx, sh, lg, version) {
        var b = 'action=removeParamGfx&id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(lg) + '&shop=' + encodeURIComponent(sh) + '&type=' + encodeURIComponent(cx) + (version ? '&version=' + encodeURIComponent(version) : '');
        return fetch('/panel/ajax/parameters.php', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: b }).then(function (r) { return r.text(); });
      }
      var gfxTypeState = {}; // cx -> 'img'|'img_rwd' (per curShop+curLang, do setSettings)
      var gfxEnableState = {}; // (cx+'@'+sh+'@'+lg) -> 'n'|'y_manual'|'y_folder'
      function _origin() { try { var GW2 = (typeof getIframeWin === 'function') ? getIframeWin() : window; return (GW2 && GW2.location && GW2.location.origin) || location.origin || ''; } catch (e) { return location.origin || ''; } }
      function _abs(p) { if (!p) return ''; p = String(p).split('?')[0]; if (/^https?:\/\//i.test(p)) return p; return _origin() + '/' + p.replace(/^\/+/, ''); }
      function _hasAnyGfx(L, cx, sh) {
        return !!((L['icon_' + cx] && L['icon_' + cx][sh]) || (L['icon_' + cx + '_desktop'] && L['icon_' + cx + '_desktop'][sh]) ||
          (L['icon_' + cx + '_tablet'] && L['icon_' + cx + '_tablet'][sh]) || (L['icon_' + cx + '_mobile'] && L['icon_' + cx + '_mobile'][sh]));
      }
      function mkUploadRow(labelTxt, cx, sh, kind) {
        var row = d.createElement('div'); row.className = 'tp-gfx-upload-row';
        row.innerHTML = '<span class="tp-gfx-upload-label">' + esc(labelTxt) + '</span>' +
          '<button type="button" class="tp-gfx-browse">Przeglądaj…</button>' +
          '<span class="tp-gfx-upload-state">Nie wybrano pliku.</span>';
        var btn = row.querySelector('.tp-gfx-browse');
        var stt = row.querySelector('.tp-gfx-upload-state');
        var fin = d.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
        row.appendChild(fin);
        btn.addEventListener('click', function () { fin.value = ''; fin.click(); });
        fin.addEventListener('change', function () {
          var f = fin.files && fin.files[0]; if (!f) return;
          stt.textContent = f.name + ' — wgrywanie…'; btn.disabled = true;
          gfxUpload(f, cx, sh, kind, curLang).then(function (res) {
            stt.textContent = f.name + ' — wgrano i zapisano ✓'; btn.disabled = false;
            var pth = (res && res.path) || '';
            var key = (kind === 'single') ? ('icon_' + cx) : ('icon_' + cx + '_' + kind);
            if (pth) { dt.langData[curLang] = dt.langData[curLang] || {}; dt.langData[curLang][key] = dt.langData[curLang][key] || {}; dt.langData[curLang][key][sh] = pth.replace(/^\//, ''); }
            if (_panel) _panel.showStatus('Wgrano grafikę „' + f.name + '" (zapisane w panelu)');
            renderGfx();
          }).catch(function (e) { btn.disabled = false; stt.textContent = f.name + ' — błąd'; alert('Błąd wgrywania „' + f.name + '": ' + (e.message || e)); });
        });
        return row;
      }
      function mkFolderUpload(cx, sh) {
        var wrap = d.createElement('div');
        var guide = d.createElement('div'); guide.className = 'tp-gfx-folder-guide';
        guide.innerHTML = '<strong>Schemat nazw plików:</strong> <code>' + esc(String(nodeId)) + '_' + esc(String(sh)) + '[_desktop|_tablet|_mobile].jpg</code>' +
          '<br>Pliki z folderu zostaną dopasowane do slotów po nazwie (brak sufiksu = jedna wielkość).';
        wrap.appendChild(guide);
        var fi = d.createElement('input'); fi.type = 'file'; fi.setAttribute('webkitdirectory', ''); fi.setAttribute('multiple', '');
        fi.style.cssText = 'font-size:12px;margin-bottom:8px;display:block;';
        wrap.appendChild(fi);
        var mapBox = d.createElement('div'); mapBox.className = 'tp-gfx-folder-map';
        wrap.appendChild(mapBox);
        function classify(name) { var n = name.toLowerCase(); if (/_desktop\.[a-z0-9]+$/.test(n)) return 'desktop'; if (/_tablet\.[a-z0-9]+$/.test(n)) return 'tablet'; if (/_mobile\.[a-z0-9]+$/.test(n)) return 'mobile'; return 'single'; }
        fi.addEventListener('change', function () {
          var files = [].slice.call(fi.files || []).filter(function (f) { return /^image\//.test(f.type); });
          if (!files.length) { mapBox.style.display = 'none'; return; }
          mapBox.style.display = '';
          var rwd = (gfxTypeState[cx] === 'img_rwd');
          var rows = files.map(function (f) { var slot = classify(f.name); if (!rwd) slot = 'single'; return { f: f, slot: slot }; });
          var html = '<strong>Dopasowanie:</strong><div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;">';
          rows.forEach(function (r) { html += '<div>✓ ' + esc(r.slot) + ' ← ' + esc(r.f.name) + ' (' + (r.f.size / 1024).toFixed(1) + ' KB)</div>'; });
          html += '</div>';
          mapBox.innerHTML = html;
          var go = d.createElement('button'); go.type = 'button'; go.className = 'tp-gfx-browse'; go.style.cssText = 'margin-top:10px;'; go.textContent = 'Wgraj dopasowane (' + rows.length + ')';
          go.addEventListener('click', function () {
            go.disabled = true; go.textContent = 'Wgrywanie…';
            (function next(i) {
              if (i >= rows.length) { go.textContent = 'Gotowe ✓'; if (_panel) _panel.showStatus('Wgrano ' + rows.length + ' grafik z katalogu'); renderGfx(); return; }
              var r = rows[i];
              gfxUpload(r.f, cx, sh, r.slot, curLang).then(function () { next(i + 1); })
                .catch(function (e) { go.disabled = false; go.textContent = 'Wgraj dopasowane (' + rows.length + ')'; alert('Błąd wgrywania „' + r.f.name + '": ' + (e.message || e)); });
            })(0);
          });
          mapBox.appendChild(go);
        });
        return wrap;
      }
      function renderGfx() {
        var host = bodyEl.querySelector('#host_gfx'); if (!host) return;
        host.innerHTML = '';
        var L = (dt.langData && dt.langData[curLang]) || {};
        [['search', 'Grafika na liście towarów'], ['projector', 'Grafika na karcie towaru']].forEach(function (pair) {
          var cx = pair[0], title = pair[1];
          var typeObj = L['icon_' + cx + '_type'] || {};
          var typ = (typeObj[curShop] === 'img') ? 'img' : 'img_rwd';
          gfxTypeState[cx] = typ;
          var ekey = cx + '@' + curShop + '@' + curLang;
          if (!(ekey in gfxEnableState)) gfxEnableState[ekey] = _hasAnyGfx(L, cx, curShop) ? 'y_manual' : 'n';

          var hd2 = d.createElement('div'); hd2.className = 'tp-gfx-slot-header'; hd2.textContent = title.toUpperCase();
          host.appendChild(hd2);

          // Selektor stanu grafiki
          var re = d.createElement('div'); re.className = 'tp-gfx-subfield';
          re.innerHTML = '<span class="tm-field-label">Grafika</span>' +
            '<div class="tm-input-wrap"><span class="material-symbols-outlined tm-input-icon">image</span>' +
            '<select class="tm-field-select tp-gfx-en">' +
              '<option value="n">Wyłączona</option>' +
              '<option value="y_manual">Włączona — wskaż grafiki</option>' +
              '<option value="y_folder">Włączona — wgraj z katalogu</option>' +
            '</select></div>';
          host.appendChild(re);
          var enSel = re.querySelector('.tp-gfx-en'); enSel.value = gfxEnableState[ekey];

          // Typ grafiki
          var rt = d.createElement('div'); rt.className = 'tp-gfx-subfield';
          rt.innerHTML = '<span class="tm-field-label">Typ grafiki</span>' +
            '<div class="tm-input-wrap"><span class="material-symbols-outlined tm-input-icon">aspect_ratio</span>' +
            '<select class="tm-field-select tp-gfx-typ">' +
              '<option value="img_rwd">Obrazek (trzy wielkości — RWD)</option>' +
              '<option value="img">Obrazek (jedna wielkość — niezalecany, chyba że SVG)</option>' +
            '</select></div>';
          host.appendChild(rt);
          var typSel = rt.querySelector('.tp-gfx-typ'); typSel.value = typ;

          var slots = d.createElement('div'); slots.className = 'tp-gfx-slot-upload';
          host.appendChild(slots);

          // v4.6.162: dla RWD pokazujemy 3 osobne wiersze (desktop/tablet/mobile),
          // kazdy z wlasnym thumb + actions + upload. Wczesniej 1 wspolny thumb byl
          // dla "najlepszego dopasowania" — przy uzupelnianiu wariantow wiercilo sie.
          function mkVariantBlock(variantLabel, variantKey) {
            var L2 = (dt.langData && dt.langData[curLang]) || {};
            var icoKey = (variantKey === 'single') ? ('icon_' + cx) : ('icon_' + cx + '_' + variantKey);
            var url = L2[icoKey] && L2[icoKey][curShop];
            var wrap = d.createElement('div'); wrap.className = 'tp-gfx-variant-block';
            wrap.style.cssText = 'border-top:1px solid #eef0f4;padding:10px 0;';
            if (url) {
              var cur = _abs(url);
              var bust = cur + (cur.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
              var ex = d.createElement('div'); ex.className = 'tp-gfx-existing';
              ex.innerHTML =
                '<span class="tp-gfx-existing-label">' + esc(variantLabel) + ':</span>' +
                '<img class="tp-gfx-thumb" alt="" src="' + esc(bust) + '">' +
                '<span class="tp-gfx-existing-actions">' +
                  '<a class="tp-gfx-link" target="_blank" rel="noopener" href="' + esc(cur) + '">podgląd</a>' +
                  '<span class="tp-gfx-del" role="button" tabindex="0">Usuń</span>' +
                '</span>';
              wrap.appendChild(ex);
              var thumb = ex.querySelector('.tp-gfx-thumb');
              var link = ex.querySelector('.tp-gfx-link');
              thumb.addEventListener('error', function () { thumb.style.display = 'none'; link.textContent = 'plik niedostępny'; link.removeAttribute('href'); });
              var delEl = ex.querySelector('.tp-gfx-del');
              function doDelete() {
                if (!confirm('Usunąć grafikę „' + variantLabel + '" (' + title + ', ' + getLangName(curLang) + ', sklep ' + shopLabel(curShop) + ')?')) return;
                delEl.textContent = 'Usuwanie…';
                gfxRemove(cx, curShop, curLang, variantKey === 'single' ? null : variantKey).then(function () {
                  if (L2[icoKey]) L2[icoKey][curShop] = '';
                  if (_panel) _panel.showStatus('Usunięto grafikę „' + variantLabel + '"');
                  renderGfx();
                }).catch(function (e) { delEl.textContent = 'Usuń'; alert('Błąd usuwania grafiki: ' + (e.message || e)); });
              }
              delEl.addEventListener('click', doDelete);
              delEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doDelete(); } });
            }
            wrap.appendChild(mkUploadRow(url ? 'Zastąp grafikę:' : 'Nowa grafika:', cx, curShop, variantKey));
            return wrap;
          }

          function renderSlots() {
            slots.innerHTML = '';
            var mode = enSel.value;
            rt.style.display = (mode === 'n') ? 'none' : '';
            if (mode === 'n') return;
            if (mode === 'y_folder') { slots.appendChild(mkFolderUpload(cx, curShop)); return; }

            var variants = (typSel.value === 'img_rwd')
              ? [['desktop', 'Komputer'], ['tablet', 'Tablet'], ['mobile', 'Smartfon']]
              : [['single', 'Grafika']];
            variants.forEach(function (v) {
              slots.appendChild(mkVariantBlock(v[1], v[0]));
            });
          }
          enSel.addEventListener('change', function () { gfxEnableState[ekey] = enSel.value; renderSlots(); });
          typSel.addEventListener('change', function () {
            var L3 = (dt.langData && dt.langData[curLang]) || {};
            L3['icon_' + cx + '_type'] = L3['icon_' + cx + '_type'] || {};
            L3['icon_' + cx + '_type'][curShop] = typSel.value;
            gfxTypeState[cx] = typSel.value;
            renderSlots();
          });
          renderSlots();
        });
      }

      function doSave() {
        stashName();
        saveBtn.disabled = true; saveBtn.textContent = 'Zapisywanie…';
        var nameBody = 'action=setSettings&id=' + encodeURIComponent(nodeId) + '&menuSection=true';
        langs.forEach(function (lg) { nameBody += '&names[' + lg + ']=' + encodeURIComponent(st[lg].name); });
        // typy grafik dla bieżącego sklepu/języka (zachowanie 1:1 z poprzednim modalem)
        ['search', 'projector'].forEach(function (cx) {
          var L = (dt.langData && dt.langData[curLang]) || {};
          var tv = (L['icon_' + cx + '_type'] && L['icon_' + cx + '_type'][curShop]) || gfxTypeState[cx];
          if (tv) nameBody += '&icon_' + cx + '_type[' + curLang + '][' + curShop + ']=' + encodeURIComponent(tv);
        });
        var vsel = bodyEl.querySelector('[name=f_view]');
        var view = vsel ? vsel.value : 'default';
        var hlMode = bodyEl.querySelector('[name=f_hlmode]');
        var hl = (hlMode && hlMode.value === 'o') ? ((bodyEl.querySelector('[name=f_headline]') || {}).value || '') : '';
        var listHtml = ''; try { listHtml = edList.getValue(); } catch (e) {}
        var settingsErr = null;
        fetchAjax(nameBody).then(function (r1) { if (r1 && r1.errno && r1.errno !== 0) settingsErr = (r1.message || ('errno ' + r1.errno)); }, function (e) { settingsErr = (e && e.message) || String(e); }).then(function () {
          function sendDesc(i) { if (i >= langs.length) return Promise.resolve(); var lg = langs[i]; return fetchAjax('action=setDescription&id=' + encodeURIComponent(nodeId) + '&lang=' + lg + '&description=' + encodeURIComponent((st[lg] && st[lg].description) || '')).then(function () {}, function () {}).then(function () { return sendDesc(i + 1); }); }
          return sendDesc(0);
        }).then(function () {
          // Operacje nawigacyjne TYLKO dla wartości (parametry: nazwy+opis+grafiki)
          if (!isVal) return;
          return navGetNode(curShop, curLang).then(function (r) {
            var dn = (r && r.data) || navData || {};
            var keepFD = dn.filter_default ? 'y' : 'n';
            var b = 'action=editNodeShopData&node_type=false&filter_default=' + keepFD +
              '&target=false&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) +
              '&tree=parameters&node=' + encodeURIComponent(nodeId) + '&view=' + (view === 'own' ? 'own' : 'default') + '&parent=0' +
              '&click_action=false&element_hidden=false&displayShowAll=false&showAllIs=false&expand=false' +
              '&node_gfx=false&gfx_active_type=false&gfx_inactive_type=false&gfx_omo_type=false&gfx_type=false' +
              '&meta_default=' + ((dn.meta_title || dn.meta_description || dn.meta_keywords) ? 'n' : 'y') +
              '&meta_keywords=' + encodeURIComponent(dn.meta_keywords || '') + '&meta_title=' + encodeURIComponent(dn.meta_title || '') +
              '&meta_desc=' + encodeURIComponent(dn.meta_description || '') + '&meta_index=' + (dn.meta_robots_index || 'default') +
              '&meta_follow=' + (dn.meta_robots_follow || 'default') + '&headline_name=' + encodeURIComponent(hl);
            return P('/panel/ajax/parameters.php', b);
          }).then(function () {
            return P('/panel/ajax/parameters.php', 'action=setNodeDesc&desc=' + encodeURIComponent(listHtml) + '&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0');
          }).then(function () {
            if (view !== 'own') return;
            var dm = (navData && navData.display_modes && navData.display_modes[0]) || { id: 'normal' };
            var lim = (bodyEl.querySelector('[name=f_limit]') || {}).value || '';
            var srt = (bodyEl.querySelector('[name=f_sort]') || {}).value || '';
            // wartości nie mają w nawigacji opcji „Pozwól klientom zmieniać…" — zachowujemy istniejące
            var asc = (navData && navData.allowMenuSortChange) === 'y' ? 'y' : 'n';
            var alc = (navData && navData.allowMenuLimitChange) === 'y' ? 'y' : 'n';
            var b2 = 'action=saveDisplayMode&display_mode=' + encodeURIComponent(navData && navData.display_mode || navData && navData.display_mode_default || dm.id) +
              '&display_limit[' + dm.id + ']=' + encodeURIComponent(lim) + '&sort[' + dm.id + ']=' + encodeURIComponent(srt) +
              '&allow_sort_change=' + asc + '&allow_limit_change=' + alc + '&sort_mode=' + encodeURIComponent(navData && navData.sort_mode || '') +
              '&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(curLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&operation=';
            return P('/panel/ajax/navigation.php', b2);
          });
        }).then(function () {
          // v4.6.111: zapis filtrow wartosci jako ostatni krok modalu
          if (!isVal || !_fvEditor) return;
          var fvMode = _fvEditor.getMode();
          if (fvMode === 'default') return saveValueFiltersDefault(nodeId, curShop, curLang);
          var ids = _fvEditor.getActiveIds();
          var ps = _fvEditor.getPricestep();
          var psn = (_fvEditor.getPricestepnet && _fvEditor.getPricestepnet()) || ps;
          var po = (_fvEditor.getPerOpts && _fvEditor.getPerOpts()) || {};
          return saveValueFilters(nodeId, curShop, curLang, ids, ps, psn, po);
        }).then(function () {
          var newName = (st[LANG] && st[LANG].name) || st[curLang].name;
          var sm = doc.getElementById('showMenuSub_' + nodeId); if (sm) sm.textContent = newName;
          var li = doc.getElementById('m_' + nodeId); if (li) { var lbl = li.querySelector(':scope > .tp-col-name .tp-row-label'); if (lbl) lbl.textContent = newName; }
          try { tpCacheClearAll(); } catch (e) {}
          if (_panel) _panel.showStatus(settingsErr ? ('Zapisano (z ostrzeżeniem nazw/grafik: ' + settingsErr + ')') : ('Zapisano zmiany — ' + newName), !!settingsErr);
          close();
        }).catch(function (e) { saveBtn.disabled = false; saveBtn.textContent = 'Zapisz'; alert('Błąd zapisu: ' + (e.message || e)); });
      }
      saveBtn.addEventListener('click', doSave);

      // v4.6.140: drugi przycisk — Powiel ustawienia na sklepy
      var copyShopBtn = footer.querySelector('.tp-copyshop');
      if (copyShopBtn) copyShopBtn.addEventListener('click', function () {
        if (shops.length < 2) { alert('Tylko jeden sklep w systemie — nie ma co kopiować.'); return; }
        openCopyShopsDialog(d, shops, curShop, shopLabel, function (srcShop, tgtShops, what) {
          if (_panel) _panel.showStatus('Kopiowanie ustawień z ' + shopLabel(srcShop) + ' na ' + tgtShops.length + ' sklep(y)…');
          copyShopBtn.disabled = true;
          copyShopSettings(nodeId, srcShop, tgtShops, curLang, what).then(function () {
            copyShopBtn.disabled = false;
            if (_panel) _panel.showStatus('Skopiowano ustawienia na ' + tgtShops.length + ' sklep(y)');
          }).catch(function (e) {
            copyShopBtn.disabled = false;
            alert('Błąd kopiowania: ' + (e.message || e));
          });
        });
      });

      footer.querySelector('.tp-copylang').addEventListener('click', function () {
        stashName();
        openCopyTextsDialog(d, langs, curLang, st, getLangName, function (src, tgts, opts) {
          // Per-LANG (name, description) — modyfikuje st[], wymaga "Zapisz" modalu
          for (var ti = 0; ti < tgts.length; ti++) {
            var lg = tgts[ti];
            if (opts.name) st[lg].name = st[src].name;
            if (opts.desc) st[lg].description = st[src].description;
          }
          var parts = [];
          if (opts.name) parts.push('nazwę');
          if (opts.desc) parts.push('opis');
          var ni = bodyEl.querySelector('[name=f_name]'); if (ni) ni.value = st[curLang].name;
          if (opts.desc && tgts.indexOf(curLang) >= 0) {
            try {
              var fr = bodyEl.querySelector('iframe.tox-edit-area__iframe');
              if (fr && fr.contentDocument && fr.contentDocument.body) fr.contentDocument.body.innerHTML = st[curLang].description || '';
            } catch (e) {}
          }

          // v4.6.142: Per-LANG-SHOP (headline, listDesc) — bezposrednie API calls dla curShop
          if (!opts.headline && !opts.listDesc) {
            if (_panel && parts.length) _panel.showStatus('Powielono ' + parts.join(' i ') + ' z „' + getLangName(src) + '" na ' + tgts.length + ' jęz. (zapisz, aby zatwierdzić)');
            return;
          }
          if (_panel) _panel.showStatus('Kopiowanie nagłówka/opisu listy na ' + tgts.length + ' języków…');
          (async function () {
            var errs = [];
            // 1) Pobierz dane src (headline_name + node_desc) raz
            var srcHeadline = '';
            var srcListDesc = '';
            try {
              var rsN = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(src) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0');
              srcHeadline = (rsN && rsN.data && rsN.data.headline_name) || '';
            } catch (e) { errs.push('Brak src headline: ' + (e.message || e)); }
            if (opts.listDesc) {
              try {
                // v4.6.161: fetchAjaxRaw zwraca juz obiekt, bez JSON.parse
                var rDs = await fetchAjaxRaw('/panel/ajax/parameters.php', 'action=getNodeDesc&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(src) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0');
                srcListDesc = (rDs && rDs.data && (rDs.data.desc || rDs.data.description || rDs.data.value)) || '';
              } catch (e) { errs.push('Brak src list-desc: ' + (e.message || e)); }
            }
            // 2) Dla kazdego tgt lang — zapisz w curShop
            for (var ti2 = 0; ti2 < tgts.length; ti2++) {
              var tgLang = tgts[ti2];
              if (opts.headline) {
                try {
                  var rTN = await fetchAjax('action=getNode&node_id=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(tgLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0');
                  var tN = (rTN && rTN.data) || {};
                  var hasMeta = !!(tN.meta_title || tN.meta_description || tN.meta_keywords);
                  var view = (tN.display_limit || tN.sort || (tN.display_mode && tN.display_mode_default && tN.display_mode !== tN.display_mode_default)) ? 'own' : 'default';
                  var filterDef = (tN.filter_default == null) ? 'y' : (tN.filter_default ? 'y' : 'n');
                  var body = 'action=editNodeShopData&node_type=false&filter_default=' + filterDef + '&target=false' +
                    '&lang=' + encodeURIComponent(tgLang) + '&shop=' + encodeURIComponent(curShop) +
                    '&tree=parameters&node=' + encodeURIComponent(nodeId) + '&view=' + view + '&parent=0' +
                    '&click_action=false&element_hidden=false&displayShowAll=false&showAllIs=false&expand=false' +
                    '&node_gfx=false&gfx_active_type=false&gfx_inactive_type=false&gfx_omo_type=false&gfx_type=false' +
                    '&meta_default=' + (hasMeta ? 'n' : 'y') +
                    '&meta_keywords=' + encodeURIComponent(tN.meta_keywords || '') +
                    '&meta_title=' + encodeURIComponent(tN.meta_title || '') +
                    '&meta_desc=' + encodeURIComponent(tN.meta_description || '') +
                    '&meta_index=' + (tN.meta_robots_index || 'default') +
                    '&meta_follow=' + (tN.meta_robots_follow || 'default') +
                    '&headline_name=' + encodeURIComponent(srcHeadline);
                  await fetchAjaxRaw('/panel/ajax/parameters.php', body);
                } catch (e) { errs.push('Jez ' + tgLang + ' nagłówek: ' + (e.message || e)); }
              }
              if (opts.listDesc) {
                try {
                  await fetchAjaxRaw('/panel/ajax/parameters.php', 'action=setNodeDesc&desc=' + encodeURIComponent(srcListDesc) + '&node=' + encodeURIComponent(nodeId) + '&lang=' + encodeURIComponent(tgLang) + '&shop=' + encodeURIComponent(curShop) + '&tree=parameters&parent=0');
                } catch (e) { errs.push('Jez ' + tgLang + ' opis listy: ' + (e.message || e)); }
              }
            }
            if (errs.length) alert('Błędy kopiowania:\n' + errs.join('\n'));
            else if (_panel) {
              var p2 = parts.slice();
              if (opts.headline) p2.push('nagłówek');
              if (opts.listDesc) p2.push('opis listy');
              _panel.showStatus('Powielono ' + p2.join(' + ') + ' na ' + tgts.length + ' jęz.');
            }
          })();
        });
      });

      // start
      saveBtn.disabled = true;
      navGetNode(curShop, curLang).then(function (r) { buildBody((r && r.data) || {}); saveBtn.disabled = false; }, function () { buildBody({}); saveBtn.disabled = false; });
    }).catch(function (e) { alert('Błąd wczytywania: ' + (e.message || e)); });
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
          buttons: gated([
            ifFeat(FEATURES.SORT_ALPHABETICALLY, { icon: 'sort_by_alpha', label: 'Sortuj alfabetycznie', tooltip: 'Posortuj wg nazwy (A→Z / Z→A)', variant: 'text',    onClick: function () { sortAlphabetically(doc); } }),
            ifFeat(FEATURES.SORT_BY_ID,           { icon: 'tag',           label: 'Sortuj po ID',        tooltip: 'Posortuj wg ID (rosnąco / malejąco)', variant: 'text', onClick: function () { sortById(doc); } }),
            ifFeat(FEATURES.TRANSLATIONS,         { icon: 'translate',     label: 'Tłumaczenia',          tooltip: 'Edytuj nazwy parametrów i wartości we wszystkich językach', variant: 'text', onClick: function () { showTranslationsPage(doc); } }),
            { icon: 'merge_type', label: 'Wykryj duplikaty', tooltip: 'Wykryj parametry o tej samej nazwie i zaproponuj ich połączenie', variant: 'text', onClick: function () { showFindDuplicatesModal(doc); } },
            { icon: 'healing', label: 'Napraw przypisania', tooltip: 'Skanuje drzewo i dopina brakujące parameter→product (naprawia historyczne błędne przeniesienia)', variant: 'text', onClick: function () { showRepairAssignmentsModal(doc); } },
            ifFeat(FEATURES.CREATE_PARAMETER,     { icon: 'add',           label: 'Dodaj parametr',       tooltip: 'Dodaj nowy parametr', variant: 'primary', onClick: function () { createNewParameter(doc); } })
          ])
        }
      },
      toolbar: {
        search: {
          placeholder: 'Szukaj parametrów i wartości',
          hint: 'wiele oddziel: | lub ,',
          onChange: function (q) { filterTree(doc, q); }
        },
        sections: gated([
          ifFeat(FEATURES.SELECTION_OPS, { buttons: [
            { icon: 'select_all', tooltip: 'Zaznacz wszystkie widoczne', variant: 'icon', onClick: function () { selectAll(doc); } },
            { icon: 'deselect',   tooltip: 'Odznacz wszystko',           variant: 'icon', onClick: function () { deselectAll(doc); } },
            { icon: 'swap_horiz', tooltip: 'Odwr\u00f3\u0107 zaznaczenie', variant: 'icon', onClick: function () { invertSelection(doc); } }
          ] }),
          ((hasFeature(FEATURES.EXPORT_PARAMETERS) || hasFeature(FEATURES.IMPORT_PARAMETERS)) ? { buttons: gated([
            ifFeat(FEATURES.EXPORT_PARAMETERS, { icon: 'download', label: 'Eksport', tooltip: 'Eksport parametr\u00f3w \u2014 wyb\u00f3r zakresu, formatu i j\u0119zyk\u00f3w', variant: 'text', onClick: function () { showExportModal(doc, 'all'); } }),
            ifFeat(FEATURES.IMPORT_PARAMETERS, { icon: 'upload',   label: 'Import',  tooltip: 'Import parametr\u00f3w z pliku JSON lub CSV',   variant: 'text', onClick: function () { openImportFilePicker(doc); } })
          ]) } : null),
          ifFeat(FEATURES.SECTION_VIEWS, { dropdown: {
            icon: 'visibility',
            options: [ { value: 'all', label: 'Wszystko', active: true } ],
            onChange: function (v) { /* handled by rebuildViewsDropdown */ }
          } }),
          ifFeat(FEATURES.COLUMNS_MENU, { columnsMenu: true }),
          ((hasFeature(FEATURES.EXPAND_ALL) || hasFeature(FEATURES.COLLAPSE_ALL)) ? { buttons: gated([
            ifFeat(FEATURES.COLLAPSE_ALL, { id: 'expand-all',   icon: 'keyboard_double_arrow_up',   tooltip: 'Zwi\u0144 wszystko',   variant: 'icon', onClick: function () { collapseAll(doc); } }),
            ifFeat(FEATURES.EXPAND_ALL,   { id: 'collapse-all', icon: 'keyboard_double_arrow_down', tooltip: 'Rozwi\u0144 wszystko', variant: 'icon', onClick: function (e, api) {
                var stop = api.findToolbarBtn('stop-expand'); if (stop) stop.style.display = '';
                expandAll(doc).then(function () { if (stop) stop.style.display = 'none'; });
              } }),
            ifFeat(FEATURES.EXPAND_ALL,   { id: 'stop-expand',  icon: 'stop',                       tooltip: 'Przerwij',         variant: 'icon', onClick: function (e, api) { stopExpand(); var b = api.findToolbarBtn('stop-expand'); if (b) b.style.display = 'none'; } })
          ]) } : null)
        ])
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
        // v4.6.123: drag=24px \u2014 kolumna ma trzymac \u283f wartosci na samej lewej krawedzi
        // wiersza, na lewo od checkboxa. Parametry maja te kolumne pusta.
        { id: 'drag',     label: '',         width: '24px' },
        { id: 'check',    label: '',         width: '32px' },
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
        version: 'v4.6.175',
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
  // v4.6.108: czy dany sklep ma grafike w kontekscie (icon_search/icon_projector),
  // uwzgledniajac warianty RWD (desktop/tablet/mobile)
  function _shopHasGfx(L, prefix, shop) {
    var keys = [prefix, prefix + '_desktop', prefix + '_tablet', prefix + '_mobile'];
    for (var i = 0; i < keys.length; i++) {
      var o = L[keys[i]];
      if (o && typeof o === 'object' && o[shop] && String(o[shop]).trim() !== '') return true;
    }
    return false;
  }
  function _metaFromLangData(d) {
    var ctx = (d.type === 'value' ? d.context_value_id : d.context_id) || null;
    var ld = d.langData || {};
    // status liczony dla AKTYWNEGO jezyka strony (LANG), nie agregat po wszystkich
    var lg = ld[LANG] ? LANG : (ld['pol'] ? 'pol' : Object.keys(ld)[0]);
    var L = (lg && ld[lg]) || {};
    var descSet = (L.description != null && String(L.description).replace(/<[^>]*>/g, '').trim() !== '');
    // v4.6.108: status grafik PER SKLEP — sklepy = klucze icon_search / icon_projector
    var shopKeys = [];
    if (L.icon_search && typeof L.icon_search === 'object') shopKeys = Object.keys(L.icon_search);
    else if (L.icon_projector && typeof L.icon_projector === 'object') shopKeys = Object.keys(L.icon_projector);
    var gfx = null;
    if (shopKeys.length) {
      var shops = [], withGfx = 0;
      for (var si = 0; si < shopKeys.length; si++) {
        var sh = shopKeys[si];
        var hasS = _shopHasGfx(L, 'icon_search', sh);
        var hasP = _shopHasGfx(L, 'icon_projector', sh);
        if (hasS || hasP) withGfx++;
        shops.push({ shop: sh, search: hasS, projector: hasP });
      }
      gfx = { total: shopKeys.length, withGfx: withGfx, shops: shops };
    }
    return { ctx: ctx, type: d.type, descSet: descSet, gfx: gfx };
  }
  async function fetchContextForNode(nodeId) {
    // klucz cache zależny od języka strony (status liczony per LANG)
    var ck = nodeId + '@' + LANG;
    if (_ctxCache[ck]) return _ctxCache[ck];
    // v4.6.46: cache scope 'cx2', klucz <id>@<lang> (stare bez lang ignorujemy)
    var cached = tpCacheGet('cx3', ck, TP_TTL_CTX);
    if (cached !== null) { _ctxCache[ck] = cached; return cached; }
    try {
      var r = await fetchAjax('action=getParameterLangData&id=' + encodeURIComponent(nodeId));
      var d = r && r.data ? r.data : null;
      if (!d) { _ctxCache[ck] = { ctx: null, descSet: false, gfx: null }; tpCacheSet('cx3', ck, _ctxCache[ck]); return _ctxCache[ck]; }
      _ctxCache[ck] = _metaFromLangData(d);
      tpCacheSet('cx3', ck, _ctxCache[ck]);
      return _ctxCache[ck];
    } catch (e) {
      _ctxCache[ck] = { ctx: null, descSet: false, gfx: null };
      return _ctxCache[ck];
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
    var doc = cell.ownerDocument;
    // brak pol icon_* lub zaden sklep nie ma grafiki -> szara ikona
    if (gfx == null || !gfx.total || gfx.withGfx === 0) {
      var none = doc.createElement('span');
      none.className = 'material-symbols-outlined';
      none.textContent = 'hide_image';
      none.style.cssText = 'font-size:18px;color:#9aa0a6;cursor:help';
      none.title = 'Brak grafik' + (gfx && gfx.total ? ' (0 / ' + gfx.total + ' sklepow)' : '');
      cell.appendChild(none);
      return;
    }
    // zielona = wszystkie sklepy maja grafike, zolta = tylko czesc
    var all = gfx.withGfx === gfx.total;
    var icon = doc.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = all ? 'check_circle' : 'incomplete_circle';
    icon.style.cssText = 'font-size:18px;color:' + (all ? '#137333' : '#e8a000') + ';cursor:help';
    // tooltip — lista per sklep (nazwy z IAI.shops_list)
    var shopNames = {};
    try {
      var win = getIframeWin();
      if (win && win.IAI && win.IAI.shops_list) {
        win.IAI.shops_list.forEach(function (sp) { shopNames[String(sp.id)] = sp.name; });
      }
    } catch (e) {}
    var lines = ['Grafiki: ' + gfx.withGfx + ' / ' + gfx.total + ' sklepow'];
    for (var i = 0; i < gfx.shops.length; i++) {
      var sp = gfx.shops[i];
      var parts = [];
      if (sp.search) parts.push('lista');
      if (sp.projector) parts.push('karta');
      lines.push('\u2022 ' + (shopNames[sp.shop] || ('Sklep ' + sp.shop)) + ': ' + (parts.length ? parts.join(' + ') : 'brak'));
    }
    icon.title = lines.join('\n');
    cell.appendChild(icon);
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

  // v4.6.90/91: dok\u0142adna UNIKALNA liczba towar\u00f3w (parametru / sekcji / warto\u015bci)
  // przez view-manager.php. numberOfOccurrence jest zawodne (0 dla parametr\u00f3w
  // kontekstowych, zani\u017ca dla zwyk\u0142ych \u2014 20617: occ=2, faktycznie 3), a suma
  // natywnych "towary:N" zawy\u017ca (towar w kilku warto\u015bciach liczony wielokrotnie \u2014
  // 20617: suma 39, realnie 3).
  // POST view-manager.php?type=products&view=ajax_content z trait=<id> renderuje
  // przefiltrowan\u0105 list\u0119 ze <span class="total-result">N</span> = dok\u0142adna liczba
  // zdeduplikowanych towar\u00f3w. Filtr trait= jest uniwersalny \u2014 dzia\u0142a dla sekcji,
  // parametr\u00f3w i warto\u015bci (zweryfikowane na demo37 2026-05-22).
  var TRAIT_PRODUCTS_URL = '/panel/ajax/view-manager.php?type=products&view=ajax_content';

  function buildTraitProductsBody(id, page) {
    return '__iai_shop_panel%5B__encoding%5D=utf-8'
      + '&trait=' + encodeURIComponent(id)
      + '&trait_id%5B0%5D=' + encodeURIComponent(id)
      + '&current_page=' + (page || 1)
      + '&sort%5Bcolumn%5D=id&sort%5Btype%5D=d'
      + '&config_width=1000&specialColumns%5Binput%5D=1';
  }

  // Zwraca liczb\u0119 towar\u00f3w >= 0, lub null tylko przy realnym b\u0142\u0119dzie sieci/odpowiedzi.
  // v4.6.91: gdy filtr daje 0 towar\u00f3w, view-manager zwraca komunikat "Nie znaleziono
  // produkt\u00f3w" (msgWrapper) zamiast tabeli \u2014 traktujemy to jako 0, nie b\u0142\u0105d.
  // Cache 'pcount' (liczba towar\u00f3w nie zale\u017cy od j\u0119zyka).
  function fetchTraitProductCount(nodeId) {
    var cached = tpCacheGet('pcount', nodeId, TP_TTL_PRODUCTS);
    if (cached !== null) return Promise.resolve(cached);
    var win = getIframeWin();
    return new Promise(function (resolve) {
      var xhr = new win.XMLHttpRequest();
      xhr.open('POST', TRAIT_PRODUCTS_URL);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = function () {
        var t = xhr.responseText || '';
        var m = /class="total-result">(\d+)</.exec(t);
        var n = null;
        if (m) n = Number(m[1]);
        else if (/Nie znaleziono produkt|id="msg_line_msg"/.test(t)) n = 0;
        if (n !== null) tpCacheSet('pcount', nodeId, n);
        resolve(n);
      };
      xhr.onerror = function () { resolve(null); };
      xhr.send(buildTraitProductsBody(nodeId, 1));
    });
  }

  // v4.6.91: lista ID towar\u00f3w przypisanych do trait (parametr/sekcja/warto\u015b\u0107).
  // view-manager paginuje po 100 \u2014 doci\u0105gamy kolejne strony a\u017c do wyczerpania
  // total (limit maxPages dla bezpiecze\u0144stwa). Zwraca { ids, total, truncated }.
  async function fetchTraitProductIds(nodeId, maxPages) {
    maxPages = maxPages || 25;
    var win = getIframeWin();
    function fetchPage(page) {
      return new Promise(function (resolve) {
        var xhr = new win.XMLHttpRequest();
        xhr.open('POST', TRAIT_PRODUCTS_URL);
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function () { resolve(xhr.responseText || ''); };
        xhr.onerror = function () { resolve(''); };
        xhr.send(buildTraitProductsBody(nodeId, page));
      });
    }
    var ids = []; var seen = {}; var total = 0; var page = 1;
    while (page <= maxPages) {
      var html = await fetchPage(page);
      var mTot = /class="total-result">(\d+)</.exec(html);
      if (mTot) total = Number(mTot[1]);
      // name="id_products[]" \u2014 pomija checkbox nag\u0142\u00f3wka name="select_id_products[]"
      var m, g = 0, pageCount = 0;
      var re = /name="id_products\[\]"\s+id="[^"]*"\s+value="(\d+)"/g;
      while ((m = re.exec(html)) && g < 500) {
        if (!seen[m[1]]) { seen[m[1]] = 1; ids.push(m[1]); }
        pageCount++; g++;
      }
      if (pageCount === 0) break;            // brak wierszy (lub komunikat "brak")
      if (total && ids.length >= total) break; // zebrano wszystko
      page++;
    }
    return { ids: ids, total: total || ids.length, truncated: !!total && ids.length < total };
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
        // v4.6.90: dok\u0142adna unikalna liczba towar\u00f3w (patrz fetchTraitProductCount)
        var total = await fetchTraitProductCount(t.nid);
        t.cell.textContent = '';
        if (total === null) {
          // b\u0142\u0105d sieci \u2014 nie cache'ujemy, pozw\u00f3l na ponown\u0105 pr\u00f3b\u0119 przy nast\u0119pnym skanie
          t.cell.textContent = '\u2013';
          t.cell.setAttribute('data-pp-tooltip', 'Nie uda\u0142o si\u0119 pobra\u0107 liczby towar\u00f3w');
          return;
        }
        t.cell.dataset.countLoaded = '1';
        t.cell.removeAttribute('data-pp-tooltip');
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

    // v4.6.90: BATCH 10 \u2014 view-manager renderuje list\u0119 produkt\u00f3w (ci\u0119\u017csze ni\u017c getTreeForSection)
    var BATCH = 10;
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
