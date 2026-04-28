// ==UserScript==
// @name         IdoSell - Masowe stany magazynowe
// @namespace    https://idosell.com/
// @version      1.1.1
// @description  Masowe ustawianie trybu gospodarki, stanu JEST/NIEMA i ilości na konkretnych magazynach dla zaznaczonych towarów
// @author       SyncOffer
// @match        https://*.iai-shop.com/panel/app/products-list.php*
// @match        https://*.idosell.com/panel/app/products-list.php*
// @grant        none
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

    function getSelectedProductIds(doc) {
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
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch { resolve({ raw: xhr.responseText }); }
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
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch { resolve({ raw: xhr.responseText }); }
                } else reject(new Error('HTTP ' + xhr.status));
            };
            xhr.onerror = () => reject(new Error('Błąd sieci'));
            xhr.send(body);
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

    function setManagementType(win, productId, type) {
        return ajaxGet(win, `/panel/ajax/product-edit.php?function=ajaxChangeAvailabilityManagementType&productId=${productId}&type=${type}`);
    }
    function massSetAvailable(win, productId) {
        return ajaxGet(win, `/panel/ajax/product-edit.php?function=ajaxMassSetAvailability&productId=${productId}`);
    }
    function getSizesDisplay(win, productId) {
        return rawGet(win, `/panel/ajax/product-edit.php?function=ajaxSizesDisplayByProductId&menu=n&productId=${productId}`);
    }
    /** Pobiera tabelę rozmiarów (właściwy sizeId per produkt) */
    function getSizesTable(win, productId) {
        const url = `/panel/ajax/product-edit-aceform-tables.php?name=sizes&idt=${productId}`;
        return new Promise((resolve, reject) => {
            const xhr = new win.XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error('HTTP ' + xhr.status));
            xhr.onerror = () => reject(new Error('Błąd sieci'));
            xhr.send('id=sizesTable&url=' + encodeURIComponent(url));
        });
    }
    function changeAvailability(win, productId, stockId, sizeId, status) {
        return ajaxGet(win, `/panel/ajax/product-edit.php?function=ajaxChangeAvailability&productId=${productId}&stockId=${stockId}&sizeId=${sizeId}&status=${status}`);
    }
    function cleanQuantity(win, productIds, types) {
        const products = productIds.map(id => ({ id }));
        const body = 'products=' + encodeURIComponent(JSON.stringify(products))
            + '&types=' + encodeURIComponent(JSON.stringify(types));
        return ajaxPost(win, '/panel/ajax/product-reservations.php?action=cleanQuantity', body);
    }

    /** Pobiera listę magazynów z /panel/stocks.php */
    async function fetchWarehouses(win) {
        const html = await rawGet(win, '/panel/stocks.php');
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const warehouses = [];
        // Mapowanie code → stockId — wyciągane z linków (np. /panel/stock.php?action=edit&id=X w wierszu)
        // Standardowa mapa kodów IdoSell:
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

                // Spróbuj wyciągnąć ID z linku w wierszu
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
                // Fallback do standardowej mapy
                if (stockId === null && standardMap[code] !== undefined) {
                    stockId = standardMap[code];
                }

                if (stockId !== null) {
                    warehouses.push({ code, name, stockId });
                }
            });
            break;
        }

        // Domyślny: jeśli nic nie znaleziono, zwróć przynajmniej M0 i M1
        if (!warehouses.length) {
            warehouses.push({ code: 'M0', name: 'Magazyn obcy', stockId: 0 });
            warehouses.push({ code: 'M1', name: 'Magazyn główny', stockId: 1 });
        }
        return warehouses;
    }

    /** Wyciąga rozmiary (sizeId) z aceform-tables.php?name=sizes */
    function parseSizesFromTable(html) {
        const sizes = new Set();
        // Pattern: name="codes_producer[XXX]" lub codes_extern[XXX]
        const re1 = /name="codes_(?:producer|extern)\[([^\]]+)\]"/g;
        let m;
        while ((m = re1.exec(html)) !== null) {
            const sid = m[1];
            if (sid) sizes.add(sid);
        }
        // Pattern: id="sizesTablesizes_popup_XXX_..."
        const re2 = /id="sizesTablesizes_popup_([^_]+)_/g;
        while ((m = re2.exec(html)) !== null) {
            const sid = m[1];
            if (sid) sizes.add(sid);
        }
        return Array.from(sizes);
    }

    /* ═══════════════════════════════════════════
       MODAL
       ═══════════════════════════════════════════ */
    const MODAL_CSS = `
        .bs-overlay { position:fixed;inset:0;background:rgba(33,37,41,.6);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px); }
        .bs-modal { background:#fff;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.2);width:600px;max-height:90vh;overflow-y:auto;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#222; }
        .bs-hdr { padding:18px 24px;border-bottom:1px solid #e0e0e0;font-size:16px;font-weight:600;display:flex;justify-content:space-between;align-items:center; }
        .bs-hdr .bs-x { cursor:pointer;font-size:24px;color:#888;line-height:1; }
        .bs-hdr .bs-x:hover { color:#111; }
        .bs-bd { padding:24px; }
        .bs-bd label { display:block;font-weight:500;margin:14px 0 6px;font-size:13px;color:#444; }
        .bs-bd label:first-child { margin-top:0; }
        .bs-bd select, .bs-bd input[type=text], .bs-bd input[type=number] {
            width:100%;padding:8px 12px;border:1px solid #caced1;border-radius:4px;
            font-size:13px;box-sizing:border-box;color:#333;background:#fff;outline:none;
        }
        .bs-bd select:focus, .bs-bd input:focus { border-color:#1d70b8;box-shadow:0 0 0 3px rgba(29,112,184,0.15); }
        .bs-radio-group { display:flex;flex-direction:column;gap:8px;margin-top:6px; }
        .bs-radio-group label { display:flex;align-items:center;gap:8px;font-weight:normal;margin:0;cursor:pointer;padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;transition:.15s; }
        .bs-radio-group label:hover { border-color:#cbd5e1;background:#f8fafc; }
        .bs-radio-group label.bs-checked { border-color:#1d70b8;background:#f4f8fb; }
        .bs-radio-group input[type=radio] { width:auto;margin:0; }
        .bs-section { background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 16px;margin-top:14px; }
        .bs-section.bs-hidden { display:none; }
        .bs-summary { background:#f4f8fb;border-left:4px solid #1d70b8;padding:10px 14px;font-size:13px;margin-bottom:8px;border-radius:0 4px 4px 0; }
        .bs-warehouses { display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px; }
        .bs-warehouses label { display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-weight:500;font-size:13px;margin:0;transition:.15s; }
        .bs-warehouses label:hover { background:#f8fafc;border-color:#cbd5e1; }
        .bs-warehouses label.bs-checked { background:#f4f8fb;border-color:#1d70b8; }
        .bs-warehouses input { width:auto;margin:0; }
        .bs-warehouses .bs-wh-code { font-family:ui-monospace,monospace;font-weight:700;color:#1d70b8;min-width:30px; }
        .bs-warehouses .bs-wh-name { color:#555;font-size:12px;font-weight:normal; }
        .bs-loader { padding:20px;text-align:center;color:#888;font-size:13px; }
        .bs-ft { padding:14px 24px;border-top:1px solid #e0e0e0;background:#fafafa;text-align:right;border-radius:0 0 6px 6px; }
        .bs-btn { padding:8px 20px;border:1px solid transparent;border-radius:4px;font-size:13px;cursor:pointer;font-weight:500;margin-left:10px; }
        .bs-btn-blue { background:#1d70b8;color:#fff; }
        .bs-btn-blue:hover { background:#155994; }
        .bs-btn-blue:disabled { background:#a3c3df;cursor:not-allowed; }
        .bs-btn-gray { background:#fff;color:#444;border-color:#caced1; }
        .bs-btn-gray:hover { background:#f1f3f4; }
        .bs-progress { margin-top:16px;display:none; }
        .bs-bar { height:14px;background:#e9ecef;border-radius:7px;overflow:hidden;position:relative; }
        .bs-bar-fill { height:100%;background:#1d70b8;width:0;transition:width .3s; }
        .bs-bar-text { position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#333; }
        .bs-log { margin-top:10px;max-height:180px;overflow-y:auto;font-size:12px;font-family:ui-monospace,monospace;background:#1e1e1e;color:#ddd;border-radius:6px;padding:10px;line-height:1.5; }
        .bs-log .ok { color:#4caf50; }
        .bs-log .err { color:#f44336; }
        .bs-log .warn { color:#ff9800; }
    `;

    async function openModal(doc, win, productIds) {
        const ov = doc.createElement('div');
        ov.className = 'bs-overlay';
        ov.innerHTML = `<style>${MODAL_CSS}</style>
        <div class="bs-modal">
            <div class="bs-hdr">
                <span>Masowe ustawianie stanów magazynowych</span>
                <span class="bs-x" id="bs-close">&times;</span>
            </div>
            <div class="bs-bd">
                <div class="bs-summary">Zaznaczonych towarów: <b>${productIds.length}</b></div>

                <label>Tryb gospodarki magazynowej</label>
                <div class="bs-radio-group" id="bs-mode">
                    <label class="bs-checked"><input type="radio" name="bs-mode" value="manual" checked> Ręczna (JEST/NIEMA)</label>
                    <label><input type="radio" name="bs-mode" value="auto"> Automatyczna (na podstawie ilości w magazynach)</label>
                    <label><input type="radio" name="bs-mode" value="skip"> Nie zmieniaj trybu</label>
                </div>

                <!-- Tryb ręczny -->
                <div class="bs-section" id="bs-sec-manual">
                    <label style="margin-top:0">Akcja w trybie ręcznym</label>
                    <div class="bs-radio-group" id="bs-manual-action">
                        <label class="bs-checked"><input type="radio" name="bs-manual-action" value="all_jest" checked> Wszystkie magazyny → <b>JEST</b></label>
                        <label><input type="radio" name="bs-manual-action" value="per_wh"> Wybrane magazyny → ustaw stan</label>
                        <label><input type="radio" name="bs-manual-action" value="none"> Nie ustawiaj stanu — tylko zmień tryb</label>
                    </div>

                    <div id="bs-manual-perwh" class="bs-hidden" style="margin-top:14px">
                        <label style="margin-top:0">Stan na wybranych magazynach</label>
                        <div class="bs-radio-group" id="bs-status">
                            <label class="bs-checked"><input type="radio" name="bs-status" value="y" checked> JEST (dostępny)</label>
                            <label><input type="radio" name="bs-status" value="n"> NIEMA (niedostępny)</label>
                        </div>

                        <label>Magazyny</label>
                        <div class="bs-warehouses" id="bs-wh-list">
                            <div class="bs-loader">Ładowanie listy magazynów...</div>
                        </div>
                    </div>
                </div>

                <!-- Tryb automatyczny -->
                <div class="bs-section bs-hidden" id="bs-sec-auto">
                    <label style="margin-top:0;display:flex;align-items:center;gap:8px;font-weight:normal">
                        <input type="checkbox" id="bs-clean" style="width:auto"> Wyzeruj stany magazynowe (na M0)
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;font-weight:normal">
                        <input type="checkbox" id="bs-clean-reservations" style="width:auto"> Dodatkowo wycofaj wszystkie rezerwacje
                    </label>
                </div>

                <div class="bs-progress" id="bs-progress">
                    <div class="bs-bar">
                        <div class="bs-bar-fill" id="bs-bar-fill"></div>
                        <div class="bs-bar-text" id="bs-bar-text">0%</div>
                    </div>
                    <div class="bs-log" id="bs-log"></div>
                </div>
            </div>
            <div class="bs-ft">
                <button class="bs-btn bs-btn-gray" id="bs-cancel">Anuluj</button>
                <button class="bs-btn bs-btn-blue" id="bs-apply">Zastosuj do zaznaczonych</button>
            </div>
        </div>`;
        doc.body.appendChild(ov);

        const close = () => ov.remove();
        ov.querySelector('#bs-close').onclick = close;
        ov.querySelector('#bs-cancel').onclick = close;
        ov.addEventListener('click', e => { if (e.target === ov) close(); });

        function refreshChecked(group) {
            ov.querySelectorAll(`#${group} label`).forEach(lab => {
                const cb = lab.querySelector('input[type=radio], input[type=checkbox]');
                lab.classList.toggle('bs-checked', cb && cb.checked);
            });
        }

        ov.querySelectorAll('input[type=radio]').forEach(r => {
            r.addEventListener('change', () => {
                const grp = r.closest('.bs-radio-group, .bs-warehouses');
                if (grp && grp.id) refreshChecked(grp.id);

                if (r.name === 'bs-mode') {
                    ov.querySelector('#bs-sec-manual').classList.toggle('bs-hidden', r.value !== 'manual');
                    ov.querySelector('#bs-sec-auto').classList.toggle('bs-hidden', r.value !== 'auto');
                }
                if (r.name === 'bs-manual-action') {
                    ov.querySelector('#bs-manual-perwh').classList.toggle('bs-hidden', r.value !== 'per_wh');
                }
            });
        });

        // Pobierz listę magazynów
        let warehouses = [];
        try {
            warehouses = await fetchWarehouses(win);
            const list = ov.querySelector('#bs-wh-list');
            list.innerHTML = warehouses.map(w => `
                <label>
                    <input type="checkbox" name="bs-wh" value="${w.stockId}" ${w.code === 'M1' ? 'checked' : ''}>
                    <span class="bs-wh-code">${escapeHtml(w.code)}</span>
                    <span class="bs-wh-name">${escapeHtml(w.name)}</span>
                </label>
            `).join('');
            list.querySelectorAll('input').forEach(cb => {
                cb.addEventListener('change', () => {
                    cb.closest('label').classList.toggle('bs-checked', cb.checked);
                });
                if (cb.checked) cb.closest('label').classList.add('bs-checked');
            });
        } catch (e) {
            ov.querySelector('#bs-wh-list').innerHTML = `<div class="bs-loader" style="color:#d93025">Błąd pobierania: ${escapeHtml(e.message)}</div>`;
        }

        const log = (msg, cls) => {
            const logBox = ov.querySelector('#bs-log');
            const d = doc.createElement('div');
            if (cls) d.className = cls;
            d.textContent = msg;
            logBox.appendChild(d);
            logBox.scrollTop = logBox.scrollHeight;
        };

        ov.querySelector('#bs-apply').addEventListener('click', async () => {
            const mode = ov.querySelector('input[name="bs-mode"]:checked').value;
            const manualAction = ov.querySelector('input[name="bs-manual-action"]:checked')?.value || 'none';
            const status = ov.querySelector('input[name="bs-status"]:checked')?.value || 'y';
            const selectedWh = Array.from(ov.querySelectorAll('input[name="bs-wh"]:checked')).map(cb => parseInt(cb.value));
            const cleanStocks = ov.querySelector('#bs-clean').checked;
            const cleanReservations = ov.querySelector('#bs-clean-reservations').checked;

            if (mode === 'manual' && manualAction === 'per_wh' && !selectedWh.length) {
                alert('Wybierz przynajmniej jeden magazyn.');
                return;
            }

            ov.querySelector('#bs-apply').disabled = true;
            ov.querySelector('#bs-cancel').disabled = true;
            ov.querySelector('#bs-progress').style.display = 'block';

            const total = productIds.length;
            const fill = ov.querySelector('#bs-bar-fill');
            const txt = ov.querySelector('#bs-bar-text');

            // Krok 1: zmiana trybu
            if (mode === 'manual' || mode === 'auto') {
                log(`══ Zmiana trybu na: ${mode === 'manual' ? 'ręczną' : 'automatyczną'} ══`);
                let i = 0;
                for (const pid of productIds) {
                    i++;
                    fill.style.width = Math.round((i/total)*100) + '%';
                    txt.textContent = `${i}/${total}`;
                    try {
                        const r = await setManagementType(win, pid, mode);
                        if (r.errno === 0 || r.errno === undefined) log(`Towar ${pid} → tryb ${mode} OK`, 'ok');
                        else log(`Towar ${pid} → BŁĄD: ${r.error || 'errno=' + r.errno}`, 'err');
                    } catch (e) {
                        log(`Towar ${pid} → BŁĄD: ${e.message}`, 'err');
                    }
                    await sleep(150);
                }
            }

            // Krok 2: tryb ręczny — JEST wszędzie / per warehouse
            if (mode !== 'auto' && manualAction !== 'none') {
                if (manualAction === 'all_jest') {
                    log(`══ Wszystkie magazyny → JEST ══`);
                    let i = 0;
                    for (const pid of productIds) {
                        i++;
                        fill.style.width = Math.round((i/total)*100) + '%';
                        txt.textContent = `${i}/${total}`;
                        try {
                            const r = await massSetAvailable(win, pid);
                            if (r.errno === 0 || r.errno === undefined) log(`Towar ${pid} → wszystkie JEST OK`, 'ok');
                            else log(`Towar ${pid} → BŁĄD: ${r.error || 'errno=' + r.errno}`, 'err');
                        } catch (e) {
                            log(`Towar ${pid} → BŁĄD: ${e.message}`, 'err');
                        }
                        await sleep(150);
                    }
                } else if (manualAction === 'per_wh') {
                    const whCodes = warehouses.filter(w => selectedWh.includes(w.stockId)).map(w => w.code).join(', ');
                    log(`══ Magazyny [${whCodes}] → ${status === 'y' ? 'JEST' : 'NIEMA'} ══`);
                    let i = 0;
                    for (const pid of productIds) {
                        i++;
                        fill.style.width = Math.round((i/total)*100) + '%';
                        txt.textContent = `${i}/${total}`;
                        try {
                            const html = await getSizesTable(win, pid);
                            const sizes = parseSizesFromTable(html);
                            if (!sizes.length) {
                                log(`Towar ${pid} → brak rozmiarów`, 'warn');
                                continue;
                            }
                            let ok = 0, err = 0;
                            for (const stockId of selectedWh) {
                                for (const sizeId of sizes) {
                                    try {
                                        await changeAvailability(win, pid, stockId, sizeId, status);
                                        ok++;
                                    } catch (e) { err++; }
                                    await sleep(80);
                                }
                            }
                            log(`Towar ${pid} → ${ok} OK / ${err} błędów (${selectedWh.length} mag × ${sizes.length} rozm)`, err ? 'err' : 'ok');
                        } catch (e) {
                            log(`Towar ${pid} → BŁĄD: ${e.message}`, 'err');
                        }
                        await sleep(150);
                    }
                }
            }

            // Krok 3: tryb auto — czyszczenie ilości
            if (mode === 'auto' && cleanStocks) {
                log(`══ Zerowanie stanów (M0) ══`);
                try {
                    const types = cleanReservations ? ['stock_quantity', 'all'] : ['stock_quantity'];
                    const r = await cleanQuantity(win, productIds, types);
                    log(`Wyzerowano: ${r.stock_quantity || '?'} towarów, rezerwacje: ${r.reservations || 0}`, 'ok');
                } catch (e) {
                    log(`BŁĄD zerowania: ${e.message}`, 'err');
                }
            }

            log(`══ Gotowe ══`);
            ov.querySelector('#bs-cancel').disabled = false;
            ov.querySelector('#bs-cancel').textContent = 'Zamknij';
        });
    }

    /* ═══════════════════════════════════════════
       PASEK PANELPRO + PRZYCISK
       ═══════════════════════════════════════════ */
    function getOrCreatePanelProBar(doc) {
        let bar = doc.querySelector('#panelpro-bar');
        if (bar) return bar;

        const bottomMenu = doc.querySelector('#bottom_menu_products');
        if (!bottomMenu) return null;

        if (!doc.querySelector('#panelpro-bar-css')) {
            const style = doc.createElement('style');
            style.id = 'panelpro-bar-css';
            style.textContent = `
                #panelpro-bar { display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#fff;padding:10px 16px;border:1px solid #e2e8f0;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,0.04);margin-top:6px; }
                #panelpro-bar .pp-label { color:#e67e22;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-right:4px; }
                #panelpro-bar .pp-btn { display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border:1px solid #e2e8f0;border-radius:4px;background:#fff;color:#334155;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap;transition:.15s;font-family:inherit; }
                #panelpro-bar .pp-btn:hover { background:#f8fafc;border-color:#cbd5e1; }
                #panelpro-bar .pp-btn:disabled { opacity:0.5;cursor:not-allowed; }
                #panelpro-bar .pp-btn .fa { font-size:14px;color:#64748b; }
                #panelpro-bar .pp-sep { width:1px;height:24px;background:#e2e8f0;margin:0 4px; }
            `;
            doc.head.appendChild(style);
        }

        bar = doc.createElement('div');
        bar.id = 'panelpro-bar';
        const label = doc.createElement('span');
        label.className = 'pp-label';
        label.textContent = 'PanelPro:';
        bar.appendChild(label);
        bottomMenu.parentNode.insertBefore(bar, bottomMenu.nextSibling);
        return bar;
    }

    function injectStockButton(doc) {
        if (doc.querySelector('#bs-stockAction')) return;
        const bar = getOrCreatePanelProBar(doc);
        if (!bar) return;

        const btn = doc.createElement('button');
        btn.id = 'bs-stockAction';
        btn.className = 'pp-btn';
        btn.disabled = true;
        btn.innerHTML = '<i class="fa fa-archive"></i> Stany magazynowe';
        btn.addEventListener('click', () => {
            const win = getIframeWin();
            const ids = getSelectedProductIds(doc);
            if (!ids.length) return;
            openModal(doc, win, ids);
        });
        bar.appendChild(btn);

        const win = getIframeWin();
        if (win && win.IAI && win.IAI.Table && win.IAI.Table.actualizeLabelAndButtons) {
            const orig = win.IAI.Table.actualizeLabelAndButtons;
            win.IAI.Table.actualizeLabelAndButtons = function () {
                orig.apply(this, arguments);
                const ids = getSelectedProductIds(doc);
                btn.disabled = ids.length === 0;
            };
        }
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
                if (cur.querySelector('#bottom_menu_products') && !cur.querySelector('#bs-stockAction')) {
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

        const mainObs = new MutationObserver(() => {
            if (!injected) tryInject();
        });
        mainObs.observe(document.body, { childList:true, subtree:true });
    }

    waitForIframe(doc => {
        injectStockButton(doc);
    });

})();
