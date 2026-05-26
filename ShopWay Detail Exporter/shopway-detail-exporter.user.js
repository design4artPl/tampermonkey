// ==UserScript==
// @name         ShopWay Detail Exporter
// @namespace    http://tampermonkey.net/
// @version      3.8
// @description  Eksport szczegolowych danych produktow z panelu ShopWay do CSV
// @author       Claude
// @match        https://poscielone.pl/admin/product*
// @match        https://febetrade.pl/admin/product*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let isExporting = false;
    let exportedProducts = [];
    let failedProducts = []; // Produkty ktore sie nie udaly
    let totalToExport = 0;
    let currentIndex = 0;
    let shouldStop = false;
    let successCount = 0;
    let errorCount = 0;

    // DIAGNOSTYKA
    let logMessages = [];
    let activeIframes = 0;
    let maxActiveIframes = 0;
    let totalLoadTime = 0;
    let loadedCount = 0;
    let timeoutCount = 0;
    let iframeErrorCount = 0;

    // WATCHDOG - wykrywanie zawieszenia
    let lastActivityTime = Date.now();
    let watchdogInterval = null;
    const WATCHDOG_TIMEOUT = 60000; // 60 sekund bez aktywnosci = zawieszenie

    const STORAGE_KEY = 'shopway_export_progress';
    const AUTO_SAVE_INTERVAL = 5; // Zapis co X produktow
    const AUTO_EXPORT_INTERVAL = 50; // Eksport czesciowy co X produktow
    const MAX_RETRIES = 2; // Ile razy ponowic probe dla nieudanych
    const MAX_LOG_MESSAGES = 100; // Ile logow trzymac w pamieci

    // IndexedDB - baza danych z duzym limitem (GB zamiast 5MB)
    const DB_NAME = 'ShopWayExporter';
    const DB_VERSION = 1;
    const DB_STORE = 'products';
    let db = null;

    // ========== SYSTEM LOGOWANIA ==========
    function log(type, message, productId) {
        var timestamp = new Date().toLocaleTimeString('pl-PL');
        var prefix = productId ? '[' + productId + '] ' : '';
        var fullMessage = timestamp + ' ' + prefix + message;

        // Dodaj do tablicy logow
        logMessages.unshift({ type: type, message: fullMessage, time: Date.now() });
        if (logMessages.length > MAX_LOG_MESSAGES) {
            logMessages.pop();
        }

        // Aktualizuj panel logow
        updateLogPanel();

        // Loguj do konsoli
        if (type === 'error') {
            console.error('[EXPORTER] ' + fullMessage);
        } else if (type === 'warn') {
            console.warn('[EXPORTER] ' + fullMessage);
        } else if (type === 'success') {
            console.log('%c[EXPORTER] ' + fullMessage, 'color: #27ae60');
        } else {
            console.log('[EXPORTER] ' + fullMessage);
        }
    }

    function updateLogPanel() {
        var logPanel = document.getElementById('log-panel-content');
        if (!logPanel) return;

        var html = logMessages.slice(0, 20).map(function(entry) {
            var color = entry.type === 'error' ? '#e74c3c' :
                        entry.type === 'warn' ? '#f39c12' :
                        entry.type === 'success' ? '#27ae60' : '#bdc3c7';
            return '<div style="color:' + color + ';font-size:10px;border-bottom:1px solid #34495e;padding:2px 0;">' + entry.message + '</div>';
        }).join('');

        logPanel.innerHTML = html;
    }

    function updateDiagnostics() {
        var diagEl = document.getElementById('diagnostics-panel');
        if (!diagEl) return;

        var avgTime = loadedCount > 0 ? Math.round(totalLoadTime / loadedCount) : 0;
        diagEl.innerHTML =
            '<b>Diagnostyka:</b><br>' +
            'Aktywne iframe: <span style="color:#3498db;">' + activeIframes + '</span> (max: ' + maxActiveIframes + ')<br>' +
            'Sredni czas ladowania: <span style="color:#27ae60;">' + avgTime + 'ms</span><br>' +
            'Timeouty: <span style="color:#e74c3c;">' + timeoutCount + '</span> | Bledy iframe: <span style="color:#e74c3c;">' + iframeErrorCount + '</span>';
    }

    function resetDiagnostics() {
        logMessages = [];
        activeIframes = 0;
        maxActiveIframes = 0;
        totalLoadTime = 0;
        loadedCount = 0;
        timeoutCount = 0;
        iframeErrorCount = 0;
        updateLogPanel();
        updateDiagnostics();
    }

    // ========== WATCHDOG - WYKRYWANIE ZAWIESZENIA ==========
    function tickWatchdog() {
        lastActivityTime = Date.now();
    }

    function startWatchdog() {
        tickWatchdog();
        if (watchdogInterval) clearInterval(watchdogInterval);
        watchdogInterval = setInterval(function() {
            var elapsed = Date.now() - lastActivityTime;
            if (elapsed > WATCHDOG_TIMEOUT && isExporting) {
                log('error', 'WATCHDOG: Brak aktywnosci przez ' + Math.round(elapsed/1000) + 's - skrypt mogl sie zawiesic!');
                updateStatus('UWAGA: Mozliwe zawieszenie! Brak aktywnosci ' + Math.round(elapsed/1000) + 's. Sprawdz konsole (F12).');
                // Reset watchdog zeby nie spamowac
                tickWatchdog();
            }
        }, 10000); // Sprawdzaj co 10 sekund
    }

    function stopWatchdog() {
        if (watchdogInterval) {
            clearInterval(watchdogInterval);
            watchdogInterval = null;
        }
    }

    // ========== WALIDACJA DANYCH ==========
    function isValidProduct(data) {
        // Produkt jest poprawny jesli ma chociaz nazwe lub EAN lub cene
        if (!data) return false;
        if (data.error) return false;
        if (data.nazwa && data.nazwa.length > 0) return true;
        if (data.ean && data.ean.length > 0) return true;
        if (data.cena_sprzedazy_brutto && data.cena_sprzedazy_brutto !== '0.00') return true;
        return false;
    }

    function getValidationStatus(data) {
        if (!data) return 'BRAK_DANYCH';
        if (data.error) return 'BLAD: ' + data.error;
        var fields = [];
        if (!data.nazwa) fields.push('nazwa');
        if (!data.ean) fields.push('ean');
        if (!data.cena_sprzedazy_brutto || data.cena_sprzedazy_brutto === '0.00') fields.push('cena');
        if (fields.length === 0) return 'OK';
        if (fields.length === 3) return 'PUSTY';
        return 'BRAKUJE: ' + fields.join(', ');
    }

    // ========== INDEXEDDB - BAZA DANYCH ==========
    function initDB() {
        return new Promise(function(resolve, reject) {
            if (db) {
                resolve(db);
                return;
            }

            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = function(event) {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = function(event) {
                db = event.target.result;
                console.log('[DB] IndexedDB otwarta');
                resolve(db);
            };

            request.onupgradeneeded = function(event) {
                var database = event.target.result;
                // Tworzymy store dla produktow
                if (!database.objectStoreNames.contains(DB_STORE)) {
                    var store = database.createObjectStore(DB_STORE, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('[DB] Utworzono store produktow');
                }
                // Store dla metadanych
                if (!database.objectStoreNames.contains('metadata')) {
                    database.createObjectStore('metadata', { keyPath: 'key' });
                    console.log('[DB] Utworzono store metadanych');
                }
            };
        });
    }

    async function saveProductToDB(product) {
        try {
            await initDB();
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([DB_STORE], 'readwrite');
                var store = transaction.objectStore(DB_STORE);
                product.timestamp = Date.now();
                var request = store.put(product);
                request.onsuccess = function() { resolve(); };
                request.onerror = function() { reject(request.error); };
            });
        } catch (e) {
            console.error('Blad zapisu do DB:', e);
        }
    }

    async function saveMetadata(data) {
        try {
            await initDB();
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction(['metadata'], 'readwrite');
                var store = transaction.objectStore('metadata');
                data.key = 'progress';
                var request = store.put(data);
                request.onsuccess = function() { resolve(); };
                request.onerror = function() { reject(request.error); };
            });
        } catch (e) {
            console.error('Blad zapisu metadanych:', e);
        }
    }

    async function loadMetadata() {
        try {
            await initDB();
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction(['metadata'], 'readonly');
                var store = transaction.objectStore('metadata');
                var request = store.get('progress');
                request.onsuccess = function() { resolve(request.result); };
                request.onerror = function() { reject(request.error); };
            });
        } catch (e) {
            console.error('Blad odczytu metadanych:', e);
            return null;
        }
    }

    async function loadAllProductsFromDB() {
        try {
            await initDB();
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([DB_STORE], 'readonly');
                var store = transaction.objectStore(DB_STORE);
                var request = store.getAll();
                request.onsuccess = function() { resolve(request.result || []); };
                request.onerror = function() { reject(request.error); };
            });
        } catch (e) {
            console.error('Blad odczytu produktow:', e);
            return [];
        }
    }

    async function clearDB() {
        try {
            await initDB();
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([DB_STORE, 'metadata'], 'readwrite');
                transaction.objectStore(DB_STORE).clear();
                transaction.objectStore('metadata').clear();
                transaction.oncomplete = function() {
                    console.log('[DB] Baza wyczyszczona');
                    resolve();
                };
                transaction.onerror = function() { reject(transaction.error); };
            });
        } catch (e) {
            console.error('Blad czyszczenia DB:', e);
        }
    }

    async function getProductCount() {
        try {
            await initDB();
            return new Promise(function(resolve, reject) {
                var transaction = db.transaction([DB_STORE], 'readonly');
                var store = transaction.objectStore(DB_STORE);
                var request = store.count();
                request.onsuccess = function() { resolve(request.result); };
                request.onerror = function() { resolve(0); };
            });
        } catch (e) {
            return 0;
        }
    }

    // ========== MIGRACJA Z LOCALSTORAGE DO INDEXEDDB ==========
    async function migrateFromLocalStorage() {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
            console.log('[MIGRACJA] Brak danych w localStorage');
            return false;
        }

        try {
            var data = JSON.parse(saved);
            if (!data.products || data.products.length === 0) {
                console.log('[MIGRACJA] Brak produktow do migracji');
                return false;
            }

            console.log('[MIGRACJA] Rozpoczynam migracje ' + data.products.length + ' produktow...');
            log('info', 'MIGRACJA: przenoszenie ' + data.products.length + ' produktow do IndexedDB...');
            updateStatus('Migracja ' + data.products.length + ' produktow do IndexedDB...');

            await initDB();

            // Zapisz produkty partiami po 100
            var batchSize = 100;
            for (var i = 0; i < data.products.length; i += batchSize) {
                var batch = data.products.slice(i, i + batchSize);
                for (var j = 0; j < batch.length; j++) {
                    if (batch[j] && batch[j].id) {
                        await saveProductToDB(batch[j]);
                    }
                }
                console.log('[MIGRACJA] ' + Math.min(i + batchSize, data.products.length) + '/' + data.products.length);
            }

            // Zapisz metadane
            var metadata = {
                timestamp: data.timestamp,
                failedIds: data.failedIds || [],
                remainingIds: data.remainingIds || [],
                totalProcessed: data.totalProcessed || 0,
                successCount: data.successCount || data.products.filter(function(p) { return !p.error; }).length,
                errorCount: data.errorCount || data.products.filter(function(p) { return p.error; }).length
            };
            await saveMetadata(metadata);

            // Wyczysc localStorage
            localStorage.removeItem(STORAGE_KEY);
            console.log('[MIGRACJA] Zakonczono! localStorage wyczyszczony.');
            log('success', 'MIGRACJA ZAKONCZONA! Przeniesiono ' + data.products.length + ' produktow.');
            updateStatus('Migracja zakonczona! Przeniesiono ' + data.products.length + ' produktow.');

            return true;
        } catch (e) {
            console.error('[MIGRACJA] Blad:', e);
            log('error', 'Blad migracji: ' + e.message);
            return false;
        }
    }

    // ========== AUTO-ZAPIS (IndexedDB) ==========
    async function saveProgress(productIds, currentIdx) {
        try {
            // Zapisz kazdy nowy produkt do DB
            for (var i = 0; i < exportedProducts.length; i++) {
                var product = exportedProducts[i];
                if (product && product.id) {
                    await saveProductToDB(product);
                }
            }

            // Zapisz metadane
            var metadata = {
                timestamp: new Date().toISOString(),
                failedIds: failedProducts.map(function(p) { return p.id; }),
                remainingIds: productIds.slice(currentIdx),
                totalProcessed: currentIdx,
                successCount: successCount,
                errorCount: errorCount
            };
            await saveMetadata(metadata);

            var count = await getProductCount();
            console.log('[DB] Zapisano do IndexedDB. Produktow w bazie: ' + count);
        } catch (e) {
            log('error', 'Blad zapisu do IndexedDB: ' + e.message);
            console.error('DB save error:', e);
        }
    }

    // Stara funkcja dla kompatybilnosci
    function saveProgressOld(productIds, currentIdx) {
        var data = {
            timestamp: new Date().toISOString(),
            products: exportedProducts,
            failedIds: failedProducts.map(function(p) { return p.id; }),
            remainingIds: productIds.slice(currentIdx),
            totalProcessed: currentIdx,
            successCount: successCount,
            errorCount: errorCount
        };

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            console.log('[AUTO-SAVE] Zapisano ' + exportedProducts.length + ' produktow (OK: ' + successCount + ', BLEDY: ' + errorCount + ')');
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.message.includes('quota') || e.message.includes('exceeded')) {
                log('error', 'LOCALSTORAGE PELNY! Eksportuje awaryjny CSV...');
                updateStatus('UWAGA: localStorage pelny! Generuje awaryjny CSV...');

                // Eksportuj to co mamy przed wyczyszczeniem
                if (exportedProducts.length > 0) {
                    exportToCSV(exportedProducts, '_awaryjny_' + Date.now());
                }

                // Wyczysc localStorage
                localStorage.removeItem(STORAGE_KEY);
                log('warn', 'localStorage wyczyszczony. Dane wyeksportowane do CSV.');

                // Zapisz tylko pozostale ID (malo danych)
                try {
                    var minimalData = {
                        timestamp: new Date().toISOString(),
                        products: [],
                        remainingIds: productIds.slice(currentIdx),
                        successCount: successCount,
                        errorCount: errorCount,
                        note: 'Dane wyeksportowane awaryjnie do CSV'
                    };
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(minimalData));
                } catch (e2) {
                    log('error', 'Nie mozna zapisac nawet minimalnych danych');
                }
            } else {
                log('error', 'Blad zapisu localStorage: ' + e.message);
                console.error('Save error:', e);
            }
        }
    }

    // Wczytaj z IndexedDB
    async function loadProgress() {
        try {
            var metadata = await loadMetadata();
            if (!metadata) return null;

            var products = await loadAllProductsFromDB();
            return {
                timestamp: metadata.timestamp,
                products: products,
                failedIds: metadata.failedIds || [],
                remainingIds: metadata.remainingIds || [],
                totalProcessed: metadata.totalProcessed || 0,
                successCount: metadata.successCount || 0,
                errorCount: metadata.errorCount || 0
            };
        } catch (e) {
            console.error('Blad loadProgress:', e);
            return null;
        }
    }

    async function clearProgress() {
        await clearDB();
        localStorage.removeItem(STORAGE_KEY); // Wyczysc tez stary storage
    }

    async function hasProgress() {
        var count = await getProductCount();
        return count > 0;
    }

    // ========== UI ==========
    function createUI() {
        if (document.getElementById('detail-export-ui')) return;

        var ui = document.createElement('div');
        ui.id = 'detail-export-ui';
        ui.innerHTML = `
            <style>
                #detail-export-ui {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: #2c3e50;
                    color: #ecf0f1;
                    padding: 20px;
                    border-radius: 8px;
                    z-index: 10000;
                    font-family: Arial, sans-serif;
                    font-size: 13px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
                    min-width: 320px;
                }
                #detail-export-ui h3 {
                    margin: 0 0 15px 0;
                    color: #3498db;
                    font-size: 16px;
                }
                #detail-export-ui label {
                    display: block;
                    margin: 10px 0 5px 0;
                    font-weight: bold;
                }
                #detail-export-ui input[type="text"],
                #detail-export-ui input[type="number"] {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid #34495e;
                    border-radius: 4px;
                    background: #34495e;
                    color: #ecf0f1;
                    box-sizing: border-box;
                }
                #detail-export-ui select {
                    width: 100%;
                    padding: 8px;
                    border: 1px solid #34495e;
                    border-radius: 4px;
                    background: #34495e;
                    color: #ecf0f1;
                }
                #detail-export-ui button {
                    margin-top: 15px;
                    padding: 10px 20px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    margin-right: 10px;
                }
                #detail-export-ui .btn-start {
                    background: #27ae60;
                    color: white;
                }
                #detail-export-ui .btn-start:hover {
                    background: #2ecc71;
                }
                #detail-export-ui .btn-stop {
                    background: #c0392b;
                    color: white;
                }
                #detail-export-ui .btn-stop:hover {
                    background: #e74c3c;
                }
                #detail-export-ui .btn-close {
                    background: #7f8c8d;
                    color: white;
                    float: right;
                    padding: 5px 10px;
                    margin: 0;
                    font-size: 12px;
                }
                #detail-export-ui .status {
                    margin-top: 15px;
                    padding: 10px;
                    background: #34495e;
                    border-radius: 4px;
                    min-height: 20px;
                    word-wrap: break-word;
                }
                #detail-export-ui .progress-bar {
                    width: 100%;
                    height: 20px;
                    background: #34495e;
                    border-radius: 4px;
                    margin-top: 10px;
                    overflow: hidden;
                }
                #detail-export-ui .progress-fill {
                    height: 100%;
                    background: #3498db;
                    width: 0%;
                    transition: width 0.3s;
                }
                #detail-export-ui .hidden {
                    display: none;
                }
                #detail-export-ui .info {
                    font-size: 11px;
                    color: #95a5a6;
                    margin-top: 5px;
                }
                #product-loader-frame {
                    position: fixed;
                    left: -3000px;
                    top: 0;
                    width: 1920px;
                    height: 1080px;
                    opacity: 0.01;
                }
            </style>
            <button class="btn-close" id="close-ui">X</button>
            <h3>ShopWay Detail Exporter v3.6</h3>

            <label>Tryb pobierania:</label>
            <select id="export-mode">
                <option value="all">Wszystkie produkty</option>
                <option value="count">Wybrana ilosc</option>
                <option value="ids">Konkretne ID</option>
            </select>

            <div id="count-input" class="hidden">
                <label>Ilosc produktow:</label>
                <input type="number" id="export-count" value="10" min="1">
            </div>

            <div id="ids-input" class="hidden">
                <label>ID produktow (po przecinku):</label>
                <input type="text" id="export-ids" placeholder="np. 39736,39737,39738">
                <div class="info">Wpisz ID produktow rozdzielone przecinkami</div>
            </div>

            <div id="resume-input">
                <label>Wznow od ID (opcjonalne):</label>
                <input type="text" id="resume-from-id" placeholder="np. 39500">
                <select id="resume-direction">
                    <option value="down">w dol (nizsze ID)</option>
                    <option value="up">w gore (wyzsze ID)</option>
                </select>
                <div class="info">Zacznie od produktow z ID nizszym/wyzszym niz podane</div>
            </div>

            <label>Czas ladowania strony (ms):</label>
            <div style="display:flex;gap:5px;align-items:center;">
                <input type="number" id="export-delay" value="3500" min="1000" max="15000" style="flex:1;">
                <button id="auto-calibrate-btn" style="padding:8px 12px;margin:0;background:#9b59b6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">Auto</button>
            </div>
            <div class="info">Czas oczekiwania na zaladowanie strony (min. 1000ms)</div>

            <label>Pobieranie rownolegle:</label>
            <select id="parallel-count">
                <option value="1">1 produkt (bezpieczne)</option>
                <option value="2">2 produkty</option>
                <option value="3">3 produkty</option>
                <option value="5">5 produktow</option>
                <option value="10">10 produktow (ryzykowne!)</option>
            </select>
            <div class="info" style="color:#e74c3c;">Uwaga: wiecej = szybciej, ale moze przeciazyc serwer!</div>

            <div>
                <button class="btn-start" id="start-export">Rozpocznij eksport</button>
                <button class="btn-stop hidden" id="stop-export">Zatrzymaj</button>
            </div>
            <div id="resume-saved" class="hidden" style="margin-top:10px;">
                <div class="info" style="color:#f1c40f;" id="saved-info"></div>
                <button class="btn-start" id="resume-saved-btn" style="background:#e67e22;">Wznow zapisany postep</button>
                <button class="btn-start" id="retry-empty-btn" style="background:#9b59b6;">Pobierz tylko puste</button>
                <button class="btn-start" id="export-saved-btn" style="background:#3498db;">Eksportuj CSV z zapisu</button>
                <button class="btn-close" id="clear-saved-btn" style="margin-left:5px;">Wyczysc</button>
            </div>

            <div class="status" id="export-status">Gotowy do eksportu</div>
            <div class="progress-bar">
                <div class="progress-fill" id="progress-fill"></div>
            </div>
            <div id="export-stats" style="margin-top:10px; font-size:12px;">
                <span style="color:#27ae60;">OK: <span id="stat-ok">0</span></span> |
                <span style="color:#e74c3c;">Błędy: <span id="stat-errors">0</span></span> |
                <span style="color:#f39c12;">Do retry: <span id="stat-retry">0</span></span>
            </div>

            <div id="diagnostics-panel" style="margin-top:10px; padding:8px; background:#1a252f; border-radius:4px; font-size:11px;">
                <b>Diagnostyka:</b><br>
                Aktywne iframe: <span style="color:#3498db;">0</span> (max: 0)<br>
                Sredni czas ladowania: <span style="color:#27ae60;">0ms</span><br>
                Timeouty: <span style="color:#e74c3c;">0</span> | Bledy iframe: <span style="color:#e74c3c;">0</span>
            </div>

            <div style="margin-top:10px;">
                <label style="margin:0;display:inline;">Logi:</label>
                <button id="copy-logs-btn" style="float:right;padding:2px 8px;margin:0 5px 0 0;font-size:10px;background:#3498db;">Kopiuj</button>
                <button id="clear-logs-btn" style="float:right;padding:2px 8px;margin:0;font-size:10px;">Wyczysc</button>
            </div>
            <div id="log-panel-content" style="margin-top:5px; padding:5px; background:#1a252f; border-radius:4px; height:120px; overflow-y:auto; font-family:monospace;">
                <div style="color:#95a5a6;font-size:10px;">Gotowy do eksportu...</div>
            </div>
        `;
        document.body.appendChild(ui);

        // Dodaj ukryty iframe do ladowania stron
        var iframe = document.createElement('iframe');
        iframe.id = 'product-loader-frame';
        iframe.name = 'product-loader-frame';
        document.body.appendChild(iframe);

        // Event listeners
        document.getElementById('close-ui').addEventListener('click', function() {
            ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
        });

        document.getElementById('export-mode').addEventListener('change', function() {
            document.getElementById('count-input').classList.toggle('hidden', this.value !== 'count');
            document.getElementById('ids-input').classList.toggle('hidden', this.value !== 'ids');
        });

        document.getElementById('start-export').addEventListener('click', startDetailExport);
        document.getElementById('stop-export').addEventListener('click', function() {
            shouldStop = true;
            updateStatus('Zatrzymywanie...');
        });

        document.getElementById('auto-calibrate-btn').addEventListener('click', runAutoCalibration);

        document.getElementById('resume-saved-btn').addEventListener('click', resumeFromSaved);
        document.getElementById('retry-empty-btn').addEventListener('click', retryEmptyProducts);
        document.getElementById('export-saved-btn').addEventListener('click', exportFromSaved);
        document.getElementById('clear-saved-btn').addEventListener('click', async function() {
            await clearProgress();
            document.getElementById('resume-saved').classList.add('hidden');
            updateStatus('Zapisany postep wyczyszczony (IndexedDB)');
        });

        document.getElementById('clear-logs-btn').addEventListener('click', function() {
            logMessages = [];
            updateLogPanel();
            log('info', 'Logi wyczyszczone');
        });

        document.getElementById('copy-logs-btn').addEventListener('click', function() {
            var logText = logMessages.map(function(entry) {
                var typePrefix = entry.type === 'error' ? '[BLAD]' :
                                 entry.type === 'warn' ? '[WARN]' :
                                 entry.type === 'success' ? '[OK]' : '[INFO]';
                return typePrefix + ' ' + entry.message;
            }).join('\n');

            // Dodaj statystyki na gorze
            var stats = '=== STATYSTYKI EKSPORTU ===\n';
            stats += 'OK: ' + successCount + ', Bledy: ' + errorCount + '\n';
            stats += 'Timeouty: ' + timeoutCount + ', Bledy iframe: ' + iframeErrorCount + '\n';
            stats += 'Sredni czas ladowania: ' + (loadedCount > 0 ? Math.round(totalLoadTime / loadedCount) : 0) + 'ms\n';
            stats += 'Max aktywnych iframe: ' + maxActiveIframes + '\n';
            stats += '=== LOGI ===\n\n';

            navigator.clipboard.writeText(stats + logText).then(function() {
                updateStatus('Skopiowano ' + logMessages.length + ' logow do schowka!');
            }).catch(function() {
                // Fallback dla starszych przegladarek
                var textarea = document.createElement('textarea');
                textarea.value = stats + logText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                updateStatus('Skopiowano ' + logMessages.length + ' logow do schowka!');
            });
        });

        // Sprawdz czy jest zapisany postep
        checkSavedProgress();
    }

    // ========== EKSPORT Z ZAPISANEGO STANU ==========
    async function exportFromSaved() {
        var saved = await loadProgress();
        if (!saved || !saved.products || saved.products.length === 0) {
            updateStatus('Brak zapisanych produktow do eksportu');
            return;
        }

        updateStatus('Eksportuje ' + saved.products.length + ' produktow z zapisu...');
        exportToCSV(saved.products, '_z_zapisu');
        updateStatus('Wyeksportowano ' + saved.products.length + ' produktow z zapisanego stanu');
    }

    // ========== PONOWNE POBRANIE PUSTYCH ==========
    async function retryEmptyProducts() {
        var saved = await loadProgress();
        if (!saved || !saved.products) {
            updateStatus('Brak zapisanych produktow');
            return;
        }

        if (isExporting) return;

        // Znajdz puste/bledne produkty
        var emptyIds = [];
        var validProducts = [];
        saved.products.forEach(function(p) {
            if (isValidProduct(p)) {
                validProducts.push(p);
            } else {
                emptyIds.push(p.id);
            }
        });

        if (emptyIds.length === 0) {
            updateStatus('Wszystkie produkty sa poprawne!');
            return;
        }

        isExporting = true;
        shouldStop = false;
        exportedProducts = validProducts.slice(); // Zacznij od poprawnych
        failedProducts = [];
        successCount = validProducts.length;
        errorCount = 0;
        resetDiagnostics();
        startWatchdog(); // Uruchom watchdog

        var loadTime = parseInt(document.getElementById('export-delay').value) || 2500;
        var parallelCount = parseInt(document.getElementById('parallel-count').value) || 1;

        document.getElementById('start-export').classList.add('hidden');
        document.getElementById('stop-export').classList.remove('hidden');
        document.getElementById('resume-saved').classList.add('hidden');

        totalToExport = validProducts.length + emptyIds.length;

        log('info', '=== PONOWNE POBIERANIE PUSTYCH v3.5 ===');
        log('info', 'Do pobrania: ' + emptyIds.length + ' produktow, rownolegle: ' + parallelCount);
        updateStatus('Ponawiam pobranie ' + emptyIds.length + ' pustych produktow (po ' + parallelCount + ' naraz)...');
        updateStats();

        // Pobieranie w partiach (rownoleglo) - tak samo jak glowny eksport
        try {
            for (var i = 0; i < emptyIds.length && !shouldStop; i += parallelCount) {
                tickWatchdog(); // Resetuj watchdog

                var batch = emptyIds.slice(i, Math.min(i + parallelCount, emptyIds.length));
                var batchNum = Math.floor(i / parallelCount) + 1;
                var totalBatches = Math.ceil(emptyIds.length / parallelCount);

                updateProgress(validProducts.length + Math.min(i + parallelCount, emptyIds.length), totalToExport);
                updateStatus('Retry ' + (i + 1) + '-' + Math.min(i + parallelCount, emptyIds.length) + ' z ' + emptyIds.length + '...');

                log('info', '--- RETRY PARTIA ' + batchNum + '/' + totalBatches + ' (ID: ' + batch.join(', ') + ') ---');

                // Pobierz partie rownolegle z timeout
                var batchStartTime = Date.now();
                var batchPromises = batch.map(function(productId) {
                    var timerId;
                    var fetchPromise = fetchProductData(productId, loadTime).finally(function() {
                        clearTimeout(timerId);
                    });
                    var timeoutPromise = new Promise(function(resolve) {
                        timerId = setTimeout(function() {
                            log('error', 'BATCH TIMEOUT', productId);
                            resolve({ id: productId, error: 'Batch timeout' });
                        }, loadTime + 30000);
                    });
                    return Promise.race([fetchPromise, timeoutPromise]);
                });

                var batchResults;
                try {
                    batchResults = await Promise.all(batchPromises);
                } catch (batchError) {
                    log('error', 'BLAD Promise.all: ' + batchError.message);
                    batchResults = batch.map(function(id) { return { id: id, error: 'Batch failed' }; });
                }

                var batchTime = Date.now() - batchStartTime;
                log('info', 'Retry partia ' + batchNum + ' zakonczona w ' + batchTime + 'ms');
                tickWatchdog();

                batchResults.forEach(function(productData, idx) {
                    if (isValidProduct(productData)) {
                        exportedProducts.push(productData);
                        successCount++;
                        log('success', 'Retry OK: ' + (productData.nazwa || '').substring(0, 20), batch[idx]);
                    } else {
                        productData.error = productData.error || 'Ponowne pobranie nieudane';
                        exportedProducts.push(productData);
                        errorCount++;
                        log('warn', 'Retry nieudany', batch[idx]);
                    }
                    updateStats();
                });

                // Zapisz postep co 5 produktow
                if ((i + batch.length) % 5 === 0) {
                    var remainingIds = emptyIds.slice(i + batch.length);
                    saveProgress(remainingIds, 0);
                }

                // Pauza miedzy partiami
                if (parallelCount > 1 && !shouldStop && i + parallelCount < emptyIds.length) {
                    var pauseTime = parallelCount * 300;
                    log('info', 'Pauza ' + pauseTime + 'ms...');
                    await sleep(pauseTime);
                }
            }
        } catch (loopError) {
            log('error', 'KRYTYCZNY BLAD: ' + loopError.message);
            console.error('Loop error:', loopError);
        }

        // Zatrzymaj watchdog
        stopWatchdog();
        log('info', '=== RETRY ZAKONCZONY ===');

        if (shouldStop) {
            var remainingIds = emptyIds.slice(i);
            saveProgress(remainingIds, 0);
            updateStatus('Zatrzymano. OK: ' + successCount + ', Bledy: ' + errorCount);
        } else {
            updateStatus('Zakoczono! Generowanie pliku CSV...');
            await clearProgress();
        }

        if (exportedProducts.length > 0) {
            exportToCSV(exportedProducts, '_po_retry');
            updateStatus('Gotowe! OK: ' + successCount + ', Bledy: ' + errorCount);
        }

        isExporting = false;
        document.getElementById('start-export').classList.remove('hidden');
        document.getElementById('stop-export').classList.add('hidden');
        checkSavedProgress();
    }

    // ========== AUTO-KALIBRACJA ==========
    async function runAutoCalibration() {
        if (isExporting) {
            updateStatus('Nie mozna kalibrowac podczas eksportu!');
            return;
        }

        var parallelCount = parseInt(document.getElementById('parallel-count').value) || 1;

        log('info', '=== AUTO-KALIBRACJA ===');
        log('info', 'Testuje optymalne ustawienia dla ' + parallelCount + ' rownoleglych...');
        updateStatus('Kalibracja: pobieram liste produktow...');

        // Zbierz kilka ID produktow do testu
        var testIds = [];
        var rows = document.querySelectorAll('.GF_Datagrid .body tbody tr');
        rows.forEach(function(row, idx) {
            if (idx < 10) { // Max 10 produktow do testu
                var idEl = row.querySelector('.GF_Datagrid_Row_Id');
                if (idEl) {
                    testIds.push(idEl.textContent.trim());
                }
            }
        });

        if (testIds.length < 3) {
            updateStatus('Za malo produktow na liscie do kalibracji (min. 3)');
            log('error', 'Za malo produktow do kalibracji');
            return;
        }

        // Testujemy z 5 produktami
        var calibrationIds = testIds.slice(0, 5);
        log('info', 'Testowe produkty: ' + calibrationIds.join(', '));

        isExporting = true;
        resetDiagnostics();

        // Test 1: Zmierz minimalny czas ladowania iframe (bez czekania na dane)
        updateStatus('Kalibracja: mierze czas ladowania iframe...');

        var iframeLoadTimes = [];
        var dataLoadTimes = [];

        // Testuj kazdy produkt z krotkim czasem zeby zmierzyc rzeczywisty czas ladowania
        for (var i = 0; i < calibrationIds.length; i++) {
            var productId = calibrationIds[i];
            updateStatus('Kalibracja: testuje produkt ' + (i + 1) + '/' + calibrationIds.length + ' (ID: ' + productId + ')');

            var result = await measureProductLoadTime(productId);

            if (result.success) {
                iframeLoadTimes.push(result.iframeTime);
                dataLoadTimes.push(result.totalTime);
                log('success', 'Test OK: iframe=' + result.iframeTime + 'ms, dane=' + result.totalTime + 'ms', productId);
            } else {
                log('warn', 'Test nieudany: ' + result.error, productId);
            }

            await sleep(500);
        }

        isExporting = false;

        if (iframeLoadTimes.length < 2) {
            updateStatus('Kalibracja nieudana - za malo udanych testow');
            log('error', 'Kalibracja nieudana');
            return;
        }

        // Oblicz statystyki
        var avgIframeTime = Math.round(iframeLoadTimes.reduce(function(a, b) { return a + b; }, 0) / iframeLoadTimes.length);
        var maxIframeTime = Math.max.apply(null, iframeLoadTimes);
        var avgDataTime = Math.round(dataLoadTimes.reduce(function(a, b) { return a + b; }, 0) / dataLoadTimes.length);
        var maxDataTime = Math.max.apply(null, dataLoadTimes);

        log('info', '--- WYNIKI KALIBRACJI ---');
        log('info', 'Iframe: avg=' + avgIframeTime + 'ms, max=' + maxIframeTime + 'ms');
        log('info', 'Dane: avg=' + avgDataTime + 'ms, max=' + maxDataTime + 'ms');

        // Oblicz optymalny czas
        // Formula: czas_ladowania = max_iframe_time + margines_bezpieczenstwa + (parallel_penalty)
        var baseTime = maxIframeTime + 500; // Bazowy czas + 500ms marginesu
        var parallelPenalty = (parallelCount - 1) * 300; // Dodatkowy czas na kazdy rownolegle pobierany produkt
        var recommendedTime = Math.max(2000, Math.min(6000, baseTime + parallelPenalty));

        // Zaokraglij do 500ms
        recommendedTime = Math.round(recommendedTime / 500) * 500;

        log('success', 'REKOMENDOWANY CZAS: ' + recommendedTime + 'ms (dla ' + parallelCount + ' rownoleglych)');

        // Ustaw rekomendowany czas
        document.getElementById('export-delay').value = recommendedTime;

        updateStatus('Kalibracja OK! Ustawiono: ' + recommendedTime + 'ms (avg iframe: ' + avgIframeTime + 'ms)');

        // Pokaz podsumowanie
        var summary = 'Kalibracja zakonczona!\n\n';
        summary += 'Sredni czas iframe: ' + avgIframeTime + 'ms\n';
        summary += 'Max czas iframe: ' + maxIframeTime + 'ms\n';
        summary += 'Rownoleglosc: ' + parallelCount + '\n';
        summary += '\nRekomendowany czas: ' + recommendedTime + 'ms';

        alert(summary);
    }

    async function measureProductLoadTime(productId) {
        return new Promise(function(resolve) {
            var startTime = Date.now();
            var iframeLoadTime = 0;

            var iframeId = 'calibration-frame-' + productId;
            var iframe = document.createElement('iframe');
            iframe.id = iframeId;
            iframe.style.cssText = 'position:fixed;left:-3000px;top:0;width:1920px;height:1080px;opacity:0.01;';
            document.body.appendChild(iframe);

            var url = window.location.origin + '/admin/product/edit/' + productId;
            var resolved = false;

            var timeout = setTimeout(function() {
                if (resolved) return;
                resolved = true;
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                resolve({ success: false, error: 'Timeout' });
            }, 20000);

            iframe.onload = function() {
                iframeLoadTime = Date.now() - startTime;

                // Czekamy chwile i sprawdzamy czy dane sa dostepne
                setTimeout(function() {
                    if (resolved) return;

                    try {
                        var doc = iframe.contentDocument || iframe.contentWindow.document;
                        var hasNameInput = doc.querySelector('input[name="basic_pane[language_data][1][name]"]');
                        var nameValue = hasNameInput ? hasNameInput.value : '';

                        resolved = true;
                        clearTimeout(timeout);

                        var totalTime = Date.now() - startTime;

                        setTimeout(function() {
                            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                        }, 100);

                        resolve({
                            success: nameValue.length > 0,
                            iframeTime: iframeLoadTime,
                            totalTime: totalTime,
                            hasData: nameValue.length > 0,
                            error: nameValue.length === 0 ? 'Brak danych w formularzu' : null
                        });

                    } catch (e) {
                        resolved = true;
                        clearTimeout(timeout);
                        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                        resolve({ success: false, error: e.message, iframeTime: iframeLoadTime });
                    }
                }, 2000); // Czekamy 2s po zaladowaniu iframe
            };

            iframe.onerror = function() {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
                resolve({ success: false, error: 'Blad ladowania' });
            };

            iframe.src = url;
        });
    }

    async function checkSavedProgress() {
        // Najpierw sprobuj migracji z localStorage
        var hasLocalStorage = localStorage.getItem(STORAGE_KEY);
        if (hasLocalStorage) {
            await migrateFromLocalStorage();
        }

        var saved = await loadProgress();
        if (saved && saved.products && saved.products.length > 0) {
            var savedDate = new Date(saved.timestamp).toLocaleString('pl-PL');

            // Analiza zapisanych produktow
            var validCount = 0;
            var emptyCount = 0;
            var errorCount = 0;
            (saved.products || []).forEach(function(p) {
                if (isValidProduct(p)) {
                    validCount++;
                } else if (p.error) {
                    errorCount++;
                } else {
                    emptyCount++;
                }
            });

            var info = 'Zapis z ' + savedDate + ' (IndexedDB):\n';
            info += '  Produktow: ' + saved.products.length + ' (OK: ' + validCount + ', Puste: ' + emptyCount + ', Bledy: ' + errorCount + ')\n';
            info += '  Pozostalo do pobrania: ' + (saved.remainingIds ? saved.remainingIds.length : 0);

            document.getElementById('saved-info').textContent = info;
            document.getElementById('saved-info').style.whiteSpace = 'pre-line';
            document.getElementById('resume-saved').classList.remove('hidden');

            console.log('[ANALIZA ZAPISU] OK: ' + validCount + ', Puste: ' + emptyCount + ', Bledy: ' + errorCount + ', Pozostalo: ' + (saved.remainingIds ? saved.remainingIds.length : 0));
        } else {
            document.getElementById('saved-info').textContent = 'Brak zapisanych danych';
            document.getElementById('resume-saved').classList.add('hidden');
        }
    }

    async function resumeFromSaved() {
        var saved = await loadProgress();
        if (!saved) {
            updateStatus('Brak zapisanego postepu');
            return;
        }

        if (isExporting) return;

        isExporting = true;
        shouldStop = false;
        exportedProducts = saved.products || [];
        failedProducts = [];
        successCount = saved.successCount || exportedProducts.length;
        errorCount = saved.errorCount || 0;
        var productIds = saved.remainingIds || [];
        var loadTime = parseInt(document.getElementById('export-delay').value) || 2500;
        var parallelCount = parseInt(document.getElementById('parallel-count').value) || 1;

        document.getElementById('start-export').classList.add('hidden');
        document.getElementById('stop-export').classList.remove('hidden');
        document.getElementById('resume-saved').classList.add('hidden');

        totalToExport = exportedProducts.length + productIds.length;
        updateStatus('Wznawiam: ' + exportedProducts.length + ' gotowych, ' + productIds.length + ' do pobrania (po ' + parallelCount + ' naraz)...');
        updateStats();

        // Pobieranie w partiach (rownoleglo)
        for (var i = 0; i < productIds.length && !shouldStop; i += parallelCount) {
            var batch = productIds.slice(i, Math.min(i + parallelCount, productIds.length));

            currentIndex = exportedProducts.length + batch.length;
            updateProgress(currentIndex, totalToExport);

            var batchPromises = batch.map(function(productId) {
                return fetchProductData(productId, loadTime);
            });

            var batchResults = await Promise.all(batchPromises);

            batchResults.forEach(function(productData, idx) {
                var status = getValidationStatus(productData);
                if (isValidProduct(productData)) {
                    exportedProducts.push(productData);
                    successCount++;
                    console.log('[OK] Produkt ' + batch[idx] + ': ' + (productData.nazwa || 'bez nazwy'));
                } else {
                    failedProducts.push({ id: batch[idx], data: productData, retries: 0 });
                    errorCount++;
                    console.warn('[BLAD] Produkt ' + batch[idx] + ': ' + status);
                }
                updateStats();
            });

            // Auto-zapis
            if ((successCount + errorCount) % AUTO_SAVE_INTERVAL === 0) {
                saveProgress(productIds, i + batch.length);
            }

            // Eksport czesciowy
            if (exportedProducts.length > 0 && exportedProducts.length % AUTO_EXPORT_INTERVAL === 0) {
                exportToCSV(exportedProducts, '_czesc' + Math.floor(exportedProducts.length / AUTO_EXPORT_INTERVAL));
            }
        }

        // RETRY DLA NIEUDANYCH
        if (!shouldStop && failedProducts.length > 0) {
            updateStatus('Ponawiam probe dla ' + failedProducts.length + ' nieudanych produktow...');
            await sleep(2000);

            var retryList = failedProducts.filter(function(p) { return p.retries < MAX_RETRIES; });
            failedProducts = [];

            for (var r = 0; r < retryList.length && !shouldStop; r++) {
                var retryItem = retryList[r];
                retryItem.retries++;
                updateStatus('RETRY ' + retryItem.retries + '/' + MAX_RETRIES + ' dla ID ' + retryItem.id);

                var retryData = await fetchProductData(retryItem.id, loadTime + 2000);

                if (isValidProduct(retryData)) {
                    exportedProducts.push(retryData);
                    successCount++;
                    errorCount--;
                } else if (retryItem.retries < MAX_RETRIES) {
                    failedProducts.push(retryItem);
                } else {
                    retryData.error = retryData.error || 'Nie udalo sie pobrac';
                    exportedProducts.push(retryData);
                }
                updateStats();
                await sleep(500);
            }
        }

        if (shouldStop) {
            saveProgress(productIds, i);
            updateStatus('Zatrzymano. OK: ' + successCount + ', Bledy: ' + errorCount);
        } else {
            updateStatus('Zakoczono! Generowanie pliku CSV...');
            await clearProgress();
        }

        if (exportedProducts.length > 0) {
            exportToCSV(exportedProducts, '_final');
            updateStatus('Gotowe! OK: ' + successCount + ', Bledy: ' + errorCount);
        }

        isExporting = false;
        document.getElementById('start-export').classList.remove('hidden');
        document.getElementById('stop-export').classList.add('hidden');
        checkSavedProgress();
    }

    function updateStatus(message) {
        var statusEl = document.getElementById('export-status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }

    function updateProgress(current, total) {
        var progressEl = document.getElementById('progress-fill');
        if (progressEl && total > 0) {
            var percent = (current / total) * 100;
            progressEl.style.width = percent + '%';
        }
        updateStatus('Pobieranie: ' + current + '/' + total + ' (' + Math.round((current/total)*100) + '%)');
    }

    function updateStats() {
        var okEl = document.getElementById('stat-ok');
        var errEl = document.getElementById('stat-errors');
        var retryEl = document.getElementById('stat-retry');
        if (okEl) okEl.textContent = successCount;
        if (errEl) errEl.textContent = errorCount;
        if (retryEl) retryEl.textContent = failedProducts.length;
    }

    function resetStats() {
        successCount = 0;
        errorCount = 0;
        failedProducts = [];
        updateStats();
    }

    // ========== ZBIERANIE ID PRODUKTOW ==========
    async function collectProductIds(mode, count, specificIds) {
        if (mode === 'ids') {
            return specificIds.split(',').map(function(id) { return id.trim(); }).filter(function(id) { return id; });
        }

        var ids = [];

        if (window.location.href.indexOf('/admin/product/edit') === -1) {
            var firstBtn = document.querySelector('.GF_Datagrid_go_to_first');
            if (firstBtn) firstBtn.click();
            await sleep(2000);

            var collecting = true;
            while (collecting && !shouldStop) {
                var rows = document.querySelectorAll('.GF_Datagrid .body tbody tr');
                rows.forEach(function(row) {
                    var idEl = row.querySelector('.GF_Datagrid_Row_Id');
                    if (idEl) {
                        var id = idEl.textContent.trim();
                        if (id && ids.indexOf(id) === -1) {
                            ids.push(id);
                        }
                    }
                });

                if (mode === 'count' && ids.length >= count) {
                    ids = ids.slice(0, count);
                    collecting = false;
                } else {
                    var recordsTotal = parseInt(document.querySelector('.GF_Datagrid_records_total').textContent);
                    var recordsTo = parseInt(document.querySelector('.GF_Datagrid_records_to').textContent);

                    if (recordsTo < recordsTotal) {
                        var nextBtn = document.querySelector('.GF_Datagrid_go_to_next');
                        if (nextBtn) {
                            nextBtn.click();
                            await sleep(2000);
                            updateStatus('Zbieranie ID: ' + ids.length + '...');
                        } else {
                            collecting = false;
                        }
                    } else {
                        collecting = false;
                    }
                }
            }
        }

        return ids;
    }

    // ========== LADOWANIE STRONY W IFRAME ==========
    function loadProductInIframe(productId, loadTime) {
        return new Promise(function(resolve, reject) {
            var startTime = Date.now();

            // Tworzymy unikalne iframe dla kazdego produktu (z timestamp zeby uniknac kolizji)
            var iframeId = 'product-loader-frame-' + productId + '-' + Date.now();
            var iframe = document.createElement('iframe');
            iframe.id = iframeId;
            iframe.style.cssText = 'position:fixed;left:-3000px;top:0;width:1920px;height:1080px;opacity:0.01;';
            document.body.appendChild(iframe);

            // Zwieksz licznik aktywnych iframe
            activeIframes++;
            if (activeIframes > maxActiveIframes) {
                maxActiveIframes = activeIframes;
            }
            updateDiagnostics();

            log('info', 'Tworze iframe, aktywnych: ' + activeIframes, productId);

            var url = window.location.origin + '/admin/product/edit/' + productId;
            var resolved = false;
            var cleanedUp = false; // Flaga zapobiegajaca wielokrotnemu cleanup

            function cleanup() {
                if (cleanedUp) return; // Zapobiegaj wielokrotnemu wywolaniu!
                cleanedUp = true;
                activeIframes = Math.max(0, activeIframes - 1); // Nigdy ponizej 0
                updateDiagnostics();
                try {
                    if (iframe && iframe.parentNode) {
                        iframe.parentNode.removeChild(iframe);
                    }
                } catch(e) {
                    // Ignoruj bledy przy usuwaniu
                }
            }

            var timeout = setTimeout(function() {
                if (resolved) return;
                resolved = true;
                var elapsed = Date.now() - startTime;
                timeoutCount++;
                log('error', 'TIMEOUT po ' + elapsed + 'ms (limit: ' + (loadTime + 15000) + 'ms)', productId);
                cleanup();
                resolve(null);
            }, loadTime + 15000);

            iframe.onload = function() {
                var loadElapsed = Date.now() - startTime;
                log('info', 'Iframe zaladowany w ' + loadElapsed + 'ms, czekam ' + loadTime + 'ms na dane...', productId);

                // Czekamy na poczatkowe zaladowanie
                setTimeout(async function() {
                    if (resolved) return;

                    try {
                        var doc = iframe.contentDocument || iframe.contentWindow.document;

                        // Sprawdz czy strona sie zaladowala poprawnie
                        var pageTitle = doc.title || '';
                        var hasForm = doc.querySelector('form') !== null;
                        var hasNameInput = doc.querySelector('input[name="basic_pane[language_data][1][name]"]') !== null;

                        log('info', 'Strona: "' + pageTitle.substring(0, 30) + '", form: ' + hasForm + ', nameInput: ' + hasNameInput, productId);

                        if (!hasNameInput) {
                            log('warn', 'Brak pola nazwy - strona mogla sie nie zaladowac poprawnie', productId);
                        }

                        // Lista zakladek do klikniecia (laduja dane przez AJAX)
                        var tabsToClick = ['Zdjęcia', 'Akcesoria', 'Produkty podobne', 'Sprzedaż krzyżowa'];

                        for (var i = 0; i < tabsToClick.length; i++) {
                            var tab = findTabByText(doc, tabsToClick[i]);
                            if (tab) {
                                tab.click();
                                // Czekamy na AJAX
                                await new Promise(function(r) { setTimeout(r, 1000); });
                            }
                        }

                        resolved = true;
                        clearTimeout(timeout);

                        var totalElapsed = Date.now() - startTime;
                        totalLoadTime += totalElapsed;
                        loadedCount++;
                        log('success', 'Pobrano dane w ' + totalElapsed + 'ms', productId);

                        // Usun iframe po pobraniu danych
                        cleanup();
                        resolve(doc);

                    } catch (e) {
                        if (resolved) return;
                        resolved = true;
                        iframeErrorCount++;
                        log('error', 'Blad dostepu do iframe: ' + e.message, productId);
                        clearTimeout(timeout);
                        cleanup();
                        resolve(null);
                    }
                }, loadTime);
            };

            iframe.onerror = function(e) {
                if (resolved) return;
                resolved = true;
                iframeErrorCount++;
                log('error', 'Blad ladowania iframe (onerror)', productId);
                clearTimeout(timeout);
                cleanup();
                resolve(null);
            };

            log('info', 'Laduje URL: ' + url, productId);
            iframe.src = url;
        });
    }

    function findTabByText(doc, text) {
        // Szukaj w roznych strukturach zakladek
        var selectors = [
            '.GFormNode a',
            '.tabs a',
            '.tab-nav a',
            'ul.nav a',
            'a[href*="photos"]',
            'span'
        ];

        for (var i = 0; i < selectors.length; i++) {
            var elements = doc.querySelectorAll(selectors[i]);
            for (var j = 0; j < elements.length; j++) {
                if (elements[j].textContent.trim() === text) {
                    return elements[j];
                }
            }
        }
        return null;
    }

    // ========== PARSOWANIE DANYCH PRODUKTU ==========
    async function fetchProductData(productId, loadTime) {
        try {
            var doc = await loadProductInIframe(productId, loadTime);

            if (!doc) {
                log('error', 'Doc jest null - iframe nie zwrocil dokumentu', productId);
                return { id: productId, error: 'Nie udalo sie zaladowac strony' };
            }

            var data = {
                id: productId
            };

            parseBasicInfo(doc, data);
            parseMetaInfo(doc, data);
            parseWarehouse(doc, data);
            parseCategories(doc, data);
            parsePrices(doc, data);
            parseMeasurements(doc, data);
            parseDescription(doc, data);
            parsePhotos(doc, data);
            parseRelatedProducts(doc, data);
            parseTechnicalData(doc, data);

            // Loguj co zostalo pobrane
            var fieldsCount = 0;
            var emptyFields = [];
            if (data.nazwa) fieldsCount++; else emptyFields.push('nazwa');
            if (data.ean) fieldsCount++; else emptyFields.push('ean');
            if (data.cena_sprzedazy_brutto && data.cena_sprzedazy_brutto !== '0.00') fieldsCount++; else emptyFields.push('cena');
            if (data.kategorie) fieldsCount++;
            if (data.ikona) fieldsCount++;

            if (fieldsCount >= 3) {
                log('success', 'Pobrano: ' + (data.nazwa || '').substring(0, 25) + '... (' + fieldsCount + ' pol)', productId);
            } else {
                log('warn', 'Niepelne dane! Brak: ' + emptyFields.join(', '), productId);
            }

            return data;
        } catch (e) {
            log('error', 'Wyjatek przy pobieraniu: ' + e.message, productId);
            return { id: productId, error: e.message };
        }
    }

    // ========== PARSERY DLA KAZDEJ ZAKLADKI ==========

    function getInputValue(doc, name) {
        var el = doc.querySelector('input[name="' + name + '"]');
        return el ? el.value : '';
    }

    function getTextareaValue(doc, name) {
        var el = doc.querySelector('textarea[name="' + name + '"]');
        return el ? el.value : '';
    }

    function getSelectValue(doc, name) {
        var el = doc.querySelector('select[name="' + name + '"]');
        if (!el) return '';
        var opt = el.options[el.selectedIndex];
        return opt ? opt.textContent.trim() : '';
    }

    function getCheckboxValue(doc, name) {
        var el = doc.querySelector('input[name="' + name + '"]');
        if (!el) return '';
        return (el.checked || el.value === '1') ? 'Tak' : 'Nie';
    }

    // Wykryj wszystkie jezyki sklepu z DOM: { '1': 'pl', '2': 'en', ... }
    function detectLanguages(doc) {
        var langMap = {};
        var reps = doc.querySelectorAll('.GFormRepetition');
        for (var i = 0; i < reps.length; i++) {
            var rep = reps[i];
            var flag = rep.querySelector('.flag-repetition img');
            if (!flag) continue;
            var anyField = rep.querySelector('[name*="language_data"]');
            if (!anyField) continue;
            var nameAttr = anyField.getAttribute('name') || '';
            var idMatch = nameAttr.match(/language_data\]\[(\d+)\]/);
            var srcAttr = flag.getAttribute('src') || flag.src || '';
            var codeMatch = srcAttr.match(/\/languages\/([a-z]+)_/i);
            if (idMatch && codeMatch) langMap[idMatch[1]] = codeMatch[1].toLowerCase();
        }
        if (Object.keys(langMap).length === 0) langMap['1'] = 'pl';
        return langMap;
    }

    function parseBasicInfo(doc, data) {
        var langs = detectLanguages(doc);
        data._languages = [];
        Object.keys(langs).forEach(function(langId) {
            var code = langs[langId];
            data._languages.push(code);
            data['nazwa_' + code] = getInputValue(doc, 'basic_pane[language_data][' + langId + '][name]');
            var seo = getInputValue(doc, 'basic_pane[language_data][' + langId + '][seo]');
            data['url_' + code] = seo ? window.location.origin + '/produkt/' + seo : '';
        });
        // Default (pierwszy jezyk) dla zachowania kompatybilnosci pol bez sufixu
        var firstCode = data._languages[0];
        if (firstCode) {
            data.nazwa = data['nazwa_' + firstCode];
            data.url = data['url_' + firstCode];
        }
        data.wyswietlany = getCheckboxValue(doc, 'basic_pane[enable]');
        data.zgodny_ze_zdjeciem = getCheckboxValue(doc, 'basic_pane[sameasphoto]');
        data.ean = getInputValue(doc, 'basic_pane[ean]');
        data.kod_dostawcy = getInputValue(doc, 'basic_pane[delivelercode]');
        data.producent = getSelectValue(doc, 'basic_pane[producerid]');
        data.dostawca = getSelectValue(doc, 'basic_pane[delivererid]');
    }

    function parseMetaInfo(doc, data) {
        var langs = detectLanguages(doc);
        Object.keys(langs).forEach(function(langId) {
            var code = langs[langId];
            data['seo_tytul_' + code] = getInputValue(doc, 'meta_data[language_data][' + langId + '][keywordtitle]');
            data['seo_opis_' + code] = getTextareaValue(doc, 'meta_data[language_data][' + langId + '][keyworddescription]');
            data['seo_slowa_kluczowe_' + code] = getTextareaValue(doc, 'meta_data[language_data][' + langId + '][keyword]');
        });
        var firstCode = data._languages && data._languages[0];
        if (firstCode) {
            data.seo_tytul = data['seo_tytul_' + firstCode];
            data.seo_opis = data['seo_opis_' + firstCode];
            data.seo_slowa_kluczowe = data['seo_slowa_kluczowe_' + firstCode];
        }
    }

    function parseWarehouse(doc, data) {
        data.stan_magazynowy = getInputValue(doc, 'stock_pane[stock]');
        data.dostepnosc = getSelectValue(doc, 'stock_pane[availablityid]');
    }

    function parseCategories(doc, data) {
        var categories = [];
        var checkedBoxes = doc.querySelectorAll('input[name="category_pane[category][]"]:checked');

        checkedBoxes.forEach(function(checkbox) {
            var path = buildCategoryPath(checkbox);
            if (path) {
                categories.push(path);
            }
        });

        data.kategorie = categories.join('\n');
    }

    function buildCategoryPath(checkbox) {
        var path = [];
        var currentLi = checkbox.closest('li');

        while (currentLi) {
            var label = currentLi.querySelector(':scope > label');
            if (label) {
                var text = label.textContent.trim();
                if (text) {
                    path.unshift(text);
                }
            }
            var parentUl = currentLi.parentElement;
            if (parentUl && parentUl.tagName === 'UL') {
                currentLi = parentUl.closest('li');
            } else {
                currentLi = null;
            }
        }

        return path.join('\\');
    }

    function parsePrices(doc, data) {
        data.grupa_cenowa = getSelectValue(doc, 'price_pane[pricegroupid]');
        data.stawka_vat = getSelectValue(doc, 'price_pane[vatid]');
        data.waluta_sprzedazy = getSelectValue(doc, 'price_pane[sellcurrencyid]');
        data.waluta_zakupu = getSelectValue(doc, 'price_pane[buycurrencyid]');

        data.cena_zakupu_netto = getInputValue(doc, 'price_pane[buyprice]');

        var vatRate = getVatRate(doc);
        var buyPriceNet = parseFloat(data.cena_zakupu_netto) || 0;
        data.cena_zakupu_brutto = (buyPriceNet * (1 + vatRate / 100)).toFixed(2);

        data.cena_sprzedazy_netto = getInputValue(doc, 'price_pane[standard_price][sellprice]');
        var sellPriceNet = parseFloat(data.cena_sprzedazy_netto) || 0;
        data.cena_sprzedazy_brutto = (sellPriceNet * (1 + vatRate / 100)).toFixed(2);

        data.cena_promocyjna_netto = getInputValue(doc, 'price_pane[standard_price][discountprice]');
        var promoPriceNet = parseFloat(data.cena_promocyjna_netto) || 0;
        data.cena_promocyjna_brutto = promoPriceNet > 0 ? (promoPriceNet * (1 + vatRate / 100)).toFixed(2) : '';

        data.data_rozpoczecia_promocji = getInputValue(doc, 'price_pane[standard_price][promotionstart]');
        data.data_zakonczenia_promocji = getInputValue(doc, 'price_pane[standard_price][promotionend]');
    }

    function getVatRate(doc) {
        var vatSelect = doc.querySelector('select[name="price_pane[vatid]"]');
        if (vatSelect) {
            var selectedOption = vatSelect.options[vatSelect.selectedIndex];
            if (selectedOption) {
                var text = selectedOption.textContent;
                var match = text.match(/(\d+)/);
                if (match) {
                    return parseInt(match[1]);
                }
            }
        }
        return 23;
    }

    function parseMeasurements(doc, data) {
        var weightKg = getInputValue(doc, 'weight_pane[weight]') || '0';
        data.waga_kg = weightKg;
        var weightNum = parseFloat(weightKg);
        data.waga_g = !isNaN(weightNum) ? Math.round(weightNum * 1000).toString() : '';

        data.szerokosc = getInputValue(doc, 'weight_pane[width]');
        data.wysokosc = getInputValue(doc, 'weight_pane[height]');
        data.glebokosc = getInputValue(doc, 'weight_pane[deepth]');
        data.jednostka_miary = getSelectValue(doc, 'weight_pane[unit]');
        data.ilosc_w_opakowaniu = getInputValue(doc, 'weight_pane[packagesize]');
    }

    function parseDescription(doc, data) {
        var langs = detectLanguages(doc);
        Object.keys(langs).forEach(function(langId) {
            var code = langs[langId];
            var prefix = 'description_pane[language_data][' + langId + ']';
            var shortDescHtml = getTextareaValue(doc, prefix + '[shortdescription]');
            data['opis_krotki_' + code] = stripHtml(shortDescHtml);
            data['opis_dlugi_html_' + code] = getTextareaValue(doc, prefix + '[description]');
            data['opis_dodatkowe_info_html_' + code] = getTextareaValue(doc, prefix + '[longdescription]');
            data['opis_rozszerzony_html_' + code] = data['opis_dlugi_html_' + code] +
                (data['opis_dodatkowe_info_html_' + code] ? '\n' + data['opis_dodatkowe_info_html_' + code] : '');
            data['slowa_wyszukiwarki_' + code] = getTextareaValue(doc, prefix + '[search_words]');
            data['youtube_id_' + code] = getInputValue(doc, prefix + '[yt1]');
            data['youtube_id_2_' + code] = getInputValue(doc, prefix + '[yt2]');
        });
        var firstCode = data._languages && data._languages[0];
        if (firstCode) {
            data.opis_krotki = data['opis_krotki_' + firstCode];
            data.opis_dlugi_html = data['opis_dlugi_html_' + firstCode];
            data.opis_dodatkowe_info_html = data['opis_dodatkowe_info_html_' + firstCode];
            data.opis_rozszerzony_html = data['opis_rozszerzony_html_' + firstCode];
            data.slowa_wyszukiwarki = data['slowa_wyszukiwarki_' + firstCode];
            data.youtube_id = data['youtube_id_' + firstCode];
            data.youtube_id_2 = data['youtube_id_2_' + firstCode];
        }
    }

    function parsePhotos(doc, data) {
        var photos = [];
        var mainPhoto = '';
        var mainPhotoId = '';

        // Znajdz ID glownego zdjecia z radio buttona
        var mainRadio = doc.querySelector('input[name="photos_pane[photo][main]"]:checked');
        if (mainRadio) {
            mainPhotoId = mainRadio.value;
        }

        // Wyciagnij rozszerzenia z miniaturek w DOM-ie:
        // np. /design/_gallery/_301_301_3/52131.png -> { '52131': 'png' }
        // Rozszerzenia roznia sie miedzy sklepami (febetrade: png, poscielone: jpg)
        // i moga byc rozne dla poszczegolnych zdjec w tym samym produkcie
        var thumbs = doc.querySelectorAll('img[src*="/_gallery/"]');
        var extByPhotoId = {};
        var defaultExt = 'jpg';
        thumbs.forEach(function(img) {
            var src = img.getAttribute('src') || img.src || '';
            var m = src.match(/\/(\d+)\.(jpg|jpeg|png|gif)(?:[?#]|$)/i);
            if (m) {
                extByPhotoId[m[1]] = m[2].toLowerCase();
                defaultExt = m[2].toLowerCase();
            }
        });

        function buildPhotoUrl(photoId) {
            var ext = extByPhotoId[photoId] || defaultExt;
            return window.location.origin + '/design/_gallery/_orginal/' + photoId + '.' + ext;
        }

        // Pobierz ID zdjec z ukrytych inputow photos_pane[photo][0], [1], [2]...
        var photoInputs = doc.querySelectorAll('input[type="hidden"][name^="photos_pane[photo]["]');
        photoInputs.forEach(function(input) {
            var name = input.name;
            // Tylko inputy z numerami: photos_pane[photo][0], photos_pane[photo][1], etc.
            if (/photos_pane\[photo\]\[\d+\]/.test(name)) {
                var photoId = input.value;
                if (photoId) {
                    var url = buildPhotoUrl(photoId);
                    if (photos.indexOf(url) === -1) {
                        photos.push(url);
                    }
                }
            }
        });

        // Ustaw glowne zdjecie
        if (mainPhotoId) {
            mainPhoto = buildPhotoUrl(mainPhotoId);
            // Przenies na pierwsza pozycje
            var idx = photos.indexOf(mainPhoto);
            if (idx > 0) {
                photos.splice(idx, 1);
                photos.unshift(mainPhoto);
            } else if (idx === -1) {
                photos.unshift(mainPhoto);
            }
        }

        // Fallback - pierwsze zdjecie jako glowne
        if (!mainPhoto && photos.length > 0) {
            mainPhoto = photos[0];
        }

        data.galeria = photos.join('\n');
        data.ikona = mainPhoto;
    }

    function parseRelatedProducts(doc, data) {
        data.akcesoria = getRelatedByLegend(doc, 'Akcesoria');
        data.produkty_podobne = getRelatedByLegend(doc, 'Produkty podobne');
        data.sprzedaz_krzyzowa = getRelatedByLegend(doc, 'Sprzedaż krzyżowa');
    }

    function getRelatedByLegend(doc, legendText) {
        var ids = [];
        var fieldsets = doc.querySelectorAll('fieldset');
        for (var i = 0; i < fieldsets.length; i++) {
            var legend = fieldsets[i].querySelector('legend');
            if (legend && legend.textContent.trim() === legendText) {
                var rowIds = fieldsets[i].querySelectorAll('.GF_Datagrid_Row_Id');
                rowIds.forEach(function(el) {
                    var id = el.textContent.trim();
                    if (id && ids.indexOf(id) === -1) {
                        ids.push(id);
                    }
                });
                break;
            }
        }
        return ids.join(',');
    }

    function parseTechnicalData(doc, data) {
        var params = [];

        // Szukamy labeli z nazwami atrybutow po ID
        // Format: label[for="tech_pane__techset_paneX__techset-X-"]
        for (var i = 1; i <= 20; i++) {
            var labelId = 'tech_pane__techset_pane' + i + '__techset-' + i + '-';
            var labelEl = doc.querySelector('label[for="' + labelId + '"]');

            if (!labelEl) continue;

            var attrName = labelEl.textContent.trim();
            if (!attrName) continue;

            // Sprawdz SELECT
            var selectEl = doc.querySelector('select[name="tech_pane[techset_pane' + i + '][techset-' + i + '-]"]');
            if (selectEl && selectEl.selectedIndex > 0) {
                var selectedText = selectEl.options[selectEl.selectedIndex].textContent.trim();
                if (selectedText && selectedText !== '--- wybierz ---' && selectedText !== '') {
                    params.push(attrName + '\\' + selectedText);
                }
                continue;
            }

            // Sprawdz CHECKBOXY (multiselect)
            var checkboxes = doc.querySelectorAll('input[type="checkbox"][name="tech_pane[techset_pane' + i + '][techset-' + i + '-][]"]:checked');
            checkboxes.forEach(function(cb) {
                var labelParent = cb.closest('label');
                if (labelParent) {
                    var valueText = labelParent.textContent.trim();
                    if (valueText) {
                        params.push(attrName + '\\' + valueText);
                    }
                }
            });
        }

        data.dane_techniczne = params.join('\n');
    }

    // ========== FUNKCJE POMOCNICZE ==========

    function stripHtml(html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    function sleep(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    // ========== EKSPORT CSV ==========

    function exportToCSV(products, suffix) {
        suffix = suffix || '';

        // Zbierz wszystkie kody jezykow ze wszystkich produktow (zachowuj kolejnosc pojawiania)
        var allLangs = [];
        var seenLangs = {};
        products.forEach(function(p) {
            if (p && p._languages) {
                p._languages.forEach(function(code) {
                    if (!seenLangs[code]) { seenLangs[code] = true; allLangs.push(code); }
                });
            }
        });
        if (allLangs.length === 0) allLangs = ['pl'];

        // Definicja kolumn: addCol = pojedyncza kolumna, addMulti = jedna kolumna per jezyk
        var cols = [];
        function addCol(header, getter) { cols.push({ header: header, get: getter }); }
        function addMulti(label, dataKey) {
            allLangs.forEach(function(code) {
                cols.push({
                    header: label + '_' + code,
                    get: function(p) {
                        var key = dataKey + '_' + code;
                        if (p[key] !== undefined) return p[key];
                        // Backward compat: stare produkty (sprzed v3.8) maja tylko pole bez sufixu
                        if (code === allLangs[0]) return p[dataKey];
                        return '';
                    }
                });
            });
        }

        addCol('ID', function(p) { return p.id; });
        addCol('STATUS_POBRANIA', function(p) { return getValidationStatus(p); });
        addMulti('Nazwa', 'nazwa');
        addMulti('URL', 'url');
        addCol('Wyswietlany', function(p) { return p.wyswietlany; });
        addCol('Zgodny ze zdjeciem', function(p) { return p.zgodny_ze_zdjeciem; });
        addCol('EAN', function(p) { return p.ean; });
        addCol('Kod dostawcy', function(p) { return p.kod_dostawcy; });
        addCol('Producent', function(p) { return p.producent; });
        addCol('Dostawca', function(p) { return p.dostawca; });
        addMulti('SEO Tytul', 'seo_tytul');
        addMulti('SEO Opis', 'seo_opis');
        addMulti('SEO Slowa kluczowe', 'seo_slowa_kluczowe');
        addCol('Stan magazynowy', function(p) { return p.stan_magazynowy; });
        addCol('Dostepnosc', function(p) { return p.dostepnosc; });
        addCol('Kategorie', function(p) { return p.kategorie; });
        addCol('Grupa cenowa', function(p) { return p.grupa_cenowa; });
        addCol('Stawka VAT', function(p) { return p.stawka_vat; });
        addCol('Waluta sprzedazy', function(p) { return p.waluta_sprzedazy; });
        addCol('Waluta zakupu', function(p) { return p.waluta_zakupu; });
        addCol('Cena zakupu netto', function(p) { return p.cena_zakupu_netto; });
        addCol('Cena zakupu brutto', function(p) { return p.cena_zakupu_brutto; });
        addCol('Cena sprzedazy netto', function(p) { return p.cena_sprzedazy_netto; });
        addCol('Cena sprzedazy brutto', function(p) { return p.cena_sprzedazy_brutto; });
        addCol('Cena promocyjna netto', function(p) { return p.cena_promocyjna_netto; });
        addCol('Cena promocyjna brutto', function(p) { return p.cena_promocyjna_brutto; });
        addCol('Data rozpoczecia promocji', function(p) { return p.data_rozpoczecia_promocji; });
        addCol('Data zakonczenia promocji', function(p) { return p.data_zakonczenia_promocji; });
        addCol('Waga (kg)', function(p) { return p.waga_kg; });
        addCol('Waga (g)', function(p) { return p.waga_g; });
        addCol('Szerokosc', function(p) { return p.szerokosc; });
        addCol('Wysokosc', function(p) { return p.wysokosc; });
        addCol('Glebokosc', function(p) { return p.glebokosc; });
        addCol('Jednostka miary', function(p) { return p.jednostka_miary; });
        addCol('Ilosc w opakowaniu', function(p) { return p.ilosc_w_opakowaniu; });
        addMulti('Opis krotki', 'opis_krotki');
        addMulti('Opis dlugi (HTML)', 'opis_dlugi_html');
        addMulti('Opis dodatkowe info (HTML)', 'opis_dodatkowe_info_html');
        addMulti('Opis rozszerzony (HTML)', 'opis_rozszerzony_html');
        addMulti('Slowa wyszukiwarki', 'slowa_wyszukiwarki');
        addMulti('YouTube ID', 'youtube_id');
        addMulti('YouTube ID 2', 'youtube_id_2');
        addCol('Galeria', function(p) { return p.galeria; });
        addCol('Ikona', function(p) { return p.ikona; });
        addCol('Akcesoria', function(p) { return p.akcesoria; });
        addCol('Produkty podobne', function(p) { return p.produkty_podobne; });
        addCol('Sprzedaz krzyzowa', function(p) { return p.sprzedaz_krzyzowa; });
        addCol('Dane techniczne', function(p) { return p.dane_techniczne; });

        var escapeCSV = function(value) {
            if (value === null || value === undefined) return '';
            var str = String(value);
            if (str.indexOf(';') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };

        var csv = cols.map(function(c) { return c.header; }).join(';') + '\n';
        products.forEach(function(p) {
            var row = cols.map(function(c) { return escapeCSV(c.get(p)); }).join(';');
            csv += row + '\n';
        });

        var BOM = '\uFEFF';
        var blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        var link = document.createElement('a');
        var url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', 'produkty_szczegoly_' + new Date().toISOString().slice(0,10) + suffix + '.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // ========== GLOWNA FUNKCJA EKSPORTU ==========

    async function startDetailExport() {
        if (isExporting) return;

        isExporting = true;
        shouldStop = false;
        exportedProducts = [];
        resetStats();
        resetDiagnostics();
        startWatchdog(); // Uruchom watchdog

        log('info', '=== ROZPOCZYNAM EKSPORT v3.5 ===');

        document.getElementById('start-export').classList.add('hidden');
        document.getElementById('stop-export').classList.remove('hidden');

        var mode = document.getElementById('export-mode').value;
        var count = parseInt(document.getElementById('export-count').value) || 10;
        var ids = document.getElementById('export-ids').value;
        var loadTime = parseInt(document.getElementById('export-delay').value) || 2500;
        var resumeFromId = document.getElementById('resume-from-id').value.trim();
        var parallelCount = parseInt(document.getElementById('parallel-count').value) || 1;

        updateStatus('Zbieranie listy produktow...');

        var productIds = await collectProductIds(mode, count, ids);

        if (productIds.length === 0) {
            updateStatus('Nie znaleziono produktow do eksportu');
            isExporting = false;
            document.getElementById('start-export').classList.remove('hidden');
            document.getElementById('stop-export').classList.add('hidden');
            return;
        }

        // Wznowienie od podanego ID - filtrujemy wg kierunku
        if (resumeFromId) {
            var resumeIdNum = parseInt(resumeFromId);
            var direction = document.getElementById('resume-direction').value;
            var originalCount = productIds.length;

            if (direction === 'down') {
                // W dol - tylko ID nizsze niz podane
                productIds = productIds.filter(function(id) {
                    return parseInt(id) < resumeIdNum;
                });
                updateStatus('Filtruje ID < ' + resumeFromId + ', zostalo ' + productIds.length + ' z ' + originalCount);
            } else {
                // W gore - tylko ID wyzsze niz podane
                productIds = productIds.filter(function(id) {
                    return parseInt(id) > resumeIdNum;
                });
                updateStatus('Filtruje ID > ' + resumeFromId + ', zostalo ' + productIds.length + ' z ' + originalCount);
            }
        }

        totalToExport = productIds.length;
        updateStatus('Znaleziono ' + totalToExport + ' produktow. Pobieranie po ' + parallelCount + ' naraz...');
        log('info', 'Znaleziono ' + totalToExport + ' produktow do pobrania');
        log('info', 'Ustawienia: loadTime=' + loadTime + 'ms, parallel=' + parallelCount);

        // Pobieranie w partiach (rownoleglo)
        try {
            for (var i = 0; i < productIds.length && !shouldStop; i += parallelCount) {
                tickWatchdog(); // Resetuj watchdog na poczatku kazdej partii

                var batch = productIds.slice(i, Math.min(i + parallelCount, productIds.length));
                var batchNum = Math.floor(i / parallelCount) + 1;
                var totalBatches = Math.ceil(productIds.length / parallelCount);

                currentIndex = Math.min(i + parallelCount, productIds.length);
                updateProgress(currentIndex, totalToExport);
                updateStatus('Pobieranie ' + (i + 1) + '-' + currentIndex + ' z ' + totalToExport + '...');

                log('info', '--- PARTIA ' + batchNum + '/' + totalBatches + ' (ID: ' + batch.join(', ') + ') ---');

                // Pobierz partie rownolegle z timeout zabezpieczeniem
                var batchStartTime = Date.now();
                var batchPromises = batch.map(function(productId) {
                    var timerId;
                    var fetchPromise = fetchProductData(productId, loadTime).finally(function() {
                        clearTimeout(timerId);
                    });
                    var timeoutPromise = new Promise(function(resolve) {
                        timerId = setTimeout(function() {
                            log('error', 'BATCH TIMEOUT dla produktu ' + productId, productId);
                            resolve({ id: productId, error: 'Batch timeout' });
                        }, loadTime + 30000); // 30s timeout na caly batch
                    });
                    return Promise.race([fetchPromise, timeoutPromise]);
                });

                var batchResults;
                try {
                    batchResults = await Promise.all(batchPromises);
                } catch (batchError) {
                    log('error', 'BLAD Promise.all: ' + batchError.message);
                    console.error('Batch error:', batchError);
                    // Kontynuuj z pustymi wynikami
                    batchResults = batch.map(function(id) { return { id: id, error: 'Batch failed' }; });
                }

                var batchTime = Date.now() - batchStartTime;
                log('info', 'Partia ' + batchNum + ' zakonczona w ' + batchTime + 'ms');
                tickWatchdog(); // Resetuj watchdog po zakonczeniu partii

                batchResults.forEach(function(productData, idx) {
                    var status = getValidationStatus(productData);
                    if (isValidProduct(productData)) {
                        exportedProducts.push(productData);
                        successCount++;
                        console.log('[OK] Produkt ' + batch[idx] + ': ' + (productData.nazwa || 'bez nazwy'));
                    } else {
                        failedProducts.push({ id: batch[idx], data: productData, retries: 0 });
                        errorCount++;
                        console.warn('[BLAD] Produkt ' + batch[idx] + ': ' + status);
                    }
                    updateStats();
                });

                // Auto-zapis co AUTO_SAVE_INTERVAL produktow
                if ((successCount + errorCount) % AUTO_SAVE_INTERVAL === 0) {
                    saveProgress(productIds, i + batch.length);
                    log('info', 'Auto-zapis wykonany');
                }

                // Eksport czesciowy co AUTO_EXPORT_INTERVAL produktow
                if (exportedProducts.length > 0 && exportedProducts.length % AUTO_EXPORT_INTERVAL === 0) {
                    exportToCSV(exportedProducts, '_czesc' + Math.floor(exportedProducts.length / AUTO_EXPORT_INTERVAL));
                    updateStatus('Wyeksportowano czesc ' + Math.floor(exportedProducts.length / AUTO_EXPORT_INTERVAL) + ', kontynuuje...');
                }

                // Pauza miedzy partiami przy wiekszym rownoleglym pobieraniu
                if (parallelCount > 1 && !shouldStop) {
                    var pauseTime = parallelCount * 300; // 300ms na kazdy rownolegle pobierany produkt
                    log('info', 'Pauza ' + pauseTime + 'ms przed nastepna partia...');
                    await sleep(pauseTime);
                }
            }
        } catch (loopError) {
            log('error', 'KRYTYCZNY BLAD W PETLI: ' + loopError.message);
            console.error('Critical loop error:', loopError);
            updateStatus('BLAD: ' + loopError.message);
        }

        // ========== RETRY DLA NIEUDANYCH ==========
        if (!shouldStop && failedProducts.length > 0) {
            log('info', '=== ROZPOCZYNAM RETRY dla ' + failedProducts.length + ' produktow ===');
            updateStatus('Ponawiam probe dla ' + failedProducts.length + ' nieudanych produktow...');
            await sleep(2000);

            var retryList = failedProducts.filter(function(p) { return p.retries < MAX_RETRIES; });
            failedProducts = [];

            try {
                for (var r = 0; r < retryList.length && !shouldStop; r++) {
                    tickWatchdog(); // Resetuj watchdog
                    var retryItem = retryList[r];
                    retryItem.retries++;
                    log('info', 'RETRY ' + (r+1) + '/' + retryList.length + ' dla ID ' + retryItem.id);
                    updateStatus('RETRY ' + retryItem.retries + '/' + MAX_RETRIES + ' dla ID ' + retryItem.id + ' (' + (r+1) + '/' + retryList.length + ')');

                    // Pobierz pojedynczo z dluzszym czasem oczekiwania i timeout
                    var retryData;
                    try {
                        retryData = await Promise.race([
                            fetchProductData(retryItem.id, loadTime + 2000),
                            new Promise(function(resolve) {
                                setTimeout(function() {
                                    log('error', 'RETRY TIMEOUT dla ' + retryItem.id, retryItem.id);
                                    resolve({ id: retryItem.id, error: 'Retry timeout' });
                                }, loadTime + 35000);
                            })
                        ]);
                    } catch (retryFetchError) {
                        log('error', 'RETRY FETCH ERROR: ' + retryFetchError.message, retryItem.id);
                        retryData = { id: retryItem.id, error: retryFetchError.message };
                    }

                    if (isValidProduct(retryData)) {
                        exportedProducts.push(retryData);
                        successCount++;
                        errorCount--;
                        log('success', 'RETRY OK dla ' + retryItem.id, retryItem.id);
                    } else if (retryItem.retries < MAX_RETRIES) {
                        failedProducts.push(retryItem);
                        log('warn', 'RETRY BLAD dla ' + retryItem.id + ' - proba ' + retryItem.retries, retryItem.id);
                    } else {
                        retryData.error = retryData.error || 'Nie udalo sie pobrac po ' + MAX_RETRIES + ' probach';
                        exportedProducts.push(retryData);
                        log('error', 'RETRY PORAZKA dla ' + retryItem.id, retryItem.id);
                    }
                    updateStats();
                    await sleep(500);
                }
            } catch (retryLoopError) {
                log('error', 'BLAD W PETLI RETRY: ' + retryLoopError.message);
                console.error('Retry loop error:', retryLoopError);
            }
        }

        // Zatrzymaj watchdog
        stopWatchdog();
        log('info', '=== EKSPORT ZAKONCZONY ===');

        // Zapisz postep przy zatrzymaniu
        if (shouldStop) {
            saveProgress(productIds, currentIndex);
            updateStatus('Zatrzymano. OK: ' + successCount + ', Bledy: ' + errorCount + '. Mozesz wznowic pozniej.');
        } else {
            updateStatus('Zakoczono! Generowanie pliku CSV...');
            await clearProgress(); // Wyczysc zapis po ukonczeniu
        }

        if (exportedProducts.length > 0) {
            exportToCSV(exportedProducts, '_final');
            updateStatus('Gotowe! OK: ' + successCount + ', Bledy: ' + (errorCount > 0 ? errorCount + ' (zapisane z bledem)' : '0'));
        }

        isExporting = false;
        document.getElementById('start-export').classList.remove('hidden');
        document.getElementById('stop-export').classList.add('hidden');
        checkSavedProgress();
    }

    // ========== DODAJ PRZYCISK DO PANELU ==========

    function addExportButton() {
        var possibilities = document.querySelector('.possibilities');
        if (possibilities && !document.getElementById('detail-export-btn')) {
            var li = document.createElement('li');
            li.innerHTML = '<a href="#" id="detail-export-btn" class="button" title="Eksportuj szczegoly produktow">' +
                '<span><img src="' + window.location.origin + '/design/_images_panel/icons/buttons/add.png" alt="">Eksport szczeg.</span>' +
            '</a>';
            possibilities.appendChild(li);

            document.getElementById('detail-export-btn').addEventListener('click', function(e) {
                e.preventDefault();
                var ui = document.getElementById('detail-export-ui');
                if (ui) {
                    ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
                } else {
                    createUI();
                }
            });
        }
    }

    // ========== INICJALIZACJA ==========

    function init() {
        if (document.querySelector('.possibilities')) {
            addExportButton();
            createUI();
        } else {
            setTimeout(init, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
