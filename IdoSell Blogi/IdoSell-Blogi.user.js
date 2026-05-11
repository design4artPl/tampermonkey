// ==UserScript==
// @name         IdoSell Blogi — rozszerzona lista wpisów
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      0.3.0
// @description  Lista wpisów blog: 4 dodatkowe kolumny + multi-select wpisów (persistent przez paginację) + eksport bieżącej / zaznaczonych / wszystkich wpisów do JSON / CSV / XML
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

    function parseFullEntry(html, id) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const $val = (sel) => { const e = doc.querySelector(sel); return e ? (e.value || '') : ''; };
        const $checked = (name) => { const e = doc.querySelector('input[name="' + name + '"]:checked'); return e ? e.value : null; };

        const data = {
            id: String(id),
            visible: $checked('visible') === 't',
            date: $val('input[name="created_at_ymd"]'),
            showDate: $val('input[name="show_date_ymd"]'),
            hideDate: $val('input[name="hide_date_ymd"]'),
            linkType: $checked('linkType') || 'self',
            link: $val('input[name="link"]'),
            entryHasImg: $checked('ifimg') === 't',
            categories: Array.from(doc.querySelectorAll('input[name="categories[]"]:checked')).map(i => i.value),
            zones: Array.from(doc.querySelectorAll('input[name="zones[]"]:checked')).map(i => i.value),
            relatedProducts: Array.from(doc.querySelectorAll('#related-products input[id^="related-product-"]')).map(i => i.value),
            languages: {},
            images: []
        };

        const langs = new Set();
        doc.querySelectorAll('input[name^="title["]').forEach(i => {
            const m = i.name.match(/^title\[(.+?)\]$/);
            if (m) langs.add(m[1]);
        });

        for (const lang of langs) {
            const longDesc = $val('input[name="long_description[' + lang + ']"]');
            data.languages[lang] = {
                title: $val('input[name="title[' + lang + ']"]'),
                description: $val('textarea[name="description[' + lang + ']"]'),
                longDescription: longDesc,
                translationFlag: $checked('translation_flag_radio[' + lang + ']') === 'y',
                meta: $checked('meta[' + lang + ']') === 'y',
                metaTitle: $val('input[name="meta_title[' + lang + ']"]'),
                metaDescription: $val('input[name="meta_description[' + lang + ']"]'),
                metaKeyword: $val('input[name="meta_keyword[' + lang + ']"]'),
                urlBlogRadio: $checked('url_blog_radio[' + lang + ']') === 'y',
                blogUrl: $val('input[name="blog_url[' + lang + ']"]'),
                urlNewsRadio: $checked('url_news_radio[' + lang + ']') === 'y',
                newsUrl: $val('input[name="news_url[' + lang + ']"]'),
                canonicalBlogRadio: $checked('canonical_blog_radio[' + lang + ']') === 'y',
                canonicalBlog: $val('input[name="canonical_blog[' + lang + ']"]'),
                canonicalNewsRadio: $checked('canonical_news_radio[' + lang + ']') === 'y',
                canonicalNews: $val('input[name="canonical_news[' + lang + ']"]')
            };

            const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
            let m;
            while ((m = imgRegex.exec(longDesc)) !== null) {
                data.images.push({ lang, src: m[1] });
            }
        }

        data.hasImgInContent = data.images.length > 0;
        data.customLink = (data.linkType !== 'self') || Object.values(data.languages).some(l => l.urlBlogRadio || l.urlNewsRadio);
        data.customMeta = Object.values(data.languages).some(l => l.meta);

        return data;
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
        cacheSet(id, {
            products: full.relatedProducts.length,
            customLink: full.customLink,
            customMeta: full.customMeta,
            hasImg: full.hasImgInContent
        });
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

    function xmlValue(v, indent) {
        if (v == null) return '';
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        if (typeof v === 'number') return String(v);
        if (Array.isArray(v)) {
            return v.map(item => indent + '<item>' + (typeof item === 'object' ? '\n' + xmlObject(item, indent + '  ') + indent : escapeXml(item)) + '</item>').join('\n');
        }
        if (typeof v === 'object') {
            return '\n' + xmlObject(v, indent + '  ') + indent;
        }
        const s = String(v);
        if (/[<>&]/.test(s) && s.length > 30) return '<![CDATA[' + s.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
        return escapeXml(s);
    }

    function xmlObject(obj, indent) {
        let out = '';
        for (const k of Object.keys(obj)) {
            const v = obj[k];
            const tag = k.replace(/[^a-zA-Z0-9_-]/g, '_');
            if (Array.isArray(v)) {
                if (v.length === 0) {
                    out += indent + '<' + tag + '/>\n';
                } else {
                    out += indent + '<' + tag + '>\n' + xmlValue(v, indent + '  ') + '\n' + indent + '</' + tag + '>\n';
                }
            } else if (v != null && typeof v === 'object') {
                out += indent + '<' + tag + '>' + xmlValue(v, indent) + '</' + tag + '>\n';
            } else {
                out += indent + '<' + tag + '>' + xmlValue(v, indent) + '</' + tag + '>\n';
            }
        }
        return out;
    }

    function toXml(entries) {
        let out = '<?xml version="1.0" encoding="UTF-8"?>\n<entries>\n';
        for (const e of entries) {
            out += '  <entry>\n' + xmlObject(e, '    ') + '  </entry>\n';
        }
        out += '</entries>\n';
        return out;
    }

    function csvEscape(s) {
        if (s == null) return '';
        const str = String(s);
        if (/[;"\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
        return str;
    }

    function toCsv(entries) {
        const allLangs = new Set();
        entries.forEach(e => Object.keys(e.languages || {}).forEach(l => allLangs.add(l)));
        const langs = [...allLangs].sort();

        const baseCols = ['id', 'visible', 'date', 'showDate', 'hideDate', 'linkType', 'link', 'entryHasImg', 'hasImgInContent', 'customLink', 'customMeta', 'productsCount', 'relatedProducts', 'categories', 'zones', 'imagesCount'];
        const langCols = ['title', 'description', 'longDescription', 'translationFlag', 'meta', 'metaTitle', 'metaDescription', 'metaKeyword', 'urlBlogRadio', 'blogUrl', 'urlNewsRadio', 'newsUrl', 'canonicalBlogRadio', 'canonicalBlog', 'canonicalNewsRadio', 'canonicalNews'];

        const headers = [...baseCols];
        for (const lang of langs) {
            for (const c of langCols) headers.push(c + '_' + lang);
        }

        const lines = [headers.map(csvEscape).join(';')];
        for (const e of entries) {
            const row = [
                e.id, e.visible, e.date, e.showDate, e.hideDate, e.linkType, e.link,
                e.entryHasImg, e.hasImgInContent, e.customLink, e.customMeta,
                (e.relatedProducts || []).length,
                (e.relatedProducts || []).join(','),
                (e.categories || []).join(','),
                (e.zones || []).join(','),
                (e.images || []).length
            ];
            for (const lang of langs) {
                const l = (e.languages || {})[lang] || {};
                for (const c of langCols) row.push(l[c]);
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

    function downloadEntries(entries, format) {
        const stem = fileNameStem();
        if (format === 'json') {
            downloadBlob(JSON.stringify(entries, null, 2), stem + '.json', 'application/json;charset=utf-8');
        } else if (format === 'csv') {
            downloadBlob(toCsv(entries), stem + '.csv', 'text/csv;charset=utf-8');
        } else if (format === 'xml') {
            downloadBlob(toXml(entries), stem + '.xml', 'application/xml;charset=utf-8');
        }
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
        paginator.appendChild(wrap);

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
