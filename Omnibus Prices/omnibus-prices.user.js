// ==UserScript==
// @name         IdoSell Omnibus Prices - Bulk Update
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      1.2.0
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
        <label><input type="checkbox" id="om-test"> Test (tylko 1. produkt z CSV)</label>
      </div>

      <div class="actions">
        <button class="action" id="om-run" disabled>PUT + weryfikacja</button>
        <button class="action secondary" id="om-verify-only" disabled>Tylko weryfikacja</button>
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
    const ready = !!($('om-domain').value.trim() && $('om-apikey').value.trim() && $('om-csv').files.length);
    $('om-run').disabled = !ready;
    $('om-verify-only').disabled = !ready;
  }
  ['om-domain','om-apikey'].forEach(id => $(id).addEventListener('input', validate));
  $('om-csv').addEventListener('change', validate);

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
    const file = $('om-csv').files[0];
    const baseUrl = `https://${domain}/api/admin/v7/products/omnibusPrices`;
    persist({ domain, apikey: apiKey, shopid: shopId, batch: batchSize, delay });
    return { domain, apiKey, shopId, batchSize, delay, dryRun, verify, debug, testOnly, file, baseUrl };
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
})();
