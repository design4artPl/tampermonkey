// ==UserScript==
// @name         IdoSell Blogi — rozszerzona lista wpisów
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      0.1.0
// @description  Dodaje 4 kolumny do listy wpisów blog: liczba powiązanych towarów, własny URL, indywidualne metatagi, obrazki w treści
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
        'table.entries .blogi-num{font-weight:bold}'
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

    async function fetchEntryDetails(id, signal) {
        const cached = cacheGet(id);
        if (cached) return cached;
        const shop = new URLSearchParams(location.search).get('shop') || '1';
        const url = location.origin + '/panel/entries.php?action=edit&mode=blog&shop=' + shop + '&id=' + id;
        const r = await fetch(url, { credentials: 'include', signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();
        const data = parseEntryDoc(html);
        cacheSet(id, data);
        return data;
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
        if (!headRow || headRow.querySelector('th.blogi-col')) return;

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

    function rebuildRows() {
        const rows = document.querySelectorAll('table.entries tr[id^="tr_"]');
        rows.forEach(tr => {
            if (tr.querySelector('td.blogi-col')) return;
            const editLink = tr.querySelector('a[href*="action=edit"]');
            if (!editLink) return;
            const m = editLink.getAttribute('href').match(/[?&]id=(\d+)/);
            if (!m) return;
            tr.dataset.blogiId = m[1];

            const lastTd = tr.lastElementChild;
            for (const col of COLUMNS) {
                const td = document.createElement('td');
                td.className = 'row0 blogi-col blogi-col-' + col.key;
                td.innerHTML = '<span class="blogi-cell loading" data-col="' + col.key + '">…</span>';
                tr.insertBefore(td, lastTd);
            }
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

    function onListReload() {
        rebuildHeader();
        rebuildRows();
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
