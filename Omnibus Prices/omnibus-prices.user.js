// ==UserScript==
// @name         IdoSell Omnibus Prices - Bulk Update
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      1.3.4
// @description  Masowa aktualizacja omnibusPrices w IdoSell na podstawie pliku CSV + weryfikacja przez GET
// @author       maciej.dobron
// @match        *://*.iai-shop.com/*
// @match        *://*.idosell.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      iai-shop.com
// @connect      idosell.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'omnibus_prices_cfg';
  const saved = (() => { try { return JSON.parse(GM_getValue(STORE_KEY, '{}')); } catch { return {}; } })();
  const persist = (patch) => {
    Object.assign(saved, patch);
    GM_setValue(STORE_KEY, JSON.stringify(saved));
  };

  // ---------- UI ----------
  const style = document.createElement('style');
  style.textContent = `
    #omnibus-fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      background: #2563eb; color: #fff; border: 0; border-radius: 50%; width: 52px; height: 52px;
      font-size: 22px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,.3); }
    #omnibus-panel { position: fixed; right: 16px; bottom: 80px; z-index: 2147483646;
      width: 460px; max-height: 80vh; background: #fff; color: #222; border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); display: none; flex-direction: column;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 13px; }
    #omnibus-panel.open { display: flex; }
    #omnibus-panel header { background: #1e293b; color: #fff; padding: 10px 14px;
      border-radius: 10px 10px 0 0; display: flex; justify-content: space-between; align-items: center; }
    #omnibus-panel header h3 { margin: 0; font-size: 14px; }
    #omnibus-panel .body { padding: 12px 14px; overflow: auto; }
    #omnibus-panel label { display: block; margin: 8px 0 3px; font-weight: 600; font-size: 12px; }
    #omnibus-panel input[type=text], #omnibus-panel input[type=password],
    #omnibus-panel input[type=number], #omnibus-panel input[type=file] {
      width: 100%; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px;
      font-size: 12px; box-sizing: border-box; font-family: inherit; }
    #omnibus-panel .row { display: flex; gap: 8px; }
    #omnibus-panel .row > div { flex: 1; }
    #omnibus-panel .opts { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
    #omnibus-panel .opts label { display: inline-flex; align-items: center; gap: 4px;
      font-weight: normal; margin: 0; font-size: 12px; }
    #omnibus-panel .actions { display: flex; gap: 6px; margin-top: 10px; }
    #omnibus-panel button.action { flex: 1; padding: 8px 10px; border: 0; border-radius: 4px;
      background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; font-size: 12px; }
    #omnibus-panel button.action.secondary { background: #64748b; }
    #omnibus-panel button.action:disabled { background: #94a3b8; cursor: not-allowed; }
    #omnibus-panel header button { background: transparent; border: 0; color: #fff;
      font-size: 18px; cursor: pointer; line-height: 1; }
    #omnibus-log { margin-top: 10px; background: #0f172a; color: #e2e8f0;
      padding: 8px 10px; border-radius: 6px; font-family: ui-monospace, Consolas, monospace;
      font-size: 11px; white-space: pre-wrap; max-height: 280px; overflow: auto; line-height: 1.4; }
    #omnibus-log .ok { color: #4ade80; }
    #omnibus-log .err { color: #f87171; }
    #omnibus-log .warn { color: #fbbf24; }
    #omnibus-log .muted { color: #94a3b8; }
    #omnibus-panel .muted { color: #64748b; font-weight: normal; }
  `;
  document.head.appendChild(style);

  const fab = document.createElement('button');
  fab.id = 'omnibus-fab';
  fab.title = 'Omnibus Prices - Bulk Update';
  fab.textContent = '💰';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'omnibus-panel';
  panel.innerHTML = `
    <header>
      <h3>Omnibus Prices — Bulk Update</h3>
      <button id="om-close" title="Zamknij">×</button>
    </header>
    <div class="body">
      <label>API domain <span class="muted">(np. shop56041-1.iai-shop.com)</span></label>
      <input type="text" id="om-domain" placeholder="shop56041-1.iai-shop.com">

      <label>API key <span class="muted">(X-API-KEY)</span></label>
      <input type="password" id="om-apikey" placeholder="YXBwbGljYXRpb24x...">

      <div class="row">
        <div>
          <label>Shop ID</label>
          <input type="number" id="om-shopid" value="1" min="1">
        </div>
        <div>
          <label>Batch size</label>
          <input type="number" id="om-batch" value="50" min="1" max="100">
        </div>
        <div>
          <label>Delay (ms)</label>
          <input type="number" id="om-delay" value="250" min="0">
        </div>
      </div>

      <label>Plik CSV <span class="muted">(Id, Cena detaliczna, Cena hurtowa, Tryb ceny)</span></label>
      <input type="file" id="om-csv" accept=".csv,text/csv">

      <div class="opts">
        <label><input type="checkbox" id="om-dry"> Dry run</label>
        <label><input type="checkbox" id="om-verify" checked> Weryfikuj po PUT (GET)</label>
        <label><input type="checkbox" id="om-debug"> Debug (loguj payload + odpowiedź)</label>
        <label><input type="checkbox" id="om-test"> Test (tylko 1. produkt)</label>
        <label><input type="checkbox" id="om-auto-switch"> Sync: po manual przełącz na automatic (PUT #3)</label>
      </div>

      <div class="actions">
        <button class="action" id="om-run" disabled>PUT + weryfikacja</button>
        <button class="action secondary" id="om-verify-only" disabled>Tylko weryfikacja</button>
      </div>
      <div class="actions">
        <button class="action" id="om-sync" disabled style="background:#059669">Sync z cen brutto (bez CSV)</button>
      </div>

      <div id="omnibus-log"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = id => document.getElementById(id);
  const logEl = $('omnibus-log');

  // Restore saved config (not apikey unless user previously saved).
  if (saved.domain) $('om-domain').value = saved.domain;
  if (saved.apikey) $('om-apikey').value = saved.apikey;
  if (saved.shopid) $('om-shopid').value = saved.shopid;
  if (saved.batch)  $('om-batch').value = saved.batch;
  if (saved.delay != null)  $('om-delay').value = saved.delay;

  fab.addEventListener('click', () => panel.classList.toggle('open'));
  $('om-close').addEventListener('click', () => panel.classList.remove('open'));

  function write(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function validate() {
    const hasCred = !!($('om-domain').value.trim() && $('om-apikey').value.trim());
    const hasCsv = $('om-csv').files.length > 0;
    $('om-run').disabled = !(hasCred && hasCsv);
    $('om-verify-only').disabled = !(hasCred && hasCsv);
    $('om-sync').disabled = !hasCred;
  }
  ['om-domain','om-apikey'].forEach(id => $(id).addEventListener('input', validate));
  $('om-csv').addEventListener('change', validate);
  validate();

  // ---------- CSV ----------
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let field = '', row = [], inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === sep) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
        else if (c === '\r') { /* skip */ }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    while (rows.length && rows[rows.length-1].every(x => x === '')) rows.pop();
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows.shift().map(h => h.trim());
    return { headers, rows: rows.map(r => {
      const o = {};
      headers.forEach((h, idx) => o[h] = (r[idx] ?? '').trim());
      return o;
    })};
  }

  const findHeader = (headers, candidates) => {
    const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const map = new Map(headers.map(h => [norm(h), h]));
    for (const c of candidates) { const h = map.get(norm(c)); if (h) return h; }
    return null;
  };

  const normalizePrice = v => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const normalizeMode = v => {
    if (!v) return null;
    const s = String(v).trim();
    const map = {
      'automatyczne': 'automatic',
      'automatyczne obliczanie': 'automatic',
      'auto': 'automatic',
      'automatic': 'automatic',
      'automatic_calculation': 'automatic',
      'reczne': 'manual',
      'ręczne': 'manual',
      'manualnie': 'manual',
      'manual': 'manual',
      'manual_entering': 'manual',
      'nie_dotyczy': 'does_not_apply',
      'nie dotyczy': 'does_not_apply',
      'does_not_apply': 'does_not_apply',
      'bez_zmian': 'no_change',
      'bez zmian': 'no_change',
      'no_change': 'no_change',
    };
    return map[s.toLowerCase()] || s;
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function parseCsvRow(row, cols) {
    const id = row[cols.id];
    if (!id) return { error: 'brak Id' };
    return {
      csv: {
        id: String(id),
        retail: normalizePrice(row[cols.retail]),
        wholesale: normalizePrice(row[cols.wholesale]),
        mode: normalizeMode(row[cols.mode]),
      }
    };
  }

  // Shop-only PUT product: { ident, shops: [ { shopId, omnibusPrices } ] }, no top-level prices, no sizes.
  function buildShopOnlyProduct(csv, struct, fallbackShopId) {
    const omnibus = {};
    if (csv.mode) omnibus.omnibusPriceManagement = csv.mode;
    if (csv.retail != null) omnibus.omnibusPriceRetail = csv.retail;
    if (csv.wholesale != null) omnibus.omnibusPriceWholesale = csv.wholesale;
    const shops = (struct && struct.shops && struct.shops.length)
      ? struct.shops.map(s => ({ shopId: Number(s.shopId), omnibusPrices: { ...omnibus } }))
      : [ { shopId: Number(fallbackShopId), omnibusPrices: { ...omnibus } } ];
    return { ident: { type: 'id', value: csv.id }, shops };
  }

  // Build PUT product from GET-derived structure with CSV values substituted in.
  function buildProductFromStructure(csv, struct, fallbackShopId) {
    const omnibus = {};
    if (csv.mode) omnibus.omnibusPriceManagement = csv.mode;
    if (csv.retail != null) omnibus.omnibusPriceRetail = csv.retail;
    if (csv.wholesale != null) omnibus.omnibusPriceWholesale = csv.wholesale;

    const shops = (struct && struct.shops && struct.shops.length)
      ? struct.shops.map(s => ({ shopId: Number(s.shopId), omnibusPrices: { ...omnibus } }))
      : [ { shopId: Number(fallbackShopId), omnibusPrices: { ...omnibus } } ];

    const sizeIdSet = new Set();
    if (struct && struct.shops) {
      for (const s of struct.shops) for (const sid of s.sizeIds) sizeIdSet.add(sid);
    }
    const sizes = [...sizeIdSet].map(sid => ({
      ident: { type: 'id', value: String(sid) },
      omnibusPrices: { ...omnibus },
    }));

    const product = {
      ident: { type: 'id', value: csv.id },
      omnibusPrices: omnibus,
      shops,
    };
    if (sizes.length) product.sizes = sizes;
    return product;
  }

  // Convert GET response into Map<productId, { shops: [{shopId, sizeIds:[]}] }>.
  function parseStructure(responseJson) {
    const out = new Map();
    const prods = responseJson?.products;
    if (!prods || typeof prods !== 'object') return out;
    for (const [key, prod] of Object.entries(prods)) {
      const id = key.startsWith('id:') ? key.slice(3) : key;
      const shopsObj = prod?.shops || {};
      const shops = [];
      for (const [shopIdStr, shopNode] of Object.entries(shopsObj)) {
        const shopId = Number(shopNode?.shop_id ?? shopIdStr);
        const sizeIds = [];
        const sizesObj = shopNode?.sizes || {};
        for (const [sizeKey, sizeNode] of Object.entries(sizesObj)) {
          const sid = sizeNode?.ident?.value ?? sizeKey;
          if (sid != null) sizeIds.push(String(sid));
        }
        shops.push({ shopId, sizeIds });
      }
      out.set(String(id), { shops });
    }
    return out;
  }

  // ---------- HTTP via GM_xmlhttpRequest (bypasses CORS) ----------
  function gmRequest({ method, url, apiKey, body }) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          'X-API-KEY': apiKey,
          'accept': 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 60000,
        onload: r => {
          let parsed; try { parsed = JSON.parse(r.responseText); } catch { parsed = r.responseText; }
          resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, data: parsed });
        },
        onerror: r => resolve({ ok: false, status: r.status || 0, data: r.error || 'network error' }),
        ontimeout: () => resolve({ ok: false, status: 0, data: 'timeout' }),
      });
    });
  }

  // ---------- Verify helpers ----------
  // Response shape: { products: { "id:6215": { shops: { "1": { shop_id, omnibusPriceRetail, ... } } } } }
  function extractActual(responseJson, id, shopId) {
    const prods = responseJson?.products;
    if (!prods || typeof prods !== 'object') return null;
    const key = `id:${id}`;
    const prod = prods[key];
    if (!prod) {
      // Fallback: some payloads may use bare id or nest differently.
      const alt = prods[String(id)];
      if (!alt) return null;
      return pickNodes(alt, shopId);
    }
    return pickNodes(prod, shopId);
  }

  function pickNodes(prod, shopId) {
    const shop = prod?.shops?.[String(shopId)];
    const pick = node => {
      if (!node || typeof node !== 'object') return null;
      return {
        retail: node.omnibusPriceRetail != null ? Number(node.omnibusPriceRetail) : null,
        wholesale: node.omnibusPriceWholesale != null ? Number(node.omnibusPriceWholesale) : null,
        mode: node.omnibusPriceManagement ?? null,
      };
    };
    return { product: pick(prod), shop: pick(shop) };
  }

  const pricesEqual = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) < 0.005;
  };

  const MODE_ALIASES = {
    'automatic': 'automatic',
    'automatic_calculation': 'automatic',
    'manual': 'manual',
    'manual_entering': 'manual',
    'does_not_apply': 'does_not_apply',
    'no_change': 'no_change',
  };
  const canonicalMode = m => m ? (MODE_ALIASES[String(m).toLowerCase()] || String(m).toLowerCase()) : null;
  const modesEqual = (a, b) => canonicalMode(a) === canonicalMode(b);

  // ---------- Pipeline ----------
  function readConfig() {
    const domain = $('om-domain').value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiKey = $('om-apikey').value.trim();
    const shopId = Number($('om-shopid').value);
    const batchSize = Math.max(1, Number($('om-batch').value) || 50);
    const delay = Math.max(0, Number($('om-delay').value) || 0);
    const dryRun = $('om-dry').checked;
    const verify = $('om-verify').checked;
    const debug = $('om-debug').checked;
    const testOnly = $('om-test').checked;
    const switchToAuto = $('om-auto-switch').checked;
    const file = $('om-csv').files[0];
    const baseUrl = `https://${domain}/api/admin/v7/products/omnibusPrices`;
    persist({ domain, apikey: apiKey, shopid: shopId, batch: batchSize, delay });
    return { domain, apiKey, shopId, batchSize, delay, dryRun, verify, debug, testOnly, switchToAuto, file, baseUrl };
  }

  async function loadCsv(cfg) {
    const text = await cfg.file.text();
    const { headers, rows } = parseCSV(text);
    if (!rows.length) throw new Error('CSV jest pusty.');
    write(`Wczytano wierszy: ${rows.length}. Kolumny: ${headers.join(' | ')}`, 'muted');

    const cols = {
      id: findHeader(headers, ['Id', 'ID', 'id', 'productId']),
      retail: findHeader(headers, ['Cena detaliczna', 'cena detaliczna', 'retail']),
      wholesale: findHeader(headers, ['Cena hurtowa', 'cena hurtowa', 'wholesale']),
      mode: findHeader(headers, ['Tryb ceny', 'tryb ceny', 'mode', 'omnibusPriceManagement']),
    };
    const missing = Object.entries(cols).filter(([,v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`Brak kolumn w CSV: ${missing.join(', ')}`);

    const csvRows = [];
    const skipped = [];
    for (const [i, r] of rows.entries()) {
      const { csv, error } = parseCsvRow(r, cols);
      if (error) { skipped.push({ line: i+2, reason: error }); continue; }
      csvRows.push(csv);
    }
    return { csvRows, skipped };
  }

  // Fetch product structures (shops + sizes) in batches.
  async function prefetchStructure(cfg, ids) {
    const total = Math.ceil(ids.length / cfg.batchSize);
    write(`\n=== GET (struktura): ${ids.length} produktów w ${total} paczkach ===`, 'muted');
    const structures = new Map();
    const missing = [];
    let errors = 0;

    for (let bi = 0; bi < total; bi++) {
      const batchIds = ids.slice(bi*cfg.batchSize, (bi+1)*cfg.batchSize);
      const qs = new URLSearchParams({ identType: 'id' });
      qs.append('products', batchIds.join(','));
      const url = `${cfg.baseUrl}?${qs.toString()}`;

      const res = await gmRequest({ method: 'GET', url, apiKey: cfg.apiKey });
      if (!res.ok) {
        errors += batchIds.length;
        const msg = typeof res.data === 'string' ? res.data.slice(0,500) : JSON.stringify(res.data).slice(0,500);
        write(`[${bi+1}/${total}] GET BŁĄD HTTP ${res.status}: ${msg}`, 'err');
        if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
        continue;
      }
      const parsed = parseStructure(res.data);
      for (const id of batchIds) {
        const s = parsed.get(id);
        if (s) structures.set(id, s);
        else missing.push(id);
      }
      write(`[${bi+1}/${total}] GET OK (${batchIds.length})`, 'ok');
      if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
    }

    const sizeCount = [...structures.values()].reduce((n, s) => n + s.shops.reduce((m, sh) => m + sh.sizeIds.length, 0), 0);
    write(`Pobrano strukturę: produktów=${structures.size}, sklepów łącznie=${[...structures.values()].reduce((n,s)=>n+s.shops.length,0)}, rozmiarów łącznie=${sizeCount}, brak=${missing.length}, błędy=${errors}`, (missing.length||errors)?'warn':'muted');
    if (missing.length) write(`  brak struktury dla: ${missing.join(', ')}`, 'warn');
    return structures;
  }

  async function doPut(cfg, products, label = 'PUT') {
    let ok = 0, fail = 0;
    const total = Math.ceil(products.length / cfg.batchSize);
    write(`\n=== ${label}: ${products.length} produktów w ${total} paczkach ===`, 'muted');

    for (let bi = 0; bi < total; bi++) {
      const batch = products.slice(bi*cfg.batchSize, (bi+1)*cfg.batchSize);
      const body = { params: { products: batch } };

      if (cfg.debug && bi === 0) {
        write(`  PAYLOAD (paczka 1, pełny body):`, 'muted');
        write(JSON.stringify(body, null, 2), 'muted');
      }

      if (cfg.dryRun) {
        write(`[${bi+1}/${total}] DRY RUN — ${batch.length} produktów`, 'muted');
        if (!cfg.debug) write(`  pierwszy payload: ${JSON.stringify(batch[0])}`, 'muted');
        continue;
      }

      const res = await gmRequest({ method: 'PUT', url: cfg.baseUrl, apiKey: cfg.apiKey, body });
      if (res.ok) {
        ok += batch.length;
        write(`[${bi+1}/${total}] OK (${batch.length}) HTTP ${res.status}`, 'ok');
        const faults = res.data?.results?.filter?.(r => r?.faultCode || r?.faultString) || [];
        if (faults.length) write(`  faults: ${JSON.stringify(faults).slice(0,500)}`, 'warn');
        if (cfg.debug && bi === 0) {
          write(`  RESPONSE (paczka 1, pełna):`, 'muted');
          write(typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2), 'muted');
        }
      } else {
        fail += batch.length;
        const msg = typeof res.data === 'string' ? res.data.slice(0,2000) : JSON.stringify(res.data, null, 2).slice(0,2000);
        write(`[${bi+1}/${total}] BŁĄD HTTP ${res.status}: ${msg}`, 'err');
      }
      if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
    }
    return { ok, fail };
  }

  async function doVerify(cfg, expectations) {
    const ids = [...expectations.keys()];
    const total = Math.ceil(ids.length / cfg.batchSize);
    write(`\n=== GET (weryfikacja): ${ids.length} produktów w ${total} paczkach ===`, 'muted');

    let matches = 0, mismatches = 0, missingCount = 0, errors = 0;
    const mismatchDetails = [];

    for (let bi = 0; bi < total; bi++) {
      const batchIds = ids.slice(bi*cfg.batchSize, (bi+1)*cfg.batchSize);
      const qs = new URLSearchParams({ identType: 'id' });
      qs.append('products', batchIds.join(','));
      const url = `${cfg.baseUrl}?${qs.toString()}`;

      const res = await gmRequest({ method: 'GET', url, apiKey: cfg.apiKey });
      if (!res.ok) {
        errors += batchIds.length;
        const msg = typeof res.data === 'string' ? res.data.slice(0,500) : JSON.stringify(res.data).slice(0,500);
        write(`[${bi+1}/${total}] GET BŁĄD HTTP ${res.status}: ${msg}`, 'err');
        if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
        continue;
      }

      for (const id of batchIds) {
        const exp = expectations.get(id);
        const actual = extractActual(res.data, id, cfg.shopId);
        if (!actual || (!actual.product && !actual.shop)) {
          missingCount++;
          mismatchDetails.push({ id, reason: 'nie znaleziono w odpowiedzi' });
          continue;
        }
        const a = actual.shop || actual.product;
        const problems = [];
        if (exp.retail != null && !pricesEqual(exp.retail, a.retail))
          problems.push(`retail oczekiwane=${exp.retail} otrzymano=${a.retail}`);
        if (exp.wholesale != null && !pricesEqual(exp.wholesale, a.wholesale))
          problems.push(`wholesale oczekiwane=${exp.wholesale} otrzymano=${a.wholesale}`);
        if (exp.mode && exp.mode !== 'no_change' && !modesEqual(exp.mode, a.mode))
          problems.push(`mode oczekiwane=${exp.mode} otrzymano=${a.mode}`);
        if (problems.length) { mismatches++; mismatchDetails.push({ id, reason: problems.join('; ') }); }
        else matches++;
      }
      write(`[${bi+1}/${total}] GET OK (${batchIds.length})`, 'ok');
      if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
    }

    const problemCount = mismatches + missingCount + errors;
    write(`\nWeryfikacja: zgodne=${matches}, niezgodne=${mismatches}, brak=${missingCount}, błędy=${errors}`, problemCount ? 'warn' : 'ok');
    for (const m of mismatchDetails) write(`  ✗ ${m.id}: ${m.reason}`, 'err');
  }

  // ---------- Sync from gross prices (no CSV) ----------
  // Walks an unknown object looking for "gross retail" / "gross wholesale" prices.
  // IdoSell v7 /products/search returns gross prices as flat numeric fields:
  //   productRetailPrice, productWholesalePrice.
  // Also tolerate nested variants as a fallback.
  function extractGrossPrices(prodNode) {
    if (!prodNode || typeof prodNode !== 'object') return { retail: null, wholesale: null };
    const toNum = v => (v != null && Number.isFinite(Number(v))) ? Number(v) : null;

    // Flat fields (primary shape).
    let retail = toNum(prodNode.productRetailPrice);
    let wholesale = toNum(prodNode.productWholesalePrice);
    if (retail == null) retail = toNum(prodNode.priceRetail);
    if (wholesale == null) wholesale = toNum(prodNode.priceWholesale);

    // Nested fallbacks.
    const resolve = (node, path) => path.reduce((n, k) => (n && typeof n === 'object') ? n[k] : undefined, node);
    const nestedRetail = [
      ['productRetailPrice', 'gross'], ['productRetailPrice', 'price'],
      ['priceRetail', 'gross'], ['priceRetail', 'price'], ['price', 'retail'],
      ['prices', 'retail', 'gross'],
    ];
    const nestedWholesale = [
      ['productWholesalePrice', 'gross'], ['productWholesalePrice', 'price'],
      ['priceWholesale', 'gross'], ['priceWholesale', 'price'], ['price', 'wholesale'],
      ['prices', 'wholesale', 'gross'],
    ];
    if (retail == null) for (const path of nestedRetail) { const v = toNum(resolve(prodNode, path)); if (v != null) { retail = v; break; } }
    if (wholesale == null) for (const path of nestedWholesale) { const v = toNum(resolve(prodNode, path)); if (v != null) { wholesale = v; break; } }

    return { retail, wholesale };
  }

  async function fetchAllProducts(cfg) {
    const url = `https://${cfg.domain}/api/admin/v7/products/products/search`;
    const all = [];
    let page = 0, pages = 1;
    const limit = 100;

    write(`\n=== Pobieranie listy produktów z /products/search ===`, 'muted');

    while (page < pages) {
      const body = { params: { resultsPage: page, resultsLimit: limit } };
      const res = await gmRequest({ method: 'POST', url, apiKey: cfg.apiKey, body });
      if (!res.ok) {
        const msg = typeof res.data === 'string' ? res.data.slice(0,1000) : JSON.stringify(res.data).slice(0,1000);
        write(`Strona ${page}: BŁĄD HTTP ${res.status}: ${msg}`, 'err');
        throw new Error(`search HTTP ${res.status}`);
      }

      if (cfg.debug && page === 0) {
        const first = (Array.isArray(res.data?.results) ? res.data.results[0] : null)
          || (Array.isArray(res.data?.products) ? res.data.products[0] : null);
        if (first) {
          write(`  TOP-LEVEL KEYS:`, 'muted');
          write(Object.keys(first).join(', '), 'muted');
          const priceLike = {};
          for (const [k, v] of Object.entries(first)) {
            if (/price|retail|wholesale|stock|shops|gross|net/i.test(k)) priceLike[k] = v;
          }
          write(`  PRICE-LIKE FIELDS (JSON):`, 'muted');
          write(JSON.stringify(priceLike, null, 2).slice(0, 8000), 'muted');
        }
      }

      // Try common result container shapes.
      const list = res.data?.results || res.data?.products || res.data?.Results || [];
      const arr = Array.isArray(list) ? list : Object.values(list);
      for (const item of arr) {
        const id = item?.productId ?? item?.id ?? item?.product?.id ?? item?.ident?.value;
        if (id == null) continue;
        const { retail, wholesale } = extractGrossPrices(item);
        // Treat zero as "not set" so we never push 0 as an omnibus price.
        const r = (retail != null && retail > 0) ? retail : null;
        // If wholesale is missing/zero, fall back to retail (per user requirement).
        let w = (wholesale != null && wholesale > 0) ? wholesale : null;
        if (w == null && r != null) w = r;
        all.push({ id: String(id), retail: r, wholesale: w });
      }

      const meta = res.data?.resultsNumberAll ?? res.data?.resultsAll;
      const pagesMeta = res.data?.resultsNumberPage ?? res.data?.resultsPages;
      if (pagesMeta != null) pages = Number(pagesMeta);
      else if (meta != null) pages = Math.ceil(Number(meta) / limit);
      else pages = arr.length === limit ? page + 2 : page + 1;

      write(`[strona ${page+1}/${pages}] zebrano ${arr.length} produktów (łącznie ${all.length})`, 'ok');
      page++;
      if (page < pages && cfg.delay) await sleep(cfg.delay);
    }

    const withPrices = all.filter(p => p.retail != null || p.wholesale != null);
    write(`Łącznie: ${all.length} produktów, z cenami brutto: ${withPrices.length}`, (all.length - withPrices.length) ? 'warn' : 'ok');
    return withPrices;
  }

  async function fetchCurrentOmnibus(cfg, ids) {
    const total = Math.ceil(ids.length / cfg.batchSize);
    write(`\n=== GET aktualne omnibus: ${ids.length} produktów w ${total} paczkach ===`, 'muted');
    const current = new Map(); // id -> { retail, wholesale, mode }
    const structures = new Map(); // id -> { shops: [{shopId, sizeIds}] }

    for (let bi = 0; bi < total; bi++) {
      const batchIds = ids.slice(bi*cfg.batchSize, (bi+1)*cfg.batchSize);
      const qs = new URLSearchParams({ identType: 'id' });
      qs.append('products', batchIds.join(','));
      const url = `${cfg.baseUrl}?${qs.toString()}`;

      const res = await gmRequest({ method: 'GET', url, apiKey: cfg.apiKey });
      if (!res.ok) {
        const msg = typeof res.data === 'string' ? res.data.slice(0,500) : JSON.stringify(res.data).slice(0,500);
        write(`[${bi+1}/${total}] BŁĄD HTTP ${res.status}: ${msg}`, 'err');
        if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
        continue;
      }
      const structs = parseStructure(res.data);
      for (const id of batchIds) {
        const s = structs.get(id);
        if (s) structures.set(id, s);
        const actual = extractActual(res.data, id, cfg.shopId);
        if (actual) {
          const a = actual.shop || actual.product;
          if (a) current.set(id, a);
        }
      }
      write(`[${bi+1}/${total}] OK (${batchIds.length})`, 'ok');
      if (bi < total-1 && cfg.delay) await sleep(cfg.delay);
    }
    return { current, structures };
  }

  // Build only the omnibus prices object, skipping zero/null values.
  function buildOmnibusPrices(mode, retail, wholesale) {
    const o = {};
    if (mode) o.omnibusPriceManagement = mode;
    if (retail != null && retail > 0) o.omnibusPriceRetail = retail;
    if (wholesale != null && wholesale > 0) o.omnibusPriceWholesale = wholesale;
    return o;
  }

  // PUT #1 payload: sizes only, manual + prices. No top-level omnibusPrices, no shops.
  function buildSizesOnlyProduct(id, struct, mode, retail, wholesale) {
    const omnibus = buildOmnibusPrices(mode, retail, wholesale);
    const sizeIdSet = new Set();
    if (struct && struct.shops) {
      for (const s of struct.shops) for (const sid of s.sizeIds) sizeIdSet.add(sid);
    }
    if (!sizeIdSet.size) return null;
    return {
      ident: { type: 'id', value: String(id) },
      sizes: [...sizeIdSet].map(sid => ({
        ident: { type: 'id', value: String(sid) },
        omnibusPrices: { ...omnibus },
      })),
    };
  }

  // PUT #2 payload: top-level omnibusPrices + shops only, manual + prices. No sizes.
  function buildProductOnlyProduct(id, struct, fallbackShopId, mode, retail, wholesale) {
    const omnibus = buildOmnibusPrices(mode, retail, wholesale);
    const shops = (struct && struct.shops && struct.shops.length)
      ? struct.shops.map(s => ({ shopId: Number(s.shopId), omnibusPrices: { ...omnibus } }))
      : [ { shopId: Number(fallbackShopId), omnibusPrices: { ...omnibus } } ];
    return {
      ident: { type: 'id', value: String(id) },
      omnibusPrices: omnibus,
      shops,
    };
  }

  // PUT #3 payload: switch mode back to automatic. No prices, product + shops (and sizes).
  function buildAutoModeProduct(id, struct, fallbackShopId) {
    const m = { omnibusPriceManagement: 'automatic' };
    const shops = (struct && struct.shops && struct.shops.length)
      ? struct.shops.map(s => ({ shopId: Number(s.shopId), omnibusPrices: { ...m } }))
      : [ { shopId: Number(fallbackShopId), omnibusPrices: { ...m } } ];
    const sizeIdSet = new Set();
    if (struct && struct.shops) {
      for (const s of struct.shops) for (const sid of s.sizeIds) sizeIdSet.add(sid);
    }
    const product = {
      ident: { type: 'id', value: String(id) },
      omnibusPrices: { ...m },
      shops,
    };
    if (sizeIdSet.size) {
      product.sizes = [...sizeIdSet].map(sid => ({
        ident: { type: 'id', value: String(sid) },
        omnibusPrices: { ...m },
      }));
    }
    return product;
  }

  async function runSync() {
    logEl.innerHTML = '';
    $('om-run').disabled = true;
    $('om-verify-only').disabled = true;
    $('om-sync').disabled = true;
    try {
      const cfg = readConfig();
      write(`URL: ${cfg.baseUrl}`, 'muted');
      write(`shopId: ${cfg.shopId}, batch: ${cfg.batchSize}, delay: ${cfg.delay}ms${cfg.dryRun?', DRY RUN':''}`, 'muted');

      // 1) Fetch products + gross prices from /products/search.
      const products = await fetchAllProducts(cfg);
      if (!products.length) { write('Brak produktów do przetworzenia.', 'err'); return; }

      if (cfg.testOnly) {
        products.splice(1);
        write(`TEST MODE: tylko 1. produkt (id=${products[0].id})`, 'warn');
      }

      // 2) Fetch current omnibus + structures in one pass.
      const ids = products.map(p => p.id);
      const { current, structures } = await fetchCurrentOmnibus(cfg, ids);

      // 3) Find products where omnibus doesn't match gross.
      const needsUpdate = [];
      for (const p of products) {
        const cur = current.get(p.id);
        const curRetail = cur ? cur.retail : null;
        const curWholesale = cur ? cur.wholesale : null;
        const retailMatch = p.retail == null || pricesEqual(p.retail, curRetail);
        const wholesaleMatch = p.wholesale == null || pricesEqual(p.wholesale, curWholesale);
        if (!retailMatch || !wholesaleMatch) {
          needsUpdate.push(p);
        }
      }
      write(`\nDo aktualizacji: ${needsUpdate.length} / ${products.length}`, needsUpdate.length ? 'warn' : 'ok');
      if (!needsUpdate.length) { write('Wszystkie ceny omnibus są zgodne z cenami brutto.', 'ok'); return; }

      if (cfg.dryRun) {
        write(`
=== DRY RUN — przykładowe payloady dla pierwszego produktu ===`, 'muted');
        const p = needsUpdate[0];
        const s = structures.get(p.id);
        const p1 = buildSizesOnlyProduct(p.id, s, 'manual', p.retail, p.wholesale);
        const p2 = buildProductOnlyProduct(p.id, s, cfg.shopId, 'manual', p.retail, p.wholesale);
        const p3 = buildAutoModeProduct(p.id, s, cfg.shopId);
        write('PUT #1 (sizes, manual + ceny): ' + JSON.stringify({ params: { products: [p1 ?? { ident:{type:'id',value:p.id}, sizes:[] }] } }, null, 2), 'muted');
        write('PUT #2 (product + shops, manual + ceny): ' + JSON.stringify({ params: { products: [p2] } }, null, 2), 'muted');
        write('PUT #3 (powrót na automatic): ' + JSON.stringify({ params: { products: [p3] } }, null, 2), 'muted');
        return;
      }

      // PUT #1: sizes only, manual + gross prices.
      const sizeProducts = needsUpdate
        .map(p => buildSizesOnlyProduct(p.id, structures.get(p.id), 'manual', p.retail, p.wholesale))
        .filter(Boolean);
      if (sizeProducts.length) {
        const r1 = await doPut(cfg, sizeProducts, `PUT #1 (sizes, manual + ceny) — ${sizeProducts.length} produktów z rozmiarami`);
        write(`
PUT #1 zakończony. OK: ${r1.ok}, błędnych: ${r1.fail}.`, r1.fail ? 'warn' : 'ok');
      } else {
        write(`
PUT #1 pominięty: żaden z produktów nie ma rozmiarów.`, 'muted');
      }

      // PUT #2: product-level only (no sizes), manual + gross prices.
      const productOnly = needsUpdate.map(p => buildProductOnlyProduct(
        p.id, structures.get(p.id), cfg.shopId, 'manual', p.retail, p.wholesale
      ));
      const r2 = await doPut(cfg, productOnly, 'PUT #2 (product + shops, manual + ceny)');
      write(`
PUT #2 zakończony. OK: ${r2.ok}, błędnych: ${r2.fail}.`, r2.fail ? 'warn' : 'ok');

      // Interim verification: what actually stuck before switching back to automatic.
      write(`
=== Weryfikacja pośrednia (po PUT #2, przed ewentualnym powrotem na auto) ===`, 'muted');
      const expectations = new Map(needsUpdate.map(p => [p.id, { retail: p.retail, wholesale: p.wholesale, mode: 'manual' }]));
      await doVerify(cfg, expectations);

      // PUT #3: switch mode back to automatic (no prices).
      if (cfg.switchToAuto) {
        const autoProducts = needsUpdate.map(p => buildAutoModeProduct(p.id, structures.get(p.id), cfg.shopId));
        const r3 = await doPut(cfg, autoProducts, 'PUT #3 (powrót na automatic)');
        write(`
PUT #3 zakończony. OK: ${r3.ok}, błędnych: ${r3.fail}.`, r3.fail ? 'warn' : 'ok');

        write(`
=== Weryfikacja końcowa (po powrocie na auto) ===`, 'muted');
        const expectations2 = new Map(needsUpdate.map(p => [p.id, { retail: p.retail, wholesale: p.wholesale, mode: 'no_change' }]));
        await doVerify(cfg, expectations2);
      } else {
        write(`
PUT #3 pominięty (checkbox "Powrót na automatic" wyłączony).`, 'muted');
      }
    } catch (e) {
      write(`BŁĄD: ${e.message}`, 'err');
    } finally {
      validate();
    }
  }

  async function runPipeline(mode) {
    logEl.innerHTML = '';
    $('om-run').disabled = true;
    $('om-verify-only').disabled = true;
    try {
      const cfg = readConfig();
      write(`URL: ${cfg.baseUrl}`, 'muted');
      write(`shopId: ${cfg.shopId}, batch: ${cfg.batchSize}, delay: ${cfg.delay}ms${cfg.dryRun?', DRY RUN':''}`, 'muted');

      const { csvRows, skipped } = await loadCsv(cfg);
      if (skipped.length) write(`Pominięto wierszy: ${skipped.length} (${skipped.slice(0,5).map(s=>`l.${s.line}:${s.reason}`).join(', ')}${skipped.length>5?'…':''})`, 'warn');
      if (!csvRows.length) { write('Brak prawidłowych wierszy CSV.', 'err'); return; }
      if (cfg.testOnly) {
        csvRows.splice(1);
        write(`TEST MODE: tylko 1. produkt (id=${csvRows[0].id})`, 'warn');
      }

      const expectations = new Map(csvRows.map(r => [r.id, { retail: r.retail, wholesale: r.wholesale, mode: r.mode }]));

      if (mode === 'put') {
        const ids = csvRows.map(r => r.id);
        const structures = await prefetchStructure(cfg, ids);

        const productsFull = csvRows.map(r => buildProductFromStructure(r, structures.get(r.id), cfg.shopId));
        const r1 = await doPut(cfg, productsFull, 'PUT #1 (product + shops + sizes)');
        write(`\nPUT #1 zakończony. OK: ${r1.ok}, błędnych: ${r1.fail}.`, r1.fail?'warn':'ok');

        const productsShop = csvRows.map(r => buildShopOnlyProduct(r, structures.get(r.id), cfg.shopId));
        const r2 = await doPut(cfg, productsShop, 'PUT #2 (shop-only)');
        write(`\nPUT #2 zakończony. OK: ${r2.ok}, błędnych: ${r2.fail}.`, r2.fail?'warn':'ok');

        if (cfg.verify && !cfg.dryRun) await doVerify(cfg, expectations);
      } else {
        await doVerify(cfg, expectations);
      }
    } catch (e) {
      write(`BŁĄD: ${e.message}`, 'err');
    } finally {
      validate();
    }
  }

  $('om-run').addEventListener('click', () => runPipeline('put'));
  $('om-verify-only').addEventListener('click', () => runPipeline('verify'));
  $('om-sync').addEventListener('click', runSync);
})();
