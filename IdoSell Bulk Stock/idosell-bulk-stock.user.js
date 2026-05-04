// ==UserScript==
// @name         IdoSell - Masowe stany magazynowe
// @namespace    https://idosell.com/
// @version      1.5.15
// @description  Masowe ustawianie trybu gospodarki, stanu JEST/NIEMA, ilości na magazynach. Z uploadem CSV/XML (z size_id/size_name).
// @author       Maciej Dobroń
// @match        https://*.iai-shop.com/panel/app/products-list.php*
// @match        https://*.idosell.com/panel/app/products-list.php*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ═══════════════════════════════════════════
       HELPERS
       ═══════════════════════════════════════════ */
    function getIframeDoc() {
        const iframe = document.querySelector('iframe');
        if (!iframe) return null;
        try { return iframe.contentDocument; } catch (e) { return null; }
    }
    function getIframeWin() {
        const iframe = document.querySelector('iframe');
        if (!iframe) return null;
        try { return iframe.contentWindow; } catch (e) { return null; }
    }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function fmtTime() {
        const d = new Date();
        return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':');
    }

    function getSelectedProductIds(doc, win) {
        try {
            if (win && win.IAI && win.IAI.Table && win.IAI.Table.checkedID && win.IAI.Table.checkedID.products) {
                const ids = Object.keys(win.IAI.Table.checkedID.products).filter(id => /^\d+$/.test(id));
                if (ids.length) return ids;
            }
        } catch (e) {}
        let cbs = doc.querySelectorAll('input[type="checkbox"][name="id_products[]"]:checked');
        if (!cbs.length) cbs = doc.querySelectorAll('input[type="checkbox"][name="idt[]"]:checked');
        return Array.from(cbs).map(c => c.value).filter(v => v && v !== 'on' && /^\d+$/.test(v));
    }

    /* ═══════════════════════════════════════════
       API CALLS
       ═══════════════════════════════════════════ */
    function ajaxGet(win, url) {
        return new Promise((resolve, reject) => {
            const xhr = new win.XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ raw: xhr.responseText }); }
                } else reject(new Error('HTTP ' + xhr.status));
            };
            xhr.onerror = () => reject(new Error('Błąd sieci'));
            xhr.send();
        });
    }
    function ajaxPost(win, url, body) {
        return new Promise((resolve, reject) => {
            const xhr = new win.XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({ raw: xhr.responseText }); }
                } else reject(new Error('HTTP ' + xhr.status));
            };
            xhr.onerror = () => reject(new Error('Błąd sieci'));
            xhr.send(body || '');
        });
    }
    function rawGet(win, url) {
        return new Promise((resolve, reject) => {
            const xhr = new win.XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('Błąd sieci'));
            xhr.send();
        });
    }
    function rawPost(win, url, body) {
        return new Promise((resolve, reject) => {
            const xhr = new win.XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('Błąd sieci'));
            xhr.send(body || '');
        });
    }

    /* ═══════════════════════════════════════════
       WebAPI — szybki tryb (batch 100)
       ═══════════════════════════════════════════ */
    const API_KEY_STORAGE_KEY = (host) => `ppApiKey_${host}`;
    const gmGet = (k, def) => {
        try { if (typeof GM_getValue === 'function') return GM_getValue(k, def); } catch (e) {}
        try { return JSON.parse(localStorage.getItem(k) || 'null') || def; } catch (e) { return def; }
    };
    const gmSet = (k, v) => {
        try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) {}
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    };
    const gmDel = (k) => {
        try { if (typeof GM_deleteValue === 'function') { GM_deleteValue(k); return; } } catch (e) {}
        try { localStorage.removeItem(k); } catch (e) {}
    };

    function getApiKey() { return gmGet(API_KEY_STORAGE_KEY(location.hostname), null); }
    function setApiKey(v) { gmSet(API_KEY_STORAGE_KEY(location.hostname), v); }
    function clearApiKey() { gmDel(API_KEY_STORAGE_KEY(location.hostname)); }

    /** Tworzy nowy klucz API z uprawnieniem PIM=rw przez panelowy formularz.
     *  Zwraca { apiKey, login } albo rzuca z opisem błędu. */
    async function createApiKey(win) {
        const w = win || window;
        // 1) GET formularza, wyciągnij pre-generated values
        const html = await new Promise((resolve, reject) => {
            const xhr = new w.XMLHttpRequest();
            xhr.open('GET', '/panel/users-api.php?operation=add', true);
            xhr.onload = () => xhr.status === 200 ? resolve(xhr.responseText) : reject(new Error('GET HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('Błąd sieci (GET)'));
            xhr.send();
        });
        // Tolerancyjny parser — atrybuty mogą być w dowolnej kolejności (name/value).
        function parseHiddenValue(html, fieldName) {
            // Match <input ... name="X" ... value="Y" ...> (lub odwrotnie). Template literal,
            // bez  (które w JS stringu byłoby backspace, nie word boundary).
            const re1 = new RegExp(`name=["']${fieldName}["'][^>]*value=["']([^"']+)`, 'i');
            const re2 = new RegExp(`value=["']([^"']+)["'][^>]*name=["']${fieldName}["']`, 'i');
            let m = html.match(re1); if (m) return m[1];
            m = html.match(re2); if (m) return m[1];
            return null;
        }
        const apiKeyGen = parseHiddenValue(html, 'api_key_generated');
        const passGen = parseHiddenValue(html, 'password_generated');
        if (!apiKeyGen || !passGen) {
            const snippet = (html.match(/api_key_generated[\s\S]{0,300}/) || [''])[0];
            throw new Error(`Nie znaleziono pre-generated key (apiKeyGen=${!!apiKeyGen}, passGen=${!!passGen}). Snippet: ${snippet.substring(0, 200)}`);
        }

        // 2) Sprawdź limit: max 2 aktywne klucze. Jeśli już są 2, panel zwróci błąd po POST.
        // 3) POST formularza
        const params = new URLSearchParams();
        params.append('__iai_shop_panel[__encoding]', 'utf-8');
        params.append('authorization_type', 'key');
        params.append('app_name', 'PanelPro Bulk Stock');
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
        params.append('perms_pim', 'rw');
        params.append('perms_oms', 'none');
        params.append('perms_wms', 'none');
        params.append('add_user', 'true');
        params.append('password_generated', passGen);
        params.append('api_key_generated', apiKeyGen);
        params.append('change_api_key', '0');
        params.append('editid', '');

        const respText = await new Promise((resolve, reject) => {
            const xhr = new w.XMLHttpRequest();
            xhr.open('POST', '/panel/users-api.php', true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = () => xhr.status === 200 ? resolve({ text: xhr.responseText, url: xhr.responseURL }) : reject(new Error('POST HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('Błąd sieci (POST)'));
            xhr.send(params.toString());
        });

        // 4) Wyciągnij login (applicationN) z URL ?id= albo z tekstu
        const url = respText.url || '';
        let login = (url.match(/[?&]id=(application\d+)/) || [])[1];
        if (!login) login = (respText.text.match(/Username\s*[:=]?\s*<[^>]*>\s*(application\d+)/) || [])[1];
        if (!login) login = (respText.text.match(/\b(application\d+)\b/) || [])[1];

        // 5) Sprawdź błąd "max 2 klucze"
        if (!login || /maksymalnie dwa|too many|przekroczono/i.test(respText.text)) {
            throw new Error('Nie udało się utworzyć klucza — prawdopodobnie limit (max 2 aktywne klucze API). Zdezaktywuj jeden istniejący lub wpisz klucz ręcznie.');
        }

        // 6) X-API-KEY = base64(login + ":" + api_key_generated)
        const apiKey = btoa(login + ':' + apiKeyGen);
        return { apiKey, login };
    }

    /** Pobiera jedną stronę POST /products/products/search (resultsPage 0-based, 100/strona). */
    function webApiSearchPage(apiKey, page) {
        return new Promise((resolve, reject) => {
            const url = `https://${location.hostname}/api/admin/v8/products/products/search`;
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('X-API-KEY', apiKey);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onload = () => {
                try {
                    const j = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) resolve(j);
                    else reject(new Error(`search ${xhr.status}: ${xhr.responseText.substring(0, 200)}`));
                } catch (e) { reject(new Error('search parse: ' + xhr.responseText.substring(0, 200))); }
            };
            xhr.onerror = () => reject(new Error('search network'));
            xhr.send(JSON.stringify({ params: { returnElements: ['sizes'], resultsPage: page, resultsLimit: 100 } }));
        });
    }

    /** PUT WebAPI v8 — masowy update (do batch 100).
     *  products: [{ productId, productSizes:[{sizeId, sizePanelName, productStocksData:{productStocksQuantities:[{stockId, productSizeQuantity}]}}], productAvailabilityManagementType? }] */
    function webApiPutProducts(apiKey, products) {
        return new Promise((resolve, reject) => {
            const url = `https://${location.hostname}/api/admin/v8/products/products`;
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);
            xhr.setRequestHeader('X-API-KEY', apiKey);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onload = () => {
                let j = null;
                try { j = JSON.parse(xhr.responseText); } catch (e) {}
                if (xhr.status >= 200 && xhr.status < 300) resolve(j || { raw: xhr.responseText });
                else reject(new Error(`WebAPI PUT ${xhr.status}: ${j ? JSON.stringify(j).substring(0, 300) : xhr.responseText.substring(0, 300)}`));
            };
            xhr.onerror = () => reject(new Error('WebAPI PUT network'));
            xhr.send(JSON.stringify({ params: { products } }));
        });
    }


    function setManagementType(win, productId, type) {
        return ajaxGet(win, `/panel/ajax/product-edit.php?function=ajaxChangeAvailabilityManagementType&productId=${productId}&type=${type}`);
    }
    function massSetAvailable(win, productId) {
        return ajaxGet(win, `/panel/ajax/product-edit.php?function=ajaxMassSetAvailability&productId=${productId}`);
    }
    /** Zmienia status JEST/NIEMA — status: -1 = JEST, 0 = NIEMA */
    function changeAvailability(win, productId, stockId, sizeId, statusNum) {
        return ajaxPost(win, `/panel/ajax/product-edit.php?function=ajaxChangeAvailability&productId=${productId}&stockId=${stockId}&sizeId=${encodeURIComponent(sizeId)}&status=${statusNum}`, '');
    }
    function cleanQuantity(win, productIds, types) {
        const products = productIds.map(id => ({ id }));
        const body = 'products=' + encodeURIComponent(JSON.stringify(products))
            + '&types=' + encodeURIComponent(JSON.stringify(types));
        return ajaxPost(win, '/panel/ajax/product-reservations.php?action=cleanQuantity', body);
    }

    /** Pobiera aktualne stany ilościowe per sizeId dla danego towaru i magazynu.
     *  Parsuje toplayer addStocksQuantity — input.stock-value[size-id] + sąsiedni <span> z aktualną wartością. */
    async function getCurrentQuantities(win, productId, stockId) {
        const url = `/panel/ajax/product-edit-aceform-toplayers.php?name=addStocksQuantity&idt=${productId}&stock=${stockId}`;
        const html = await rawPost(win, url, `id=stocksQuantity&stock=${stockId}`);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const out = {};
        doc.querySelectorAll('input.stock-value').forEach(inp => {
            const sid = inp.getAttribute('size-id');
            if (!sid) return;
            // current value is in next td > span
            const td = inp.closest('td');
            const nextTd = td && td.nextElementSibling;
            const span = nextTd && nextTd.querySelector('span');
            const cur = span ? Number(String(span.textContent).trim()) : 0;
            out[sid] = isNaN(cur) ? 0 : cur;
        });
        return out;
    }

    /** Ustawia magazyn M0 (Magazyn obcy) jako nieskończony dla podanych rozmiarów.
     *  W panelu IdoSell stock=0 z infinity[sizeId]=y i quantity[sizeId]=-1 oznacza nieograniczone stany. */
    function saveStockUnlimited(win, productId, sizeIds) {
        const params = new URLSearchParams();
        params.append('product', productId);
        params.append('stock', '0');
        params.append('operation', 'add');
        params.append('note', '');
        params.append('sizegroup', '');
        params.append('ulamki', '');
        for (const sid of sizeIds) {
            params.append(`quantity[${sid}]`, '-1');
            params.append(`infinity[${sid}]`, 'y');
        }
        return ajaxPost(win, '/panel/product-edit-quantity.php?action=save', params.toString());
    }

    /** Zapisuje operację dodania/odjęcia ilości magazynowych.
     *  operation: 'add' | 'substract', quantities: {sizeId: liczba} */
    function saveStockQuantity(win, productId, stockId, quantities, operation) {
        const params = new URLSearchParams();
        params.append('product', productId);
        params.append('stock', String(stockId));
        params.append('operation', operation);
        params.append('note', '');
        params.append('sizegroup', '');
        params.append('ulamki', '');
        for (const [sid, qty] of Object.entries(quantities)) {
            params.append(`quantity[${sid}]`, String(qty));
        }
        return ajaxPost(win, '/panel/product-edit-quantity.php?action=save', params.toString());
    }

    /** Ustawia docelową ilość: czyta aktualny stan, wylicza różnicę, wywołuje add/substract. */
    async function setTargetQuantity(win, productId, stockId, sizeId, targetQty) {
        const target = Number(targetQty);
        if (isNaN(target) || target < 0) throw new Error(`zła ilość docelowa: ${targetQty}`);
        const cur = await getCurrentQuantities(win, productId, stockId);
        const currentQty = cur[sizeId] !== undefined ? cur[sizeId] : 0;
        const diff = target - currentQty;
        if (diff === 0) return { changed: false, current: currentQty, target };
        const op = diff > 0 ? 'add' : 'substract';
        const r = await saveStockQuantity(win, productId, stockId, { [sizeId]: Math.abs(diff) }, op);
        return { changed: true, current: currentQty, target, op, diff: Math.abs(diff), response: r };
    }

    /** Pobiera rozmiary produktu z parami {id, name} */
    async function fetchProductSizes(win, productId) {
        const result = { sizes: [], source: 'none' };

        // ŹRÓDŁO 1: tabela quantity (wiersze: <td>nazwa</td>...<td>onclick manualStock(stockId,"sizeId",...)</td>)
        try {
            const url = `/panel/ajax/product-edit-aceform-tables.php?name=quantity&idt=${productId}&filtered=false&collection=true`;
            const html = await rawPost(win, url, 'id=stocksQuantity&url=' + encodeURIComponent(url));
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('table tbody tr, table tr');
            const sizes = [];
            const seen = new Set();
            rows.forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 2) return;
                const nameCell = cells[0].textContent.trim();
                if (!nameCell) return;
                const onclickEl = tr.querySelector('[onclick*="manualStock"]');
                if (!onclickEl) return;
                const m = onclickEl.getAttribute('onclick').match(/manualStock\([^,]+,\s*[\"']([^\"']+)[\"']/);
                if (!m) return;
                const sid = m[1];
                if (seen.has(sid)) return;
                seen.add(sid);
                sizes.push({ id: sid, name: nameCell });
            });
            if (sizes.length) {
                result.sizes = sizes;
                result.source = 'quantity_table';
                return result;
            }
        } catch (e) {}

        // ŹRÓDŁO 2: tabela sizes (wiersze: <td>nazwa</td><td>input codes_producer[sizeId]...</td>)
        try {
            const url = `/panel/ajax/product-edit-aceform-tables.php?name=sizes&idt=${productId}`;
            const html = await rawPost(win, url, 'id=sizesTable&url=' + encodeURIComponent(url));
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('table tbody tr, table tr');
            const sizes = [];
            const seen = new Set();
            rows.forEach(tr => {
                const cells = tr.querySelectorAll('td');
                if (cells.length < 2) return;
                const nameCell = cells[0].textContent.trim();
                if (!nameCell) return;
                const inp = tr.querySelector('input[name^="codes_"]');
                if (!inp) return;
                const m = inp.name.match(/codes_(?:producer|extern)\[([^\]]+)\]/);
                if (!m) return;
                const sid = m[1];
                if (seen.has(sid)) return;
                seen.add(sid);
                sizes.push({ id: sid, name: nameCell });
            });
            if (sizes.length) {
                result.sizes = sizes;
                result.source = 'sizes_table';
                return result;
            }
        } catch (e) {}

        return result;
    }

    /** Pobiera listę magazynów z /panel/stocks.php */
    async function fetchWarehouses(win) {
        const html = await rawGet(win, '/panel/stocks.php');
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const warehouses = [];
        const standardMap = { 'M0': 0, 'M1': 1, 'M2': 2, 'M3': 3, 'M4': 4, 'M5': 5, 'MM': -2, 'MP': -1 };

        const tables = doc.querySelectorAll('table');
        for (const t of tables) {
            const text = t.textContent;
            if (!text.includes('Magazyn główny') && !text.includes('Priorytet')) continue;

            const rows = t.querySelectorAll('tbody tr, tr');
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length < 3) return;
                const code = cells[0].textContent.trim();
                const name = cells[1].textContent.trim();
                if (!code || !code.match(/^M[\dA-Z]+$/)) return;
                // MM = magazyn przesunięć, MP = magazyn przedsprzedaży —
                // do tych magazynów nie można wstawiać stanów.
                if (code === 'MM' || code === 'MP') return;

                let stockId = null;
                const editLink = row.querySelector('a[href*="stock.php?action=edit"]');
                if (editLink) {
                    const m = editLink.getAttribute('href').match(/id=(-?\d+)/);
                    if (m) stockId = parseInt(m[1]);
                }
                if (stockId === null) {
                    const stockLink = row.querySelector('a[href*="wsp=t&stock="]');
                    if (stockLink) {
                        const m = stockLink.getAttribute('href').match(/stock=(-?\d+)/);
                        if (m) stockId = parseInt(m[1]);
                    }
                }
                if (stockId === null && standardMap[code] !== undefined) stockId = standardMap[code];
                if (stockId !== null) warehouses.push({ code, name, stockId });
            });
            break;
        }
        if (!warehouses.length) {
            warehouses.push({ code: 'M0', name: 'Magazyn obcy', stockId: 0 });
            warehouses.push({ code: 'M1', name: 'Magazyn główny', stockId: 1 });
        }
        return warehouses;
    }

    /** Parsuje CSV — format: id_towaru;id_magazynu;id_lub_nazwa_rozmiaru;wartość */
    function parseCsvFile(text) {
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const lines = text.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(Boolean);
        const rows = [];
        for (const line of lines) {
            const f = line.split(/[;,\t]/).map(s => s.trim());
            if (f.length < 4) continue;
            const pid = f[0]; const wh = f[1]; const size = f[2]; const val = f[3];
            if (!/^\d+$/.test(pid)) continue; // pomiń nagłówek
            rows.push({ productId: pid, warehouse: wh, size, value: val });
        }
        return rows;
    }

    /** Parsuje XML <item id="..." warehouse="..." size="..." qty="..."/> lub available */
    function parseXmlFile(text) {
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        const items = doc.querySelectorAll('item');
        const rows = [];
        items.forEach(it => {
            const pid = it.getAttribute('id');
            const wh = it.getAttribute('warehouse');
            const size = it.getAttribute('size') || it.getAttribute('sizeName') || '';
            const qty = it.getAttribute('qty');
            const av = it.getAttribute('available');
            if (!pid) return;
            rows.push({
                productId: pid,
                warehouse: wh,
                size,
                value: qty !== null ? qty : av,
            });
        });
        return rows;
    }

    /** Mapuje wartość z pliku (sizeId LUB sizeName) na właściwy sizeId. Zwraca null gdy brak dopasowania. */
    function resolveSize(sizeStr, sizesArray) {
        if (!sizeStr) return null;
        const trim = String(sizeStr).trim();
        if (!trim) return null;
        // Match po id (case-sensitive)
        const byId = sizesArray.find(s => s.id === trim);
        if (byId) return byId.id;
        // Match po name (case-insensitive)
        const lower = trim.toLowerCase();
        const byName = sizesArray.find(s => s.name.toLowerCase() === lower);
        if (byName) return byName.id;
        return null;
    }

    /* ═══════════════════════════════════════════
       SVG ICONS
       ═══════════════════════════════════════════ */
    const I = {
        warehouse: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35M3.5 8.35l8.5-5.7 8.5 5.7"/><path d="M6 14h4M14 14h4M6 18h4M14 18h4"/></svg>',
        close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
        box: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        layers: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
        check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        history: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><polyline points="3 3 3 8 8 8"/><path d="M12 7v5l3 2"/></svg>',
        upload: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
        hash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
        checkCircle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    };

    /* ═══════════════════════════════════════════
       MODAL CSS — w stylu szablonu mass-stock-dialog.jsx
       ═══════════════════════════════════════════ */
    const MODAL_CSS = `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        .ms-overlay {
            position:fixed;inset:0;background:rgba(26,26,46,.35);
            z-index:100000;
            font-family:'DM Sans',sans-serif;
            opacity:0; transition:opacity .25s ease;
            pointer-events:auto;
        }
        .ms-overlay.ms-open { opacity:1; }
        .ms-modal {
            position:fixed; top:0; right:0; bottom:0;
            width:100%; max-width:540px;
            background:#f4f5f7;
            box-shadow:-12px 0 50px rgba(0,0,0,.1),-2px 0 6px rgba(0,0,0,.04);
            border-radius:16px 0 0 16px;
            overflow:hidden; color:#1a1a2e;
            display:flex; flex-direction:column;
            transform:translateX(100%);
            transition:transform .35s cubic-bezier(.16,1,.3,1);
        }
        .ms-overlay.ms-open .ms-modal { transform:translateX(0); }
        .ms-hdr { flex-shrink:0;
            padding:18px 22px;background:#fff;
            display:flex;align-items:center;justify-content:space-between;
            border-bottom:1px solid #eef0f4;
        }
        .ms-hdr-left { display:flex;align-items:center;gap:12px; }
        .ms-hdr-icon {
            width:40px;height:40px;border-radius:10px;display:flex;
            align-items:center;justify-content:center;
            background:#e8eeff;color:#4f8cff;
        }
        .ms-hdr-title { font-size:16px;font-weight:700;color:#1a1a2e;line-height:1.2; }
        .ms-hdr-sub { font-size:12px;color:#98a2b3;margin-top:2px; }
        .ms-hdr-sub b { color:#344054; }
        .ms-hdr-close {
            width:34px;height:34px;border-radius:8px;border:none;background:transparent;
            cursor:pointer;display:flex;align-items:center;justify-content:center;
            color:#b0b8c9;transition:.2s;
        }
        .ms-hdr-close:hover { background:#f0f2f5;color:#344054; }

        .ms-body { padding:14px 16px 6px; flex:1; overflow-y:auto; }

        .ms-webapi {
            background:linear-gradient(135deg,#fef9e7,#fffbea);
            border:1px solid #fde68a;border-radius:12px;
            padding:10px 14px;margin-bottom:14px;
        }
        .ms-webapi.ms-webapi-on {
            background:linear-gradient(135deg,#ecfdf5,#f0fdf4);
            border-color:#bbf7d0;
        }
        .ms-webapi-row { display:flex;align-items:center;gap:12px; }
        .ms-webapi-icon { font-size:18px; }
        .ms-webapi-text { flex:1;min-width:0; }
        .ms-webapi-title { font-size:13px;font-weight:700;color:#0f172a; }
        .ms-webapi-desc { font-size:11.5px;color:#64748b;margin-top:1px; }
        .ms-webapi.ms-webapi-on .ms-webapi-desc { color:#15803d; }
        .ms-webapi-actions { display:flex;gap:6px;flex-shrink:0; }
        .ms-webapi-actions button {
            padding:5px 10px;font-size:11.5px;font-weight:600;
            border-radius:6px;cursor:pointer;font-family:inherit;
            border:1px solid #d0d5dd;background:#fff;color:#344054;
            transition:.15s;
        }
        .ms-webapi-actions button:hover { background:#f8fafc;border-color:#94a3b8; }
        .ms-webapi-actions button.ms-webapi-primary {
            background:linear-gradient(135deg,#4f8cff,#3b6de0);color:#fff;border:none;
        }
        .ms-webapi-actions button.ms-webapi-primary:hover { box-shadow:0 2px 8px rgba(79,140,255,.35); }
        .ms-webapi-actions button:disabled { opacity:.5;cursor:not-allowed; }

        .ms-card {
            background:#fff;border-radius:14px;border:1px solid #eef0f4;
            margin-bottom:14px;overflow:hidden;
        }
        .ms-card-hdr {
            padding:12px 18px;border-bottom:1px solid #eef0f4;
            display:flex;align-items:center;gap:10px;background:#fafbfc;
        }
        .ms-num {
            width:22px;height:22px;border-radius:50%;display:flex;
            align-items:center;justify-content:center;font-size:11px;font-weight:700;
            background:#4f8cff;color:#fff;flex-shrink:0;
        }
        .ms-card-icon { color:#4f8cff;display:flex;align-items:center; }
        .ms-card-title {
            font-size:11.5px;font-weight:700;color:#344054;
            text-transform:uppercase;letter-spacing:.06em;
        }
        .ms-card-body { padding:14px 18px; }

        .ms-radio {
            display:flex;align-items:center;gap:12px;padding:11px 14px;
            border-radius:10px;cursor:pointer;border:1px solid #eef0f4;
            background:#fff;transition:all .15s;margin-bottom:6px;
        }
        .ms-radio:hover { border-color:#d6e2ff; }
        .ms-radio.ms-checked {
            border:1.5px solid #4f8cff;background:#f5f8ff;
        }
        .ms-radio-dot {
            width:18px;height:18px;border-radius:50%;flex-shrink:0;
            border:2px solid #d0d5dd;
            display:flex;align-items:center;justify-content:center;
            transition:all .2s;
        }
        .ms-radio.ms-checked .ms-radio-dot { border-color:#4f8cff; }
        .ms-radio-dot::after { content:'';display:none;width:8px;height:8px;border-radius:50%;background:#4f8cff; }
        .ms-radio.ms-checked .ms-radio-dot::after { display:block; }
        .ms-radio input { display:none; }
        .ms-radio-text { flex:1; }
        .ms-radio-label { font-size:13.5px;font-weight:600;color:#1a1a2e; }
        .ms-radio-desc { font-size:12px;color:#98a2b3;margin-top:1px; }
        .ms-unlimited-warn {
            display:flex;align-items:flex-start;gap:8px;
            margin-top:8px;padding:10px 12px;
            background:#fff7e6;border:1px solid #ffd591;border-radius:8px;
            font-size:12px;color:#8a4d00;line-height:1.45;
        }
        .ms-unlimited-warn-icon { font-size:14px;flex-shrink:0;line-height:1.2; }
        .ms-unlimited-warn code { font-family:'JetBrains Mono',monospace;font-size:11.5px;background:#ffe7ba;padding:1px 5px;border-radius:3px;color:#7a3e00; }

        .ms-wh-list {
            margin-top:8px;background:#f8f9fb;border-radius:10px;
            border:1px solid #e8ebf0;overflow:hidden;
        }
        .ms-wh-row {
            display:flex;align-items:center;justify-content:space-between;
            padding:10px 14px;cursor:pointer;transition:background .15s;
            border-bottom:1px solid #eef0f4;
        }
        .ms-wh-row:last-child { border-bottom:none; }
        .ms-wh-row.ms-checked { background:#f5f8ff; }
        .ms-wh-row-left { display:flex;align-items:center;gap:10px; }
        .ms-wh-code {
            padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;
            font-family:'JetBrains Mono',monospace;
            background:#e8ebf0;color:#667085;transition:all .15s;
        }
        .ms-wh-row.ms-checked .ms-wh-code { background:#4f8cff;color:#fff; }
        .ms-wh-name { font-size:13.5px;color:#1a1a2e; }
        .ms-wh-summary {
            padding:8px 14px;background:#fafbfc;border-top:1px solid #eef0f4;
            font-size:12px;color:#667085;
        }
        .ms-wh-summary b { color:#4f8cff; }

        .ms-toggle {
            width:44px;height:24px;border-radius:12px;border:none;
            background:#d0d5dd;cursor:pointer;position:relative;flex-shrink:0;
            transition:background .2s;
        }
        .ms-toggle.ms-on { background:#4f8cff; }
        .ms-toggle::after {
            content:'';position:absolute;top:2px;left:2px;
            width:20px;height:20px;border-radius:50%;background:#fff;
            transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.18);
        }
        .ms-toggle.ms-on::after { left:22px; }

        .ms-dropzone {
            display:flex;flex-direction:column;align-items:center;gap:8px;
            padding:28px 20px;border-radius:10px;
            border:2px dashed #d6e2ff;background:#f5f8ff;
            cursor:pointer;transition:all .15s;text-align:center;
        }
        .ms-dropzone:hover, .ms-dropzone.ms-drag {
            border-color:#4f8cff;background:#eef3ff;
        }
        .ms-dropzone-icon { color:#4f8cff;display:flex; }
        .ms-dropzone-label { font-size:13px;font-weight:600;color:#344054; }
        .ms-dropzone-hint { font-size:11.5px;color:#98a2b3; }

        .ms-file-loaded {
            display:flex;align-items:center;gap:12px;padding:12px 14px;
            border-radius:10px;background:#eaf7ee;border:1px solid #c7e6d0;
        }
        .ms-file-loaded-icon { color:#34a853;display:flex; }
        .ms-file-info { flex:1; }
        .ms-file-name { font-size:13px;font-weight:600;color:#2d7a41; }
        .ms-file-size { font-size:11.5px;color:#4a8f5c; }
        .ms-file-change {
            padding:5px 11px;border-radius:6px;border:1px solid #c7e6d0;
            background:#fff;color:#667085;font-size:12px;font-weight:500;
            cursor:pointer;font-family:inherit;
        }

        .ms-format-info {
            margin-top:12px;padding:12px 14px;border-radius:9px;
            background:#f8f9fb;border:1px solid #e8ebf0;
        }
        .ms-format-title {
            font-size:11.5px;font-weight:600;color:#667085;
            text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;
        }
        .ms-format-line {
            font-size:12px;color:#98a2b3;line-height:1.7;
        }
        .ms-format-line code {
            font-family:'JetBrains Mono',monospace;font-size:11px;color:#344054;
            background:#eef3ff;padding:2px 6px;border-radius:4px;
        }
        .ms-format-line .ms-stockid {
            font-family:'JetBrains Mono',monospace;font-size:11px;color:#4f8cff;
            background:#eef3ff;padding:1px 5px;border-radius:3px;margin-right:4px;
        }

        .ms-finite-box {
            margin-top:2px;margin-left:4px;padding:14px 16px;border-radius:10px;
            background:#f8f9fb;border:1px solid #e8ebf0;
        }
        .ms-tab-switch {
            display:inline-flex;background:#fff;border-radius:8px;padding:3px;
            gap:2px;border:1px solid #e0e3ea;margin-bottom:14px;
        }
        .ms-tab-switch button {
            display:flex;align-items:center;gap:6px;padding:6px 13px;
            border-radius:6px;border:none;cursor:pointer;
            font-size:12px;font-weight:600;font-family:inherit;transition:all .15s;
            background:transparent;color:#667085;
        }
        .ms-tab-switch button.ms-active {
            background:#eef3ff;color:#4f8cff;
        }

        .ms-qty-input-label {
            display:block;font-size:12px;color:#667085;font-weight:500;margin-bottom:6px;
        }
        .ms-qty-input-wrap {
            display:flex;align-items:center;border-radius:8px;
            border:1px solid #e0e3ea;background:#fff;overflow:hidden;width:140px;
        }
        .ms-qty-input-wrap:focus-within { border-color:#4f8cff; }
        .ms-qty-input-wrap input {
            flex:1;padding:9px 12px;border:none;background:transparent;
            font-size:14px;color:#1a1a2e;font-family:'JetBrains Mono',monospace;
            outline:none;width:100%;
        }
        .ms-qty-spinner { display:flex;flex-direction:column;border-left:1px solid #e0e3ea; }
        .ms-qty-spinner button {
            border:none;background:transparent;cursor:pointer;
            padding:2px 10px;font-size:9px;color:#667085;line-height:1;
        }
        .ms-qty-spinner button:first-child { border-bottom:1px solid #e0e3ea; }
        .ms-qty-hint { display:flex;align-items:center;gap:5px;margin-top:8px;font-size:11.5px;color:#98a2b3; }

        .ms-progress-row {
            display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;
        }
        .ms-progress-label { font-size:12px;font-weight:600; }
        .ms-progress-meta { display:inline-flex;align-items:center;gap:10px; }
        .ms-progress-count { font-size:11.5px;font-weight:600;color:#667085;font-family:'JetBrains Mono',monospace; }
        .ms-progress-pct { font-size:12px;font-weight:700;font-family:'JetBrains Mono',monospace; }
        .ms-progress-bar { width:100%;height:8px;border-radius:4px;background:#f0f2f5;overflow:hidden; }
        .ms-progress-fill {
            height:100%;border-radius:4px;transition:width .4s ease;width:0;
            background:linear-gradient(135deg,#4f8cff,#3b6de0);
        }
        .ms-progress-fill.ms-done { background:linear-gradient(135deg,#34a853,#2d7a41); }
        .ms-progress-fill.ms-error { background:linear-gradient(135deg,#e74c3c,#c0392b); }
        .ms-progress-fill.ms-paused { background:linear-gradient(135deg,#f59e0b,#d97706); animation:ms-paused-pulse 1.4s ease-in-out infinite; }
        @keyframes ms-paused-pulse { 0%,100% { opacity:1; } 50% { opacity:.55; } }
        .ms-progress-actions { display:flex;justify-content:flex-end;gap:8px;margin-top:12px; }
        .ms-progress-actions.ms-hidden { display:none; }
        .ms-btn-warn { background:#fff7e6;color:#a16207;border:1px solid #fde68a; }
        .ms-btn-warn:hover:not(:disabled) { background:#fef3c7; }
        .ms-btn-danger { background:#fef2f2;color:#b91c1c;border:1px solid #fecaca; }
        .ms-btn-danger:hover:not(:disabled) { background:#fee2e2; }

        .ms-log {
            background:#1a1a2e;border-radius:10px;padding:14px 16px;
            font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.7;
            max-height:200px;overflow-y:auto;color:#98a2b3;
        }
        .ms-log-line { white-space:pre-wrap;word-break:break-word; }
        .ms-log-line .ms-time { color:#667085;margin-right:8px; }
        .ms-log-line.ms-info { color:#98a2b3; }
        .ms-log-line.ms-success { color:#34a853; }
        .ms-log-line.ms-error { color:#e74c3c; }
        .ms-log-line.ms-done { color:#4f8cff; }
        .ms-log-line.ms-warn { color:#ff9800; }

        .ms-ft { flex-shrink:0;
            padding:14px 22px;background:#fff;border-top:1px solid #eef0f4;
            display:flex;align-items:center;justify-content:flex-end;gap:8px;
        }
        .ms-btn {
            padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;
            cursor:pointer;font-family:inherit;transition:all .2s;
            display:inline-flex;align-items:center;gap:7px;
        }
        .ms-btn-secondary {
            border:1px solid #d0d5dd;background:#fff;color:#344054;
        }
        .ms-btn-secondary:hover { background:#f8f9fb; }
        .ms-btn-primary {
            border:none;color:#fff;
            background:linear-gradient(135deg,#4f8cff,#3b6de0);
            box-shadow:0 2px 8px rgba(79,140,255,.35);
        }
        .ms-btn-primary:disabled {
            background:#e0e3ea;color:#98a2b3;cursor:not-allowed;box-shadow:none;
        }
        .ms-hidden { display:none !important; }
    `;

    /* ═══════════════════════════════════════════
       MODAL HTML BUILDER
       ═══════════════════════════════════════════ */
    function modalHtml(productCount) {
        return `<style>${MODAL_CSS}</style>
        <div class="ms-modal">
            <div class="ms-hdr">
                <div class="ms-hdr-left">
                    <div class="ms-hdr-icon">${I.warehouse}</div>
                    <div>
                        <div class="ms-hdr-title">Masowe ustawianie stanów magazynowych</div>
                        <div class="ms-hdr-sub">Zaznaczonych towarów: <b>${productCount}</b> (ze wszystkich stron)</div>
                    </div>
                </div>
                <button class="ms-hdr-close" id="ms-close" title="Zamknij">${I.close}</button>
            </div>
            <div class="ms-body">

                <!-- 0. WEBAPI -->
                <div class="ms-webapi" id="ms-webapi">
                    <div class="ms-webapi-row">
                        <span class="ms-webapi-icon" id="ms-webapi-icon">⚡</span>
                        <div class="ms-webapi-text">
                            <div class="ms-webapi-title" id="ms-webapi-title">Tryb szybki (WebAPI)</div>
                            <div class="ms-webapi-desc" id="ms-webapi-desc">Sprawdzanie klucza…</div>
                        </div>
                        <div class="ms-webapi-actions" id="ms-webapi-actions"></div>
                    </div>
                </div>

                <!-- 1. TRYB GOSPODARKI -->
                <div class="ms-card">
                    <div class="ms-card-hdr">
                        <span class="ms-num">1</span>
                        <span class="ms-card-icon">${I.settings}</span>
                        <span class="ms-card-title">Tryb gospodarki magazynowej</span>
                    </div>
                    <div class="ms-card-body">
                        <label class="ms-radio" data-mode="auto">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-mode" value="auto">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Automatyczny</div>
                                <div class="ms-radio-desc">Na podstawie ilości w magazynach</div>
                            </div>
                        </label>
                        <label class="ms-radio" data-mode="manual">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-mode" value="manual">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Ręczny</div>
                                <div class="ms-radio-desc">Stan JEST / NIEMA</div>
                            </div>
                        </label>
                        <label class="ms-radio" data-mode="skip">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-mode" value="skip">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Nie zmieniaj trybu</div>
                                <div class="ms-radio-desc">Pozostaw aktualny tryb gospodarki</div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- 2. WYBIERZ MAGAZYNY -->
                <div class="ms-card ms-hidden" id="ms-card-wh">
                    <div class="ms-card-hdr">
                        <span class="ms-num">2</span>
                        <span class="ms-card-icon">${I.box}</span>
                        <span class="ms-card-title">Wybierz magazyny</span>
                    </div>
                    <div class="ms-card-body">
                        <label class="ms-radio" data-scope="all">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-scope" value="all">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Wszystkie magazyny</div>
                                <div class="ms-radio-desc" id="ms-scope-all-desc">—</div>
                            </div>
                        </label>
                        <label class="ms-radio" data-scope="selected">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-scope" value="selected">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Wybrane magazyny</div>
                                <div class="ms-radio-desc">Zaznacz konkretne magazyny poniżej</div>
                            </div>
                        </label>
                        <label class="ms-radio" data-scope="fromFile">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-scope" value="fromFile">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Wskazane w pliku</div>
                                <div class="ms-radio-desc">Magazyny, ilości i towary zdefiniowane w pliku CSV / XML</div>
                            </div>
                        </label>

                        <div class="ms-wh-list ms-hidden" id="ms-wh-list">
                            <div style="padding:14px;text-align:center;color:#98a2b3;">Ładowanie magazynów...</div>
                        </div>
                    </div>
                </div>

                <!-- 3a. ZAŁADUJ PLIK (fromFile) -->
                <div class="ms-card ms-hidden" id="ms-card-file">
                    <div class="ms-card-hdr">
                        <span class="ms-num">3</span>
                        <span class="ms-card-icon">${I.upload}</span>
                        <span class="ms-card-title">Załaduj plik</span>
                    </div>
                    <div class="ms-card-body">
                        <div style="font-size:13px;color:#344054;line-height:1.5;margin-bottom:10px;" id="ms-file-intro">
                            Plik powinien zawierać identyfikator towaru, identyfikator magazynu oraz wartość — po jednym wpisie na linię.
                        </div>
                        <div id="ms-file-zone-wrap"></div>
                        <div class="ms-format-info">
                            <div class="ms-format-title">Wymagany format pliku</div>
                            <div class="ms-format-line" id="ms-format-spec">—</div>
                            <div class="ms-format-line" id="ms-format-stocks" style="margin-top:8px;"></div>
                        </div>
                    </div>
                </div>

                <!-- 3b. WYBIERZ STAN (all/selected) -->
                <div class="ms-card ms-hidden" id="ms-card-state">
                    <div class="ms-card-hdr">
                        <span class="ms-num">3</span>
                        <span class="ms-card-icon">${I.layers}</span>
                        <span class="ms-card-title">Wybierz stan</span>
                    </div>
                    <div class="ms-card-body" id="ms-state-body"></div>
                </div>

                <!-- 4. ROZMIAR (tylko gdy WebAPI aktywny) -->
                <div class="ms-card ms-hidden" id="ms-card-size">
                    <div class="ms-card-hdr">
                        <span class="ms-num">4</span>
                        <span class="ms-card-icon">${I.layers}</span>
                        <span class="ms-card-title">Rozmiar</span>
                    </div>
                    <div class="ms-card-body">
                        <label class="ms-radio" data-sizemode="uniw">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-sizemode" value="uniw" checked>
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Wszystkie one size (uniw)</div>
                                <div class="ms-radio-desc">Szybciej — pomijamy odczyt rozmiarów. Działa dla towarów bez wariantów.</div>
                            </div>
                        </label>
                        <label class="ms-radio" data-sizemode="fetch">
                            <span class="ms-radio-dot"></span>
                            <input type="radio" name="ms-sizemode" value="fetch">
                            <div class="ms-radio-text">
                                <div class="ms-radio-label">Odczytaj z towarów</div>
                                <div class="ms-radio-desc">Wolniejsze — paginujemy bazę by pobrać prawdziwe rozmiary (S/M/L itp.).</div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- 5. POSTĘP -->
                <div class="ms-card ms-hidden" id="ms-card-progress">
                    <div class="ms-card-hdr">
                        <span class="ms-num">5</span>
                        <span class="ms-card-icon">${I.play}</span>
                        <span class="ms-card-title">Postęp operacji</span>
                    </div>
                    <div class="ms-card-body">
                        <div class="ms-progress-row">
                            <span class="ms-progress-label" id="ms-progress-label">Gotowy do uruchomienia</span>
                            <span class="ms-progress-meta">
                                <span class="ms-progress-count" id="ms-progress-count"></span>
                                <span class="ms-progress-pct" id="ms-progress-pct">0%</span>
                            </span>
                        </div>
                        <div class="ms-progress-bar"><div class="ms-progress-fill" id="ms-progress-fill"></div></div>
                        <div class="ms-progress-actions ms-hidden" id="ms-progress-actions">
                            <button class="ms-btn ms-btn-warn" id="ms-pause" type="button">⏸ Pauza</button>
                            <button class="ms-btn ms-btn-danger" id="ms-cancel-run" type="button">✖ Przerwij</button>
                        </div>
                    </div>
                </div>

                <!-- 6. HISTORIA -->
                <div class="ms-card ms-hidden" id="ms-card-log">
                    <div class="ms-card-hdr">
                        <span class="ms-num">6</span>
                        <span class="ms-card-icon">${I.history}</span>
                        <span class="ms-card-title">Historia operacji</span>
                    </div>
                    <div class="ms-card-body"><div class="ms-log" id="ms-log"></div></div>
                </div>
            </div>
            <div class="ms-ft">
                <button class="ms-btn ms-btn-secondary" id="ms-cancel">Zamknij</button>
                <button class="ms-btn ms-btn-primary" id="ms-apply" disabled>${I.play}<span>Zastosuj do zaznaczonych</span></button>
            </div>
        </div>`;
    }

    function dropzoneHtml(file) {
        if (file) {
            return `<div class="ms-file-loaded">
                <span class="ms-file-loaded-icon">${I.checkCircle}</span>
                <div class="ms-file-info">
                    <div class="ms-file-name">${escapeHtml(file.name)}</div>
                    <div class="ms-file-size">${(file.size/1024).toFixed(1)} KB</div>
                </div>
                <button class="ms-file-change" id="ms-file-clear">Zmień</button>
            </div>`;
        }
        return `<label class="ms-dropzone" id="ms-dropzone">
            <input type="file" accept=".csv,.xml" style="display:none" id="ms-file-input">
            <span class="ms-dropzone-icon">${I.upload}</span>
            <span class="ms-dropzone-label">Przeciągnij plik lub kliknij aby wybrać</span>
            <span class="ms-dropzone-hint">Obsługiwane formaty: CSV, XML</span>
        </label>`;
    }

    /* ═══════════════════════════════════════════
       MODAL LOGIC
       ═══════════════════════════════════════════ */
    async function openModal(doc, win, productIds) {
        const ov = doc.createElement('div');
        ov.className = 'ms-overlay';
        ov.innerHTML = modalHtml(productIds.length);
        doc.body.appendChild(ov);
        // Animacja wjazdu drawera
        requestAnimationFrame(() => ov.classList.add('ms-open'));

        const $ = (sel) => ov.querySelector(sel);
        const $$ = (sel) => Array.from(ov.querySelectorAll(sel));

        const close = () => {
            ov.classList.remove('ms-open');
            setTimeout(() => ov.remove(), 320);
        };
        $('#ms-close').onclick = close;
        $('#ms-cancel').onclick = close;
        ov.addEventListener('click', e => { if (e.target === ov) close(); });

        // STATE
        let state = {
            mode: null,        // 'auto' | 'manual' | 'skip'
            scope: null,       // 'all' | 'selected' | 'fromFile'
            selectedWh: [],    // stockId[]
            stock: null,       // 'available' | 'unavailable' | 'infinite' | 'finite'
            finiteMode: 'value', // 'value' | 'file'
            quantity: '',
            file: null,
            warehouses: [],
            sizeMode: 'uniw',  // 'uniw' | 'fetch' — tryb pobierania rozmiarów dla WebAPI
        };

        // RADIO HELPERS
        function setRadio(name, value) {
            $$(`input[name="${name}"]`).forEach(r => {
                const checked = r.value === value;
                r.checked = checked;
                r.closest('.ms-radio').classList.toggle('ms-checked', checked);
            });
        }
        function bindRadio(name, onChange) {
            $$(`label.ms-radio input[name="${name}"]`).forEach(r => {
                const lab = r.closest('.ms-radio');
                const handler = (val) => {
                    if (typeof resetOperationView === 'function') resetOperationView();
                    onChange(val);
                };
                lab.onclick = (e) => {
                    if (e.target.tagName === 'INPUT') return;
                    e.preventDefault();
                    setRadio(name, r.value);
                    handler(r.value);
                };
                r.onchange = () => { setRadio(name, r.value); handler(r.value); };
            });
        }

        function updateApplyBtn() {
            let canRun = !!state.mode;
            if (state.mode === 'skip' && !state.scope) canRun = false;
            if (state.scope === 'selected' && !state.selectedWh.length) canRun = false;
            if (state.scope === 'fromFile' && !state.file) canRun = false;
            if ((state.scope === 'all' || state.scope === 'selected') && state.mode !== 'skip') {
                if (state.mode === 'manual' && !state.stock) canRun = false;
                if (state.mode === 'auto') {
                    if (!state.stock) canRun = false;
                    if (state.stock === 'finite') {
                        if (state.finiteMode === 'value' && !(Number(state.quantity) >= 0 && state.quantity !== '')) canRun = false;
                        if (state.finiteMode === 'file' && !state.file) canRun = false;
                    }
                }
            }
            $('#ms-apply').disabled = !canRun;
        }

        // === SECTION VISIBILITY ===
        function refreshSections() {
            $('#ms-card-wh').classList.toggle('ms-hidden', !state.mode);
            $('#ms-card-file').classList.toggle('ms-hidden', state.scope !== 'fromFile');
            $('#ms-card-state').classList.toggle('ms-hidden', !state.scope || state.scope === 'fromFile');
            // Karta "Rozmiar" tylko gdy WebAPI aktywny i operacja może z niej korzystać
            const hasKey = !!getApiKey();
            const showSize = hasKey && !!state.scope && state.scope !== 'fromFile';
            $('#ms-card-size').classList.toggle('ms-hidden', !showSize);
            updateApplyBtn();
        }

        // Bind radio for sizeMode (jednorazowo, bo karta zawsze w DOM)
        bindRadio('ms-sizemode', (val) => { state.sizeMode = val; });

        // === WEBAPI STATUS ===
        function renderWebApiStatus() {
            const root = $('#ms-webapi');
            const icon = $('#ms-webapi-icon');
            const title = $('#ms-webapi-title');
            const desc = $('#ms-webapi-desc');
            const actions = $('#ms-webapi-actions');
            const key = getApiKey();
            if (key) {
                root.classList.add('ms-webapi-on');
                icon.textContent = '✓';
                title.textContent = 'Tryb szybki (WebAPI) — aktywny';
                desc.textContent = `Klucz API skonfigurowany — operacje pójdą bulk-em (~3-5 min/40k)`;
                actions.innerHTML = `<button id="ms-webapi-clear" type="button">Usuń klucz</button>`;
                $('#ms-webapi-clear').onclick = () => {
                    if (!confirm('Usunąć zapisany klucz API z pamięci skryptu? (Klucz pozostanie aktywny w panelu.)')) return;
                    clearApiKey();
                    renderWebApiStatus();
                };
            } else {
                root.classList.remove('ms-webapi-on');
                icon.textContent = '⚡';
                title.textContent = 'Tryb szybki (WebAPI) — nieaktywny';
                desc.textContent = 'Bez klucza operacje będą znacznie wolniejsze (~2,5h/40k zamiast ~3 min)';
                actions.innerHTML = `
                    <button class="ms-webapi-primary" id="ms-webapi-create" type="button">Utwórz klucz</button>
                    <button id="ms-webapi-manual" type="button">Wpisz ręcznie</button>`;
                $('#ms-webapi-create').onclick = async () => {
                    $('#ms-webapi-create').disabled = true;
                    desc.textContent = 'Tworzenie klucza w panelu…';
                    try {
                        const { apiKey, login } = await createApiKey(window);
                        setApiKey(apiKey);
                        alert(`Utworzono klucz API (${login}) z uprawnieniem PIM=rw. Zapisany w pamięci skryptu.`);
                        renderWebApiStatus();
                    } catch (e) {
                        alert(`Nie udało się utworzyć klucza: ${e.message}`);
                        $('#ms-webapi-create').disabled = false;
                        desc.textContent = 'Nie udało się utworzyć klucza';
                    }
                };
                $('#ms-webapi-manual').onclick = () => {
                    const v = prompt('Wklej X-API-KEY (base64, np. YXBwbGljYXRpb24xMzo...):');
                    if (v && v.trim()) {
                        setApiKey(v.trim());
                        renderWebApiStatus();
                    }
                };
            }
        }
        renderWebApiStatus();

        // === MODE ===
        bindRadio('ms-mode', (val) => {
            state.mode = val;
            state.scope = null;
            state.stock = null;
            state.file = null;
            $$('input[name="ms-scope"]').forEach(r => { r.checked = false; r.closest('.ms-radio').classList.remove('ms-checked'); });
            $('#ms-wh-list').classList.add('ms-hidden');
            refreshSections();
        });

        // === SCOPE ===
        bindRadio('ms-scope', (val) => {
            state.scope = val;
            state.stock = null;
            $('#ms-wh-list').classList.toggle('ms-hidden', val !== 'selected');
            renderStateSection();
            renderFileSection();
            refreshSections();
        });

        // === FILE ZONE ===
        function renderFileZone() {
            $('#ms-file-zone-wrap').innerHTML = dropzoneHtml(state.file);
            const dz = $('#ms-dropzone');
            const fi = $('#ms-file-input');
            const clr = $('#ms-file-clear');
            if (clr) clr.onclick = () => {
                state.file = null;
                if (typeof resetOperationView === 'function') resetOperationView();
                renderFileZone(); refreshSections(); updateApplyBtn();
            };
            if (dz && fi) {
                dz.onclick = (e) => { if (e.target.tagName !== 'INPUT') fi.click(); };
                fi.onchange = () => {
                    if (fi.files.length) {
                        state.file = fi.files[0];
                        if (typeof resetOperationView === 'function') resetOperationView();
                        renderFileZone();
                        refreshSections();
                        updateApplyBtn();
                    }
                };
                dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('ms-drag'); };
                dz.ondragleave = () => dz.classList.remove('ms-drag');
                dz.ondrop = (e) => {
                    e.preventDefault();
                    dz.classList.remove('ms-drag');
                    if (e.dataTransfer.files.length) {
                        state.file = e.dataTransfer.files[0];
                        if (typeof resetOperationView === 'function') resetOperationView();
                        renderFileZone();
                        refreshSections();
                        updateApplyBtn();
                    }
                };
            }
        }

        function renderFileSection() {
            renderFileZone();

            const intro = $('#ms-file-intro');
            const spec = $('#ms-format-spec');
            const stocksLine = $('#ms-format-stocks');

            if (state.mode === 'auto') {
                intro.textContent = 'Plik powinien zawierać identyfikator towaru, identyfikator magazynu, identyfikator lub nazwę rozmiaru oraz ilość — po jednym wpisie na linię.';
                spec.innerHTML = `CSV: <code>id_towaru;id_magazynu;id_lub_nazwa_rozmiaru;ilość</code><br>XML: <code>&lt;item id="123" warehouse="0" size="M" qty="10"/&gt;</code> <span style="color:#b0b8c9;margin-left:6px">(rozmiar: <code>uniw</code> dla towarów bez rozmiarów)</span>`;
            } else if (state.mode === 'skip') {
                intro.textContent = 'Plik powinien zawierać identyfikator towaru, identyfikator magazynu, identyfikator lub nazwę rozmiaru oraz wartość — po jednym wpisie na linię.';
                spec.innerHTML = `CSV: <code>id_towaru;id_magazynu;id_lub_nazwa_rozmiaru;wartość</code><br><span style="color:#b0b8c9">Wartość: <code>0</code> lub <code>1</code> → stan ręczny (NIEMA / JEST); liczba ≥ 2 → ilość (tryb auto). Rozmiar <code>uniw</code> dla towarów bez rozmiarów.</span><br>XML: <code>&lt;item id="123" warehouse="0" size="M" qty="10"/&gt;</code> lub <code>&lt;item ... available="1"/&gt;</code>`;
            } else {
                intro.textContent = 'Plik powinien zawierać identyfikator towaru, identyfikator magazynu, identyfikator lub nazwę rozmiaru oraz stan (1=JEST, 0=NIEMA) — po jednym wpisie na linię.';
                spec.innerHTML = `CSV: <code>id_towaru;id_magazynu;id_lub_nazwa_rozmiaru;stan</code> <span style="color:#b0b8c9;margin-left:6px">(stan: 1 = JEST, 0 = NIEMA; rozmiar: <code>uniw</code> dla towarów bez rozmiarów)</span><br>XML: <code>&lt;item id="123" warehouse="0" size="M" available="1"/&gt;</code>`;
            }

            if (state.warehouses.length) {
                stocksLine.innerHTML = 'Dostępne ID magazynów: ' + state.warehouses.map(w =>
                    `<span class="ms-stockid" title="${escapeHtml(w.name)}">${w.stockId}=${escapeHtml(w.code)}</span>`
                ).join('');
            }
        }

        // === STATE SECTION ===
        function renderStateSection() {
            const body = $('#ms-state-body');
            if (!state.scope || state.scope === 'fromFile') { body.innerHTML = ''; return; }

            if (state.mode === 'manual') {
                body.innerHTML = `
                    <label class="ms-radio" data-stock="available">
                        <span class="ms-radio-dot"></span>
                        <input type="radio" name="ms-stock" value="available">
                        <div class="ms-radio-text">
                            <div class="ms-radio-label">JEST (dostępny)</div>
                            <div class="ms-radio-desc">Towar będzie widoczny jako dostępny</div>
                        </div>
                    </label>
                    <label class="ms-radio" data-stock="unavailable">
                        <span class="ms-radio-dot"></span>
                        <input type="radio" name="ms-stock" value="unavailable">
                        <div class="ms-radio-text">
                            <div class="ms-radio-label">NIEMA (niedostępny)</div>
                            <div class="ms-radio-desc">Towar będzie oznaczony jako niedostępny</div>
                        </div>
                    </label>`;
            } else if (state.mode === 'auto') {
                // "Stan nieskończony" tylko gdy M0 jest wśród docelowych magazynów.
                const targetStocks = state.scope === 'all'
                    ? state.warehouses.map(w => w.stockId)
                    : state.selectedWh;
                const showUnlimited = targetStocks.includes(0);
                const otherWh = state.warehouses.filter(w => targetStocks.includes(w.stockId) && w.stockId !== 0);
                const otherCodes = otherWh.map(w => w.code).join(', ');
                const ownWarning = showUnlimited && otherWh.length ? `
                    <div class="ms-unlimited-warn" id="ms-unlimited-warn">
                        <span class="ms-unlimited-warn-icon">⚠</span>
                        <div>
                            <strong>Uwaga:</strong> stan nieskończony można ustawić tylko na magazynie obcym (M0).
                            Dla magazynów własnych (${escapeHtml(otherCodes)}) zostanie ustawiona ilość <code>99999</code>.
                        </div>
                    </div>` : '';
                const unlimitedHtml = showUnlimited ? `
                    <label class="ms-radio" data-stock="unlimited">
                        <span class="ms-radio-dot"></span>
                        <input type="radio" name="ms-stock" value="unlimited">
                        <div class="ms-radio-text">
                            <div class="ms-radio-label">Stan nieskończony</div>
                            <div class="ms-radio-desc">Magazyn M0 — towar zawsze dostępny, bez limitu</div>
                        </div>
                    </label>
                    ${ownWarning}` : '';
                body.innerHTML = `
                    <label class="ms-radio" data-stock="infinite">
                        <span class="ms-radio-dot"></span>
                        <input type="radio" name="ms-stock" value="infinite">
                        <div class="ms-radio-text">
                            <div class="ms-radio-label">Wyzeruj stany</div>
                            <div class="ms-radio-desc">Wyzeruj ilości magazynowe (i opcjonalnie rezerwacje)</div>
                        </div>
                    </label>
                    <label class="ms-radio" data-stock="finite">
                        <span class="ms-radio-dot"></span>
                        <input type="radio" name="ms-stock" value="finite">
                        <div class="ms-radio-text">
                            <div class="ms-radio-label">Stan skończony</div>
                            <div class="ms-radio-desc">Ustaw konkretną ilość lub załaduj z pliku</div>
                        </div>
                    </label>
                    ${unlimitedHtml}
                    <div id="ms-finite-box" class="ms-hidden"></div>`;
            } else {
                body.innerHTML = '';
                return;
            }

            bindRadio('ms-stock', (val) => {
                state.stock = val;
                renderFiniteBox();
                refreshSections();
            });
        }

        function renderFiniteBox() {
            const box = $('#ms-finite-box');
            if (!box) return;
            if (state.stock !== 'finite') { box.classList.add('ms-hidden'); box.innerHTML = ''; return; }

            box.classList.remove('ms-hidden');
            box.classList.add('ms-finite-box');
            box.innerHTML = `
                <div class="ms-tab-switch" id="ms-finite-tabs">
                    <button data-fmode="value" class="ms-active">${I.hash}<span>Wspólna wartość</span></button>
                    <button data-fmode="file">${I.upload}<span>Z pliku CSV / XML</span></button>
                </div>
                <div id="ms-finite-content"></div>`;

            const tabsBtns = box.querySelectorAll('button[data-fmode]');
            tabsBtns.forEach(b => {
                b.onclick = () => {
                    state.finiteMode = b.dataset.fmode;
                    tabsBtns.forEach(x => x.classList.toggle('ms-active', x === b));
                    renderFiniteContent();
                    updateApplyBtn();
                };
            });
            renderFiniteContent();
        }

        function renderFiniteContent() {
            const c = $('#ms-finite-content');
            if (!c) return;
            if (state.finiteMode === 'value') {
                c.innerHTML = `
                    <label class="ms-qty-input-label">Ilość dla wszystkich zaznaczonych towarów</label>
                    <div style="display:flex;align-items:center;gap:8px">
                        <div class="ms-qty-input-wrap">
                            <input type="number" min="0" id="ms-qty" value="${state.quantity || ''}" placeholder="0">
                            <div class="ms-qty-spinner">
                                <button id="ms-qty-up">▲</button>
                                <button id="ms-qty-down">▼</button>
                            </div>
                        </div>
                        <span style="font-size:12px;color:#98a2b3">szt.</span>
                    </div>
                    <div class="ms-qty-hint">Ta sama ilość zostanie ustawiona dla każdego zaznaczonego towaru</div>`;

                const qty = $('#ms-qty');
                const qtyChange = () => { if (typeof resetOperationView === 'function') resetOperationView(); };
                qty.oninput = () => { qtyChange(); state.quantity = qty.value; updateApplyBtn(); };
                $('#ms-qty-up').onclick = () => { qtyChange(); qty.value = String(Math.max(0, Number(qty.value || 0) + 1)); state.quantity = qty.value; updateApplyBtn(); };
                $('#ms-qty-down').onclick = () => { qtyChange(); qty.value = String(Math.max(0, Number(qty.value || 0) - 1)); state.quantity = qty.value; updateApplyBtn(); };
            } else {
                c.innerHTML = `<div id="ms-finite-file-zone"></div>
                    <div class="ms-format-info">
                        <div class="ms-format-title">Wymagany format pliku</div>
                        <div class="ms-format-line">CSV: <code>id_towaru;id_magazynu;id_lub_nazwa_rozmiaru;ilość</code> &middot; XML: <code>&lt;item id="123" warehouse="0" size="M" qty="10"/&gt;</code></div>
                    </div>`;
                renderFiniteFileZone();
            }
        }

        function renderFiniteFileZone() {
            const w = $('#ms-finite-file-zone');
            if (!w) return;
            w.innerHTML = dropzoneHtml(state.file);
            const dz = w.querySelector('#ms-dropzone');
            const fi = w.querySelector('#ms-file-input');
            const clr = w.querySelector('#ms-file-clear');
            const reset = () => { if (typeof resetOperationView === 'function') resetOperationView(); };
            if (clr) clr.onclick = () => { state.file = null; reset(); renderFiniteFileZone(); updateApplyBtn(); };
            if (dz && fi) {
                dz.onclick = (e) => { if (e.target.tagName !== 'INPUT') fi.click(); };
                fi.onchange = () => { if (fi.files.length) { state.file = fi.files[0]; reset(); renderFiniteFileZone(); updateApplyBtn(); } };
                dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('ms-drag'); };
                dz.ondragleave = () => dz.classList.remove('ms-drag');
                dz.ondrop = (e) => {
                    e.preventDefault(); dz.classList.remove('ms-drag');
                    if (e.dataTransfer.files.length) { state.file = e.dataTransfer.files[0]; reset(); renderFiniteFileZone(); updateApplyBtn(); }
                };
            }
        }

        // === WAREHOUSE LOAD ===
        try {
            state.warehouses = await fetchWarehouses(win);
        } catch (e) { state.warehouses = []; }

        $('#ms-scope-all-desc').textContent = `Zmiana obejmie ${state.warehouses.length} magazynów`;

        const whList = $('#ms-wh-list');
        whList.innerHTML = state.warehouses.map(w => `
            <div class="ms-wh-row" data-stockid="${w.stockId}">
                <div class="ms-wh-row-left">
                    <span class="ms-wh-code">${escapeHtml(w.code)}</span>
                    <span class="ms-wh-name">${escapeHtml(w.name)}</span>
                </div>
                <button class="ms-toggle"></button>
            </div>
        `).join('') + `<div class="ms-wh-summary ms-hidden" id="ms-wh-summary">Wybrano: <b id="ms-wh-count">0</b> z ${state.warehouses.length}</div>`;

        whList.querySelectorAll('.ms-wh-row').forEach(row => {
            row.onclick = () => {
                if (typeof resetOperationView === 'function') resetOperationView();
                const stockId = parseInt(row.dataset.stockid);
                const idx = state.selectedWh.indexOf(stockId);
                if (idx >= 0) state.selectedWh.splice(idx, 1);
                else state.selectedWh.push(stockId);
                row.classList.toggle('ms-checked');
                row.querySelector('.ms-toggle').classList.toggle('ms-on');
                $('#ms-wh-count').textContent = state.selectedWh.length;
                $('#ms-wh-summary').classList.toggle('ms-hidden', state.selectedWh.length === 0);
                // Re-render państw — opcja "Stan nieskończony" zależy od obecności M0
                if (state.mode === 'auto' && state.scope === 'selected') {
                    if (stockId === 0 && state.stock === 'unlimited') state.stock = null;
                    renderStateSection();
                }
                updateApplyBtn();
            };
        });

        // === LOG ===
        const logBox = $('#ms-log');
        const log = (msg, type) => {
            const d = doc.createElement('div');
            d.className = `ms-log-line ms-${type || 'info'}`;
            d.innerHTML = `<span class="ms-time">[${fmtTime()}]</span>${(type === 'info' || type === 'done') ? '══ ' : ''}${escapeHtml(msg)}${(type === 'info' || type === 'done') ? ' ══' : ''}`;
            logBox.appendChild(d);
            logBox.scrollTop = logBox.scrollHeight;
        };

        // === RESET OPERATION VIEW ===
        // Czyści historię i postęp poprzedniej operacji — wywoływane przy każdej zmianie ustawień / pliku.
        function resetOperationView() {
            logBox.innerHTML = '';
            $('#ms-card-progress').classList.add('ms-hidden');
            $('#ms-card-log').classList.add('ms-hidden');
            setProgress(0, null);
            updateApplyBtn();
        }

        // === PROGRESS ===
        function setProgress(pct, status, processed, total) {
            $('#ms-progress-pct').textContent = `${pct}%`;
            $('#ms-progress-fill').style.width = `${pct}%`;
            $('#ms-progress-fill').classList.remove('ms-done', 'ms-error', 'ms-paused');
            const lab = $('#ms-progress-label');
            const fill = $('#ms-progress-fill');
            const cnt = $('#ms-progress-count');
            if (status === 'running')        { lab.textContent = 'Przetwarzanie...'; lab.style.color = '#4f8cff'; }
            else if (status === 'paused')    { lab.textContent = 'Wstrzymano'; lab.style.color = '#a16207'; fill.classList.add('ms-paused'); }
            else if (status === 'done')      { lab.textContent = 'Zakończono'; lab.style.color = '#2d7a41'; fill.classList.add('ms-done'); }
            else if (status === 'cancelled') { lab.textContent = 'Przerwano'; lab.style.color = '#b91c1c'; fill.classList.add('ms-error'); }
            else if (status === 'error')     { lab.textContent = 'Wystąpił błąd'; lab.style.color = '#d32f2f'; fill.classList.add('ms-error'); }
            else                             { lab.textContent = 'Gotowy do uruchomienia'; lab.style.color = '#98a2b3'; }
            $('#ms-progress-pct').style.color = lab.style.color;
            if (cnt) cnt.textContent = (total !== undefined && total > 0) ? `${processed}/${total} towarów` : '';
        }

        // === RUN CONTROL (pauza / wznów / przerwij) ===
        const runCtl = {
            paused: false,
            cancelled: false,
            _pauseResolve: null,
            pause() { if (!this.cancelled) this.paused = true; },
            resume() {
                if (!this.paused) return;
                this.paused = false;
                if (this._pauseResolve) { this._pauseResolve(); this._pauseResolve = null; }
            },
            cancel() { this.cancelled = true; if (this.paused) this.resume(); },
            reset() { this.paused = false; this.cancelled = false; this._pauseResolve = null; },
            async checkpoint() {
                if (this.cancelled) throw new Error('__cancelled__');
                if (this.paused) {
                    await new Promise(res => { this._pauseResolve = res; });
                    if (this.cancelled) throw new Error('__cancelled__');
                }
            },
        };

        let _processed = 0, _total = 0;
        const pauseBtn = $('#ms-pause');
        const cancelRunBtn = $('#ms-cancel-run');
        pauseBtn.onclick = () => {
            const pct = parseInt($('#ms-progress-pct').textContent) || 0;
            if (runCtl.paused) {
                runCtl.resume();
                pauseBtn.textContent = '⏸ Pauza';
                setProgress(pct, 'running', _processed, _total);
                log('Wznowiono operację', 'info');
            } else {
                runCtl.pause();
                pauseBtn.textContent = '▶ Wznów';
                setProgress(pct, 'paused', _processed, _total);
                log('Wstrzymano operację', 'warn');
            }
        };
        cancelRunBtn.onclick = () => {
            if (!confirm('Przerwać operację? Już wykonane zmiany zostaną zachowane.')) return;
            runCtl.cancel();
            log('Przerywanie operacji…', 'warn');
        };

        // === APPLY ===
        $('#ms-apply').onclick = async () => {
            runCtl.reset();
            _processed = 0; _total = productIds.length;
            $('#ms-apply').disabled = true;
            $('#ms-cancel').textContent = 'Anuluj';
            $('#ms-card-progress').classList.remove('ms-hidden');
            $('#ms-card-log').classList.remove('ms-hidden');
            $('#ms-progress-actions').classList.remove('ms-hidden');
            pauseBtn.textContent = '⏸ Pauza';
            setProgress(0, 'running', 0, _total);

            try {
                await runOperation(win, productIds, state, log,
                    (pct, processed, total) => {
                        if (processed !== undefined) _processed = processed;
                        if (total !== undefined) _total = total;
                        const status = runCtl.paused ? 'paused' : 'running';
                        setProgress(pct, status, _processed, _total);
                    },
                    runCtl);
                setProgress(100, 'done', _total, _total);
                log('Gotowe', 'done');
            } catch (e) {
                if (e.message === '__cancelled__') {
                    const pct = parseInt($('#ms-progress-pct').textContent) || 0;
                    setProgress(pct, 'cancelled', _processed, _total);
                    log(`Operacja przerwana przez użytkownika (${_processed}/${_total})`, 'error');
                } else {
                    setProgress(100, 'error', _processed, _total);
                    log('BŁĄD: ' + e.message, 'error');
                }
            } finally {
                $('#ms-progress-actions').classList.add('ms-hidden');
                $('#ms-cancel').textContent = 'Zamknij';
            }
        };
    }

    /* ═══════════════════════════════════════════
       RUN OPERATION
       ═══════════════════════════════════════════ */
    /** Sprawdza czy state nadaje sie do trybu szybkiego WebAPI. */
    function canUseWebApi(state) {
        if (!getApiKey()) return false;
        if (state.scope === 'fromFile') return false;
        if (state.mode === 'manual') return state.stock === 'available' || state.stock === 'unavailable';
        if (state.mode === 'auto') {
            if (state.stock === 'infinite') return true;
            if (state.stock === 'finite' && state.finiteMode === 'value') return true;
            if (state.stock === 'unlimited') return true;
        }
        return false;
    }

    /** Szybka sciezka: pobierz rozmiary batchem via WebAPI GET, wyslij update batchem via PUT. */
    async function runViaWebApi(win, productIds, state, log, onProgress, runCtl) {
        const cp = runCtl ? () => runCtl.checkpoint() : async () => {};
        const apiKey = getApiKey();
        const BATCH = 100;
        const CONCURRENCY = 4;

        const targetStocks = state.scope === 'all'
            ? state.warehouses.map(w => w.stockId)
            : state.selectedWh;
        let mgmtType = null;
        if (state.mode === 'manual') mgmtType = 'manual';
        else if (state.mode === 'auto') mgmtType = 'stock';

        let getQty;
        if (state.mode === 'manual') {
            const v = state.stock === 'available' ? -1 : 0;
            getQty = () => v;
        } else if (state.mode === 'auto' && state.stock === 'infinite') {
            getQty = () => 0;
        } else if (state.mode === 'auto' && state.stock === 'finite' && state.finiteMode === 'value') {
            const v = parseInt(state.quantity) || 0;
            getQty = () => v;
        } else if (state.mode === 'auto' && state.stock === 'unlimited') {
            getQty = (pid, sid, stockId) => stockId === 0 ? -1 : 99999;
        } else {
            log('Tryb nie obsugiwany w trybie szybkim', 'error');
            return false;
        }

        // Filter w WebAPI nie dziala — paginujemy cala baze raz, budujemy mape productId->sizes,
        // potem wybieramy tylko zaznaczone. Mozna tez pominac paginacje (state.sizeMode='uniw').
        const selectedSet = new Set(productIds.map(String));
        const sizesByProduct = {};

        // Tryb 'uniw' — zakladamy ze wszystkie towary maja jeden rozmiar 'uniw' / 'one size'.
        // Pomijamy paginacje, idziemy od razu do PUT.
        if (state.sizeMode === 'uniw') {
            log(`[WebAPI] Tryb rozmiaru: WSZYSTKIE one size (uniw) — pomijam odczyt rozmiarow`, 'info');
            for (const pid of productIds) {
                sizesByProduct[String(pid)] = [{ id: 'uniw', name: 'one size' }];
            }
        } else {

        await cp();
        log(`[WebAPI] Pobieranie rozmiarow z bazy (POST /search, paginacja)...`, 'info');
        let first;
        try {
            first = await webApiSearchPage(apiKey, 0);
        } catch (e) {
            log(`[WebAPI] Blad polaczenia: ${e.message}`, 'error');
            return false;
        }
        const totalPages = first.resultsNumberPage || 1;
        const totalAll = first.resultsNumberAll || 0;
        log(`[WebAPI] Baza: ${totalAll} towarow w ${totalPages} stronach (zaznaczonych do update: ${productIds.length})`, 'info');

        function ingestPage(r) {
            for (const p of (r.results || [])) {
                const pid = String(p.productId);
                if (!selectedSet.has(pid)) continue; // tylko zaznaczone
                sizesByProduct[pid] = (p.productSizes || []).map(s => ({
                    id: s.sizeId,
                    name: s.sizePanelName || s.sizeName || s.sizeId,
                }));
            }
        }
        ingestPage(first);

        // Pozostale strony rownolegle
        let pageIdx = 1;
        let pagesDone = 1;
        async function pageWorker() {
            while (true) {
                const myPage = pageIdx;
                if (myPage >= totalPages) break;
                pageIdx++;
                await cp();
                try {
                    const r = await webApiSearchPage(apiKey, myPage);
                    ingestPage(r);
                } catch (e) {
                    log(`[WebAPI] Blad strony ${myPage + 1}: ${e.message}`, 'error');
                    if (/401|403/.test(e.message)) throw e;
                }
                pagesDone++;
                const found = Object.keys(sizesByProduct).length;
                onProgress(Math.round(pagesDone / totalPages * 50), found, productIds.length);
                // Wczesne wyjscie: jesli juz mamy wszystkie zaznaczone, nie ma sensu paginowac dalej
                if (found >= selectedSet.size) {
                    pageIdx = totalPages; // zakoncz pozostalym workerom
                    break;
                }
            }
        }
        try {
            await Promise.all(Array.from({ length: CONCURRENCY }, () => pageWorker()));
        } catch (e) {
            log(`[WebAPI] Blad auth: ${e.message}`, 'error');
            return false;
        }
        const knownSizes = Object.keys(sizesByProduct).length;
        log(`[WebAPI] Pobrano rozmiary dla ${knownSizes}/${productIds.length} zaznaczonych towarow`, knownSizes ? 'info' : 'warn');

        } // end else (sizeMode === 'fetch')

        // Przygotuj batche tylko z zaznaczonych towarow do PUT
        const idBatches = [];
        for (let i = 0; i < productIds.length; i += BATCH) idBatches.push(productIds.slice(i, i + BATCH));

        log(`[WebAPI] Wysylanie aktualizacji (batch ${BATCH}, concurrency ${CONCURRENCY})...`, 'info');
        let processed = 0, ok = 0, err = 0, skipped = 0;
        let putIdx = 0;
        async function putWorker() {
            while (true) {
                const myIdx = putIdx;
                if (myIdx >= idBatches.length) break;
                putIdx++;
                await cp();
                const batch = idBatches[myIdx];
                const products = batch.map(pid => {
                    const sizes = sizesByProduct[String(pid)];
                    if (!sizes || !sizes.length) return null;
                    const productSizes = sizes.map(s => ({
                        sizeId: s.id,
                        sizePanelName: s.name,
                        productStocksData: {
                            productStocksQuantities: targetStocks.map(stockId => ({
                                stockId,
                                productSizeQuantity: getQty(pid, s.id, stockId),
                            })),
                        },
                    }));
                    const payload = { productId: String(pid), productSizes };
                    if (mgmtType) payload.productAvailabilityManagementType = mgmtType;
                    return payload;
                }).filter(Boolean);
                const skippedHere = batch.length - products.length;
                skipped += skippedHere;

                if (products.length) {
                    try {
                        await webApiPutProducts(apiKey, products);
                        ok += products.length;
                    } catch (e) {
                        err += products.length;
                        log(`[WebAPI] Batch ${myIdx + 1}: ${e.message}`, 'error');
                    }
                }
                processed += batch.length;
                onProgress(25 + Math.round(processed / productIds.length * 75), processed, productIds.length);
            }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, () => putWorker()));

        const summary = `[WebAPI] Wynik: ${ok} OK / ${err} bledow${skipped ? ` / ${skipped} pominietych (brak rozmiarow)` : ''}`;
        log(summary, err ? 'error' : 'success');
        return err === 0;
    }

    async function runOperation(win, productIds, state, log, onProgress, runCtl) {
        const cp = runCtl ? () => runCtl.checkpoint() : async () => {};

        // Tryb szybki — WebAPI bulk (gdy mamy klucz i operacja jest wspierana)
        if (canUseWebApi(state)) {
            log('Tryb szybki (WebAPI) — bulk update przez /api/admin/v8/products/products', 'info');
            try {
                const ok = await runViaWebApi(win, productIds, state, log, onProgress, runCtl);
                if (ok) return;
                log('Tryb szybki zakończony z błędami — przełączam na ścieżkę standardową', 'warn');
            } catch (e) {
                if (e && e.message === '__cancelled__') throw e;
                log('Tryb szybki padł: ' + e.message + '. Przełączam na ścieżkę standardową.', 'warn');
            }
        }

        // Krok 1: zmiana trybu
        if (state.mode === 'manual' || state.mode === 'auto') {
            log(`Zmiana trybu na: ${state.mode === 'manual' ? 'ręczny' : 'automatyczny'}`, 'info');
            let i = 0;
            for (const pid of productIds) {
                await cp();
                i++;
                onProgress(Math.round((i / productIds.length) * 30), i, productIds.length);
                try {
                    const r = await setManagementType(win, pid, state.mode);
                    if (r.errno === 0 || r.errno === undefined) log(`Towar ${pid} → tryb ${state.mode} OK`, 'success');
                    else log(`Towar ${pid} → BŁĄD: ${r.error || 'errno=' + r.errno}`, 'error');
                } catch (e) {
                    log(`Towar ${pid} → BŁĄD: ${e.message}`, 'error');
                }
                await sleep(120);
            }
        }

        // Krok 2: scope
        if (state.scope === 'fromFile' && state.file) {
            await runFromFile(win, state, log, onProgress, runCtl);
            return;
        }

        const targetStocks = state.scope === 'all' ? state.warehouses.map(w => w.stockId) : state.selectedWh;

        // Krok 2a: tryb manual
        if (state.mode === 'manual' && state.stock) {
            const statusNum = state.stock === 'available' ? '-1' : '0';
            const label = state.stock === 'available' ? 'JEST' : 'NIEMA';
            const codes = state.warehouses.filter(w => targetStocks.includes(w.stockId)).map(w => w.code).join(', ');
            log(`Magazyny [${codes}] → ${label} (status=${statusNum})`, 'info');

            let i = 0;
            for (const pid of productIds) {
                await cp();
                i++;
                onProgress(30 + Math.round((i / productIds.length) * 70), i, productIds.length);
                try {
                    const sd = await fetchProductSizes(win, pid);
                    if (!sd.sizes.length) { log(`Towar ${pid} → brak rozmiarów`, 'warn'); continue; }
                    let ok = 0, err = 0, noChange = 0;
                    for (const stockId of targetStocks) {
                        for (const sizeObj of sd.sizes) {
                            try {
                                const r = await changeAvailability(win, pid, stockId, sizeObj.id, statusNum);
                                if (r && r.errno !== undefined && r.errno !== 0) err++;
                                else if (r && r.commits && Object.keys(r.commits).length > 0) ok++;
                                else noChange++;
                            } catch (e) { err++; }
                            await sleep(60);
                        }
                    }
                    const cls = err ? 'error' : (ok ? 'success' : 'warn');
                    const ncMsg = noChange ? ` (${noChange} bez zmian)` : '';
                    log(`Towar ${pid} → ${ok} OK / ${err} bł.${ncMsg}`, cls);
                } catch (e) {
                    log(`Towar ${pid} → BŁĄD: ${e.message}`, 'error');
                }
                await sleep(120);
            }
        }

        // Krok 2b: tryb auto + zerowanie
        if (state.mode === 'auto' && state.stock === 'infinite') {
            log(`Zerowanie stanów magazynowych`, 'info');
            try {
                const r = await cleanQuantity(win, productIds, ['stock_quantity']);
                log(`Wyzerowano ${r.stock_quantity || '?'} towarów, rezerwacje: ${r.reservations || 0}`, 'success');
            } catch (e) {
                log(`BŁĄD: ${e.message}`, 'error');
            }
        }

        // Krok 2b': tryb auto + nieskończony — M0: unlimited, inne magazyny: ilość 99999
        if (state.mode === 'auto' && state.stock === 'unlimited') {
            if (!targetStocks.includes(0)) {
                log(`Stan nieskończony wymaga magazynu M0 wśród docelowych`, 'warn');
            } else {
                const ownStocks = targetStocks.filter(id => id !== 0);
                const ownCodes = state.warehouses.filter(w => ownStocks.includes(w.stockId)).map(w => w.code).join(', ');
                log(`Stan nieskończony: M0 → unlimited${ownStocks.length ? `, magazyny własne [${ownCodes}] → ilość 99999` : ''}`, 'info');
                const FAKE_INFINITE = 99999;
                let i = 0;
                for (const pid of productIds) {
                    await cp();
                    i++;
                    onProgress(30 + Math.round((i / productIds.length) * 70), i, productIds.length);
                    try {
                        const sd = await fetchProductSizes(win, pid);
                        if (!sd.sizes.length) { log(`Towar ${pid} → brak rozmiarów`, 'warn'); continue; }
                        let m0ok = false, m0err = null;
                        let ownOk = 0, ownErr = 0, ownNoChange = 0;
                        // M0 → unlimited
                        try {
                            const r = await saveStockUnlimited(win, pid, sd.sizes.map(s => s.id));
                            if (r && r.errno !== undefined && r.errno !== 0) m0err = `errno=${r.errno} ${r.error || ''}`;
                            else m0ok = true;
                        } catch (e) { m0err = e.message; }
                        await sleep(80);
                        // Inne magazyny → ilość 99999 (per rozmiar, diff vs aktualna)
                        for (const stockId of ownStocks) {
                            for (const sizeObj of sd.sizes) {
                                try {
                                    const r = await setTargetQuantity(win, pid, stockId, sizeObj.id, FAKE_INFINITE);
                                    if (!r.changed) ownNoChange++;
                                    else ownOk++;
                                } catch (e) { ownErr++; }
                                await sleep(60);
                            }
                        }
                        const parts = [];
                        if (m0ok) parts.push(`M0 unlim. OK`);
                        if (m0err) parts.push(`M0 BŁĄD: ${m0err}`);
                        if (ownStocks.length) parts.push(`własne: ${ownOk} OK / ${ownErr} bł.${ownNoChange ? ` / ${ownNoChange} bez zmian` : ''}`);
                        const cls = (m0err || ownErr) ? 'error' : 'success';
                        log(`Towar ${pid} → ${parts.join(', ')}`, cls);
                    } catch (e) {
                        log(`Towar ${pid} → BŁĄD: ${e.message}`, 'error');
                    }
                    await sleep(100);
                }
            }
        }

        // Krok 2c: tryb auto + finite + value
        if (state.mode === 'auto' && state.stock === 'finite' && state.finiteMode === 'value') {
            const target = Number(state.quantity);
            const codes = state.warehouses.filter(w => targetStocks.includes(w.stockId)).map(w => w.code).join(', ');
            log(`Ustawianie ilości = ${target} szt. dla magazynów [${codes}]`, 'info');

            let i = 0;
            for (const pid of productIds) {
                await cp();
                i++;
                onProgress(30 + Math.round((i / productIds.length) * 70), i, productIds.length);
                try {
                    const sd = await fetchProductSizes(win, pid);
                    if (!sd.sizes.length) { log(`Towar ${pid} → brak rozmiarów`, 'warn'); continue; }
                    let ok = 0, err = 0, noChange = 0;
                    for (const stockId of targetStocks) {
                        for (const sizeObj of sd.sizes) {
                            try {
                                const r = await setTargetQuantity(win, pid, stockId, sizeObj.id, target);
                                if (!r.changed) noChange++;
                                else ok++;
                            } catch (e) { err++; }
                            await sleep(60);
                        }
                    }
                    const cls = err ? 'error' : (ok ? 'success' : 'warn');
                    const ncMsg = noChange ? ` (${noChange} bez zmian)` : '';
                    log(`Towar ${pid} → ${ok} OK / ${err} bł.${ncMsg}`, cls);
                } catch (e) {
                    log(`Towar ${pid} → BŁĄD: ${e.message}`, 'error');
                }
                await sleep(120);
            }
        }

        // Krok 2d: tryb auto + finite + file
        if (state.mode === 'auto' && state.stock === 'finite' && state.finiteMode === 'file' && state.file) {
            await runFromFile(win, state, log, onProgress, runCtl);
        }
    }

    async function runFromFile(win, state, log, onProgress, runCtl) {
        const cp = runCtl ? () => runCtl.checkpoint() : async () => {};
        log(`Wczytywanie pliku: ${state.file.name}`, 'info');
        const text = await state.file.text();
        const isXml = /\.xml$/i.test(state.file.name) || text.trim().startsWith('<');
        const rows = isXml ? parseXmlFile(text) : parseCsvFile(text);

        if (!rows.length) {
            log(`BŁĄD: nie znaleziono żadnych wpisów w pliku`, 'error');
            return;
        }
        log(`Wczytano ${rows.length} wpisów z pliku`, 'info');

        // Cache sizes per product
        const sizeCache = {};
        async function getSizes(pid) {
            if (!sizeCache[pid]) sizeCache[pid] = await fetchProductSizes(win, pid);
            return sizeCache[pid];
        }

        let ok = 0, err = 0, noChange = 0;
        let i = 0;
        for (const row of rows) {
            await cp();
            i++;
            onProgress(30 + Math.round((i / rows.length) * 70), i, rows.length);
            const pid = row.productId;
            const stockId = parseInt(row.warehouse);
            if (isNaN(stockId)) { err++; log(`Wiersz ${i}: zły stockId "${row.warehouse}"`, 'error'); continue; }

            try {
                const sd = await getSizes(pid);
                if (!sd.sizes.length) { log(`Towar ${pid}: brak rozmiarów`, 'warn'); continue; }

                // Zmapuj size z pliku (id LUB name) na właściwy sizeId
                const resolvedSizeId = resolveSize(row.size, sd.sizes);
                if (!resolvedSizeId) {
                    err++;
                    const avail = sd.sizes.map(s => `${s.id}=${s.name}`).join(', ');
                    log(`Wiersz ${i} (towar ${pid}): nieznany rozmiar "${row.size}". Dostępne: ${avail}`, 'error');
                    continue;
                }

                // Decyzja semantyki wartości:
                // - tryb 'manual' → zawsze stan (1=JEST, 0=NIEMA)
                // - tryb 'auto'   → zawsze ilość liczbowa
                // - tryb 'skip'   → autodetekcja po wartości: 0/1/y/n/true/false → stan, inaczej → ilość
                const v = String(row.value).trim().toLowerCase();
                const isStateVal = (v === '0' || v === '1' || v === 'y' || v === 'n' || v === 'true' || v === 'false');
                const treatAsState = state.mode === 'manual' || (state.mode === 'skip' && isStateVal);
                const treatAsQty = state.mode === 'auto' || (state.mode === 'skip' && !isStateVal);

                if (treatAsState) {
                    if (!isStateVal) {
                        err++;
                        log(`Wiersz ${i} (towar ${pid}): zła wartość "${row.value}" — w trybie ręcznym oczekiwane 0 lub 1`, 'error');
                        continue;
                    }
                    const statusNum = (v === '1' || v === 'y' || v === 'true') ? '-1' : '0';
                    try {
                        const r = await changeAvailability(win, pid, stockId, resolvedSizeId, statusNum);
                        if (r && r.errno !== undefined && r.errno !== 0) {
                            err++;
                            log(`Wiersz ${i} (towar ${pid} mag=${stockId} rozm=${resolvedSizeId}): errno=${r.errno} ${r.error || ''}`, 'error');
                        } else if (r && r.commits && Object.keys(r.commits).length > 0) {
                            ok++;
                            log(`Wiersz ${i}: towar ${pid} mag=${stockId} rozm=${resolvedSizeId} → ${statusNum === '-1' ? 'JEST' : 'NIEMA'}`, 'success');
                        } else {
                            noChange++;
                            log(`Wiersz ${i}: towar ${pid} mag=${stockId} rozm=${resolvedSizeId} → bez zmian (już ustawione)`, 'warn');
                        }
                    } catch (e) { err++; log(`Wiersz ${i}: ${e.message}`, 'error'); }
                } else if (treatAsQty) {
                    const target = Number(row.value);
                    if (isNaN(target) || target < 0 || !Number.isInteger(target)) {
                        err++;
                        log(`Wiersz ${i} (towar ${pid}): zła ilość "${row.value}" — oczekiwana liczba całkowita ≥ 0`, 'error');
                        continue;
                    }
                    try {
                        const r = await setTargetQuantity(win, pid, stockId, resolvedSizeId, target);
                        if (!r.changed) {
                            noChange++;
                            log(`Wiersz ${i}: towar ${pid} mag=${stockId} rozm=${resolvedSizeId} → ${target} szt. (bez zmian)`, 'warn');
                        } else {
                            ok++;
                            log(`Wiersz ${i}: towar ${pid} mag=${stockId} rozm=${resolvedSizeId} → ${target} szt. (${r.op} ${r.diff} z ${r.current})`, 'success');
                        }
                    } catch (e) {
                        err++;
                        log(`Wiersz ${i} (towar ${pid} mag=${stockId} rozm=${resolvedSizeId}): ${e.message}`, 'error');
                    }
                }
            } catch (e) {
                err++;
                log(`Towar ${pid}: BŁĄD ${e.message}`, 'error');
            }
            await sleep(60);
        }
        log(`Plik: ${ok} OK / ${err} błędów${noChange ? ' / ' + noChange + ' bez zmian' : ''}`, err ? 'error' : 'success');
    }

    /* ═══════════════════════════════════════════
       PŁYWAJĄCY TAB PANELPRO (slim trigger po prawej)
       ═══════════════════════════════════════════ */
    // Selektory ikonki lupki w panelu IdoSell — pierwsze dopasowanie wyznacza
    // pozycję i rozmiar PanelPro taba (10px poniżej, identyczny rozmiar).
    const LUPKA_SELECTORS = [
        '#globalSearch', '#topSearch', '.global-search-button',
        '[data-action*="search"]', 'button[title*="zukaj" i]',
        'a[title*="zukaj" i]', '[class*="search-toggle"]',
        '[class*="search-icon"]', '[class*="lupa"]', '[class*="lupka"]',
    ];
    const PP_TAB_FALLBACK_TOP = 100;
    const PP_TAB_FALLBACK_W = 50;
    const PP_TAB_FALLBACK_H = 46;

    const TAB_CSS = `
        #pp-tab {
            position:fixed; right:0;
            width:${PP_TAB_FALLBACK_W}px; height:${PP_TAB_FALLBACK_H}px;
            top:${PP_TAB_FALLBACK_TOP}px;
            border:1px solid #e0e3ea;
            background:#fff; padding:0;
            color:#98a2b3; cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            border-radius:0;
            box-shadow:0 2px 6px rgba(0,0,0,.08);
            transition:background .15s, color .15s, border-color .15s, width .25s ease, padding .2s ease, box-shadow .2s ease;
            z-index:99990;
            overflow:hidden; white-space:nowrap;
            font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
        }
        #pp-tab:hover:not(:disabled) {
            background:#f5f8ff; color:#4f8cff; border-color:#c0cfff;
            width:auto; padding:0 14px 0 10px; gap:8px;
            justify-content:flex-start;
        }
        #pp-tab:hover:not(:disabled) #pp-tab-label {
            max-width:260px; opacity:1;
        }
        #pp-tab:disabled {
            cursor:not-allowed; opacity:.55;
        }
        #pp-tab svg { width:18px; height:18px; flex-shrink:0; }
        #pp-tab-label {
            max-width:0; opacity:0; overflow:hidden;
            font-size:12px; font-weight:600;
            transition:max-width .25s ease, opacity .2s ease;
            display:inline-flex; align-items:center; gap:6px;
        }
        #pp-tab-badge {
            min-width:18px; padding:0 6px; height:18px;
            background:#4f8cff; color:#fff; font-size:11px; font-weight:700;
            border-radius:9px;
            display:none; align-items:center; justify-content:center; line-height:1;
        }
        #pp-tab-badge.pp-show { display:inline-flex; }
    `;

    const ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

    function injectFloatingWidget(doc) {
        if (doc.querySelector('#pp-tab')) return;

        if (!doc.querySelector('#pp-tab-css')) {
            const style = doc.createElement('style');
            style.id = 'pp-tab-css';
            style.textContent = TAB_CSS;
            doc.head.appendChild(style);
        }

        const tab = doc.createElement('button');
        tab.id = 'pp-tab';
        tab.type = 'button';
        tab.disabled = true;
        tab.innerHTML = `${ICON_BOX}<span id="pp-tab-label">Zmiana stanów magazynowych<span id="pp-tab-badge">0</span></span>`;
        doc.body.appendChild(tab);

        const badge = doc.querySelector('#pp-tab-badge');

        tab.addEventListener('click', () => {
            const win = getIframeWin();
            const ids = getSelectedProductIds(doc, win);
            if (!ids.length) return;
            openModal(doc, win, ids);
        });

        // Dopasuj pozycję / wymiary / styl do lupki — szerokość i wysokość
        // kopiowane 1:1, top = bottom lupki + 10px, border-color i box-shadow
        // przejmowane z computed style.
        function alignToLupka() {
            const candidates = [doc, document];
            for (const d of candidates) {
                if (!d) continue;
                for (const sel of LUPKA_SELECTORS) {
                    let el;
                    try { el = d.querySelector(sel); } catch (e) { continue; }
                    if (!el) continue;
                    const win = d.defaultView || window;
                    const r = el.getBoundingClientRect();
                    if (r.width < 16 || r.height < 16) continue;
                    if (r.right < win.innerWidth - 80) continue;
                    const cs = win.getComputedStyle(el);
                    tab.style.width = Math.round(r.width) + 'px';
                    tab.style.height = Math.round(r.height) + 'px';
                    tab.style.top = Math.round(r.bottom + 10) + 'px';
                    if (cs.borderColor && cs.borderColor !== 'rgba(0, 0, 0, 0)') {
                        tab.style.borderColor = cs.borderColor;
                    }
                    if (cs.boxShadow && cs.boxShadow !== 'none') {
                        tab.style.boxShadow = cs.boxShadow;
                    }
                    return true;
                }
            }
            return false;
        }
        // Uruchom kilka razy — lupka może załadować się asynchronicznie.
        alignToLupka();
        setTimeout(alignToLupka, 500);
        setTimeout(alignToLupka, 1500);
        setTimeout(alignToLupka, 3000);
        // Re-align przy resize okna
        (doc.defaultView || window).addEventListener('resize', alignToLupka);

        // Niezawodna detekcja zaznaczenia: hook IAI.Table + click delegation +
        // fallback polling co 800ms (na wypadek gdyby panel nie wywołał aktualizacji).
        function refreshSelection() {
            const win = getIframeWin();
            const ids = getSelectedProductIds(doc, win);
            const n = ids.length;
            tab.disabled = n === 0;
            badge.textContent = n > 99 ? '99+' : String(n);
            badge.classList.toggle('pp-show', n > 0);
            tab.title = n === 0 ? 'PanelPro — zaznacz towary' : `PanelPro — ${n} zaznaczonych`;
        }
        refreshSelection();

        function hookSelectionEvents() {
            const win = getIframeWin();
            // 1) IAI.Table label update
            if (win && win.IAI && win.IAI.Table && win.IAI.Table.actualizeLabelAndButtons && !win.IAI.Table.__ppHooked) {
                const orig = win.IAI.Table.actualizeLabelAndButtons;
                win.IAI.Table.actualizeLabelAndButtons = function () {
                    orig.apply(this, arguments);
                    refreshSelection();
                };
                win.IAI.Table.__ppHooked = true;
            }
            // 2) Bezpośredni click na checkboxach + change na #select_all
            doc.addEventListener('click', (e) => {
                const t = e.target;
                if (!t) return;
                if (t.matches && (t.matches('input[type=checkbox]') || t.closest('input[type=checkbox]') || t.closest('tr.iai-table-row'))) {
                    setTimeout(refreshSelection, 50);
                }
            }, true);
        }
        hookSelectionEvents();

        // 3) Fallback polling — działa nawet gdy żaden hook nie zadziała.
        setInterval(refreshSelection, 800);
    }

    /* ═══════════════════════════════════════════
       INIT
       ═══════════════════════════════════════════ */
    function waitForIframe(cb) {
        let injected = false;

        function tryInject() {
            if (injected) return;
            const doc = getIframeDoc();
            if (doc && doc.querySelector('#bottom_menu_products')) {
                injected = true;
                cb(doc);
                observeChanges(doc);
            }
        }

        function observeChanges(iframeDoc) {
            const obs = new MutationObserver(() => {
                const cur = getIframeDoc();
                if (!cur) { injected = false; return; }
                if (cur !== iframeDoc) {
                    obs.disconnect();
                    injected = false;
                    startPolling();
                    return;
                }
                if (cur.querySelector('#bottom_menu_products') && !cur.querySelector('#pp-tab')) {
                    injected = false;
                    tryInject();
                }
            });
            try { obs.observe(iframeDoc.body, { childList:true, subtree:true }); } catch (e) {}
        }

        function startPolling() {
            let attempts = 0;
            const iv = setInterval(() => {
                attempts++;
                tryInject();
                if (injected || attempts > 60) clearInterval(iv);
            }, 500);
        }

        startPolling();

        const mainObs = new MutationObserver(() => { if (!injected) tryInject(); });
        mainObs.observe(document.body, { childList:true, subtree:true });
    }

    waitForIframe(doc => {
        injectFloatingWidget(doc);
    });

})();
