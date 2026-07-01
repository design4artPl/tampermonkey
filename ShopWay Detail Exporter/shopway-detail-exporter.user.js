// ==UserScript==
// @name         ShopWay Detail Exporter
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  Eksport szczegolowych danych produktow z panelu ShopWay (fetch+JSON, bez iframe). ~100x szybszy niz v3.9.
// @author       Claude
// @match        https://poscielone.pl/admin/product*
// @match        https://febetrade.pl/admin/product*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    var ORIGIN = window.location.origin;

    // ==== stan ====
    var isRunning = false;
    var shouldStop = false;
    var logMessages = [];
    var logDiv = null;
    var db = null;

    // ==== metadane sesji ====
    var langMap = {};           // { '1': 'pl', '2': 'en' }
    var vatMap = {};            // { '2': '23.00', '47': '0.00' }
    var catMap = {};            // { id: { name, parent } }
    var xjxCategoriesFun = '';
    var refUrl = '';

    // ==== statystyki ====
    var okCount = 0, errCount = 0;

    // ========== LOG ==========
    function log(type, msg) {
        var ts = new Date().toLocaleTimeString('pl-PL');
        logMessages.unshift({ type: type, msg: '[' + ts + '] ' + msg });
        if (logMessages.length > 200) logMessages.pop();
        renderLog();
        if (type === 'error') console.error('[EXP4] ' + msg);
        else if (type === 'warn') console.warn('[EXP4] ' + msg);
        else console.log('[EXP4] ' + msg);
    }
    function renderLog() {
        if (!logDiv) return;
        var COLORS = { info: '#bdc3c7', ok: '#2ecc71', warn: '#f39c12', error: '#e74c3c' };
        logDiv.innerHTML = logMessages.slice(0, 100).map(function(e) {
            var color = COLORS[e.type] || '#bdc3c7';
            return '<div style="color:' + color + ';font-size:10px;padding:1px 0;">' + escapeHtml(e.msg) + '</div>';
        }).join('');
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
            return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
        });
    }
    function setStatus(t) { var el = document.getElementById('exp4-status'); if (el) el.textContent = t; }
    function setProgress(d, t) {
        var pct = t ? Math.round(d / t * 100) : 0;
        var bar = document.getElementById('exp4-progress'); if (bar) bar.style.width = pct + '%';
        var lbl = document.getElementById('exp4-progress-label'); if (lbl) lbl.textContent = d + ' / ' + t + '  (' + pct + '%)';
    }

    // ========== HELPERS ==========
    function stripHtml(s) {
        if (!s) return '';
        var t = String(s).replace(/<[^>]+>/g, ' ');
        return t.replace(/\s+/g, ' ').trim();
    }
    // Balansowanie klamer: wyciagniecie obiektu JSON od pozycji ktora zaczyna sie od '{'.
    function extractJsonObject(text, startIdx) {
        var depth = 0, i = startIdx;
        for (; i < text.length; i++) {
            var c = text[i];
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
            else if (c === '"') {
                i++;
                while (i < text.length && text[i] !== '"') {
                    if (text[i] === '\\') i++;
                    i++;
                }
            }
        }
        return text.substring(startIdx, i);
    }

    // ========== IndexedDB ==========
    function openDb() {
        return new Promise(function(res) {
            var req = indexedDB.open('ShopWayExporter4', 1);
            req.onupgradeneeded = function(e) {
                var d = e.target.result;
                if (!d.objectStoreNames.contains('products')) d.createObjectStore('products', { keyPath: 'id' });
            };
            req.onsuccess = function(e) { db = e.target.result; res(); };
            req.onerror = function() { res(); };
        });
    }
    function dbPut(rec) {
        return new Promise(function(res) {
            if (!db || !rec || !rec.id) return res();
            var t = db.transaction(['products'], 'readwrite');
            t.objectStore('products').put(rec);
            t.oncomplete = function() { res(); };
            t.onerror = function() { res(); };
        });
    }
    function dbClear() {
        return new Promise(function(res) {
            if (!db) return res();
            var t = db.transaction(['products'], 'readwrite');
            t.objectStore('products').clear();
            t.oncomplete = function() { res(); };
        });
    }

    // ========== INIT: jezyki, VAT, xjxfun kategorii ==========
    async function initSession(sampleProductId) {
        var url = ORIGIN + '/admin/product/edit/' + sampleProductId;
        var res = await fetch(url, { credentials: 'include' });
        var html = await res.text();

        // xjxfun dla drzewa kategorii (pierwszy xajax_GetChildren_*)
        var m = /xajax_GetChildren_\d+\s*=\s*function\(\)\s*\{\s*return\s+xajax\.request\(\s*\{\s*xjxfun:\s*'([^']+)'/.exec(html);
        if (!m) throw new Error('Nie znaleziono xjxfun dla drzewa kategorii');
        xjxCategoriesFun = m[1];
        refUrl = url;

        // Mapa jezykow: oLanguages: {"1":{"id":"1","flag":"pl_PL.png",...}}
        var lIdx = html.indexOf('oLanguages: {');
        if (lIdx !== -1) {
            try {
                var lStr = extractJsonObject(html, lIdx + 'oLanguages: '.length);
                var langs = JSON.parse(lStr);
                Object.keys(langs).forEach(function(id) {
                    var flag = (langs[id] && langs[id].flag) || '';
                    var code = (flag.split('_')[0] || '').toLowerCase() || 'x' + id;
                    langMap[id] = code;
                });
            } catch (e) { log('warn', 'Nie sparsowano oLanguages: ' + e.message); }
        }
        if (Object.keys(langMap).length === 0) langMap['1'] = 'pl';
        log('info', 'Jezyki: ' + JSON.stringify(langMap));

        // Mapa VAT: aoVatValues: {"2":"23.00", ...}
        var vIdx = html.indexOf('aoVatValues: {');
        if (vIdx !== -1) {
            try {
                var vStr = extractJsonObject(html, vIdx + 'aoVatValues: '.length);
                vatMap = JSON.parse(vStr);
            } catch (e) {}
        }
        log('info', 'VAT stawek: ' + Object.keys(vatMap).length);
    }

    // ========== BFS drzewa kategorii ==========
    async function getChildren(parentId) {
        var arg = '<xjxobj><e><k>parent</k><v>' + parentId + '</v></e></xjxobj>';
        var body = 'xjxfun=' + encodeURIComponent(xjxCategoriesFun) +
                   '&xjxr=' + Date.now() +
                   '&xjxargs[]=' + encodeURIComponent(arg) +
                   '&xjxargs[]=GCallback.Trigger_0';
        var res = await fetch(refUrl, {
            method: 'POST', credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body
        });
        var txt = await res.text();
        var jm = /Trigger_0\((\{[\s\S]*?\})\)/.exec(txt);
        if (!jm) return {};
        try { return JSON.parse(jm[1]).children || {}; } catch (e) { return {}; }
    }

    async function buildCategoryMap() {
        catMap = {};
        var queue = ['0'];
        var visited = {};
        var calls = 0;
        while (queue.length && !shouldStop) {
            var batch = queue.splice(0, 6);
            var results = await Promise.all(batch.map(function(pid) {
                return getChildren(pid).then(function(ch) { return { pid: pid, ch: ch }; });
            }));
            calls += batch.length;
            results.forEach(function(r) {
                for (var id in r.ch) {
                    var c = r.ch[id];
                    var parent = (c.parent && c.parent !== 'null' && c.parent !== '0') ? c.parent : null;
                    catMap[id] = { name: c.name, parent: parent };
                    if (c.hasChildren && !visited[id]) { visited[id] = true; queue.push(id); }
                }
            });
            setStatus('Buduje mape kategorii: ' + Object.keys(catMap).length + '...');
        }
        log('ok', 'Mapa kategorii: ' + Object.keys(catMap).length + ' pozycji (' + calls + ' zapytan xajax)');
    }

    function catPathOf(id) {
        var parts = [], cur = id, guard = 0;
        while (cur && catMap[cur] && guard++ < 30) {
            parts.unshift(catMap[cur].name);
            cur = catMap[cur].parent;
        }
        return parts.length ? parts.join('\\') : '#' + id;
    }
    function buildCategoryPaths(assignedIds) {
        if (!assignedIds || !assignedIds.length) return '';
        var leaves = assignedIds.filter(function(id) {
            return !assignedIds.some(function(other) {
                return other !== id && catMap[other] && catMap[other].parent === id;
            });
        });
        var uniq = {}, out = [];
        leaves.map(catPathOf).forEach(function(p) { if (!uniq[p]) { uniq[p] = true; out.push(p); } });
        return out.join('\n');
    }

    // ========== FAZA A: bulk lista wszystkich produktow (jeden POST) ==========
    async function fetchBulkList() {
        var cols = '_select, name, categoriesname, ean, producer, sellprice_gross, stock, reserved, enable, allegroauctionstatus, _options';
        var arg = '<xjxobj><e><k>id</k><v>0</v></e><e><k>from</k><v><![CDATA[' + cols + ']]></v></e><e><k>starting_from</k><v>0</v></e><e><k>limit</k><v>50000</v></e><e><k>order_by</k><v>idproduct</v></e><e><k>order_dir</k><v>desc</v></e><e><k>where</k><v><xjxobj></xjxobj></v></e></xjxobj>';
        var body = 'xjxfun=getProductForAjax&xjxr=' + Date.now() + '&xjxargs[]=' + encodeURIComponent(arg) + '&xjxargs[]=GF_Datagrid.ProcessIncomingData';
        var t0 = performance.now();
        var res = await fetch(ORIGIN + '/admin/product', {
            method: 'POST', credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body
        });
        var txt = await res.text();
        // ProcessIncomingData({...}) - klucze bez cudzyslowow. Uzywamy Function() aby sparsowac literal obiektowy.
        var pIdx = txt.indexOf('ProcessIncomingData(');
        if (pIdx === -1) throw new Error('Nie znaleziono ProcessIncomingData w odpowiedzi');
        var objStr = extractJsonObject(txt, pIdx + 'ProcessIncomingData('.length);
        var payload;
        try {
            payload = (new Function('return (' + objStr + ')'))();
        } catch (e) {
            throw new Error('Blad parse bulk: ' + e.message);
        }
        var t1 = performance.now();
        log('ok', 'Bulk lista: ' + payload.rows.length + '/' + payload.total + ' w ' + Math.round(t1 - t0) + 'ms');
        return payload.rows;
    }

    // ========== FAZA B: fetch szczegolow jednego produktu ==========
    async function fetchDetail(id) {
        var url = ORIGIN + '/admin/product/edit/' + id;
        try {
            var res = await fetch(url, { credentials: 'include', redirect: 'follow' });
            if (res.url.indexOf('/product/edit/') === -1) return { id: id, missing: true };
            var html = await res.text();
            var idx = html.indexOf('oValues: {');
            if (idx === -1) return { id: id, error: 'brak oValues' };
            var jsonStr = extractJsonObject(html, idx + 'oValues: '.length);
            var oValues;
            try { oValues = JSON.parse(jsonStr); } catch (e) { return { id: id, error: 'parse: ' + e.message }; }
            return { id: id, oValues: oValues };
        } catch (e) {
            return { id: id, error: e.message };
        }
    }

    // ========== MAPOWANIE bulkRow + oValues -> flat record ==========
    function mapProduct(bulkRow, detailWrap) {
        var r = { id: (bulkRow && bulkRow.idproduct) || (detailWrap && detailWrap.id) };
        var codes = Object.keys(langMap).map(function(id) { return langMap[id]; });
        var firstCode = codes[0] || 'pl';
        var lids = Object.keys(langMap);

        // === Bulk (zawsze) ===
        if (bulkRow) {
            r.wyswietlany = bulkRow.enable === '1' ? 'Tak' : 'Nie';
            r.producent = bulkRow.producer;
            r.dostawca = bulkRow.deliverer;
            r.stan_magazynowy = bulkRow.stock;
            r.rezerwacja = bulkRow.reserved;
            r.stawka_vat = bulkRow.vat;
            r.data_dodania = bulkRow.adddate;
            r.thumb = bulkRow.thumb;
        }

        // === Fallback z bulk gdy brak detali (tryb Szybki) ===
        var hasDetail = detailWrap && detailWrap.oValues;
        if (!hasDetail && bulkRow) {
            r['nazwa_' + firstCode] = bulkRow.name;
            r['url_' + firstCode] = bulkRow.seo || '';
            r.ean = bulkRow.ean;
            r.kod_dostawcy = bulkRow.delivelercode;
            r.kategorie = (bulkRow.categoriesname || '').trim();
            r.waga_kg = bulkRow.weight;
            var wg = parseFloat(bulkRow.weight);
            r.waga_g = !isNaN(wg) ? Math.round(wg * 1000).toString() : '';
            r.cena_zakupu_netto = bulkRow.buyprice;
            r.cena_zakupu_brutto = bulkRow.buyprice_gross;
            r.cena_sprzedazy_netto = bulkRow.sellprice;
            r.cena_sprzedazy_brutto = bulkRow.sellprice_gross;
            r.ikona = bulkRow.thumb;
        }

        // === Szczegoly z oValues ===
        if (hasDetail) {
            var o = detailWrap.oValues;

            // basic_pane
            if (o.basic_pane) {
                var bp = o.basic_pane;
                lids.forEach(function(lid) {
                    var code = langMap[lid];
                    var name = bp.language_data && bp.language_data.name && bp.language_data.name[lid];
                    var seo = bp.language_data && bp.language_data.seo && bp.language_data.seo[lid];
                    r['nazwa_' + code] = name || '';
                    r['url_' + code] = seo ? (ORIGIN + '/produkt/' + seo) : '';
                });
                r.wyswietlany = bp.enable === '1' ? 'Tak' : 'Nie';
                r.zgodny_ze_zdjeciem = bp.verticalphoto === '1' ? 'Tak' : 'Nie';
                r.ean = bp.ean || '';
                r.kod_dostawcy = bp.delivelercode || '';
            }

            // meta_data
            if (o.meta_data && o.meta_data.language_data) {
                var md = o.meta_data.language_data;
                lids.forEach(function(lid) {
                    var code = langMap[lid];
                    r['seo_tytul_' + code] = (md.keywordtitle && md.keywordtitle[lid]) || '';
                    r['seo_opis_' + code] = (md.keyworddescription && md.keyworddescription[lid]) || '';
                    r['seo_slowa_kluczowe_' + code] = (md.keyword && md.keyword[lid]) || '';
                });
            }

            // description_pane
            if (o.description_pane && o.description_pane.language_data) {
                var dd = o.description_pane.language_data;
                lids.forEach(function(lid) {
                    var code = langMap[lid];
                    var shortHtml = (dd.shortdescription && dd.shortdescription[lid]) || '';
                    var descHtml = (dd.description && dd.description[lid]) || '';
                    var longHtml = (dd.longdescription && dd.longdescription[lid]) || '';
                    r['opis_krotki_' + code] = stripHtml(shortHtml);
                    r['opis_dlugi_html_' + code] = descHtml;
                    r['opis_dodatkowe_info_html_' + code] = longHtml;
                    r['opis_rozszerzony_html_' + code] = descHtml + (longHtml ? '\n' + longHtml : '');
                });
            }

            // stock_pane
            if (o.stock_pane) {
                if (o.stock_pane.stock !== undefined && o.stock_pane.stock !== null) r.stan_magazynowy = String(o.stock_pane.stock);
                r.dostepnosc_id = o.stock_pane.availablityid;
            }

            // category_pane
            if (o.category_pane && Array.isArray(o.category_pane.category)) {
                var catIds = o.category_pane.category.map(String);
                r.kategorie = buildCategoryPaths(catIds);
                r.kategoria_id = catIds.join(',');
            }

            // price_pane
            if (o.price_pane) {
                var pp = o.price_pane;
                r.grupa_cenowa_id = pp.pricegroupid;
                r.vat_id = pp.vatid;
                var vatPct = parseFloat(vatMap[pp.vatid]);
                if (isNaN(vatPct)) vatPct = 23;
                r.stawka_vat = vatPct.toFixed(2) + '%';
                r.waluta_sprzedazy_id = pp.sellcurrencyid;
                r.waluta_zakupu_id = pp.buycurrencyid;

                var buyNet = parseFloat(pp.buyprice) || 0;
                r.cena_zakupu_netto = pp.buyprice != null ? String(pp.buyprice) : '';
                r.cena_zakupu_brutto = (buyNet * (1 + vatPct / 100)).toFixed(2);

                if (pp.standard_price) {
                    var sp = pp.standard_price;
                    var sellNet = parseFloat(sp.sellprice) || 0;
                    r.cena_sprzedazy_netto = sp.sellprice != null ? String(sp.sellprice) : '';
                    r.cena_sprzedazy_brutto = (sellNet * (1 + vatPct / 100)).toFixed(2);
                    var discNet = parseFloat(sp.discountprice) || 0;
                    r.cena_promocyjna_netto = sp.discountprice != null ? String(sp.discountprice) : '';
                    r.cena_promocyjna_brutto = discNet > 0 ? (discNet * (1 + vatPct / 100)).toFixed(2) : '';
                    r.data_rozpoczecia_promocji = sp.promotionstart || '';
                    r.data_zakonczenia_promocji = sp.promotionend || '';
                }
            }

            // weight_pane
            if (o.weight_pane) {
                var wp = o.weight_pane;
                r.waga_kg = wp.weight != null ? String(wp.weight) : '';
                var wnum = parseFloat(wp.weight);
                r.waga_g = !isNaN(wnum) ? Math.round(wnum * 1000).toString() : '';
                r.szerokosc = wp.width != null ? String(wp.width) : '';
                r.wysokosc = wp.height != null ? String(wp.height) : '';
                r.glebokosc = wp.deepth != null ? String(wp.deepth) : '';
                r.jednostka_miary_id = wp.unit;
                r.ilosc_w_opakowaniu = wp.packagesize != null ? String(wp.packagesize) : '';
            }

            // photos_pane
            if (o.photos_pane && Array.isArray(o.photos_pane.photo)) {
                var photoIds = o.photos_pane.photo;
                // Extension: uzyj tej z bulk thumb (jesli dostepny), fallback jpg.
                // Uwaga: extensions moga sie roznic per zdjecie w rzadkich przypadkach; brak sposobu detekcji per-id bez renderu.
                var ext = 'jpg';
                if (bulkRow && bulkRow.thumb) {
                    var em = /\.(jpg|jpeg|png|gif)(?:[?#]|$)/i.exec(bulkRow.thumb);
                    if (em) ext = em[1].toLowerCase();
                }
                var urls = photoIds.map(function(pid) {
                    return ORIGIN + '/design/_gallery/_orginal/' + pid + '.' + ext;
                });
                r.galeria = urls.join('\n');
                r.ikona = urls[0] || r.ikona || '';
            }

            // relacje
            r.akcesoria = (o.upsell_products && Array.isArray(o.upsell_products.upsell)) ? o.upsell_products.upsell.join(',') : '';
            r.produkty_podobne = (o.similar_products && Array.isArray(o.similar_products.similar)) ? o.similar_products.similar.join(',') : '';
            r.sprzedaz_krzyzowa = (o.crosssell_products && Array.isArray(o.crosssell_products.crosssell)) ? o.crosssell_products.crosssell.join(',') : '';

            // tech_pane -> raw JSON (bez mapowania nazw)
            if (o.tech_pane) r.dane_techniczne = JSON.stringify(o.tech_pane);
        }

        return r;
    }

    // ========== POOL ==========
    async function runPool(items, worker, concurrency, onProgress) {
        var results = new Array(items.length);
        var idx = 0, doneL = 0;
        async function runner() {
            while (idx < items.length && !shouldStop) {
                var i = idx++;
                try { results[i] = await worker(items[i], i); }
                catch (e) { results[i] = { error: e.message }; }
                doneL++;
                if (onProgress) onProgress(doneL, items.length);
            }
        }
        var pool = [];
        for (var c = 0; c < concurrency; c++) pool.push(runner());
        await Promise.all(pool);
        return results;
    }

    // ========== CSV ==========
    function csvEscape(v) {
        if (v === null || v === undefined) return '';
        var s = String(v);
        if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }
    function buildColumns() {
        var codes = Object.keys(langMap).map(function(id) { return langMap[id]; });
        if (!codes.length) codes = ['pl'];
        var cols = [];
        function add(h, k) { cols.push({ h: h, k: k }); }
        function addMulti(h, base) { codes.forEach(function(c) { cols.push({ h: h + '_' + c, k: base + '_' + c }); }); }

        add('ID', 'id');
        addMulti('Nazwa', 'nazwa');
        addMulti('URL', 'url');
        add('Wyswietlany', 'wyswietlany');
        add('Zgodny ze zdjeciem', 'zgodny_ze_zdjeciem');
        add('EAN', 'ean');
        add('Kod dostawcy', 'kod_dostawcy');
        add('Producent', 'producent');
        add('Dostawca', 'dostawca');
        addMulti('SEO Tytul', 'seo_tytul');
        addMulti('SEO Opis', 'seo_opis');
        addMulti('SEO Slowa kluczowe', 'seo_slowa_kluczowe');
        add('Stan magazynowy', 'stan_magazynowy');
        add('Rezerwacja', 'rezerwacja');
        add('Dostepnosc ID', 'dostepnosc_id');
        add('Kategorie', 'kategorie');
        add('Kategoria ID', 'kategoria_id');
        add('Grupa cenowa ID', 'grupa_cenowa_id');
        add('Stawka VAT', 'stawka_vat');
        add('Waluta sprzedazy ID', 'waluta_sprzedazy_id');
        add('Waluta zakupu ID', 'waluta_zakupu_id');
        add('Cena zakupu netto', 'cena_zakupu_netto');
        add('Cena zakupu brutto', 'cena_zakupu_brutto');
        add('Cena sprzedazy netto', 'cena_sprzedazy_netto');
        add('Cena sprzedazy brutto', 'cena_sprzedazy_brutto');
        add('Cena promocyjna netto', 'cena_promocyjna_netto');
        add('Cena promocyjna brutto', 'cena_promocyjna_brutto');
        add('Data rozpoczecia promocji', 'data_rozpoczecia_promocji');
        add('Data zakonczenia promocji', 'data_zakonczenia_promocji');
        add('Waga (kg)', 'waga_kg');
        add('Waga (g)', 'waga_g');
        add('Szerokosc', 'szerokosc');
        add('Wysokosc', 'wysokosc');
        add('Glebokosc', 'glebokosc');
        add('Jednostka miary ID', 'jednostka_miary_id');
        add('Ilosc w opakowaniu', 'ilosc_w_opakowaniu');
        addMulti('Opis krotki', 'opis_krotki');
        addMulti('Opis dlugi (HTML)', 'opis_dlugi_html');
        addMulti('Opis dodatkowe info (HTML)', 'opis_dodatkowe_info_html');
        addMulti('Opis rozszerzony (HTML)', 'opis_rozszerzony_html');
        add('Galeria', 'galeria');
        add('Ikona', 'ikona');
        add('Akcesoria', 'akcesoria');
        add('Produkty podobne', 'produkty_podobne');
        add('Sprzedaz krzyzowa', 'sprzedaz_krzyzowa');
        add('Dane techniczne', 'dane_techniczne');
        add('Data dodania', 'data_dodania');
        return cols;
    }
    function buildCSV(products) {
        var cols = buildColumns();
        var lines = [cols.map(function(c) { return c.h; }).join(';')];
        products.forEach(function(p) {
            if (!p) return;
            var row = cols.map(function(c) { return csvEscape(p[c.k]); }).join(';');
            lines.push(row);
        });
        return '﻿' + lines.join('\n');
    }
    function downloadCSV(csv, suffix) {
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = 'produkty_szczegoly_' + new Date().toISOString().slice(0, 10) + (suffix || '') + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    // ========== GLOWNA AKCJA ==========
    async function run() {
        if (isRunning) return;
        isRunning = true;
        shouldStop = false;
        logMessages = [];
        okCount = 0; errCount = 0;
        document.getElementById('exp4-start').classList.add('hidden');
        document.getElementById('exp4-stop').classList.remove('hidden');
        setProgress(0, 0);

        try {
            var mode = document.getElementById('exp4-mode').value;
            var full = document.getElementById('exp4-full').checked;
            var concurrency = Math.max(1, Math.min(50, parseInt(document.getElementById('exp4-conc').value) || 20));

            log('info', '=== START v4.0 (mode=' + mode + ', ' + (full ? 'pelny' : 'szybki') + ', parallel=' + concurrency + ') ===');

            await openDb();

            // Zbior bulk
            setStatus('Pobieram liste wszystkich produktow...');
            var rows = await fetchBulkList();

            // Filtrowanie
            var filtered = rows;
            if (mode === 'range') {
                var from = parseInt(document.getElementById('exp4-from').value);
                var to = parseInt(document.getElementById('exp4-to').value);
                filtered = rows.filter(function(r) { var n = parseInt(r.idproduct); return n >= from && n <= to; });
            } else if (mode === 'ids') {
                var raw = document.getElementById('exp4-ids').value;
                var whitelist = {};
                raw.split(/[,\s]+/).forEach(function(s) { if (/^\d+$/.test(s)) whitelist[s] = 1; });
                filtered = rows.filter(function(r) { return whitelist[r.idproduct]; });
            }
            log('info', 'Po filtrze: ' + filtered.length + '/' + rows.length + ' produktow');

            if (!filtered.length) { setStatus('Brak produktow do eksportu'); return; }

            var products;
            if (!full) {
                // TRYB SZYBKI
                if (Object.keys(langMap).length === 0) langMap['1'] = 'pl';
                setStatus('Tryb szybki: mapuje ' + filtered.length + '...');
                products = filtered.map(function(row) { return mapProduct(row, null); });
                setProgress(products.length, filtered.length);
                log('ok', 'Tryb szybki gotowy: ' + products.length + ' produktow');
            } else {
                // TRYB PELNY
                setStatus('Inicjalizuje sesje (jezyki, VAT, xajax)...');
                await initSession(filtered[0].idproduct);
                setStatus('Buduje mape kategorii...');
                await buildCategoryMap();

                await dbClear();
                setStatus('Pobieram szczegoly (parallel x' + concurrency + ')...');
                var t0 = performance.now();
                var details = await runPool(filtered, async function(row) {
                    if (shouldStop) return null;
                    var d = await fetchDetail(row.idproduct);
                    var rec = mapProduct(row, d);
                    if (d.error) { errCount++; log('warn', '[' + row.idproduct + '] ' + d.error); }
                    else if (d.missing) { errCount++; log('warn', '[' + row.idproduct + '] brak (przekierowanie)'); }
                    else okCount++;
                    await dbPut(rec);
                    return rec;
                }, concurrency, function(d, t) {
                    setProgress(d, t);
                    setStatus('Detale: ' + d + '/' + t + '  (ok=' + okCount + ' err=' + errCount + ')');
                });
                var t1 = performance.now();
                log('ok', 'Detale zakonczone w ' + Math.round((t1 - t0) / 1000) + 's');
                products = details.filter(Boolean);
            }

            setStatus('Generuje CSV (' + products.length + ' wierszy)...');
            var csv = buildCSV(products);
            downloadCSV(csv, full ? '_pelny' : '_szybki');
            log('ok', 'CSV zapisany. Konczylem: ok=' + okCount + ' err=' + errCount);
            setStatus('Gotowe. Zapisano ' + products.length + ' rekordow.');
        } catch (e) {
            log('error', 'Blad glowny: ' + e.message);
            console.error(e);
            setStatus('Blad: ' + e.message);
        } finally {
            isRunning = false;
            document.getElementById('exp4-start').classList.remove('hidden');
            document.getElementById('exp4-stop').classList.add('hidden');
        }
    }

    // ========== UI ==========
    function injectUI() {
        if (document.getElementById('exp4-panel')) return;

        var style = document.createElement('style');
        style.textContent = [
            '#exp4-panel { position:fixed; top:70px; right:20px; width:340px; max-width:380px; background:#2c3e50; color:white; padding:12px; border-radius:8px; z-index:99999; font-family:system-ui,-apple-system,sans-serif; font-size:11px; box-shadow:0 4px 20px rgba(0,0,0,.4); word-break:break-word; }',
            '#exp4-panel h3 { margin:0 0 8px; font-size:13px; }',
            '#exp4-panel label { display:block; margin:6px 0 2px; font-size:10px; color:#bdc3c7; }',
            '#exp4-panel input, #exp4-panel select { width:100%; padding:4px 6px; border-radius:4px; border:1px solid #34495e; background:#34495e; color:white; box-sizing:border-box; font-size:11px; }',
            '#exp4-panel button { padding:6px 10px; border:0; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px; margin-top:6px; }',
            '#exp4-start { background:#27ae60; color:white; width:100%; }',
            '#exp4-stop { background:#c0392b; color:white; width:100%; }',
            '#exp4-toggle-log { background:#34495e; color:white; width:100%; }',
            '#exp4-panel .hidden { display:none !important; }',
            '#exp4-panel .progress-outer { background:#34495e; border-radius:3px; overflow:hidden; margin:6px 0 2px; height:8px; }',
            '#exp4-progress { background:#3498db; height:100%; width:0%; transition:width .2s; }',
            '#exp4-status { font-size:11px; margin:6px 0; color:#ecf0f1; }',
            '#exp4-log { max-height:260px; overflow-y:auto; background:#1a252f; padding:6px; border-radius:4px; margin-top:6px; font-family:Consolas,monospace; }',
            '#exp4-panel .row { display:flex; gap:6px; }',
            '#exp4-panel .row > div { flex:1; }',
            '#exp4-panel .chk-label { padding-top:16px; display:flex; align-items:center; gap:4px; }',
            '#exp4-panel .chk-label input { width:auto; }'
        ].join('\n');
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'exp4-panel';
        panel.innerHTML = [
            '<h3>ShopWay Detail Exporter v4.0</h3>',
            '<label>Tryb</label>',
            '<select id="exp4-mode">',
            '  <option value="all">Wszystkie produkty</option>',
            '  <option value="range">Zakres ID</option>',
            '  <option value="ids">Lista ID</option>',
            '</select>',
            '<div id="exp4-range-box" class="row hidden">',
            '  <div><label>Od</label><input id="exp4-from" type="number" value="1"></div>',
            '  <div><label>Do</label><input id="exp4-to" type="number" value="100"></div>',
            '</div>',
            '<div id="exp4-ids-box" class="hidden">',
            '  <label>Lista ID (spacje/przecinki)</label>',
            '  <input id="exp4-ids" type="text" placeholder="123 456 789">',
            '</div>',
            '<div class="row">',
            '  <div><label>Rownolegle</label><input id="exp4-conc" type="number" value="20" min="1" max="50"></div>',
            '  <div><label class="chk-label"><input id="exp4-full" type="checkbox" checked>Pelny</label></div>',
            '</div>',
            '<div class="progress-outer"><div id="exp4-progress"></div></div>',
            '<div id="exp4-progress-label" style="font-size:10px;color:#95a5a6;text-align:right;">0 / 0</div>',
            '<div id="exp4-status">Gotowy</div>',
            '<button id="exp4-start">Rozpocznij eksport</button>',
            '<button id="exp4-stop" class="hidden">Zatrzymaj</button>',
            '<button id="exp4-toggle-log">Pokaz / ukryj log</button>',
            '<div id="exp4-log" class="hidden"></div>'
        ].join('');
        document.body.appendChild(panel);

        document.getElementById('exp4-mode').addEventListener('change', function(e) {
            document.getElementById('exp4-range-box').classList.toggle('hidden', e.target.value !== 'range');
            document.getElementById('exp4-ids-box').classList.toggle('hidden', e.target.value !== 'ids');
        });
        document.getElementById('exp4-start').addEventListener('click', run);
        document.getElementById('exp4-stop').addEventListener('click', function() {
            shouldStop = true;
            log('warn', 'Zatrzymywanie...');
        });
        document.getElementById('exp4-toggle-log').addEventListener('click', function() {
            var l = document.getElementById('exp4-log');
            l.classList.toggle('hidden');
            logDiv = l.classList.contains('hidden') ? null : l;
            renderLog();
        });
        logDiv = null;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }
})();
