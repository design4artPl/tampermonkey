// ==UserScript==
// @name         IdoSell - Eksport klientow do CSV (v8 API)
// @namespace    https://idosell.com/
// @version      1.1
// @description  Pobiera liste wszystkich klientow z API IdoSell v8 wraz z adresami dostawy i generuje CSV zgodny z customers_with_billing (filtr po kraju + odporne wyciaganie items)
// @match        https://*.iai-shop.com/*
// @match        https://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Tylko jeden launcher na stronie (skrypt @match * moze odpalic sie wielokrotnie w iframe'ach)
  if (window.top !== window.self) return;
  if (document.getElementById('idosell-cust-export-btn')) return;

  // ── CSV: naglowki w dokladnej kolejnosci customers_with_billing_1.csv ──────
  const CSV_HEADERS = [
    'login','password','active','client_type','birth_date','firstname','lastname',
    'street','zipcode','city','country','province','trade_credit','email',
    'phone','phone2','companyname','taxidnumber','wholesaler','shop',
    'mailing','newsletter_sms','language','currency','rebate','note_about_client',
    'delivery_address_firstname1','delivery_address_lastname1','delivery_address_companyname1',
    'delivery_address_street1','delivery_address_city1','delivery_address_zipcode1',
    'delivery_address_country1','delivery_address_phone1'
  ];

  // ── Pomocnicze ────────────────────────────────────────────────────────────
  const PL_COUNTRY_VALUES = new Set(['pl','pol','polska','poland','92','616']);
  function isPoland(v) {
    if (v == null || v === '') return false;
    return PL_COUNTRY_VALUES.has(String(v).trim().toLowerCase());
  }

  // Zwraca najwieksza tablice obiektow w top-level odpowiedzi (lub wskazana po znanym kluczu).
  // IdoSell v8 czasem zwraca dane pod 'results', 'Results', 'clients', 'data', 'items', 'crm'.
  function extractItems(resp) {
    if (!resp || typeof resp !== 'object') return { items: [], key: null };
    const known = ['results','Results','clients','data','items','clientsList','crm','crmClients','clientsData'];
    for (const k of known) {
      if (Array.isArray(resp[k]) && resp[k].length && typeof resp[k][0] === 'object') {
        return { items: resp[k], key: k };
      }
    }
    let best = { items: [], key: null };
    for (const k of Object.keys(resp)) {
      const v = resp[k];
      if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v.length > best.items.length) {
        best = { items: v, key: k };
      }
    }
    return best;
  }

  function pick(obj, ...keys) {
    if (!obj) return '';
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), obj);
      if (v != null && v !== '') return v;
    }
    return '';
  }

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(rows) {
    const lines = [CSV_HEADERS.map(csvEscape).join(',')];
    for (const r of rows) lines.push(CSV_HEADERS.map(h => csvEscape(r[h])).join(','));
    return '﻿' + lines.join('\r\n');
  }

  function todayStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function downloadFile(name, content) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── HTTP przez GM_xmlhttpRequest (obejscie CORS) ──────────────────────────
  function apiRequest(method, url, apiKey, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          'X-API-KEY': apiKey,
          'accept': 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => {
          if (r.status >= 200 && r.status < 300) {
            try { resolve(JSON.parse(r.responseText)); }
            catch (e) { reject(new Error('Bledny JSON: ' + e.message)); }
          } else {
            reject(new Error(`HTTP ${r.status}: ${r.responseText.slice(0, 500)}`));
          }
        },
        onerror: () => reject(new Error('Blad sieci')),
        ontimeout: () => reject(new Error('Timeout')),
        timeout: 60000
      });
    });
  }

  // ── Mapowanie pol z odpowiedzi API na rekord CSV ──────────────────────────
  function mapClient(c, addr, defaultShop) {
    const isCompany = !!(pick(c, 'clientCompany','clientFirm','clientCompanyName') ||
                        pick(c, 'clientNip','clientVatNumber','clientTaxNumber'));
    const blocked = pick(c, 'clientIsBlocked','isBlocked');
    const active = blocked === true ? 'n' : 'y';

    const newsletterEmail = pick(c, 'newsletterEmailApproval','clientNewsletterEmailApproval','clientMailingApproval');
    const newsletterSms = pick(c, 'newsletterSmsApproval','clientNewsletterSmsApproval');

    return {
      login: pick(c, 'clientLogin','login'),
      password: '',
      active,
      client_type: isCompany ? 'company' : 'private',
      birth_date: pick(c, 'clientBirthDate','birthDate'),
      firstname: pick(c, 'clientFirstName','firstName'),
      lastname: pick(c, 'clientLastName','lastName'),
      street: pick(c, 'clientStreet','street'),
      zipcode: pick(c, 'clientZipCode','zipCode','clientZip'),
      city: pick(c, 'clientCity','city'),
      country: pick(c, 'clientCountryCode','clientCountryId','countryCode','clientCountry'),
      province: pick(c, 'clientProvinceName','clientProvinceCode','provinceName','province'),
      trade_credit: pick(c, 'clientTradeCredit','tradeCredit') || 0,
      email: pick(c, 'clientEmail','email'),
      phone: pick(c, 'clientPhone1','clientPhone','phone1','phone'),
      phone2: pick(c, 'clientPhone2','phone2','clientFax'),
      companyname: pick(c, 'clientCompany','clientFirm','clientCompanyName','companyName'),
      taxidnumber: pick(c, 'clientNip','clientVatNumber','clientTaxNumber','vatNumber','nip'),
      wholesaler: pick(c, 'clientWholesaler','isWholesaler') ? '1' : '',
      shop: pick(c, 'shopId','shop_id') || defaultShop || '',
      mailing: newsletterEmail === true ? 1 : (newsletterEmail === false ? 0 : ''),
      newsletter_sms: newsletterSms === true ? 1 : (newsletterSms === false ? 0 : ''),
      language: pick(c, 'clientLanguage','langId','languageId','clientLang'),
      currency: pick(c, 'clientCurrency','currencyId','clientCurrencyId'),
      rebate: pick(c, 'clientRebate','rebate'),
      note_about_client: pick(c, 'clientNote','clientNotes','note'),
      delivery_address_firstname1: pick(addr, 'shippingFirstName','firstName','clientDeliveryAddressFirstName','addressFirstName'),
      delivery_address_lastname1: pick(addr, 'shippingLastName','lastName','clientDeliveryAddressLastName','addressLastName'),
      delivery_address_companyname1: pick(addr, 'shippingCompany','company','clientDeliveryAddressCompany','addressCompany'),
      delivery_address_street1: pick(addr, 'shippingStreet','street','clientDeliveryAddressStreet','addressStreet'),
      delivery_address_city1: pick(addr, 'shippingCity','city','clientDeliveryAddressCity','addressCity'),
      delivery_address_zipcode1: pick(addr, 'shippingZipCode','zipCode','clientDeliveryAddressZipCode','addressZipCode'),
      delivery_address_country1: pick(addr, 'shippingCountry','shippingCountryCode','countryCode','clientDeliveryAddressCountry','addressCountryCode','country'),
      delivery_address_phone1: pick(addr, 'shippingPhone','phone','clientDeliveryAddressPhone','addressPhone')
    };
  }

  // ── Fetch klientow (paginacja przez crm/search) ───────────────────────────
  async function fetchAllClients(domain, apiKey, shopId, filter, log) {
    const baseUrl = `https://${domain}/api/admin/v8/clients/crm/search`;
    const limit = 100;
    let page = 0;
    const all = [];

    while (true) {
      const params = {
        resultsPage: page,
        resultsLimit: limit
      };
      if (shopId) {
        params.searchByShops = {
          searchModeInShops: 'one_of_selected',
          shopsIds: [Number(shopId)]
        };
      }
      // Server-side filter dla "tylko PL" (ISO-3166-1 numeric: Polska = 616)
      if (filter === 'pl') params.clientCountryId = 616;
      const body = { params };
      log(`Pobieram strone ${page + 1}…`);
      let resp;
      try {
        resp = await apiRequest('POST', baseUrl, apiKey, body);
      } catch (e) {
        // Fallback: GET clients/clients (na wypadek innego API shape'u)
        if (page === 0) {
          log('crm/search nie odpowiedzial (' + e.message + '), probuje GET clients/clients…');
          const getUrl = `https://${domain}/api/admin/v8/clients/clients?resultsPage=${page}&resultsLimit=${limit}` +
                        (shopId ? `&shopsIds[]=${encodeURIComponent(shopId)}` : '');
          resp = await apiRequest('GET', getUrl, apiKey);
        } else throw e;
      }

      const { items, key } = extractItems(resp);
      const total = resp.resultsNumberAll ?? resp.ResultsNumberAll ?? resp.totalCount ?? all.length;
      const pages = resp.resultsNumberPage ?? resp.ResultsNumberPage ?? Math.ceil(total / limit);

      if (page === 0 && items.length) log(`(items pod kluczem "${key}", ${items.length} szt.)`);
      if (!items.length && total > 0) {
        log('UWAGA: total=' + total + ' ale items=0. Top-level keys: [' + Object.keys(resp).join(', ') + ']');
        const sample = JSON.stringify(resp).slice(0, 500);
        log('Probka odpowiedzi: ' + sample);
      }

      all.push(...items);
      log(`Strona ${page + 1}/${pages || '?'} — pobrano ${all.length}/${total} klientow.`);
      if (!items.length || all.length >= total || page + 1 >= pages) break;
      page++;
      if (page > 1000) { log('Przekroczono limit 1000 stron — przerywam.'); break; }
    }
    return all;
  }

  // ── Fetch adresow dostawy w paczkach po N klientow ────────────────────────
  async function fetchDeliveryAddresses(domain, apiKey, clientIds, log) {
    if (!clientIds.length) return new Map();
    const url = `https://${domain}/api/admin/v8/clients/deliveryAddress`;
    const batchSize = 50;
    const map = new Map();

    for (let i = 0; i < clientIds.length; i += batchSize) {
      const batch = clientIds.slice(i, i + batchSize);
      const qs = batch.map(id => `clientIds[]=${encodeURIComponent(id)}`).join('&');
      log(`Adresy dostawy: paczka ${Math.floor(i / batchSize) + 1}/${Math.ceil(clientIds.length / batchSize)}…`);
      try {
        const resp = await apiRequest('GET', `${url}?${qs}`, apiKey);
        const { items } = extractItems(resp);
        for (const it of items) {
          const cid = pick(it, 'clientId','clientID','id');
          const addrs = it.clientDeliveryAddresses || it.deliveryAddresses ||
                        it.addresses || it.shippingAddresses || [];
          if (cid != null && addrs.length) map.set(String(cid), addrs[0]);
        }
      } catch (e) {
        log(`UWAGA: paczka ${i}-${i + batch.length} nie udala sie: ${e.message}`);
      }
    }
    return map;
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  const css = `
  #idosell-cust-export-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;
    background:#0066cc;color:#fff;border:none;border-radius:24px;padding:10px 16px;
    font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25)}
  #idosell-cust-export-btn:hover{background:#0052a3}
  #idosell-cust-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;
    display:flex;align-items:center;justify-content:center}
  #idosell-cust-modal{background:#fff;border-radius:8px;padding:20px;width:480px;max-width:92vw;
    font:13px/1.5 system-ui,sans-serif;color:#222;max-height:90vh;overflow:auto}
  #idosell-cust-modal h2{margin:0 0 14px;font-size:16px}
  #idosell-cust-modal label{display:block;margin:10px 0 4px;font-weight:600}
  #idosell-cust-modal input{width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:4px;
    font:13px monospace;box-sizing:border-box}
  #idosell-cust-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  #idosell-cust-modal button{padding:8px 16px;border:none;border-radius:4px;cursor:pointer;
    font:600 13px system-ui,sans-serif}
  #idosell-cust-modal .primary{background:#0066cc;color:#fff}
  #idosell-cust-modal .primary:hover{background:#0052a3}
  #idosell-cust-modal .primary:disabled{background:#999;cursor:not-allowed}
  #idosell-cust-modal .secondary{background:#eee;color:#222}
  #idosell-cust-log{margin-top:12px;background:#0f1419;color:#7ce38b;padding:8px;
    border-radius:4px;font:12px monospace;max-height:200px;overflow:auto;display:none;white-space:pre-wrap}
  #idosell-cust-log.show{display:block}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'idosell-cust-export-btn';
  btn.textContent = 'Eksport klientow → CSV';
  btn.addEventListener('click', openModal);
  document.body.appendChild(btn);

  function openModal() {
    if (document.getElementById('idosell-cust-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'idosell-cust-overlay';

    const savedDomain = GM_getValue('domain', location.hostname.includes('iai-shop.com') ? location.hostname : '');
    const savedKey = GM_getValue('apiKey', '');
    const savedShop = GM_getValue('shopId', '1');
    const savedFilter = GM_getValue('countryFilter', 'all');
    const sel = (val, cur) => val === cur ? ' selected' : '';

    overlay.innerHTML = `
      <div id="idosell-cust-modal">
        <h2>Eksport klientow z IdoSell API v8</h2>
        <label>Domena API</label>
        <input id="cust-domain" placeholder="dermafiller.iai-shop.com" value="${savedDomain}">
        <label>Klucz API (X-API-KEY)</label>
        <input id="cust-key" placeholder="YXBwbGljYXRpb24…" value="${savedKey}">
        <label>shopId</label>
        <input id="cust-shop" placeholder="1" value="${savedShop}">
        <label>Filtr po kraju</label>
        <select id="cust-filter" style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:4px;font:13px system-ui">
          <option value="all"${sel('all', savedFilter)}>Wszystkie kraje</option>
          <option value="pl"${sel('pl', savedFilter)}>Tylko Polska (PL)</option>
          <option value="nonpl"${sel('nonpl', savedFilter)}>Bez Polski (reszta krajow)</option>
        </select>
        <div class="row">
          <button class="secondary" id="cust-cancel">Anuluj</button>
          <button class="primary" id="cust-go">Pobierz klientow</button>
        </div>
        <div id="idosell-cust-log"></div>
      </div>`;
    document.body.appendChild(overlay);

    const logEl = overlay.querySelector('#idosell-cust-log');
    const log = (msg) => {
      logEl.classList.add('show');
      logEl.textContent += (logEl.textContent ? '\n' : '') + msg;
      logEl.scrollTop = logEl.scrollHeight;
    };

    overlay.querySelector('#cust-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#cust-go').onclick = async () => {
      const domain = overlay.querySelector('#cust-domain').value.trim()
        .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const apiKey = overlay.querySelector('#cust-key').value.trim();
      const shopId = overlay.querySelector('#cust-shop').value.trim();
      const filter = overlay.querySelector('#cust-filter').value;
      if (!domain || !apiKey) { alert('Podaj domene i klucz API.'); return; }

      GM_setValue('domain', domain);
      GM_setValue('apiKey', apiKey);
      GM_setValue('shopId', shopId);
      GM_setValue('countryFilter', filter);

      const goBtn = overlay.querySelector('#cust-go');
      goBtn.disabled = true; goBtn.textContent = 'Pobieram…';

      try {
        const filterLabels = { all: 'wszystkie kraje', pl: 'tylko PL', nonpl: 'bez PL' };
        log(`▸ Domena: ${domain}, shopId: ${shopId || '(brak)'}, filtr: ${filterLabels[filter]}`);
        const clients = await fetchAllClients(domain, apiKey, shopId, filter, log);
        log(`▸ Lacznie pobrano ${clients.length} klientow.`);

        const ids = clients.map(c => pick(c, 'clientId','clientID','id')).filter(x => x != null && x !== '');
        log(`▸ Pobieram adresy dostawy dla ${ids.length} klientow…`);
        const addrMap = await fetchDeliveryAddresses(domain, apiKey, ids, log);
        log(`▸ Adresy dostawy: ${addrMap.size} klientow z adresem.`);

        let rows = clients.map(c => {
          const cid = String(pick(c, 'clientId','clientID','id'));
          return mapClient(c, addrMap.get(cid), shopId);
        });

        // Filtr po stronie klienta (zabezpieczenie + obsluga "bez PL")
        if (filter === 'pl') {
          const before = rows.length;
          rows = rows.filter(r => isPoland(r.country));
          log(`▸ Filtr "tylko PL": ${before} → ${rows.length} wierszy.`);
        } else if (filter === 'nonpl') {
          const before = rows.length;
          rows = rows.filter(r => !isPoland(r.country));
          log(`▸ Filtr "bez PL": ${before} → ${rows.length} wierszy.`);
        }

        const suffix = filter === 'pl' ? '_PL' : (filter === 'nonpl' ? '_nonPL' : '');
        const csv = buildCsv(rows);
        const fname = `customers_with_billing${suffix}_${todayStamp()}.csv`;
        downloadFile(fname, csv);
        log(`▸ Gotowe — pobrano plik ${fname} (${rows.length} wierszy).`);
        goBtn.textContent = 'Pobierz ponownie';
        goBtn.disabled = false;
      } catch (e) {
        log(`BLAD: ${e.message}`);
        goBtn.disabled = false; goBtn.textContent = 'Pobierz klientow';
      }
    };
  }
})();
