// ==UserScript==
// @name         ShopWay Category Exporter
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Szybki eksport kategorii wszystkich towarow z panelu ShopWay (fetch + xajax, bez iframe)
// @author       Claude
// @match        https://poscielone.pl/admin/product*
// @match        https://febetrade.pl/admin/product*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    var ORIGIN = window.location.origin;
    var isRunning = false;
    var shouldStop = false;
    var logMessages = [];

    // catMap: { id: { name, parent } } - budowane raz przez crawl drzewa
    var catMap = {};

    // ========== LOG ==========
    function log(type, msg) {
        var time = new Date().toLocaleTimeString('pl-PL');
        logMessages.unshift({ type: type, text: '[' + time + '] ' + msg });
        if (logMessages.length > 200) logMessages.pop();
        var panel = document.getElementById('cat-log');
        if (panel) {
            panel.innerHTML = logMessages.slice(0, 100).map(function(e) {
                var color = e.type === 'error' ? '#e74c3c' : e.type === 'ok' ? '#2ecc71' : e.type === 'warn' ? '#f39c12' : '#bdc3c7';
                return '<div style="color:' + color + ';">' + e.text + '</div>';
            }).join('');
        }
    }
    function status(msg) {
        var el = document.getElementById('cat-status');
        if (el) el.textContent = msg;
    }
    function setProgress(done, total) {
        var bar = document.getElementById('cat-progress-fill');
        if (bar) bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    }

    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    function decodeJsonStr(s) {
        try { return JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch (e) { return s; }
    }

    // ========== ZBIERANIE ID PRODUKTOW ==========
    async function collectProductIdsAll() {
        var ids = [];
        var firstBtn = document.querySelector('.GF_Datagrid_go_to_first');
        if (firstBtn) firstBtn.click();
        await sleep(1500);

        var totalEl = document.querySelector('.GF_Datagrid_records_total');
        var total = totalEl ? parseInt(totalEl.textContent) : 0;
        if (total) log('info', 'Lacznie produktow w sklepie: ' + total);

        var page = 0;
        while (!shouldStop) {
            page++;
            var rows = document.querySelectorAll('.GF_Datagrid .body tbody tr');
            rows.forEach(function(row) {
                var idEl = row.querySelector('.GF_Datagrid_Row_Id');
                if (idEl) {
                    var id = idEl.textContent.trim();
                    if (id && ids.indexOf(id) === -1) ids.push(id);
                }
            });
            log('info', 'Strona ' + page + ': zebrano ' + ids.length + (total ? '/' + total : '') + ' ID');
            status('Zbieranie ID: ' + ids.length + (total ? '/' + total : '') + '...');

            var recTotal = parseInt((document.querySelector('.GF_Datagrid_records_total') || {}).textContent);
            var recTo = parseInt((document.querySelector('.GF_Datagrid_records_to') || {}).textContent);
            if (recTo < recTotal) {
                var nextBtn = document.querySelector('.GF_Datagrid_go_to_next');
                if (nextBtn) { nextBtn.click(); await sleep(1500); }
                else break;
            } else break;
        }
        return ids;
    }

    function parseIdsInput(text) {
        return text.split(/[,\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return /^\d+$/.test(s); });
    }
    function rangeIds(from, to) {
        var ids = [];
        for (var i = from; i <= to; i++) ids.push(String(i));
        return ids;
    }

    // ========== XAJAX: pobranie xjxfun + URL referencyjny ==========
    async function initXajax(sampleProductId) {
        var url = ORIGIN + '/admin/product/edit/' + sampleProductId;
        var res = await fetch(url, { credentials: 'include' });
        var html = await res.text();
        // Pierwszy GetChildren = glowne drzewo kategorii
        var m = /xajax_GetChildren_\d+\s*=\s*function\(\)\s*\{\s*return\s+xajax\.request\(\s*\{\s*xjxfun:\s*'([^']+)'/.exec(html);
        if (!m) throw new Error('Nie znaleziono xjxfun dla drzewa kategorii w ' + url);
        return { xjxfun: m[1], url: url };
    }

    async function getChildren(parentId, xjxfun, url) {
        var arg = '<xjxobj><e><k>parent</k><v>' + parentId + '</v></e></xjxobj>';
        var body = 'xjxfun=' + encodeURIComponent(xjxfun) +
                   '&xjxr=' + Date.now() +
                   '&xjxargs[]=' + encodeURIComponent(arg) +
                   '&xjxargs[]=GCallback.Trigger_0';
        var res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: body
        });
        var txt = await res.text();
        var jm = /Trigger_0\((\{[\s\S]*\})\)\s*\]\]>/.exec(txt) || /Trigger_0\((\{[\s\S]*?\})\)/.exec(txt);
        if (!jm) return {};
        try {
            var obj = JSON.parse(jm[1]);
            return obj.children || {};
        } catch (e) { return {}; }
    }

    // BFS crawl calego drzewa kategorii -> catMap
    async function buildCategoryMap(xjxfun, url) {
        catMap = {};
        var queue = ['0'];
        var visited = {};
        var calls = 0;
        while (queue.length && !shouldStop) {
            // przetwarzaj poziom rownolegle (do 6 naraz)
            var batch = queue.splice(0, 6);
            var results = await Promise.all(batch.map(function(pid) {
                return getChildren(pid, xjxfun, url).then(function(ch) { return { pid: pid, ch: ch }; });
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
            status('Buduje mape kategorii: ' + Object.keys(catMap).length + ' kategorii...');
        }
        log('ok', 'Mapa kategorii gotowa: ' + Object.keys(catMap).length + ' kategorii (' + calls + ' zapytan xajax)');
    }

    // Pelna sciezka kategorii po ID (chodzenie po rodzicach)
    function pathOf(id) {
        var parts = [];
        var cur = id;
        var guard = 0;
        while (cur && catMap[cur] && guard++ < 25) {
            parts.unshift(catMap[cur].name);
            cur = catMap[cur].parent;
        }
        if (parts.length === 0) return '#' + id; // brak w mapie - zwroc surowe ID
        return parts.join('\\');
    }

    // Z listy przypisanych ID -> tylko liscie (najglebsze), kazdy jako pelna sciezka
    function buildCategoryPaths(assignedIds) {
        if (!assignedIds.length) return '';
        var leaves = assignedIds.filter(function(id) {
            // liscem jest id ktore NIE jest rodzicem zadnego innego przypisanego id
            return !assignedIds.some(function(other) {
                return other !== id && catMap[other] && catMap[other].parent === id;
            });
        });
        var paths = leaves.map(pathOf);
        // unikalne
        var seen = {}, uniq = [];
        paths.forEach(function(p) { if (!seen[p]) { seen[p] = true; uniq.push(p); } });
        return uniq.join('\n');
    }

    // ========== POBRANIE DANYCH JEDNEGO PRODUKTU (raw fetch) ==========
    async function fetchProduct(id) {
        var url = ORIGIN + '/admin/product/edit/' + id;
        try {
            var res = await fetch(url, { credentials: 'include', redirect: 'follow' });
            // jesli przekierowano poza edit (produkt nie istnieje) - pomijamy
            if (res.url.indexOf('/product/edit/') === -1) return { id: id, missing: true };
            var html = await res.text();

            var nameM = /"basic_pane":\{"language_data":\{"name":\{"1":"([^"]*)"/.exec(html);
            var name = nameM ? decodeJsonStr(nameM[1]) : '';

            var catM = /"category_pane":\{"category":(\[[^\]]*\]|"")/.exec(html);
            var assigned = [];
            if (catM && catM[1].charAt(0) === '[') {
                try { assigned = JSON.parse(catM[1]).map(String); } catch (e) {}
            }

            return { id: id, name: name, categories: buildCategoryPaths(assigned), catCount: assigned.length };
        } catch (e) {
            return { id: id, error: e.message };
        }
    }

    // Pula rownoleglych zadan
    async function runPool(items, worker, concurrency, onProgress) {
        var results = new Array(items.length);
        var idx = 0, done = 0;
        async function runner() {
            while (idx < items.length && !shouldStop) {
                var i = idx++;
                results[i] = await worker(items[i], i);
                done++;
                if (onProgress) onProgress(done, items.length);
            }
        }
        var runners = [];
        for (var c = 0; c < concurrency; c++) runners.push(runner());
        await Promise.all(runners);
        return results;
    }

    // ========== CSV ==========
    function downloadCSV(rows) {
        var esc = function(v) {
            if (v === null || v === undefined) return '';
            var s = String(v);
            if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        };
        var csv = ['ID', 'Nazwa', 'Kategorie'].join(';') + '\n';
        rows.forEach(function(r) {
            csv += [r.id, r.name, r.categories].map(esc).join(';') + '\n';
        });
        var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        var url = URL.createObjectURL(blob);
        a.href = url;
        a.download = 'kategorie_towarow_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    // ========== GLOWNA AKCJA ==========
    async function run() {
        if (isRunning) return;
        isRunning = true;
        shouldStop = false;
        logMessages = [];

        document.getElementById('cat-start').classList.add('hidden');
        document.getElementById('cat-stop').classList.remove('hidden');

        try {
            var mode = document.getElementById('cat-mode').value;
            var concurrency = parseInt(document.getElementById('cat-concurrency').value) || 10;

            log('info', '=== START eksportu kategorii v1.0 ===');

            // 1. Lista ID
            var ids = [];
            if (mode === 'all') {
                status('Zbieram liste produktow...');
                ids = await collectProductIdsAll();
            } else if (mode === 'range') {
                var from = parseInt(document.getElementById('cat-from').value);
                var to = parseInt(document.getElementById('cat-to').value);
                if (isNaN(from) || isNaN(to) || from > to) { log('error', 'Nieprawidlowy zakres ID'); throw new Error('zakres'); }
                ids = rangeIds(from, to);
            } else {
                ids = parseIdsInput(document.getElementById('cat-ids').value);
            }

            if (!ids.length) { log('error', 'Brak ID produktow do pobrania'); status('Brak produktow'); return; }
            log('info', 'Do pobrania: ' + ids.length + ' produktow');

            // 2. Mapa kategorii (xajax crawl)
            status('Buduje mape kategorii...');
            log('info', 'Pobieram xjxfun i buduje mape kategorii...');
            var xa = await initXajax(ids[0]);
            log('info', 'xjxfun=' + xa.xjxfun);
            await buildCategoryMap(xa.xjxfun, xa.url);
            if (Object.keys(catMap).length === 0) log('warn', 'Mapa kategorii pusta - kategorie wyjda jako surowe ID (#id)');

            // 3. Rownolegle pobranie produktow
            status('Pobieram kategorie produktow (rownolegle x' + concurrency + ')...');
            var t0 = Date.now();
            var results = await runPool(ids, fetchProduct, concurrency, function(done, total) {
                setProgress(done, total);
                if (done % 25 === 0 || done === total) {
                    status('Pobrano ' + done + '/' + total + '...');
                }
            });

            var ok = results.filter(function(r) { return r && !r.missing && !r.error; });
            var missing = results.filter(function(r) { return r && r.missing; }).length;
            var errors = results.filter(function(r) { return r && r.error; }).length;
            var withCat = ok.filter(function(r) { return r.categories; }).length;

            var elapsed = Math.round((Date.now() - t0) / 1000);
            log('ok', 'Gotowe w ' + elapsed + 's. OK: ' + ok.length + ', z kategoriami: ' + withCat + ', brak/pominiete: ' + missing + ', bledy: ' + errors);

            // 4. CSV (tylko istniejace produkty)
            downloadCSV(ok);
            status('Zakonczono. Wyeksportowano ' + ok.length + ' produktow do CSV.');

        } catch (e) {
            log('error', 'WYJATEK: ' + e.message);
            status('Blad: ' + e.message);
        } finally {
            isRunning = false;
            document.getElementById('cat-start').classList.remove('hidden');
            document.getElementById('cat-stop').classList.add('hidden');
            setProgress(0, 1);
        }
    }

    // ========== UI ==========
    function buildUI() {
        if (document.getElementById('cat-export-ui')) return;
        var ui = document.createElement('div');
        ui.id = 'cat-export-ui';
        ui.innerHTML = [
            '<style>',
            '#cat-export-ui{position:fixed;top:10px;right:400px;background:#1e2b38;color:#ecf0f1;padding:16px;border-radius:8px;z-index:10000;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,.4);width:320px;max-width:340px;box-sizing:border-box;}',
            '#cat-export-ui h3{margin:0 0 12px;color:#1abc9c;font-size:15px;}',
            '#cat-export-ui label{display:block;margin:8px 0 3px;font-weight:bold;}',
            '#cat-export-ui select,#cat-export-ui input{width:100%;padding:6px;border:1px solid #34495e;border-radius:4px;background:#2c3e50;color:#ecf0f1;box-sizing:border-box;}',
            '#cat-export-ui button{margin-top:12px;padding:9px 16px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-right:8px;}',
            '#cat-export-ui .b-start{background:#16a085;color:#fff;}',
            '#cat-export-ui .b-stop{background:#c0392b;color:#fff;}',
            '#cat-export-ui .b-close{background:#7f8c8d;color:#fff;float:right;padding:4px 9px;margin:0;font-size:12px;}',
            '#cat-export-ui .hidden{display:none;}',
            '#cat-export-ui .info{font-size:11px;color:#95a5a6;margin-top:3px;}',
            '#cat-export-ui .pbar{width:100%;height:14px;background:#34495e;border-radius:4px;margin-top:10px;overflow:hidden;}',
            '#cat-export-ui .pfill{height:100%;width:0;background:#1abc9c;transition:width .3s;}',
            '#cat-export-ui .st{margin-top:10px;padding:8px;background:#2c3e50;border-radius:4px;min-height:18px;word-wrap:break-word;}',
            '</style>',
            '<button class="b-close" id="cat-close">X</button>',
            '<h3>Category Exporter v1.0</h3>',
            '<label>Tryb:</label>',
            '<select id="cat-mode">',
            '<option value="all">Wszystkie produkty</option>',
            '<option value="range">Zakres ID (od-do)</option>',
            '<option value="ids">Konkretne ID</option>',
            '</select>',
            '<div id="cat-range-box" class="hidden">',
            '<label>Od ID:</label><input type="number" id="cat-from" placeholder="np. 23000">',
            '<label>Do ID:</label><input type="number" id="cat-to" placeholder="np. 23999">',
            '</div>',
            '<div id="cat-ids-box" class="hidden">',
            '<label>ID (po przecinku):</label><input type="text" id="cat-ids" placeholder="23742, 23743">',
            '</div>',
            '<label>Rownolegle pobieranie:</label>',
            '<select id="cat-concurrency">',
            '<option value="5">5</option>',
            '<option value="10" selected>10 (zalecane)</option>',
            '<option value="15">15</option>',
            '<option value="20">20 (szybko, ryzyko)</option>',
            '</select>',
            '<div class="info">Pobiera tylko kategorie - duzo szybsze niz pelny eksport (bez iframe).</div>',
            '<div>',
            '<button class="b-start" id="cat-start">Pobierz kategorie</button>',
            '<button class="b-stop hidden" id="cat-stop">Zatrzymaj</button>',
            '</div>',
            '<div class="st" id="cat-status">Gotowy</div>',
            '<div class="pbar"><div class="pfill" id="cat-progress-fill"></div></div>',
            '<div style="margin-top:8px;font-size:11px;color:#7f8c8d;">Logi:</div>',
            '<div id="cat-log" style="margin-top:4px;padding:5px;background:#16212c;border-radius:4px;height:130px;overflow-y:auto;overflow-x:hidden;word-break:break-all;font-family:monospace;font-size:10px;"></div>'
        ].join('');
        document.body.appendChild(ui);

        document.getElementById('cat-close').addEventListener('click', function() { ui.remove(); });
        document.getElementById('cat-mode').addEventListener('change', function() {
            document.getElementById('cat-range-box').classList.toggle('hidden', this.value !== 'range');
            document.getElementById('cat-ids-box').classList.toggle('hidden', this.value !== 'ids');
        });
        document.getElementById('cat-start').addEventListener('click', run);
        document.getElementById('cat-stop').addEventListener('click', function() {
            shouldStop = true;
            log('warn', 'Zatrzymywanie...');
        });
    }

    // Init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }
})();
