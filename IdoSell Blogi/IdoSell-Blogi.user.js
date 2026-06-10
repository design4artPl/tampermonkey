// ==UserScript==
// @name         IdoSell Blogi — rozszerzona lista wpisów
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      0.5.0
// @description  Lista wpisów blog: 4 dodatkowe kolumny + multi-select + eksport/import (JSON/CSV/XML) wszystkich ustawień wpisu z podziałem na języki. UPDATE/CREATE, D3-listy, auto-backup, import ikony wpisu z URL (fetch + multipart upload).
// @author       design4artPl
// @match        https://*.iai-shop.com/panel/entries.php?*mode=blog*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (!/[?&]action=items(\b|&|$)/.test(location.search)) return;
    if (!/[?&]mode=blog(\b|&|$)/.test(location.search)) return;

    const CONCURRENCY = 5;
    const CACHE_TTL = 5 * 60 * 1000;
    const CACHE_PREFIX = 'blogi:entry:';
    const LAST_EDITED_KEY = 'blogi:lastEditedId';
    const SELECTED_KEY = 'blogi:selected';
    const BOOT_INTERVAL = 200;
    const BOOT_MAX_TRIES = 50;

    const COLUMNS = [
        { key: 'products',   label: 'Towary', tooltip: 'Liczba towarów powiązanych z wpisem',  width: '60px' },
        { key: 'customLink', label: 'URL',    tooltip: 'Czy wpis ma zdefiniowany własny URL',  width: '50px' },
        { key: 'customMeta', label: 'Meta',   tooltip: 'Czy wpis ma indywidualne metatagi',    width: '50px' },
        { key: 'hasImg',     label: 'Img',    tooltip: 'Czy treść wpisu zawiera obrazki',      width: '50px' }
    ];

    // Mapowania backend ↔ polski etykiet (zgodne z TEMPLATE.md v3)
    const M = {
        visible: {
            toLabel: v => v === 't' ? 'widoczny' : 'ukryty',
            toBackend: l => l === 'widoczny' ? 't' : 'n'
        },
        linkType: {
            toLabel: v => ({ self: 'link do podstrony', provided: 'link do zewnetrznego url', static: 'element statyczny' }[v] || 'link do podstrony'),
            toBackend: l => ({ 'link do podstrony': 'self', 'link do zewnetrznego url': 'provided', 'element statyczny': 'static' }[l] || 'self')
        },
        yn: {
            toLabel: v => v === 'y' ? 'tak' : 'nie',
            toBackend: l => l === 'tak' ? 'y' : 'n'
        },
        tn: {
            toLabel: v => v === 't' ? 'tak' : 'nie',
            toBackend: l => l === 'tak' ? 't' : 'n'
        },
        metaTryb: {
            toLabel: v => v === 'y' ? 'ręczne' : 'automatyczne',
            toBackend: l => l === 'ręczne' ? 'y' : 'n'
        },
        urlTryb: {
            toLabel: v => v === 'y' ? 'własny' : 'automatyczny',
            toBackend: l => l === 'własny' ? 'y' : 'n'
        }
    };

    const SCHEMA_VERSION = '1.0';

    const style = document.createElement('style');
    style.textContent = [
        'table.entries th.blogi-col,table.entries td.blogi-col{text-align:center;white-space:nowrap}',
        'table.entries .blogi-cell.loading{color:#999}',
        'table.entries .blogi-cell.error{color:#c00;cursor:help}',
        'table.entries .blogi-yes{color:#2a8f2a;font-weight:bold}',
        'table.entries .blogi-no{color:#999}',
        'table.entries .blogi-num{font-weight:bold}',
        'table.entries th.blogi-select-col,table.entries td.blogi-select-col{width:32px;text-align:center;padding:2px}',
        'table.entries tr.blogi-selected td{background:#fff8d6 !important}',
        '.blogi-toolbar{display:inline-block;position:relative;margin:0 8px}',
        '.blogi-toolbar .blogi-btn{background:#5cb85c;color:#fff;border:0;padding:5px 12px;border-radius:3px;cursor:pointer;font-size:12px}',
        '.blogi-toolbar .blogi-btn:hover{background:#4a934a}',
        '.blogi-toolbar .blogi-btn-import{background:#337ab7}',
        '.blogi-toolbar .blogi-btn-import:hover{background:#286090}',
        '.blogi-menu{display:none;position:absolute;top:100%;left:0;margin-top:2px;background:#fff;border:1px solid #ccc;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:1000;min-width:240px}',
        '.blogi-menu.open{display:block}',
        '.blogi-menu-group{padding:4px 10px;font-weight:bold;font-size:11px;color:#666;background:#f5f5f5;border-bottom:1px solid #e5e5e5;text-transform:uppercase}',
        '.blogi-menu-item{display:block;padding:6px 14px;cursor:pointer;color:#333;text-decoration:none;font-size:12px}',
        '.blogi-menu-item:hover{background:#eef}',
        '.blogi-menu-item.blogi-disabled{color:#bbb;cursor:not-allowed;pointer-events:none}',
        '.blogi-selection-info{display:inline-block;margin:0 8px;padding:4px 10px;background:#fffbe6;border:1px solid #f3e09a;border-radius:3px;font-size:12px;color:#7a5b00}',
        '.blogi-selection-info button{margin-left:8px;padding:2px 8px;font-size:11px;background:#fff;border:1px solid #ccc;border-radius:2px;cursor:pointer;color:#333}',
        '.blogi-selection-info button:hover{background:#f0f0f0}',
        '.blogi-modal-mask{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:9998}',
        '.blogi-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,.3);padding:20px;min-width:380px;z-index:9999;font-family:Arial,sans-serif}',
        '.blogi-modal h3{margin:0 0 12px 0;font-size:16px}',
        '.blogi-modal .blogi-progress-bar{background:#eee;height:14px;border-radius:3px;overflow:hidden;margin:10px 0}',
        '.blogi-modal .blogi-progress-fill{background:#5cb85c;height:100%;width:0;transition:width .2s}',
        '.blogi-modal .blogi-progress-text{font-size:12px;color:#666;margin-bottom:6px}',
        '.blogi-modal .blogi-status{font-size:11px;color:#999;margin-top:8px;max-height:60px;overflow:auto}',
        '.blogi-modal-actions{margin-top:14px;text-align:right}',
        '.blogi-modal-actions button{padding:6px 14px;margin-left:6px;cursor:pointer;border:1px solid #ccc;background:#fff;border-radius:3px;font-size:12px}',
        '.blogi-modal-actions button.primary{background:#5cb85c;color:#fff;border-color:#5cb85c}'
    ].join('');
    document.head.appendChild(style);

    function cacheGet(id) {
        try {
            const raw = sessionStorage.getItem(CACHE_PREFIX + id);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (Date.now() - obj.t > CACHE_TTL) return null;
            return obj.d;
        } catch (e) {
            return null;
        }
    }

    function cacheSet(id, data) {
        try {
            sessionStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ t: Date.now(), d: data }));
        } catch (e) { /* quota */ }
    }

    function cacheInvalidate(id) {
        try { sessionStorage.removeItem(CACHE_PREFIX + id); } catch (e) {}
    }

    function loadSelected() {
        try { return new Set(JSON.parse(sessionStorage.getItem(SELECTED_KEY) || '[]')); }
        catch (e) { return new Set(); }
    }

    function saveSelected() {
        try { sessionStorage.setItem(SELECTED_KEY, JSON.stringify([...selected])); } catch (e) {}
    }

    const selected = loadSelected();

    function parseEntryDoc(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const products = doc.querySelectorAll('#related-products input[id^="related-product-"]').length;

        const linkTypeRadio = doc.querySelector('input[name="linkType"]:checked');
        const linkType = linkTypeRadio ? linkTypeRadio.value : 'self';
        const aliasCustom = doc.querySelectorAll(
            'input[name^="url_blog_radio"][value="y"]:checked, input[name^="url_news_radio"][value="y"]:checked'
        ).length > 0;
        const customLink = (linkType !== 'self') || aliasCustom;

        const customMeta = doc.querySelectorAll('input[name^="meta["][value="y"]:checked').length > 0;

        let hasImg = false;
        const langContainers = doc.querySelectorAll('input[id^="tableRowTextEditTabs_container_"]');
        for (const input of langContainers) {
            if (/<img\b/i.test(input.value || '')) { hasImg = true; break; }
        }

        return { products, customLink, customMeta, hasImg };
    }

    // Parser produkuje schema zgodny z TEMPLATE.md v3 (klucze polskie, D3, ikona URL).
    function parseFullEntry(html, id) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const $val = (sel) => { const e = doc.querySelector(sel); return e ? (e.value || '') : ''; };
        const $checked = (name) => { const e = doc.querySelector('input[name="' + name + '"]:checked'); return e ? e.value : null; };

        const ifimg = $checked('ifimg') === 't';
        let ikonaWpisu = null;
        if (ifimg) {
            const imgEl = doc.querySelector('#tr_obrazek img');
            if (imgEl) ikonaWpisu = imgEl.getAttribute('src') || null;
        }

        const entry = {
            id: String(id || ''),
            widocznosc: M.visible.toLabel($checked('visible')),
            dataWlaczenia: $val('input[name="show_date_ymd"]'),
            dataWylaczenia: $val('input[name="hide_date_ymd"]'),
            typWpisu: M.linkType.toLabel($checked('linkType')),
            linkZewnetrzny: $val('input[name="link"]'),
            kategoriaBloga: {
                tryb: 'replace',
                wartosci: Array.from(doc.querySelectorAll('input[name="categories[]"]:checked')).map(i => i.value)
            },
            strefyAktualnosci: {
                tryb: 'replace',
                wartosci: Array.from(doc.querySelectorAll('input[name="zones[]"]:checked')).map(i => i.value)
            },
            dataWpisu: $val('input[name="created_at_ymd"]'),
            ikonaWpisu,
            indeksowanie: M.yn.toLabel($checked('sitemap_index')),
            wyszukiwarka: M.yn.toLabel($checked('search_index')),
            towary: {
                tryb: 'replace',
                wartosci: Array.from(doc.querySelectorAll('#related-products input[id^="related-product-"]')).map(i => ({
                    typ: 'productId',
                    wartosc: i.value
                }))
            },
            jezyki: {}
        };

        const langs = new Set();
        doc.querySelectorAll('input[name^="title["]').forEach(i => {
            const m = i.name.match(/^title\[(.+?)\]$/);
            if (m) langs.add(m[1]);
        });

        for (const lang of langs) {
            entry.jezyki[lang] = {
                tytul: $val('input[name="title[' + lang + ']"]'),
                skroconyOpis: $val('textarea[name="description[' + lang + ']"]'),
                pelnaTresc: $val('input[name="long_description[' + lang + ']"]'),
                tlumaczenie: M.yn.toLabel($checked('translation_flag_radio[' + lang + ']')),
                meta: {
                    tryb: M.metaTryb.toLabel($checked('meta[' + lang + ']')),
                    tytul: $val('input[name="meta_title[' + lang + ']"]'),
                    opis: $val('input[name="meta_description[' + lang + ']"]'),
                    slowaKluczowe: $val('input[name="meta_keyword[' + lang + ']"]')
                },
                urlBloga: {
                    tryb: M.urlTryb.toLabel($checked('url_blog_radio[' + lang + ']')),
                    adres: $val('input[name="blog_url[' + lang + ']"]')
                },
                kanonicznyBloga: {
                    tryb: M.urlTryb.toLabel($checked('canonical_blog_radio[' + lang + ']')),
                    adres: $val('input[name="canonical_blog[' + lang + ']"]')
                },
                urlAktualnosci: {
                    tryb: M.urlTryb.toLabel($checked('url_news_radio[' + lang + ']')),
                    adres: $val('input[name="news_url[' + lang + ']"]')
                },
                kanonicznyAktualnosci: {
                    tryb: M.urlTryb.toLabel($checked('canonical_news_radio[' + lang + ']')),
                    adres: $val('input[name="canonical_news[' + lang + ']"]')
                }
            };
        }

        return entry;
    }

    // 4 flagi pochodne dla kolumn listy — wyciągane z pełnego rekordu.
    function deriveColumnFlags(full) {
        const langs = Object.values(full.jezyki || {});
        return {
            products: (full.towary && full.towary.wartosci || []).length,
            customLink: full.typWpisu !== 'link do podstrony' ||
                langs.some(l => l.urlBloga.tryb === 'własny' || l.urlAktualnosci.tryb === 'własny'),
            customMeta: langs.some(l => l.meta.tryb === 'ręczne'),
            hasImg: langs.some(l => /<img\b/i.test(l.pelnaTresc || ''))
        };
    }

    async function fetchEntryHtml(id, signal) {
        const shop = new URLSearchParams(location.search).get('shop') || '1';
        const url = location.origin + '/panel/entries.php?action=edit&mode=blog&shop=' + shop + '&id=' + id;
        const r = await fetch(url, { credentials: 'include', signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.text();
    }

    async function fetchEntryDetails(id, signal) {
        const cached = cacheGet(id);
        if (cached) return cached;
        const html = await fetchEntryHtml(id, signal);
        const data = parseEntryDoc(html);
        cacheSet(id, data);
        return data;
    }

    async function fetchFullEntry(id, signal) {
        const html = await fetchEntryHtml(id, signal);
        const full = parseFullEntry(html, id);
        cacheSet(id, deriveColumnFlags(full));
        return full;
    }

    let activeController = null;

    function runQueue(tasks, concurrency) {
        if (activeController) activeController.abort();
        activeController = new AbortController();
        const signal = activeController.signal;
        let i = 0;
        const workers = Array(Math.min(concurrency, tasks.length)).fill(0).map(async () => {
            while (i < tasks.length && !signal.aborted) {
                const idx = i++;
                try { await tasks[idx](signal); } catch (e) { /* handled inside */ }
            }
        });
        return Promise.all(workers);
    }

    function rebuildHeader() {
        const headRow = document.querySelector('table.entries thead tr');
        if (!headRow) return;

        if (!headRow.querySelector('th.blogi-select-col')) {
            const selTh = document.createElement('th');
            selTh.className = 'title blogi-select-col';
            selTh.title = 'Zaznacz/odznacz wszystkie na bieżącej stronie';
            selTh.innerHTML = '<input type="checkbox" class="blogi-select-all">';
            selTh.querySelector('input').addEventListener('click', e => {
                const check = e.target.checked;
                getCurrentPageIds().forEach(id => check ? selected.add(id) : selected.delete(id));
                saveSelected();
                applySelectedToRows();
                updateSelectionBar();
            });
            headRow.insertBefore(selTh, headRow.firstElementChild);
        }

        if (!headRow.querySelector('th.blogi-col')) {
            const operationTh = Array.from(headRow.querySelectorAll('th'))
                .find(th => th.getAttribute('data-name') === 'operation') || headRow.lastElementChild;
            for (const col of COLUMNS) {
                const th = document.createElement('th');
                th.className = 'title blogi-col';
                th.setAttribute('data-name', 'blogi-' + col.key);
                th.title = col.tooltip;
                th.style.width = col.width;
                th.innerHTML = '<table style="margin:0 auto"><tbody><tr><td>' + col.label + '</td></tr></tbody></table>';
                headRow.insertBefore(th, operationTh);
            }
        }
    }

    function rebuildRows() {
        const rows = document.querySelectorAll('table.entries tr[id^="tr_"]');
        rows.forEach(tr => {
            const editLink = tr.querySelector('a[href*="action=edit"]');
            if (!editLink) return;
            const m = editLink.getAttribute('href').match(/[?&]id=(\d+)/);
            if (!m) return;
            const id = m[1];
            tr.dataset.blogiId = id;

            if (!tr.querySelector('td.blogi-select-col')) {
                const td = document.createElement('td');
                td.className = 'row0 blogi-select-col';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'blogi-select-row';
                cb.checked = selected.has(id);
                cb.dataset.blogiId = id;
                cb.addEventListener('click', e => {
                    e.stopPropagation();
                    if (cb.checked) selected.add(id);
                    else selected.delete(id);
                    saveSelected();
                    updateRowHighlight(tr);
                    updateSelectionBar();
                    updateHeaderCheckbox();
                });
                td.appendChild(cb);
                tr.insertBefore(td, tr.firstElementChild);
                updateRowHighlight(tr);
            }

            if (!tr.querySelector('td.blogi-col')) {
                const lastTd = tr.lastElementChild;
                for (const col of COLUMNS) {
                    const td = document.createElement('td');
                    td.className = 'row0 blogi-col blogi-col-' + col.key;
                    td.innerHTML = '<span class="blogi-cell loading" data-col="' + col.key + '">…</span>';
                    tr.insertBefore(td, lastTd);
                }
            }
        });
    }

    function updateRowHighlight(tr) {
        const cb = tr.querySelector('input.blogi-select-row');
        if (cb && cb.checked) tr.classList.add('blogi-selected');
        else tr.classList.remove('blogi-selected');
    }

    function applySelectedToRows() {
        document.querySelectorAll('input.blogi-select-row').forEach(cb => {
            cb.checked = selected.has(cb.dataset.blogiId);
            const tr = cb.closest('tr');
            if (tr) updateRowHighlight(tr);
        });
    }

    function updateHeaderCheckbox() {
        const all = document.querySelectorAll('input.blogi-select-row');
        const headerCb = document.querySelector('input.blogi-select-all');
        if (!headerCb) return;
        if (all.length === 0) { headerCb.checked = false; headerCb.indeterminate = false; return; }
        const checked = Array.from(all).filter(c => c.checked).length;
        if (checked === 0) { headerCb.checked = false; headerCb.indeterminate = false; }
        else if (checked === all.length) { headerCb.checked = true; headerCb.indeterminate = false; }
        else { headerCb.checked = false; headerCb.indeterminate = true; }
    }

    function updateSelectionBar() {
        const bar = document.querySelector('.blogi-selection-info');
        if (bar) {
            if (selected.size === 0) bar.style.display = 'none';
            else {
                bar.style.display = '';
                bar.querySelector('.blogi-selection-count').textContent = selected.size;
            }
        }
        document.querySelectorAll('.blogi-menu-item[data-scope="selected"]').forEach(it => {
            it.classList.toggle('blogi-disabled', selected.size === 0);
        });
    }

    function renderCellValue(col, data) {
        if (col === 'products') {
            const n = data.products;
            return '<span class="blogi-cell ' + (n > 0 ? 'blogi-num' : 'blogi-no') + '">' + n + '</span>';
        }
        const yes = !!data[col];
        return '<span class="blogi-cell ' + (yes ? 'blogi-yes' : 'blogi-no') + '">' + (yes ? '✓' : '–') + '</span>';
    }

    function updateRowCells(id, data) {
        const tr = document.querySelector('tr[data-blogi-id="' + id + '"]');
        if (!tr) return;
        for (const col of COLUMNS) {
            const td = tr.querySelector('td.blogi-col-' + col.key);
            if (td) td.innerHTML = renderCellValue(col.key, data);
        }
    }

    function markRowError(id, err) {
        const tr = document.querySelector('tr[data-blogi-id="' + id + '"]');
        if (!tr) return;
        tr.querySelectorAll('span.blogi-cell').forEach(s => {
            s.className = 'blogi-cell error';
            s.title = 'Błąd pobierania: ' + err;
            s.textContent = '✗';
        });
    }

    function enqueueFetches() {
        const ids = Array.from(document.querySelectorAll('table.entries tr[data-blogi-id]'))
            .map(tr => tr.dataset.blogiId);
        const unique = [...new Set(ids)];
        const tasks = unique.map(id => async (signal) => {
            try {
                const data = await fetchEntryDetails(id, signal);
                if (!signal.aborted) updateRowCells(id, data);
            } catch (e) {
                if (e.name !== 'AbortError') markRowError(id, e.message);
            }
        });
        runQueue(tasks, CONCURRENCY);
    }

    function escapeXml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function cdata(s) {
        return '<![CDATA[' + String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
    }

    // XML w nowym schemacie (TEMPLATE.md v3): <blogExport version exportedAt shop>, <wpis>, D3 z atrybutem tryb, pelnaTresc w CDATA.
    function toXml(envelope) {
        const I = (n) => '  '.repeat(n);
        const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
        lines.push('<blogExport version="' + escapeXml(envelope.version) +
            '" exportedAt="' + escapeXml(envelope.exportedAt) +
            '" shop="' + escapeXml(envelope.shop) + '">');
        for (const e of envelope.entries) {
            lines.push(I(1) + '<wpis>');
            lines.push(I(2) + '<id>' + escapeXml(e.id) + '</id>');
            lines.push(I(2) + '<widocznosc>' + escapeXml(e.widocznosc) + '</widocznosc>');
            lines.push(I(2) + '<dataWlaczenia>' + escapeXml(e.dataWlaczenia) + '</dataWlaczenia>');
            lines.push(I(2) + '<dataWylaczenia>' + escapeXml(e.dataWylaczenia) + '</dataWylaczenia>');
            lines.push(I(2) + '<typWpisu>' + escapeXml(e.typWpisu) + '</typWpisu>');
            lines.push(I(2) + '<linkZewnetrzny>' + escapeXml(e.linkZewnetrzny) + '</linkZewnetrzny>');
            // D3-listy
            const writeList = (name, obj, itemName) => {
                obj = obj || { tryb: 'replace', wartosci: [] };
                if (!obj.wartosci || obj.wartosci.length === 0) {
                    lines.push(I(2) + '<' + name + ' tryb="' + escapeXml(obj.tryb || 'replace') + '"/>');
                } else {
                    lines.push(I(2) + '<' + name + ' tryb="' + escapeXml(obj.tryb || 'replace') + '">');
                    for (const w of obj.wartosci) {
                        if (itemName === 'towar') {
                            lines.push(I(3) + '<towar typ="' + escapeXml(w.typ || 'productId') + '" wartosc="' + escapeXml(w.wartosc) + '"/>');
                        } else {
                            lines.push(I(3) + '<' + itemName + '>' + escapeXml(w) + '</' + itemName + '>');
                        }
                    }
                    lines.push(I(2) + '</' + name + '>');
                }
            };
            writeList('kategoriaBloga', e.kategoriaBloga, 'wartosc');
            writeList('strefyAktualnosci', e.strefyAktualnosci, 'wartosc');
            lines.push(I(2) + '<dataWpisu>' + escapeXml(e.dataWpisu) + '</dataWpisu>');
            lines.push(I(2) + '<ikonaWpisu>' + escapeXml(e.ikonaWpisu == null ? '' : e.ikonaWpisu) + '</ikonaWpisu>');
            lines.push(I(2) + '<indeksowanie>' + escapeXml(e.indeksowanie) + '</indeksowanie>');
            lines.push(I(2) + '<wyszukiwarka>' + escapeXml(e.wyszukiwarka) + '</wyszukiwarka>');
            writeList('towary', e.towary, 'towar');
            // Języki
            lines.push(I(2) + '<jezyki>');
            for (const lang of Object.keys(e.jezyki || {})) {
                const l = e.jezyki[lang];
                lines.push(I(3) + '<jezyk kod="' + escapeXml(lang) + '">');
                lines.push(I(4) + '<tytul>' + escapeXml(l.tytul) + '</tytul>');
                lines.push(I(4) + '<skroconyOpis>' + escapeXml(l.skroconyOpis) + '</skroconyOpis>');
                lines.push(I(4) + '<pelnaTresc>' + cdata(l.pelnaTresc) + '</pelnaTresc>');
                lines.push(I(4) + '<tlumaczenie>' + escapeXml(l.tlumaczenie) + '</tlumaczenie>');
                const m = l.meta || {};
                lines.push(I(4) + '<meta tryb="' + escapeXml(m.tryb || 'automatyczne') + '">');
                lines.push(I(5) + '<tytul>' + escapeXml(m.tytul) + '</tytul>');
                lines.push(I(5) + '<opis>' + escapeXml(m.opis) + '</opis>');
                lines.push(I(5) + '<slowaKluczowe>' + escapeXml(m.slowaKluczowe) + '</slowaKluczowe>');
                lines.push(I(4) + '</meta>');
                const writeUrlGroup = (name, g) => {
                    g = g || { tryb: 'automatyczny', adres: '' };
                    lines.push(I(4) + '<' + name + ' tryb="' + escapeXml(g.tryb) + '"><adres>' + escapeXml(g.adres) + '</adres></' + name + '>');
                };
                writeUrlGroup('urlBloga', l.urlBloga);
                writeUrlGroup('kanonicznyBloga', l.kanonicznyBloga);
                writeUrlGroup('urlAktualnosci', l.urlAktualnosci);
                writeUrlGroup('kanonicznyAktualnosci', l.kanonicznyAktualnosci);
                lines.push(I(3) + '</jezyk>');
            }
            lines.push(I(2) + '</jezyki>');
            lines.push(I(1) + '</wpis>');
        }
        lines.push('</blogExport>');
        return lines.join('\n');
    }

    function csvEscape(s) {
        if (s == null) return '';
        const str = String(s);
        if (/[;"\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
        return str;
    }

    // CSV w nowym schemacie (TEMPLATE.md v3). D3-listy jako 2 kolumny per: <key>_tryb + <key>_wartosci.
    function towaryToCsv(arr) {
        return (arr || []).map(t => (t.typ || 'productId') + ':' + (t.wartosc || '')).join('|');
    }
    function towaryFromCsv(s) {
        return String(s || '').split('|').filter(Boolean).map(part => {
            const i = part.indexOf(':');
            if (i < 0) return { typ: 'productId', wartosc: part };
            return { typ: part.slice(0, i), wartosc: part.slice(i + 1) };
        });
    }
    function toCsv(entries) {
        const allLangs = new Set();
        entries.forEach(e => Object.keys(e.jezyki || {}).forEach(l => allLangs.add(l)));
        const langs = [...allLangs].sort();

        const baseCols = [
            'id', 'widocznosc', 'dataWlaczenia', 'dataWylaczenia',
            'typWpisu', 'linkZewnetrzny',
            'kategoriaBloga_tryb', 'kategoriaBloga_wartosci',
            'strefyAktualnosci_tryb', 'strefyAktualnosci_wartosci',
            'dataWpisu', 'ikonaWpisu', 'indeksowanie', 'wyszukiwarka',
            'towary_tryb', 'towary_wartosci'
        ];
        const langCols = [
            'tytul', 'skroconyOpis', 'pelnaTresc', 'tlumaczenie',
            'meta_tryb', 'meta_tytul', 'meta_opis', 'meta_slowaKluczowe',
            'urlBloga_tryb', 'urlBloga_adres',
            'kanonicznyBloga_tryb', 'kanonicznyBloga_adres',
            'urlAktualnosci_tryb', 'urlAktualnosci_adres',
            'kanonicznyAktualnosci_tryb', 'kanonicznyAktualnosci_adres'
        ];

        const headers = [...baseCols];
        for (const lang of langs) for (const c of langCols) headers.push(c + '_' + lang);

        const lines = [headers.map(csvEscape).join(';')];
        for (const e of entries) {
            const kb = e.kategoriaBloga || { tryb: '', wartosci: [] };
            const sa = e.strefyAktualnosci || { tryb: '', wartosci: [] };
            const to = e.towary || { tryb: '', wartosci: [] };
            const row = [
                e.id, e.widocznosc, e.dataWlaczenia, e.dataWylaczenia,
                e.typWpisu, e.linkZewnetrzny,
                kb.tryb, (kb.wartosci || []).join(','),
                sa.tryb, (sa.wartosci || []).join(','),
                e.dataWpisu, e.ikonaWpisu == null ? '' : e.ikonaWpisu, e.indeksowanie, e.wyszukiwarka,
                to.tryb, towaryToCsv(to.wartosci)
            ];
            for (const lang of langs) {
                const l = (e.jezyki || {})[lang] || {};
                const m = l.meta || {};
                const ub = l.urlBloga || {};
                const kbloga = l.kanonicznyBloga || {};
                const ua = l.urlAktualnosci || {};
                const ka = l.kanonicznyAktualnosci || {};
                row.push(
                    l.tytul, l.skroconyOpis, l.pelnaTresc, l.tlumaczenie,
                    m.tryb, m.tytul, m.opis, m.slowaKluczowe,
                    ub.tryb, ub.adres,
                    kbloga.tryb, kbloga.adres,
                    ua.tryb, ua.adres,
                    ka.tryb, ka.adres
                );
            }
            lines.push(row.map(csvEscape).join(';'));
        }
        return '﻿' + lines.join('\r\n');
    }

    function downloadBlob(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function fileNameStem() {
        const host = location.hostname.replace(/\W/g, '-');
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
        return host + '_blog-export_' + ts;
    }

    function buildEnvelope(entries) {
        return {
            version: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            shop: new URLSearchParams(location.search).get('shop') || '1',
            entries
        };
    }
    function downloadEntries(entries, format) {
        const stem = fileNameStem();
        const env = buildEnvelope(entries);
        if (format === 'json') {
            downloadBlob(JSON.stringify(env, null, 2), stem + '.json', 'application/json;charset=utf-8');
        } else if (format === 'csv') {
            // CSV nie ma envelope — wersja w komentarzu w pierwszej linii.
            const head = '# blogExport version=' + SCHEMA_VERSION + ' exportedAt=' + env.exportedAt + ' shop=' + env.shop + '\r\n';
            downloadBlob('﻿' + head + toCsv(entries).replace(/^﻿/, ''), stem + '.csv', 'text/csv;charset=utf-8');
        } else if (format === 'xml') {
            downloadBlob(toXml(env), stem + '.xml', 'application/xml;charset=utf-8');
        }
    }

    // ===== IMPORT — parsery formatów =====
    function detectFormat(filename, content) {
        const ext = (filename || '').toLowerCase().match(/\.([a-z]+)$/);
        if (ext) {
            if (ext[1] === 'json') return 'json';
            if (ext[1] === 'csv') return 'csv';
            if (ext[1] === 'xml') return 'xml';
        }
        const t = (content || '').replace(/^﻿/, '').trimStart();
        if (t.startsWith('{') || t.startsWith('[')) return 'json';
        if (t.startsWith('<?xml') || t.startsWith('<blogExport') || t.startsWith('<')) return 'xml';
        return 'csv';
    }

    function parseImportJson(content) {
        const obj = JSON.parse(content);
        if (Array.isArray(obj)) return { version: SCHEMA_VERSION, entries: obj };
        if (obj && Array.isArray(obj.entries)) return obj;
        throw new Error('Nieprawidłowy JSON — brak entries[]');
    }

    function parseCsvLine(line) {
        const out = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (inQ) {
                if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (c === '"') { inQ = false; }
                else cur += c;
            } else {
                if (c === '"') inQ = true;
                else if (c === ';') { out.push(cur); cur = ''; }
                else cur += c;
            }
        }
        out.push(cur);
        return out;
    }

    function setByPath(obj, path, val) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
            cur = cur[k];
        }
        cur[parts[parts.length - 1]] = val;
    }

    // Mapowanie nazwy kolumny CSV → ścieżka w obiekcie entry. Sufiks _LANG = wewnątrz jezyki.LANG.
    function csvColumnToPath(col) {
        // Top-level D3 listy
        if (col === 'kategoriaBloga_tryb')        return { path: 'kategoriaBloga.tryb' };
        if (col === 'kategoriaBloga_wartosci')    return { path: 'kategoriaBloga.wartosci', type: 'csvList' };
        if (col === 'strefyAktualnosci_tryb')     return { path: 'strefyAktualnosci.tryb' };
        if (col === 'strefyAktualnosci_wartosci') return { path: 'strefyAktualnosci.wartosci', type: 'csvList' };
        if (col === 'towary_tryb')                return { path: 'towary.tryb' };
        if (col === 'towary_wartosci')            return { path: 'towary.wartosci', type: 'towary' };

        const topSimple = ['id', 'widocznosc', 'dataWlaczenia', 'dataWylaczenia', 'typWpisu', 'linkZewnetrzny', 'dataWpisu', 'ikonaWpisu', 'indeksowanie', 'wyszukiwarka'];
        if (topSimple.includes(col)) return { path: col };

        // Per język - kolumny <field>_<lang>, gdzie <field> może zawierać podkreślnik (np. meta_tryb)
        // Lista znanych pól per-język:
        const langFields = {
            'tytul': 'tytul', 'skroconyOpis': 'skroconyOpis', 'pelnaTresc': 'pelnaTresc', 'tlumaczenie': 'tlumaczenie',
            'meta_tryb': 'meta.tryb', 'meta_tytul': 'meta.tytul', 'meta_opis': 'meta.opis', 'meta_slowaKluczowe': 'meta.slowaKluczowe',
            'urlBloga_tryb': 'urlBloga.tryb', 'urlBloga_adres': 'urlBloga.adres',
            'kanonicznyBloga_tryb': 'kanonicznyBloga.tryb', 'kanonicznyBloga_adres': 'kanonicznyBloga.adres',
            'urlAktualnosci_tryb': 'urlAktualnosci.tryb', 'urlAktualnosci_adres': 'urlAktualnosci.adres',
            'kanonicznyAktualnosci_tryb': 'kanonicznyAktualnosci.tryb', 'kanonicznyAktualnosci_adres': 'kanonicznyAktualnosci.adres'
        };
        for (const field of Object.keys(langFields)) {
            if (col.startsWith(field + '_')) {
                const lang = col.slice(field.length + 1);
                return { path: 'jezyki.' + lang + '.' + langFields[field] };
            }
        }
        return null; // nieznana kolumna — pomijamy
    }

    function parseImportCsv(content) {
        let text = content.replace(/^﻿/, '');
        // Wytnij ewentualną linię z komentarzem na początku
        const lines = text.split(/\r?\n/);
        let i = 0;
        while (i < lines.length && lines[i].trim().startsWith('#')) i++;
        if (i >= lines.length) throw new Error('Pusty plik CSV');
        const headers = parseCsvLine(lines[i++]);
        const entries = [];
        for (; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;
            const values = parseCsvLine(line);
            const entry = {};
            headers.forEach((h, idx) => {
                const raw = values[idx];
                if (raw == null || raw === '') return; // pominięte = nie ruszamy (B1) — ale dla pól string puste = "" nadal trafia
                const mapping = csvColumnToPath(h);
                if (!mapping) return;
                let val = raw;
                if (mapping.type === 'csvList') val = raw === '' ? [] : raw.split(',').map(s => s.trim()).filter(Boolean);
                else if (mapping.type === 'towary') val = raw === '' ? [] : towaryFromCsv(raw);
                setByPath(entry, mapping.path, val);
            });
            if (Object.keys(entry).length) entries.push(entry);
        }
        return { version: SCHEMA_VERSION, entries };
    }

    function parseImportXml(content) {
        const doc = new DOMParser().parseFromString(content, 'text/xml');
        const err = doc.querySelector('parsererror');
        if (err) throw new Error('Nieprawidłowy XML: ' + err.textContent.slice(0, 100));
        const root = doc.querySelector('blogExport');
        if (!root) throw new Error('Brak <blogExport> w pliku XML');
        const version = root.getAttribute('version') || SCHEMA_VERSION;
        const shop = root.getAttribute('shop') || '';
        const entries = [];
        for (const wpis of root.querySelectorAll(':scope > wpis')) {
            const e = {};
            const text = sel => { const el = wpis.querySelector(':scope > ' + sel); return el ? (el.textContent || '') : undefined; };
            const attrList = (name, itemTag) => {
                const el = wpis.querySelector(':scope > ' + name);
                if (!el) return undefined;
                const tryb = el.getAttribute('tryb') || 'replace';
                const items = Array.from(el.querySelectorAll(':scope > ' + itemTag));
                let wartosci;
                if (itemTag === 'towar') wartosci = items.map(it => ({ typ: it.getAttribute('typ') || 'productId', wartosc: it.getAttribute('wartosc') || '' }));
                else wartosci = items.map(it => it.textContent || '');
                return { tryb, wartosci };
            };
            ['id', 'widocznosc', 'dataWlaczenia', 'dataWylaczenia', 'typWpisu', 'linkZewnetrzny', 'dataWpisu', 'ikonaWpisu', 'indeksowanie', 'wyszukiwarka'].forEach(k => {
                const v = text(k);
                if (v !== undefined) e[k] = v;
            });
            const kb = attrList('kategoriaBloga', 'wartosc'); if (kb) e.kategoriaBloga = kb;
            const sa = attrList('strefyAktualnosci', 'wartosc'); if (sa) e.strefyAktualnosci = sa;
            const to = attrList('towary', 'towar'); if (to) e.towary = to;

            const jezykiEl = wpis.querySelector(':scope > jezyki');
            if (jezykiEl) {
                e.jezyki = {};
                for (const j of jezykiEl.querySelectorAll(':scope > jezyk')) {
                    const lang = j.getAttribute('kod');
                    if (!lang) continue;
                    const langObj = {};
                    const ltext = sel => { const el = j.querySelector(':scope > ' + sel); return el ? (el.textContent || '') : undefined; };
                    ['tytul', 'skroconyOpis', 'pelnaTresc', 'tlumaczenie'].forEach(k => {
                        const v = ltext(k);
                        if (v !== undefined) langObj[k] = v;
                    });
                    const metaEl = j.querySelector(':scope > meta');
                    if (metaEl) {
                        langObj.meta = { tryb: metaEl.getAttribute('tryb') || 'automatyczne' };
                        ['tytul', 'opis', 'slowaKluczowe'].forEach(k => {
                            const c = metaEl.querySelector(':scope > ' + k);
                            if (c) langObj.meta[k] = c.textContent || '';
                        });
                    }
                    ['urlBloga', 'kanonicznyBloga', 'urlAktualnosci', 'kanonicznyAktualnosci'].forEach(name => {
                        const el = j.querySelector(':scope > ' + name);
                        if (el) {
                            langObj[name] = {
                                tryb: el.getAttribute('tryb') || 'automatyczny',
                                adres: (el.querySelector(':scope > adres') || { textContent: '' }).textContent || ''
                            };
                        }
                    });
                    e.jezyki[lang] = langObj;
                }
            }
            entries.push(e);
        }
        return { version, shop, entries };
    }

    function parseImportFile(filename, content) {
        const fmt = detectFormat(filename, content);
        if (fmt === 'json') return parseImportJson(content);
        if (fmt === 'csv') return parseImportCsv(content);
        if (fmt === 'xml') return parseImportXml(content);
        throw new Error('Nieznany format pliku');
    }

    // ===== IMPORT — pipeline =====
    async function fetchEntryEditHtml(id, signal) {
        const shop = new URLSearchParams(location.search).get('shop') || '1';
        const url = location.origin + '/panel/entries.php?action=edit&mode=blog&shop=' + shop + (id ? '&id=' + id : '');
        const r = await fetch(url, { credentials: 'include', signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.text();
    }

    function buildFormDataFromHtml(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const form = doc.querySelector('form#own-url') || doc.querySelector('form[action*="entries.php"]');
        if (!form) throw new Error('Form not found in edit page');
        const fd = new FormData();
        form.querySelectorAll('input, select, textarea').forEach(el => {
            if (!el.name) return;
            const t = (el.type || '').toLowerCase();
            if (t === 'file' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return;
            if ((t === 'radio' || t === 'checkbox') && !el.checked) return;
            if (el.tagName === 'SELECT') {
                Array.from(el.selectedOptions).forEach(opt => fd.append(el.name, opt.value));
                return;
            }
            fd.append(el.name, el.value == null ? '' : el.value);
        });
        const action = form.getAttribute('action') || '';
        return { fd, action };
    }

    function applyD3List(fd, name, importObj) {
        if (!importObj || typeof importObj !== 'object') return;
        const current = fd.getAll(name);
        const wartosci = importObj.wartosci || [];
        let target;
        if (importObj.tryb === 'replace') target = [...wartosci];
        else if (importObj.tryb === 'add') target = [...new Set([...current, ...wartosci])];
        else if (importObj.tryb === 'remove') target = current.filter(v => !wartosci.includes(v));
        else return;
        fd.delete(name);
        for (const v of target) fd.append(name, v);
    }

    function applyTowary(fd, importObj) {
        if (!importObj || typeof importObj !== 'object') return;
        const currentIds = [];
        for (const k of fd.keys()) {
            const m = k.match(/^product\[(.+)\]\[\]$/);
            if (m) currentIds.push(m[1]);
        }
        const wartosci = importObj.wartosci || [];
        // W v0.4.0: rozwiązywanie productCode* → productId odłożone. Bierzemy tylko productId.
        const importIds = wartosci.filter(t => t.typ === 'productId' || !t.typ).map(t => t.wartosc);
        const dropped = wartosci.length - importIds.length;
        let target;
        if (importObj.tryb === 'replace') target = [...importIds];
        else if (importObj.tryb === 'add') target = [...new Set([...currentIds, ...importIds])];
        else if (importObj.tryb === 'remove') target = currentIds.filter(id => !importIds.includes(id));
        else return;
        for (const k of [...fd.keys()]) {
            if (/^product\[.+\]\[\]$/.test(k)) fd.delete(k);
        }
        for (const id of target) fd.append('product[' + id + '][]', id);
        return { dropped };
    }

    async function fetchImageBlob(url, signal) {
        let fullUrl = String(url || '').trim();
        if (!fullUrl) throw new Error('pusty URL');
        if (fullUrl.startsWith('//')) fullUrl = location.protocol + fullUrl;
        else if (fullUrl.startsWith('/')) fullUrl = location.origin + fullUrl;
        // Cross-origin URL — credentials: 'omit' żeby uniknąć błędu CORS dla cookies
        const sameOrigin = fullUrl.startsWith(location.origin + '/') || fullUrl.startsWith(location.origin + '?') || fullUrl === location.origin;
        const r = await fetch(fullUrl, { credentials: sameOrigin ? 'include' : 'omit', signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        if (!blob.size) throw new Error('pusty obrazek');
        return blob;
    }

    function fileNameFromUrl(url) {
        try {
            const u = new URL(url, location.origin);
            const last = u.pathname.split('/').filter(Boolean).pop() || 'image.jpg';
            if (!/\.[a-z0-9]{2,5}$/i.test(last)) return last + '.jpg';
            return last;
        } catch (e) { return 'image.jpg'; }
    }

    async function applyImportToFormData(fd, importEntry, signal) {
        const warns = [];
        const setField = (name, val) => {
            if (val === undefined) return;
            fd.set(name, val == null ? '' : String(val));
        };
        if (importEntry.widocznosc !== undefined) setField('visible', M.visible.toBackend(importEntry.widocznosc));
        if (importEntry.dataWlaczenia !== undefined) setField('show_date_ymd', importEntry.dataWlaczenia);
        if (importEntry.dataWylaczenia !== undefined) setField('hide_date_ymd', importEntry.dataWylaczenia);
        if (importEntry.typWpisu !== undefined) setField('linkType', M.linkType.toBackend(importEntry.typWpisu));
        if (importEntry.linkZewnetrzny !== undefined) setField('link', importEntry.linkZewnetrzny);
        if (importEntry.dataWpisu !== undefined) setField('created_at_ymd', importEntry.dataWpisu);
        if (importEntry.indeksowanie !== undefined) setField('sitemap_index', M.yn.toBackend(importEntry.indeksowanie));
        if (importEntry.wyszukiwarka !== undefined) setField('search_index', M.yn.toBackend(importEntry.wyszukiwarka));
        if (importEntry.ikonaWpisu !== undefined) {
            const url = importEntry.ikonaWpisu;
            if (url == null || url === '') {
                // C: jawnie puste = usuń grafikę
                fd.set('ifimg', 'n');
            } else {
                try {
                    const blob = await fetchImageBlob(url, signal);
                    const fname = fileNameFromUrl(url);
                    fd.set('plik', blob, fname);
                    fd.set('ifimg', 't');
                    warns.push('obrazek wgrany: ' + fname + ' (' + Math.round(blob.size / 1024) + ' KB)');
                } catch (e) {
                    warns.push('NIE pobrano obrazka ' + url + ': ' + e.message);
                }
            }
        }
        if (importEntry.kategoriaBloga) applyD3List(fd, 'categories[]', importEntry.kategoriaBloga);
        if (importEntry.strefyAktualnosci) applyD3List(fd, 'zones[]', importEntry.strefyAktualnosci);
        if (importEntry.towary) {
            const r = applyTowary(fd, importEntry.towary);
            if (r && r.dropped > 0) warns.push(r.dropped + ' towar(ów) z kodem (productCode*) pominięte — rozwiązywanie kodów od v0.5.0');
        }
        if (importEntry.jezyki) {
            for (const lang of Object.keys(importEntry.jezyki)) {
                const l = importEntry.jezyki[lang];
                if (l.tytul !== undefined) setField('title[' + lang + ']', l.tytul);
                if (l.skroconyOpis !== undefined) setField('description[' + lang + ']', l.skroconyOpis);
                if (l.pelnaTresc !== undefined) setField('long_description[' + lang + ']', l.pelnaTresc);
                if (l.tlumaczenie !== undefined) setField('translation_flag_radio[' + lang + ']', M.yn.toBackend(l.tlumaczenie));
                if (l.meta) {
                    if (l.meta.tryb !== undefined) setField('meta[' + lang + ']', M.metaTryb.toBackend(l.meta.tryb));
                    if (l.meta.tytul !== undefined) setField('meta_title[' + lang + ']', l.meta.tytul);
                    if (l.meta.opis !== undefined) setField('meta_description[' + lang + ']', l.meta.opis);
                    if (l.meta.slowaKluczowe !== undefined) setField('meta_keyword[' + lang + ']', l.meta.slowaKluczowe);
                }
                if (l.urlBloga) {
                    if (l.urlBloga.tryb !== undefined) setField('url_blog_radio[' + lang + ']', M.urlTryb.toBackend(l.urlBloga.tryb));
                    if (l.urlBloga.adres !== undefined) setField('blog_url[' + lang + ']', l.urlBloga.adres);
                }
                if (l.kanonicznyBloga) {
                    if (l.kanonicznyBloga.tryb !== undefined) setField('canonical_blog_radio[' + lang + ']', M.urlTryb.toBackend(l.kanonicznyBloga.tryb));
                    if (l.kanonicznyBloga.adres !== undefined) setField('canonical_blog[' + lang + ']', l.kanonicznyBloga.adres);
                }
                if (l.urlAktualnosci) {
                    if (l.urlAktualnosci.tryb !== undefined) setField('url_news_radio[' + lang + ']', M.urlTryb.toBackend(l.urlAktualnosci.tryb));
                    if (l.urlAktualnosci.adres !== undefined) setField('news_url[' + lang + ']', l.urlAktualnosci.adres);
                }
                if (l.kanonicznyAktualnosci) {
                    if (l.kanonicznyAktualnosci.tryb !== undefined) setField('canonical_news_radio[' + lang + ']', M.urlTryb.toBackend(l.kanonicznyAktualnosci.tryb));
                    if (l.kanonicznyAktualnosci.adres !== undefined) setField('canonical_news[' + lang + ']', l.kanonicznyAktualnosci.adres);
                }
            }
        }
        return warns;
    }

    async function postEntryForm(actionUrl, fd, signal) {
        let url = actionUrl;
        if (!url.startsWith('http')) {
            if (!url.startsWith('/')) url = '/' + url;
            url = location.origin + url;
        }
        const r = await fetch(url, { method: 'POST', credentials: 'include', body: fd, signal, redirect: 'follow' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r;
    }

    async function runBackupBeforeImport(envelope, modal) {
        const updateIds = envelope.entries.map(e => e.id).filter(Boolean);
        if (!updateIds.length) { modal.log('Brak istniejących wpisów do backupu (same CREATE)'); return; }
        const backupEntries = new Array(updateIds.length);
        let done = 0;
        const sig = modal.signal;
        const tasks = updateIds.map((id, idx) => async (signal) => {
            try { backupEntries[idx] = await fetchFullEntry(id, signal); }
            catch (e) { backupEntries[idx] = { id, error: e.message }; }
            finally { done++; modal.update(done, updateIds.length, 'Backup: pobieranie obecnych wartości'); }
        });
        let bi = 0;
        const bworkers = Array(Math.min(CONCURRENCY, tasks.length)).fill(0).map(async () => {
            while (bi < tasks.length && !sig.aborted) {
                const idx = bi++;
                await tasks[idx](sig);
            }
        });
        await Promise.all(bworkers);
        if (sig.aborted) return;
        const valid = backupEntries.filter(b => b && !b.error);
        const ts = fileNameStem();
        const env = { version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), shop: envelope.shop || (new URLSearchParams(location.search).get('shop') || '1'), entries: valid };
        downloadBlob(JSON.stringify(env, null, 2), 'backup_' + ts + '.json', 'application/json;charset=utf-8');
        modal.log('Backup pobrany: backup_' + ts + '.json (' + valid.length + ' wpisów)');
    }

    async function runImport(envelope, opts, modal) {
        const entries = envelope.entries || [];
        if (!entries.length) { modal.log('Plik pusty'); modal.done('Brak wpisów'); return; }
        modal.log('Wpisów w pliku: ' + entries.length);

        if (opts.autoBackup) {
            try { await runBackupBeforeImport(envelope, modal); }
            catch (e) { if (e.name !== 'AbortError') modal.log('Backup błąd: ' + e.message); }
            if (modal.signal.aborted) { modal.done('Anulowano'); return; }
        }

        let done = 0, errors = 0, created = 0, updated = 0;
        const IMPORT_CONCURRENCY = 2;
        const tasks = entries.map((entry, idx) => async (signal) => {
            const isCreate = !entry.id;
            try {
                if (isCreate) {
                    const hasTitle = entry.jezyki && Object.values(entry.jezyki).some(l => l && l.tytul && String(l.tytul).trim());
                    if (!hasTitle) throw new Error('CREATE wymaga tytul w przynajmniej 1 języku');
                }
                const html = await fetchEntryEditHtml(entry.id || null, signal);
                const { fd, action } = buildFormDataFromHtml(html);
                const warns = await applyImportToFormData(fd, entry, signal);
                await postEntryForm(action, fd, signal);
                if (entry.id) cacheInvalidate(entry.id);
                if (isCreate) created++; else updated++;
                let msg = '✓ ' + (entry.id || 'NEW') + ' (' + (isCreate ? 'create' : 'update') + ')';
                if (warns && warns.length) msg += ' [' + warns.join('; ') + ']';
                modal.log(msg);
            } catch (e) {
                if (e.name !== 'AbortError') {
                    errors++;
                    modal.log('✗ ' + (entry.id || 'NEW') + ': ' + e.message);
                }
            } finally {
                done++;
                modal.update(done, entries.length, 'Import');
            }
        });
        let ii = 0;
        const sig = modal.signal;
        const iworkers = Array(Math.min(IMPORT_CONCURRENCY, tasks.length)).fill(0).map(async () => {
            while (ii < tasks.length && !sig.aborted) {
                const idx = ii++;
                await tasks[idx](sig);
            }
        });
        await Promise.all(iworkers);

        if (sig.aborted) { modal.done('Anulowano (' + (updated + created) + '/' + entries.length + ')'); return; }
        modal.log('Wynik: ' + updated + ' update, ' + created + ' create, ' + errors + ' błędów');
        // Po imporcie - odśwież listę przez IAI.Table.reload (jeśli dostępny)
        try { if (window.IAI && window.IAI.Table && window.IAI.Table.reload) window.IAI.Table.reload('blog'); } catch (e) {}
        modal.done('Import zakończony');
    }

    function getCurrentPageIds() {
        return Array.from(document.querySelectorAll('table.entries tr[id^="tr_"] a[href*="action=edit"]'))
            .map(a => { const m = a.getAttribute('href').match(/[?&]id=(\d+)/); return m ? m[1] : null; })
            .filter(Boolean);
    }

    async function fetchListPageIds(pageNum, signal) {
        const shop = new URLSearchParams(location.search).get('shop') || '1';
        const body = '__iai_shop_panel[__encoding]=utf-8' +
            '&mode=blog&action=items&shop=' + shop +
            '&tableClass=t6+entries' +
            '&current_page=' + pageNum +
            '&sort[column]=&sort[type]=';
        const r = await fetch(location.origin + '/panel/ajax/view-manager.php?type=blog&view=ajax_content', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
            body,
            signal
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const ids = Array.from(doc.querySelectorAll('tr[id^="tr_"] a[href*="action=edit"]'))
            .map(a => { const m = a.getAttribute('href').match(/[?&]id=(\d+)/); return m ? m[1] : null; })
            .filter(Boolean);
        const info = doc.querySelector('#search-results-info');
        const total = info ? parseInt(info.querySelector('.total-result')?.textContent || '0', 10) : ids.length;
        const perPage = info ? parseInt(info.querySelector('.per-page')?.textContent || '100', 10) : 100;
        return { ids, total, perPage };
    }

    async function collectAllIds(signal, onProgress) {
        const first = await fetchListPageIds(1, signal);
        const all = [...first.ids];
        const totalPages = Math.max(1, Math.ceil(first.total / first.perPage));
        if (onProgress) onProgress(1, totalPages);
        for (let p = 2; p <= totalPages; p++) {
            if (signal.aborted) throw new DOMException('aborted', 'AbortError');
            const page = await fetchListPageIds(p, signal);
            all.push(...page.ids);
            if (onProgress) onProgress(p, totalPages);
        }
        return all;
    }

    function showProgressModal(title) {
        const mask = document.createElement('div');
        mask.className = 'blogi-modal-mask';
        const modal = document.createElement('div');
        modal.className = 'blogi-modal';
        modal.innerHTML =
            '<h3></h3>' +
            '<div class="blogi-progress-text">Inicjalizacja…</div>' +
            '<div class="blogi-progress-bar"><div class="blogi-progress-fill"></div></div>' +
            '<div class="blogi-status"></div>' +
            '<div class="blogi-modal-actions"><button class="cancel">Anuluj</button></div>';
        modal.querySelector('h3').textContent = title;
        document.body.appendChild(mask);
        document.body.appendChild(modal);
        const fill = modal.querySelector('.blogi-progress-fill');
        const txt = modal.querySelector('.blogi-progress-text');
        const status = modal.querySelector('.blogi-status');
        const cancelBtn = modal.querySelector('button.cancel');
        const controller = new AbortController();
        let finished = false;
        const close = () => {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        };
        cancelBtn.addEventListener('click', () => {
            if (finished) close();
            else controller.abort();
        });
        mask.addEventListener('click', () => { if (finished) close(); });
        return {
            signal: controller.signal,
            update(done, total, msg) {
                const pct = total > 0 ? Math.round(100 * done / total) : 0;
                fill.style.width = pct + '%';
                txt.textContent = (msg || 'Pobieranie') + ': ' + done + ' / ' + total + ' (' + pct + '%)';
            },
            log(msg) {
                const line = document.createElement('div');
                line.textContent = msg;
                status.appendChild(line);
                status.scrollTop = status.scrollHeight;
            },
            close,
            done(msg) {
                finished = true;
                cancelBtn.textContent = 'Zamknij';
                cancelBtn.className = 'primary';
                txt.textContent = msg || 'Zakończono';
                fill.style.width = '100%';
            }
        };
    }

    async function runExport(scope, format) {
        const modal = showProgressModal('Eksport wpisów blog → ' + format.toUpperCase());
        modal.update(0, 1, scope === 'all' ? 'Zbieranie identyfikatorów' : 'Przygotowanie');
        try {
            let ids;
            if (scope === 'page') {
                ids = getCurrentPageIds();
            } else if (scope === 'selected') {
                ids = [...selected];
            } else {
                ids = await collectAllIds(modal.signal, (p, t) => modal.update(p, t, 'Pobieranie stron listy'));
            }
            if (ids.length === 0) { modal.log('Brak wpisów do eksportu'); modal.done('Brak wpisów'); return; }
            modal.log('Wpisów do pobrania: ' + ids.length);

            const entries = new Array(ids.length);
            let done = 0;
            const tasks = ids.map((id, idx) => async (signal) => {
                try {
                    entries[idx] = await fetchFullEntry(id, signal);
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        entries[idx] = { id, error: e.message };
                        modal.log('Błąd ' + id + ': ' + e.message);
                    }
                } finally {
                    done++;
                    modal.update(done, ids.length, 'Pobieranie wpisów');
                }
            });

            const signal = modal.signal;
            let i = 0;
            const workers = Array(Math.min(CONCURRENCY, tasks.length)).fill(0).map(async () => {
                while (i < tasks.length && !signal.aborted) {
                    const idx = i++;
                    await tasks[idx](signal);
                }
            });
            await Promise.all(workers);

            if (signal.aborted) { modal.log('Eksport anulowany'); modal.done('Anulowano'); return; }

            const validEntries = entries.filter(Boolean);
            modal.log('Generowanie pliku ' + format.toUpperCase() + '…');
            downloadEntries(validEntries, format);
            modal.done('Plik pobrany (' + validEntries.length + ' wpisów)');
        } catch (e) {
            if (e.name !== 'AbortError') modal.log('Błąd: ' + e.message);
            modal.done(e.name === 'AbortError' ? 'Anulowano' : 'Błąd');
        }
    }

    function showImportPickerModal() {
        return new Promise(resolve => {
            const mask = document.createElement('div');
            mask.className = 'blogi-modal-mask';
            const modal = document.createElement('div');
            modal.className = 'blogi-modal';
            modal.style.minWidth = '480px';
            modal.innerHTML =
                '<h3>Import wpisów</h3>' +
                '<div class="blogi-drop" style="border:2px dashed #ccc;border-radius:6px;padding:30px;text-align:center;color:#999;margin-bottom:12px;cursor:pointer;">' +
                  'Przeciągnij plik (JSON / CSV / XML) albo kliknij, żeby wybrać.' +
                  '<br><small style="display:block;margin-top:6px">Schemat zgodny z TEMPLATE.md v3 (klucze polskie, D3, jezyki)</small>' +
                  '<input type="file" accept=".json,.csv,.xml,application/json,text/csv,application/xml,text/xml" style="display:none">' +
                '</div>' +
                '<div class="blogi-file-info" style="font-size:12px;color:#333;min-height:30px;margin-bottom:8px"></div>' +
                '<div class="blogi-preview" style="font-size:11px;max-height:140px;overflow:auto;background:#fafafa;padding:6px;border:1px solid #eee;border-radius:3px;display:none"></div>' +
                '<label style="display:block;margin-top:10px;font-size:12px;cursor:pointer">' +
                  '<input type="checkbox" class="blogi-auto-backup" checked> Wykonaj backup JSON aktualnego stanu przed importem (zalecane)' +
                '</label>' +
                '<div class="blogi-modal-actions">' +
                  '<button class="cancel" type="button">Anuluj</button>' +
                  '<button class="primary blogi-confirm" type="button" disabled>Importuj</button>' +
                '</div>';

            document.body.appendChild(mask);
            document.body.appendChild(modal);

            const drop = modal.querySelector('.blogi-drop');
            const fileInput = drop.querySelector('input[type="file"]');
            const info = modal.querySelector('.blogi-file-info');
            const preview = modal.querySelector('.blogi-preview');
            const confirm = modal.querySelector('.blogi-confirm');
            const cancel = modal.querySelector('.cancel');
            const autoBackup = modal.querySelector('.blogi-auto-backup');
            let envelope = null;
            let fileName = '';

            const close = (result) => {
                if (mask.parentNode) mask.parentNode.removeChild(mask);
                if (modal.parentNode) modal.parentNode.removeChild(modal);
                resolve(result);
            };

            const loadFile = (file) => {
                fileName = file.name;
                info.textContent = 'Wczytywanie: ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)';
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        envelope = parseImportFile(file.name, reader.result);
                        const cnt = envelope.entries ? envelope.entries.length : 0;
                        info.innerHTML = '<strong>' + file.name + '</strong> — ' + cnt + ' wpisów, schemat v' + (envelope.version || '?');
                        const ups = envelope.entries.filter(e => e.id).length;
                        const cre = cnt - ups;
                        info.innerHTML += ' (' + ups + ' update, ' + cre + ' create)';
                        // Preview pierwszych 3 wpisów: id + tytuł[pol] / pierwszego języka
                        const items = envelope.entries.slice(0, 3).map(e => {
                            const langs = e.jezyki ? Object.keys(e.jezyki) : [];
                            const firstTitle = langs.length ? (e.jezyki[langs[0]].tytul || '') : '';
                            return '<div>• ' + (e.id ? '#' + e.id : 'NEW') + ' ' + (firstTitle || '<em>(bez tytułu)</em>').slice(0, 80) + '</div>';
                        }).join('');
                        preview.innerHTML = items + (cnt > 3 ? '<div style="color:#999">…i ' + (cnt - 3) + ' więcej</div>' : '');
                        preview.style.display = 'block';
                        confirm.disabled = !cnt;
                    } catch (e) {
                        info.innerHTML = '<span style="color:#c00">Błąd: ' + (e.message || e) + '</span>';
                        preview.style.display = 'none';
                        envelope = null;
                        confirm.disabled = true;
                    }
                };
                reader.onerror = () => { info.innerHTML = '<span style="color:#c00">Nie udało się odczytać pliku</span>'; };
                reader.readAsText(file, 'utf-8');
            };

            drop.addEventListener('click', e => { if (e.target !== fileInput) fileInput.click(); });
            fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
            drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.background = '#fafafa'; });
            drop.addEventListener('dragleave', () => { drop.style.background = ''; });
            drop.addEventListener('drop', e => {
                e.preventDefault();
                drop.style.background = '';
                if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
            });
            cancel.addEventListener('click', () => close(null));
            confirm.addEventListener('click', () => {
                if (!envelope) return;
                const c = confirmInline(modal, 'Importować ' + envelope.entries.length + ' wpisów do sklepu? Backup JSON: ' + (autoBackup.checked ? 'TAK' : 'NIE'));
                c.then(yes => {
                    if (!yes) return;
                    close({ envelope, fileName, autoBackup: autoBackup.checked });
                });
            });
        });
    }

    function confirmInline(parentModal, message) {
        return new Promise(resolve => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(255,255,255,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;border-radius:6px';
            wrap.innerHTML =
                '<div style="font-size:14px;margin-bottom:18px;color:#333">' + message + '</div>' +
                '<div><button class="cancel-no" type="button" style="padding:6px 14px;margin:0 6px;cursor:pointer;border:1px solid #ccc;background:#fff;border-radius:3px">Anuluj</button>' +
                '<button class="primary confirm-yes" type="button" style="padding:6px 14px;margin:0 6px;cursor:pointer;border:1px solid #5cb85c;background:#5cb85c;color:#fff;border-radius:3px">Tak, importuj</button></div>';
            parentModal.appendChild(wrap);
            wrap.querySelector('.confirm-yes').addEventListener('click', () => { wrap.remove(); resolve(true); });
            wrap.querySelector('.cancel-no').addEventListener('click', () => { wrap.remove(); resolve(false); });
        });
    }

    async function runImportFlow() {
        const choice = await showImportPickerModal();
        if (!choice) return;
        const modal = showProgressModal('Import wpisów — ' + choice.fileName);
        modal.update(0, 1, 'Inicjalizacja');
        try {
            await runImport(choice.envelope, { autoBackup: choice.autoBackup }, modal);
        } catch (e) {
            if (e.name !== 'AbortError') modal.log('Błąd: ' + e.message);
            modal.done('Błąd');
        }
    }

    async function selectAllEntries() {
        const modal = showProgressModal('Zaznaczanie wszystkich wpisów');
        modal.update(0, 1, 'Zbieranie identyfikatorów');
        try {
            const ids = await collectAllIds(modal.signal, (p, t) => modal.update(p, t, 'Pobieranie stron listy'));
            if (modal.signal.aborted) { modal.done('Anulowano'); return; }
            ids.forEach(id => selected.add(id));
            saveSelected();
            applySelectedToRows();
            updateSelectionBar();
            updateHeaderCheckbox();
            modal.log('Zaznaczono: ' + selected.size);
            modal.done('Zaznaczono ' + selected.size + ' wpisów');
        } catch (e) {
            if (e.name !== 'AbortError') modal.log('Błąd: ' + e.message);
            modal.done(e.name === 'AbortError' ? 'Anulowano' : 'Błąd');
        }
    }

    function injectToolbar() {
        const paginator = document.querySelector('.yui-dt-paginator');
        if (!paginator || paginator.querySelector('.blogi-toolbar')) return;

        const selBar = document.createElement('span');
        selBar.className = 'blogi-selection-info';
        selBar.style.display = 'none';
        selBar.innerHTML =
            'Zaznaczono: <strong class="blogi-selection-count">0</strong>' +
            ' <button class="blogi-clear-sel" type="button">Wyczyść</button>' +
            ' <button class="blogi-select-all-btn" type="button">Zaznacz wszystkie wpisy</button>';

        const importWrap = document.createElement('span');
        importWrap.className = 'blogi-toolbar';
        importWrap.innerHTML = '<button class="blogi-btn blogi-btn-import blogi-import-btn" type="button">📥 Import</button>';

        const wrap = document.createElement('span');
        wrap.className = 'blogi-toolbar';
        wrap.innerHTML =
            '<button class="blogi-btn" type="button">📤 Eksport ▾</button>' +
            '<div class="blogi-menu">' +
            '<div class="blogi-menu-group">Bieżąca strona</div>' +
            '<a class="blogi-menu-item" data-scope="page" data-format="json">JSON</a>' +
            '<a class="blogi-menu-item" data-scope="page" data-format="csv">CSV</a>' +
            '<a class="blogi-menu-item" data-scope="page" data-format="xml">XML</a>' +
            '<div class="blogi-menu-group">Zaznaczone</div>' +
            '<a class="blogi-menu-item blogi-disabled" data-scope="selected" data-format="json">JSON</a>' +
            '<a class="blogi-menu-item blogi-disabled" data-scope="selected" data-format="csv">CSV</a>' +
            '<a class="blogi-menu-item blogi-disabled" data-scope="selected" data-format="xml">XML</a>' +
            '<div class="blogi-menu-group">Wszystkie wpisy</div>' +
            '<a class="blogi-menu-item" data-scope="all" data-format="json">JSON</a>' +
            '<a class="blogi-menu-item" data-scope="all" data-format="csv">CSV</a>' +
            '<a class="blogi-menu-item" data-scope="all" data-format="xml">XML</a>' +
            '</div>';
        paginator.appendChild(selBar);
        paginator.appendChild(importWrap);
        paginator.appendChild(wrap);

        importWrap.querySelector('.blogi-import-btn').addEventListener('click', () => { runImportFlow(); });

        const btn = wrap.querySelector('.blogi-btn');
        const menu = wrap.querySelector('.blogi-menu');
        btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
        document.addEventListener('click', () => menu.classList.remove('open'));
        menu.addEventListener('click', (e) => {
            const item = e.target.closest('.blogi-menu-item');
            if (!item || item.classList.contains('blogi-disabled')) return;
            menu.classList.remove('open');
            runExport(item.dataset.scope, item.dataset.format);
        });

        selBar.querySelector('.blogi-clear-sel').addEventListener('click', () => {
            selected.clear();
            saveSelected();
            applySelectedToRows();
            updateSelectionBar();
            updateHeaderCheckbox();
        });
        selBar.querySelector('.blogi-select-all-btn').addEventListener('click', () => {
            selectAllEntries();
        });
    }

    function onListReload() {
        rebuildHeader();
        rebuildRows();
        injectToolbar();
        applySelectedToRows();
        updateSelectionBar();
        updateHeaderCheckbox();
        enqueueFetches();
    }

    function setupEditTracking() {
        document.addEventListener('click', (e) => {
            const a = e.target.closest('a[href*="action=edit"][href*="mode=blog"][href*="id="]');
            if (!a) return;
            const m = a.getAttribute('href').match(/[?&]id=(\d+)/);
            if (m) sessionStorage.setItem(LAST_EDITED_KEY, m[1]);
        }, true);

        const lastEdited = sessionStorage.getItem(LAST_EDITED_KEY);
        if (lastEdited) {
            cacheInvalidate(lastEdited);
            sessionStorage.removeItem(LAST_EDITED_KEY);
        }
    }

    function startFallback() {
        const table = document.querySelector('table.entries');
        if (!table) return;
        let scheduled = false;
        const obs = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; onListReload(); }, 100);
        });
        obs.observe(table, { childList: true, subtree: true });
        onListReload();
    }

    function bootstrap() {
        let tries = 0;
        const handle = setInterval(() => {
            if (window.IAI && window.IAI.Table && typeof window.IAI.Table.setCallback === 'function') {
                clearInterval(handle);
                window.IAI.Table.setCallback(onListReload);
                onListReload();
            } else if (++tries > BOOT_MAX_TRIES) {
                clearInterval(handle);
                startFallback();
            }
        }, BOOT_INTERVAL);
    }

    setupEditTracking();
    bootstrap();
})();
