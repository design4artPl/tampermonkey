// ==UserScript==
// @name         IdoSell - Eksport klientow do CSV (v8 API)
// @namespace    https://idosell.com/
// @version      1.4
// @description  Pobiera wszystkich klientow z API IdoSell v8 (clients/clients + crm/search dla notatek + deliveryAddress dla wielu adresow) i generuje CSV
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

  if (window.top !== window.self) return;
  if (document.getElementById('idosell-cust-export-btn')) return;

  // ── Statyczne kolumny CSV (delivery_address_* dodawane dynamicznie) ───────
  const STATIC_HEADERS = [
    'login','password','active','client_type','birth_date','firstname','lastname',
    'street','zipcode','city','country','province','trade_credit','email',
    'phone','phone2','companyname','taxidnumber','wholesaler','shop',
    'mailing','newsletter_sms','language','currency','rebate','note_about_client'
  ];

  function deliveryHeadersForIndex(n) {
    return [
      `delivery_address_firstname${n}`,
      `delivery_address_lastname${n}`,
      `delivery_address_companyname${n}`,
      `delivery_address_street${n}`,
      `delivery_address_city${n}`,
      `delivery_address_zipcode${n}`,
      `delivery_address_country${n}`,
      `delivery_address_phone${n}`
    ];
  }

  // ── Mapa kodow ISO 3166-1 alpha-2 -> nazwy polskie ────────────────────────
  const COUNTRY_NAMES = {
    pl:'Polska', de:'Niemcy', at:'Austria', ch:'Szwajcaria',
    fr:'Francja', it:'Wlochy', es:'Hiszpania', pt:'Portugalia',
    nl:'Holandia', be:'Belgia', lu:'Luksemburg',
    gb:'Wielka Brytania', uk:'Wielka Brytania', ie:'Irlandia',
    dk:'Dania', se:'Szwecja', no:'Norwegia', fi:'Finlandia', is:'Islandia',
    cz:'Czechy', sk:'Slowacja', hu:'Wegry', si:'Slowenia',
    hr:'Chorwacja', ro:'Rumunia', bg:'Bulgaria',
    gr:'Grecja', cy:'Cypr', mt:'Malta',
    ee:'Estonia', lv:'Lotwa', lt:'Litwa',
    ua:'Ukraina', by:'Bialorus', ru:'Rosja', md:'Moldawia',
    rs:'Serbia', me:'Czarnogora', mk:'Macedonia Polnocna',
    ba:'Bosnia i Hercegowina', al:'Albania', xk:'Kosowo',
    tr:'Turcja', li:'Liechtenstein', mc:'Monako',
    ad:'Andora', va:'Watykan', sm:'San Marino', gi:'Gibraltar',
    us:'Stany Zjednoczone', ca:'Kanada', mx:'Meksyk',
    br:'Brazylia', ar:'Argentyna', cl:'Chile',
    co:'Kolumbia', pe:'Peru', uy:'Urugwaj', ve:'Wenezuela',
    cn:'Chiny', jp:'Japonia', kr:'Korea Poludniowa', kp:'Korea Polnocna',
    in:'Indie', id:'Indonezja', th:'Tajlandia',
    vn:'Wietnam', ph:'Filipiny', my:'Malezja',
    sg:'Singapur', tw:'Tajwan', hk:'Hongkong', mo:'Makau',
    il:'Izrael', sa:'Arabia Saudyjska', ae:'Zjednoczone Emiraty Arabskie',
    qa:'Katar', kw:'Kuwejt', om:'Oman', jo:'Jordania', lb:'Liban',
    iq:'Irak', ir:'Iran', sy:'Syria', ye:'Jemen', bh:'Bahrajn',
    pk:'Pakistan', bd:'Bangladesz', lk:'Sri Lanka', np:'Nepal', af:'Afganistan',
    eg:'Egipt', za:'Republika Poludniowej Afryki', ma:'Maroko',
    ng:'Nigeria', ke:'Kenia', tn:'Tunezja', dz:'Algieria',
    ly:'Libia', sd:'Sudan', gh:'Ghana', et:'Etiopia',
    au:'Australia', nz:'Nowa Zelandia'
  };

  function countryName(v) {
    if (v == null || v === '') return '';
    const s = String(v).trim();
    if (s.length >= 4) return s;
    return COUNTRY_NAMES[s.toLowerCase()] || s;
  }

  const PL_COUNTRY_VALUES = new Set(['pl','pol','polska','poland','92','616']);
  function isPoland(v) {
    if (v == null || v === '') return false;
    return PL_COUNTRY_VALUES.has(String(v).trim().toLowerCase());
  }

  function isZeroDate(d) {
    return !d || d === '0000-00-00' || d === '0000-00-00 00:00:00';
  }

  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
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

  // ── HTTP ──────────────────────────────────────────────────────────────────
  function apiRequest(method, url, apiKey, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url,
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
        timeout: 90000
      });
    });
  }

  // ── Mapowanie pol odpowiedzi API na rekord CSV ────────────────────────────
  function mapClient(c, addrs, shopIdNum, note) {
    const billing = c.clientBillingAddress || {};
    const personal = c.clientPersonalData || {};
    const prefs = c.clientPreferences || {};
    const tc = c.clientTradeCredit || {};

    const clientType = String(c.clientType || '').toLowerCase();
    const isCompany = clientType === 'firm' || clientType === 'company' ||
                      !!(billing.clientFirm || billing.clientCompany);

    const wholesalerVal = String(prefs.clientIsWholesaler || '').toLowerCase();
    const isWholesaler = wholesalerVal === 'yes' || wholesalerVal === '1' || wholesalerVal === 'true';

    const blockedVal = c.clientIsBlocked;
    const isBlocked = blockedVal === true || String(blockedVal).toLowerCase() === 'yes' || blockedVal === '1';
    const active = isBlocked ? 'n' : 'y';

    function approvalForShop(arr, ...dateKeys) {
      if (!Array.isArray(arr) || !arr.length) return false;
      const entry = arr.find(x => String(x.shopId) === String(shopIdNum));
      if (!entry) return false;
      for (const k of dateKeys) {
        const v = entry[k];
        if (v && !isZeroDate(v)) return true;
      }
      return false;
    }
    const mailingActive = approvalForShop(c.newsletterEmailApprovalsData,
      'newsletterEmailApprovalDate', 'inNewsletterEmailApproval');
    const smsActive = approvalForShop(c.newsletterSmsApprovalsData,
      'newsletterSmsApprovalDate', 'inNewsletterSmsApproval');

    const birth = personal.clientBirthDate;
    const birthOut = (birth && !isZeroDate(birth)) ? birth : '';

    let tradeCredit = 0;
    if (tc && typeof tc === 'object') {
      const lim = tc.clientTradeCreditLimit;
      if (typeof lim === 'number') tradeCredit = lim;
      else if (typeof lim === 'string' && lim !== '') tradeCredit = lim;
    }

    const row = {
      login: c.clientLogin || '',
      password: '',
      active,
      client_type: isCompany ? 'company' : 'private',
      birth_date: birthOut,
      firstname: billing.clientFirstName || '',
      lastname: billing.clientLastName || '',
      street: billing.clientStreet || '',
      zipcode: billing.clientZipCode || '',
      city: billing.clientCity || '',
      country: countryName(billing.clientCountryId || billing.clientCountryCode || ''),
      province: billing.clientProvinceId || billing.clientProvinceName || '',
      trade_credit: tradeCredit,
      email: c.clientEmail || '',
      phone: billing.clientPhone1 || '',
      phone2: billing.clientPhone2 || '',
      companyname: billing.clientFirm || billing.clientCompany || '',
      taxidnumber: billing.clientNip || billing.clientVatNumber || '',
      wholesaler: isWholesaler ? '1' : '',
      shop: shopIdNum || '',
      mailing: mailingActive ? shopIdNum : 0,
      newsletter_sms: smsActive ? shopIdNum : 0,
      language: prefs.langId || prefs.clientLanguage || '',
      currency: prefs.currencyId || prefs.clientCurrency || '',
      rebate: '',
      note_about_client: note || ''
    };

    // Wszystkie adresy dostawy → kolumny delivery_address_*N
    if (Array.isArray(addrs)) {
      for (let i = 0; i < addrs.length; i++) {
        const a = addrs[i] || {};
        const n = i + 1;
        row[`delivery_address_firstname${n}`] = a.clientDeliveryAddressFirstName || '';
        row[`delivery_address_lastname${n}`] = a.clientDeliveryAddressLastName || '';
        row[`delivery_address_companyname${n}`] = a.clientDeliveryAddressCompany || a.clientDeliveryAddressFirm || '';
        row[`delivery_address_street${n}`] = a.clientDeliveryAddressStreet || '';
        row[`delivery_address_city${n}`] = a.clientDeliveryAddressCity || '';
        row[`delivery_address_zipcode${n}`] = a.clientDeliveryAddressZipCode || '';
        row[`delivery_address_country${n}`] = countryName(a.clientDeliveryAddressCountry || '');
        row[`delivery_address_phone${n}`] = a.clientDeliveryAddressPhone1 || a.clientDeliveryAddressPhone || '';
      }
    }

    return row;
  }

  function buildCsv(rows, maxAddrs) {
    const headers = STATIC_HEADERS.slice();
    for (let i = 1; i <= maxAddrs; i++) {
      headers.push(...deliveryHeadersForIndex(i));
    }
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of rows) {
      lines.push(headers.map(h => csvEscape(r[h])).join(','));
    }
    return '﻿' + lines.join('\r\n');
  }

  // ── Fetch klientow przez clients/clients GET (paginacja, shopId filter) ───
  async function fetchAllClients(domain, apiKey, shopId, log) {
    const limit = 100;
    let page = 0;
    const all = [];
    while (true) {
      const url = `https://${domain}/api/admin/v8/clients/clients?resultsPage=${page}&resultsLimit=${limit}` +
                  (shopId ? `&shopId=${encodeURIComponent(shopId)}` : '');
      const resp = await apiRequest('GET', url, apiKey);
      const items = Array.isArray(resp.results) ? resp.results : [];
      const total = resp.resultsNumberAll ?? all.length;
      all.push(...items);
      log(`Profile: strona ${page + 1}/${Math.ceil(total / limit) || '?'} — ${all.length}/${total} klientow.`);
      if (!items.length || all.length >= total) break;
      page++;
      if (page > 2000) { log('Limit 2000 stron — przerywam.'); break; }
    }
    return all;
  }

  // ── Fetch notatek z crm/search (clientId -> clientNote) ───────────────────
  async function fetchClientNotes(domain, apiKey, shopId, log) {
    const url = `https://${domain}/api/admin/v8/clients/crm/search`;
    const limit = 100;
    let page = 0;
    const noteMap = new Map();
    while (true) {
      const params = { resultsPage: page, resultsLimit: limit };
      if (shopId) {
        params.searchByShops = {
          searchModeInShops: 'one_of_selected',
          shopsIds: [Number(shopId)]
        };
      }
      const resp = await apiRequest('POST', url, apiKey, { params });
      const items = Array.isArray(resp.clientsResults) ? resp.clientsResults : [];
      const total = resp.resultsNumberAll ?? 0;
      for (const it of items) {
        if (it.clientId != null && it.clientNote) {
          noteMap.set(String(it.clientId), it.clientNote);
        }
      }
      log(`Notatki: strona ${page + 1}/${Math.ceil(total / limit) || '?'} — przejrzano ${(page + 1) * limit}/${total}, znaleziono ${noteMap.size}.`);
      if (!items.length || (page + 1) * limit >= total) break;
      page++;
      if (page > 2000) break;
    }
    return noteMap;
  }

  // ── Fetch WSZYSTKICH adresow dostawy (clientIds=1,2,3 — comma-separated) ──
  async function fetchDeliveryAddresses(domain, apiKey, clientIds, log) {
    if (!clientIds.length) return new Map();
    const baseUrl = `https://${domain}/api/admin/v8/clients/deliveryAddress`;
    const batchSize = 100;
    const map = new Map();
    let totalAddrs = 0;

    for (let i = 0; i < clientIds.length; i += batchSize) {
      const batch = clientIds.slice(i, i + batchSize);
      const url = `${baseUrl}?clientIds=${batch.join(',')}`;
      log(`Adresy: paczka ${Math.floor(i / batchSize) + 1}/${Math.ceil(clientIds.length / batchSize)}…`);
      try {
        const resp = await apiRequest('GET', url, apiKey);
        const items = Array.isArray(resp.results) ? resp.results : [];
        for (const it of items) {
          const cid = it.clientId;
          const addrs = it.clientDeliveryAddresses || [];
          if (cid != null && addrs.length) {
            map.set(String(cid), addrs);
            totalAddrs += addrs.length;
          }
        }
      } catch (e) {
        log(`UWAGA: adresy paczka ${i}: ${e.message}`);
      }
    }
    log(`Adresy dostawy: ${map.size} klientow / ${totalAddrs} adresow lacznie.`);
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
  #idosell-cust-modal input,#idosell-cust-modal select{width:100%;padding:7px 10px;border:1px solid #ccc;
    border-radius:4px;font:13px monospace;box-sizing:border-box}
  #idosell-cust-modal select{font:13px system-ui,sans-serif}
  #idosell-cust-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  #idosell-cust-modal button{padding:8px 16px;border:none;border-radius:4px;cursor:pointer;
    font:600 13px system-ui,sans-serif}
  #idosell-cust-modal .primary{background:#0066cc;color:#fff}
  #idosell-cust-modal .primary:hover{background:#0052a3}
  #idosell-cust-modal .primary:disabled{background:#999;cursor:not-allowed}
  #idosell-cust-modal .secondary{background:#eee;color:#222}
  #idosell-cust-log{margin-top:12px;background:#0f1419;color:#7ce38b;padding:8px;
    border-radius:4px;font:12px monospace;max-height:240px;overflow:auto;display:none;white-space:pre-wrap}
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
        <select id="cust-filter">
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

        // 1. Pelne profile (clients/clients GET, shopId filter)
        const clients = await fetchAllClients(domain, apiKey, shopId, log);
        log(`▸ Pobrano ${clients.length} pelnych profili.`);

        // 2. Notatki klientow (crm/search z searchByShops one_of_selected)
        const noteMap = await fetchClientNotes(domain, apiKey, shopId, log);
        log(`▸ Notatki: ${noteMap.size} klientow z notatka.`);

        // 3. Wszystkie adresy dostawy
        const ids = clients.map(c => c.clientId).filter(x => x != null && x !== '');
        log(`▸ Pobieram adresy dostawy dla ${ids.length} klientow…`);
        const addrMap = await fetchDeliveryAddresses(domain, apiKey, ids, log);

        // 4. Mapowanie + obliczenie max liczby adresow dostawy
        let maxAddrs = 0;
        let rows = clients.map(c => {
          const cid = String(c.clientId);
          const addrs = addrMap.get(cid) || [];
          if (addrs.length > maxAddrs) maxAddrs = addrs.length;
          return mapClient(c, addrs, shopId, noteMap.get(cid));
        });
        log(`▸ Maks. liczba adresow dostawy u jednego klienta: ${maxAddrs}.`);

        // 5. Filtr po kraju
        if (filter === 'pl') {
          const before = rows.length;
          rows = rows.filter(r => isPoland(r.country));
          log(`▸ Filtr "tylko PL": ${before} → ${rows.length} wierszy.`);
        } else if (filter === 'nonpl') {
          const before = rows.length;
          rows = rows.filter(r => !isPoland(r.country) && r.country !== '');
          log(`▸ Filtr "bez PL": ${before} → ${rows.length} wierszy.`);
        }

        const suffix = filter === 'pl' ? '_PL' : (filter === 'nonpl' ? '_nonPL' : '');
        const csv = buildCsv(rows, maxAddrs);
        const fname = `customers_with_billing${suffix}_${todayStamp()}.csv`;
        downloadFile(fname, csv);
        log(`▸ Gotowe — pobrano plik ${fname} (${rows.length} wierszy, ${STATIC_HEADERS.length + maxAddrs * 8} kolumn).`);
        goBtn.textContent = 'Pobierz ponownie';
        goBtn.disabled = false;
      } catch (e) {
        log(`BLAD: ${e.message}`);
        goBtn.disabled = false; goBtn.textContent = 'Pobierz klientow';
      }
    };
  }
})();
