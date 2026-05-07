// ==UserScript==
// @name         IdoSell - Eksport klientow do CSV (v8 API)
// @namespace    https://idosell.com/
// @version      1.2
// @description  Pobiera liste wszystkich klientow z API IdoSell v8 (CRM + profil + adresy dostawy), tlumaczy kody krajow na nazwy polskie, generuje CSV zgodny z customers_with_billing
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
    // Juz nazwa (4+ liter, niekod)
    if (s.length >= 4) return s;
    return COUNTRY_NAMES[s.toLowerCase()] || s;
  }

  // ── Pomocnicze ────────────────────────────────────────────────────────────
  const PL_COUNTRY_VALUES = new Set(['pl','pol','polska','poland','92','616']);
  function isPoland(v) {
    if (v == null || v === '') return false;
    return PL_COUNTRY_VALUES.has(String(v).trim().toLowerCase());
  }

  function extractItems(resp) {
    if (!resp || typeof resp !== 'object') return { items: [], key: null };
    const known = ['clientsResults','results','Results','clients','data','items','clientsList','crm','crmClients','clientsData'];
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

  // ── HTTP przez GM_xmlhttpRequest ──────────────────────────────────────────
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
  function mapClient(c, addr, defaultShop) {
    const clientType = String(pick(c, 'clientType') || '').toLowerCase();
    const isCompany = clientType === 'firm' || clientType === 'company' ||
                      !!pick(c, 'clientFirm','clientCompany','clientCompanyName');

    const wholesalerVal = String(pick(c, 'clientIsWholesaler','clientWholesaler') || '').toLowerCase();
    const isWholesaler = wholesalerVal === 'yes' || wholesalerVal === '1' || wholesalerVal === 'true';

    const blockedVal = pick(c, 'clientIsBlocked','isBlocked');
    const isBlocked = blockedVal === true || String(blockedVal).toLowerCase() === 'yes' || blockedVal === '1';
    const active = isBlocked ? 'n' : 'y';

    // Newsletter approval per shop — szukamy WPISU dla wskazanego shopId.
    // Brak wpisu lub data "0000-00-00 00:00:00" → niezapisany w naszym sklepie.
    function shopApproval(arr, key) {
      if (!Array.isArray(arr) || !arr.length) return false;
      const entry = arr.find(x => String(x.shopId) === String(defaultShop));
      if (!entry) return false;
      const v = entry[key];
      return !!(v && v !== '0000-00-00 00:00:00');
    }
    const mailing = shopApproval(c.newsletterEmailApprovalsData, 'inNewsletterEmailApproval');
    const sms = shopApproval(c.newsletterSmsApprovalsData, 'inNewsletterSmsApproval');

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
      country: countryName(pick(c, 'clientCountry','clientCountryName','clientCountryCode','clientCountryId','countryCode')),
      province: pick(c, 'clientProvinceId','clientProvinceName','clientProvinceCode','provinceName','province'),
      trade_credit: pick(c, 'clientTradeCredit','tradeCredit') || 0,
      email: pick(c, 'clientEmail','email'),
      phone: pick(c, 'clientPhone1','clientPhone','phone1','phone'),
      phone2: pick(c, 'clientPhone2','phone2','clientFax'),
      companyname: pick(c, 'clientFirm','clientCompany','clientCompanyName','companyName'),
      taxidnumber: pick(c, 'clientNip','clientVatNumber','clientTaxNumber','vatNumber','nip'),
      wholesaler: isWholesaler ? '1' : '',
      shop: defaultShop || pick(c, 'shopId','shop_id') || '',
      mailing: mailing ? 1 : 0,
      newsletter_sms: sms ? 1 : 0,
      language: pick(c, 'langId','clientLanguage','languageId','clientLang'),
      currency: pick(c, 'clientCurrency','currencyId','clientCurrencyId'),
      rebate: pick(c, 'clientRebate','rebate'),
      note_about_client: pick(c, 'clientNote','clientNotes','note'),
      delivery_address_firstname1: pick(addr, 'clientDeliveryAddressFirstName','shippingFirstName','firstName'),
      delivery_address_lastname1: pick(addr, 'clientDeliveryAddressLastName','shippingLastName','lastName'),
      delivery_address_companyname1: pick(addr, 'clientDeliveryAddressCompany','clientDeliveryAddressFirm','shippingCompany','company'),
      delivery_address_street1: pick(addr, 'clientDeliveryAddressStreet','shippingStreet','street'),
      delivery_address_city1: pick(addr, 'clientDeliveryAddressCity','shippingCity','city'),
      delivery_address_zipcode1: pick(addr, 'clientDeliveryAddressZipCode','shippingZipCode','zipCode'),
      delivery_address_country1: countryName(pick(addr, 'clientDeliveryAddressCountry','shippingCountry','country','countryCode')),
      delivery_address_phone1: pick(addr, 'clientDeliveryAddressPhone1','clientDeliveryAddressPhone','shippingPhone','phone')
    };
  }

  // ── Fetch listy klientow przez clients/crm/search (paginacja) ─────────────
  async function fetchAllClients(domain, apiKey, shopId, filter, log) {
    const url = `https://${domain}/api/admin/v8/clients/crm/search`;
    const limit = 100;
    let page = 0;
    const all = [];

    while (true) {
      const params = { resultsPage: page, resultsLimit: limit };
      if (shopId) {
        params.searchByShops = {
          searchModeInShops: 'one_of_selected',
          shopsIds: [Number(shopId)]
        };
      }
      if (filter === 'pl') params.clientCountryId = 'pl';
      const body = { params };

      let resp;
      try {
        resp = await apiRequest('POST', url, apiKey, body);
      } catch (e) {
        if (page === 0 && filter === 'pl') {
          // Niektore wersje API moga nie wspierac stringa w clientCountryId — sproboj numerycznie
          log('clientCountryId="pl" odrzucony, probuje 616…');
          delete params.clientCountryId;
          params.clientCountryId = 616;
          resp = await apiRequest('POST', url, apiKey, { params });
        } else throw e;
      }

      const { items, key } = extractItems(resp);
      const total = resp.resultsNumberAll ?? resp.ResultsNumberAll ?? resp.totalCount ?? all.length;
      const pages = resp.resultsNumberPage ?? resp.ResultsNumberPage ?? Math.ceil(total / limit);

      if (page === 0 && items.length) log(`(items pod kluczem "${key}", ${items.length} szt.)`);
      if (!items.length && total > 0) {
        log('UWAGA: total=' + total + ' ale items=0. Klucze: [' + Object.keys(resp).join(', ') + ']');
      }

      all.push(...items);
      log(`Strona ${page + 1}/${pages || '?'} — pobrano ${all.length}/${total} klientow.`);
      if (!items.length || all.length >= total || page + 1 >= pages) break;
      page++;
      if (page > 1000) { log('Limit 1000 stron — przerywam.'); break; }
    }
    return all;
  }

  // ── Fetch pelnych profili przez clients/clients GET (billing address) ─────
  async function fetchClientProfiles(domain, apiKey, clientIds, log) {
    if (!clientIds.length) return new Map();
    const url = `https://${domain}/api/admin/v8/clients/clients`;
    const batchSize = 100;
    const map = new Map();
    let firstSampleLogged = false;

    for (let i = 0; i < clientIds.length; i += batchSize) {
      const batch = clientIds.slice(i, i + batchSize);
      const qs = batch.map(id => `clientsIds[]=${encodeURIComponent(id)}`).join('&');
      log(`Profile: paczka ${Math.floor(i / batchSize) + 1}/${Math.ceil(clientIds.length / batchSize)}…`);
      try {
        const resp = await apiRequest('GET', `${url}?${qs}`, apiKey);
        const { items, key } = extractItems(resp);
        if (!firstSampleLogged && items.length) {
          log(`(profile pod kluczem "${key}", probka pol: ${Object.keys(items[0]).slice(0, 12).join(', ')}…)`);
          firstSampleLogged = true;
        }
        for (const it of items) {
          const cid = pick(it, 'clientId','clientID','id');
          if (cid != null && cid !== '') map.set(String(cid), it);
        }
      } catch (e) {
        // Sprobuj alternatywnej nazwy parametru
        if (i === 0) {
          const qs2 = batch.map(id => `clientIds[]=${encodeURIComponent(id)}`).join('&');
          try {
            const resp = await apiRequest('GET', `${url}?${qs2}`, apiKey);
            const { items } = extractItems(resp);
            for (const it of items) {
              const cid = pick(it, 'clientId','clientID','id');
              if (cid != null && cid !== '') map.set(String(cid), it);
            }
            log('(profile pobrano przez clientIds[] zamiast clientsIds[])');
            continue;
          } catch (e2) {
            log(`UWAGA: profile niedostepne (${e.message}). Pomijam wzbogacanie.`);
            return map;
          }
        }
        log(`UWAGA: profile paczka ${i}-${i + batch.length}: ${e.message}`);
      }
    }
    return map;
  }

  // ── Fetch adresow dostawy ─────────────────────────────────────────────────
  async function fetchDeliveryAddresses(domain, apiKey, clientIds, log) {
    if (!clientIds.length) return new Map();
    const url = `https://${domain}/api/admin/v8/clients/deliveryAddress`;
    const batchSize = 100;
    const map = new Map();
    let firstSampleLogged = false;

    for (let i = 0; i < clientIds.length; i += batchSize) {
      const batch = clientIds.slice(i, i + batchSize);
      const qs = batch.map(id => `clientIds[]=${encodeURIComponent(id)}`).join('&');
      log(`Adresy dostawy: paczka ${Math.floor(i / batchSize) + 1}/${Math.ceil(clientIds.length / batchSize)}…`);
      try {
        const resp = await apiRequest('GET', `${url}?${qs}`, apiKey);
        const { items, key } = extractItems(resp);
        if (!firstSampleLogged && items.length) {
          log(`(adresy pod kluczem "${key}", ${items.length} rekordow)`);
          firstSampleLogged = true;
        }
        for (const it of items) {
          const cid = pick(it, 'clientId','clientID','id');
          const addrs = it.clientDeliveryAddresses || it.deliveryAddresses || it.addresses || [];
          if (cid != null && addrs.length) map.set(String(cid), addrs[0]);
        }
      } catch (e) {
        log(`UWAGA: adresy paczka ${i}-${i + batch.length}: ${e.message}`);
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

        // 1. Lista klientow (CRM) — szybko, podstawowe info + ID
        const crmClients = await fetchAllClients(domain, apiKey, shopId, filter, log);
        log(`▸ CRM: pobrano ${crmClients.length} klientow.`);

        const ids = crmClients.map(c => pick(c, 'clientId','clientID','id'))
                              .filter(x => x != null && x !== '');

        // 2. Pelne profile (billing address, province, birth_date, currency itp.)
        log(`▸ Pobieram pelne profile dla ${ids.length} klientow…`);
        const profileMap = await fetchClientProfiles(domain, apiKey, ids, log);
        log(`▸ Profile: ${profileMap.size} klientow z profilem.`);

        // 3. Adresy dostawy
        log(`▸ Pobieram adresy dostawy dla ${ids.length} klientow…`);
        const addrMap = await fetchDeliveryAddresses(domain, apiKey, ids, log);
        log(`▸ Adresy dostawy: ${addrMap.size} klientow z adresem.`);

        // 4. Merge: profile nadpisuje pola CRM (ma wiecej szczegolow)
        let rows = crmClients.map(c => {
          const cid = String(pick(c, 'clientId','clientID','id'));
          const profile = profileMap.get(cid) || {};
          const merged = Object.assign({}, c, profile);
          return mapClient(merged, addrMap.get(cid), shopId);
        });

        // 5. Filtr client-side (PL/non-PL) — sprawdza nazwe lub kod
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
