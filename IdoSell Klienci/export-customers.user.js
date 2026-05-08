// ==UserScript==
// @name         IdoSell - Export/Compare klientow miedzy panelami (v8 API)
// @namespace    https://idosell.com/
// @version      1.7
// @description  Export klientow z panelu zrodlowego (API lub CSV) i porownanie z panelem docelowym — bez filtra sklepu w target by domyslnie (klienci z shops=[] nie byli pomijani)
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

  // ── Statyczne kolumny CSV ─────────────────────────────────────────────────
  const STATIC_HEADERS = [
    'login','password','active','client_type','birth_date','firstname','lastname',
    'street','zipcode','city','country','province','trade_credit','email',
    'phone','phone2','companyname','taxidnumber','wholesaler','shop',
    'mailing','newsletter_sms','language','currency','rebate','note_about_client'
  ];

  function deliveryHeadersForIndex(n) {
    return [
      `delivery_address_firstname${n}`, `delivery_address_lastname${n}`,
      `delivery_address_companyname${n}`, `delivery_address_street${n}`,
      `delivery_address_city${n}`, `delivery_address_zipcode${n}`,
      `delivery_address_country${n}`, `delivery_address_phone${n}`
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

  // ── Normalizacja adresu do porownywania po tresci ─────────────────────────
  function normAddr(a) {
    return [
      String(a.street || '').trim().toLowerCase().replace(/\s+/g, ' '),
      String(a.city || '').trim().toLowerCase().replace(/\s+/g, ' '),
      String(a.zipcode || '').trim().replace(/[\s-]/g, '').toLowerCase(),
      String(a.country || '').trim().toLowerCase()
    ].join('|');
  }

  // ── CSV parser (dla wgranego pliku zrodlowego) ────────────────────────────
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.split(/\r\n|\n/).filter(l => l.length);
    if (!lines.length) return { headers: [], rows: [] };
    const commaCount = (lines[0].match(/,/g) || []).length;
    const semiCount = (lines[0].match(/;/g) || []).length;
    const delim = semiCount > commaCount ? ';' : ',';
    function parseLine(line) {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i+1] === '"') { cur += '"'; i++; }
          else q = !q;
        } else if (ch === delim && !q) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    }
    const headers = parseLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseLine(lines[i]);
      const obj = {};
      headers.forEach((h, j) => { obj[h] = (vals[j] != null ? vals[j] : '').trim(); });
      rows.push(obj);
    }
    return { headers, rows };
  }

  // ── Wyciagniecie adresow z wiersza CSV (delivery_address_*1..N) ───────────
  function extractAddressesFromRow(row) {
    const addrs = [];
    let n = 1;
    while (true) {
      const fk = `delivery_address_firstname${n}`;
      if (!(fk in row)) break;
      const a = {
        firstname: row[`delivery_address_firstname${n}`] || '',
        lastname: row[`delivery_address_lastname${n}`] || '',
        company: row[`delivery_address_companyname${n}`] || '',
        street: row[`delivery_address_street${n}`] || '',
        city: row[`delivery_address_city${n}`] || '',
        zipcode: row[`delivery_address_zipcode${n}`] || '',
        country: row[`delivery_address_country${n}`] || '',
        phone: row[`delivery_address_phone${n}`] || ''
      };
      if (a.street || a.city || a.zipcode) addrs.push(a);
      n++;
    }
    return addrs;
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
          } else reject(new Error(`HTTP ${r.status}: ${r.responseText.slice(0, 500)}`));
        },
        onerror: () => reject(new Error('Blad sieci')),
        ontimeout: () => reject(new Error('Timeout')),
        timeout: 90000
      });
    });
  }

  // ── Mapowanie API -> wiersz CSV ────────────────────────────────────────────
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
      login: c.clientLogin || '', password: '', active,
      client_type: isCompany ? 'company' : 'private',
      birth_date: birthOut,
      firstname: billing.clientFirstName || '', lastname: billing.clientLastName || '',
      street: billing.clientStreet || '', zipcode: billing.clientZipCode || '',
      city: billing.clientCity || '',
      country: countryName(billing.clientCountryId || billing.clientCountryCode || ''),
      province: billing.clientProvinceId || billing.clientProvinceName || '',
      trade_credit: tradeCredit,
      email: c.clientEmail || '',
      phone: billing.clientPhone1 || '', phone2: billing.clientPhone2 || '',
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

  function buildCsvFromRows(rows, maxAddrs) {
    const headers = STATIC_HEADERS.slice();
    for (let i = 1; i <= maxAddrs; i++) headers.push(...deliveryHeadersForIndex(i));
    const lines = [headers.map(csvEscape).join(',')];
    for (const r of rows) lines.push(headers.map(h => csvEscape(r[h] != null ? r[h] : '')).join(','));
    return '﻿' + lines.join('\r\n');
  }

  // ── Fetchery z API ────────────────────────────────────────────────────────
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
      log(`  Profile: strona ${page + 1}/${Math.ceil(total / limit) || '?'} — ${all.length}/${total}`);
      if (!items.length || all.length >= total) break;
      page++;
      if (page > 2000) break;
    }
    return all;
  }

  async function fetchClientNotes(domain, apiKey, shopId, log) {
    const url = `https://${domain}/api/admin/v8/clients/crm/search`;
    const limit = 100;
    let page = 0;
    const noteMap = new Map();
    while (true) {
      const params = { resultsPage: page, resultsLimit: limit };
      if (shopId) {
        params.searchByShops = { searchModeInShops: 'one_of_selected', shopsIds: [Number(shopId)] };
      }
      const resp = await apiRequest('POST', url, apiKey, { params });
      const items = Array.isArray(resp.clientsResults) ? resp.clientsResults : [];
      const total = resp.resultsNumberAll ?? 0;
      for (const it of items) {
        if (it.clientId != null && it.clientNote) noteMap.set(String(it.clientId), it.clientNote);
      }
      log(`  Notatki: strona ${page + 1}/${Math.ceil(total / limit) || '?'} — znaleziono ${noteMap.size}`);
      if (!items.length || (page + 1) * limit >= total) break;
      page++;
      if (page > 2000) break;
    }
    return noteMap;
  }

  async function fetchDeliveryAddresses(domain, apiKey, clientIds, log) {
    if (!clientIds.length) return new Map();
    const baseUrl = `https://${domain}/api/admin/v8/clients/deliveryAddress`;
    const batchSize = 100;
    const map = new Map();
    let totalAddrs = 0;
    for (let i = 0; i < clientIds.length; i += batchSize) {
      const batch = clientIds.slice(i, i + batchSize);
      const url = `${baseUrl}?clientIds=${batch.join(',')}`;
      log(`  Adresy: paczka ${Math.floor(i / batchSize) + 1}/${Math.ceil(clientIds.length / batchSize)}`);
      try {
        const resp = await apiRequest('GET', url, apiKey);
        const items = Array.isArray(resp.results) ? resp.results : [];
        for (const it of items) {
          const cid = it.clientId;
          const addrs = it.clientDeliveryAddresses || [];
          if (cid != null && addrs.length) { map.set(String(cid), addrs); totalAddrs += addrs.length; }
        }
      } catch (e) { log(`  UWAGA: paczka ${i}: ${e.message}`); }
    }
    log(`  Adresy razem: ${map.size} klientow / ${totalAddrs} adresow`);
    return map;
  }

  // ── Pobranie pelnych danych z panelu (zwraca tablice wierszy CSV) ─────────
  async function fetchPanelAsRows(label, domain, apiKey, shopId, log) {
    log(`▸ [${label}] pobieram profile z ${domain} (shopId=${shopId || '-'})…`);
    const clients = await fetchAllClients(domain, apiKey, shopId, log);
    log(`▸ [${label}] profile: ${clients.length}`);
    log(`▸ [${label}] pobieram notatki…`);
    const noteMap = await fetchClientNotes(domain, apiKey, shopId, log);
    log(`▸ [${label}] notatki: ${noteMap.size}`);
    const ids = clients.map(c => c.clientId).filter(x => x != null);
    log(`▸ [${label}] pobieram adresy…`);
    const addrMap = await fetchDeliveryAddresses(domain, apiKey, ids, log);
    const rows = clients.map(c => {
      const cid = String(c.clientId);
      return mapClient(c, addrMap.get(cid) || [], shopId, noteMap.get(cid));
    });
    log(`▸ [${label}] zmapowano ${rows.length} wierszy`);
    return rows;
  }

  // ── Normalizacja klucza dopasowywania (login lub email) ───────────────────
  // Usuwa polskie znaki diakrytyczne, spacje, lowercase. Odporne na drobne roznice
  // ortograficzne miedzy panelami.
  const PL_DIACRITIC = { 'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ż':'z','ź':'z',
                          'Ą':'a','Ć':'c','Ę':'e','Ł':'l','Ń':'n','Ó':'o','Ś':'s','Ż':'z','Ź':'z' };
  function normalizeKey(v) {
    if (v == null) return '';
    return String(v).trim().toLowerCase()
      .replace(/[ąćęłńóśżźĄĆĘŁŃÓŚŻŹ]/g, ch => PL_DIACRITIC[ch] || ch)
      .replace(/\s+/g, '');
  }

  // ── Diff: source vs target ────────────────────────────────────────────────
  // Indeksujemy target po login I email (bo niektorzy klienci nie maja loginu,
  // tylko email, np. zakup goscia). Dopasowanie szukamy najpierw po loginie,
  // potem po emailu jako fallback.
  function diffSourceTarget(srcRows, tgtRows, log) {
    const tgtByLogin = new Map();
    const tgtByEmail = new Map();
    let tgtNoLogin = 0;
    for (const r of tgtRows) {
      const login = normalizeKey(r.login);
      const email = normalizeKey(r.email);
      if (login) tgtByLogin.set(login, r);
      if (email && !tgtByEmail.has(email)) tgtByEmail.set(email, r);
      if (!login) tgtNoLogin++;
    }
    if (log) {
      log(`▸ Target zindeksowany: ${tgtByLogin.size} po loginie, ${tgtByEmail.size} po emailu (${tgtNoLogin} bez loginu)`);
      const sampleLogins = Array.from(tgtByLogin.keys()).slice(0, 5);
      if (sampleLogins.length) log(`    probka loginow target: ${sampleLogins.join(', ')}`);
    }

    const missing = [];
    const updates = [];
    let matchedByLogin = 0, matchedByEmail = 0;
    const unmatched = [];

    for (const src of srcRows) {
      const login = normalizeKey(src.login);
      const email = normalizeKey(src.email);
      let tgt = null, matchType = null;
      if (login) { tgt = tgtByLogin.get(login); if (tgt) matchType = 'login'; }
      if (!tgt && email) { tgt = tgtByEmail.get(email); if (tgt) matchType = 'email'; }

      if (!tgt) {
        missing.push(src);
        if (unmatched.length < 10) unmatched.push({ login: src.login, email: src.email });
        continue;
      }
      if (matchType === 'login') matchedByLogin++; else matchedByEmail++;

      const srcAddrs = extractAddressesFromRow(src);
      const tgtAddrs = extractAddressesFromRow(tgt);
      const tgtKeys = new Set(tgtAddrs.map(normAddr));
      const newAddrs = srcAddrs.filter(a => !tgtKeys.has(normAddr(a)));
      if (newAddrs.length) {
        updates.push({ tgt, mergedAddrs: [...tgtAddrs, ...newAddrs], newCount: newAddrs.length });
      }
    }
    if (log) {
      log(`▸ Match: ${matchedByLogin} po loginie, ${matchedByEmail} po emailu, ${missing.length} bez dopasowania`);
      if (unmatched.length) {
        log(`▸ Pierwszych ${unmatched.length} niedopasowanych:`);
        for (const u of unmatched) log(`    login="${u.login}" email="${u.email}"`);
      }
    }
    return { missing, updates };
  }

  // ── Zbudowanie wiersza dla "addresses_to_add" — target billing + merged ──
  function buildUpdateRow(update) {
    const row = Object.assign({}, update.tgt);
    // wyczysc wszystkie istniejace delivery_*N
    for (const k of Object.keys(row)) {
      if (/^delivery_address_/.test(k)) delete row[k];
    }
    for (let i = 0; i < update.mergedAddrs.length; i++) {
      const a = update.mergedAddrs[i]; const n = i + 1;
      row[`delivery_address_firstname${n}`] = a.firstname;
      row[`delivery_address_lastname${n}`] = a.lastname;
      row[`delivery_address_companyname${n}`] = a.company;
      row[`delivery_address_street${n}`] = a.street;
      row[`delivery_address_city${n}`] = a.city;
      row[`delivery_address_zipcode${n}`] = a.zipcode;
      row[`delivery_address_country${n}`] = a.country;
      row[`delivery_address_phone${n}`] = a.phone;
    }
    return row;
  }

  function maxAddrsInRows(rows) {
    let max = 0;
    for (const r of rows) {
      const a = extractAddressesFromRow(r);
      if (a.length > max) max = a.length;
    }
    return max;
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  const css = `
  #idosell-cust-export-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;
    background:#0066cc;color:#fff;border:none;border-radius:24px;padding:10px 16px;
    font:600 13px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25)}
  #idosell-cust-export-btn:hover{background:#0052a3}
  #idosell-cust-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;
    display:flex;align-items:center;justify-content:center}
  #idosell-cust-modal{background:#fff;border-radius:8px;padding:18px;width:560px;max-width:94vw;
    font:13px/1.5 system-ui,sans-serif;color:#222;max-height:92vh;overflow:auto}
  #idosell-cust-modal h2{margin:0 0 10px;font-size:16px}
  #idosell-cust-modal h3{margin:14px 0 6px;font-size:13px;text-transform:uppercase;color:#666;letter-spacing:.5px}
  #idosell-cust-modal label{display:block;margin:8px 0 3px;font-weight:600;font-size:12px}
  #idosell-cust-modal input[type=text],#idosell-cust-modal input[type=password],#idosell-cust-modal select{
    width:100%;padding:6px 9px;border:1px solid #ccc;border-radius:4px;font:13px monospace;box-sizing:border-box}
  #idosell-cust-modal select{font:13px system-ui,sans-serif}
  #idosell-cust-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
  #idosell-cust-modal .row3{display:grid;grid-template-columns:2fr 1fr;gap:8px}
  #idosell-cust-modal button{padding:8px 16px;border:none;border-radius:4px;cursor:pointer;
    font:600 13px system-ui,sans-serif}
  #idosell-cust-modal .primary{background:#0066cc;color:#fff}
  #idosell-cust-modal .primary:hover{background:#0052a3}
  #idosell-cust-modal .primary:disabled{background:#999;cursor:not-allowed}
  #idosell-cust-modal .secondary{background:#eee;color:#222}
  #idosell-cust-modal .section{border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin-top:10px}
  #idosell-cust-modal .seg{display:flex;gap:4px;margin-bottom:8px}
  #idosell-cust-modal .seg button{flex:1;padding:6px 8px;background:#eee;color:#333;border-radius:4px}
  #idosell-cust-modal .seg button.active{background:#0066cc;color:#fff}
  #cust-csv-drop{border:2px dashed #ccc;border-radius:6px;padding:18px;text-align:center;color:#888;cursor:pointer}
  #cust-csv-drop.over{border-color:#0066cc;background:#eaf3ff;color:#0066cc}
  #cust-csv-drop.loaded{border-color:#0a0;background:#eaffea;color:#0a0}
  #idosell-cust-log{margin-top:12px;background:#0f1419;color:#7ce38b;padding:8px;border-radius:4px;
    font:12px monospace;max-height:240px;overflow:auto;display:none;white-space:pre-wrap}
  #idosell-cust-log.show{display:block}
  .hide{display:none!important}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'idosell-cust-export-btn';
  btn.textContent = 'Eksport/Porownanie klientow';
  btn.addEventListener('click', openModal);
  document.body.appendChild(btn);

  function openModal() {
    if (document.getElementById('idosell-cust-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'idosell-cust-overlay';

    const sd = GM_getValue('domain', location.hostname.includes('iai-shop.com') ? location.hostname : '');
    const sk = GM_getValue('apiKey', '');
    const ss = GM_getValue('shopId', '1');
    const td = GM_getValue('tgtDomain', '');
    const tk = GM_getValue('tgtApiKey', '');
    const ts = GM_getValue('tgtShopId', ''); // pusto by domyslnie - fetchujemy wszystkich klientow target panelu
    const filt = GM_getValue('countryFilter', 'all');
    const sel = (val, cur) => val === cur ? ' selected' : '';

    overlay.innerHTML = `
      <div id="idosell-cust-modal">
        <h2>IdoSell — eksport / porownanie klientow</h2>

        <div class="seg" id="cust-mode">
          <button data-mode="export" class="active">Tylko eksport</button>
          <button data-mode="compare">Porownaj z target</button>
        </div>

        <div class="section">
          <h3>Zrodlo</h3>
          <div class="seg" id="cust-src-mode">
            <button data-src="api" class="active">API</button>
            <button data-src="csv">Wgraj CSV</button>
          </div>
          <div id="cust-src-api">
            <label>Domena</label>
            <input id="cust-domain" type="text" placeholder="dermafiller.iai-shop.com" value="${sd}">
            <label>Klucz API</label>
            <input id="cust-key" type="text" placeholder="X-API-KEY" value="${sk}">
            <label>shopId</label>
            <input id="cust-shop" type="text" placeholder="1" value="${ss}">
          </div>
          <div id="cust-src-csv" class="hide">
            <div id="cust-csv-drop">Upusc plik CSV tutaj lub kliknij aby wybrac
              <input type="file" id="cust-csv-input" accept=".csv,text/csv" style="display:none">
              <div id="cust-csv-info" style="margin-top:6px;font-size:11px"></div>
            </div>
          </div>
          <label>Filtr po kraju</label>
          <select id="cust-filter">
            <option value="all"${sel('all', filt)}>Wszystkie kraje</option>
            <option value="pl"${sel('pl', filt)}>Tylko Polska</option>
            <option value="nonpl"${sel('nonpl', filt)}>Bez Polski</option>
          </select>
        </div>

        <div class="section hide" id="cust-tgt-section">
          <h3>Panel docelowy</h3>
          <label>Domena</label>
          <input id="cust-tgt-domain" type="text" placeholder="docelowy.iai-shop.com" value="${td}">
          <label>Klucz API</label>
          <input id="cust-tgt-key" type="text" placeholder="X-API-KEY" value="${tk}">
          <label>shopId (zalecane: PUSTE — patrz uwaga)</label>
          <input id="cust-tgt-shop" type="text" placeholder="puste = wszyscy klienci panelu (zalecane)" value="${ts}">
          <div style="font-size:11px;color:#a60;margin-top:4px;line-height:1.4">
            UWAGA: jesli wpiszesz shopId, klienci z <code>shops=[]</code> (nieprzypisani do zadnego sklepu)
            zostana pominieci — zafalszuje to wynik diff. Domyslnie pobieramy wszystkich.
          </div>
        </div>

        <div class="row">
          <button class="secondary" id="cust-cancel">Anuluj</button>
          <button class="primary" id="cust-go">Wykonaj</button>
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

    let mode = 'export';
    let srcMode = 'api';
    let uploadedRows = null;

    overlay.querySelectorAll('#cust-mode button').forEach(b => {
      b.onclick = () => {
        mode = b.dataset.mode;
        overlay.querySelectorAll('#cust-mode button').forEach(x => x.classList.toggle('active', x === b));
        overlay.querySelector('#cust-tgt-section').classList.toggle('hide', mode !== 'compare');
      };
    });
    overlay.querySelectorAll('#cust-src-mode button').forEach(b => {
      b.onclick = () => {
        srcMode = b.dataset.src;
        overlay.querySelectorAll('#cust-src-mode button').forEach(x => x.classList.toggle('active', x === b));
        overlay.querySelector('#cust-src-api').classList.toggle('hide', srcMode !== 'api');
        overlay.querySelector('#cust-src-csv').classList.toggle('hide', srcMode !== 'csv');
      };
    });

    // Drag & drop CSV
    const drop = overlay.querySelector('#cust-csv-drop');
    const fileIn = overlay.querySelector('#cust-csv-input');
    const info = overlay.querySelector('#cust-csv-info');
    function loadCsvFile(file) {
      const reader = new FileReader();
      reader.onload = e => {
        const { rows } = parseCsv(e.target.result);
        uploadedRows = rows;
        drop.classList.add('loaded');
        info.textContent = `Wczytano ${rows.length} wierszy z pliku ${file.name}`;
      };
      reader.readAsText(file, 'utf-8');
    }
    drop.onclick = () => fileIn.click();
    fileIn.onchange = e => { if (e.target.files[0]) loadCsvFile(e.target.files[0]); };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => {
      e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer.files[0]) loadCsvFile(e.dataTransfer.files[0]);
    };

    overlay.querySelector('#cust-cancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#cust-go').onclick = async () => {
      const sDom = overlay.querySelector('#cust-domain').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const sKey = overlay.querySelector('#cust-key').value.trim();
      const sShop = overlay.querySelector('#cust-shop').value.trim();
      const filter = overlay.querySelector('#cust-filter').value;
      const tDom = overlay.querySelector('#cust-tgt-domain').value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const tKey = overlay.querySelector('#cust-tgt-key').value.trim();
      const tShop = overlay.querySelector('#cust-tgt-shop').value.trim();

      if (srcMode === 'api' && (!sDom || !sKey)) { alert('Podaj dane panelu zrodlowego.'); return; }
      if (srcMode === 'csv' && !uploadedRows) { alert('Wgraj plik CSV.'); return; }
      if (mode === 'compare' && (!tDom || !tKey)) { alert('Podaj dane panelu docelowego.'); return; }

      GM_setValue('domain', sDom); GM_setValue('apiKey', sKey); GM_setValue('shopId', sShop);
      GM_setValue('tgtDomain', tDom); GM_setValue('tgtApiKey', tKey); GM_setValue('tgtShopId', tShop);
      GM_setValue('countryFilter', filter);

      const goBtn = overlay.querySelector('#cust-go');
      goBtn.disabled = true; goBtn.textContent = 'Pracuje…';
      try {
        // 1. Zrodlo
        let srcRows;
        if (srcMode === 'csv') {
          srcRows = uploadedRows;
          log(`▸ [SRC] z CSV: ${srcRows.length} wierszy`);
        } else {
          srcRows = await fetchPanelAsRows('SRC', sDom, sKey, sShop, log);
        }

        // 2. Filtr po kraju
        const filterFn = filter === 'pl' ? (r => isPoland(r.country))
                       : filter === 'nonpl' ? (r => !isPoland(r.country) && r.country !== '')
                       : null;
        if (filterFn) {
          const before = srcRows.length;
          srcRows = srcRows.filter(filterFn);
          log(`▸ Filtr "${filter}": ${before} → ${srcRows.length}`);
        }

        if (mode === 'export') {
          // Tylko eksport zrodla
          const maxA = maxAddrsInRows(srcRows);
          const csv = buildCsvFromRows(srcRows, maxA);
          const suf = filter === 'pl' ? '_PL' : (filter === 'nonpl' ? '_nonPL' : '');
          const fname = `customers_with_billing${suf}_${todayStamp()}.csv`;
          downloadFile(fname, csv);
          log(`▸ Gotowe: ${fname} (${srcRows.length} wierszy, ${STATIC_HEADERS.length + maxA*8} kolumn)`);
        } else {
          // Compare
          if (tShop) {
            log(`UWAGA: target z filtrem shopId=${tShop}. Klienci z shops=[] zostana pominieci — zostaw to pole puste zeby fetch zwrocil wszystkich.`);
          }
          const tgtRows = await fetchPanelAsRows('TGT', tDom, tKey, tShop, log);
          log(`▸ Diff: SRC=${srcRows.length} vs TGT=${tgtRows.length}`);
          const { missing, updates } = diffSourceTarget(srcRows, tgtRows);
          log(`▸ Brakuje w target: ${missing.length} klientow`);
          log(`▸ Klientow z nowymi adresami: ${updates.length}`);
          const totalNewAddrs = updates.reduce((s, u) => s + u.newCount, 0);
          log(`▸ Nowych adresow lacznie: ${totalNewAddrs}`);

          if (missing.length) {
            const maxA = maxAddrsInRows(missing);
            const csv = buildCsvFromRows(missing, maxA);
            const fname = `brakujacy_klienci_${todayStamp()}.csv`;
            downloadFile(fname, csv);
            log(`▸ Pobrano: ${fname} (${missing.length} wierszy)`);
          } else log(`▸ Brak klientow do utworzenia w target.`);

          if (updates.length) {
            const updRows = updates.map(buildUpdateRow);
            const maxA = maxAddrsInRows(updRows);
            const csv = buildCsvFromRows(updRows, maxA);
            const fname = `adresy_do_dodania_${todayStamp()}.csv`;
            downloadFile(fname, csv);
            log(`▸ Pobrano: ${fname} (${updRows.length} wierszy, max ${maxA} adresow)`);
          } else log(`▸ Brak nowych adresow do dodania.`);
        }
        goBtn.textContent = 'Wykonaj ponownie';
        goBtn.disabled = false;
      } catch (e) {
        log(`BLAD: ${e.message}`);
        goBtn.disabled = false; goBtn.textContent = 'Wykonaj';
      }
    };
  }
})();
