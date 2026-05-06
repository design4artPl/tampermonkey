// ==UserScript==
// @name         ShopWay Description Exporter
// @namespace    https://poscielone.pl/
// @version      1.2
// @description  Szybki eksport tylko opisow produktow (iframe + odczyt z CKEditor/TinyMCE dla HTML)
// @author       Claude
// @match        https://poscielone.pl/admin/product*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var STORAGE_KEY = 'shopway_desc_export_progress';
    var AUTO_SAVE_EVERY = 50;        // co ile produktow zapis postepu
    var AUTO_EXPORT_EVERY = 1000;    // co ile produktow czesciowy CSV
    var MAX_RETRIES = 2;
    var IFRAME_LOAD_WAIT = 2500;     // ms po onload iframe - czas na inicjalizacje CKEditor/TinyMCE
    var IFRAME_TIMEOUT = 20000;      // ms - hard timeout iframe
    var activeIframes = 0;

    var isExporting = false;
    var shouldStop = false;
    var exportedProducts = [];
    var failedProducts = [];
    var successCount = 0;
    var errorCount = 0;
    var lastSavedCount = 0;
    var lastExportedCount = 0;

    var logMessages = [];
    var MAX_LOG = 80;

    // ===== LOG =====
    function log(type, message, productId) {
        var time = new Date().toLocaleTimeString('pl-PL');
        var prefix = productId ? '[' + productId + '] ' : '';
        logMessages.unshift({ type: type, message: time + ' ' + prefix + message });
        if (logMessages.length > MAX_LOG) logMessages.pop();
        updateLogPanel();
        if (type === 'error') console.error('[DescExporter]', prefix + message);
    }

    function updateLogPanel() {
        var panel = document.getElementById('desc-log-content');
        if (!panel) return;
        panel.innerHTML = logMessages.slice(0, 30).map(function(e) {
            var color = e.type === 'error' ? '#e74c3c' :
                        e.type === 'warn' ? '#f39c12' :
                        e.type === 'success' ? '#27ae60' : '#bdc3c7';
            return '<div style="color:' + color + ';font-size:10px;border-bottom:1px solid #34495e;padding:2px 0;">' + escapeHtml(e.message) + '</div>';
        }).join('');
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        });
    }

    // ===== PERSYSTENCJA =====
    function saveProgress(remainingIds) {
        var data = {
            timestamp: new Date().toISOString(),
            products: exportedProducts,
            remainingIds: remainingIds || [],
            successCount: successCount,
            errorCount: errorCount
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            lastSavedCount = exportedProducts.length;
        } catch (e) {
            log('error', 'localStorage pelny - eksport awaryjny i czyszczenie pamieci');
            if (exportedProducts.length > 0) {
                exportToCSV(exportedProducts, '_awaryjny_' + Date.now());
                exportedProducts = [];
            }
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    timestamp: data.timestamp,
                    products: [],
                    remainingIds: data.remainingIds,
                    successCount: data.successCount,
                    errorCount: data.errorCount,
                    note: 'Dane wyeksportowane awaryjnie do CSV'
                }));
            } catch (e2) {
                log('error', 'Krytyczny blad zapisu: ' + e2.message);
            }
        }
    }

    function loadProgress() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function clearProgress() {
        localStorage.removeItem(STORAGE_KEY);
        lastSavedCount = 0;
        lastExportedCount = 0;
    }

    // ===== IFRAME LOADER =====
    // Iframe potrzebny bo opisy doladowuja sie przez JS - sam fetch HTML zwraca puste textareas.
    // Bez klikania zakladek (vs v3.6 ktory klika 4: Zdjecia/Akcesoria/Podobne/Cross) - 3-5x szybsze.
    function fetchProductDescription(productId) {
        return new Promise(function(resolve) {
            var startTime = Date.now();
            var iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;left:-3000px;top:0;width:1280px;height:720px;opacity:0.01;border:0;';
            document.body.appendChild(iframe);
            activeIframes++;

            var resolved = false;
            var cleanedUp = false;

            function cleanup() {
                if (cleanedUp) return;
                cleanedUp = true;
                activeIframes = Math.max(0, activeIframes - 1);
                try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (e) {}
            }

            var timeout = setTimeout(function() {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve({ id: productId, error: 'Timeout po ' + Math.round((Date.now() - startTime) / 1000) + 's' });
            }, IFRAME_TIMEOUT);

            iframe.onload = function() {
                setTimeout(function() {
                    if (resolved) return;
                    try {
                        var doc = iframe.contentDocument || iframe.contentWindow.document;
                        var win = iframe.contentWindow;
                        var data = {
                            id: productId,
                            nazwa: getInput(doc, 'basic_pane[language_data][1][name]'),
                            opis_krotki: getRichTextValue(win, doc, 'description_pane[language_data][1][shortdescription]'),
                            opis_dlugi: getRichTextValue(win, doc, 'description_pane[language_data][1][description]'),
                            opis_dodatkowy: getRichTextValue(win, doc, 'description_pane[language_data][1][longdescription]')
                        };
                        resolved = true;
                        clearTimeout(timeout);
                        cleanup();
                        resolve(data);
                    } catch (e) {
                        if (resolved) return;
                        resolved = true;
                        clearTimeout(timeout);
                        cleanup();
                        resolve({ id: productId, error: 'Iframe access: ' + e.message });
                    }
                }, IFRAME_LOAD_WAIT);
            };

            iframe.onerror = function() {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                cleanup();
                resolve({ id: productId, error: 'Iframe load error' });
            };

            iframe.src = 'https://poscielone.pl/admin/product/edit/' + productId;
        });
    }

    function getInput(doc, name) {
        var el = doc.querySelector('input[name="' + name + '"]');
        return el ? (el.value || el.getAttribute('value') || '') : '';
    }

    // Pobiera HTML opisu - probuje kolejno: CKEditor 4, CKEditor 5, TinyMCE, textarea.value, textarea.innerHTML
    function getRichTextValue(win, doc, name) {
        // CKEditor 4 - najczestszy w starszych panelach
        try {
            if (win.CKEDITOR && win.CKEDITOR.instances) {
                for (var key in win.CKEDITOR.instances) {
                    var inst = win.CKEDITOR.instances[key];
                    var elName = inst && inst.element && inst.element.$ && inst.element.$.name;
                    if (elName === name || inst.name === name) {
                        var html = inst.getData();
                        if (html) return html;
                    }
                }
            }
        } catch (e) {}

        // TinyMCE
        try {
            if (win.tinymce && win.tinymce.editors) {
                for (var i = 0; i < win.tinymce.editors.length; i++) {
                    var ed = win.tinymce.editors[i];
                    var tn = ed.targetElm && ed.targetElm.name;
                    if (tn === name || ed.id === name) {
                        var html2 = ed.getContent();
                        if (html2) return html2;
                    }
                }
            }
        } catch (e) {}

        // Fallback: textarea.value (zwykle ma HTML markup z initial state)
        var el = doc.querySelector('textarea[name="' + name + '"]');
        if (!el) return '';
        var v = el.value;
        if (v && v.length > 0) return v;
        // Ostatecznie innerHTML zdekodowany (encje HTML)
        var inner = el.innerHTML;
        if (inner && inner.length > 0) {
            var ta = document.createElement('textarea');
            ta.innerHTML = inner;
            return ta.value;
        }
        return '';
    }

    function isValidProduct(data) {
        if (!data || data.error) return false;
        return !!(data.nazwa || data.opis_krotki || data.opis_dlugi || data.opis_dodatkowy);
    }

    // ===== ID COLLECTION =====
    function collectProductIds(mode, count, specificIds, idRange) {
        if (mode === 'ids') {
            return Promise.resolve(
                specificIds.split(/[,\s\n]+/)
                    .map(function(id) { return id.trim(); })
                    .filter(function(id) { return id && /^\d+$/.test(id); })
            );
        }

        if (mode === 'range') {
            var parts = (idRange || '').split('-');
            var from = parseInt(parts[0], 10);
            var to = parseInt(parts[1], 10);
            if (isNaN(from) || isNaN(to)) return Promise.resolve([]);
            var ids = [];
            for (var i = Math.min(from, to); i <= Math.max(from, to); i++) {
                ids.push(String(i));
            }
            return Promise.resolve(ids);
        }

        // Tryby 'all' / 'count' - paginacja datagrid
        return collectFromDatagrid(mode, count);
    }

    async function collectFromDatagrid(mode, count) {
        var ids = [];
        if (window.location.href.indexOf('/admin/product/edit') !== -1) {
            log('error', 'Aby zbierac z listy, otworz /admin/product/list');
            return ids;
        }

        var firstBtn = document.querySelector('.GF_Datagrid_go_to_first');
        if (firstBtn) {
            firstBtn.click();
            await sleep(2000);
        }

        var collecting = true;
        while (collecting && !shouldStop) {
            var rows = document.querySelectorAll('.GF_Datagrid .body tbody tr');
            rows.forEach(function(row) {
                var idEl = row.querySelector('.GF_Datagrid_Row_Id');
                if (idEl) {
                    var id = idEl.textContent.trim();
                    if (id && ids.indexOf(id) === -1) ids.push(id);
                }
            });

            if (mode === 'count' && ids.length >= count) {
                return ids.slice(0, count);
            }

            var totalEl = document.querySelector('.GF_Datagrid_records_total');
            var toEl = document.querySelector('.GF_Datagrid_records_to');
            var recordsTotal = totalEl ? parseInt(totalEl.textContent, 10) : 0;
            var recordsTo = toEl ? parseInt(toEl.textContent, 10) : 0;

            if (recordsTo < recordsTotal) {
                var nextBtn = document.querySelector('.GF_Datagrid_go_to_next');
                if (nextBtn) {
                    nextBtn.click();
                    await sleep(1500);
                    updateStatus('Zbieranie ID: ' + ids.length + '/' + recordsTotal + '...');
                } else {
                    collecting = false;
                }
            } else {
                collecting = false;
            }
        }
        return ids;
    }

    // ===== EXPORT FLOW =====
    async function startExport() {
        if (isExporting) return;

        var mode = document.getElementById('desc-mode').value;
        var count = parseInt(document.getElementById('desc-count').value, 10) || 10;
        var ids = document.getElementById('desc-ids').value;
        var range = document.getElementById('desc-range').value;
        var parallel = clamp(parseInt(document.getElementById('desc-parallel').value, 10) || 5, 1, 15);

        isExporting = true;
        shouldStop = false;
        exportedProducts = [];
        failedProducts = [];
        successCount = 0;
        errorCount = 0;
        lastSavedCount = 0;
        lastExportedCount = 0;

        toggleButtons(true);
        document.getElementById('desc-resume').classList.add('hidden');

        log('info', '=== START EKSPORTU OPISOW ===');
        updateStatus('Zbieranie ID produktow...');

        var productIds = await collectProductIds(mode, count, ids, range);
        if (!productIds || productIds.length === 0) {
            log('error', 'Brak ID produktow do pobrania');
            updateStatus('Brak produktow');
            return finishExport();
        }

        log('info', 'Znaleziono ' + productIds.length + ' ID, rownolegle: ' + parallel);
        await processIds(productIds, parallel, 0);

        if (exportedProducts.length > 0 && !shouldStop) {
            exportToCSV(exportedProducts, '_final');
            clearProgress();
        }
        finishExport();
    }

    async function processIds(productIds, parallel, startOffset) {
        var totalToFetch = productIds.length;
        var alreadyDone = exportedProducts.length;
        var startTime = Date.now();
        var fetchedThisSession = 0;

        for (var i = 0; i < productIds.length && !shouldStop; i += parallel) {
            var batch = productIds.slice(i, Math.min(i + parallel, productIds.length));
            var batchPromises = batch.map(function(id) { return fetchProductDescription(id); });

            var results;
            try {
                results = await Promise.all(batchPromises);
            } catch (e) {
                log('error', 'Promise.all blad: ' + e.message);
                results = batch.map(function(id) { return { id: id, error: 'Batch failed' }; });
            }

            results.forEach(function(data, idx) {
                if (isValidProduct(data)) {
                    exportedProducts.push(data);
                    successCount++;
                } else {
                    failedProducts.push({ id: batch[idx], data: data, retries: 0 });
                    errorCount++;
                    if (errorCount <= 10 || errorCount % 50 === 0) {
                        log('warn', 'Blad: ' + (data.error || 'puste pola'), batch[idx]);
                    }
                }
            });

            fetchedThisSession += batch.length;
            var elapsed = (Date.now() - startTime) / 1000;
            var rate = elapsed > 0 ? fetchedThisSession / elapsed : 0;
            var remaining = totalToFetch - (i + batch.length);
            var eta = rate > 0 ? Math.round(remaining / rate) : 0;

            updateStats(rate);
            updateProgress(alreadyDone + i + batch.length, alreadyDone + totalToFetch);
            updateStatus('Pobrano ' + (i + batch.length) + '/' + totalToFetch +
                         ' | tempo: ' + rate.toFixed(1) + '/s | ETA: ' + formatTime(eta));

            if (exportedProducts.length - lastSavedCount >= AUTO_SAVE_EVERY) {
                saveProgress(productIds.slice(i + batch.length));
            }

            if (exportedProducts.length - lastExportedCount >= AUTO_EXPORT_EVERY) {
                exportToCSV(exportedProducts, '_czesc' + Math.floor(exportedProducts.length / AUTO_EXPORT_EVERY));
                lastExportedCount = exportedProducts.length;
            }
        }

        // RETRY
        if (!shouldStop && failedProducts.length > 0) {
            log('info', 'Ponawiam ' + failedProducts.length + ' nieudanych...');
            updateStatus('Retry ' + failedProducts.length + ' produktow...');
            var retryParallel = Math.max(1, Math.floor(parallel / 2));
            var retryList = failedProducts.filter(function(p) { return p.retries < MAX_RETRIES; });
            failedProducts = [];

            for (var r = 0; r < retryList.length && !shouldStop; r += retryParallel) {
                var rbatch = retryList.slice(r, r + retryParallel);
                var rPromises = rbatch.map(function(item) {
                    item.retries++;
                    return fetchProductDescription(item.id);
                });
                var rResults = await Promise.all(rPromises);

                rResults.forEach(function(data, idx) {
                    if (isValidProduct(data)) {
                        exportedProducts.push(data);
                        successCount++;
                        errorCount--;
                    } else if (rbatch[idx].retries < MAX_RETRIES) {
                        failedProducts.push(rbatch[idx]);
                    } else {
                        data.error = data.error || 'Po ' + MAX_RETRIES + ' probach';
                        exportedProducts.push(data);
                    }
                });
                updateStats();
            }
        }

        if (shouldStop) {
            saveProgress(productIds.slice(i));
            log('warn', 'Zatrzymano. Postep zapisany.');
            updateStatus('Zatrzymano. OK: ' + successCount + ', Bledy: ' + errorCount);
        } else {
            log('success', '=== ZAKONCZONO. OK: ' + successCount + ', Bledy: ' + errorCount + ' ===');
        }
    }

    async function resumeExport() {
        if (isExporting) return;
        var saved = loadProgress();
        if (!saved) return;

        isExporting = true;
        shouldStop = false;
        exportedProducts = saved.products || [];
        failedProducts = [];
        successCount = saved.successCount || exportedProducts.length;
        errorCount = saved.errorCount || 0;
        lastSavedCount = exportedProducts.length;
        lastExportedCount = exportedProducts.length;

        var parallel = clamp(parseInt(document.getElementById('desc-parallel').value, 10) || 5, 1, 15);
        var remaining = saved.remainingIds || [];

        toggleButtons(true);
        document.getElementById('desc-resume').classList.add('hidden');

        log('info', 'Wznawiam: ' + exportedProducts.length + ' gotowych, ' + remaining.length + ' do pobrania');
        await processIds(remaining, parallel, 0);

        if (exportedProducts.length > 0 && !shouldStop) {
            exportToCSV(exportedProducts, '_final');
            clearProgress();
        }
        finishExport();
    }

    function exportSaved() {
        var saved = loadProgress();
        if (!saved || !saved.products || saved.products.length === 0) {
            log('warn', 'Brak zapisanych produktow');
            return;
        }
        exportToCSV(saved.products, '_z_zapisu');
    }

    function finishExport() {
        isExporting = false;
        toggleButtons(false);
        if (exportedProducts.length > 0) {
            updateStatus('Gotowe! OK: ' + successCount + ', Bledy: ' + errorCount);
        }
        checkSavedProgress();
    }

    // ===== UI =====
    function createUI() {
        if (document.getElementById('desc-export-ui')) return;

        var ui = document.createElement('div');
        ui.id = 'desc-export-ui';
        ui.innerHTML = ''
            + '<style>'
            + '#desc-export-ui{position:fixed;top:10px;right:10px;background:#2c3e50;color:#ecf0f1;padding:16px;border-radius:8px;z-index:10000;font-family:Arial,sans-serif;font-size:13px;box-shadow:0 4px 15px rgba(0,0,0,0.3);width:340px;box-sizing:border-box;}'
            + '#desc-export-ui h3{margin:0 0 10px 0;color:#2ecc71;font-size:15px;}'
            + '#desc-export-ui label{display:block;margin:7px 0 3px 0;font-weight:bold;font-size:12px;}'
            + '#desc-export-ui input,#desc-export-ui select,#desc-export-ui textarea{width:100%;padding:6px;border:1px solid #34495e;border-radius:4px;background:#34495e;color:#ecf0f1;box-sizing:border-box;font-size:12px;}'
            + '#desc-export-ui textarea{resize:vertical;min-height:50px;font-family:monospace;}'
            + '#desc-export-ui button{margin-top:8px;padding:7px 12px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;margin-right:5px;font-size:12px;}'
            + '#desc-export-ui .btn-start{background:#27ae60;color:white;}'
            + '#desc-export-ui .btn-stop{background:#c0392b;color:white;}'
            + '#desc-export-ui .btn-close{background:#7f8c8d;color:white;float:right;padding:3px 7px;font-size:11px;margin:0;}'
            + '#desc-export-ui .btn-secondary{background:#3498db;color:white;}'
            + '#desc-export-ui .btn-warn{background:#e67e22;color:white;}'
            + '#desc-export-ui .status{margin-top:10px;padding:7px;background:#34495e;border-radius:4px;min-height:18px;word-wrap:break-word;font-size:12px;}'
            + '#desc-export-ui .progress-bar{width:100%;height:14px;background:#34495e;border-radius:4px;margin-top:6px;overflow:hidden;}'
            + '#desc-export-ui .progress-fill{height:100%;background:#2ecc71;width:0%;transition:width 0.3s;}'
            + '#desc-export-ui .hidden{display:none;}'
            + '#desc-export-ui .info{font-size:10px;color:#95a5a6;margin-top:3px;}'
            + '#desc-export-ui .stats{margin-top:6px;font-size:11px;}'
            + '</style>'
            + '<button class="btn-close" id="desc-close">X</button>'
            + '<h3>📝 Description Exporter v1.2 (HTML)</h3>'

            + '<label>Tryb:</label>'
            + '<select id="desc-mode">'
            +   '<option value="all">Wszystkie z listy (paginacja)</option>'
            +   '<option value="count">Pierwsze N z listy</option>'
            +   '<option value="ids">Konkretne ID (wklej liste)</option>'
            +   '<option value="range">Zakres ID (od-do)</option>'
            + '</select>'

            + '<div id="desc-count-input" class="hidden">'
            +   '<label>Ilosc:</label><input type="number" id="desc-count" value="10" min="1">'
            + '</div>'

            + '<div id="desc-ids-input" class="hidden">'
            +   '<label>ID (przecinki/spacje/nowe linie):</label>'
            +   '<textarea id="desc-ids" placeholder="np. 39736, 39737&#10;39738"></textarea>'
            + '</div>'

            + '<div id="desc-range-input" class="hidden">'
            +   '<label>Zakres ID:</label>'
            +   '<input type="text" id="desc-range" placeholder="np. 1000-50000">'
            + '</div>'

            + '<label>Rownolegle (1-30):</label>'
            + '<input type="number" id="desc-parallel" value="5" min="1" max="15">'
            + '<div class="info">5 jest dobre dla iframe. Max 15 - kazde iframe ladiuje pelna strone.</div>'

            + '<div>'
            +   '<button class="btn-start" id="desc-start">▶ Start</button>'
            +   '<button class="btn-stop hidden" id="desc-stop">■ Stop</button>'
            + '</div>'

            + '<div id="desc-resume" class="hidden" style="margin-top:10px;border-top:1px solid #34495e;padding-top:10px;">'
            +   '<div class="info" style="color:#f1c40f;white-space:pre-line;" id="desc-saved-info"></div>'
            +   '<button class="btn-warn" id="desc-resume-btn">Wznow</button>'
            +   '<button class="btn-secondary" id="desc-export-saved">Eksportuj CSV</button>'
            +   '<button class="btn-close" id="desc-clear-saved" style="float:none;">Wyczysc</button>'
            + '</div>'

            + '<div class="status" id="desc-status">Gotowy</div>'
            + '<div class="progress-bar"><div class="progress-fill" id="desc-progress"></div></div>'

            + '<div class="stats">'
            +   '<span style="color:#27ae60;">OK: <span id="desc-ok">0</span></span> | '
            +   '<span style="color:#e74c3c;">Bledy: <span id="desc-err">0</span></span> | '
            +   '<span style="color:#3498db;">Tempo: <span id="desc-rate">0</span>/s</span> | '
            +   '<span style="color:#9b59b6;">Iframes: <span id="desc-iframes">0</span></span>'
            + '</div>'

            + '<div style="margin-top:8px;">'
            +   '<label style="margin:0;display:inline;font-size:11px;">Logi:</label>'
            +   '<button id="desc-clear-log" class="btn-close" style="float:right;">Wyczysc</button>'
            + '</div>'
            + '<div id="desc-log-content" style="margin-top:4px;padding:4px;background:#1a252f;border-radius:4px;height:130px;overflow-y:auto;font-family:monospace;">'
            +   '<div style="color:#95a5a6;font-size:10px;">Czekam...</div>'
            + '</div>';

        document.body.appendChild(ui);

        document.getElementById('desc-close').addEventListener('click', function() {
            ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
        });
        document.getElementById('desc-mode').addEventListener('change', function() {
            document.getElementById('desc-count-input').classList.toggle('hidden', this.value !== 'count');
            document.getElementById('desc-ids-input').classList.toggle('hidden', this.value !== 'ids');
            document.getElementById('desc-range-input').classList.toggle('hidden', this.value !== 'range');
        });
        document.getElementById('desc-start').addEventListener('click', startExport);
        document.getElementById('desc-stop').addEventListener('click', function() {
            shouldStop = true;
            updateStatus('Zatrzymywanie po biezacej partii...');
        });
        document.getElementById('desc-clear-log').addEventListener('click', function() {
            logMessages = [];
            updateLogPanel();
        });
        document.getElementById('desc-resume-btn').addEventListener('click', resumeExport);
        document.getElementById('desc-export-saved').addEventListener('click', exportSaved);
        document.getElementById('desc-clear-saved').addEventListener('click', function() {
            clearProgress();
            checkSavedProgress();
            log('info', 'Postep wyczyszczony');
        });

        checkSavedProgress();
    }

    function toggleButtons(running) {
        document.getElementById('desc-start').classList.toggle('hidden', running);
        document.getElementById('desc-stop').classList.toggle('hidden', !running);
    }

    function updateStatus(msg) {
        var el = document.getElementById('desc-status');
        if (el) el.textContent = msg;
    }

    function updateProgress(current, total) {
        var fill = document.getElementById('desc-progress');
        if (fill && total > 0) {
            fill.style.width = Math.min(100, (current / total * 100)) + '%';
        }
    }

    function updateStats(rate) {
        var ok = document.getElementById('desc-ok');
        var err = document.getElementById('desc-err');
        var rateEl = document.getElementById('desc-rate');
        var iframesEl = document.getElementById('desc-iframes');
        if (ok) ok.textContent = successCount;
        if (err) err.textContent = errorCount;
        if (rateEl && rate !== undefined) rateEl.textContent = rate.toFixed(1);
        if (iframesEl) iframesEl.textContent = activeIframes;
    }

    function checkSavedProgress() {
        var saved = loadProgress();
        var box = document.getElementById('desc-resume');
        if (!box) return;
        if (saved && (saved.products && saved.products.length > 0 || saved.remainingIds && saved.remainingIds.length > 0)) {
            var date = new Date(saved.timestamp).toLocaleString('pl-PL');
            var info = 'Zapis ' + date + '\n'
                     + '  Pobranych: ' + (saved.products ? saved.products.length : 0)
                     + ' (OK: ' + (saved.successCount || 0) + ', Bledy: ' + (saved.errorCount || 0) + ')\n'
                     + '  Pozostalo: ' + (saved.remainingIds ? saved.remainingIds.length : 0);
            if (saved.note) info += '\n  ' + saved.note;
            document.getElementById('desc-saved-info').textContent = info;
            box.classList.remove('hidden');
        } else {
            box.classList.add('hidden');
        }
    }

    // ===== CSV =====
    function exportToCSV(products, suffix) {
        suffix = suffix || '';
        var headers = ['ID', 'Nazwa', 'Opis krotki (HTML)', 'Opis dlugi (HTML)', 'Opis dodatkowe info (HTML)', 'Status'];

        function escape(v) {
            if (v == null) return '';
            var s = String(v);
            if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        }

        var lines = [headers.join(';')];
        products.forEach(function(p) {
            var status;
            if (p.error) status = 'BLAD: ' + p.error;
            else if (p.opis_krotki || p.opis_dlugi || p.opis_dodatkowy) status = 'OK';
            else if (p.nazwa) status = 'PUSTE_OPISY';
            else status = 'PUSTY';

            lines.push([
                p.id,
                p.nazwa || '',
                p.opis_krotki || '',
                p.opis_dlugi || '',
                p.opis_dodatkowy || '',
                status
            ].map(escape).join(';'));
        });

        var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'opisy_produktow_' + new Date().toISOString().slice(0, 10) + suffix + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function() { URL.revokeObjectURL(link.href); }, 1000);
        log('success', 'CSV: ' + products.length + ' produktow' + (suffix ? ' (' + suffix + ')' : ''));
    }

    // ===== HELPERS =====
    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
    function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
    function formatTime(s) {
        if (s < 60) return s + 's';
        if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
        return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
    }

    // ===== INIT =====
    function init() {
        if (document.body) {
            createUI();
        } else {
            setTimeout(init, 500);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
