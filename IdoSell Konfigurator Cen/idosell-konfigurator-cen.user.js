// ==UserScript==
// @name         IdoSell - Konfigurator Cen (grupowy)
// @namespace    https://idosell.com/
// @version      1.8.0
// @description  Grupowe zarządzanie konfiguratorem cen: budowa z parametrów towaru (ze zmianą typu i zachowaniem stanów), kopiowanie, tworzenie, eksport/import z pliku towary+parametry, aktualizacja modyfikatorów
// @author       SyncOffer
// @match        https://*.iai-shop.com/panel/app/products-list.php*
// @match        https://*.idosell.com/panel/app/products-list.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // CONFIG
  // =========================================================================

  const AJAX_PARAMS_URL = '/panel/ajax/parameters.php';
  const AJAX_PRODUCT_URL = '/panel/ajax/product-edit.php';
  const AJAX_PRODUCTS_LIST_URL = '/panel/ajax/products-list.php';
  const AJAX_DYNAMIC_CONTENT_URL = '/panel/ajax/product-edit-aceform-dynamiccontent.php';
  const LANG = 'pol';

  const PARAM_TYPES = [
    { value: 'select', label: 'Lista rozwijana', requiredLocked: true },
    { value: 'radio', label: 'Pole jednokrotnego wyboru', requiredLocked: true },
    { value: 'checkbox', label: 'Pole wielokrotnego wyboru', requiredLocked: false },
    { value: 'input', label: 'Pole tekstowe', requiredHidden: true },
  ];

  const INPUT_CONTENT_TYPES = [
    { value: 'text', label: 'Tekst' },
    { value: 'integer', label: 'Liczby ca\u0142kowite' },
    { value: 'float', label: 'Liczby rzeczywiste' },
  ];

  const MODIFIER_TYPES = [
    { value: 'amount_add', label: '+', symbol: '+' },
    { value: 'amount_sub', label: '\u2212', symbol: '\u2212' },
    { value: 'percent_add', label: '+ %', symbol: '+%' },
    { value: 'percent_sub', label: '\u2212 %', symbol: '\u2212%' },
  ];

  // =========================================================================
  // HELPERS
  // =========================================================================

  function getIframeDoc() {
    // Szukaj #bottom_menu_products w każdym zagnieżdżonym iframe
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) continue;
        if (doc.querySelector('#bottom_menu_products')) return doc;
        // Szukaj głębiej — inner iframe
        const innerFrames = doc.querySelectorAll('iframe');
        for (const inner of innerFrames) {
          try {
            const innerDoc = inner.contentDocument;
            if (innerDoc && innerDoc.querySelector('#bottom_menu_products')) return innerDoc;
          } catch (_e) { /* cross-origin */ }
        }
      } catch (_e) { /* cross-origin */ }
    }
    return null;
  }

  function getIframeWin() {
    const doc = getIframeDoc();
    if (doc && doc.defaultView) return doc.defaultView;
    // Fallback: contentWindow pierwszego iframe'a
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const d = iframe.contentDocument;
        if (d && d.querySelector('#bottom_menu_products')) return iframe.contentWindow;
        const inner = d?.querySelectorAll('iframe');
        if (inner) for (const f of inner) {
          try { if (f.contentDocument?.querySelector('#bottom_menu_products')) return f.contentWindow; } catch(_e) {}
        }
      } catch (_e) {}
    }
    return null;
  }

  function waitForIframe(cb) {
    let injected = false;

    function tryInject() {
      if (injected) return;
      const doc = getIframeDoc();
      if (doc && doc.querySelector('#bottom_menu_products')) {
        injected = true;
        cb(doc);
        observeIframeChanges(doc, cb);
      }
    }

    // Obserwuj zmiany w g\u0142\u00f3wnym dokumencie (np. iframe si\u0119 prze\u0142adowa\u0142)
    function observeIframeChanges(iframeDoc, callback) {
      const obs = new MutationObserver(() => {
        const currentDoc = getIframeDoc();
        if (!currentDoc) { injected = false; return; }
        if (currentDoc !== iframeDoc) {
          // Iframe si\u0119 prze\u0142adowa\u0142 — nowy dokument
          obs.disconnect();
          injected = false;
          startPolling();
          return;
        }
        // Sprawdź czy menu istnieje ale przyciski nie
        if (currentDoc.querySelector('#bottom_menu_products') && !currentDoc.querySelector('#configuratorAction')) {
          injected = false;
          tryInject();
        }
      });
      try { obs.observe(iframeDoc.body, { childList: true, subtree: true }); } catch (e) { /* ignore */ }
    }

    // Polling na pocz\u0105tku i po prze\u0142adowaniu iframe
    function startPolling() {
      let attempts = 0;
      const iv = setInterval(() => {
        attempts++;
        tryInject();
        if (injected || attempts > 60) clearInterval(iv);
      }, 500);
    }

    startPolling();

    // Obserwuj główny dokument + iframe'y (inner iframe może się pojawić później)
    const mainObs = new MutationObserver(() => {
      if (!injected) tryInject();
    });
    mainObs.observe(document.body, { childList: true, subtree: true });

    // Dodatkowy observer: gdy outer iframe się załaduje, obserwuj też jego body
    function watchOuterIframe() {
      const outerIframe = document.querySelector('iframe');
      if (!outerIframe) return;
      const attachInnerObserver = () => {
        try {
          const outerDoc = outerIframe.contentDocument;
          if (outerDoc && outerDoc.body) {
            const innerObs = new MutationObserver(() => {
              if (!injected) tryInject();
            });
            innerObs.observe(outerDoc.body, { childList: true, subtree: true });
          }
        } catch (_e) { /* cross-origin */ }
      };
      outerIframe.addEventListener('load', attachInnerObserver);
      attachInnerObserver(); // spróbuj od razu
    }
    watchOuterIframe();
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function fetchAjaxGet(url) {
    return new Promise((resolve, reject) => {
      const win = getIframeWin();
      if (!win) return reject(new Error('Brak dostepu do iframe'));
      const xhr = new win.XMLHttpRequest();
      xhr.open('GET', url);
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { resolve({ raw: xhr.responseText }); }
      };
      xhr.onerror = () => reject(new Error('Blad sieci'));
      xhr.send();
    });
  }

  function getSelectedProductIds(doc) {
    const win = getIframeWin();
    if (!win || !win.IAI || !win.IAI.Table || !win.IAI.Table.checkedID) return [];
    const checked = win.IAI.Table.checkedID['products'];
    if (!checked) return [];
    return Object.keys(checked).filter(k => checked[k]);
  }

  function getShopId() {
    const win = getIframeWin();
    if (win && win.IAI && win.IAI.Config && win.IAI.Config.shopId) return win.IAI.Config.shopId;
    const doc = getIframeDoc();
    if (doc) {
      const input = doc.querySelector('input[name="shop_id"], input[name="shopId"]');
      if (input) return input.value;
    }
    return '';
  }

  function getPanelOrigin() {
    const win = getIframeWin();
    if (win) return win.location.origin;
    return location.origin;
  }

  async function fetchProductLangData(productId) {
    const resp = await fetchAjaxRaw(AJAX_PARAMS_URL, 'action=getProductData&product=' + encodeURIComponent(productId));
    return resp.data || resp;
  }

  async function fetchLanguagesAndShops(productId) {
    const [langsResp, productResp] = await Promise.all([
      fetchAjaxRaw(AJAX_PARAMS_URL, 'action=getLanguages'),
      fetchAjaxRaw(AJAX_PARAMS_URL, 'action=getProductData&product=' + encodeURIComponent(productId)),
    ]);
    const languages = [];
    if (langsResp.data) {
      langsResp.data.forEach(l => { if (l.code) languages.push(l.code); });
    }
    // Extract shop info from value langData (shops appear as keys in icon_projector)
    const shops = [];
    const origin = getPanelOrigin();
    const shopDomains = {};
    try {
      // Try to get shop list from iframe's IAI.Config
      const win = getIframeWin();
      if (win && win.IAI && win.IAI.Config && win.IAI.Config.shops) {
        for (const [id, info] of Object.entries(win.IAI.Config.shops)) {
          shops.push({ id: String(id), name: info.domain || info.name || '' });
          shopDomains[String(id)] = info.domain || '';
        }
      }
    } catch (_) { /* ignore */ }
    // Fallback: parse from addStocksQuantity toplayer if shops empty
    if (shops.length === 0) {
      const whResp = await fetchAjaxGet(
        '/panel/ajax/product-edit-aceform-toplayers.php?name=addStocksQuantity&idt=' + encodeURIComponent(productId) + '&stock=0'
      );
      const html = whResp.raw || '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const sel = doc.querySelector('select#currentStock');
      if (sel) {
        Array.from(sel.options).forEach(opt => {
          shops.push({ id: opt.value, name: opt.textContent.trim() });
        });
      }
    }
    return { languages, shops, origin, shopDomains };
  }

  async function setParameterDescription(paramOrValueId, lang, description) {
    return fetchAjaxRaw(AJAX_PARAMS_URL,
      'action=setDescription&id=' + encodeURIComponent(paramOrValueId) +
      '&lang=' + encodeURIComponent(lang) +
      '&description=' + encodeURIComponent(description));
  }

  async function uploadParamGfx(paramOrValueId, lang, shopId, gfxType, imageUrl) {
    // Download image from URL
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error('Nie uda\u0142o si\u0119 pobra\u0107 grafiki: ' + imageUrl);
    const blob = await resp.blob();

    // Determine filename from URL
    const urlPath = new URL(imageUrl).pathname;
    let filename = urlPath.split('/').pop() || 'image.jpg';
    // Ensure valid extension
    if (!filename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) {
      const ext = blob.type.includes('png') ? '.png' : blob.type.includes('webp') ? '.webp' : blob.type.includes('gif') ? '.gif' : '.jpg';
      filename += ext;
    }

    // Build multipart form data
    const formData = new FormData();
    formData.append('action', 'saveParamGfx');
    formData.append('lang', lang);
    formData.append('id', String(paramOrValueId));
    formData.append('shop', String(shopId));
    formData.append('type', gfxType); // 'projector' or 'search'
    formData.append('Filedata', blob, filename);

    return new Promise((resolve, reject) => {
      const win = getIframeWin();
      const xhr = new (win || window).XMLHttpRequest();
      xhr.open('POST', AJAX_PARAMS_URL);
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (_) { resolve({ raw: xhr.responseText }); }
      };
      xhr.onerror = () => reject(new Error('B\u0142\u0105d uploadu grafiki'));
      xhr.send(formData);
    });
  }

  async function createNewProduct(productName) {
    const win = getIframeWin();
    const body = new URLSearchParams({
      '__iai_shop_panel[__encoding]': 'utf-8',
      'idt': '0',
      'akcja': 'add',
      'mode': '1',
      'product_type': 'product_configurable',
      'gratis': 'n',
      'vat': '23',
      'sum_in_basket': 'y',
      'productvisible': 'n',
      'priority': '1',
      'sklep[]': getShopId() || '1',
      'languages[pol_0][productname]': productName || 'Nowy konfigurator',
      'languages[pol_0][description]': '',
      'sizes_groups': '-1',
      'unit': '0',
      'sellby_retail': '1.000',
      'sellby_wholesale': '1.000',
      'priceshopsmode': 'normal',
      'serialnumbers': 'na',
      'advance': '0',
      'adding_type': '0',
    }).toString();

    return new Promise((resolve, reject) => {
      const xhr = new (win || window).XMLHttpRequest();
      xhr.open('POST', '/panel/product-edit.php');
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onload = () => {
        // After redirect, final URL contains idt=NEWID
        const m = xhr.responseURL?.match(/idt=(\d+)/);
        if (m) return resolve(m[1]);
        // Fallback: parse from response HTML
        const m2 = xhr.responseText?.match(/idt=(\d+)/);
        if (m2) return resolve(m2[1]);
        reject(new Error('Nie uda\u0142o si\u0119 odczyta\u0107 ID nowego towaru'));
      };
      xhr.onerror = () => reject(new Error('B\u0142\u0105d tworzenia towaru'));
      xhr.send(body);
    });
  }

  function buildLangDataFromApiParam(apiParam, origin) {
    const ld = {};
    for (const [lang, data] of Object.entries(apiParam.data || {})) {
      const entry = { name: data.name || '', description: data.description || '' };
      // Graphics (only on values, not on parameters)
      if (data.icon_projector) {
        const graphics = {};
        for (const [shopId, path] of Object.entries(data.icon_projector)) {
          if (!path) continue;
          const gfx = {
            iconProjector: origin + '/' + path,
            iconSearch: data.icon_search?.[shopId] ? origin + '/' + data.icon_search[shopId] : '',
            iconProjectorType: data.icon_projector_type?.[shopId] || 'img',
          };
          graphics[shopId] = gfx;
        }
        if (Object.keys(graphics).length) entry.graphics = graphics;
      }
      ld[lang] = entry;
    }
    return ld;
  }

  function hasLangDataContent(langData) {
    if (!langData) return false;
    return Object.values(langData).some(ld =>
      (ld.description && ld.description.trim()) || ld.graphics
    );
  }

  // Convert internal modifier format (amount_add/amount_sub/percent_add/percent_sub + unsigned value)
  // to IdoSell API format (amount/percent + signed value)
  function modifierToApi(modifierType, modifierValue) {
    const val = parseFloat(modifierValue) || 0;
    if (!modifierType || modifierType === 'amount_add') return { type: 'amount', value: val };
    if (modifierType === 'amount_sub') return { type: 'amount', value: -Math.abs(val) };
    if (modifierType === 'percent_add') return { type: 'percent', value: val };
    if (modifierType === 'percent_sub') return { type: 'percent', value: -Math.abs(val) };
    return { type: 'amount', value: val };
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  function injectStyles(doc) {
    if (doc.querySelector('#kcfg-styles')) return;
    const style = doc.createElement('style');
    style.id = 'kcfg-styles';
    style.textContent = `
/* Animations */
@keyframes kcfgFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes kcfgSlideUp { from { opacity: 0; transform: translateY(30px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes kcfgFadeOut { from { opacity: 1; } to { opacity: 0; } }
@keyframes kcfgSlideDown { from { opacity: 1; transform: translateY(0) scale(1); } to { opacity: 0; transform: translateY(30px) scale(0.97); } }
@keyframes kcfgSpin { to { transform: rotate(360deg); } }

/* Overlay & Modal */
.kcfg-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Segoe UI', Roboto, Arial, sans-serif;
  animation: kcfgFadeIn 0.2s ease;
}
.kcfg-overlay.kcfg-closing {
  animation: kcfgFadeOut 0.16s ease forwards;
}
.kcfg-overlay.kcfg-closing .kcfg-modal {
  animation: kcfgSlideDown 0.16s ease forwards;
}

.kcfg-modal {
  background: #f8f9fa;
  border-radius: 12px;
  box-shadow: 0 11px 15px -7px rgba(0,0,0,0.2), 0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12);
  max-height: 85vh;
  width: 720px;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: kcfgSlideUp 0.25s ease;
}
.kcfg-modal--wide {
  width: 860px;
}

.kcfg-modal-header {
  background: none;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #000;
  font-size: 18px;
  font-weight: 500;
  flex-shrink: 0;
}
.kcfg-modal-header-close {
  cursor: pointer;
  font-size: 18px;
  opacity: 0.5;
  background: none;
  border: none;
  color: inherit;
  margin-left: auto;
  transition: opacity 0.15s;
  line-height: 1;
}
.kcfg-modal-header-close:hover { opacity: 1; }
.kcfg-count-badge {
  background: #e8eaed;
  color: #5f6368;
  font-size: 13px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 20px;
}

.kcfg-modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: #f8f9fa;
}

.kcfg-modal-footer {
  padding: 14px 24px;
  border-top: 1px solid #e8eaed;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
  background: #fff;
  flex-shrink: 0;
}
.kcfg-modal-footer button {
  padding: 9px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  transition: all 0.15s ease;
  border: none;
}
.kcfg-modal-footer button:active { transform: scale(0.97); }
.kcfg-modal-footer button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.kcfg-btn-primary {
  background: #1a73e8;
  color: white;
}
.kcfg-btn-primary:hover:not(:disabled) { background: #1557b0; }
.kcfg-btn-secondary {
  background: #f1f3f4;
  color: #202124;
  border: 1px solid #dadce0 !important;
}
.kcfg-btn-secondary:hover { background: #e8eaed; }
.kcfg-btn-stop {
  background: #d93025;
  color: #fff;
}
.kcfg-btn-stop:hover { background: #b3261e; }

/* Progress */
.kcfg-progress {
  height: 8px;
  background: #e8eaed;
  border-radius: 4px;
  overflow: hidden;
}
.kcfg-progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
  width: 0%;
  background: #1a73e8;
}
.kcfg-progress-text {
  font-size: 12px;
  color: #5f6368;
}

/* Mode tiles */
.kcfg-tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 8px;
}
.kcfg-tile {
  border: 2px solid #e8eaed;
  border-radius: 10px;
  padding: 24px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
  background: #fff;
}
.kcfg-tile:hover {
  border-color: #1a73e8;
  background: #e8f0fe;
}
.kcfg-tile-icon {
  font-size: 32px;
  margin-bottom: 10px;
}
.kcfg-tile-title {
  font-size: 15px;
  font-weight: 600;
  color: #202124;
  margin-bottom: 6px;
}
.kcfg-tile-desc {
  font-size: 12px;
  color: #5f6368;
  line-height: 1.4;
}

/* Tabs */
.kcfg-tabs {
  display: flex;
  border-bottom: 2px solid #e8eaed;
  margin-bottom: 16px;
}
.kcfg-tab {
  padding: 10px 20px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: #5f6368;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.15s;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: inherit;
}
.kcfg-tab:hover { color: #202124; }
.kcfg-tab.kcfg-tab--active {
  color: #1a73e8;
  border-bottom-color: #1a73e8;
  font-weight: 600;
}

/* Form elements */
.kcfg-search-box {
  position: relative;
  margin-bottom: 16px;
}
.kcfg-search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}
.kcfg-search-input:focus { border-color: #1a73e8; }
.kcfg-search-results {
  position: absolute;
  top: 100%;
  left: 0; right: 0;
  background: #fff;
  border: 1px solid #dadce0;
  border-radius: 0 0 8px 8px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  display: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.kcfg-search-results.kcfg-visible { display: block; }
.kcfg-search-item {
  padding: 10px 14px;
  cursor: pointer;
  font-size: 13px;
  border-bottom: 1px solid #f1f3f4;
  transition: background 0.1s;
}
.kcfg-search-item:hover { background: #e8f0fe; }
.kcfg-search-item:last-child { border-bottom: none; }
.kcfg-search-item-id {
  color: #5f6368;
  font-size: 11px;
}

/* Configurator preview */
.kcfg-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 12px;
}
.kcfg-preview-table th {
  background: #f1f3f4;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: #5f6368;
  border-bottom: 1px solid #dadce0;
}
.kcfg-preview-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #f1f3f4;
  vertical-align: top;
}

/* Parameter blocks */
.kcfg-param-block {
  background: #fff;
  border: 1px solid #e8eaed;
  border-radius: 8px;
  margin-bottom: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
}
.kcfg-param-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: #fafbfc;
  flex-wrap: wrap;
  border-radius: 8px 8px 0 0;
}
.kcfg-values-list {
  padding: 0px 16px 4px;
}
.kcfg-add-value-btn {
  margin: 0 16px 12px;
}
.kcfg-param-name {
  /* styl obsługiwany przez komponent kcfg-ac__input */
}
.kcfg-param-type {
  padding: 8px 10px;
  border: 1px solid #dadce0;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: #fff;
  min-width: 160px;
}
.kcfg-param-required {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #5f6368;
  cursor: pointer;
  white-space: nowrap;
}
.kcfg-param-remove {
  background: none;
  border: none;
  color: #d93025;
  cursor: pointer;
  font-size: 18px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.1s;
  line-height: 1;
}
.kcfg-param-remove:hover { background: #fdecea; }

.kcfg-value-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.kcfg-value-row-wrapper {
  margin-left: 30px;
}
.kcfg-value-name {
  /* styl obsługiwany przez komponent kcfg-ac__input */
}
.kcfg-modifier-type {
  padding: 6px 8px;
  border: 1px solid #dadce0;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: #fff;
  width: 80px;
}
.kcfg-modifier-value {
  width: 80px;
  padding: 6px 10px;
  border: 1px solid #dadce0;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  text-align: right;
}
.kcfg-modifier-value:focus { border-color: #1a73e8; }
.kcfg-value-remove {
  background: none;
  border: none;
  color: #d93025;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
  transition: background 0.1s;
}
.kcfg-value-remove:hover { background: #fdecea; }

.kcfg-add-value-btn, .kcfg-add-param-btn {
  background: none;
  border: 1px dashed #dadce0;
  color: #5f6368;
  cursor: pointer;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-family: inherit;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.kcfg-add-value-btn:hover, .kcfg-add-param-btn:hover {
  border-color: #1a73e8;
  color: #1a73e8;
  background: #e8f0fe;
}
.kcfg-add-param-btn {
  width: 100%;
  justify-content: center;
  padding: 12px;
  font-size: 13px;
}

/* Checkbox options */
.kcfg-options {
  margin-top: 12px;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e8eaed;
}
.kcfg-option-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #3c4043;
  margin-bottom: 6px;
}
.kcfg-option-row:last-child { margin-bottom: 0; }

/* CSV area */
.kcfg-csv-area {
  width: 100%;
  min-height: 160px;
  padding: 12px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
.kcfg-csv-area:focus { border-color: #1a73e8; }
.kcfg-csv-hint {
  font-size: 11px;
  color: #999;
  margin-top: 6px;
  line-height: 1.5;
}

/* Selected source */
.kcfg-source-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #e8f5e9;
  border-radius: 8px;
  font-size: 13px;
  color: #2e7d32;
  margin-bottom: 12px;
}
.kcfg-source-info-clear {
  margin-left: auto;
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 16px;
}

/* Spinner */
.kcfg-spinner {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 2px solid #e8eaed;
  border-top-color: #1a73e8;
  border-radius: 50%;
  animation: kcfgSpin 0.6s linear infinite;
  vertical-align: middle;
}

/* Info box */
.kcfg-info {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.kcfg-info--warning {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffc107;
}
.kcfg-info--success {
  background: #d4edda;
  color: #155724;
}
.kcfg-info--error {
  background: #fdecea;
  color: #d93025;
}

/* Autocomplete dropdown */
/* Autocomplete component */
.kcfg-ac { position: relative; flex: 1; min-width: 120px; }
.kcfg-ac__field { position: relative; display: flex; align-items: center; }
.kcfg-ac__field:focus-within .kcfg-ac__icon-wrap svg { color: #1a73e8; }
.kcfg-ac__input { width: 100%; padding: 8px 32px 8px 32px; border: 1px solid #dadce0; border-radius: 6px; font-size: 13px; font-family: inherit; color: #202124; outline: none; background: #fff; transition: border-color .15s, box-shadow .15s; }
.kcfg-ac__input::placeholder { color: #9aa0a6; }
.kcfg-ac__input:focus { border-color: #1a73e8; box-shadow: 0 0 0 3px rgba(26,115,232,.12); }
.kcfg-ac__spinner { position: absolute; right: 32px; width: 14px; height: 14px; border: 2px solid #dadce0; border-top-color: #1a73e8; border-radius: 50%; animation: kcfgSpin .6s linear infinite; display: none; }
.kcfg-ac--loading .kcfg-ac__spinner { display: block; }
.kcfg-ac__clear { position: absolute; right: 8px; width: 20px; height: 20px; border: none; background: #e8eaed; border-radius: 50%; cursor: pointer; display: none; align-items: center; justify-content: center; color: #5f6368; transition: background .15s; }
.kcfg-ac__clear:hover { background: #dadce0; color: #202124; }
.kcfg-ac--has-value .kcfg-ac__clear { display: flex; }
.kcfg-ac--loading .kcfg-ac__clear { display: none; }
.kcfg-ac__dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #fff; border: 1px solid #dadce0; border-radius: 8px; overflow: hidden; z-index: 9999; display: none; box-shadow: 0 8px 24px rgba(0,0,0,0.15); animation: kcfgDropIn .12s ease-out; }
@keyframes kcfgDropIn { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
.kcfg-ac--open .kcfg-ac__dropdown { display: block; }
.kcfg-ac__list { list-style: none; max-height: 240px; overflow-y: auto; margin: 0; padding: 0; }
.kcfg-ac__item { padding: 9px 14px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f1f3f4; transition: background .1s; }
.kcfg-ac__item:last-child { border-bottom: none; }
.kcfg-ac__item:hover, .kcfg-ac__item--active { background: #e8f0fe; }
.kcfg-ac__item mark { background: none; color: #1a73e8; font-weight: 600; }
.kcfg-ac__empty { padding: 16px 14px; font-size: 13px; color: #9aa0a6; text-align: center; }
.kcfg-ac__footer { padding: 6px 14px; font-size: 11px; color: #9aa0a6; border-top: 1px solid #f1f3f4; display: flex; align-items: center; justify-content: space-between; }
.kcfg-ac__footer kbd { font-family: inherit; font-size: 10px; padding: 1px 4px; background: #f1f3f4; border: 1px solid #dadce0; border-radius: 3px; color: #5f6368; }

/* Import upload area */
.kcfg-import-upload {
  border: 2px dashed #dadce0;
  border-radius: 10px;
  padding: 40px 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
  background: #fff;
}
.kcfg-import-upload:hover { border-color: #1a73e8 !important; background: #e8f0fe !important; }
.kcfg-import-upload.kcfg-dragover { border-color: #1a73e8; background: #e8f0fe; }

/* Drag handle */
.kcfg-drag-handle { cursor: grab; color: #bdc1c6; display: flex; align-items: center; padding: 0 4px; flex-shrink: 0; transition: color .15s; }
.kcfg-drag-handle:hover { color: #5f6368; }
.kcfg-drag-handle:active { cursor: grabbing; }
.kcfg-drag-handle svg { width: 16px; height: 16px; }
.kcfg-sortable-dragging { opacity: 0.4; pointer-events: none; }
.kcfg-drop-indicator { position: fixed; height: 3px; background: #1a73e8; border-radius: 2px; pointer-events: none; z-index: 99999; }
.kcfg-drop-indicator::before { content: ''; position: absolute; left: -5px; top: -4px; width: 11px; height: 11px; background: #1a73e8; border-radius: 50%; }

/* Toggle switch */
.kcfg-switch { position: relative; display: inline-flex; align-items: center; width: 36px; height: 20px; flex-shrink: 0; }
.kcfg-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.kcfg-switch-track { width: 36px; height: 20px; background: #dadce0; border-radius: 10px; transition: background .2s; cursor: pointer; position: relative; }
.kcfg-switch-thumb { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: transform .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.kcfg-switch input:checked + .kcfg-switch-track { background: #1a73e8; }
.kcfg-switch input:checked + .kcfg-switch-track .kcfg-switch-thumb { transform: translateX(16px); }

/* Override panelowego resetu border-radius na inputach */
.kcfg-overlay input[type="text"].kcfg-param-name,
.kcfg-overlay input[type="text"].kcfg-value-name,
.kcfg-overlay input[type="text"].kcfg-modifier-value {
  border-radius: 6px !important;
  height: 38px !important;
  border: 1px solid #dadce0 !important;
  outline: none !important;
  background: #fff !important;
  box-sizing: border-box !important;
  font-size: 13px !important;
}
.kcfg-overlay select.kcfg-param-type,
.kcfg-overlay select.kcfg-modifier-type {
  border-radius: 6px !important;
  height: 38px !important;
  border: 1px solid #dadce0 !important;
  outline: none !important;
  background: #fff !important;
  font-size: 13px !important;
}
`;
    doc.head.appendChild(style);
  }

  // =========================================================================
  // PANELPRO BAR + BUTTON INJECTION
  // =========================================================================

  function getOrCreatePanelProBar(doc) {
    const existing = doc.querySelector('#panelpro-bar');
    if (existing) return existing.querySelector('.pp-group') || existing;

    // Wymagamy obecności #bottom_menu_products jako wskaźnika że jesteśmy na liście towarów
    if (!doc.querySelector('#bottom_menu_products')) return null;

    // Material Symbols font
    if (!doc.querySelector('#pp-material-font')) {
      const link = doc.createElement('link');
      link.id = 'pp-material-font';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
      doc.head.appendChild(link);
    }

    // Inject CSS raz
    if (!doc.querySelector('#panelpro-bar-css')) {
      const style = doc.createElement('style');
      style.id = 'panelpro-bar-css';
      style.textContent = `
        #panelpro-bar {
          position:fixed;top:50%;right:0;
          transform:translate(calc(100% - 32px), -50%);
          display:flex;align-items:stretch;
          z-index:9998;
          transition:transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #panelpro-bar.pp-open { transform:translate(0, -50%); }

        #panelpro-bar .pp-handle {
          width:32px;flex-shrink:0;
          background:linear-gradient(135deg,#1a73e8,#0d47a1);
          color:#fff;cursor:pointer;user-select:none;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:10px;
          padding:14px 0;
          border-radius:8px 0 0 8px;
          box-shadow:-2px 0 10px rgba(0,0,0,0.18);
          transition:background 0.15s, box-shadow 0.15s;
        }
        #panelpro-bar .pp-handle:hover {
          background:linear-gradient(135deg,#2080ec,#1656b3);
          box-shadow:-3px 0 14px rgba(26,115,232,0.35);
        }
        #panelpro-bar .pp-handle .pp-handle-arrow {
          font-size:16px;line-height:1;
          transition:transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #panelpro-bar.pp-open .pp-handle .pp-handle-arrow { transform:rotate(180deg); }
        #panelpro-bar .pp-handle .pp-handle-label {
          writing-mode:vertical-rl;
          text-orientation:mixed;
          font-size:11px;font-weight:700;
          letter-spacing:1.5px;text-transform:uppercase;
          white-space:nowrap;
        }
        #panelpro-bar .pp-handle .pp-handle-icon {
          width:14px;height:14px;fill:none;stroke:#fff;stroke-width:2.2;
          stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;
        }

        #panelpro-bar .pp-group {
          display:flex;flex-direction:column;gap:8px;
          background:#fff;
          padding:14px 16px;
          border:1px solid #e2e8f0;border-right:none;
          border-radius:8px 0 0 8px;
          box-shadow:-4px 0 16px rgba(0,0,0,0.10);
          min-width:220px;
        }
        #panelpro-bar .pp-group-title {
          font-size:11px;font-weight:700;color:#64748b;
          letter-spacing:0.6px;text-transform:uppercase;
          padding-bottom:8px;margin-bottom:2px;
          border-bottom:1px solid #f1f5f9;
        }
        #panelpro-bar .pp-btn {
          display:inline-flex;align-items:center;gap:8px;
          padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;
          background:#fff;color:#334155;font-size:13px;font-weight:600;
          cursor:pointer;text-decoration:none;white-space:nowrap;
          transition:background 0.15s,border-color 0.15s,box-shadow 0.15s,transform 0.1s;
          font-family:inherit;line-height:1.4;
          width:100%;justify-content:flex-start;
        }
        #panelpro-bar .pp-btn:hover {
          background:#f8fafc;border-color:#cbd5e1;
          box-shadow:0 1px 3px rgba(0,0,0,0.06);
        }
        #panelpro-bar .pp-btn:active:not(:disabled) { transform:scale(0.98); }
        #panelpro-bar .pp-btn:disabled {
          opacity:0.5;cursor:not-allowed;
        }
        #panelpro-bar .pp-btn .material-symbols-outlined {
          font-size:18px;color:#1a73e8;flex-shrink:0;
        }
        #panelpro-bar .pp-btn--primary {
          background:#2563eb;color:#fff;border-color:#2563eb;
        }
        #panelpro-bar .pp-btn--primary:hover {
          background:#1d4ed8;border-color:#1d4ed8;color:#fff;
        }
        #panelpro-bar .pp-btn--primary .material-symbols-outlined { color:#fff; }
      `;
      doc.head.appendChild(style);
    }

    const bar = doc.createElement('div');
    bar.id = 'panelpro-bar';

    // Uchwyt — pionowa belka po lewej stronie panelu, zawsze widoczna
    const handle = doc.createElement('div');
    handle.className = 'pp-handle';
    handle.title = 'Pokaż / ukryj Panel PRO';
    handle.innerHTML =
      '<span class="pp-handle-arrow">◀</span>' +
      '<svg class="pp-handle-icon" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' +
      '<span class="pp-handle-label">Panel PRO</span>';

    const group = doc.createElement('div');
    group.className = 'pp-group';

    const title = doc.createElement('div');
    title.className = 'pp-group-title';
    title.textContent = 'Konfigurator cen';
    group.appendChild(title);

    bar.appendChild(handle);
    bar.appendChild(group);
    doc.body.appendChild(bar);

    // Toggle on handle click
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      bar.classList.toggle('pp-open');
    });

    // Click outside → close
    doc.addEventListener('click', (e) => {
      if (!bar.classList.contains('pp-open')) return;
      if (bar.contains(e.target)) return;
      bar.classList.remove('pp-open');
    });

    // Esc → close
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && bar.classList.contains('pp-open')) {
        bar.classList.remove('pp-open');
      }
    });

    return group;
  }

  // Hook IAI.Table.actualizeLabelAndButtons to update button disabled state.
  // Retries if IAI.Table is not ready yet.
  let _hookedButtons = [];
  let _hookAttached = false;

  function hookActualizeButtons(doc, btn) {
    // If first button for this doc cycle, reset state (iframe reloaded)
    if (_hookedButtons.length > 0 && _hookedButtons[0].doc !== doc) {
      _hookedButtons = [];
      _hookAttached = false;
    }
    _hookedButtons.push({ doc, btn });
    if (_hookAttached) return;

    function updateAllButtons() {
      _hookedButtons.forEach(({ doc: d, btn: b }) => {
        try {
          const ids = getSelectedProductIds(d);
          b.disabled = ids.length === 0;
        } catch (_) { /* ignore */ }
      });
    }

    function tryHook() {
      const win = getIframeWin();
      if (!win || !win.IAI || !win.IAI.Table || !win.IAI.Table.actualizeLabelAndButtons) return false;
      if (_hookAttached) return true;
      const orig = win.IAI.Table.actualizeLabelAndButtons;
      win.IAI.Table.actualizeLabelAndButtons = function () {
        orig.apply(this, arguments);
        updateAllButtons();
      };
      _hookAttached = true;
      updateAllButtons();
      return true;
    }

    if (!tryHook()) {
      // Retry until IAI.Table is ready (up to 30s)
      let attempts = 0;
      const iv = setInterval(() => {
        attempts++;
        if (tryHook() || attempts > 60) clearInterval(iv);
      }, 500);
    }
  }

  function injectConfiguratorButton(doc) {
    if (doc.querySelector('#configuratorAction')) return;

    const bar = getOrCreatePanelProBar(doc);
    if (!bar) return;

    injectStyles(doc);

    const btn = doc.createElement('button');
    btn.id = 'configuratorAction';
    btn.className = 'pp-btn';
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">tune</span> Ustaw konfigurator';
    bar.appendChild(btn);
    btn.addEventListener('click', () => {
      const ids = getSelectedProductIds(doc);
      if (ids.length === 0) return;
      showConfiguratorModal(doc, ids);
    });

    // Hook into IAI.Table.actualizeLabelAndButtons so the button auto-enables/disables
    hookActualizeButtons(doc, btn);
  }

  function injectExportButton(doc) {
    if (doc.querySelector('#configuratorExportAction')) return;

    const bar = getOrCreatePanelProBar(doc);
    if (!bar) return;

    const btn = doc.createElement('button');
    btn.id = 'configuratorExportAction';
    btn.className = 'pp-btn';
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">download</span> Eksport konfiguratora';
    bar.appendChild(btn);
    btn.addEventListener('click', () => {
      const ids = getSelectedProductIds(doc);
      if (ids.length === 0) return;
      showExportModal(doc, ids);
    });

    hookActualizeButtons(doc, btn);
  }

  function injectImportButton(doc) {
    if (doc.querySelector('#configuratorImportAction')) return;

    const bar = getOrCreatePanelProBar(doc);
    if (!bar) return;

    const btn = doc.createElement('button');
    btn.id = 'configuratorImportAction';
    btn.className = 'pp-btn';
    btn.innerHTML = '<span class="material-symbols-outlined">upload</span> Importuj konfigurator';
    btn.title = 'Wczytaj plik z towarami i ich parametrami — nie wymaga zaznaczenia';
    bar.appendChild(btn);
    btn.addEventListener('click', () => {
      showImportFileModal(doc);
    });
  }

  // =========================================================================
  // MODAL HELPERS
  // =========================================================================

  let currentOverlay = null;

  function closeModal(doc) {
    if (!currentOverlay) return;
    const overlay = currentOverlay;
    overlay.classList.add('kcfg-closing');
    setTimeout(() => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (currentOverlay === overlay) currentOverlay = null;
    }, 170);
  }

  function createModal(doc, title, count) {
    if (currentOverlay) closeModal(doc);

    const overlay = doc.createElement('div');
    overlay.className = 'kcfg-overlay';

    const modal = doc.createElement('div');
    modal.className = 'kcfg-modal';

    const header = doc.createElement('div');
    header.className = 'kcfg-modal-header';
    header.innerHTML =
      '<span>' + escapeHtml(title) + '</span>' +
      (count != null ? '<span class="kcfg-count-badge">' + count + ' towar' + (count === 1 ? '' : count < 5 ? 'y' : '\u00f3w') + '</span>' : '') +
      '<button class="kcfg-modal-header-close" title="Zamknij">\u2715</button>';

    const body = doc.createElement('div');
    body.className = 'kcfg-modal-body';

    const footer = doc.createElement('div');
    footer.className = 'kcfg-modal-footer';

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    header.querySelector('.kcfg-modal-header-close').addEventListener('click', () => closeModal(doc));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(doc);
    });

    doc.body.appendChild(overlay);
    currentOverlay = overlay;

    return { overlay, modal, header, body, footer };
  }

  // =========================================================================
  // MAIN MODAL — mode selection
  // =========================================================================

  function showConfiguratorModal(doc, selectedProductIds) {
    const { body, footer } = createModal(doc, 'Konfigurator cen', selectedProductIds.length);

    body.innerHTML =
      '<div class="kcfg-tiles" style="grid-template-columns: 1fr 1fr;">' +
        '<div class="kcfg-tile" data-mode="fromparams">' +
          '<div class="kcfg-tile-icon">\ud83c\udff7\ufe0f</div>' +
          '<div class="kcfg-tile-title">Z parametr\u00f3w towaru</div>' +
          '<div class="kcfg-tile-desc">Zbuduj konfigurator z parametr\u00f3w ju\u017c przypisanych do zaznaczonych towar\u00f3w (z automatyczn\u0105 zmian\u0105 typu)</div>' +
        '</div>' +
        '<div class="kcfg-tile" data-mode="copy">' +
          '<div class="kcfg-tile-icon">\ud83d\udccb</div>' +
          '<div class="kcfg-tile-title">Skopiuj z innego towaru</div>' +
          '<div class="kcfg-tile-desc">Wyszukaj towar \u017ar\u00f3d\u0142owy i skopiuj jego konfigurator na zaznaczone towary</div>' +
        '</div>' +
        '<div class="kcfg-tile" data-mode="create">' +
          '<div class="kcfg-tile-icon">\u2728</div>' +
          '<div class="kcfg-tile-title">Stw\u00f3rz nowy konfigurator</div>' +
          '<div class="kcfg-tile-desc">Zbuduj konfigurator od zera w kreatorze lub zaimportuj z CSV</div>' +
        '</div>' +
        '<div class="kcfg-tile" data-mode="import">' +
          '<div class="kcfg-tile-icon">\ud83d\udcc2</div>' +
          '<div class="kcfg-tile-title">Importuj z pliku</div>' +
          '<div class="kcfg-tile-desc">Wczytaj konfigurator z pliku JSON, XML lub CSV</div>' +
        '</div>' +
      '</div>';

    footer.innerHTML =
      '<button class="kcfg-btn-secondary" id="kcfg-cancel">Anuluj</button>';
    footer.querySelector('#kcfg-cancel').addEventListener('click', () => closeModal(doc));

    body.querySelector('[data-mode="fromparams"]').addEventListener('click', () => {
      showFromProductParamsMode(doc, selectedProductIds);
    });
    body.querySelector('[data-mode="copy"]').addEventListener('click', () => {
      showCopyMode(doc, selectedProductIds);
    });
    body.querySelector('[data-mode="create"]').addEventListener('click', () => {
      showCreateMode(doc, selectedProductIds);
    });
    body.querySelector('[data-mode="import"]').addEventListener('click', () => {
      showImportMode(doc, selectedProductIds);
    });
  }

  // =========================================================================
  // COPY MODE
  // =========================================================================

  function showCopyMode(doc, selectedProductIds) {
    const { modal, body, footer } = createModal(doc, 'Skopiuj z innego towaru', selectedProductIds.length);
    modal.classList.add('kcfg-modal--wide');

    body.innerHTML =
      '<div class="kcfg-search-box">' +
        '<input class="kcfg-search-input" placeholder="Wyszukaj towar \u017ar\u00f3d\u0142owy (ID, nazwa, kod, symbol)..." autocomplete="off">' +
        '<div class="kcfg-search-results"></div>' +
      '</div>' +
      '<div id="kcfg-source-display"></div>' +
      '<div id="kcfg-preview-area" style="text-align:center;padding:40px 0;color:#9aa0a6;font-size:14px;">Wyszukaj towar aby za\u0142adowa\u0107 jego konfigurator do kreatora</div>';

    const searchInput = body.querySelector('.kcfg-search-input');
    const searchResults = body.querySelector('.kcfg-search-results');
    const sourceDisplay = body.querySelector('#kcfg-source-display');
    const previewArea = body.querySelector('#kcfg-preview-area');

    let searchTimer = null;

    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) { searchResults.classList.remove('kcfg-visible'); return; }
      searchTimer = setTimeout(() => searchProducts(doc, q, searchResults, (product) => {
        searchInput.style.display = 'none';
        searchResults.classList.remove('kcfg-visible');
        sourceDisplay.innerHTML =
          '<div class="kcfg-source-info">' +
            '<strong>Towar \u017ar\u00f3d\u0142owy:</strong> ' + escapeHtml(product.name) + ' (ID: ' + escapeHtml(product.id) + ')' +
          '</div>';
        previewArea.innerHTML = '<div style="padding:16px;text-align:center;"><span class="kcfg-spinner"></span> Pobieram konfigurator...</div>';

        fetchConfiguratorData(product.id).then(configData => {
          if (!configData || configData.parameters.length === 0) {
            previewArea.innerHTML = '<div class="kcfg-info kcfg-info--warning">Ten towar nie ma konfiguratora cen.</div>';
            return;
          }
          // Otwórz kreator z danymi
          showCreateMode(doc, selectedProductIds, configData);
        }).catch(err => {
          previewArea.innerHTML = '<div class="kcfg-info kcfg-info--error">B\u0142\u0105d: ' + escapeHtml(err.message) + '</div>';
        });
      }), 350);
    });

    body.addEventListener('click', (e) => {
      if (!e.target.closest('.kcfg-search-box')) searchResults.classList.remove('kcfg-visible');
    });

    footer.innerHTML = '<button class="kcfg-btn-secondary" id="kcfg-back">Wstecz</button>';
    footer.querySelector('#kcfg-back').addEventListener('click', () => showConfiguratorModal(doc, selectedProductIds));
  }

  // Search products via AJAX
  function searchProducts(doc, query, resultsEl, onSelect) {
    resultsEl.innerHTML = '<div style="padding:12px;color:#999;font-size:12px;"><span class="kcfg-spinner"></span> Szukam...</div>';
    resultsEl.classList.add('kcfg-visible');

    const formData = 'action=getProducts&search=' + encodeURIComponent(query) + '&limit=10';
    fetchAjaxRaw(AJAX_PRODUCTS_LIST_URL, formData).then(resp => {
      // Try to parse product list from response
      let products = [];
      if (resp && resp.products) {
        products = resp.products;
      } else if (resp && resp.raw) {
        // Parse HTML response for product rows
        products = parseProductSearchHtml(resp.raw, query);
      }

      // Fallback: if API doesn't return structured data, allow direct ID entry
      if (products.length === 0 && /^\d+$/.test(query.trim())) {
        products = [{ id: query.trim(), name: 'Towar #' + query.trim() }];
      }

      if (products.length === 0) {
        resultsEl.innerHTML = '<div style="padding:12px;color:#999;font-size:12px;">Nie znaleziono towar\u00f3w</div>';
        return;
      }

      resultsEl.innerHTML = '';
      products.forEach(p => {
        const item = doc.createElement('div');
        item.className = 'kcfg-search-item';
        item.innerHTML = escapeHtml(p.name || 'Towar') + ' <span class="kcfg-search-item-id">ID: ' + escapeHtml(String(p.id)) + '</span>';
        item.addEventListener('click', () => {
          resultsEl.classList.remove('kcfg-visible');
          onSelect(p);
        });
        resultsEl.appendChild(item);
      });
    }).catch(() => {
      // Fallback: allow direct ID input
      if (/^\d+$/.test(query.trim())) {
        resultsEl.innerHTML = '';
        const item = doc.createElement('div');
        item.className = 'kcfg-search-item';
        item.innerHTML = 'U\u017cyj ID: <strong>' + escapeHtml(query.trim()) + '</strong>';
        item.addEventListener('click', () => {
          resultsEl.classList.remove('kcfg-visible');
          onSelect({ id: query.trim(), name: 'Towar #' + query.trim() });
        });
        resultsEl.appendChild(item);
      } else {
        resultsEl.innerHTML = '<div style="padding:12px;color:#d93025;font-size:12px;">B\u0142\u0105d wyszukiwania. Wpisz ID towaru.</div>';
      }
    });
  }

  function parseProductSearchHtml(html, query) {
    const products = [];
    try {
      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(html, 'text/html');
      // Try common patterns for product rows in IdoSell
      const rows = htmlDoc.querySelectorAll('tr[data-id], tr[id*="product"], .product-row');
      rows.forEach(row => {
        const id = row.getAttribute('data-id') || row.querySelector('td')?.textContent?.trim();
        const nameEl = row.querySelector('.product-name, td:nth-child(2), td:nth-child(3)');
        if (id) {
          products.push({ id, name: nameEl ? nameEl.textContent.trim() : 'Towar #' + id });
        }
      });
    } catch (e) { /* ignore */ }
    return products;
  }

  // Fetch configurator data (structure + prices + tree) for a product
  function fetchConfiguratorData(productId, shopId, includeLangData) {
    if (!shopId) shopId = getShopId();
    const listUrl = AJAX_DYNAMIC_CONTENT_URL + '?name=configuratorParametersList&idt=' + encodeURIComponent(productId) + '&shopId=' + encodeURIComponent(shopId);
    const contentUrl = AJAX_DYNAMIC_CONTENT_URL + '?name=configuratorContent&idt=' + encodeURIComponent(productId) + '&shopId=' + encodeURIComponent(shopId);
    const treeUrl = AJAX_DYNAMIC_CONTENT_URL + '?name=configuratorDependenciesList&idt=' + encodeURIComponent(productId) + '&shopId=' + encodeURIComponent(shopId);

    const fetches = [fetchAjaxGet(listUrl), fetchAjaxGet(contentUrl), fetchAjaxGet(treeUrl)];
    if (includeLangData) fetches.push(fetchProductLangData(productId));

    return Promise.all(fetches).then(([listResp, contentResp, treeResp, productLangData]) => {
      const listHtml = listResp.raw || '';
      if (!listHtml || listHtml.trim().length < 10) return null;

      const configData = parseConfiguratorHtml(listHtml);
      if (!configData || configData.parameters.length === 0) return null;

      const contentHtml = contentResp.raw || '';
      if (contentHtml) {
        enrichFromConfiguratorContent(configData, contentHtml);
      }

      // Filtruj: zostaw tylko parametry u\u017cyte w drzewie konfiguratora
      const treeHtml = treeResp.raw || '';
      if (treeHtml) {
        const treeParamIds = new Set([...treeHtml.matchAll(/config_parameter_(\d+)/g)].map(m => m[1]));
        // Dodaj te\u017c zagnie\u017cd\u017cone (children)
        configData.parameters.forEach(p => {
          if (p.id && treeParamIds.has(p.id)) {
            p.values.forEach(v => {
              (v.children || []).forEach(childIdx => {
                const child = configData.parameters[childIdx];
                if (child && child.id) treeParamIds.add(child.id);
              });
            });
          }
        });

        if (treeParamIds.size > 0) {
          const oldToNew = {};
          const filtered = [];
          const unused = [];
          configData.parameters.forEach((p, oldIdx) => {
            if (p.id && treeParamIds.has(p.id)) {
              oldToNew[oldIdx] = filtered.length;
              filtered.push(p);
            } else {
              unused.push(p);
            }
          });
          filtered.forEach(param => {
            param.values.forEach(val => {
              if (val.children) {
                val.children = val.children.map(oldIdx => oldToNew[oldIdx]).filter(idx => idx !== undefined);
              }
            });
          });
          configData.parameters = filtered;
          configData.unusedParameters = unused;
        }
      }

      // Enrich with langData (descriptions, graphics) from getProductData
      if (includeLangData && productLangData && Array.isArray(productLangData)) {
        const origin = getPanelOrigin();
        const apiParamById = {};
        productLangData.forEach(ap => {
          apiParamById[String(ap.id)] = ap;
          (ap.children || []).forEach(child => { apiParamById[String(child.id)] = child; });
        });
        configData.parameters.forEach(param => {
          const ap = apiParamById[param.id];
          if (ap) {
            param.langData = buildLangDataFromApiParam(ap, origin);
          }
          param.values.forEach(val => {
            const av = apiParamById[val.id];
            if (av) {
              val.langData = buildLangDataFromApiParam(av, origin);
            }
          });
        });
      }

      return configData;
    });
  }

  function enrichFromConfiguratorContent(configData, contentHtml) {
    // Extract JS data from inline scripts in configuratorContent HTML
    const parameterPrices = extractJsObject(contentHtml, 'parameterPrices');
    const parametersDataSelected = extractJsObject(contentHtml, 'parametersDataSelected');
    // priceConfiguratorData nie jest dost\u0119pne w AJAX — filtrowanie przeniesione do fetchConfiguratorData

    // Build ID maps
    const idToIdx = {};
    configData.parameters.forEach((p, idx) => { if (p.id) idToIdx[p.id] = idx; });

    // Apply price modifiers from parameterPrices
    // Format: { "paramId": { "valueId": amount, ... }, "inputParamId": [], ... }
    // amount is signed: positive = add, negative = sub; type is always "amount"
    if (parameterPrices) {
      for (const param of configData.parameters) {
        if (!param.id) continue;
        const priceMap = parameterPrices[param.id];
        if (!priceMap || Array.isArray(priceMap)) continue; // skip input params (empty arrays)
        for (const val of param.values) {
          if (!val.id || priceMap[val.id] === undefined) continue;
          const amount = Number(priceMap[val.id]);
          if (amount < 0) {
            val.modifierType = 'amount_sub';
            val.modifierValue = String(Math.abs(amount));
          } else {
            val.modifierType = 'amount_add';
            val.modifierValue = String(amount);
          }
        }
      }
    }

    // Apply tree/nesting from parametersDataSelected
    // Format: { "valueId": { "childParamId": true|{valueId:bool,...}, ... }, ... }
    if (parametersDataSelected) {
      for (const param of configData.parameters) {
        if (!param.id) continue;
        for (const val of param.values) {
          if (!val.id || !parametersDataSelected[val.id]) continue;
          const childMap = parametersDataSelected[val.id];
          if (typeof childMap !== 'object') continue;
          val.children = [];
          for (const childParamId in childMap) {
            const v = childMap[childParamId];
            if (v !== undefined && v !== false && idToIdx[childParamId] !== undefined) {
              val.children.push(idToIdx[childParamId]);
            }
          }
        }
      }
    }

  }

  function extractJsObject(html, varName) {
    // Match: IAI.PriceFormulaConfigurator.varName = {...};
    const re = new RegExp('IAI\\.PriceFormulaConfigurator\\.' + varName + '\\s*=\\s*(\\{[^;]*\\})\\s*;');
    const m = html.match(re);
    if (m) {
      try { return JSON.parse(m[1]); } catch (e) { /* ignore */ }
    }
    return null;
  }

  // Parse configurator HTML from dynamic content endpoint
  // Real HTML structure:
  //   <li id="config_parameter_{paramId}">
  //     <div class="block block-title">
  //       <div class="firstLevel parameterTitle">Nazwa parametru</div>
  //       <div class="firstLevel parameterValues">Wartość A, Wartość B...</div>
  //       <img class="parameterTypeIcon" src="/panel/gfx/aceform_icons/type-select.svg">
  //       <a class="editConfiguratorParam" onclick="...action=edit&parameterId=10792...">
  //     </div>
  //   </li>
  // Values with IDs are in onclick handlers:
  //   IAI.PriceFormulaConfigurator.checkBoxParameterClick('Value Name','valueId','config_parameter_paramId')
  function parseConfiguratorHtml(html) {
    const params = [];
    try {
      const parser = new DOMParser();
      const htmlDoc = parser.parseFromString(html, 'text/html');

      // Parameter blocks: <li id="config_parameter_{id}">
      const paramBlocks = htmlDoc.querySelectorAll('li[id^="config_parameter_"]');

      paramBlocks.forEach(block => {
        const liId = block.getAttribute('id') || '';
        const paramId = liId.replace('config_parameter_', '');

        // Parameter name: .parameterTitle or .parameterTitleNoValues
        const nameEl = block.querySelector('.parameterTitle, .parameterTitleNoValues');
        const name = nameEl ? nameEl.textContent.trim() : '';

        // Parameter type from icon: type-select.svg, type-input.svg, type-radio.svg, type-checkbox.svg
        let type = 'select';
        const typeIcon = block.querySelector('img.parameterTypeIcon');
        if (typeIcon) {
          const src = typeIcon.getAttribute('src') || '';
          const typeMatch = src.match(/type-(\w+)\.svg/);
          if (typeMatch) type = typeMatch[1];
        }

        // Values: extracted from checkBoxParameterClick onclick handlers
        // Pattern: checkBoxParameterClick('Value Name','valueId','config_parameter_paramId')
        const values = [];
        const onclickEls = block.querySelectorAll('[onclick*="checkBoxParameterClick"]');
        onclickEls.forEach(el => {
          const onclick = el.getAttribute('onclick') || '';
          const match = onclick.match(/checkBoxParameterClick\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/);
          if (match) {
            values.push({
              id: match[2],
              name: match[1],
              modifierType: 'amount_add',
              modifierValue: '0',
            });
          }
        });

        // Also try to get values from checkbox labels inside dropdown
        if (values.length === 0) {
          block.querySelectorAll('.dropdown-menu .checkbox .lbl, .dropdown-menu label .lbl').forEach(lbl => {
            const vname = lbl.textContent.trim();
            if (vname) {
              // Try to extract value ID from the sibling input's onclick
              const input = lbl.closest('label')?.querySelector('input[onclick*="checkBoxParameterClick"]');
              let vid = '';
              if (input) {
                const onc = input.getAttribute('onclick') || '';
                const m = onc.match(/checkBoxParameterClick\(\s*'[^']*'\s*,\s*'([^']*)'/);
                if (m) vid = m[1];
              }
              values.push({ id: vid, name: vname, modifierType: 'amount_add', modifierValue: '0' });
            }
          });
        }

        if (name) {
          params.push({ id: paramId, name, type, required: true, values });
        }
      });
    } catch (e) { /* parsing error */ }

    return { parameters: params };
  }

  function buildPreviewTableHtml(configData) {
    let html = '<table class="kcfg-preview-table">' +
      '<thead><tr><th>Parametr</th><th>Typ</th><th>Warto\u015bci</th><th>Modyfikatory</th></tr></thead><tbody>';

    configData.parameters.forEach(p => {
      const typeLabel = PARAM_TYPES.find(t => t.value === p.type)?.label || p.type;
      const valuesHtml = p.values.map(v => escapeHtml(v.name || '(brak)')).join('<br>');
      const modifiersHtml = p.values.map(v => {
        const mt = MODIFIER_TYPES.find(m => m.value === v.modifierType);
        const sym = mt ? mt.symbol : '+';
        return sym + ' ' + escapeHtml(String(v.modifierValue));
      }).join('<br>');

      html += '<tr>' +
        '<td><strong>' + escapeHtml(p.name) + '</strong>' + (p.required ? ' <span style="color:#1a73e8;font-size:11px;">(wymagany)</span>' : '') + '</td>' +
        '<td>' + escapeHtml(typeLabel) + '</td>' +
        '<td>' + (valuesHtml || '<em style="color:#999;">brak</em>') + '</td>' +
        '<td>' + (modifiersHtml || '\u2014') + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  // =========================================================================
  // DRAG & DROP SORTABLE
  // =========================================================================

  function createDragHandle(doc) {
    const handle = doc.createElement('div');
    handle.className = 'kcfg-drag-handle';
    handle.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg>';
    handle.title = 'Przeci\u0105gnij aby zmieni\u0107 kolejno\u015b\u0107';
    return handle;
  }

  // Globalny drag manager — obsługuje cross-container D&D
  function initSortableDrag(doc) {
    if (doc._kcfgDragInit) return;
    doc._kcfgDragInit = true;

    let dragEl = null;
    let dragType = null; // 'param' | 'value'
    let sourceContainer = null;
    let indicator = null;
    let dropInfo = null; // { container, before }

    function getDirectChild(el, container) {
      while (el && el.parentNode !== container) el = el.parentNode;
      return (el && el.parentNode === container) ? el : null;
    }

    function detectType(item) {
      if (item.classList.contains('kcfg-param-block') || item.classList.contains('kcfg-nested-param')) return 'param';
      if (item.classList.contains('kcfg-value-row-wrapper') || item.classList.contains('kcfg-value-row')) return 'value';
      return null;
    }

    function getValidTargets(type) {
      if (type === 'param') {
        return Array.from(doc.querySelectorAll('#kcfg-params-list, .kcfg-nest-list'));
      } else if (type === 'value') {
        return Array.from(doc.querySelectorAll('.kcfg-values-list'));
      }
      return [];
    }

    function findDrop(y, targets) {
      // Sortuj kontenery: najgłębsze (najbardziej zagnieżdżone) najpierw
      const sorted = targets.slice().sort((a, b) => {
        if (a.contains(b)) return 1;  // b jest głębszy
        if (b.contains(a)) return -1; // a jest głębszy
        return 0;
      });

      for (const cont of sorted) {
        const cr = cont.getBoundingClientRect();
        if (cr.height === 0 || cr.width === 0) continue;
        // Kursor musi być w granicach kontenera (z małym marginesem)
        if (y < cr.top - 10 || y > cr.bottom + 10) continue;

        const children = Array.from(cont.children).filter(c => c !== dragEl);

        // Znajdź pozycję wśród dzieci
        for (const child of children) {
          const r = child.getBoundingClientRect();
          if (y < r.top + r.height / 2) {
            return { container: cont, before: child, y: r.top };
          }
        }

        // Po ostatnim dziecku
        if (children.length > 0) {
          const last = children[children.length - 1];
          return { container: cont, before: null, y: last.getBoundingClientRect().bottom };
        }

        // Pusty kontener
        return { container: cont, before: null, y: cr.top + 5 };
      }
      return null;
    }

    doc.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.kcfg-drag-handle');
      if (!handle) return;

      // Znajdź sortable kontener i element
      const sortableContainers = Array.from(doc.querySelectorAll('#kcfg-params-list, .kcfg-values-list, .kcfg-nest-list'));
      let item = null;
      sourceContainer = null;

      for (const cont of sortableContainers) {
        const candidate = getDirectChild(handle, cont);
        if (candidate) {
          // Wybierz najbliższy (najgłębszy) kontener
          if (!sourceContainer || cont.contains(sourceContainer)) {
            // cont jest głębszy lub pierwszy
          }
          if (!sourceContainer || sourceContainer.contains(cont)) {
            sourceContainer = cont;
            item = candidate;
          }
        }
      }

      if (!item || !sourceContainer) return;

      e.preventDefault();
      e.stopPropagation();

      dragEl = item;
      dragType = detectType(item);
      if (!dragType) { dragEl = null; return; }

      dragEl.classList.add('kcfg-sortable-dragging');

      indicator = doc.createElement('div');
      indicator.className = 'kcfg-drop-indicator';
      indicator.style.display = 'none';
      doc.body.appendChild(indicator);

      function onMove(ev) {
        const targets = getValidTargets(dragType);
        const pos = findDrop(ev.clientY, targets);

        if (pos) {
          dropInfo = pos;
          // Pozycjonuj kreskę na poziomie elementu docelowego (uwzględniając margin-left dzieci)
          const refEl = pos.before || pos.container.lastElementChild;
          let lineLeft, lineWidth;
          if (refEl && refEl !== dragEl) {
            const rr = refEl.getBoundingClientRect();
            lineLeft = rr.left;
            lineWidth = rr.width;
          } else {
            const cr = pos.container.getBoundingClientRect();
            lineLeft = cr.left + 8;
            lineWidth = cr.width - 16;
          }
          indicator.style.display = '';
          indicator.style.left = lineLeft + 'px';
          indicator.style.width = lineWidth + 'px';
          indicator.style.top = pos.y + 'px';
        } else {
          dropInfo = null;
          indicator.style.display = 'none';
        }
      }

      function onUp() {
        doc.removeEventListener('mousemove', onMove);
        doc.removeEventListener('mouseup', onUp);

        dragEl.classList.remove('kcfg-sortable-dragging');
        if (indicator) { indicator.remove(); indicator = null; }

        if (dropInfo && dragEl) {
          if (dropInfo.before) {
            dropInfo.container.insertBefore(dragEl, dropInfo.before);
          } else {
            dropInfo.container.appendChild(dragEl);
          }
        }

        dragEl = null;
        dragType = null;
        sourceContainer = null;
        dropInfo = null;
      }

      doc.addEventListener('mousemove', onMove);
      doc.addEventListener('mouseup', onUp);
    }, true); // capture phase — łapiemy przed innymi handlerami
  }

  // Placeholder — makeSortable teraz tylko rejestruje kontener, logika jest globalna
  function makeSortable(container) {
    initSortableDrag(container.ownerDocument);
  }

  // =========================================================================
  // AUTOCOMPLETE
  // =========================================================================

  function attachAutocomplete(doc, inputEl, fetchSuggestions, opts) {
    const openOnEmptyFocus = opts?.openOnEmptyFocus || false;
    const placeholder = inputEl.placeholder || '';

    // Buduj komponent autocomplete — style inline (niezależne od CSS)
    const root = doc.createElement('div');
    root.style.cssText = 'position:relative;flex:1;min-width:120px;';
    inputEl.parentNode.insertBefore(root, inputEl);

    const field = doc.createElement('div');
    field.style.cssText = 'position:relative;display:flex;align-items:center;';
    root.appendChild(field);

    // Ikona lupy
    const iconWrap = doc.createElement('div');
    iconWrap.style.cssText = 'position:absolute;left:10px;width:15px;height:15px;pointer-events:none;display:flex;align-items:center;z-index:1;';
    iconWrap.innerHTML = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#9aa0a6" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10.5 10.5 14 14" stroke-linecap="round"/></svg>';
    field.appendChild(iconWrap);

    // Input — nadpisz style inline
    inputEl.setAttribute('style', 'width:100%!important;height:38px!important;padding:0 32px 0 32px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;color:#202124!important;outline:none!important;background:#fff!important;box-sizing:border-box!important;transition:border-color .15s,box-shadow .15s!important;');
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.setAttribute('spellcheck', 'false');
    inputEl.addEventListener('focus', function() {
      this.style.setProperty('border-color', '#1a73e8', 'important');
      this.style.setProperty('box-shadow', '0 0 0 3px rgba(26,115,232,.12)', 'important');
      iconWrap.querySelector('svg').setAttribute('stroke', '#1a73e8');
    });
    inputEl.addEventListener('blur', function() {
      this.style.setProperty('border-color', '#dadce0', 'important');
      this.style.setProperty('box-shadow', 'none', 'important');
      iconWrap.querySelector('svg').setAttribute('stroke', '#9aa0a6');
    });
    field.appendChild(inputEl);

    // Spinner
    const spinner = doc.createElement('div');
    spinner.style.cssText = 'position:absolute;right:32px;width:14px;height:14px;border:2px solid #dadce0;border-top-color:#1a73e8;border-radius:50%;animation:kcfgSpin .6s linear infinite;display:none;';
    field.appendChild(spinner);

    // Clear button
    const clearBtn = doc.createElement('button');
    clearBtn.type = 'button';
    clearBtn.style.cssText = 'position:absolute;right:8px;width:20px;height:20px;border:none;background:#e8eaed;border-radius:50%;cursor:pointer;display:none;align-items:center;justify-content:center;color:#5f6368;transition:background .15s;padding:0;';
    clearBtn.innerHTML = '<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l8 8M9 1L1 9"/></svg>';
    field.appendChild(clearBtn);

    // Dropdown
    const dropdown = doc.createElement('div');
    dropdown.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid #dadce0;border-radius:8px;overflow:hidden;z-index:9999;display:none;box-shadow:0 8px 24px rgba(0,0,0,0.15);';
    root.appendChild(dropdown);

    const listEl = doc.createElement('ul');
    listEl.style.cssText = 'list-style:none;max-height:240px;overflow-y:auto;margin:0;padding:0;';
    dropdown.appendChild(listEl);

    const footer = doc.createElement('div');
    footer.style.cssText = 'padding:6px 14px;font-size:11px;color:#9aa0a6;border-top:1px solid #f1f3f4;display:flex;align-items:center;justify-content:space-between;';
    footer.innerHTML = '<span class="kcfg-ac-count"></span><span>\u2191\u2193 nawigacja \u00b7 Enter wybierz \u00b7 Esc zamknij</span>';
    dropdown.appendChild(footer);

    const countEl = footer.querySelector('.kcfg-ac-count');

    let debounceTimer = null;
    let activeIdx = -1;
    let items = [];
    let justSelected = false;

    function esc(s) { return s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])); }

    function highlight(text, q) {
      if (!q) return esc(text);
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return esc(text).replace(re, '<b style="color:#1a73e8;font-weight:600;background:none">$1</b>');
    }

    function openDrop() { dropdown.style.display = 'block'; }
    function closeDrop() { dropdown.style.display = 'none'; listEl.innerHTML = ''; items = []; activeIdx = -1; }
    function setLoading(v) { spinner.style.display = v ? 'block' : 'none'; if (v) clearBtn.style.display = 'none'; }
    function setHasValue(v) { clearBtn.style.display = v ? 'flex' : 'none'; }

    const ITEM_STYLE = 'padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f3f4;transition:background .1s;';
    const ITEM_ACTIVE_BG = '#e8f0fe';

    function renderResults(suggestions, query) {
      listEl.innerHTML = '';
      items = suggestions;
      activeIdx = -1;

      if (!suggestions.length) {
        listEl.innerHTML = '<li style="padding:16px 14px;font-size:13px;color:#9aa0a6;text-align:center;">Brak wynik\u00f3w' + (query ? ' dla <b>"' + esc(query) + '"</b>' : '') + '</li>';
        countEl.textContent = '';
        openDrop();
        return;
      }

      countEl.textContent = suggestions.length + ' wynik' + (suggestions.length > 4 ? '\u00f3w' : suggestions.length > 1 ? 'i' : '');

      suggestions.forEach((s, i) => {
        const li = doc.createElement('li');
        li.style.cssText = ITEM_STYLE;
        li.setAttribute('data-index', i);
        li.innerHTML = highlight(s, query);
        li.addEventListener('mouseover', () => { li.style.background = ITEM_ACTIVE_BG; });
        li.addEventListener('mouseout', () => { li.style.background = ''; });
        li.addEventListener('mousedown', (e) => { e.preventDefault(); selectItem(s); });
        listEl.appendChild(li);
      });
      openDrop();
    }

    function setActive(idx) {
      listEl.querySelectorAll('li[data-index]').forEach(el => { el.style.background = ''; });
      activeIdx = idx;
      const el = listEl.querySelectorAll('li[data-index]')[idx];
      if (el) { el.style.background = ITEM_ACTIVE_BG; el.scrollIntoView({ block: 'nearest' }); }
    }

    function selectItem(value) {
      justSelected = true;
      inputEl.value = value;
      setHasValue(true);
      closeDrop();
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => { justSelected = false; }, 300);
    }

    async function doSearch(q) {
      setLoading(true);
      try {
        const suggestions = await fetchSuggestions(q);
        if (justSelected) return;
        if (inputEl.value.trim().toLowerCase() !== q.toLowerCase() && q !== '') return;
        renderResults(suggestions, q);
      } catch (_e) {
        listEl.innerHTML = '<li><div class="kcfg-ac__empty" style="color:#d93025">B\u0142\u0105d pobierania</div></li>';
        openDrop();
      } finally {
        setLoading(false);
      }
    }

    // Events
    inputEl.addEventListener('input', () => {
      if (justSelected) return;
      setHasValue(inputEl.value.length > 0);
      clearTimeout(debounceTimer);
      const q = inputEl.value.trim();
      if (q.length < 1 && !openOnEmptyFocus) { closeDrop(); return; }
      debounceTimer = setTimeout(() => doSearch(q), 200);
    });

    inputEl.addEventListener('focus', () => {
      if (justSelected) return;
      const q = inputEl.value.trim();
      if (q.length >= 1 || openOnEmptyFocus) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => doSearch(q), 100);
      }
    });

    inputEl.addEventListener('keydown', (e) => {
      if (dropdown.style.display === 'none') return;
      const allItems = listEl.querySelectorAll('.kcfg-ac__item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(activeIdx + 1, allItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        selectItem(items[activeIdx]);
      } else if (e.key === 'Escape') {
        closeDrop();
      }
    });

    inputEl.addEventListener('blur', () => {
      setTimeout(() => closeDrop(), 150);
    });

    clearBtn.addEventListener('click', () => {
      inputEl.value = '';
      setHasValue(false);
      closeDrop();
      inputEl.focus();
    });

    // Zamknij przy kliknięciu poza
    doc.addEventListener('click', (e) => {
      if (!root.contains(e.target)) closeDrop();
    });
  }

  // =========================================================================
  // TRAIT GROUPS / VALUES CACHE (from parameters tree)
  // =========================================================================

  let _traitGroupsCache = null; // [{id, name}]
  let _traitGroupsFetching = false;
  let _traitValuesCache = {}; // groupId → [{id, name}]


  function fetchTraitGroups() {
    if (_traitGroupsCache) return Promise.resolve(_traitGroupsCache);
    if (_traitGroupsFetching) return new Promise(r => {
      const iv = setInterval(() => { if (_traitGroupsCache) { clearInterval(iv); r(_traitGroupsCache); } }, 200);
    });
    _traitGroupsFetching = true;

    return fetch(AJAX_PARAMS_URL + '?action=autocomplete&parameter_id=0&type=parameter&txt=', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      _traitGroupsCache = (data.results || []).map(r => ({ id: r.id, name: r.value || r.name || '' })).filter(g => g.name);
      console.log('[PanelPRO] Załadowano', _traitGroupsCache.length, 'grup parametrów');
      _traitGroupsFetching = false;
      return _traitGroupsCache;
    })
    .catch(err => { console.error('[PanelPRO] Błąd fetch parametrów:', err); _traitGroupsFetching = false; _traitGroupsCache = []; return []; });
  }

  function fetchTraitValues(groupId) {
    if (_traitValuesCache[groupId]) return Promise.resolve(_traitValuesCache[groupId]);

    return fetch(AJAX_PARAMS_URL, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=getTreeForSection&parameter=group' + groupId + '&lang=' + LANG
    })
    .then(r => r.json())
    .then(data => {
      const html = data.treeCode || '';
      const parser = new DOMParser();
      const doc = parser.parseFromString('<div>' + html + '</div>', 'text/html');
      const values = [];
      doc.querySelectorAll('.showMenuSub').forEach(el => {
        const name = el.textContent.trim();
        const id = el.id?.replace('showMenuSub_', '') || '';
        if (name && !name.startsWith('* ') && name !== 'niewybrany') values.push({ id, name });
      });
      _traitValuesCache[groupId] = values;
      return values;
    })
    .catch(() => { _traitValuesCache[groupId] = []; return []; });
  }

  function getParamNameSuggestions(doc, query) {
    const q = query.toLowerCase();
    const names = new Set();

    // Lokalne — z wpisanych pól w kreatorze
    doc.querySelectorAll('.kcfg-param-name').forEach(inp => {
      const v = inp.value.trim();
      if (v) names.add(v);
    });

    // Z drzewa parametrów (grupy)
    return fetchTraitGroups().then(groups => {
      groups.forEach(g => names.add(g.name));
      return Array.from(names).filter(n => n.toLowerCase().includes(q)).sort().slice(0, 20);
    });
  }

  // (value suggestions now use trait groups cache above)

  function getValueNameSuggestions(doc, paramBlock, query) {
    const q = query.toLowerCase();
    const paramName = (paramBlock.querySelector('.kcfg-param-name')?.value || '').trim();

    // Znajdź grupę parametrów po nazwie i załaduj jej wartości
    return fetchTraitGroups().then(groups => {
      const matchingGroup = groups.find(g => g.name.toLowerCase() === paramName.toLowerCase());
      if (!matchingGroup) return [];

      return fetchTraitValues(matchingGroup.id).then(values => {
        const all = values.map(v => v.name);
        if (!q) return all.slice(0, 50); // puste query = pokaż wszystkie
        return all.filter(n => n.toLowerCase().includes(q)).slice(0, 30);
      });
    });
  }

  async function removeExistingConfigurator(productId) {
    const shopId = getShopId();
    const url = AJAX_DYNAMIC_CONTENT_URL +
      '?name=configuratorParametersList&idt=' + encodeURIComponent(productId) +
      '&shopId=' + encodeURIComponent(shopId);
    const resp = await fetchAjaxGet(url);
    const html = resp.raw || '';
    const config = parseConfiguratorHtml(html);
    if (!config || config.parameters.length === 0) return;

    // Remove each existing parameter
    for (const param of config.parameters) {
      if (!param.id) continue;
      const payload = {
        productId: String(productId),
        parameters: {
          data: {},
          remove: [parseInt(param.id, 10)],
        },
        lang: LANG,
        action: 'add',
        parameterId: null,
      };
      await fetchAjaxRaw(
        AJAX_PARAMS_URL + '?action=addPriceConfiguratorParameters',
        'paramsData=' + encodeURIComponent(JSON.stringify(payload))
      );
    }

    // Clear the tree
    const treePayload = {
      priceConfiguratorData: {},
      priceConfiguratorDataOrder: {},
    };
    await fetchAjaxRaw(
      AJAX_PRODUCT_URL + '?action=productEdit&idt=' + encodeURIComponent(productId),
      'paramsData=' + encodeURIComponent(JSON.stringify(treePayload))
    );
  }

  // =========================================================================
  // KONFIGURATOR Z PARAMETRÓW PRZYPISANYCH DO TOWARU
  // =========================================================================

  // Czyta parametry przypisane do towaru (action=getProductData) i przekłada je
  // na strukturę konfiguratora: parametr → jego wartości, modyfikatory wyzerowane.
  async function fetchProductParametersAsConfig(productId) {
    const data = await fetchProductLangData(productId);
    if (!Array.isArray(data)) return { parameters: [] };

    const parameters = [];
    data.forEach(ap => {
      const name = (ap.data?.[LANG]?.name || '').trim();
      if (!name) return;

      const values = (ap.children || []).map(child => {
        const vname = (child.data?.[LANG]?.name || '').trim();
        if (!vname) return null;
        return { id: '', name: vname, modifierType: 'amount_add', modifierValue: '0', children: [] };
      }).filter(Boolean);

      // Parametr bez wartości nie nadaje się na pozycję konfiguratora
      if (values.length === 0) return;

      parameters.push({ id: '', name, type: 'select', required: true, values });
    });

    return { parameters };
  }

  function showFromProductParamsMode(doc, selectedProductIds) {
    const { modal, body, footer } = createModal(doc, 'Konfigurator z parametrów towaru', selectedProductIds.length);
    modal.classList.add('kcfg-modal--wide');

    body.innerHTML =
      '<div class="kcfg-info kcfg-info--warning" style="margin-bottom:14px;">' +
        'Dla każdego zaznaczonego towaru: typ zostanie zmieniony na <b>konfigurator</b> ' +
        '(jeśli towar ma stany — zostaną wyzerowane, typ zmieniony i stany przywrócone), ' +
        'a następnie powstanie konfigurator z parametrów przypisanych do towaru. ' +
        'Modyfikatory cen startują od zera — ustawisz je później lub w kreatorze.' +
      '</div>' +
      '<div id="kcfg-fp-preview" style="padding:16px;text-align:center;color:#5f6368;font-size:13px;">' +
        '<span class="kcfg-spinner"></span> Odczytuję parametry towaru #' + escapeHtml(String(selectedProductIds[0])) + '...' +
      '</div>' +
      '<div class="kcfg-options" style="margin-top:14px;">' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-fp-per-product" checked><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Każdy towar ze swoich parametrów (wyłącz = parametry pierwszego towaru dla wszystkich)</label></div>' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-fp-autotype" checked><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Zmień typ towaru na konfigurator (zeruje i przywraca stany magazynowe)</label></div>' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-fp-update"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Aktualizuj modyfikatory w istniejących konfiguratorach (zamiast nadpisywać)</label></div>' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-fp-hide"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Ukryj parametry na karcie towaru i w porównywarce</label></div>' +
      '</div>';

    const previewArea = body.querySelector('#kcfg-fp-preview');
    let firstConfig = null;

    footer.innerHTML =
      '<button class="kcfg-btn-secondary" id="kcfg-back">Wstecz</button>' +
      '<button class="kcfg-btn-secondary" id="kcfg-fp-editor" disabled>Edytuj w kreatorze</button>' +
      '<button class="kcfg-btn-primary" id="kcfg-fp-run" disabled>Zbuduj dla ' + selectedProductIds.length + ' ' +
        (selectedProductIds.length === 1 ? 'towaru' : 'towarów') + '</button>';

    footer.querySelector('#kcfg-back').addEventListener('click', () => showConfiguratorModal(doc, selectedProductIds));

    // Podgląd na pierwszym towarze — zanim cokolwiek zostanie zapisane
    fetchProductParametersAsConfig(selectedProductIds[0]).then(config => {
      firstConfig = config;
      if (!config.parameters.length) {
        previewArea.innerHTML = '<div class="kcfg-info kcfg-info--warning">Towar #' +
          escapeHtml(String(selectedProductIds[0])) + ' nie ma przypisanych parametrów z wartościami. ' +
          'Przy trybie „każdy towar ze swoich parametrów" pozostałe towary i tak zostaną sprawdzone osobno.</div>';
      } else {
        previewArea.innerHTML =
          '<div style="font-size:12px;color:#5f6368;text-align:left;margin-bottom:4px;">Podgląd — towar #' +
          escapeHtml(String(selectedProductIds[0])) + ' (' + config.parameters.length + ' parametrów):</div>' +
          buildPreviewTableHtml(config);
        footer.querySelector('#kcfg-fp-editor').disabled = false;
      }
      footer.querySelector('#kcfg-fp-run').disabled = false;
    }).catch(err => {
      previewArea.innerHTML = '<div class="kcfg-info kcfg-info--error">Błąd odczytu parametrów: ' + escapeHtml(err.message) + '</div>';
    });

    // Ręczna korekta przed zapisem — ta sama ścieżka co kopiowanie/import
    footer.querySelector('#kcfg-fp-editor').addEventListener('click', () => {
      if (firstConfig && firstConfig.parameters.length) showCreateMode(doc, selectedProductIds, firstConfig);
    });

    footer.querySelector('#kcfg-fp-run').addEventListener('click', () => {
      const perProduct = body.querySelector('#kcfg-fp-per-product').checked;
      const opts = {
        autoType: body.querySelector('#kcfg-fp-autotype').checked,
        updateExisting: body.querySelector('#kcfg-fp-update').checked,
        hideParams: body.querySelector('#kcfg-fp-hide').checked,
      };

      if (!perProduct && (!firstConfig || !firstConfig.parameters.length)) {
        previewArea.innerHTML = '<div class="kcfg-info kcfg-info--error">Brak parametrów pierwszego towaru — nie ma czego zastosować do pozostałych.</div>';
        return;
      }

      const items = selectedProductIds.map(id => ({
        productId: id,
        label: 'Towar #' + id,
        configData: perProduct ? null : firstConfig,
        resolveConfigData: perProduct ? (() => fetchProductParametersAsConfig(id)) : null,
      }));

      runConfiguratorBatch(doc, items, opts, body, footer, 'Budowanie konfiguratorów zakończone');
    });
  }

  // =========================================================================
  // CREATE MODE
  // =========================================================================

  function showCreateMode(doc, selectedProductIds, preloadedConfigData) {
    // Reset trait values cache for fresh suggestions
    _traitValuesCache = {};
    // Pre-fetch trait groups to cache (in background)
    fetchTraitGroups();

    const { modal, body, footer } = createModal(doc, 'Kreator konfiguratora', selectedProductIds.length);
    modal.classList.add('kcfg-modal--wide');

    // Tabs: Kreator | Import z pliku
    body.innerHTML =
      '<div class="kcfg-tabs">' +
        '<button class="kcfg-tab kcfg-tab--active" data-tab="creator">Kreator</button>' +
        '<button class="kcfg-tab" data-tab="csv">Import z pliku</button>' +
      '</div>' +
      '<div id="kcfg-tab-content"></div>' +
      '<div class="kcfg-options" style="margin-top:12px;">' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-opt-update-existing"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Aktualizuj modyfikatory w istniej\u0105cych konfiguratorach (zamiast nadpisywa\u0107)</label></div>' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-opt-auto-type" checked><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Automatycznie zmie\u0144 typ towaru na konfigurator (je\u015bli trzeba)</label></div>' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-opt-hide-params"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Ukryj parametry na karcie towaru i w por\u00f3wnywarce</label></div>' +
      '</div>';

    const tabs = body.querySelectorAll('.kcfg-tab');
    const tabContent = body.querySelector('#kcfg-tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('kcfg-tab--active'));
        tab.classList.add('kcfg-tab--active');
        if (tab.dataset.tab === 'creator') {
          renderCreatorTab(doc, tabContent);
          // Jeśli były dane — nie nadpisuj kreatora (user mógł edytować)
        } else {
          renderCsvTab(doc, tabContent);
        }
      });
    });

    renderCreatorTab(doc, tabContent);

    // Wypełnij kreator danymi jeśli przekazane (z kopiowania lub importu)
    if (preloadedConfigData) {
      // Move _importProducts to tabContent to avoid circular reference on configData
      if (preloadedConfigData._importProducts) {
        tabContent._importProducts = preloadedConfigData._importProducts;
        delete preloadedConfigData._importProducts;
      }
      setTimeout(() => fillCreatorFromConfig(doc, tabContent, preloadedConfigData), 50);
    }

    footer.innerHTML =
      '<button class="kcfg-btn-secondary" id="kcfg-back">Wstecz</button>' +
      '<button class="kcfg-btn-primary" id="kcfg-apply-btn">Zastosuj do ' + selectedProductIds.length + ' towar\u00f3w</button>';

    footer.querySelector('#kcfg-back').addEventListener('click', () => showConfiguratorModal(doc, selectedProductIds));
    footer.querySelector('#kcfg-apply-btn').addEventListener('click', () => {
      const configData = collectConfiguratorData(doc, tabContent);
      if (!configData || configData.parameters.length === 0) {
        alert('Dodaj przynajmniej jeden parametr z warto\u015bciami.');
        return;
      }
      const updateExisting = body.querySelector('#kcfg-opt-update-existing').checked;
      const autoType = body.querySelector('#kcfg-opt-auto-type').checked;
      const hideParams = body.querySelector('#kcfg-opt-hide-params').checked;
      executeCreate(doc, selectedProductIds, configData, updateExisting, autoType, hideParams, body, footer);
    });
  }

  // =========================================================================
  // CREATOR TAB
  // =========================================================================

  function renderCreatorTab(doc, container) {
    container.innerHTML =
      '<div id="kcfg-params-list"></div>' +
      '<button class="kcfg-add-param-btn" id="kcfg-add-param">+ Dodaj parametr</button>';

    container.querySelector('#kcfg-add-param').addEventListener('click', () => {
      addParameterBlock(doc, container.querySelector('#kcfg-params-list'));
    });

    // Add one empty block by default
    addParameterBlock(doc, container.querySelector('#kcfg-params-list'));

    // Sortowanie parametrów drag & drop
    makeSortable(container.querySelector('#kcfg-params-list'));
  }

  function fillCreatorFromConfig(doc, tabContent, configData) {
    const paramsList = tabContent.querySelector('#kcfg-params-list');
    if (!paramsList) return;

    // Wyczyść istniejące bloki
    paramsList.innerHTML = '';

    // Zbierz indeksy child-only parametrów (nie dodawaj ich na top-level)
    const childOnlyIdxs = new Set();
    configData.parameters.forEach(param => {
      param.values.forEach(val => {
        if (val.children) val.children.forEach(idx => childOnlyIdxs.add(idx));
      });
    });

    configData.parameters.forEach((param, paramIdx) => {
      if (childOnlyIdxs.has(paramIdx)) return; // child-only — dodany jako zagnieżdżony

      addParameterBlock(doc, paramsList);
      const block = paramsList.lastElementChild;
      if (!block) return;

      // Store langData on DOM element
      if (param.langData) block._langData = param.langData;

      // Wypełnij nazwę
      const nameInput = block.querySelector('.kcfg-param-name');
      if (nameInput) nameInput.value = param.name || '';

      // Ustaw typ
      const typeSelect = block.querySelector('.kcfg-param-type');
      if (typeSelect) {
        typeSelect.value = param.type || 'select';
        typeSelect.dispatchEvent(new Event('change'));
      }

      // Wymagany
      const reqCb = block.querySelector('.kcfg-param-required input[type="checkbox"]');
      if (reqCb && !reqCb.disabled) reqCb.checked = param.required !== false;

      // Wypełnij wartości
      const valuesContainer = block.querySelector('.kcfg-values-list');
      if (!valuesContainer) return;

      // Usuń domyślny pusty wiersz
      valuesContainer.innerHTML = '';

      param.values.forEach(val => {
        addValueRow(doc, valuesContainer, block);
        const wrapper = valuesContainer.lastElementChild;
        if (!wrapper) return;
        // Store langData on DOM element
        if (val.langData) wrapper._langData = val.langData;
        const row = wrapper.querySelector ? wrapper.querySelector('.kcfg-value-row') || wrapper : wrapper;

        const vNameInput = row.querySelector('.kcfg-value-name');
        if (vNameInput) vNameInput.value = val.name || '';

        const modType = row.querySelector('.kcfg-modifier-type');
        if (modType) modType.value = val.modifierType || 'amount_add';

        const modVal = row.querySelector('.kcfg-modifier-value');
        if (modVal) modVal.value = val.modifierValue || '0';

        // Zagnieżdżone parametry
        if (val.children && val.children.length > 0) {
          const nestBtn = row.querySelector('.kcfg-nest-toggle');
          if (nestBtn) nestBtn.click(); // otwórz panel

          const nestList = wrapper.querySelector('.kcfg-nest-list');
          if (nestList) {
            // Usuń domyślny pusty blok
            nestList.innerHTML = '';

            val.children.forEach(childIdx => {
              const childParam = configData.parameters[childIdx];
              if (!childParam) return;

              addNestedParamBlock(doc, nestList);
              const nestedBlock = nestList.lastElementChild;
              if (!nestedBlock) return;

              const nName = nestedBlock.querySelector('.kcfg-nested-param-name');
              if (nName) nName.value = childParam.name || '';

              const nType = nestedBlock.querySelector('.kcfg-nested-param-type');
              if (nType) {
                nType.value = childParam.type || 'select';
                nType.dispatchEvent(new Event('change'));
              }

              // Wartości zagnieżdżonego parametru
              const nValuesContainer = nestedBlock.querySelector('.kcfg-values-list');
              if (nValuesContainer) {
                nValuesContainer.innerHTML = '';
                childParam.values.forEach(nVal => {
                  addNestedValueRow(doc, nValuesContainer, nestedBlock);
                  const nRow = nValuesContainer.lastElementChild;
                  if (!nRow) return;
                  const nvName = nRow.querySelector('.kcfg-nested-value-name, .kcfg-value-name');
                  if (nvName) nvName.value = nVal.name || '';
                  const nvModType = nRow.querySelector('.kcfg-modifier-type');
                  if (nvModType) nvModType.value = nVal.modifierType || 'amount_add';
                  const nvModVal = nRow.querySelector('.kcfg-modifier-value');
                  if (nvModVal) nvModVal.value = nVal.modifierValue || '0';
                });
              }
            });
          }
        }
      });
    });

    // Sekcja nieużywanych parametrów (z importu)
    if (configData.unusedParameters && configData.unusedParameters.length > 0) {
      let unusedSection = tabContent.querySelector('#kcfg-unused-section');
      if (!unusedSection) {
        unusedSection = doc.createElement('div');
        unusedSection.id = 'kcfg-unused-section';
        unusedSection.style.cssText = 'margin-top:16px;padding:14px 16px;background:#fff;border:1px solid #e8eaed;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);';
        unusedSection.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
            '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5f6368;">Nieu\u017cywane parametry konfiguracyjne</div>' +
            '<div style="font-size:11px;color:#9aa0a6;">Kliknij aby doda\u0107 do konfiguratora</div>' +
          '</div>' +
          '<div id="kcfg-unused-list"></div>';
        // Wstaw przed "Dodaj parametr"
        const addParamBtn = tabContent.querySelector('#kcfg-add-param');
        if (addParamBtn) addParamBtn.parentNode.insertBefore(unusedSection, addParamBtn);
        else tabContent.appendChild(unusedSection);
      }

      const unusedList = unusedSection.querySelector('#kcfg-unused-list');
      unusedList.innerHTML = '';

      configData.unusedParameters.forEach((up, i) => {
        const chip = doc.createElement('div');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;margin:3px 4px;background:#f1f3f4;border:1px solid #dadce0;border-radius:6px;font-size:13px;color:#3c4043;cursor:pointer;transition:all .15s;';
        chip.innerHTML = '<span style="font-weight:500;">' + escapeHtml(up.name) + '</span><span style="font-size:11px;color:#9aa0a6;">(' + (up.values || []).length + ' wart.)</span>';
        chip.title = 'Kliknij aby doda\u0107 "' + up.name + '" do konfiguratora';
        chip.addEventListener('mouseover', () => { chip.style.borderColor = '#1a73e8'; chip.style.background = '#e8f0fe'; });
        chip.addEventListener('mouseout', () => { chip.style.borderColor = '#dadce0'; chip.style.background = '#f1f3f4'; });
        chip.addEventListener('click', () => {
          // Dodaj jako nowy blok parametru
          addParameterBlock(doc, paramsList);
          const block = paramsList.lastElementChild;
          if (!block) return;
          const nameInput = block.querySelector('.kcfg-param-name');
          if (nameInput) nameInput.value = up.name;
          const typeSelect = block.querySelector('.kcfg-param-type');
          if (typeSelect) { typeSelect.value = up.type || 'select'; typeSelect.dispatchEvent(new Event('change')); }
          const valuesContainer = block.querySelector('.kcfg-values-list');
          if (valuesContainer && up.values) {
            valuesContainer.innerHTML = '';
            up.values.forEach(v => {
              addValueRow(doc, valuesContainer, block);
              const wrapper = valuesContainer.lastElementChild;
              const row = wrapper?.querySelector('.kcfg-value-row') || wrapper;
              const vn = row?.querySelector('.kcfg-value-name');
              if (vn) vn.value = v.name || '';
              const mt = row?.querySelector('.kcfg-modifier-type');
              if (mt) mt.value = v.modifierType || 'amount_add';
              const mv = row?.querySelector('.kcfg-modifier-value');
              if (mv) mv.value = v.modifierValue || '0';
            });
          }
          // Usuń chip
          chip.remove();
          if (!unusedList.children.length) unusedSection.remove();
        });
        unusedList.appendChild(chip);
      });
    }
  }

  function moveParamToUnused(doc, block) {
    // Zbierz dane z bloku
    const name = block.querySelector('.kcfg-param-name')?.value?.trim() || '';
    const type = block.querySelector('.kcfg-param-type')?.value || 'select';
    const reqCb = block.querySelector('.kcfg-param-required input[type="checkbox"]');
    const required = reqCb ? reqCb.checked : true;
    const values = [];
    block.querySelectorAll('.kcfg-value-row').forEach(row => {
      const vn = row.querySelector('.kcfg-value-name')?.value?.trim();
      if (!vn) return;
      values.push({
        name: vn,
        modifierType: row.querySelector('.kcfg-modifier-type')?.value || 'amount_add',
        modifierValue: row.querySelector('.kcfg-modifier-value')?.value || '0',
      });
    });

    // Usuń blok z DOM
    block.remove();

    // Jeśli parametr nie ma nazwy — nie dodawaj do nieużywanych
    if (!name) return;

    // Znajdź lub stwórz sekcję nieużywanych
    const tabContent = doc.querySelector('#kcfg-tab-content');
    const paramsList = doc.querySelector('#kcfg-params-list');
    if (!tabContent || !paramsList) return;

    let unusedSection = tabContent.querySelector('#kcfg-unused-section');
    if (!unusedSection) {
      unusedSection = doc.createElement('div');
      unusedSection.id = 'kcfg-unused-section';
      unusedSection.style.cssText = 'margin-top:16px;padding:14px 16px;background:#fff;border:1px solid #e8eaed;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);';
      unusedSection.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
          '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#5f6368;">Nieu\u017cywane parametry</div>' +
          '<div style="font-size:11px;color:#9aa0a6;">Kliknij aby przywr\u00f3ci\u0107 do konfiguratora</div>' +
        '</div>' +
        '<div id="kcfg-unused-list"></div>';
      const addParamBtn = tabContent.querySelector('#kcfg-add-param');
      if (addParamBtn) addParamBtn.parentNode.insertBefore(unusedSection, addParamBtn);
      else tabContent.appendChild(unusedSection);
    }

    const unusedList = unusedSection.querySelector('#kcfg-unused-list');

    // Dodaj chip
    const chip = doc.createElement('div');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;margin:3px 4px;background:#f1f3f4;border:1px solid #dadce0;border-radius:6px;font-size:13px;color:#3c4043;cursor:pointer;transition:all .15s;';
    chip.innerHTML = '<span style="font-weight:500;">' + escapeHtml(name) + '</span><span style="font-size:11px;color:#9aa0a6;">(' + values.length + ' wart.)</span>';
    chip.title = 'Kliknij aby przywr\u00f3ci\u0107 "' + name + '" do konfiguratora';
    chip.addEventListener('mouseover', () => { chip.style.borderColor = '#1a73e8'; chip.style.background = '#e8f0fe'; });
    chip.addEventListener('mouseout', () => { chip.style.borderColor = '#dadce0'; chip.style.background = '#f1f3f4'; });
    chip.addEventListener('click', () => {
      addParameterBlock(doc, paramsList);
      const newBlock = paramsList.lastElementChild;
      if (!newBlock) return;
      const ni = newBlock.querySelector('.kcfg-param-name');
      if (ni) ni.value = name;
      const ts = newBlock.querySelector('.kcfg-param-type');
      if (ts) { ts.value = type; ts.dispatchEvent(new Event('change')); }
      const vc = newBlock.querySelector('.kcfg-values-list');
      if (vc && values.length > 0) {
        vc.innerHTML = '';
        values.forEach(v => {
          addValueRow(doc, vc, newBlock);
          const w = vc.lastElementChild;
          const r = w?.querySelector('.kcfg-value-row') || w;
          const vni = r?.querySelector('.kcfg-value-name');
          if (vni) vni.value = v.name;
          const mt = r?.querySelector('.kcfg-modifier-type');
          if (mt) mt.value = v.modifierType;
          const mv = r?.querySelector('.kcfg-modifier-value');
          if (mv) mv.value = v.modifierValue;
        });
      }
      chip.remove();
      if (!unusedList.children.length) unusedSection.remove();
    });
    unusedList.appendChild(chip);
  }

  function addParameterBlock(doc, listEl) {
    const block = doc.createElement('div');
    block.className = 'kcfg-param-block';

    const header = doc.createElement('div');
    header.className = 'kcfg-param-header';

    const nameInput = doc.createElement('input');
    nameInput.className = 'kcfg-param-name';
    nameInput.placeholder = 'Nazwa parametru';
    nameInput.type = 'text';

    const typeSelect = doc.createElement('select');
    typeSelect.className = 'kcfg-param-type';
    typeSelect.setAttribute('style', 'padding:0 10px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;outline:none!important;background:#fff!important;min-width:200px!important;height:38px!important;');
    PARAM_TYPES.forEach(t => {
      const opt = doc.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      typeSelect.appendChild(opt);
    });

    const requiredLabel = doc.createElement('label');
    requiredLabel.className = 'kcfg-param-required';
    requiredLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:#5f6368;cursor:pointer;white-space:nowrap;';
    const switchWrap = doc.createElement('span');
    switchWrap.className = 'kcfg-switch';
    const requiredCb = doc.createElement('input');
    requiredCb.type = 'checkbox';
    requiredCb.checked = true;
    const switchTrack = doc.createElement('span');
    switchTrack.className = 'kcfg-switch-track';
    switchTrack.innerHTML = '<span class="kcfg-switch-thumb"></span>';
    switchWrap.appendChild(requiredCb);
    switchWrap.appendChild(switchTrack);
    requiredLabel.appendChild(switchWrap);
    requiredLabel.appendChild(doc.createTextNode('Wymagany'));

    const removeBtn = doc.createElement('button');
    removeBtn.className = 'kcfg-param-remove';
    removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    removeBtn.title = 'Usu\u0144 parametr';
    removeBtn.addEventListener('click', () => {
      moveParamToUnused(doc, block);
    });

    header.appendChild(createDragHandle(doc));
    header.appendChild(nameInput);
    header.appendChild(typeSelect);
    header.appendChild(requiredLabel);
    header.appendChild(removeBtn);

    // Panel pola tekstowego (widoczny tylko gdy type=input)
    const inputOptionsPanel = doc.createElement('div');
    inputOptionsPanel.className = 'kcfg-input-options';
    inputOptionsPanel.style.cssText = 'display:none;padding:0 16px 12px;background:#fafbfc;';
    inputOptionsPanel.innerHTML =
      '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">' +
        '<label style="font-size:12px;color:#5f6368;font-weight:500;white-space:nowrap;">Zawarto\u015b\u0107 pola:</label>' +
        '<select class="kcfg-input-content-type" style="padding:0 10px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;background:#fff!important;height:38px!important;outline:none!important;min-width:140px!important;">' +
          INPUT_CONTENT_TYPES.map(t => '<option value="' + t.value + '">' + t.label + '</option>').join('') +
        '</select>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#5f6368;cursor:pointer;white-space:nowrap;">' +
          '<span class="kcfg-switch"><input type="checkbox" class="kcfg-input-min-cb"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span>' +
          '<span class="kcfg-input-min-label">Ustaw minimaln\u0105 liczb\u0119 znak\u00f3w</span>' +
        '</label>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#5f6368;cursor:pointer;white-space:nowrap;">' +
          '<span class="kcfg-switch"><input type="checkbox" class="kcfg-input-max-cb"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span>' +
          '<span class="kcfg-input-max-label">Ustaw maksymaln\u0105 liczb\u0119 znak\u00f3w</span>' +
        '</label>' +
      '</div>';

    // Zmiana labeli min/max w zależności od typu zawartości
    const contentTypeSelect = inputOptionsPanel.querySelector('.kcfg-input-content-type');
    const minLabel = inputOptionsPanel.querySelector('.kcfg-input-min-label');
    const maxLabel = inputOptionsPanel.querySelector('.kcfg-input-max-label');
    function updateMinMaxLabels() {
      const isText = contentTypeSelect.value === 'text';
      minLabel.textContent = isText ? 'Ustaw minimaln\u0105 liczb\u0119 znak\u00f3w' : 'Ustaw minimaln\u0105 warto\u015b\u0107';
      maxLabel.textContent = isText ? 'Ustaw maksymaln\u0105 liczb\u0119 znak\u00f3w' : 'Ustaw maksymaln\u0105 warto\u015b\u0107';
    }
    contentTypeSelect.addEventListener('change', updateMinMaxLabels);

    // Logika zmiany typu
    function updateTypeUI() {
      const type = typeSelect.value;
      const typeInfo = PARAM_TYPES.find(t => t.value === type);

      // Wymagany: input=ukryty+off, select/radio=on+zablokowany, checkbox=on+edytowalny
      if (typeInfo?.requiredHidden) {
        // Pole tekstowe — wyłączony i ukryty
        requiredLabel.style.display = 'none';
        requiredCb.checked = false;
        requiredCb.disabled = true;
      } else if (typeInfo?.requiredLocked) {
        // Lista rozwijana / Jednokrotny wybór — włączony, zablokowany
        requiredLabel.style.display = '';
        requiredCb.checked = true;
        requiredCb.disabled = true;
        requiredLabel.style.opacity = '0.6';
        requiredLabel.style.cursor = 'not-allowed';
      } else {
        // Wielokrotny wybór — włączony domyślnie, edytowalny
        requiredLabel.style.display = '';
        requiredCb.checked = true;
        requiredCb.disabled = false;
        requiredLabel.style.opacity = '';
        requiredLabel.style.cursor = 'pointer';
      }

      // Panel pola tekstowego
      inputOptionsPanel.style.display = type === 'input' ? '' : 'none';

      // Wartości — ukryj dla pola tekstowego
      const valuesSection = block.querySelector('.kcfg-values-list');
      const addValBtn = block.querySelector('.kcfg-add-value-btn');
      if (valuesSection) valuesSection.style.display = type === 'input' ? 'none' : '';
      if (addValBtn) addValBtn.style.display = type === 'input' ? 'none' : '';
    }

    typeSelect.addEventListener('change', updateTypeUI);

    // Autocomplete for parameter name
    attachAutocomplete(doc, nameInput, (q) => getParamNameSuggestions(doc, q));

    // When name changes, trigger autocomplete refresh
    nameInput.addEventListener('input', () => {});

    const valuesContainer = doc.createElement('div');
    valuesContainer.className = 'kcfg-values-list';

    const addValueBtn = doc.createElement('button');
    addValueBtn.className = 'kcfg-add-value-btn';
    addValueBtn.textContent = '+ Dodaj warto\u015b\u0107';
    addValueBtn.addEventListener('click', () => {
      addValueRow(doc, valuesContainer, block);
    });

    block.appendChild(header);
    block.appendChild(inputOptionsPanel);
    block.appendChild(valuesContainer);
    block.appendChild(addValueBtn);

    listEl.appendChild(block);

    // Add one empty value row
    addValueRow(doc, valuesContainer, block);

    // Ustaw domyślny stan UI
    updateTypeUI();

    // Sortowanie wartości drag & drop
    makeSortable(valuesContainer);
  }

  function addValueRow(doc, container, paramBlock) {
    const wrapper = doc.createElement('div');
    wrapper.className = 'kcfg-value-row-wrapper';

    const row = doc.createElement('div');
    row.className = 'kcfg-value-row';

    const nameInput = doc.createElement('input');
    nameInput.className = 'kcfg-value-name';
    nameInput.placeholder = 'Nazwa warto\u015bci';
    nameInput.type = 'text';

    const modTypeSelect = doc.createElement('select');
    modTypeSelect.className = 'kcfg-modifier-type';
    modTypeSelect.setAttribute('style', 'padding:0 8px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;outline:none!important;background:#fff!important;width:70px!important;height:38px!important;cursor:pointer;');
    MODIFIER_TYPES.forEach(m => {
      const opt = doc.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      modTypeSelect.appendChild(opt);
    });

    const modValueInput = doc.createElement('input');
    modValueInput.className = 'kcfg-modifier-value';
    modValueInput.placeholder = '0.00';
    modValueInput.type = 'text';
    modValueInput.inputMode = 'decimal';
    modValueInput.value = '0';
    modValueInput.setAttribute('style', 'width:80px!important;height:38px!important;padding:0 10px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;outline:none!important;text-align:right!important;background:#fff!important;box-sizing:border-box!important;');

    const removeBtn = doc.createElement('button');
    removeBtn.className = 'kcfg-value-remove';
    removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    removeBtn.title = 'Usu\u0144';
    removeBtn.addEventListener('click', () => wrapper.remove());

    // Przycisk zagnieżdżania
    const nestBtn = doc.createElement('button');
    nestBtn.className = 'kcfg-nest-toggle';
    nestBtn.setAttribute('style', 'background:none;border:1px solid #dadce0;border-radius:6px;cursor:pointer;font-size:13px;padding:4px 8px;color:#5f6368;transition:all .15s;white-space:nowrap;font-family:inherit;');
    nestBtn.textContent = '+ Podparametr';
    nestBtn.title = 'Dodaj zagnie\u017cd\u017cony parametr';

    // Panel zagnieżdżonych parametrów
    const nestPanel = doc.createElement('div');
    nestPanel.className = 'kcfg-nest-panel';
    nestPanel.style.cssText = 'display:none;margin:6px 0px 8px 18px;padding:10px 14px;border:1px dashed #c5cae9;border-radius:8px;background:#f5f7ff;';

    const nestList = doc.createElement('div');
    nestList.className = 'kcfg-nest-list';
    nestPanel.appendChild(nestList);

    const addNestBtn = doc.createElement('button');
    addNestBtn.setAttribute('style', 'background:none;border:1px dashed #dadce0;color:#5f6368;cursor:pointer;padding:6px 12px;border-radius:6px;font-size:12px;font-family:inherit;transition:all .15s;width:100%;text-align:center;margin-top:6px;');
    addNestBtn.textContent = '+ Dodaj podparametr';
    addNestBtn.addEventListener('mouseover', () => { addNestBtn.style.borderColor = '#1a73e8'; addNestBtn.style.color = '#1a73e8'; });
    addNestBtn.addEventListener('mouseout', () => { addNestBtn.style.borderColor = '#dadce0'; addNestBtn.style.color = '#5f6368'; });
    addNestBtn.addEventListener('click', () => {
      addNestedParamBlock(doc, nestList);
    });
    nestPanel.appendChild(addNestBtn);

    nestBtn.addEventListener('click', () => {
      if (nestPanel.style.display === 'none') {
        nestPanel.style.display = '';
        nestBtn.style.borderColor = '#1a73e8';
        nestBtn.style.color = '#1a73e8';
        nestBtn.style.background = '#e8f0fe';
        if (!nestList.children.length) addNestedParamBlock(doc, nestList);
        if (!nestList._sortableInit) { makeSortable(nestList); nestList._sortableInit = true; }
      } else {
        nestPanel.style.display = 'none';
        nestBtn.style.borderColor = '#dadce0';
        nestBtn.style.color = '#5f6368';
        nestBtn.style.background = 'none';
      }
    });

    row.appendChild(createDragHandle(doc));
    row.appendChild(nameInput);
    row.appendChild(modTypeSelect);
    row.appendChild(modValueInput);
    row.appendChild(removeBtn);
    row.appendChild(nestBtn);

    wrapper.appendChild(row);
    wrapper.appendChild(nestPanel);
    container.appendChild(wrapper);

    // Autocomplete for value name
    attachAutocomplete(doc, nameInput, (q) => getValueNameSuggestions(doc, paramBlock, q), { openOnEmptyFocus: true });
  }

  // Zagnieżdżony blok parametru — identyczny styl jak główny, bez zagnieżdżania w głąb
  function addNestedParamBlock(doc, listEl) {
    const block = doc.createElement('div');
    block.className = 'kcfg-param-block kcfg-nested-param';

    const header = doc.createElement('div');
    header.className = 'kcfg-param-header';

    const nameInput = doc.createElement('input');
    nameInput.className = 'kcfg-param-name kcfg-nested-param-name';
    nameInput.placeholder = 'Nazwa podparametru';
    nameInput.type = 'text';

    const typeSelect = doc.createElement('select');
    typeSelect.className = 'kcfg-param-type kcfg-nested-param-type';
    typeSelect.setAttribute('style', 'padding:0 10px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;outline:none!important;background:#fff!important;min-width:200px!important;height:38px!important;');
    PARAM_TYPES.forEach(t => {
      const opt = doc.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      typeSelect.appendChild(opt);
    });

    const requiredLabel = doc.createElement('label');
    requiredLabel.className = 'kcfg-param-required';
    requiredLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:#5f6368;cursor:pointer;white-space:nowrap;';
    const switchWrap2 = doc.createElement('span');
    switchWrap2.className = 'kcfg-switch';
    const requiredCb = doc.createElement('input');
    requiredCb.type = 'checkbox';
    requiredCb.checked = true;
    const switchTrack2 = doc.createElement('span');
    switchTrack2.className = 'kcfg-switch-track';
    switchTrack2.innerHTML = '<span class="kcfg-switch-thumb"></span>';
    switchWrap2.appendChild(requiredCb);
    switchWrap2.appendChild(switchTrack2);
    requiredLabel.appendChild(switchWrap2);
    requiredLabel.appendChild(doc.createTextNode('Wymagany'));

    const removeBtn = doc.createElement('button');
    removeBtn.className = 'kcfg-param-remove';
    removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    removeBtn.title = 'Usu\u0144 podparametr';
    removeBtn.addEventListener('click', () => moveParamToUnused(doc, block));

    header.appendChild(createDragHandle(doc));
    header.appendChild(nameInput);
    header.appendChild(typeSelect);
    header.appendChild(requiredLabel);
    header.appendChild(removeBtn);

    // Logika typu (identyczna jak w głównym)
    function updateTypeUI() {
      const type = typeSelect.value;
      const typeInfo = PARAM_TYPES.find(t => t.value === type);
      if (typeInfo?.requiredHidden) {
        requiredLabel.style.display = 'none';
        requiredCb.checked = false;
        requiredCb.disabled = true;
      } else if (typeInfo?.requiredLocked) {
        requiredLabel.style.display = '';
        requiredCb.checked = true;
        requiredCb.disabled = true;
        requiredLabel.style.opacity = '0.6';
        requiredLabel.style.cursor = 'not-allowed';
      } else {
        requiredLabel.style.display = '';
        requiredCb.checked = true;
        requiredCb.disabled = false;
        requiredLabel.style.opacity = '';
        requiredLabel.style.cursor = 'pointer';
      }
      if (valuesContainer) valuesContainer.style.display = type === 'input' ? 'none' : '';
      if (addValueBtn) addValueBtn.style.display = type === 'input' ? 'none' : '';
    }
    typeSelect.addEventListener('change', updateTypeUI);

    const valuesContainer = doc.createElement('div');
    valuesContainer.className = 'kcfg-values-list';

    const addValueBtn = doc.createElement('button');
    addValueBtn.className = 'kcfg-add-value-btn';
    addValueBtn.textContent = '+ Dodaj warto\u015b\u0107';
    addValueBtn.addEventListener('click', () => addNestedValueRow(doc, valuesContainer, block));

    block.appendChild(header);
    block.appendChild(valuesContainer);
    block.appendChild(addValueBtn);
    listEl.appendChild(block);

    // Autocomplete
    attachAutocomplete(doc, nameInput, (q) => getParamNameSuggestions(doc, q));

    // Jedna pusta wartość
    addNestedValueRow(doc, valuesContainer, block);

    updateTypeUI();

    // Sortowanie wartości zagnieżdżonych drag & drop
    makeSortable(valuesContainer);
  }

  // Wiersz wartości w zagnieżdżonym parametrze — identyczny jak główny, bez przycisku podparametrów
  function addNestedValueRow(doc, container, nestedParamBlock) {
    const row = doc.createElement('div');
    row.className = 'kcfg-value-row';

    const nameInput = doc.createElement('input');
    nameInput.className = 'kcfg-value-name kcfg-nested-value-name';
    nameInput.placeholder = 'Nazwa warto\u015bci';
    nameInput.type = 'text';

    const modTypeSelect = doc.createElement('select');
    modTypeSelect.className = 'kcfg-modifier-type';
    modTypeSelect.setAttribute('style', 'padding:0 8px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;outline:none!important;background:#fff!important;width:70px!important;height:38px!important;cursor:pointer;');
    MODIFIER_TYPES.forEach(m => {
      const opt = doc.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      modTypeSelect.appendChild(opt);
    });

    const modValueInput = doc.createElement('input');
    modValueInput.className = 'kcfg-modifier-value';
    modValueInput.type = 'text';
    modValueInput.inputMode = 'decimal';
    modValueInput.value = '0';
    modValueInput.setAttribute('style', 'width:80px!important;height:38px!important;padding:0 10px!important;border:1px solid #dadce0!important;border-radius:6px!important;font-size:13px!important;font-family:inherit!important;outline:none!important;text-align:right!important;background:#fff!important;box-sizing:border-box!important;');

    const removeBtn = doc.createElement('button');
    removeBtn.className = 'kcfg-value-remove';
    removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    removeBtn.title = 'Usu\u0144';
    removeBtn.addEventListener('click', () => row.remove());

    const wrapper = doc.createElement('div');
    wrapper.className = 'kcfg-value-row-wrapper';

    row.appendChild(createDragHandle(doc));
    row.appendChild(nameInput);
    row.appendChild(modTypeSelect);
    row.appendChild(modValueInput);
    row.appendChild(removeBtn);

    wrapper.appendChild(row);
    container.appendChild(wrapper);

    // Autocomplete wartości podparametru
    attachAutocomplete(doc, nameInput, (q) => getValueNameSuggestions(doc, nestedParamBlock, q), { openOnEmptyFocus: true });
  }

  // =========================================================================
  // CSV TAB
  // =========================================================================

  function renderCsvTab(doc, container) {
    container.innerHTML =
      '<div class="kcfg-import-upload" id="kcfg-import-dropzone" style="border:2px dashed #dadce0;border-radius:8px;padding:32px 20px;text-align:center;cursor:pointer;transition:all .15s;background:#fafbfc;">' +
        '<div style="font-size:28px;margin-bottom:8px;opacity:0.5;">&#128206;</div>' +
        '<div style="font-size:14px;font-weight:500;color:#202124;">Przeci\u0105gnij plik lub kliknij aby wybra\u0107</div>' +
        '<div style="font-size:12px;color:#9aa0a6;margin-top:4px;">Obs\u0142ugiwane formaty: CSV, JSON, XML</div>' +
        '<input type="file" accept=".csv,.json,.xml" style="display:none;" id="kcfg-import-file-input">' +
      '</div>' +
      '<div id="kcfg-import-file-info" style="display:none;margin-top:10px;padding:10px 14px;background:#e8f0fe;border-radius:6px;font-size:13px;color:#1a73e8;display:none;align-items:center;gap:8px;">' +
        '<span id="kcfg-import-file-name" style="font-weight:500;"></span>' +
        '<button id="kcfg-import-file-clear" type="button" style="background:none;border:none;color:#5f6368;cursor:pointer;font-size:16px;margin-left:auto;">\u2715</button>' +
      '</div>' +
      '<div id="kcfg-import-preview" style="margin-top:12px;"></div>';

    const dropzone = container.querySelector('#kcfg-import-dropzone');
    const fileInput = container.querySelector('#kcfg-import-file-input');
    const fileInfo = container.querySelector('#kcfg-import-file-info');
    const fileName = container.querySelector('#kcfg-import-file-name');
    const fileClear = container.querySelector('#kcfg-import-file-clear');
    const previewArea = container.querySelector('#kcfg-import-preview');

    let loadedText = '';
    let loadedFilename = '';

    function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        try {
          const result = parseImportFile(text, file.name);
          if (!result.products || result.products.length === 0) {
            previewArea.innerHTML = '<div class="kcfg-info kcfg-info--warning">Nie znaleziono \u017cadnych konfiguracji w pliku.</div>';
            return;
          }
          const configData = result.products[0].configData;
          container._parsedCsvData = configData;
          container._importProducts = result.products;

          // Przełącz na zakładkę Kreator i wypełnij formularz danymi
          const creatorTab = container.closest('#kcfg-tab-content')?.parentElement?.querySelector('.kcfg-tab[data-tab="creator"]');
          if (creatorTab) creatorTab.click();

          // Poczekaj aż kreator się wyrenderuje, potem wypełnij
          setTimeout(() => {
            const tabContent = container.closest('#kcfg-tab-content') || container;
            fillCreatorFromConfig(doc, tabContent, configData);
          }, 100);

          fileName.textContent = file.name + ' \u2014 ' + configData.parameters.length + ' parametr\u00f3w za\u0142adowanych do kreatora';
          fileInfo.style.display = 'flex';
          dropzone.style.display = 'none';
        } catch (err) {
          previewArea.innerHTML = '<div class="kcfg-info kcfg-info--error">B\u0142\u0105d parsowania: ' + err.message + '</div>';
        }
      };
      reader.readAsText(file, 'UTF-8');
    }

    function resetFile() {
      fileInfo.style.display = 'none';
      dropzone.style.display = '';
      previewArea.innerHTML = '';
      container._parsedCsvData = null;
      fileInput.value = '';
    }

    // Click to select
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files.length) handleFile(fileInput.files[0]); });

    // Drag & drop
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.borderColor = '#1a73e8'; dropzone.style.background = '#e8f0fe'; });
    dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = '#dadce0'; dropzone.style.background = '#fafbfc'; });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#dadce0';
      dropzone.style.background = '#fafbfc';
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    // Clear
    fileClear.addEventListener('click', resetFile);
  }

  function normalizeParamType(raw) {
    if (!raw) return 'select';
    const s = raw.toLowerCase().trim();
    if (['select', 'radio', 'checkbox', 'input'].includes(s)) return s;
    if (s.includes('lista') || s.includes('rozwij')) return 'select';
    if (s.includes('jedno')) return 'radio';
    if (s.includes('wielo')) return 'checkbox';
    if (s.includes('tekst') || s.includes('pole')) return 'input';
    return 'select';
  }

  function normalizeBoolean(raw) {
    if (!raw) return true;
    const s = raw.toLowerCase().trim();
    return s === 'tak' || s === 'true' || s === '1' || s === 'yes';
  }

  function normalizeModifierType(raw) {
    if (!raw) return 'amount_add';
    const s = raw.trim();
    if (s === '+' || s === 'amount_add') return 'amount_add';
    if (s === '\u2212' || s === '-' || s === 'amount_sub') return 'amount_sub';
    if (s === '+%' || s === '+ %' || s === 'percent_add') return 'percent_add';
    if (s === '\u2212%' || s === '-%' || s === '\u2212 %' || s === '- %' || s === 'percent_sub') return 'percent_sub';
    return 'amount_add';
  }

  // =========================================================================
  // EXPORT / IMPORT HELPERS
  // =========================================================================

  function convertChildrenToNames(configData) {
    const result = JSON.parse(JSON.stringify(configData));
    result.parameters.forEach(param => {
      param.values.forEach(val => {
        if (val.children && val.children.length > 0) {
          val.children = val.children.map(idx => {
            const childParam = result.parameters[idx];
            return childParam ? childParam.name : null;
          }).filter(Boolean);
        } else {
          delete val.children;
        }
        delete val.id;
      });
      delete param.id;
    });
    return result;
  }

  function convertNamesToChildren(configData) {
    const nameToIdx = {};
    configData.parameters.forEach((p, idx) => { nameToIdx[p.name] = idx; });

    configData.parameters.forEach(param => {
      param.values.forEach(val => {
        const names = val._childrenNames || val.children;
        if (names && names.length > 0 && typeof names[0] === 'string') {
          val.children = names.map(name => nameToIdx[name]).filter(idx => idx !== undefined);
        }
        delete val._childrenNames;
      });
    });
    return configData;
  }

  // =========================================================================
  // EXPORT — serialization
  // =========================================================================

  function serializeToJson(products, metadata) {
    const hasLang = metadata && metadata.languages && metadata.languages.length > 0;

    const exportProducts = products.map(p => {
      const allParams = p.parameters;
      const childIdxs = new Set();
      allParams.forEach(param => {
        param.values.forEach(val => {
          (val.children || []).forEach(c => {
            if (typeof c === 'string') {
              const idx = allParams.findIndex(pp => pp.name === c);
              if (idx >= 0) childIdxs.add(idx);
            }
          });
        });
      });

      const rootParams = allParams.filter((_, i) => !childIdxs.has(i));
      const nameToParam = {};
      allParams.forEach(param => { nameToParam[param.name] = param; });

      function buildValueObj(val) {
        const v = { name: val.name, modifierType: val.modifierType, modifierValue: val.modifierValue };
        if (hasLangDataContent(val.langData)) v.langData = val.langData;
        return v;
      }

      const result = {
        productId: p.productId,
        parameters: rootParams.map(param => {
          const pObj = { name: param.name, type: param.type, required: param.required };
          if (hasLangDataContent(param.langData)) pObj.langData = param.langData;
          pObj.values = param.values.map(val => {
            const v = buildValueObj(val);
            if (val.children && val.children.length > 0) {
              v.children = val.children.map(childName => {
                const cp = nameToParam[childName];
                if (!cp) return null;
                const childObj = { name: cp.name, type: cp.type, required: cp.required };
                if (hasLangDataContent(cp.langData)) childObj.langData = cp.langData;
                childObj.values = cp.values.map(cv => buildValueObj(cv));
                return childObj;
              }).filter(Boolean);
            }
            return v;
          });
          return pObj;
        }),
      };
      if (p.unusedParameters && p.unusedParameters.length > 0) {
        result.unusedParameters = p.unusedParameters;
      }
      return result;
    });

    const envelope = {
      format: 'idosell-configurator',
      version: hasLang ? '3.0' : '2.0',
      exportDate: new Date().toISOString(),
    };
    if (hasLang) {
      envelope.languages = metadata.languages;
      envelope.shops = metadata.shops || [];
    }
    envelope.products = exportProducts;

    return JSON.stringify(envelope, null, 2);
  }

  function escapeXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function serializeToXml(products, metadata) {
    const hasLang = metadata && metadata.languages && metadata.languages.length > 0;
    const childIdxsOf = (params) => {
      const s = new Set();
      params.forEach(param => param.values.forEach(val => (val.children || []).forEach(c => {
        if (typeof c === 'string') { const i = params.findIndex(pp => pp.name === c); if (i >= 0) s.add(i); }
      })));
      return s;
    };
    const nameToParamOf = (params) => { const m = {}; params.forEach(p => { m[p.name] = p; }); return m; };

    function langDataToXml(langData, indent) {
      if (!hasLangDataContent(langData)) return '';
      let xml = indent + '<langData>\n';
      for (const [lang, ld] of Object.entries(langData)) {
        if (!ld.description && !ld.graphics) continue;
        const hasGfx = ld.graphics && Object.keys(ld.graphics).length > 0;
        xml += indent + '  <lang code="' + escapeXml(lang) + '"';
        if (ld.name) xml += ' name="' + escapeXml(ld.name) + '"';
        if (ld.description) xml += ' description="' + escapeXml(ld.description) + '"';
        if (hasGfx) {
          xml += '>\n';
          for (const [shopId, gfx] of Object.entries(ld.graphics)) {
            xml += indent + '    <graphic shopId="' + escapeXml(shopId) + '"';
            if (gfx.iconProjector) xml += ' iconProjector="' + escapeXml(gfx.iconProjector) + '"';
            if (gfx.iconSearch) xml += ' iconSearch="' + escapeXml(gfx.iconSearch) + '"';
            if (gfx.iconProjectorType) xml += ' iconProjectorType="' + escapeXml(gfx.iconProjectorType) + '"';
            xml += '/>\n';
          }
          xml += indent + '  </lang>\n';
        } else {
          xml += '/>\n';
        }
      }
      xml += indent + '</langData>\n';
      return xml;
    }

    function paramToXml(param, nameToParam, indent) {
      let xml = indent + '<parameter name="' + escapeXml(param.name) + '" type="' + escapeXml(param.type) + '" required="' + (param.required ? 'true' : 'false') + '">\n';
      xml += langDataToXml(param.langData, indent + '  ');
      param.values.forEach(val => {
        const hasChildren = val.children && val.children.length > 0;
        const hasValLang = hasLangDataContent(val.langData);
        xml += indent + '  <value name="' + escapeXml(val.name) + '" modifierType="' + escapeXml(val.modifierType) + '" modifierValue="' + escapeXml(val.modifierValue) + '"';
        if (hasChildren || hasValLang) {
          xml += '>\n';
          xml += langDataToXml(val.langData, indent + '    ');
          if (hasChildren) {
            xml += indent + '    <children>\n';
            val.children.forEach(childName => {
              const cp = nameToParam[childName];
              if (cp) xml += paramToXml(cp, {}, indent + '      ');
            });
            xml += indent + '    </children>\n';
          }
          xml += indent + '  </value>\n';
        } else {
          xml += '/>\n';
        }
      });
      xml += indent + '</parameter>\n';
      return xml;
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<configuratorExport format="idosell-configurator" version="' + (hasLang ? '3.0' : '2.0') + '" exportDate="' + escapeXml(new Date().toISOString()) + '">\n';

    if (hasLang) {
      xml += '  <languages>\n';
      metadata.languages.forEach(l => { xml += '    <language code="' + escapeXml(l) + '"/>\n'; });
      xml += '  </languages>\n';
      xml += '  <shops>\n';
      (metadata.shops || []).forEach(s => { xml += '    <shop id="' + escapeXml(s.id) + '" name="' + escapeXml(s.name) + '"/>\n'; });
      xml += '  </shops>\n';
    }

    products.forEach(p => {
      const params = p.parameters;
      const childIdxs = childIdxsOf(params);
      const nameToParam = nameToParamOf(params);
      const rootParams = params.filter((_, i) => !childIdxs.has(i));

      xml += '  <product productId="' + escapeXml(p.productId) + '">\n';
      rootParams.forEach(param => { xml += paramToXml(param, nameToParam, '    '); });
      if (p.unusedParameters && p.unusedParameters.length > 0) {
        xml += '    <unusedParameters>\n';
        p.unusedParameters.forEach(up => { xml += paramToXml(up, {}, '      '); });
        xml += '    </unusedParameters>\n';
      }
      xml += '  </product>\n';
    });

    xml += '</configuratorExport>';
    return xml;
  }

  function escapeCsvField(val) {
    const s = String(val);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function serializeToCsv(products, metadata) {
    const BOM = '\uFEFF';
    const modSym = (mt) => {
      if (mt === 'amount_add') return '+';
      if (mt === 'amount_sub') return '\u2212';
      if (mt === 'percent_add') return '+%';
      if (mt === 'percent_sub') return '\u2212%';
      return '+';
    };
    const e = escapeCsvField;

    // Scan all data to discover which langData columns have content
    const extraCols = []; // { header, getParamVal(param), getValueVal(val) }
    const usedParamDescLangs = new Set();
    const usedParamGfxKeys = new Set(); // "lang:shopId:type"
    const usedValDescLangs = new Set();
    const usedValGfxKeys = new Set();

    products.forEach(p => {
      p.parameters.forEach(param => {
        if (param.langData) {
          for (const [lang, ld] of Object.entries(param.langData)) {
            if (ld.description) usedParamDescLangs.add(lang);
            if (ld.graphics) {
              for (const [shopId, gfx] of Object.entries(ld.graphics)) {
                if (gfx.iconProjector) usedParamGfxKeys.add(lang + ':' + shopId + ':projector');
                if (gfx.iconSearch) usedParamGfxKeys.add(lang + ':' + shopId + ':search');
                if (gfx.iconProjectorType) usedParamGfxKeys.add(lang + ':' + shopId + ':type');
              }
            }
          }
        }
        param.values.forEach(val => {
          if (!val.langData) return;
          for (const [lang, ld] of Object.entries(val.langData)) {
            if (ld.description) usedValDescLangs.add(lang);
            if (ld.graphics) {
              for (const [shopId, gfx] of Object.entries(ld.graphics)) {
                if (gfx.iconProjector) usedValGfxKeys.add(lang + ':' + shopId + ':projector');
                if (gfx.iconSearch) usedValGfxKeys.add(lang + ':' + shopId + ':search');
                if (gfx.iconProjectorType) usedValGfxKeys.add(lang + ':' + shopId + ':type');
              }
            }
          }
        });
      });
    });

    // Build ordered extra column definitions
    const sortedLangs = metadata?.languages || [...new Set([...usedParamDescLangs, ...usedValDescLangs])].sort();
    const sortLangShopType = (keys) => [...keys].sort((a, b) => a.localeCompare(b));

    // param_opis columns
    const paramDescCols = sortedLangs.filter(l => usedParamDescLangs.has(l)).map(lang => ({
      header: 'param_opis:' + lang,
      getParam: (param) => param.langData?.[lang]?.description || '',
      getValue: () => '',
    }));
    // param_gfx columns
    const paramGfxCols = sortLangShopType(usedParamGfxKeys).map(key => {
      const [lang, shopId, gfxType] = key.split(':');
      return {
        header: 'param_gfx:' + key,
        getParam: (param) => {
          const gfx = param.langData?.[lang]?.graphics?.[shopId];
          if (!gfx) return '';
          if (gfxType === 'projector') return gfx.iconProjector || '';
          if (gfxType === 'search') return gfx.iconSearch || '';
          if (gfxType === 'type') return gfx.iconProjectorType || '';
          return '';
        },
        getValue: () => '',
      };
    });
    // wartość_opis columns
    const valDescCols = sortedLangs.filter(l => usedValDescLangs.has(l)).map(lang => ({
      header: 'warto\u015b\u0107_opis:' + lang,
      getParam: () => '',
      getValue: (val) => val.langData?.[lang]?.description || '',
    }));
    // wartość_gfx columns
    const valGfxCols = sortLangShopType(usedValGfxKeys).map(key => {
      const [lang, shopId, gfxType] = key.split(':');
      return {
        header: 'warto\u015b\u0107_gfx:' + key,
        getParam: () => '',
        getValue: (val) => {
          const gfx = val.langData?.[lang]?.graphics?.[shopId];
          if (!gfx) return '';
          if (gfxType === 'projector') return gfx.iconProjector || '';
          if (gfxType === 'search') return gfx.iconSearch || '';
          if (gfxType === 'type') return gfx.iconProjectorType || '';
          return '';
        },
      };
    });

    const allExtraCols = [...paramDescCols, ...paramGfxCols, ...valDescCols, ...valGfxCols];
    const hasExtra = allExtraCols.length > 0;

    // Header
    const baseH = 'productId;order;parametr;typ;wymagany;warto\u015b\u0107;modyfikator;kwota;\u21b3 pod_warto\u015bci\u0105;\u21b3 order;\u21b3 parametr;\u21b3 typ;\u21b3 wymagany;\u21b3 warto\u015b\u0107;\u21b3 modyfikator;\u21b3 kwota';
    const extraH = allExtraCols.map(c => c.header).join(';');
    let csv = BOM + baseH + (hasExtra ? ';' + extraH : '') + '\n';

    const EMPTY8 = ';;;;;;;';
    const emptyExtra = hasExtra ? ';' + allExtraCols.map(() => '').join(';') : '';

    function extraFields(param, val, isFirstValue) {
      if (!hasExtra) return '';
      return ';' + allExtraCols.map(col => {
        const pVal = isFirstValue ? col.getParam(param) : '';
        const vVal = val ? col.getValue(val) : '';
        return e(pVal || vVal);
      }).join(';');
    }

    products.forEach(p => {
      const params = p.parameters;
      const nameToParam = {};
      params.forEach(param => { nameToParam[param.name] = param; });
      const childNames = new Set();
      params.forEach(param => {
        param.values.forEach(val => {
          (val.children || []).forEach(childName => childNames.add(childName));
        });
      });
      const rootParams = params.filter(param => !childNames.has(param.name));

      rootParams.forEach((param, oi) => {
        const order = oi + 1;

        if (param.values.length === 0) {
          // Input param without values
          csv += [e(p.productId), order, e(param.name), e(param.type), param.required ? 'tak' : 'nie', '', '', ''].join(';') + ';' + EMPTY8 + extraFields(param, null, true) + '\n';
          return;
        }

        param.values.forEach((val, vi) => {
          csv += [
            e(p.productId), order,
            vi === 0 ? e(param.name) : '', vi === 0 ? e(param.type) : '',
            vi === 0 ? (param.required ? 'tak' : 'nie') : '',
            e(val.name), modSym(val.modifierType), e(val.modifierValue),
          ].join(';') + ';' + EMPTY8 + extraFields(param, val, vi === 0) + '\n';

          // Nested children
          if (val.children && val.children.length > 0) {
            val.children.forEach(childName => {
              const cp = nameToParam[childName];
              if (!cp) return;
              const childOrder = params.indexOf(cp) + 1;
              if (cp.values.length === 0) {
                csv += e(p.productId) + ';;;;;;;;' + [e(val.name), childOrder, e(cp.name), e(cp.type), cp.required ? 'tak' : 'nie', '', '', ''].join(';') + emptyExtra + '\n';
              } else {
                cp.values.forEach((cv, cvi) => {
                  csv += e(p.productId) + ';;;;;;;;' + [
                    e(val.name), childOrder,
                    cvi === 0 ? e(cp.name) : '', cvi === 0 ? e(cp.type) : '',
                    cvi === 0 ? (cp.required ? 'tak' : 'nie') : '',
                    e(cv.name), modSym(cv.modifierType), e(cv.modifierValue),
                  ].join(';') + emptyExtra + '\n';
                });
              }
            });
          }
        });
      });

      // Unused params
      if (p.unusedParameters && p.unusedParameters.length > 0) {
        p.unusedParameters.forEach(up => {
          if (!up.values || up.values.length === 0) {
            csv += [e(p.productId), 'unused', e(up.name), e(up.type), up.required ? 'tak' : 'nie', '', '', ''].join(';') + ';' + EMPTY8 + emptyExtra + '\n';
          } else {
            up.values.forEach((val, vi) => {
              csv += [
                e(p.productId), 'unused',
                vi === 0 ? e(up.name) : '', vi === 0 ? e(up.type) : '', vi === 0 ? (up.required ? 'tak' : 'nie') : '',
                e(val.name), modSym(val.modifierType), e(val.modifierValue),
              ].join(';') + ';' + EMPTY8 + emptyExtra + '\n';
            });
          }
        });
      }
    });

    return csv;
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // =========================================================================
  // EXPORT — modal & execution
  // =========================================================================

  function showExportModal(doc, selectedProductIds) {
    const { body, footer } = createModal(doc, 'Eksport konfiguratora', selectedProductIds.length);

    body.innerHTML =
      '<div class="kcfg-tiles" style="grid-template-columns: 1fr 1fr 1fr;">' +
        '<div class="kcfg-tile" data-format="json">' +
          '<div class="kcfg-tile-icon" style="font-family:monospace;font-size:28px;">{ }</div>' +
          '<div class="kcfg-tile-title">JSON</div>' +
          '<div class="kcfg-tile-desc">Uniwersalny format danych</div>' +
        '</div>' +
        '<div class="kcfg-tile" data-format="xml">' +
          '<div class="kcfg-tile-icon" style="font-family:monospace;font-size:28px;">&lt;/&gt;</div>' +
          '<div class="kcfg-tile-title">XML</div>' +
          '<div class="kcfg-tile-desc">Kompatybilny z zewn\u0119trznymi systemami</div>' +
        '</div>' +
        '<div class="kcfg-tile" data-format="csv">' +
          '<div class="kcfg-tile-icon">\ud83d\udcca</div>' +
          '<div class="kcfg-tile-title">CSV</div>' +
          '<div class="kcfg-tile-desc">Edytowalny w Excelu</div>' +
        '</div>' +
      '</div>' +
      '<div class="kcfg-options" style="margin-top:16px;">' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;">' +
          '<span class="kcfg-switch"><input type="checkbox" id="kcfg-export-all-params"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span>' +
          'Eksportuj wszystkie parametry konfiguracyjne (tak\u017ce nieu\u017cywane w drzewie)' +
        '</label></div>' +
        '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;">' +
          '<span class="kcfg-switch"><input type="checkbox" id="kcfg-export-langdata" checked><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span>' +
          'Eksportuj opisy i grafiki parametr\u00f3w' +
        '</label></div>' +
      '</div>';

    footer.innerHTML = '<button class="kcfg-btn-secondary" id="kcfg-cancel">Anuluj</button>';
    footer.querySelector('#kcfg-cancel').addEventListener('click', () => closeModal(doc));

    ['json', 'xml', 'csv'].forEach(fmt => {
      body.querySelector('[data-format="' + fmt + '"]').addEventListener('click', () => {
        const includeUnused = body.querySelector('#kcfg-export-all-params').checked;
        const includeLangData = body.querySelector('#kcfg-export-langdata').checked;
        executeExport(doc, selectedProductIds, fmt, body, footer, includeUnused, includeLangData);
      });
    });
  }

  async function executeExport(doc, selectedProductIds, format, body, footer, includeUnused, includeLangData) {
    const abortController = new AbortController();
    const signal = abortController.signal;

    body.innerHTML = '<div style="padding:20px;">' +
      '<div class="kcfg-progress-text" id="kcfg-prog-text">Pobieranie konfigurator\u00f3w...</div>' +
      '<div class="kcfg-progress" style="height:20px;margin-top:12px;"><div class="kcfg-progress-fill" id="kcfg-prog-bar"></div></div>' +
      '</div>';

    footer.innerHTML = '<button class="kcfg-btn-stop" id="kcfg-stop">Stop</button>';
    footer.querySelector('#kcfg-stop').addEventListener('click', () => abortController.abort());

    const statusText = body.querySelector('#kcfg-prog-text');
    const barInner = body.querySelector('#kcfg-prog-bar');

    // Fetch metadata if langData enabled
    let metadata = null;
    if (includeLangData && selectedProductIds.length > 0) {
      try {
        metadata = await fetchLanguagesAndShops(selectedProductIds[0]);
      } catch (_) { metadata = { languages: [], shops: [], origin: getPanelOrigin() }; }
    }

    const exportProducts = [];
    const results = { success: 0, errors: [], total: selectedProductIds.length, aborted: false };

    for (let i = 0; i < selectedProductIds.length; i++) {
      if (signal.aborted) { results.aborted = true; break; }

      const productId = selectedProductIds[i];
      statusText.textContent = 'Pobieranie (' + (i + 1) + '/' + selectedProductIds.length + ') towar #' + productId + '...';
      barInner.style.width = Math.round(((i + 1) / selectedProductIds.length) * 100) + '%';

      try {
        const configData = await fetchConfiguratorData(productId, null, includeLangData);
        if (!configData || configData.parameters.length === 0) {
          results.errors.push({ id: 'Towar #' + productId, error: 'Brak konfiguratora' });
          continue;
        }

        const exportData = convertChildrenToNames(configData);
        const product = {
          productId: productId,
          parameters: exportData.parameters,
        };
        if (includeUnused && configData.unusedParameters && configData.unusedParameters.length > 0) {
          product.unusedParameters = configData.unusedParameters.map(p => ({
            name: p.name, type: p.type, required: p.required,
            values: (p.values || []).map(v => ({ name: v.name, modifierType: v.modifierType, modifierValue: v.modifierValue })),
          }));
        }
        exportProducts.push(product);
        results.success++;
      } catch (e) {
        results.errors.push({ id: 'Towar #' + productId, error: e.message });
      }

      if (i < selectedProductIds.length - 1) await sleep(300);
    }

    if (exportProducts.length > 0 && !results.aborted) {
      let content, filename, mimeType;
      const timestamp = new Date().toISOString().slice(0, 10);

      if (format === 'json') {
        content = serializeToJson(exportProducts, metadata);
        filename = 'konfigurator_' + timestamp + '.json';
        mimeType = 'application/json;charset=utf-8';
      } else if (format === 'xml') {
        content = serializeToXml(exportProducts, metadata);
        filename = 'konfigurator_' + timestamp + '.xml';
        mimeType = 'application/xml;charset=utf-8';
      } else {
        content = serializeToCsv(exportProducts, metadata);
        filename = 'konfigurator_' + timestamp + '.csv';
        mimeType = 'text/csv;charset=utf-8';
      }

      triggerDownload(content, filename, mimeType);
    }

    showExecutionResults(doc, body, footer, results, 'Eksport zako\u0144czony');
  }

  // =========================================================================
  // IMPORT — deserialization
  // =========================================================================

  function parseImportFile(text, filename) {
    const ext = (filename || '').split('.').pop().toLowerCase();

    if (ext === 'json' || (!ext && text.trim().startsWith('{'))) {
      return parseImportJson(text);
    } else if (ext === 'xml' || (!ext && text.trim().startsWith('<'))) {
      return parseImportXml(text);
    } else {
      return parseImportCsv(text);
    }
  }

  function parseImportJson(text) {
    const data = JSON.parse(text);
    if (!data.products || !Array.isArray(data.products)) {
      throw new Error('Nieprawid\u0142owy format JSON \u2014 brak tablicy "products"');
    }

    const products = data.products.map(p => {
      const flatParams = [];

      function parseParam(param) {
        const paramIdx = flatParams.length;
        const paramObj = {
          name: param.name,
          type: normalizeParamType(param.type),
          required: param.required !== false,
          values: [],
        };
        if (param.langData) paramObj.langData = param.langData;
        flatParams.push(paramObj);

        (param.values || []).forEach(v => {
          const valObj = {
            id: '',
            name: v.name,
            modifierType: normalizeModifierType(v.modifierType || 'amount_add'),
            modifierValue: String(v.modifierValue || '0'),
            children: [],
          };
          if (v.langData) valObj.langData = v.langData;

          // children jako obiekty inline (v2.0/v3.0) lub nazwy string (v1.0)
          if (v.children && v.children.length > 0) {
            v.children.forEach(child => {
              if (typeof child === 'object' && child.name) {
                const childIdx = flatParams.length;
                parseParam(child);
                valObj.children.push(childIdx);
              } else if (typeof child === 'string') {
                valObj._childrenNames = valObj._childrenNames || [];
                valObj._childrenNames.push(child);
              }
            });
          }

          paramObj.values.push(valObj);
        });
      }

      (p.parameters || []).forEach(param => parseParam(param));

      const configData = { parameters: flatParams };
      // Resolve v1.0 string children names
      convertNamesToChildren(configData);
      if (p.unusedParameters && p.unusedParameters.length > 0) {
        configData.unusedParameters = p.unusedParameters;
      }
      return {
        productId: String(p.productId || ''),
        name: p.name || p.productName || '',
        configData,
      };
    });

    return { products };
  }

  function parseLangDataXml(langDataEl) {
    const ld = {};
    langDataEl.querySelectorAll('lang').forEach(langEl => {
      const code = langEl.getAttribute('code');
      if (!code) return;
      const entry = {};
      if (langEl.getAttribute('name')) entry.name = langEl.getAttribute('name');
      if (langEl.getAttribute('description')) entry.description = langEl.getAttribute('description');
      const graphics = {};
      langEl.querySelectorAll('graphic').forEach(gfxEl => {
        const shopId = gfxEl.getAttribute('shopId');
        if (!shopId) return;
        const gfx = {};
        if (gfxEl.getAttribute('iconProjector')) gfx.iconProjector = gfxEl.getAttribute('iconProjector');
        if (gfxEl.getAttribute('iconSearch')) gfx.iconSearch = gfxEl.getAttribute('iconSearch');
        if (gfxEl.getAttribute('iconProjectorType')) gfx.iconProjectorType = gfxEl.getAttribute('iconProjectorType');
        if (Object.keys(gfx).length) graphics[shopId] = gfx;
      });
      if (Object.keys(graphics).length) entry.graphics = graphics;
      ld[code] = entry;
    });
    return Object.keys(ld).length ? ld : undefined;
  }

  function parseImportXml(text) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');

    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) throw new Error('B\u0142\u0105d parsowania XML');

    const productEls = xmlDoc.querySelectorAll('product');
    if (productEls.length === 0) throw new Error('Brak element\u00f3w <product> w pliku XML');

    const products = [];
    productEls.forEach(prodEl => {
      const productId = prodEl.getAttribute('productId') || '';
      const productName = prodEl.getAttribute('name') || prodEl.getAttribute('productName') || '';
      const flatParams = [];

      function parseParamEl(paramEl) {
        const paramIdx = flatParams.length;
        const paramObj = {
          name: paramEl.getAttribute('name') || '',
          type: normalizeParamType(paramEl.getAttribute('type')),
          required: paramEl.getAttribute('required') !== 'false',
          values: [],
        };
        // Parse langData for parameter
        const paramLangDataEl = Array.from(paramEl.children).find(el => el.tagName === 'langData');
        if (paramLangDataEl) paramObj.langData = parseLangDataXml(paramLangDataEl);
        flatParams.push(paramObj);

        Array.from(paramEl.children).filter(el => el.tagName === 'value').forEach(valEl => {
          const valObj = {
            id: '',
            name: valEl.getAttribute('name') || '',
            modifierType: normalizeModifierType(valEl.getAttribute('modifierType') || 'amount_add'),
            modifierValue: valEl.getAttribute('modifierValue') || '0',
            children: [],
          };
          // Parse langData for value
          const valLangDataEl = Array.from(valEl.children).find(el => el.tagName === 'langData');
          if (valLangDataEl) valObj.langData = parseLangDataXml(valLangDataEl);

          const childrenEl = valEl.querySelector('children');
          if (childrenEl) {
            Array.from(childrenEl.children).forEach(childEl => {
              if (childEl.tagName === 'parameter') {
                const childIdx = flatParams.length;
                parseParamEl(childEl);
                valObj.children.push(childIdx);
              } else if (childEl.tagName === 'child') {
                valObj._childrenNames = valObj._childrenNames || [];
                valObj._childrenNames.push(childEl.textContent.trim());
              }
            });
          }

          paramObj.values.push(valObj);
        });
      }

      // Parsuj tylko top-level <parameter> (bezpo\u015brednie dzieci <product>)
      Array.from(prodEl.children).filter(el => el.tagName === 'parameter').forEach(paramEl => parseParamEl(paramEl));

      const configData = { parameters: flatParams };
      convertNamesToChildren(configData);

      // Parsuj <unusedParameters>
      const unusedEl = prodEl.querySelector('unusedParameters');
      if (unusedEl) {
        configData.unusedParameters = [];
        Array.from(unusedEl.children).filter(el => el.tagName === 'parameter').forEach(paramEl => {
          const up = {
            name: paramEl.getAttribute('name') || '',
            type: normalizeParamType(paramEl.getAttribute('type')),
            required: paramEl.getAttribute('required') !== 'false',
            values: [],
          };
          Array.from(paramEl.children).filter(el => el.tagName === 'value').forEach(valEl => {
            up.values.push({
              name: valEl.getAttribute('name') || '',
              modifierType: normalizeModifierType(valEl.getAttribute('modifierType') || 'amount_add'),
              modifierValue: valEl.getAttribute('modifierValue') || '0',
            });
          });
          configData.unusedParameters.push(up);
        });
      }

      products.push({ productId, name: productName, configData });
    });

    return { products };
  }

  function parseCsvLine(line, sep) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === sep) {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  function parseImportCsv(text) {
    // Remove BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
    if (lines.length === 0) throw new Error('Pusty plik CSV');

    const sep = lines[0].includes(';') ? ';' : ',';

    // Detect format: new (16-col) or old (8-col)
    const firstFields = parseCsvLine(lines[0], sep);
    let startLine = 0;
    if (firstFields[0].toLowerCase() === 'productid' || (firstFields[1] && (firstFields[1].toLowerCase() === 'parametr' || firstFields[1].toLowerCase() === 'order'))) {
      startLine = 1;
    }

    const isNewFormat = firstFields.length >= 16 ||
      (firstFields.length >= 9 && firstFields[8] && firstFields[8].toLowerCase().includes('pod_warto'));

    // Parse extra langData column headers (cols 16+)
    const langColMap = []; // [{colIdx, target:'param'|'value', field:'desc'|'gfx', lang, shopId?, gfxType?}]
    if (startLine > 0) {
      for (let ci = 16; ci < firstFields.length; ci++) {
        const h = firstFields[ci].trim();
        const pdm = h.match(/^param_opis:(\w+)$/);
        if (pdm) { langColMap.push({ colIdx: ci, target: 'param', field: 'desc', lang: pdm[1] }); continue; }
        const pgm = h.match(/^param_gfx:(\w+):(\w+):(\w+)$/);
        if (pgm) { langColMap.push({ colIdx: ci, target: 'param', field: 'gfx', lang: pgm[1], shopId: pgm[2], gfxType: pgm[3] }); continue; }
        const vdm = h.match(/^warto.+_opis:(\w+)$/);
        if (vdm) { langColMap.push({ colIdx: ci, target: 'value', field: 'desc', lang: vdm[1] }); continue; }
        const vgm = h.match(/^warto.+_gfx:(\w+):(\w+):(\w+)$/);
        if (vgm) { langColMap.push({ colIdx: ci, target: 'value', field: 'gfx', lang: vgm[1], shopId: vgm[2], gfxType: vgm[3] }); continue; }
      }
    }

    if (isNewFormat) {
      return parseImportCsvNew(lines, startLine, sep, langColMap);
    }
    return parseImportCsvLegacy(lines, startLine, sep);
  }

  // Parser starego formatu (8 kolumn): productId;parametr;typ;wymagany;wartosc;mod;kwota;zagniezdzone
  function parseImportCsvLegacy(lines, startLine, sep) {
    const productMap = {};
    const productOrder = [];

    for (let i = startLine; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i], sep);
      if (fields.length < 5) continue;

      const productId = fields[0] ? fields[0].trim() : '';
      const paramName = fields[1] ? fields[1].trim() : '';
      const paramType = fields[2] ? fields[2].trim() : '';
      const required = fields[3] ? fields[3].trim() : '';
      const valueName = fields[4] ? fields[4].trim() : '';
      const modTypRaw = fields[5] ? fields[5].trim() : '';
      const modValue = fields[6] ? fields[6].trim() : '';
      const nested = fields[7] ? fields[7].trim() : '';

      if (!productId || !paramName || !valueName) continue;

      if (!productMap[productId]) {
        productMap[productId] = { paramsMap: {}, paramOrder: [] };
        productOrder.push(productId);
      }

      const prod = productMap[productId];
      if (!prod.paramsMap[paramName]) {
        prod.paramsMap[paramName] = {
          name: paramName, type: normalizeParamType(paramType),
          required: normalizeBoolean(required), values: [],
        };
        prod.paramOrder.push(paramName);
      }

      const childrenNames = nested ? nested.split('|').map(s => s.trim()).filter(Boolean) : [];
      prod.paramsMap[paramName].values.push({
        id: '', name: valueName,
        modifierType: normalizeModifierType(modTypRaw || '+'),
        modifierValue: modValue || '0', _childrenNames: childrenNames,
      });
    }

    const products = productOrder.map(pid => {
      const prod = productMap[pid];
      const configData = { parameters: prod.paramOrder.map(n => prod.paramsMap[n]) };
      convertNamesToChildren(configData);
      return { productId: pid, configData };
    });
    return { products };
  }

  // Parser nowego formatu (16 kolumn): productId;order;parametr;typ;wymagany;warto\u015b\u0107;mod;kwota; \u21b3pod;...
  function parseImportCsvNew(lines, startLine, sep, langColMap) {
    const productMap = {};
    const productOrder = [];

    // Stan parsera: ostatni aktywny parametr i warto\u015b\u0107 root per produkt
    let lastRootParam = {};  // productId -> paramName
    let lastRootValue = {};  // productId -> valueName
    let lastNestedParam = {}; // productId -> paramName

    function applyLangCols(f, paramObj, valObj) {
      if (!langColMap || langColMap.length === 0) return;
      for (const col of langColMap) {
        const v = (f[col.colIdx] || '').trim();
        if (!v) continue;
        const target = col.target === 'param' ? paramObj : col.target === 'value' ? valObj : null;
        if (!target) continue;
        if (!target.langData) target.langData = {};
        if (!target.langData[col.lang]) target.langData[col.lang] = {};
        if (col.field === 'desc') {
          target.langData[col.lang].description = v;
        } else if (col.field === 'gfx') {
          if (!target.langData[col.lang].graphics) target.langData[col.lang].graphics = {};
          if (!target.langData[col.lang].graphics[col.shopId]) target.langData[col.lang].graphics[col.shopId] = {};
          if (col.gfxType === 'projector') target.langData[col.lang].graphics[col.shopId].iconProjector = v;
          else if (col.gfxType === 'search') target.langData[col.lang].graphics[col.shopId].iconSearch = v;
          else if (col.gfxType === 'type') target.langData[col.lang].graphics[col.shopId].iconProjectorType = v;
        }
      }
    }

    for (let i = startLine; i < lines.length; i++) {
      const f = parseCsvLine(lines[i], sep);
      if (f.length < 8) continue;

      const productId = (f[0] || '').trim();
      if (!productId) continue;

      if (!productMap[productId]) {
        productMap[productId] = { paramsMap: {}, paramOrder: [], nestingMap: {}, unusedParams: {}, unusedOrder: [] };
        productOrder.push(productId);
      }
      const prod = productMap[productId];

      // Sprawdź czy to nieużywany parametr (order=unused)
      const lOrder = (f[1] || '').trim();
      if (lOrder === 'unused') {
        const uName = (f[2] || '').trim() || prod._lastUnusedParam || '';
        if (f[2]?.trim()) prod._lastUnusedParam = uName;
        if (uName) {
          if (!prod.unusedParams[uName]) {
            prod.unusedParams[uName] = { name: uName, type: normalizeParamType((f[3] || '').trim()), required: normalizeBoolean((f[4] || '').trim()), values: [] };
            prod.unusedOrder.push(uName);
          }
          const uVal = (f[5] || '').trim();
          if (uVal) {
            prod.unusedParams[uName].values.push({ name: uVal, modifierType: normalizeModifierType((f[6] || '').trim()), modifierValue: (f[7] || '').trim() || '0' });
          }
        }
        continue;
      }

      // Lewa strona (kolumny 1-7): root parametry
      const lParamName = (f[2] || '').trim();
      const lType = (f[3] || '').trim();
      const lRequired = (f[4] || '').trim();
      const lValue = (f[5] || '').trim();
      const lMod = (f[6] || '').trim();
      const lAmount = (f[7] || '').trim();

      // Prawa strona (kolumny 8-15): zagnie\u017cd\u017cone
      const rParentVal = f.length > 8 ? (f[8] || '').trim() : '';
      const rParamName = f.length > 10 ? (f[10] || '').trim() : '';
      const rType = f.length > 11 ? (f[11] || '').trim() : '';
      const rRequired = f.length > 12 ? (f[12] || '').trim() : '';
      const rValue = f.length > 13 ? (f[13] || '').trim() : '';
      const rMod = f.length > 14 ? (f[14] || '').trim() : '';
      const rAmount = f.length > 15 ? (f[15] || '').trim() : '';

      const isRightSide = rParentVal || rParamName || rValue;

      if (!isRightSide && (lParamName || lValue)) {
        // === WIERSZ LEWEJ STRONY: root parametr / warto\u015b\u0107 ===
        const pName = lParamName || lastRootParam[productId] || '';
        if (!pName) continue;

        if (lParamName) lastRootParam[productId] = lParamName;

        if (!prod.paramsMap[pName]) {
          prod.paramsMap[pName] = {
            name: pName, type: normalizeParamType(lType || 'select'),
            required: normalizeBoolean(lRequired), values: [],
          };
          prod.paramOrder.push(pName);
        } else if (lType) {
          prod.paramsMap[pName].type = normalizeParamType(lType);
        }

        if (lValue) {
          const newVal = {
            id: '', name: lValue,
            modifierType: normalizeModifierType(lMod || '+'),
            modifierValue: lAmount || '0', children: [],
          };
          prod.paramsMap[pName].values.push(newVal);
          lastRootValue[productId] = lValue;
          // Apply langData from extra columns (param on first value row, value always)
          applyLangCols(f, lParamName ? prod.paramsMap[pName] : null, newVal);
        } else if (lParamName) {
          // Param-only row (e.g. input type without values)
          applyLangCols(f, prod.paramsMap[pName], null);
        }
      } else if (isRightSide) {
        // === WIERSZ PRAWEJ STRONY: zagnie\u017cd\u017cony parametr ===
        const pName = rParamName || lastNestedParam[productId] || '';
        if (!pName) continue;

        if (rParamName) lastNestedParam[productId] = rParamName;

        // Unikalny klucz: parentValue + paramName (ten sam parametr pod r\u00f3\u017cnymi rodzicami to osobne instancje)
        const parentVal = rParentVal || lastRootValue[productId] || '';
        const uniqueKey = parentVal + '::' + pName;

        if (!prod.paramsMap[uniqueKey]) {
          prod.paramsMap[uniqueKey] = {
            name: pName, type: normalizeParamType(rType || 'select'),
            required: normalizeBoolean(rRequired), values: [],
          };
          prod.paramOrder.push(uniqueKey);
        } else if (rType) {
          prod.paramsMap[uniqueKey].type = normalizeParamType(rType);
        }

        if (rValue) {
          prod.paramsMap[uniqueKey].values.push({
            id: '', name: rValue,
            modifierType: normalizeModifierType(rMod || '+'),
            modifierValue: rAmount || '0',
          });
        }

        // Zapisz relacj\u0119 zagnie\u017cd\u017cenia: parentValue -> childParam uniqueKey
        if (parentVal) {
          if (!prod.nestingMap[parentVal]) prod.nestingMap[parentVal] = new Set();
          prod.nestingMap[parentVal].add(uniqueKey);
        }
      }
    }

    // Buduj configData z relacjami zagnie\u017cd\u017ce\u0144
    const products = productOrder.map(pid => {
      const prod = productMap[pid];
      const configData = { parameters: prod.paramOrder.map(key => prod.paramsMap[key]) };
      // Map uniqueKey -> index
      const keyToIdx = {};
      prod.paramOrder.forEach((key, idx) => { keyToIdx[key] = idx; });

      // Ustaw children na warto\u015bciach root parametr\u00f3w
      configData.parameters.forEach(param => {
        param.values.forEach(val => {
          const childKeys = prod.nestingMap[val.name];
          if (childKeys) {
            val.children = Array.from(childKeys).map(k => keyToIdx[k]).filter(idx => idx !== undefined);
          }
          if (!val.children) val.children = [];
        });
      });

      // Dodaj nieużywane parametry
      if (prod.unusedOrder && prod.unusedOrder.length > 0) {
        configData.unusedParameters = prod.unusedOrder.map(n => prod.unusedParams[n]);
      }

      return { productId: pid, configData };
    });

    return { products };
  }

  // =========================================================================
  // IMPORT — modal & execution
  // =========================================================================

  // Import pliku "towary + przypisane parametry": buduje konfigurator na istniej\u0105cych
  // towarach (dopasowanie po ID z pliku) albo tworzy nowe towary.
  function showImportFileModal(doc) {
    const { modal, body, footer } = createModal(doc, 'Importuj konfigurator z pliku');
    modal.classList.add('kcfg-modal--wide');

    body.innerHTML =
      '<div class="kcfg-import-upload" id="kcfg-dropzone">' +
        '<div style="font-size:32px;margin-bottom:10px;">\ud83d\udcc1</div>' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:6px;">Przeci\u0105gnij plik tutaj lub kliknij, aby wybra\u0107</div>' +
        '<div style="font-size:12px;color:#5f6368;">Obs\u0142ugiwane formaty: JSON, XML, CSV</div>' +
        '<div style="font-size:11px;color:#9aa0a6;margin-top:6px;">Pierwsza kolumna / pole <b>productId</b> wskazuje towar, do kt\u00f3rego trafi\u0105 parametry</div>' +
        '<input type="file" accept=".json,.xml,.csv" style="display:none;" id="kcfg-file-input">' +
      '</div>' +
      '<div id="kcfg-import-preview" style="margin-top:16px;"></div>' +
      '<div id="kcfg-import-target" style="display:none;margin-top:16px;">' +
        '<div class="kcfg-tabs">' +
          '<button class="kcfg-tab kcfg-tab--active" data-target="existing">Istniej\u0105ce towary (wg ID z pliku)</button>' +
          '<button class="kcfg-tab" data-target="new">Utw\u00f3rz nowe towary</button>' +
        '</div>' +
        '<div class="kcfg-options">' +
          '<div class="kcfg-option-row kcfg-opt-existing"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-imp-update"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Aktualizuj modyfikatory w istniej\u0105cych konfiguratorach (zamiast nadpisywa\u0107)</label></div>' +
          '<div class="kcfg-option-row kcfg-opt-existing"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-imp-autotype" checked><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Automatycznie zmie\u0144 typ towaru na konfigurator (je\u015bli trzeba)</label></div>' +
          '<div class="kcfg-option-row"><label style="display:flex;align-items:center;gap:10px;cursor:pointer;"><span class="kcfg-switch"><input type="checkbox" id="kcfg-imp-hide-params"><span class="kcfg-switch-track"><span class="kcfg-switch-thumb"></span></span></span> Ukryj parametry na karcie towaru i w por\u00f3wnywarce</label></div>' +
        '</div>' +
      '</div>';

    const dropzone = body.querySelector('#kcfg-dropzone');
    const fileInput = body.querySelector('#kcfg-file-input');
    const previewArea = body.querySelector('#kcfg-import-preview');
    const targetArea = body.querySelector('#kcfg-import-target');

    let parsedProducts = null;
    let targetMode = 'existing';

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('kcfg-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('kcfg-dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('kcfg-dragover');
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
    });

    targetArea.querySelectorAll('.kcfg-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        targetArea.querySelectorAll('.kcfg-tab').forEach(t => t.classList.remove('kcfg-tab--active'));
        tab.classList.add('kcfg-tab--active');
        targetMode = tab.dataset.target;
        targetArea.querySelectorAll('.kcfg-opt-existing').forEach(row => {
          row.style.display = targetMode === 'existing' ? '' : 'none';
        });
        updateActionButton();
      });
    });

    footer.innerHTML = '<button class="kcfg-btn-secondary" id="kcfg-cancel">Anuluj</button>';
    footer.querySelector('#kcfg-cancel').addEventListener('click', () => closeModal(doc));

    // Towary z poprawnym ID \u2014 tylko one nadaj\u0105 si\u0119 do trybu "istniej\u0105ce"
    function withId() {
      return (parsedProducts || []).filter(p => p.productId && String(p.productId).trim());
    }

    function updateActionButton() {
      let btn = footer.querySelector('#kcfg-import-run');
      if (!btn) {
        btn = doc.createElement('button');
        btn.id = 'kcfg-import-run';
        btn.className = 'kcfg-btn-primary';
        btn.addEventListener('click', runImport);
        footer.appendChild(btn);
      }
      const count = targetMode === 'existing' ? withId().length : (parsedProducts || []).length;
      btn.textContent = targetMode === 'existing'
        ? 'Zastosuj do ' + count + ' ' + (count === 1 ? 'towaru' : 'towar\u00f3w')
        : 'Utw\u00f3rz ' + count + ' ' + (count === 1 ? 'nowy towar' : 'nowych towar\u00f3w');
      btn.disabled = count === 0;
    }

    function runImport() {
      if (!parsedProducts) return;
      const hideParams = body.querySelector('#kcfg-imp-hide-params').checked;

      if (targetMode === 'existing') {
        const products = withId();
        if (products.length === 0) return;
        const items = products.map(p => ({
          productId: String(p.productId).trim(),
          configData: p.configData,
          label: 'Towar #' + String(p.productId).trim(),
        }));
        runConfiguratorBatch(doc, items, {
          autoType: body.querySelector('#kcfg-imp-autotype').checked,
          updateExisting: body.querySelector('#kcfg-imp-update').checked,
          hideParams,
        }, body, footer, 'Import zako\u0144czony');
      } else {
        const items = parsedProducts.map((p, i) => {
          const name = p.name || (p.productId ? 'Konfigurator #' + p.productId : 'Konfigurator ' + (i + 1));
          return {
            label: name,
            configData: p.configData,
            createProduct: () => createNewProduct(name),
          };
        });
        // createNewProduct od razu zak\u0142ada towar typu konfigurator \u2014 autoType zb\u0119dne
        runConfiguratorBatch(doc, items, { autoType: false, updateExisting: false, hideParams },
          body, footer, 'Tworzenie zako\u0144czone');
      }
    }

    function handleFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const importData = parseImportFile(reader.result, file.name);
          if (!importData.products || importData.products.length === 0) {
            throw new Error('Plik nie zawiera danych konfiguratora');
          }
          parsedProducts = importData.products;

          const missingId = parsedProducts.length - withId().length;
          const totalParams = parsedProducts.reduce((s, p) => s + p.configData.parameters.length, 0);

          let html = '<div style="font-size:13px;color:#202124;padding:12px;background:#f8f9fa;border-radius:8px;">';
          html += '<b>' + escapeHtml(file.name) + '</b> \u2014 ' + parsedProducts.length + ' towar' +
            (parsedProducts.length === 1 ? '' : parsedProducts.length < 5 ? 'y' : '\u00f3w') +
            ', \u0142\u0105cznie ' + totalParams + ' parametr\u00f3w<br>';
          parsedProducts.forEach((p, i) => {
            if (i >= 10) return;
            const pid = p.productId ? 'ID: ' + escapeHtml(String(p.productId)) : '<span style="color:#d93025;">bez ID</span>';
            html += '<div style="margin-top:4px;font-size:12px;color:#5f6368;">' + pid +
              (p.name ? ' \u2014 ' + escapeHtml(p.name) : '') +
              ' \u2014 ' + p.configData.parameters.length + ' parametr\u00f3w</div>';
          });
          if (parsedProducts.length > 10) html += '<div style="font-size:12px;color:#9aa0a6;">...i ' + (parsedProducts.length - 10) + ' wi\u0119cej</div>';
          html += '</div>';

          if (missingId > 0) {
            html += '<div class="kcfg-info kcfg-info--warning" style="margin-top:10px;">' + missingId +
              ' pozycji nie ma ID towaru \u2014 zostan\u0105 pomini\u0119te przy zapisie do istniej\u0105cych towar\u00f3w.</div>';
          }

          previewArea.innerHTML = html;
          targetArea.style.display = '';
          updateActionButton();
        } catch (e) {
          previewArea.innerHTML = '<div class="kcfg-info kcfg-info--error">B\u0142\u0105d parsowania pliku: ' + escapeHtml(e.message) + '</div>';
          targetArea.style.display = 'none';
          parsedProducts = null;
          updateActionButton();
        }
      };
      reader.readAsText(file, 'UTF-8');
    }
  }

  function showImportMode(doc, selectedProductIds) {
    const { modal, body, footer } = createModal(doc, 'Importuj z pliku', selectedProductIds.length);
    modal.classList.add('kcfg-modal--wide');

    body.innerHTML =
      '<div class="kcfg-import-upload" id="kcfg-dropzone">' +
        '<div style="font-size:32px;margin-bottom:10px;">\ud83d\udcc1</div>' +
        '<div style="font-size:14px;font-weight:600;margin-bottom:6px;">Przeci\u0105gnij plik tutaj lub kliknij, aby wybra\u0107</div>' +
        '<div style="font-size:12px;color:#5f6368;">Obs\u0142ugiwane formaty: JSON, XML, CSV</div>' +
        '<input type="file" accept=".json,.xml,.csv" style="display:none;" id="kcfg-file-input">' +
      '</div>' +
      '<div id="kcfg-import-preview" style="margin-top:16px;"></div>';

    const dropzone = body.querySelector('#kcfg-dropzone');
    const fileInput = body.querySelector('#kcfg-file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('kcfg-dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('kcfg-dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('kcfg-dragover');
      if (e.dataTransfer.files.length > 0) handleImportFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) handleImportFile(fileInput.files[0]);
    });

    footer.innerHTML = '<button class="kcfg-btn-secondary" id="kcfg-back">Wstecz</button>';
    footer.querySelector('#kcfg-back').addEventListener('click', () => showConfiguratorModal(doc, selectedProductIds));

    function handleImportFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const importData = parseImportFile(reader.result, file.name);
          if (!importData.products || importData.products.length === 0) {
            throw new Error('Plik nie zawiera danych konfiguratora');
          }
          // Otwórz kreator z danymi z pierwszego produktu
          const configData = importData.products[0].configData;
          configData._importProducts = importData.products;  // temp, will be moved to tabContent
          showCreateMode(doc, selectedProductIds, configData);
        } catch (e) {
          body.querySelector('#kcfg-import-preview').innerHTML =
            '<div class="kcfg-info kcfg-info--error">B\u0142\u0105d parsowania pliku: ' + escapeHtml(e.message) + '</div>';
        }
      };
      reader.readAsText(file, 'UTF-8');
    }
  }

  // =========================================================================
  // COLLECT DATA FROM UI
  // =========================================================================

  function collectConfiguratorData(doc, tabContent) {
    // Check if CSV tab has parsed data
    if (tabContent._parsedCsvData && tabContent._parsedCsvData.parameters.length > 0) {
      // Check if CSV tab is active
      const activeTab = tabContent.closest('.kcfg-modal-body')?.querySelector('.kcfg-tab--active');
      if (activeTab && activeTab.dataset.tab === 'csv') {
        return tabContent._parsedCsvData;
      }
    }

    // Collect from creator UI
    const paramsList = tabContent.querySelector('#kcfg-params-list');
    if (!paramsList) { console.warn('[PanelPRO] Brak #kcfg-params-list'); return { parameters: [] }; }

    const parameters = [];

    // Helper: zbierz wartości z kontenera values-list
    function collectValues(valuesListEl) {
      const vals = [];
      if (!valuesListEl) return vals;
      Array.from(valuesListEl.children).forEach(child => {
        // Bezpośrednie dzieci to .kcfg-value-row-wrapper lub .kcfg-value-row
        const row = child.querySelector('.kcfg-value-row') || (child.classList.contains('kcfg-value-row') ? child : null);
        if (!row) return;
        const vname = row.querySelector('.kcfg-value-name')?.value?.trim();
        if (!vname) return;
        const valObj = {
          id: '', name: vname,
          modifierType: row.querySelector('.kcfg-modifier-type')?.value || 'amount_add',
          modifierValue: row.querySelector('.kcfg-modifier-value')?.value || '0',
          children: [],
          _wrapper: child,
        };
        if (child._langData) valObj.langData = child._langData;
        vals.push(valObj);
      });
      return vals;
    }

    // Helper: zbierz parametr z bloku
    function collectParam(block) {
      const name = block.querySelector('.kcfg-param-name')?.value?.trim();
      if (!name) return null;
      const type = block.querySelector('.kcfg-param-type')?.value || 'select';
      const reqCb = block.querySelector('.kcfg-param-required input[type="checkbox"]');
      const required = reqCb ? reqCb.checked : true;

      // Znajdź PIERWSZY values-list (bezpośredni, nie zagnieżdżony)
      let valuesList = null;
      for (const el of block.children) {
        if (el.classList.contains('kcfg-values-list')) { valuesList = el; break; }
      }

      const values = collectValues(valuesList);
      const result = { id: '', name, type, required, values };
      // Preserve langData stored on DOM element
      if (block._langData) result.langData = block._langData;
      return result;
    }

    // Top-level: bezpośrednie dzieci #kcfg-params-list
    Array.from(paramsList.children).forEach(block => {
      if (!block.classList.contains('kcfg-param-block')) return;

      const param = collectParam(block);
      if (!param) return;
      if (param.values.length === 0 && param.type !== 'input') return;

      parameters.push(param);

      // Zagnieżdżone parametry: szukaj w nest-panel każdej wartości
      param.values.forEach(val => {
        const wrapper = val._wrapper;
        if (!wrapper) return;
        const nestList = wrapper.querySelector('.kcfg-nest-list');
        if (!nestList) return;

        Array.from(nestList.children).forEach(nestedBlock => {
          if (!nestedBlock.classList.contains('kcfg-nested-param')) return;
          const childParam = collectParam(nestedBlock);
          if (!childParam || (childParam.values.length === 0 && childParam.type !== 'input')) return;
          val.children.push(parameters.length);
          parameters.push(childParam);
        });

        delete val._wrapper;
      });

      // Cleanup _wrapper z wartości bez zagnieżdżeń
      param.values.forEach(val => { delete val._wrapper; });
    });

    console.log('[PanelPRO] Zebrano', parameters.length, 'parametrów z kreatora');
    return { parameters };
  }

  // =========================================================================
  // PRODUCT TYPE CHANGE (ensure product is configurator type)
  // =========================================================================

  function parseStocksTable(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (!table) return [];

    const headers = [];
    table.querySelectorAll('thead th').forEach(th => headers.push(th.textContent.trim()));

    const sizes = [];
    const rows = table.querySelectorAll('tbody tr');
    const allRows = rows.length > 0 ? rows : table.querySelectorAll('tr');
    allRows.forEach((tr, idx) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length === 0) return;
      const checkbox = tr.querySelector('input.iai-js-stock-operation');
      const sizeId = checkbox ? checkbox.id.replace('iai-js-so-', '') : null;
      if (!sizeId) return;
      const stocks = {};
      for (let c = 1; c < cells.length - 1; c++) {
        const val = cells[c]?.textContent?.trim();
        if (!val || val === '-' || val === 'brak' || !headers[c]) continue;
        // "jest" = manual availability (infinite), number = actual stock
        if (val === 'jest') {
          stocks[headers[c]] = 'jest';
        } else {
          const num = parseInt(val, 10);
          if (num > 0) stocks[headers[c]] = num;
        }
      }
      sizes.push({ sizeId, stocks });
    });
    return sizes;
  }

  function parseWarehouseSelect(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const select = doc.querySelector('select#currentStock');
    if (!select) return {};
    const map = {};
    Array.from(select.options).forEach(opt => {
      const shortName = opt.textContent.trim().split(' ')[0];
      map[shortName] = opt.value;
    });
    return map;
  }

  async function ensureProductTypeConfigurable(productId, statusCallback) {
    // Try to change type directly — if already configurable, backend returns success
    if (statusCallback) statusCallback('Zmiana typu towaru #' + productId + ' na konfigurator...');
    const typeResp = await fetchAjaxRaw(
      AJAX_PRODUCT_URL + '?action=productEdit&idt=' + encodeURIComponent(productId),
      'product_type=product_configurable'
    );

    // Success — type was already configurable or changed without issues
    if (!typeResp.error) {
      console.log('[PanelPRO] Typ towaru #' + productId + ' ustawiony na konfigurator');
      return { changed: true };
    }

    // errno 4 = product in customer basket, remove from basket and retry
    if (typeResp.errno === 4) {
      if (statusCallback) statusCallback('Usuwanie towaru #' + productId + ' z koszyka klienta...');
      await fetchAjaxRaw(
        AJAX_PRODUCT_URL + '?action=deleteProductFromBasket&product_id=' + encodeURIComponent(productId),
        ''
      );
      await sleep(300);
      // Retry type change
      const retryResp = await fetchAjaxRaw(
        AJAX_PRODUCT_URL + '?action=productEdit&idt=' + encodeURIComponent(productId),
        'product_type=product_configurable'
      );
      if (!retryResp.error) {
        console.log('[PanelPRO] Typ towaru #' + productId + ' ustawiony na konfigurator (po usuni\u0119ciu z koszyka)');
        return { changed: true };
      }
      // If still errno 27, fall through to stock handling below
      if (retryResp.errno !== 27) {
        throw new Error('Nie uda\u0142o si\u0119 zmieni\u0107 typu towaru: ' + (retryResp.msg || JSON.stringify(retryResp)));
      }
    } else if (typeResp.errno !== 27) {
      // errno 27 = has stock, need to zero → change → restore; other errors = fail
      throw new Error('Nie uda\u0142o si\u0119 zmieni\u0107 typu towaru: ' + (typeResp.msg || JSON.stringify(typeResp)));
    }

    // Read current stocks
    if (statusCallback) statusCallback('Odczytywanie stan\u00f3w magazynowych #' + productId + '...');
    const stockResp = await fetchAjaxRaw(
      '/panel/ajax/product-edit-aceform-tables.php?name=quantity&idt=' + encodeURIComponent(productId) + '&filtered=false',
      'id=stocksQuantity&url=%2Fpanel%2Fajax%2Fproduct-edit-aceform-tables.php%3Fname%3Dquantity%26idt%3D' + encodeURIComponent(productId) + '%26filtered%3Dfalse'
    );
    const sizes = parseStocksTable(stockResp.raw || '');

    // Get warehouse name→id mapping
    const whResp = await fetchAjaxGet(
      '/panel/ajax/product-edit-aceform-toplayers.php?name=addStocksQuantity&idt=' + encodeURIComponent(productId) + '&stock=0'
    );
    const warehouseMap = parseWarehouseSelect(whResp.raw || '');

    // Zero all stocks
    if (statusCallback) statusCallback('Zerowanie stan\u00f3w #' + productId + '...');
    const sizeParams = sizes.map(s => 'size[]=' + encodeURIComponent(s.sizeId)).join('&');
    const zeroResp = await fetchAjaxGet(
      '/panel/ajax/product-edit.php?function=ajaxCleanQuantity&productId=' + encodeURIComponent(productId) + '&' + sizeParams
    );
    if (zeroResp.errno && zeroResp.errno !== 0) {
      throw new Error('Nie uda\u0142o si\u0119 wyzerowa\u0107 stan\u00f3w: ' + (zeroResp.error || 'errno ' + zeroResp.errno));
    }
    await sleep(300);

    // Change product type
    if (statusCallback) statusCallback('Zmiana typu towaru #' + productId + ' na konfigurator...');
    let typeResp2 = await fetchAjaxRaw(
      AJAX_PRODUCT_URL + '?action=productEdit&idt=' + encodeURIComponent(productId),
      'product_type=product_configurable'
    );
    // Handle cart error after zeroing stocks
    if (typeResp2.error && typeResp2.errno === 4) {
      if (statusCallback) statusCallback('Usuwanie towaru #' + productId + ' z koszyka klienta...');
      await fetchAjaxRaw(
        AJAX_PRODUCT_URL + '?action=deleteProductFromBasket&product_id=' + encodeURIComponent(productId), ''
      );
      await sleep(300);
      typeResp2 = await fetchAjaxRaw(
        AJAX_PRODUCT_URL + '?action=productEdit&idt=' + encodeURIComponent(productId),
        'product_type=product_configurable'
      );
    }
    if (typeResp2.error) {
      throw new Error('Nie uda\u0142o si\u0119 zmieni\u0107 typu: ' + (typeResp2.msg || JSON.stringify(typeResp2)));
    }
    await sleep(300);

    // Restore stocks
    if (statusCallback) statusCallback('Przywracanie stan\u00f3w magazynowych #' + productId + '...');
    for (const size of sizes) {
      for (const [whName, qty] of Object.entries(size.stocks)) {
        const whId = warehouseMap[whName];
        if (!whId) continue;
        if (qty === 'jest') {
          // "jest" = manual availability (infinite): quantity=-1, infinity=y
          await fetchAjaxRaw(
            '/panel/product-edit-quantity.php?action=save',
            'stock=' + encodeURIComponent(whId) +
            '&quantity%5B' + encodeURIComponent(size.sizeId) + '%5D=-1' +
            '&infinity%5B' + encodeURIComponent(size.sizeId) + '%5D=y' +
            '&product=' + encodeURIComponent(productId) +
            '&note=&operation=add&sizegroup=&ulamki='
          );
        } else if (qty > 0) {
          await fetchAjaxRaw(
            '/panel/product-edit-quantity.php?action=save',
            'stock=' + encodeURIComponent(whId) +
            '&quantity%5B' + encodeURIComponent(size.sizeId) + '%5D=' + qty +
            '&product=' + encodeURIComponent(productId) +
            '&note=&operation=add&sizegroup=&ulamki='
          );
        }
        await sleep(200);
      }
    }

    console.log('[PanelPRO] Zmieniono typ towaru #' + productId + ' na konfigurator (stany przywrocone)');
    return { changed: true, hadStock: true };
  }

  // =========================================================================
  // EXECUTE CREATE / UPDATE
  // =========================================================================

  // Zapis JEDNEGO konfiguratora na JEDNYM towarze \u2014 wsp\u00f3lny dla wszystkich tryb\u00f3w
  // (kreator, kopiowanie, import do istniej\u0105cych, import do nowych towar\u00f3w).
  // opts: { autoType, updateExisting, hideParams }
  async function applyConfiguratorToProduct(productId, configData, opts, onStatus) {
    if (opts.autoType) {
      await ensureProductTypeConfigurable(productId, onStatus);
    }
    if (opts.updateExisting) {
      await updateConfiguratorOnProduct(configData, productId);
    } else {
      await createConfiguratorOnProduct(configData, productId);
    }
    if (opts.hideParams) {
      await hideConfiguratorParameters(productId);
    }
  }

  // Wsp\u00f3lna p\u0119tla wsadowa: pasek post\u0119pu, przycisk Stop, zbieranie b\u0142\u0119d\u00f3w, podsumowanie.
  // items: [{ label, configData, productId, createProduct }]
  //   productId     \u2014 towar docelowy (istniej\u0105cy)
  //   createProduct \u2014 async () => nowyId, gdy towar ma dopiero powsta\u0107
  async function runConfiguratorBatch(doc, items, opts, body, footer, title) {
    const abortController = new AbortController();
    const signal = abortController.signal;

    body.innerHTML = '<div style="padding:20px;">' +
      '<div class="kcfg-progress-text" id="kcfg-prog-text">Rozpoczynanie...</div>' +
      '<div class="kcfg-progress" style="height:20px;margin-top:12px;"><div class="kcfg-progress-fill" id="kcfg-prog-bar"></div></div>' +
      '</div>';

    footer.innerHTML = '<button class="kcfg-btn-stop" id="kcfg-stop">Stop</button>';
    footer.querySelector('#kcfg-stop').addEventListener('click', () => abortController.abort());

    const statusText = body.querySelector('#kcfg-prog-text');
    const barInner = body.querySelector('#kcfg-prog-bar');

    const results = { success: 0, errors: [], total: items.length, aborted: false, createdIds: [] };

    for (let i = 0; i < items.length; i++) {
      if (signal.aborted) { results.aborted = true; break; }

      const item = items[i];
      const label = item.label || ('Towar #' + item.productId);
      const prefix = '(' + (i + 1) + '/' + items.length + ') ';
      statusText.textContent = prefix + label + '...';
      barInner.style.width = Math.round(((i + 1) / items.length) * 100) + '%';

      try {
        // configData może być wyliczane dopiero teraz (np. odczyt parametrów towaru)
        let configData = item.configData;
        if (!configData && item.resolveConfigData) {
          statusText.textContent = prefix + label + ' — odczyt parametrów...';
          configData = await item.resolveConfigData();
        }
        if (!configData || !configData.parameters || configData.parameters.length === 0) {
          throw new Error('Brak parametrów do zbudowania konfiguratora');
        }

        let productId = item.productId;
        if (item.createProduct) {
          productId = await item.createProduct();
          results.createdIds.push(productId);
        }

        await applyConfiguratorToProduct(productId, configData, opts,
          (msg) => { statusText.textContent = prefix + msg; });

        results.success++;
      } catch (e) {
        results.errors.push({ id: label, error: e.message });
      }

      if (i < items.length - 1) await sleep(item.createProduct ? 500 : 300);
    }

    showExecutionResults(doc, body, footer, results, title);
    return results;
  }

  // Kreator: ten sam konfigurator na wszystkie zaznaczone towary
  function executeCreate(doc, selectedProductIds, configData, updateExisting, autoType, hideParams, body, footer) {
    const items = selectedProductIds.map(id => ({ productId: id, configData, label: 'Towar #' + id }));
    return runConfiguratorBatch(
      doc, items, { autoType, updateExisting, hideParams }, body, footer,
      updateExisting ? 'Aktualizacja zako\u0144czona' : 'Tworzenie zako\u0144czone'
    );
  }

  async function hideConfiguratorParameters(productId) {
    const shopId = getShopId();
    const url = AJAX_DYNAMIC_CONTENT_URL +
      '?name=configuratorParametersList&idt=' + encodeURIComponent(productId) +
      '&shopId=' + encodeURIComponent(shopId);
    const resp = await fetchAjaxGet(url);
    const html = resp.raw || '';
    const config = parseConfiguratorHtml(html);
    if (!config || config.parameters.length === 0) return;

    const parts = [];
    config.parameters.forEach(p => {
      if (!p.id) return;
      parts.push('parameters[projector_hide][' + encodeURIComponent(p.id) + ']=y');
    });
    if (parts.length === 0) return;

    await fetchAjaxRaw(
      AJAX_PRODUCT_URL + '?action=saveParameters&idt=' + encodeURIComponent(productId),
      parts.join('&')
    );
  }

  async function createConfiguratorOnProduct(configData, productId) {
    // Step 0: Remove any existing configurator to avoid duplicates
    await removeExistingConfigurator(productId);

    // Step 1: Add all parameter "blocks" via addPriceConfiguratorParameters
    for (const param of configData.parameters) {
      const values = {};
      const priceModifierNew = {};

      param.values.forEach((v, idx) => {
        values[String(idx)] = v.name;
        priceModifierNew[String(idx)] = modifierToApi(v.modifierType, v.modifierValue);
      });

      const payload = {
        productId: String(productId),
        parameters: {
          data: {
            [param.name]: {
              values: values,
              langData: {},
              priceModifier: {
                new: priceModifierNew,
                existing: {},
              },
              paramType: param.type || 'select',
              required: param.required !== false,
            },
          },
          remove: [],
        },
        lang: LANG,
        action: 'add',
        parameterId: null,
      };

      const resp = await fetchAjaxRaw(
        AJAX_PARAMS_URL + '?action=addPriceConfiguratorParameters',
        'paramsData=' + encodeURIComponent(JSON.stringify(payload))
      );

      if (resp && resp.error) {
        throw new Error(resp.error);
      }
    }

    // Step 2: Save the configurator tree (passes configData for nesting)
    await saveConfiguratorTree(productId, configData);

    // Step 3: Apply langData (descriptions) if present
    await applyLangDataToProduct(productId, configData);
  }

  async function applyLangDataToProduct(productId, configData) {
    // Check if any param or value has langData with descriptions
    const hasAny = configData.parameters.some(p =>
      hasLangDataContent(p.langData) ||
      p.values.some(v => hasLangDataContent(v.langData))
    );
    if (!hasAny) return;

    // Re-fetch parameter list to get server-assigned IDs
    const shopId = getShopId();
    const url = AJAX_DYNAMIC_CONTENT_URL +
      '?name=configuratorParametersList&idt=' + encodeURIComponent(productId) +
      '&shopId=' + encodeURIComponent(shopId);
    const resp = await fetchAjaxGet(url);
    const serverConfig = parseConfiguratorHtml(resp.raw || '');
    if (!serverConfig || serverConfig.parameters.length === 0) return;

    // Build name→serverParam mapping
    const nameToServerParam = {};
    serverConfig.parameters.forEach(p => { nameToServerParam[p.name] = p; });

    async function applyLangDataToElement(serverId, langData) {
      if (!langData) return;
      for (const [lang, ld] of Object.entries(langData)) {
        // Description
        if (ld.description) {
          await setParameterDescription(serverId, lang, ld.description);
          await sleep(100);
        }
        // Graphics
        if (ld.graphics) {
          for (const [sid, gfx] of Object.entries(ld.graphics)) {
            if (gfx.iconProjector) {
              try {
                await uploadParamGfx(serverId, lang, sid, 'projector', gfx.iconProjector);
                await sleep(200);
              } catch (e) { console.warn('[PanelPRO] Gfx upload projector failed:', e.message); }
            }
            if (gfx.iconSearch) {
              try {
                await uploadParamGfx(serverId, lang, sid, 'search', gfx.iconSearch);
                await sleep(200);
              } catch (e) { console.warn('[PanelPRO] Gfx upload search failed:', e.message); }
            }
          }
        }
      }
    }

    for (const param of configData.parameters) {
      const serverParam = nameToServerParam[param.name];
      if (!serverParam || !serverParam.id) continue;

      // Descriptions + graphics for parameter
      await applyLangDataToElement(serverParam.id, param.langData);

      // Descriptions + graphics for values
      for (const val of param.values) {
        if (!val.langData) continue;
        const serverVal = serverParam.values.find(sv => sv.name === val.name);
        if (!serverVal || !serverVal.id) continue;
        await applyLangDataToElement(serverVal.id, val.langData);
      }
    }
  }

  // Fetch current parameter IDs from product, build tree, and save it
  // configData is optional — if provided, uses children info for nested tree
  async function saveConfiguratorTree(productId, configData) {
    const shopId = getShopId();

    // Fetch freshly created parameters to get their IDs
    const url = AJAX_DYNAMIC_CONTENT_URL +
      '?name=configuratorParametersList&idt=' + encodeURIComponent(productId) +
      '&shopId=' + encodeURIComponent(shopId);
    const resp = await fetchAjaxGet(url);
    const html = resp.raw || '';
    const config = parseConfiguratorHtml(html);

    if (!config || config.parameters.length === 0) return;

    // Build name→param mapping from fetched config
    const nameToParam = {};
    config.parameters.forEach(p => { nameToParam[p.name] = p; });

    // Check if we have nesting data
    const hasNesting = configData && configData.parameters.some(p =>
      p.values.some(v => v.children && v.children.length > 0)
    );

    const priceConfiguratorData = {};
    const priceConfiguratorDataOrder = {};

    if (hasNesting) {
      // Build nested tree
      // First, determine which params are children-only (not root-level)
      const childOnlyIndices = new Set();
      const rootIndices = [];

      configData.parameters.forEach((param, idx) => {
        const isRoot = param.values.some(v => v.children && v.children.length > 0);
        if (isRoot) rootIndices.push(idx);
      });

      // Collect all indices that appear ONLY as children
      configData.parameters.forEach(param => {
        param.values.forEach(v => {
          (v.children || []).forEach(childIdx => childOnlyIndices.add(childIdx));
        });
      });

      let orderIdx = 0;

      configData.parameters.forEach((param, idx) => {
        const serverParam = nameToParam[param.name];
        if (!serverParam) return;
        const paramId = serverParam.id;

        if (rootIndices.includes(idx)) {
          // Root-level param with nested children
          priceConfiguratorData[paramId] = {};

          param.values.forEach(val => {
            // Find value ID by name
            const serverVal = serverParam.values.find(sv => sv.name === val.name);
            if (!serverVal) return;
            const valId = serverVal.id;

            priceConfiguratorData[paramId][valId] = {};
            (val.children || []).forEach(childIdx => {
              const childParam = configData.parameters[childIdx];
              if (!childParam) return;
              const childServerParam = nameToParam[childParam.name];
              if (!childServerParam) return;
              priceConfiguratorData[paramId][valId][childServerParam.id] = true;
            });
          });

          priceConfiguratorDataOrder[paramId] = orderIdx++;
        } else if (!childOnlyIndices.has(idx)) {
          // Independent param (not root, not child) — flat at root level
          priceConfiguratorData[paramId] = {};
          priceConfiguratorDataOrder[paramId] = orderIdx++;
        }
        // child-only params are NOT added to priceConfiguratorDataOrder
      });
    } else {
      // Flat tree: every parameter at root level, no dependencies
      config.parameters.forEach((param, idx) => {
        priceConfiguratorData[param.id] = {};
        priceConfiguratorDataOrder[param.id] = idx;
      });
    }

    const treePayload = {
      priceConfiguratorData: priceConfiguratorData,
      priceConfiguratorDataOrder: priceConfiguratorDataOrder,
    };

    const treeResp = await fetchAjaxRaw(
      AJAX_PRODUCT_URL + '?action=productEdit&idt=' + encodeURIComponent(productId),
      'paramsData=' + encodeURIComponent(JSON.stringify(treePayload))
    );

    if (treeResp && treeResp.error) {
      throw new Error(treeResp.error);
    }
  }

  // =========================================================================
  // UPDATE MODE — update existing configurator modifiers
  // =========================================================================

  async function updateConfiguratorOnProduct(configData, productId) {
    const shopId = getShopId();

    // Fetch existing configurator
    const url = AJAX_DYNAMIC_CONTENT_URL + '?name=configuratorParametersList&idt=' + encodeURIComponent(productId) + '&shopId=' + encodeURIComponent(shopId);
    const resp = await fetchAjaxGet(url);
    const html = resp.raw || '';

    const existingConfig = parseConfiguratorHtml(html);

    for (const param of configData.parameters) {
      // Try to match by name to existing parameter
      const existingParam = existingConfig.parameters.find(ep => ep.name === param.name);

      if (existingParam && existingParam.id) {
        // Update existing parameter — match values by name
        const langData = {};
        const existingModifiers = {};
        const newValues = {};
        const newModifiers = {};

        let newIdx = 0;
        for (const val of param.values) {
          const existingVal = existingParam.values.find(ev => ev.name === val.name);
          if (existingVal && existingVal.id) {
            // Update existing value modifier
            langData[existingVal.id] = val.name;
            existingModifiers[existingVal.id] = modifierToApi(val.modifierType, val.modifierValue);
          } else {
            // Add as new value
            newValues[String(newIdx)] = val.name;
            newModifiers[String(newIdx)] = modifierToApi(val.modifierType, val.modifierValue);
            newIdx++;
          }
        }

        const payload = {
          productId: String(productId),
          parameters: {
            data: {
              [param.name]: {
                values: newValues,
                langData: langData,
                priceModifier: {
                  new: newModifiers,
                  existing: existingModifiers,
                },
                paramType: param.type || 'select',
                required: param.required !== false,
              },
            },
            remove: [],
          },
          lang: LANG,
          action: 'edit',
          parameterId: parseInt(existingParam.id, 10) || null,
        };

        const editResp = await fetchAjaxRaw(
          AJAX_PARAMS_URL + '?action=addPriceConfiguratorParameters',
          'paramsData=' + encodeURIComponent(JSON.stringify(payload))
        );

        if (editResp && editResp.error) {
          throw new Error(editResp.error);
        }
      } else {
        // Parameter doesn't exist yet — add as new
        const values = {};
        const priceModifierNew = {};

        param.values.forEach((v, idx) => {
          values[String(idx)] = v.name;
          priceModifierNew[String(idx)] = modifierToApi(v.modifierType, v.modifierValue);
        });

        const payload = {
          productId: String(productId),
          parameters: {
            data: {
              [param.name]: {
                values: values,
                langData: {},
                priceModifier: {
                  new: priceModifierNew,
                  existing: {},
                },
                paramType: param.type || 'select',
                required: param.required !== false,
              },
            },
            remove: [],
          },
          lang: LANG,
          action: 'add',
          parameterId: null,
        };

        const addResp = await fetchAjaxRaw(
          AJAX_PARAMS_URL + '?action=addPriceConfiguratorParameters',
          'paramsData=' + encodeURIComponent(JSON.stringify(payload))
        );

        if (addResp && addResp.error) {
          throw new Error(addResp.error);
        }
      }
    }

    // Save the configurator tree after updates (with nesting info)
    await saveConfiguratorTree(productId, configData);
  }

  // =========================================================================
  // EXECUTION RESULTS
  // =========================================================================

  function showExecutionResults(doc, body, footer, results, title) {
    let html = '<div style="padding:20px;">';
    html += '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">' + escapeHtml(title) + '</div>';
    html += '<div style="color:#27ae60;margin-bottom:6px;">Sukces: <b>' + results.success + '</b> / ' + results.total + '</div>';

    if (results.createdIds && results.createdIds.length > 0) {
      html += '<div style="font-size:12px;color:#5f6368;margin:8px 0;">Nowe ID towar\u00f3w: ' + escapeHtml(results.createdIds.join(', ')) + '</div>';
    }

    if (results.errors.length > 0) {
      html += '<div style="color:#e74c3c;margin-bottom:6px;">B\u0142\u0119dy: <b>' + results.errors.length + '</b></div>';
      html += '<div style="max-height:120px;overflow-y:auto;font-size:12px;border:1px solid #eee;padding:8px;border-radius:4px;margin-top:8px;">';
      results.errors.forEach(e => {
        html += '<div>' + escapeHtml(String(e.id)) + ': ' + escapeHtml(e.error) + '</div>';
      });
      html += '</div>';
    }

    if (results.aborted) {
      html += '<div style="color:#1a73e8;margin-top:8px;">Operacja przerwana przez u\u017cytkownika.</div>';
    }

    html += '</div>';
    body.innerHTML = html;

    footer.innerHTML = '';
    const closeBtn = doc.createElement('button');
    closeBtn.textContent = 'Zamknij';
    closeBtn.className = 'kcfg-btn-primary';
    closeBtn.addEventListener('click', () => closeModal(doc));
    footer.appendChild(closeBtn);
  }

  // =========================================================================
  // INIT
  // =========================================================================

  waitForIframe(doc => {
    injectConfiguratorButton(doc);
    injectExportButton(doc);
    injectImportButton(doc);
    // Pre-fetch parametrów w tle (cache gotowy zanim user otworzy modal)
    fetchTraitGroups();
  });

})();
