// ==UserScript==
// @name         IdoSell - Kopiowanie przypisań krajów (dostawy/płatności)
// @namespace    idosell-shipping-assignments-copy
// @version      1.7
// @description  Eksport i import przypisań profili dostaw i płatności do krajów między sklepami IdoSell + zaznaczanie wielu krajów (eksport / grupowe usuwanie)
// @match        *://*.iai-shop.com/panel/config-shipping.php*
// @match        *://*.iai-shop.com/panel/app/config-shipping.php*
// @author       Maciej Dobroń <maciej.dobron@gmail.com>
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/design4artPl/tampermonkey/main/idosell_shipping_assignments_copy.user.js
// @updateURL    https://raw.githubusercontent.com/design4artPl/tampermonkey/main/idosell_shipping_assignments_copy.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Skrypt dziala tylko w outer page (nowy panel ma iframe#oldPanelPage)
    if (window.self !== window.top) {
        console.log('[ShippingAssign] Wewnatrz iframe - pomijam.');
        return;
    }

    const PANEL_ORIGIN = window.location.origin;
    const LANG_CODES = ['pol', 'cze', 'eng', 'fre', 'ger', 'por', 'ukr'];
    // Czytelne nazwy jezykow (fallback: surowy kod)
    const LANG_NAMES = {
        pol: 'Polski', eng: 'Angielski', ger: 'Niemiecki', fre: 'Francuski', cze: 'Czeski',
        por: 'Portugalski', ukr: 'Ukraiński', rus: 'Rosyjski', lit: 'Litewski', spa: 'Hiszpański',
        ita: 'Włoski', nld: 'Holenderski', dut: 'Holenderski', slo: 'Słowacki', svk: 'Słowacki',
        hun: 'Węgierski', rom: 'Rumuński', ron: 'Rumuński', bul: 'Bułgarski', gre: 'Grecki',
        ell: 'Grecki', swe: 'Szwedzki', dan: 'Duński', fin: 'Fiński', nor: 'Norweski',
        est: 'Estoński', lav: 'Łotewski', hrv: 'Chorwacki', slv: 'Słoweński', srp: 'Serbski',
        tur: 'Turecki'
    };
    const langLabel = (code) => LANG_NAMES[code] ? `${LANG_NAMES[code]} (${code})` : code;

    // -----------------------------------------------------------------------
    // Dostep do dokumentu z formularzem (iframe lub bezposrednio)
    // -----------------------------------------------------------------------
    function getFormDoc() {
        const iframe = document.querySelector('iframe#oldPanelPage');
        if (iframe) {
            try {
                const d = iframe.contentDocument || iframe.contentWindow.document;
                if (d && d.location.href.includes('config-shipping.php')) return d;
            } catch (e) {}
        }
        if (window.location.href.includes('/panel/config-shipping.php')) return document;
        return null;
    }

    function waitForDoc(callback, maxAttempts = 30) {
        let n = 0;
        const id = setInterval(() => {
            n++;
            const d = getFormDoc();
            if (d && d.querySelector('table')) {
                clearInterval(id);
                callback(d);
            } else if (n >= maxAttempts) {
                clearInterval(id);
                console.log('[ShippingAssign] Nie znaleziono dokumentu po', maxAttempts, 'probach.');
            }
        }, 1000);
    }

    // -----------------------------------------------------------------------
    // Czy biezacy URL to LISTA krajow (a nie edycja pojedynczego)?
    // -----------------------------------------------------------------------
    function isListPage() {
        const url = window.location.href;
        if (!url.includes('config-shipping.php')) return false;
        if (url.includes('action=edit')) return false;
        if (url.includes('action=clear')) return false;
        if (url.includes('action=auctionprofiles')) return false;
        if (!url.includes('shop=')) return false; // strona z listą sklepów
        return true;
    }

    function getCurrentShopId() {
        const m = window.location.href.match(/[?&]shop=(\d+)/);
        return m ? m[1] : null;
    }

    // -----------------------------------------------------------------------
    // UI - FAB + panel
    // -----------------------------------------------------------------------
    function createUI() {
        // Zabezpieczenie przed podwojnym zbudowaniem UI (duplikaty ID -> rozjazd getElementById)
        if (document.getElementById('sa-export-modal-bg')) return;
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            #sa-fab {
                position: fixed; bottom: 20px; right: 20px; z-index: 1000000;
                width: 48px; height: 48px; background: #2196F3; border-radius: 50%;
                cursor: pointer; box-shadow: 0 3px 12px rgba(0,0,0,0.3);
                display: flex; align-items: center; justify-content: center;
                transition: transform 0.2s; user-select: none;
            }
            #sa-fab:hover { transform: scale(1.1); }
            #sa-fab svg { width: 24px; height: 24px; fill: white; }
            #sa-panel {
                position: fixed; top: 10px; right: 10px; z-index: 999999;
                background: #fff; border: 2px solid #2196F3; border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                font-family: 'Inter', Arial, sans-serif; font-size: 13px;
                min-width: 360px; max-width: 480px; display: none;
            }
            #sa-panel.sa-visible { display: block; }
            #sa-panel .sa-header {
                background: #2196F3; color: white; padding: 8px 12px;
                border-radius: 6px 6px 0 0; display: flex;
                justify-content: space-between; align-items: center;
                cursor: move; user-select: none;
            }
            #sa-panel .sa-header h3 { margin: 0; font-size: 13px; font-weight: 600; }
            #sa-panel .sa-close {
                background: none; border: none; color: white; font-size: 18px;
                cursor: pointer; padding: 0 4px; line-height: 1;
            }
            #sa-panel .sa-body { padding: 12px; }
            #sa-panel button.sa-btn {
                display: block; width: 100%; padding: 8px 12px; margin: 4px 0;
                border: 1px solid #ddd; border-radius: 5px; cursor: pointer;
                font-size: 12px; font-weight: 500; text-align: left;
                transition: all 0.2s;
            }
            #sa-panel button.sa-btn:hover { filter: brightness(0.95); }
            #sa-panel button.sa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
            #sa-panel .sa-btn-export { background: #E8F5E9; border-color: #1AAC7A; color: #1B5E20; }
            #sa-panel .sa-btn-import { background: #E3F2FD; border-color: #2196F3; color: #0D47A1; }
            #sa-panel .sa-btn-go { background: #FFF3E0; border-color: #FF9800; color: #E65100; font-weight: bold; text-align: center; }
            #sa-panel .sa-status {
                margin-top: 8px; padding: 6px 8px; background: #f5f5f5;
                border-radius: 4px; font-size: 11px; color: #555;
                max-height: 220px; overflow-y: auto; white-space: pre-wrap;
                word-break: break-word;
            }
            #sa-panel .sa-info { font-size: 11px; color: #888; margin: 6px 0 2px 0; }
            #sa-panel .sa-separator { border-top: 1px solid #eee; margin: 8px 0; }
            #sa-panel input[type="file"] { display: none; }
            #sa-panel .sa-mode-box {
                background: #FFF8E1; border: 1px solid #FFC107; border-radius: 5px;
                padding: 8px; margin: 6px 0; font-size: 11px;
            }
            #sa-panel .sa-mode-box label {
                display: block; margin: 4px 0; cursor: pointer; line-height: 1.4;
            }
            #sa-panel .sa-mode-box label small { color: #666; display: block; margin-left: 20px; }
            #sa-panel .sa-mode-box .sa-mode-warn { color: #c62828; font-weight: bold; font-size: 10px; }
            #sa-panel .sa-log-icon { cursor: pointer; font-size: 14px; opacity: 0.5; padding: 2px; }
            #sa-panel .sa-log-icon:hover { opacity: 1; }
            #sa-panel .sa-waiting { text-align: center; padding: 15px; color: #888; }
            #sa-panel .sa-waiting .spinner {
                display: inline-block; width: 16px; height: 16px;
                border: 2px solid #ddd; border-top-color: #2196F3;
                border-radius: 50%; animation: sa-spin 0.8s linear infinite;
                vertical-align: middle; margin-right: 6px;
            }
            @keyframes sa-spin { to { transform: rotate(360deg); } }
            #sa-panel .sa-preview {
                max-height: 200px; overflow-y: auto; font-family: monospace;
                font-size: 10px; background: #fafafa; border: 1px solid #ddd;
                padding: 6px; border-radius: 4px; margin: 6px 0;
            }
            #sa-panel .sa-preview .sa-row-new { color: #2e7d32; }
            #sa-panel .sa-preview .sa-row-overwrite { color: #ef6c00; }
            #sa-panel .sa-preview .sa-row-skip { color: #999; }
            #sa-panel .sa-preview .sa-row-error { color: #c62828; }

            /* === Modal eksportu (styl wzorowany na export-dialog.jsx) === */
            .sa-modal-bg {
                position: fixed; inset: 0; background: rgba(20,30,50,0.55);
                z-index: 1000001; display: none;
                align-items: flex-start; justify-content: center;
                overflow-y: auto; padding: 30px 16px;
                font-family: 'DM Sans', 'Inter', Arial, sans-serif;
            }
            .sa-modal-bg.sa-visible { display: flex; }
            .sa-modal {
                width: 100%; max-width: 650px; background: #fff;
                border-radius: 16px; box-shadow: 0 8px 40px rgba(0,0,0,.18);
                overflow: hidden;
            }
            .sa-modal .sam-header {
                padding: 22px 24px; border-bottom: 1px solid #eef0f4;
                display: flex; align-items: center; gap: 14px; background: #f8f9fb;
            }
            .sa-modal .sam-header-icon {
                width: 40px; height: 40px; border-radius: 10px; display: flex;
                align-items: center; justify-content: center; font-size: 20px;
                background: #e8eeff; color: #4f8cff;
            }
            .sa-modal .sam-header-title { font-size: 17px; font-weight: 700; color: #1a1a2e; }
            .sa-modal .sam-header-sub { font-size: 12.5px; color: #667085; margin-top: 2px; }
            .sa-modal .sam-section { padding: 18px 20px; border-bottom: 1px solid #eef0f4; }
            .sa-modal .sam-section:nth-last-child(2) { border-bottom: none; }
            .sa-modal .sam-section-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
            .sa-modal .sam-section-num {
                width: 26px; height: 26px; border-radius: 50%; display: flex;
                align-items: center; justify-content: center; font-size: 12px;
                font-weight: 700; background: #4f8cff; color: #fff; flex-shrink: 0; margin-top: 1px;
            }
            .sa-modal .sam-section-title { font-size: 14.5px; font-weight: 600; color: #1a1a2e; }
            .sa-modal .sam-section-sub { font-size: 12.5px; color: #667085; margin-top: 2px; }
            .sa-modal .sam-pill {
                display: inline-flex; background: #f0f2f5; border-radius: 8px; padding: 3px; gap: 2px;
            }
            .sa-modal .sam-pill button {
                padding: 7px 16px; border-radius: 6px; border: none; cursor: pointer;
                font-size: 13px; font-weight: 500; transition: all .2s;
                background: transparent; color: #667085; font-family: inherit;
            }
            .sa-modal .sam-pill button.active {
                background: #fff; color: #1a1a2e; box-shadow: 0 1px 3px rgba(0,0,0,.1);
            }
            .sa-modal .sam-list {
                background: #f8f9fb; border-radius: 10px; padding: 4px;
                max-height: 240px; overflow-y: auto; margin-top: 10px; border: 1px solid #e8ebf0;
            }
            .sa-modal .sam-list-item {
                display: flex; align-items: center; justify-content: space-between;
                padding: 8px 12px; border-radius: 7px; cursor: pointer; transition: background .15s;
            }
            .sa-modal .sam-list-item:hover { background: rgba(0,0,0,.03); }
            .sa-modal .sam-list-item.checked { background: #eef3ff; }
            .sa-modal .sam-list-label { font-size: 13.5px; color: #1a1a2e; flex: 1; }
            .sa-modal .sam-list-label small { display: block; font-size: 11.5px; color: #98a2b3; margin-top: 2px; }
            .sa-modal .sam-list-empty { padding: 14px; text-align: center; color: #98a2b3; font-size: 12.5px; font-style: italic; }
            .sa-modal .sam-toggle {
                width: 40px; height: 22px; border-radius: 11px; border: none;
                background: #d0d5dd; cursor: pointer; position: relative;
                transition: background .2s; flex-shrink: 0;
            }
            .sa-modal .sam-toggle.on { background: #4f8cff; }
            .sa-modal .sam-toggle::after {
                content: ''; position: absolute; top: 2px; left: 2px;
                width: 18px; height: 18px; border-radius: 50%; background: #fff;
                transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.18);
            }
            .sa-modal .sam-toggle.on::after { left: 20px; }
            .sa-modal .sam-fields {
                background: #f8f9fb; border-radius: 10px; overflow: hidden; border: 1px solid #e8ebf0;
            }
            .sa-modal .sam-fields .sam-list-item { border-radius: 0; }
            .sa-modal .sam-fields .sam-list-item + .sam-list-item { border-top: 1px solid #eef0f4; }
            .sa-modal .sam-footer {
                padding: 16px 20px; background: #fafbfc; border-top: 1px solid #eef0f4;
                display: flex; align-items: center; justify-content: space-between;
            }
            .sa-modal .sam-summary { font-size: 12px; color: #98a2b3; }
            .sa-modal .sam-btn {
                padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
                cursor: pointer; font-family: inherit;
            }
            .sa-modal .sam-btn-cancel { border: 1px solid #d0d5dd; background: #fff; color: #344054; }
            .sa-modal .sam-btn-go {
                border: none; background: linear-gradient(135deg, #4f8cff, #3b6de0);
                color: #fff; box-shadow: 0 2px 8px rgba(79,140,255,.35); margin-left: 8px;
            }
            .sa-modal .sam-btn-go:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
            .sa-progress-wrap {
                background: #eef2f7; border-radius: 8px; height: 22px;
                overflow: hidden; margin: 10px 0 6px; position: relative;
            }
            .sa-progress-bar {
                height: 100%; background: linear-gradient(135deg, #4f8cff, #3b6de0);
                transition: width .25s ease;
                display: flex; align-items: center; justify-content: flex-end;
                padding-right: 8px; color: #fff; font-size: 11px; font-weight: 600;
                min-width: 32px;
            }
            .sa-progress-bar.done { background: linear-gradient(135deg, #2e7d32, #1b5e20); }
            .sa-progress-label { font-size: 12px; color: #667085; margin-bottom: 4px; }
            .sa-indented-log {
                margin-left: 34px; max-height: 240px; overflow-y: auto;
                font-family: monospace; font-size: 11px; background: #fafafa;
                border: 1px solid #e8ebf0; padding: 8px; border-radius: 8px;
            }
            .sa-dark-log {
                margin-left: 34px; max-height: 200px; overflow-y: auto;
                font-family: monospace; font-size: 11px;
                background: #1a1a2e; color: #a0e0ff; padding: 10px;
                border-radius: 8px; white-space: pre-wrap;
            }

            /* === Pasek akcji grupowych (pływający) === */
            #sa-bulk-bar {
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
                z-index: 1000002; display: none; align-items: center; gap: 10px;
                background: #1a1a2e; color: #fff; padding: 10px 14px;
                border-radius: 12px; box-shadow: 0 6px 28px rgba(0,0,0,.35);
                font-family: 'DM Sans', 'Inter', Arial, sans-serif; font-size: 13px;
            }
            #sa-bulk-bar.sa-visible { display: flex; }
            #sa-bulk-bar .sa-bulk-count {
                background: #4f8cff; color: #fff; border-radius: 20px;
                padding: 3px 10px; font-weight: 700; font-size: 12px;
            }
            #sa-bulk-bar .sa-bulk-label { color: #c8d0e0; margin-right: 4px; }
            #sa-bulk-bar button {
                border: none; border-radius: 8px; padding: 8px 14px; cursor: pointer;
                font-size: 12.5px; font-weight: 600; font-family: inherit; transition: filter .15s;
            }
            #sa-bulk-bar button:hover { filter: brightness(1.1); }
            #sa-bulk-bar .sa-bulk-export { background: linear-gradient(135deg,#4f8cff,#3b6de0); color: #fff; }
            #sa-bulk-bar .sa-bulk-delete { background: linear-gradient(135deg,#e53935,#b71c1c); color: #fff; }
            #sa-bulk-bar .sa-bulk-clear { background: transparent; color: #c8d0e0; box-shadow: inset 0 0 0 1px #44495f; }

            /* === Kolumna checkboxów w tabeli listy === */
            td.sa-chk-th, td.sa-chk-td { text-align: center !important; width: 34px; white-space: nowrap; }
            td.sa-chk-td input[type="checkbox"], td.sa-chk-th input[type="checkbox"] {
                width: 16px; height: 16px; cursor: pointer; margin: 0; vertical-align: middle;
            }
            tr.sa-row-checked > td { background: #eef3ff !important; }

            /* === Modal usuwania (reuzje stylu .sa-modal) === */
            .sa-modal .sad-row-del { color: #b71c1c; }
            .sa-modal .sad-row-skip { color: #999; }
        `;
        document.head.appendChild(styleEl);

        // --- Modal eksportu (osobny element) ---
        const modalBg = document.createElement('div');
        modalBg.id = 'sa-export-modal-bg';
        modalBg.className = 'sa-modal-bg';
        modalBg.innerHTML = `
            <div id="sa-export-modal" class="sa-modal">
                <div class="sam-header">
                    <div class="sam-header-icon">↗</div>
                    <div>
                        <div class="sam-header-title">Eksport przypisań krajów</div>
                        <div class="sam-header-sub" id="sam-header-sub">Skonfiguruj zakres i pola eksportu</div>
                    </div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">1</span>
                        <div>
                            <div class="sam-section-title">Języki</div>
                            <div class="sam-section-sub">Wersje językowe nazwy kraju do eksportu (nazwy zostaną dociągnięte z formularzy edycji)</div>
                        </div>
                    </div>
                    <div class="sam-pill" id="sam-pill-langs">
                        <button data-val="all" class="active">Wszystkie języki</button>
                        <button data-val="selected">Wybrane języki</button>
                    </div>
                    <div class="sam-list" id="sam-list-langs" style="display:none;"></div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">2</span>
                        <div>
                            <div class="sam-section-title">Kraje</div>
                            <div class="sam-section-sub">Wybierz kraje do eksportu</div>
                        </div>
                    </div>
                    <div class="sam-pill" id="sam-pill-countries">
                        <button data-val="all" class="active">Wszystkie kraje</button>
                        <button data-val="selected">Wybrane kraje</button>
                    </div>
                    <div class="sam-list" id="sam-list-countries" style="display:none;"></div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">3</span>
                        <div>
                            <div class="sam-section-title">Regiony</div>
                            <div class="sam-section-sub">Subregiony krajów wybranych powyżej</div>
                        </div>
                    </div>
                    <div class="sam-pill" id="sam-pill-regions">
                        <button data-val="all" class="active">Wszystkie regiony</button>
                        <button data-val="selected">Wybrane regiony</button>
                    </div>
                    <div class="sam-list" id="sam-list-regions" style="display:none;"></div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">4</span>
                        <div>
                            <div class="sam-section-title">Ustawienia krajów/regionów</div>
                            <div class="sam-section-sub">Pola do eksportu (wyłączone trafią do JSON jako null)</div>
                        </div>
                    </div>
                    <div class="sam-fields" id="sam-fields"></div>
                </div>
                <div class="sam-footer">
                    <div class="sam-summary" id="sam-summary"></div>
                    <div>
                        <button class="sam-btn sam-btn-cancel" id="sam-btn-cancel">Anuluj</button>
                        <button class="sam-btn sam-btn-go" id="sam-btn-go">Eksportuj</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modalBg);

        // --- Modal importu ---
        const importBg = document.createElement('div');
        importBg.id = 'sa-import-modal-bg';
        importBg.className = 'sa-modal-bg';
        importBg.innerHTML = `
            <div id="sa-import-modal" class="sa-modal" style="max-width: 720px;">
                <div class="sam-header">
                    <div class="sam-header-icon" style="background:#FFE8E8; color:#E91E63;">↙</div>
                    <div>
                        <div class="sam-header-title">Import przypisań krajów</div>
                        <div class="sam-header-sub" id="sai-header-sub">Wybierz plik JSON i tryb importu</div>
                    </div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">1</span>
                        <div>
                            <div class="sam-section-title">Plik JSON</div>
                            <div class="sam-section-sub">Plik wyeksportowany z innego sklepu (format v2)</div>
                        </div>
                    </div>
                    <button class="sam-btn sam-btn-cancel" id="sai-btn-pick-file">Wybierz plik...</button>
                    <input type="file" id="sai-file-input" accept=".json" style="display:none;">
                    <div id="sai-file-info" style="margin-top:8px; font-size:12px; color:#667085;"></div>
                </div>
                <div class="sam-section" id="sai-langs-section" style="display:none;">
                    <div class="sam-section-header">
                        <span class="sam-section-num">2</span>
                        <div>
                            <div class="sam-section-title">Języki</div>
                            <div class="sam-section-sub">Wersje językowe nazwy kraju do zaktualizowania (tylko te obecne w pliku)</div>
                        </div>
                    </div>
                    <div class="sam-pill" id="sai-pill-langs">
                        <button data-val="all" class="active">Wszystkie języki</button>
                        <button data-val="selected">Wybrane języki</button>
                    </div>
                    <div class="sam-list" id="sai-list-langs" style="display:none;"></div>
                </div>
                <div class="sam-section" id="sai-countries-section" style="display:none;">
                    <div class="sam-section-header">
                        <span class="sam-section-num">3</span>
                        <div>
                            <div class="sam-section-title">Kraje</div>
                            <div class="sam-section-sub">Wybierz które kraje z pliku chcesz zaimportować</div>
                        </div>
                    </div>
                    <div class="sam-pill" id="sai-pill-countries">
                        <button data-val="all" class="active">Wszystkie kraje</button>
                        <button data-val="selected">Wybrane kraje</button>
                    </div>
                    <div class="sam-list" id="sai-list-countries" style="display:none;"></div>
                </div>
                <div class="sam-section" id="sai-regions-section" style="display:none;">
                    <div class="sam-section-header">
                        <span class="sam-section-num">3</span>
                        <div>
                            <div class="sam-section-title">Regiony</div>
                            <div class="sam-section-sub">Subregiony krajów wybranych powyżej</div>
                        </div>
                    </div>
                    <div class="sam-pill" id="sai-pill-regions">
                        <button data-val="all" class="active">Wszystkie regiony</button>
                        <button data-val="selected">Wybrane regiony</button>
                    </div>
                    <div class="sam-list" id="sai-list-regions" style="display:none;"></div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">4</span>
                        <div>
                            <div class="sam-section-title">Tryb importu</div>
                            <div class="sam-section-sub">Co zrobić z istniejącymi danymi w sklepie docelowym</div>
                        </div>
                    </div>
                    <div class="sam-fields" id="sai-modes" style="background:#fff;">
                        <label class="sam-list-item" style="cursor:pointer;">
                            <div class="sam-list-label">
                                <strong>Pomiń istniejące</strong>
                                <small>Bezpieczne. Doda tylko brakujące przypisania (gdy kraj/region pusty w docelowym).</small>
                            </div>
                            <input type="radio" name="sai-mode" value="skip" style="width:18px; height:18px;">
                        </label>
                        <label class="sam-list-item" style="cursor:pointer;">
                            <div class="sam-list-label">
                                <strong>Wypełnij tylko puste pola</strong>
                                <small>Dla istniejących krajów uzupełni tylko te selecty które są "* nie wysyłamy".</small>
                            </div>
                            <input type="radio" name="sai-mode" value="fill_empty" style="width:18px; height:18px;">
                        </label>
                        <label class="sam-list-item" style="cursor:pointer;">
                            <div class="sam-list-label">
                                <strong>Aktualizuj istniejące</strong>
                                <small>Nadpisze pola tylko dla krajów/regionów już istniejących w docelowym (po code/name+postcode). NIE utworzy nowych.</small>
                            </div>
                            <input type="radio" name="sai-mode" value="update_existing" style="width:18px; height:18px;">
                        </label>
                        <label class="sam-list-item" style="cursor:pointer;">
                            <div class="sam-list-label">
                                <strong style="color:#c62828;">Nadpisz wszystko</strong>
                                <small>Dla każdego kraju z eksportu wymusi przypisania ze źródła. Tworzy też nowe subregiony. UWAGA: ryzykowne.</small>
                            </div>
                            <input type="radio" name="sai-mode" value="overwrite" style="width:18px; height:18px;">
                        </label>
                    </div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">5</span>
                        <div>
                            <div class="sam-section-title">Pola do zaktualizowania</div>
                            <div class="sam-section-sub">Tylko te pola będą podmieniane (wyłączone zostaną w docelowym bez zmian)</div>
                        </div>
                    </div>
                    <div class="sam-fields" id="sai-fields"></div>
                </div>
                <div class="sam-section" id="sai-preview-section" style="display:none;">
                    <div class="sam-section-header">
                        <span class="sam-section-num">6</span>
                        <div>
                            <div class="sam-section-title">Podgląd zmian</div>
                            <div class="sam-section-sub" id="sai-preview-summary">Pobieram dane z docelowego sklepu...</div>
                        </div>
                    </div>
                    <div class="sa-progress-wrap" style="margin-left:34px;"><div class="sa-progress-bar" id="sai-prev-bar" style="width:0%;">0%</div></div>
                    <div class="sa-progress-wrap" id="sai-prev-counter-wrap" style="margin-left:34px; background:#f5f6fa; display:flex; align-items:center; justify-content:center;"><span id="sai-prev-counter" style="font-size:12px; color:#667085; font-weight:600;">0/0</span></div>
                    <div class="sa-indented-log" id="sai-preview" style="display:none;"></div>
                </div>
                <div class="sam-section" id="sai-exec-section" style="display:none;">
                    <div class="sam-section-header">
                        <span class="sam-section-num">7</span>
                        <div>
                            <div class="sam-section-title">Wykonanie importu</div>
                            <div class="sam-section-sub" id="sai-exec-summary">Zapisuję zmiany w sklepie docelowym...</div>
                        </div>
                    </div>
                    <div class="sa-progress-wrap" style="margin-left:34px;"><div class="sa-progress-bar" id="sai-exec-bar" style="width:0%;">0%</div></div>
                    <div class="sa-progress-wrap" id="sai-exec-counter-wrap" style="margin-left:34px; background:#f5f6fa; display:flex; align-items:center; justify-content:center;"><span id="sai-exec-counter" style="font-size:12px; color:#667085; font-weight:600;">0/0</span></div>
                    <div class="sa-dark-log" id="sai-execute-log" style="display:none;"></div>
                </div>
                <div class="sam-footer">
                    <div class="sam-summary" id="sai-summary">Wybierz plik i tryb importu</div>
                    <div>
                        <button class="sam-btn sam-btn-cancel" id="sai-btn-cancel">Anuluj</button>
                        <button class="sam-btn sam-btn-go" id="sai-btn-preview" disabled>Pokaż podgląd</button>
                        <button class="sam-btn sam-btn-go" id="sai-btn-execute" disabled style="background:linear-gradient(135deg, #2e7d32, #1b5e20); display:none;">Wykonaj import</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(importBg);

        // --- Pasek akcji grupowych ---
        const bulkBar = document.createElement('div');
        bulkBar.id = 'sa-bulk-bar';
        bulkBar.innerHTML = `
            <span class="sa-bulk-count" id="sa-bulk-count">0</span>
            <span class="sa-bulk-label">zaznaczonych</span>
            <button class="sa-bulk-export" id="sa-bulk-export">↗ Eksportuj zaznaczone</button>
            <button class="sa-bulk-delete" id="sa-bulk-delete">🗑 Usuń zaznaczone</button>
            <button class="sa-bulk-clear" id="sa-bulk-clear">Odznacz</button>
        `;
        document.body.appendChild(bulkBar);

        // --- Modal grupowego usuwania ---
        const delBg = document.createElement('div');
        delBg.id = 'sa-delete-modal-bg';
        delBg.className = 'sa-modal-bg';
        delBg.innerHTML = `
            <div id="sa-delete-modal" class="sa-modal" style="max-width: 560px;">
                <div class="sam-header">
                    <div class="sam-header-icon" style="background:#FFE8E8; color:#E91E63;">🗑</div>
                    <div>
                        <div class="sam-header-title">Usuń zaznaczone przypisania</div>
                        <div class="sam-header-sub" id="sad-header-sub">Wykona akcję „usuń" z listy dla każdego zaznaczonego wiersza</div>
                    </div>
                </div>
                <div class="sam-section">
                    <div class="sam-section-header">
                        <span class="sam-section-num">1</span>
                        <div>
                            <div class="sam-section-title">Pozycje do usunięcia</div>
                            <div class="sam-section-sub">Dla krajów = wyczyszczenie przypisań, dla subregionów = usunięcie wiersza (identycznie jak link „usuń")</div>
                        </div>
                    </div>
                    <div class="sa-indented-log" id="sad-list" style="margin-left:34px;"></div>
                </div>
                <div class="sam-section" id="sad-exec-section" style="display:none;">
                    <div class="sam-section-header">
                        <span class="sam-section-num">2</span>
                        <div>
                            <div class="sam-section-title">Wykonanie</div>
                            <div class="sam-section-sub" id="sad-exec-summary">Usuwam...</div>
                        </div>
                    </div>
                    <div class="sa-progress-wrap" style="margin-left:34px;"><div class="sa-progress-bar" id="sad-bar" style="width:0%;">0%</div></div>
                    <div class="sa-dark-log" id="sad-log" style="margin-left:34px; display:none;"></div>
                </div>
                <div class="sam-footer">
                    <div class="sam-summary" id="sad-summary"></div>
                    <div>
                        <button class="sam-btn sam-btn-cancel" id="sad-cancel">Anuluj</button>
                        <button class="sam-btn sam-btn-go" id="sad-confirm" style="background:linear-gradient(135deg,#e53935,#b71c1c);">Usuń zaznaczone</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(delBg);

        return null;
    }

    // -----------------------------------------------------------------------
    // Modal eksportu - logika konfiguratora
    // -----------------------------------------------------------------------
    const FIELD_DEFS = [
        { id: 'profile',           label: 'Profil dostaw (detal)',       desc: 'Profil dostawy retail dla kraju/regionu' },
        { id: 'profile_wholesale', label: 'Profil dostaw (hurt)',        desc: 'Profil dostawy wholesale' },
        { id: 'profile_auctions',  label: 'Profil dostaw (marketplace)', desc: 'Lista profili dostaw zaznaczonych dla serwisów aukcyjnych (dodatkowy GET na kraj)' },
        { id: 'payform',           label: 'Profil płatności (detal)',    desc: 'Profil platnosci retail' },
        { id: 'payform_wholesale', label: 'Profil płatności (hurt)',     desc: 'Profil platnosci wholesale' },
        { id: 'payform_auctions',  label: 'Profil płatności (marketplace)', desc: 'Profil platnosci dla marketplace' },
        { id: 'vat',               label: 'Sprzedaż z VAT',              desc: 'Status VAT (z/bez/z dla niektorych)' },
    ];

    function setupExportDialog(formDoc, shopId, onExport) {
        const modalBg = document.getElementById('sa-export-modal-bg');
        if (!modalBg) return;

        // Pelne dane (bedziemy filtrowac)
        let allFlat = [];           // plaska tabela z extractAssignments (przed enrich)
        let nestedAssignments = []; // zagniezdzona po enrich
        let countryMode = 'all';
        let regionMode = 'all';
        const selectedCountries = new Set(); // klucze: idr (kraj parent)
        const selectedRegions = new Set();   // klucze: idr_source subregionu
        const fieldsState = Object.fromEntries(FIELD_DEFS.map(f => [f.id, true]));
        let langMode = 'all';                // 'all' | 'selected'
        let availableLangs = [];             // jezyki wykryte ze sklepu
        const selectedLangs = new Set();     // wybrane kody jezykow

        const $ = id => document.getElementById(id);

        function langsToExport() {
            return langMode === 'all' ? availableLangs.slice() : availableLangs.filter(l => selectedLangs.has(l));
        }

        function renderLangsList() {
            const wrap = $('sam-list-langs');
            wrap.innerHTML = '';
            if (availableLangs.length === 0) {
                wrap.innerHTML = '<div class="sam-list-empty">Nie wykryto języków</div>';
                return;
            }
            for (const code of availableLangs) {
                const on = selectedLangs.has(code);
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (on ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label"><span style="font-weight:500;">${langLabel(code)}</span></div>
                    <button class="sam-toggle ${on ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    if (selectedLangs.has(code)) selectedLangs.delete(code);
                    else selectedLangs.add(code);
                    if (selectedLangs.size > 0 && langMode !== 'selected') {
                        langMode = 'selected';
                        $('sam-pill-langs').querySelectorAll('button').forEach(b =>
                            b.classList.toggle('active', b.getAttribute('data-val') === 'selected')
                        );
                        $('sam-list-langs').style.display = 'block';
                    }
                    renderLangsList();
                    updateSummary();
                });
                wrap.appendChild(item);
            }
        }

        function renderCountriesList() {
            const wrap = $('sam-list-countries');
            wrap.innerHTML = '';
            if (nestedAssignments.length === 0) {
                wrap.innerHTML = '<div class="sam-list-empty">Brak krajów do wyboru</div>';
                return;
            }
            for (const c of nestedAssignments) {
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (selectedCountries.has(c.idr) ? ' checked' : '');
                const subInfo = c.subregions && c.subregions.length ? ` &mdash; ${c.subregions.length} subregion(ów)` : '';
                item.innerHTML = `
                    <div class="sam-list-label">
                        <span style="font-weight:500;">${c.country.toUpperCase()}</span> &middot; ${c.country_name || ''}${subInfo}
                    </div>
                    <button class="sam-toggle ${selectedCountries.has(c.idr) ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    if (selectedCountries.has(c.idr)) selectedCountries.delete(c.idr);
                    else selectedCountries.add(c.idr);
                    // Auto-switch sekcji 1 na Wybrane kraje gdy user zaznaczy cokolwiek
                    if (selectedCountries.size > 0 && countryMode !== 'selected') {
                        countryMode = 'selected';
                        $('sam-pill-countries').querySelectorAll('button').forEach(b =>
                            b.classList.toggle('active', b.getAttribute('data-val') === 'selected')
                        );
                    }
                    renderCountriesList();
                    renderRegionsList();
                    updateSummary();
                });
                wrap.appendChild(item);
            }
        }

        function visibleCountriesForRegions() {
            // Jesli user zaznaczyl konkretne kraje - pokaz regiony tylko ich (niezaleznie od countryMode)
            if (selectedCountries.size > 0) {
                return nestedAssignments.filter(c => selectedCountries.has(c.idr));
            }
            // Nic nie zaznaczone -> 'all' = wszystkie, 'selected' = puste
            return countryMode === 'all' ? nestedAssignments : [];
        }

        function renderRegionsList() {
            const wrap = $('sam-list-regions');
            wrap.innerHTML = '';
            const cs = visibleCountriesForRegions();
            const subs = [];
            cs.forEach(c => {
                if (c.subregions) c.subregions.forEach(s => subs.push({ country: c, sub: s }));
            });
            if (subs.length === 0) {
                wrap.innerHTML = '<div class="sam-list-empty">Brak subregionów dla wybranych krajów</div>';
                return;
            }
            for (const { country, sub } of subs) {
                const key = sub.idr_source;
                const checked = selectedRegions.has(key);
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (checked ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label">
                        <span style="font-weight:500;">${country.country.toUpperCase()}</span> &rarr; ${sub.name || '(bez nazwy)'} &mdash; <span style="color:#98a2b3;">${sub.postcodefrom || '?'} - ${sub.postcodeto || '?'}</span>
                    </div>
                    <button class="sam-toggle ${checked ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    if (selectedRegions.has(key)) selectedRegions.delete(key);
                    else selectedRegions.add(key);
                    renderRegionsList();
                    updateSummary();
                });
                wrap.appendChild(item);
            }
        }

        function renderFields() {
            const wrap = $('sam-fields');
            wrap.innerHTML = '';
            for (const f of FIELD_DEFS) {
                const on = fieldsState[f.id];
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (on ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label"><strong>${f.label}</strong><small>${f.desc}</small></div>
                    <button class="sam-toggle ${on ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    fieldsState[f.id] = !fieldsState[f.id];
                    renderFields();
                    updateSummary();
                });
                wrap.appendChild(item);
            }
        }

        function updateSummary() {
            const allCountries = nestedAssignments.length;
            const visC = countryMode === 'all' ? allCountries : selectedCountries.size;
            const allRegions = nestedAssignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
            const visibleC = visibleCountriesForRegions();
            const totalRegionsOfVisible = visibleC.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
            const visR = regionMode === 'all' ? totalRegionsOfVisible : selectedRegions.size;
            const enabledFields = Object.values(fieldsState).filter(Boolean).length;
            const visL = langsToExport().length;
            $('sam-summary').textContent =
                `${visL}/${availableLangs.length} jęz. · ${visC}/${allCountries} kraj${visC === 1 ? '' : 'ów'} · ${visR}/${allRegions} region${visR === 1 ? '' : 'ów'} · ${enabledFields}/${FIELD_DEFS.length} pól`;
            $('sam-btn-go').disabled = (visC === 0);
        }

        function pillSetup(pillId, listId, onChange) {
            const pill = $(pillId);
            const list = $(listId);
            pill.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => {
                    pill.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const v = btn.getAttribute('data-val');
                    list.style.display = v === 'selected' ? 'block' : 'none';
                    onChange(v);
                };
            });
        }

        // Otwieranie modalu - przygotowanie danych
        // preselectCountryIdrs (opcjonalne) - lista idr krajow do wstepnego zaznaczenia (z paska akcji)
        async function open(preselectCountryIdrs) {
            // Odswiez na zywo (dialog jest singletonem - iframe mogl sie przeladowac)
            formDoc = getFormDoc() || formDoc;
            shopId = getCurrentShopId() || shopId;
            modalBg.classList.add('sa-visible');
            $('sam-header-sub').textContent = `Sklep ${shopId} - przygotowywanie listy...`;
            // Pobierz pelne dane (extract + enrich subregionow)
            allFlat = extractAssignments(formDoc);
            await enrichSubregions(allFlat, shopId);
            nestedAssignments = nestSubregions(allFlat);
            const subC = nestedAssignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
            // Wykryj jezyki dostepne w sklepie
            availableLangs = await detectAvailableLanguages(allFlat, shopId);
            $('sam-header-sub').textContent = `Sklep ${shopId} · ${nestedAssignments.length} krajów · ${subC} subregionów · ${availableLangs.length} języków`;

            // Reset stanu
            countryMode = 'all'; regionMode = 'all'; langMode = 'all';
            selectedCountries.clear(); selectedRegions.clear(); selectedLangs.clear();
            FIELD_DEFS.forEach(f => fieldsState[f.id] = true);
            $('sam-pill-langs').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
            $('sam-pill-countries').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
            $('sam-pill-regions').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
            $('sam-list-langs').style.display = 'none';
            $('sam-list-countries').style.display = 'none';
            $('sam-list-regions').style.display = 'none';

            // Wstepne zaznaczenie krajow (z paska akcji grupowych)
            if (preselectCountryIdrs && preselectCountryIdrs.length) {
                preselectCountryIdrs.forEach(idr => {
                    const id = String(idr);
                    if (nestedAssignments.some(c => String(c.idr) === id)) selectedCountries.add(id);
                });
                if (selectedCountries.size > 0) {
                    countryMode = 'selected';
                    $('sam-pill-countries').querySelectorAll('button').forEach(b =>
                        b.classList.toggle('active', b.getAttribute('data-val') === 'selected')
                    );
                    $('sam-list-countries').style.display = 'block';
                }
            }

            renderLangsList();
            renderCountriesList();
            renderRegionsList();
            renderFields();
            updateSummary();
        }

        function close() { modalBg.classList.remove('sa-visible'); }

        // Filtruj nestedAssignments zgodnie z wyborami i zwroc finalna strukture do eksportu
        function buildFiltered() {
            const out = [];
            const expLangs = langsToExport();
            for (const c of nestedAssignments) {
                if (countryMode === 'selected' && !selectedCountries.has(c.idr)) continue;
                const newC = { country: c.country, country_name: c.country_name, idr: c.idr };
                // Wielojezyczne nazwy kraju (tylko wybrane jezyki)
                if (expLangs.length && c.languages) {
                    const langsOut = {};
                    for (const l of expLangs) if (c.languages[l] !== undefined) langsOut[l] = c.languages[l];
                    if (Object.keys(langsOut).length) newC.languages = langsOut;
                }
                // Pola z fieldsState - wylaczone -> null
                for (const f of FIELD_DEFS) {
                    newC[f.id] = fieldsState[f.id] ? c[f.id] : null;
                    // Zachowaj _name jesli pole wlaczone (informacyjne)
                    if (fieldsState[f.id] && c[f.id + '_name'] !== undefined) {
                        newC[f.id + '_name'] = c[f.id + '_name'];
                    }
                }
                // Subregiony
                if (c.subregions && c.subregions.length) {
                    const subsOut = [];
                    for (const s of c.subregions) {
                        if (regionMode === 'selected' && !selectedRegions.has(s.idr_source)) continue;
                        const newS = {
                            idr_source: s.idr_source,
                            name: s.name, postcodefrom: s.postcodefrom, postcodeto: s.postcodeto
                        };
                        for (const f of FIELD_DEFS) {
                            newS[f.id] = fieldsState[f.id] ? s[f.id] : null;
                            if (fieldsState[f.id] && s[f.id + '_name'] !== undefined) {
                                newS[f.id + '_name'] = s[f.id + '_name'];
                            }
                        }
                        subsOut.push(newS);
                    }
                    if (subsOut.length) newC.subregions = subsOut;
                }
                out.push(newC);
            }
            const subCount = out.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
            const enabledFieldIds = FIELD_DEFS.filter(f => fieldsState[f.id]).map(f => f.id);
            return {
                _format: 'idosell-shipping-assignments-v2',
                _exported: new Date().toISOString(),
                _source_shop: shopId,
                _source_url: window.location.href,
                _count: out.length,
                _subregion_count: subCount,
                _exported_fields: enabledFieldIds,
                _exported_languages: expLangs,
                assignments: out
            };
        }

        // Setup pill events (jednorazowo)
        pillSetup('sam-pill-langs', 'sam-list-langs', v => { langMode = v; updateSummary(); });
        pillSetup('sam-pill-countries', 'sam-list-countries', v => { countryMode = v; renderRegionsList(); updateSummary(); });
        pillSetup('sam-pill-regions', 'sam-list-regions', v => { regionMode = v; updateSummary(); });

        $('sam-btn-cancel').onclick = close;
        $('sam-btn-go').onclick = async () => {
            $('sam-btn-go').disabled = true;
            try {
                if (fieldsState.profile_auctions) {
                    $('sam-header-sub').textContent = 'Pobieram profile marketplace...';
                    await enrichMarketplaceProfiles(allFlat, shopId);
                    nestedAssignments = nestSubregions(allFlat); // re-nest po wzbogaceniu
                }
                const expLangs = langsToExport();
                if (expLangs.length) {
                    $('sam-header-sub').textContent = `Pobieram nazwy w ${expLangs.length} językach...`;
                    await enrichCountryLanguages(allFlat, shopId, expLangs);
                    nestedAssignments = nestSubregions(allFlat); // re-nest po wzbogaceniu (zachowuje a.languages na krajach)
                }
            } catch (e) {
                log(`BLAD pobierania danych: ${e.message}`);
                $('sam-btn-go').disabled = false;
                return;
            }
            const data = buildFiltered();
            $('sam-btn-go').disabled = false;
            if (data._count === 0) { alert('Nic do eksportu - wybierz co najmniej jeden kraj.'); return; }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `shipping_assignments_shop${shopId}_${new Date().toISOString().substring(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            close();
            if (onExport) onExport(data);
        };

        // Klikanie w tlo NIE zamyka modalu - tylko przez Anuluj/X

        return { open, close };
    }

    // -----------------------------------------------------------------------
    // Modal importu - logika
    // -----------------------------------------------------------------------
    function setupImportDialog(shopId) {
        const modalBg = document.getElementById('sa-import-modal-bg');
        if (!modalBg) return;
        const $ = id => document.getElementById(id);

        function renumberSections() {
            const modal = $('sa-import-modal');
            if (!modal) return;
            let n = 1;
            modal.querySelectorAll('.sam-section').forEach(sec => {
                if (sec.style.display !== 'none') {
                    const num = sec.querySelector('.sam-section-num');
                    if (num) num.textContent = String(n);
                    n++;
                }
            });
        }

        let pendingConfig = null;
        let pendingItems = null;
        let mode = null;
        const fieldsState = Object.fromEntries(FIELD_DEFS.map(f => [f.id, true]));
        let importCountryMode = 'all';
        let importRegionMode = 'all';
        let importLangMode = 'all';
        const selectedImportCountries = new Set();
        const selectedImportRegions = new Set();
        const selectedImportLangs = new Set();
        let availableImportLangs = [];       // jezyki obecne w pliku
        let importNameEnabled = true;        // czy aktualizowac nazwe kraju (pole w sekcji "Pola do zaktualizowania")

        function importLangsEnabled() {
            return importLangMode === 'all' ? availableImportLangs.slice() : availableImportLangs.filter(l => selectedImportLangs.has(l));
        }

        function renderImportLangs() {
            const wrap = $('sai-list-langs');
            wrap.innerHTML = '';
            if (availableImportLangs.length === 0) {
                wrap.innerHTML = '<div class="sam-list-empty">Brak nazw językowych w pliku</div>';
                return;
            }
            for (const code of availableImportLangs) {
                const on = selectedImportLangs.has(code);
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (on ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label"><span style="font-weight:500;">${langLabel(code)}</span></div>
                    <button class="sam-toggle ${on ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    if (selectedImportLangs.has(code)) selectedImportLangs.delete(code);
                    else selectedImportLangs.add(code);
                    if (selectedImportLangs.size > 0 && importLangMode !== 'selected') {
                        importLangMode = 'selected';
                        $('sai-pill-langs').querySelectorAll('button').forEach(b =>
                            b.classList.toggle('active', b.getAttribute('data-val') === 'selected')
                        );
                        $('sai-list-langs').style.display = 'block';
                    }
                    renderImportLangs();
                    updateButtons();
                });
                wrap.appendChild(item);
            }
        }

        function iLog(msg) {
            const el = $('sai-execute-log');
            if (!el) return;
            const t = new Date().toLocaleTimeString('pl-PL');
            el.textContent += `[${t}] ${msg}\n`;
            el.scrollTop = el.scrollHeight;
            console.log('[ImportDialog]', msg);
        }

        function renderImportCountries() {
            const wrap = $('sai-list-countries');
            wrap.innerHTML = '';
            if (!pendingConfig || pendingConfig.assignments.length === 0) {
                wrap.innerHTML = '<div class="sam-list-empty">Brak krajów do wyboru</div>';
                return;
            }
            for (const c of pendingConfig.assignments) {
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (selectedImportCountries.has(c.idr) ? ' checked' : '');
                const subInfo = c.subregions && c.subregions.length ? ` &mdash; ${c.subregions.length} subregion(ów)` : '';
                item.innerHTML = `
                    <div class="sam-list-label">
                        <span style="font-weight:500;">${c.country.toUpperCase()}</span> &middot; ${c.country_name || ''}${subInfo}
                    </div>
                    <button class="sam-toggle ${selectedImportCountries.has(c.idr) ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    if (selectedImportCountries.has(c.idr)) selectedImportCountries.delete(c.idr);
                    else selectedImportCountries.add(c.idr);
                    if (selectedImportCountries.size > 0 && importCountryMode !== 'selected') {
                        importCountryMode = 'selected';
                        $('sai-pill-countries').querySelectorAll('button').forEach(b =>
                            b.classList.toggle('active', b.getAttribute('data-val') === 'selected')
                        );
                        $('sai-list-countries').style.display = 'block';
                    }
                    renderImportCountries();
                    renderImportRegions();
                    updateButtons();
                });
                wrap.appendChild(item);
            }
        }

        function visibleCountriesForRegions() {
            if (!pendingConfig) return [];
            if (selectedImportCountries.size > 0) {
                return pendingConfig.assignments.filter(c => selectedImportCountries.has(c.idr));
            }
            return importCountryMode === 'all' ? pendingConfig.assignments : [];
        }

        function renderImportRegions() {
            const wrap = $('sai-list-regions');
            wrap.innerHTML = '';
            const cs = visibleCountriesForRegions();
            const subs = [];
            cs.forEach(c => {
                if (c.subregions) c.subregions.forEach(sub => subs.push({ country: c, sub }));
            });
            if (subs.length === 0) {
                wrap.innerHTML = '<div class="sam-list-empty">Brak subregionów dla wybranych krajów</div>';
                return;
            }
            for (const { country, sub } of subs) {
                const key = sub.idr_source;
                const checked = selectedImportRegions.has(key);
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (checked ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label">
                        <span style="font-weight:500;">${country.country.toUpperCase()}</span> &rarr; ${sub.name || '(bez nazwy)'} &mdash; <span style="color:#98a2b3;">${sub.postcodefrom || '?'} - ${sub.postcodeto || '?'}</span>
                    </div>
                    <button class="sam-toggle ${checked ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    if (selectedImportRegions.has(key)) selectedImportRegions.delete(key);
                    else selectedImportRegions.add(key);
                    if (selectedImportRegions.size > 0 && importRegionMode !== 'selected') {
                        importRegionMode = 'selected';
                        $('sai-pill-regions').querySelectorAll('button').forEach(b =>
                            b.classList.toggle('active', b.getAttribute('data-val') === 'selected')
                        );
                        $('sai-list-regions').style.display = 'block';
                    }
                    renderImportRegions();
                    updateButtons();
                });
                wrap.appendChild(item);
            }
        }

        function pillSetupImport(pillId, listId, onChange) {
            const pill = $(pillId);
            const list = $(listId);
            pill.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => {
                    pill.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const v = btn.getAttribute('data-val');
                    list.style.display = v === 'selected' ? 'block' : 'none';
                    onChange(v);
                };
            });
        }

        function buildFilteredConfig() {
            if (!pendingConfig) return null;
            const assignments = pendingConfig.assignments
                .filter(c => importCountryMode === 'all' || selectedImportCountries.has(c.idr))
                .map(c => {
                    const nc = { ...c };
                    if (c.subregions && c.subregions.length) {
                        if (importRegionMode === 'selected') {
                            nc.subregions = c.subregions.filter(s => selectedImportRegions.has(s.idr_source));
                        } else {
                            nc.subregions = [...c.subregions];
                        }
                        if (nc.subregions.length === 0) delete nc.subregions;
                    }
                    return nc;
                });
            return { ...pendingConfig, assignments, _count: assignments.length };
        }

        function renderFields() {
            const wrap = $('sai-fields');
            wrap.innerHTML = '';
            for (const f of FIELD_DEFS) {
                const on = fieldsState[f.id];
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (on ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label"><strong>${f.label}</strong><small>${f.desc}</small></div>
                    <button class="sam-toggle ${on ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    fieldsState[f.id] = !fieldsState[f.id];
                    renderFields();
                    updateButtons();
                });
                wrap.appendChild(item);
            }
            // Dodatkowe pole: Nazwa kraju (tylko gdy plik zawiera nazwy jezykowe)
            if (availableImportLangs.length) {
                const on = importNameEnabled;
                const item = document.createElement('div');
                item.className = 'sam-list-item' + (on ? ' checked' : '');
                item.innerHTML = `
                    <div class="sam-list-label"><strong>Nazwa kraju</strong><small>Aktualizuj nazwę kraju w wybranych językach (sekcja „Języki")</small></div>
                    <button class="sam-toggle ${on ? 'on' : ''}"></button>
                `;
                item.addEventListener('click', () => {
                    importNameEnabled = !importNameEnabled;
                    renderFields();
                    updateButtons();
                });
                wrap.appendChild(item);
            }
        }

        function updateButtons() {
            const enabledCount = Object.values(fieldsState).filter(Boolean).length;
            const nameActive = importNameEnabled && availableImportLangs.length > 0 && importLangsEnabled().length > 0;
            const hasFile = !!pendingConfig;
            const hasMode = !!mode;
            const filtered = buildFilteredConfig();
            const filteredCount = filtered ? filtered.assignments.length : 0;
            const filteredSubs = filtered ? filtered.assignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0) : 0;
            $('sai-btn-preview').disabled = !(hasFile && hasMode && (enabledCount > 0 || nameActive) && filteredCount > 0);
            const parts = [];
            if (pendingConfig) {
                const totC = pendingConfig.assignments.length;
                const totS = pendingConfig.assignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
                parts.push(`${filteredCount}/${totC} kraj(ów)`);
                if (totS) parts.push(`${filteredSubs}/${totS} subregion(ów)`);
            }
            if (availableImportLangs.length) parts.push(`${importLangsEnabled().length}/${availableImportLangs.length} jęz.`);
            if (mode) parts.push(`tryb: ${mode}`);
            parts.push(`${enabledCount}/${FIELD_DEFS.length} pól`);
            $('sai-summary').textContent = parts.join(' · ');
        }

        function open() {
            // Odswiez na zywo (dialog jest singletonem - iframe mogl sie przeladowac)
            shopId = getCurrentShopId() || shopId;
            modalBg.classList.add('sa-visible');
            pendingConfig = null; pendingItems = null; mode = null;
            FIELD_DEFS.forEach(f => fieldsState[f.id] = true);
            $('sai-file-info').textContent = '';
            $('sai-header-sub').textContent = 'Wybierz plik JSON i tryb importu';
            $('sai-preview-section').style.display = 'none';
            $('sai-exec-section').style.display = 'none';
            $('sai-preview').innerHTML = '';
            $('sai-execute-log').textContent = '';
            $('sai-prev-bar').style.width = '0%';
            $('sai-prev-bar').textContent = '0%';
            $('sai-prev-bar').classList.remove('done');
            $('sai-prev-counter').textContent = '0/0';
            $('sai-prev-counter-wrap').style.display = 'flex';
            $('sai-preview').style.display = 'none';
            $('sai-exec-bar').style.width = '0%';
            $('sai-exec-bar').textContent = '0%';
            $('sai-exec-bar').classList.remove('done');
            $('sai-exec-counter').textContent = '0/0';
            $('sai-exec-counter-wrap').style.display = 'flex';
            $('sai-execute-log').style.display = 'none';
            $('sai-btn-execute').style.display = 'none';
            $('sai-btn-preview').style.display = 'inline-block';
            $('sai-btn-preview').textContent = 'Pokaż podgląd';
            $('sai-btn-cancel').textContent = 'Anuluj';
            document.querySelectorAll('input[name="sai-mode"]').forEach(r => r.checked = false);
            importCountryMode = 'all'; importRegionMode = 'all'; importLangMode = 'all';
            selectedImportCountries.clear(); selectedImportRegions.clear(); selectedImportLangs.clear();
            availableImportLangs = []; importNameEnabled = true;
            $('sai-langs-section').style.display = 'none';
            $('sai-countries-section').style.display = 'none';
            $('sai-regions-section').style.display = 'none';
            $('sai-pill-langs').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
            $('sai-pill-countries').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
            $('sai-pill-regions').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
            $('sai-list-langs').style.display = 'none';
            $('sai-list-countries').style.display = 'none';
            $('sai-list-regions').style.display = 'none';
            renderFields();
            renumberSections();
            updateButtons();
        }
        function close() { modalBg.classList.remove('sa-visible'); }

        // File picker
        $('sai-btn-pick-file').onclick = () => $('sai-file-input').click();
        $('sai-file-input').onchange = (e) => {
            const f = e.target.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                try {
                    const cfg = JSON.parse(ev.target.result);
                    if (cfg._format !== 'idosell-shipping-assignments-v2' || !Array.isArray(cfg.assignments)) {
                        $('sai-file-info').innerHTML = `<span style="color:#c62828;">BŁĄD: nieprawidłowy format (oczekiwano idosell-shipping-assignments-v2)</span>`;
                        pendingConfig = null;
                        availableImportLangs = [];
                        $('sai-langs-section').style.display = 'none';
                        $('sai-countries-section').style.display = 'none';
                        $('sai-regions-section').style.display = 'none';
                        renumberSections();
                    } else {
                        pendingConfig = cfg;
                        const subC = cfg.assignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
                        const sameShop = String(cfg._source_shop) === String(shopId);
                        // Wykryj jezyki obecne w pliku (z _exported_languages lub z kluczy languages)
                        const langSet = new Set(Array.isArray(cfg._exported_languages) ? cfg._exported_languages : []);
                        cfg.assignments.forEach(c => { if (c.languages) Object.keys(c.languages).forEach(l => langSet.add(l)); });
                        availableImportLangs = [...langSet];
                        $('sai-file-info').innerHTML = `<strong>${f.name}</strong><br>${cfg._count} kraj(ów), ${subC} subregion(ów)` + (availableImportLangs.length ? `, nazwy w ${availableImportLangs.length} jęz.` : '') + `, źródło: sklep ${cfg._source_shop}` + (sameShop ? ` <span style="color:#c62828;">⚠ ten sam sklep co docelowy!</span>` : '');
                        importCountryMode = 'all'; importRegionMode = 'all'; importLangMode = 'all';
                        selectedImportCountries.clear(); selectedImportRegions.clear(); selectedImportLangs.clear();
                        $('sai-langs-section').style.display = availableImportLangs.length ? 'block' : 'none';
                        $('sai-countries-section').style.display = 'block';
                        $('sai-regions-section').style.display = 'block';
                        $('sai-pill-langs').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
                        $('sai-pill-countries').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
                        $('sai-pill-regions').querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === 0));
                        $('sai-list-langs').style.display = 'none';
                        $('sai-list-countries').style.display = 'none';
                        $('sai-list-regions').style.display = 'none';
                        renderImportLangs();
                        renderImportCountries();
                        renderImportRegions();
                        renderFields();  // odswiez liste pol (dodaje/usuwa przelacznik "Nazwa kraju")
                        renumberSections();
                    }
                } catch (err) {
                    $('sai-file-info').innerHTML = `<span style="color:#c62828;">BŁĄD parsowania: ${err.message}</span>`;
                    pendingConfig = null;
                }
                updateButtons();
            };
            r.readAsText(f);
            e.target.value = '';
        };

        // Mode radio
        document.querySelectorAll('input[name="sai-mode"]').forEach(r => {
            r.addEventListener('change', () => { mode = r.value; updateButtons(); });
        });

        // Preview
        $('sai-btn-preview').onclick = async () => {
            if (!pendingConfig || !mode) return;
            $('sai-btn-preview').disabled = true;
            $('sai-btn-preview').textContent = 'Buduję podgląd...';
            $('sai-preview-section').style.display = 'block';
            renumberSections();
            $('sai-preview').innerHTML = '';
            $('sai-prev-bar').style.width = '0%';
            $('sai-prev-bar').textContent = '0%';
            $('sai-prev-bar').classList.remove('done');
            const _filteredCfg = buildFilteredConfig();
            $('sai-prev-counter').textContent = '0/' + (_filteredCfg ? _filteredCfg.assignments.length : 0);
            $('sai-prev-counter-wrap').style.display = 'flex';
            $('sai-preview').style.display = 'none';
            $('sai-preview-summary').textContent = 'Pobieram dane z docelowego sklepu...';
            try {
                const enabled = new Set(Object.keys(fieldsState).filter(k => fieldsState[k]));
                // Nazwy aktualizujemy tylko gdy wlaczony przelacznik "Nazwa kraju"
                const enabledLangs = importNameEnabled ? new Set(importLangsEnabled()) : new Set();
                const filteredCfg = buildFilteredConfig();
                pendingItems = await buildPreview(filteredCfg, shopId, mode, enabled, enabledLangs, (done, total) => {
                    const pct = total ? Math.round(done / total * 100) : 0;
                    $('sai-prev-bar').style.width = pct + '%';
                    $('sai-prev-bar').textContent = pct + '%';
                    $('sai-prev-counter').textContent = `${done}/${total}`;
                });
                $('sai-prev-bar').classList.add('done');
                $('sai-prev-bar').style.width = '100%';
                $('sai-prev-bar').textContent = '100%';
                $('sai-prev-counter-wrap').style.display = 'none';
                $('sai-preview').style.display = 'block';
                renderImportPreview();
                $('sai-btn-execute').style.display = 'inline-block';
                $('sai-btn-execute').disabled = false;
                $('sai-btn-preview').textContent = 'Odśwież podgląd';
                $('sai-btn-preview').disabled = false;
            } catch (e) {
                $('sai-preview-summary').textContent = `BŁĄD: ${e.message}`;
                $('sai-btn-preview').textContent = 'Pokaż podgląd';
                $('sai-btn-preview').disabled = false;
            }
        };

        function renderImportPreview() {
            const el = $('sai-preview');
            el.innerHTML = '';
            let nChange = 0, nSkip = 0, nCreate = 0, nErr = 0;
            for (const it of pendingItems) {
                const code = it.src.country.toUpperCase();
                const name = it.src.country_name || '';
                const div = document.createElement('div');
                if (it.error) {
                    div.style.color = '#c62828';
                    div.textContent = `[${code}] ${name} - BŁĄD: ${it.error}`;
                    nErr++;
                } else if (!it.willChange) {
                    div.style.color = '#999';
                    div.textContent = `[${code}] ${name} - bez zmian`;
                    nSkip++;
                } else {
                    const acts = it.changes.filter(c => c.action !== 'keep');
                    div.style.color = acts.some(a => a.action === 'overwrite' || a.action === 'update') ? '#ef6c00' : '#2e7d32';
                    div.textContent = `[${code}] ${name} - ` + acts.map(a => `${a.field}: ${a.from || '∅'} → ${a.to || '∅'}`).join(', ');
                    nChange++;
                }
                el.appendChild(div);
                if (it.subItems) {
                    for (const si of it.subItems) {
                        const sd = document.createElement('div');
                        sd.style.marginLeft = '14px';
                        const sn = si.src.name || '?';
                        if (si.kind === 'create') {
                            sd.style.color = '#2e7d32';
                            sd.textContent = `└ subregion "${sn}" - NOWY REKORD (idr zostanie wygenerowany)`;
                            nCreate++;
                        } else if (si.kind === 'skip') {
                            sd.style.color = '#999';
                            sd.textContent = `└ subregion "${sn}" - pominięty (${si.reason})`;
                            nSkip++;
                        } else if (!si.willChange) {
                            sd.style.color = '#999';
                            sd.textContent = `└ subregion "${sn}" - bez zmian`;
                            nSkip++;
                        } else {
                            const acts = si.changes.filter(c => c.action !== 'keep');
                            sd.style.color = acts.some(a => a.action === 'overwrite' || a.action === 'update') ? '#ef6c00' : '#2e7d32';
                            sd.textContent = `└ subregion "${sn}" - ` + acts.map(a => `${a.field}: ${a.from || '∅'} → ${a.to || '∅'}`).join(', ');
                            nChange++;
                        }
                        el.appendChild(sd);
                    }
                }
            }
            $('sai-preview-summary').textContent = `Zmian: ${nChange}, nowych subregionów: ${nCreate}, bez zmian: ${nSkip}, błędów: ${nErr}`;
        }

        // Execute
        $('sai-btn-execute').onclick = async () => {
            if (!pendingItems) return;
            $('sai-btn-execute').disabled = true;
            $('sai-btn-execute').textContent = 'Wykonuję...';
            $('sai-btn-cancel').textContent = 'Zamknij';
            $('sai-exec-section').style.display = 'block';
            renumberSections();
            $('sai-execute-log').textContent = '';
            $('sai-execute-log').style.display = 'block';
            $('sai-exec-bar').style.width = '0%';
            $('sai-exec-bar').textContent = '0%';
            $('sai-exec-bar').classList.remove('done');
            const totalExec = pendingItems.length;
            $('sai-exec-counter').textContent = `0/${totalExec}`;
            $('sai-exec-counter-wrap').style.display = 'flex';
            const updateExec = (done) => {
                const pct = totalExec ? Math.round(done / totalExec * 100) : 0;
                $('sai-exec-bar').style.width = pct + '%';
                $('sai-exec-bar').textContent = pct + '%';
                $('sai-exec-counter').textContent = `${done}/${totalExec}`;
            };
            let ok = 0, skipped = 0, fail = 0, subOk = 0, subFail = 0, subCreated = 0;
            let idx = 0;
            for (const it of pendingItems) {
                const code = it.src.country.toUpperCase();
                if (it.error) { iLog(`[${code}] pominięte (błąd podglądu)`); fail++; continue; }
                if (it.willChange) {
                    try {
                        await postAssignment(shopId, it.src.country, it.src.idr, it.current, it.planned, it.src);
                        if (it.mpChange && it.mpChange.willChange) {
                            await postMarketplaceState(shopId, it.src.idr, it.mpChange.target);
                            iLog(`[${code}] OK + marketplace (${it.mpChange.target.length} profili)`);
                        } else iLog(`[${code}] OK`);
                        ok++;
                    } catch (e) { iLog(`[${code}] BŁĄD: ${e.message}`); fail++; }
                } else { skipped++; }
                if (it.subItems) {
                    for (const si of it.subItems) {
                        const lab = `[${code}/sub:${si.src.name}]`;
                        if (!si.willChange) { skipped++; continue; }
                        try {
                            if (si.kind === 'create') {
                                const r = await createSubregion(shopId, it.src.country, it.src.idr, si.src);
                                if (Array.isArray(si.src.profile_auctions) && si.src.profile_auctions.length > 0) {
                                    try { await postMarketplaceState(shopId, r.newIdr, si.src.profile_auctions); } catch (e) {}
                                }
                                iLog(`${lab} UTWORZONY (idr=${r.newIdr})`);
                                subCreated++;
                            } else {
                                await postAssignment(shopId, it.src.country, si.current.idr, si.current, si.planned, { ...si.src, parent: it.src.idr });
                                if (si.mpChange && si.mpChange.willChange) {
                                    await postMarketplaceState(shopId, si.current.idr, si.mpChange.target);
                                    iLog(`${lab} OK + marketplace`);
                                } else iLog(`${lab} OK`);
                                subOk++;
                            }
                        } catch (e) { iLog(`${lab} BŁĄD: ${e.message}`); subFail++; }
                    }
                }
                idx++; updateExec(idx);
            }
            $('sai-exec-bar').classList.add('done');
            $('sai-exec-bar').style.width = '100%';
            $('sai-exec-bar').textContent = '100%';
            $('sai-exec-counter-wrap').style.display = 'none';
            iLog(`KONIEC. Kraje: ${ok} OK / ${skipped} pominiętych / ${fail} błędów. Subregiony: ${subOk} edycja / ${subCreated} nowe / ${subFail} błędów.`);
            $('sai-btn-execute').textContent = 'Wykonano';
            // Reload iframe
            const ifr = document.querySelector('iframe#oldPanelPage');
            if (ifr) { try { ifr.contentWindow.location.reload(); } catch (e) { ifr.src = ifr.src; } }
        };

        pillSetupImport('sai-pill-langs', 'sai-list-langs', v => {
            importLangMode = v;
            updateButtons();
        });
        pillSetupImport('sai-pill-countries', 'sai-list-countries', v => {
            importCountryMode = v;
            renderImportRegions();
            updateButtons();
        });
        pillSetupImport('sai-pill-regions', 'sai-list-regions', v => {
            importRegionMode = v;
            updateButtons();
        });

        $('sai-btn-cancel').onclick = close;
        // Klikanie w tlo NIE zamyka modalu

        return { open, close };
    }

    // Wstrzyknij linki "Eksportuj do JSON" / "Importuj z JSON" do breadcrumb iframe
    function injectBreadcrumbLinks(formDoc, exportDialog, importDialog) {
        const breadcrumb = formDoc.querySelector('ul.breadcrumb');
        if (!breadcrumb || breadcrumb.querySelector('.sa-bc-link')) return;

        const styleEl = formDoc.createElement('style');
        styleEl.textContent = `
            ul.breadcrumb li a.sa-bc-link {
                color: #2196F3;
                font-weight: 600;
                cursor: pointer;
            }
            ul.breadcrumb li a.sa-bc-link.import { color: #E91E63; }
            ul.breadcrumb li a.sa-bc-link:hover { text-decoration: underline; }
        `;
        formDoc.head.appendChild(styleEl);

        const liExport = formDoc.createElement('li');
        liExport.innerHTML = '<a href="#" class="sa-bc-link">Eksportuj przypisania do JSON</a>';
        breadcrumb.appendChild(liExport);
        liExport.querySelector('a').addEventListener('click', e => {
            e.preventDefault();
            exportDialog.open();
        });

        const liImport = formDoc.createElement('li');
        liImport.innerHTML = '<a href="#" class="sa-bc-link import">Importuj przypisania z JSON</a>';
        breadcrumb.appendChild(liImport);
        liImport.querySelector('a').addEventListener('click', e => {
            e.preventDefault();
            importDialog.open();
        });
    }

    // -----------------------------------------------------------------------
    // Logowanie
    // -----------------------------------------------------------------------
    function log(msg) {
        console.log('[ShippingAssign]', msg);
    }

    // -----------------------------------------------------------------------
    // EKSPORT - parsuj tabele krajow
    // -----------------------------------------------------------------------
    function extractAssignments(formDoc) {
        const result = [];
        // Wiersze z linkiem edit zawierajacym id=XX i idr=NNN
        const rows = formDoc.querySelectorAll('table tr[id^="tr_row_"]');
        rows.forEach(tr => {
            const editLink = tr.querySelector('a[href*="action=edit"][href*="config-shipping.php"]');
            if (!editLink) return;
            const href = editLink.getAttribute('href') || editLink.href;
            const m = href.match(/[?&]id=([a-z]{2,3})(?:&|$).*?[?&]idr=(\d+)/);
            if (!m) return;
            const country = m[1];
            const idr = m[2];
            // Subregion ma w URL parametr parent=ID
            const parentMatch = href.match(/[?&]parent=(\d+)/);
            const parent = parentMatch ? parentMatch[1] : null;

            // Pomijamy wstrzyknieta kolumne checkboxow (sa-chk-td), zeby indeksy kolumn sie nie przesuwaly
            const cells = Array.from(tr.querySelectorAll('td')).filter(td => !td.classList.contains('sa-chk-td'));
            // Kolejnosc kolumn: 0=Kraj, 1=dostawa detal, 2=dostawa hurt, 3=dostawa marketplace,
            //                   4=platnosc detal, 5=platnosc hurt, 6=platnosc marketplace,
            //                   7=VAT, 8=Klienci, 9=edytuj, 10=usun
            function profileIdFromCell(cell, type) {
                if (!cell) return '';
                const a = cell.querySelector(`a[href*="${type}.php?action=edit"]`);
                if (!a) return ''; // brak profilu = "nie wysylamy"
                const mm = a.href.match(/[?&]id=(\d+)/);
                return mm ? mm[1] : '';
            }
            function profileNameFromCell(cell) {
                if (!cell) return '';
                const a = cell.querySelector('a');
                return a ? a.textContent.trim() : (cell.textContent.trim() || '');
            }
            function vatFromCell(cell) {
                if (!cell) return 'd';
                const txt = cell.textContent.trim();
                if (txt === 'TAK' || txt === 'tak') return 'y';
                if (txt === 'NIE' || txt === 'nie') return 'n';
                return 'd'; // "z/bez" lub inne
            }

            const countryName = (cells[0]?.textContent || '').trim();
            const profile = profileIdFromCell(cells[1], 'config-shippingprofiles');
            const profile_wholesale = profileIdFromCell(cells[2], 'config-shippingprofiles');
            const profile_auctions_name = profileNameFromCell(cells[3]); // marketplace dostawy - z tabeli (link na auctionprofiles, nie do ID profilu)
            const payform = profileIdFromCell(cells[4], 'paymentprofile');
            const payform_wholesale = profileIdFromCell(cells[5], 'paymentprofile');
            const payform_auctions = profileIdFromCell(cells[6], 'paymentprofile');
            const vat = vatFromCell(cells[7]);

            const entry = {
                country,
                country_name: countryName,
                idr,
                profile,
                profile_name: profileNameFromCell(cells[1]),
                profile_wholesale,
                profile_wholesale_name: profileNameFromCell(cells[2]),
                profile_auctions_name, // marketplace dostawy - tylko nazwa ("nie wysylamy" lub liczba)
                payform,
                payform_name: profileNameFromCell(cells[4]),
                payform_wholesale,
                payform_wholesale_name: profileNameFromCell(cells[5]),
                payform_auctions,
                payform_auctions_name: profileNameFromCell(cells[6]),
                vat
            };
            if (parent) entry.parent = parent;
            result.push(entry);
        });
        return result;
    }

    // Pogrupuj subregiony pod krajami parent (assignments.subregions[])
    function nestSubregions(flat) {
        const byIdr = {};
        const countries = [];
        flat.forEach(e => {
            if (!e.parent) {
                e.subregions = []; // zawsze zeruj - funkcja jest idempotentna (moze byc wywolana wielokrotnie)
                byIdr[e.idr] = e;
                countries.push(e);
            }
        });
        flat.forEach(e => {
            if (e.parent) {
                const parent = byIdr[e.parent];
                const sub = {
                    idr_source: e.idr,
                    name: e.name || '',
                    postcodefrom: e.postcodefrom || '',
                    postcodeto: e.postcodeto || '',
                    profile: e.profile,
                    profile_name: e.profile_name,
                    profile_wholesale: e.profile_wholesale,
                    profile_wholesale_name: e.profile_wholesale_name,
                    profile_auctions_name: e.profile_auctions_name,
                    profile_auctions: e.profile_auctions,
                    payform: e.payform,
                    payform_name: e.payform_name,
                    payform_wholesale: e.payform_wholesale,
                    payform_wholesale_name: e.payform_wholesale_name,
                    payform_auctions: e.payform_auctions,
                    payform_auctions_name: e.payform_auctions_name,
                    vat: e.vat
                };
                if (parent) parent.subregions.push(sub);
                else countries.push({ ...sub, country: e.country, parent_missing: e.parent });
            }
        });
        // Usun puste subregions[]
        countries.forEach(c => { if (c.subregions && c.subregions.length === 0) delete c.subregions; });
        return countries;
    }

    // Dla wszystkich krajow + subregionow pobierz liste profili dostaw zaznaczonych dla marketplace
    // Wynik: a.profile_auctions = ["ID1", "ID2", ...] (puste = "nie wysylamy")
    async function enrichMarketplaceProfiles(flatAssignments, shopId) {
        if (flatAssignments.length === 0) return;
        log(`Marketplace: pobieram profile dostaw dla ${flatAssignments.length} krajow/subregionow...`);
        for (let i = 0; i < flatAssignments.length; i++) {
            const a = flatAssignments[i];
            try {
                const url = `${PANEL_ORIGIN}/panel/config-shipping.php?action=auctionprofiles&shop=${shopId}&region=${a.idr}`;
                const html = await (await fetch(url, { credentials: "include" })).text();
                const doc = new DOMParser().parseFromString(html, "text/html");
                const checked = Array.from(doc.querySelectorAll("input[name='profiles[]']:checked")).map(cb => cb.value);
                a.profile_auctions = checked;
            } catch (e) {
                a.profile_auctions = [];
                log(`  [${a.country}/${a.idr}] BLAD pobrania marketplace: ${e.message}`);
            }
            if ((i + 1) % 10 === 0) log(`  Marketplace ${i + 1}/${flatAssignments.length}...`);
        }
        log(`Marketplace: gotowe.`);
    }

    // Dla subregionow doczytaj name/postcodefrom/postcodeto z formularza edycji
    async function enrichSubregions(flatAssignments, shopId) {
        const subs = flatAssignments.filter(a => a.parent);
        if (subs.length === 0) return;
        log(`Subregiony (${subs.length}): pobieram nazwy i kody pocztowe...`);
        for (const a of subs) {
            try {
                const url = `${PANEL_ORIGIN}/panel/config-shipping.php?action=edit&id=${encodeURIComponent(a.country)}&shop=${shopId}&idr=${a.idr}&parent=${a.parent}`;
                const html = await (await fetch(url, { credentials: 'include' })).text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const form = findEditForm(doc);
                if (!form) continue;
                const get = (n) => { const el = form.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
                a.name = get('name');
                a.postcodefrom = get('postcodefrom');
                a.postcodeto = get('postcodeto');
            } catch (e) {
                log(`  [${a.country}/${a.idr}] BLAD pobrania subregionu: ${e.message}`);
            }
        }
        log(`Subregiony: gotowe.`);
    }

    // Pobierz wielojezyczne nazwy kraju (languages[xx][regionname]) z formularza edycji
    // Zwraca { pol: "Polska", eng: "Poland", ... } dla wszystkich jezykow obecnych w formularzu
    async function fetchCountryLanguageNames(shopId, country, idr, parent) {
        const doc = await fetchEditPage(shopId, country, idr, parent);
        const form = findEditForm(doc);
        const out = {};
        if (!form) return out;
        form.querySelectorAll('[name*="[regionname]"]').forEach(el => {
            const m = el.name.match(/languages\[([a-z]{2,3})\]\[regionname\]/);
            if (m) out[m[1]] = el.value || '';
        });
        return out;
    }

    // Wykryj jezyki dostepne w sklepie (na podstawie formularza pierwszego kraju)
    async function detectAvailableLanguages(flatAssignments, shopId) {
        const first = flatAssignments.find(a => !a.parent);
        if (!first) return [];
        try {
            const names = await fetchCountryLanguageNames(shopId, first.country, first.idr, null);
            const langs = Object.keys(names);
            return langs.length ? langs : LANG_CODES.slice();
        } catch (e) {
            return LANG_CODES.slice();
        }
    }

    // Dla kazdego kraju (nie subregionu) doczytaj nazwy w wybranych jezykach -> a.languages = {lang: name}
    async function enrichCountryLanguages(flatAssignments, shopId, langs) {
        if (!langs || langs.length === 0) return;
        const countries = flatAssignments.filter(a => !a.parent);
        log(`Nazwy jezykowe (${countries.length} krajow, ${langs.length} jezykow): pobieram...`);
        for (let i = 0; i < countries.length; i++) {
            const a = countries[i];
            try {
                const names = await fetchCountryLanguageNames(shopId, a.country, a.idr, null);
                a.languages = {};
                for (const l of langs) if (names[l] !== undefined) a.languages[l] = names[l];
            } catch (e) {
                a.languages = a.languages || {};
                log(`  [${a.country}/${a.idr}] BLAD pobrania nazw: ${e.message}`);
            }
            if ((i + 1) % 10 === 0) log(`  Nazwy ${i + 1}/${countries.length}...`);
        }
        log(`Nazwy jezykowe: gotowe.`);
    }

    async function buildExportJson(formDoc, shopId) {
        const flat = extractAssignments(formDoc);
        await enrichSubregions(flat, shopId);
        const assignments = nestSubregions(flat);
        const subCount = assignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
        return {
            _format: 'idosell-shipping-assignments-v2',
            _exported: new Date().toISOString(),
            _source_shop: shopId,
            _source_url: window.location.href,
            _count: assignments.length,
            _subregion_count: subCount,
            assignments
        };
    }


    // -----------------------------------------------------------------------
    // IMPORT - helpery sieciowe
    // -----------------------------------------------------------------------
    // Pobierz aktualna liste profili dostaw zaznaczonych dla marketplace (region = idr kraju lub subregionu)
    async function fetchMarketplaceState(shopId, idr) {
        const url = `${PANEL_ORIGIN}/panel/config-shipping.php?action=auctionprofiles&shop=${shopId}&region=${idr}`;
        const html = await (await fetch(url, { credentials: 'include' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return Array.from(doc.querySelectorAll('input[name="profiles[]"]:checked')).map(cb => cb.value);
    }

    // Zapisz liste profili dostaw dla marketplace
    async function postMarketplaceState(shopId, idr, profileIds) {
        const fd = new FormData();
        fd.append('__iai_shop_panel[__encoding]', 'utf-8');
        fd.append('shop', String(shopId));
        fd.append('region', String(idr));
        for (const id of (profileIds || [])) fd.append('profiles[]', String(id));
        const res = await fetch(`${PANEL_ORIGIN}/panel/config-shipping.php?action=saveauctionprofiles`, {
            method: 'POST', credentials: 'include', body: fd
        });
        if (!res.ok) throw new Error(`POST marketplace ${res.status}`);
        return true;
    }

    // Decyzja czy/jak zmienic marketplace zgodnie z trybem importu
    // current: aktualna lista (target)
    // src: zrodlowa lista (z eksportu)
    // mode: skip|fill_empty|overwrite
    // currentRecord: aktualne dane formularza (do sprawdzenia czy "puste" w trybie fill_empty/skip)
    function computeMarketplaceChange(currentList, srcList, mode, currentRecord, enabledFields) {
        // Pole wylaczone w UI - nie ruszamy
        if (enabledFields && !enabledFields.has('profile_auctions')) {
            return { willChange: false, target: currentList, action: 'keep' };
        }
        const equal = arraysEqualIgnoreOrder(currentList, srcList);
        if (equal) return { willChange: false, target: currentList, action: 'keep' };
        const isCurEmpty = !currentList || currentList.length === 0;
        if (mode === 'overwrite') return { willChange: true, target: srcList, action: 'overwrite' };
        if (mode === 'fill_empty') {
            if (isCurEmpty && srcList.length > 0) return { willChange: true, target: srcList, action: 'fill' };
            return { willChange: false, target: currentList, action: 'keep' };
        }
        if (mode === 'update_existing') {
            const fields = ['profile', 'profile_wholesale', 'payform', 'payform_wholesale'];
            const recordExists = !fields.every(f => !currentRecord[f]);
            if (recordExists) return { willChange: true, target: srcList, action: 'update' };
            return { willChange: false, target: currentList, action: 'keep' };
        }
        if (mode === 'skip') {
            const fields = ['profile', 'profile_wholesale', 'payform', 'payform_wholesale'];
            const allEmpty = fields.every(f => !currentRecord[f]);
            if (allEmpty && isCurEmpty && srcList.length > 0) return { willChange: true, target: srcList, action: 'add' };
        }
        return { willChange: false, target: currentList, action: 'keep' };
    }

    function arraysEqualIgnoreOrder(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        const sa = [...a].map(String).sort();
        const sb = [...b].map(String).sort();
        return sa.every((v, i) => v === sb[i]);
    }

    async function fetchEditPage(shopId, country, idr, parent) {
        let url = `${PANEL_ORIGIN}/panel/config-shipping.php?action=edit&id=${encodeURIComponent(country)}&shop=${shopId}&idr=${idr}`;
        if (parent) url += `&parent=${parent}`;
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
        const html = await res.text();
        const parser = new DOMParser();
        return parser.parseFromString(html, 'text/html');
    }

    function findEditForm(doc) {
        return Array.from(doc.querySelectorAll('form')).find(f =>
            f.method && f.method.toLowerCase() === 'post' && /config-shipping\.php/.test(f.action || f.getAttribute('action') || '')
        );
    }

    function readFormState(doc, shopId) {
        const form = findEditForm(doc);
        if (!form) return null;
        const get = (name) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (!el) return null;
            if (el.tagName === 'SELECT') return el.value;
            if (el.type === 'radio') {
                const checked = form.querySelector(`[name="${name}"]:checked`);
                return checked ? checked.value : null;
            }
            return el.value;
        };
        // Czytaj WSZYSTKIE wersje jezykowe nazwy obecne w formularzu (nie tylko LANG_CODES)
        const languages = {};
        form.querySelectorAll('[name*="[regionname]"]').forEach(el => {
            const m = el.name.match(/languages\[([a-z]{2,3})\]\[regionname\]/);
            if (m) languages[m[1]] = el.value || '';
        });
        // Subregion ma pole "name" zamiast languages[][regionname]
        const isSubregion = !!form.querySelector('[name="parent"]');
        return {
            form,
            isSubregion,
            languages,
            name: get('name') || '',
            postcodefrom: get('postcodefrom') || '',
            postcodeto: get('postcodeto') || '',
            parent: get('parent') || '',
            profile: get(`profile_${shopId}`) || '',
            profile_wholesale: get(`profile_wholesale_${shopId}`) || '',
            profile_auctions: get(`profile_auctions_${shopId}`) || '',
            profile_auctions_count: get(`profile_auctions_count_${shopId}`) || '0',
            payform: get(`payform_${shopId}`) || '',
            payform_wholesale: get(`payform_wholesale_${shopId}`) || '',
            payform_auctions: get(`payform_auctions_${shopId}`) || '',
            vat: get('vat') || 'd'
        };
    }

    function isEmpty(v) {
        return v === '' || v === null || v === undefined;
    }

    function diffPlanned(current, source, mode, enabledFields, enabledLangs) {
        // enabledFields - Set z polami ktore user chce zmieniac. Pola spoza Set -> nie ruszamy.
        // enabledLangs - Set z kodami jezykow nazwy kraju do zmiany (puste = nie ruszamy nazw).
        // Domyslnie wszystkie pola wlaczone.
        const allFields = ['profile', 'profile_wholesale', 'payform', 'payform_wholesale', 'vat', 'profile_auctions', 'payform_auctions'];
        if (!enabledFields) enabledFields = new Set(allFields);

        const fields = ['profile', 'profile_wholesale', 'payform', 'payform_wholesale'];
        const planned = {};
        const changes = [];
        let willChange = false;
        const allCurrentEmpty = fields.every(f => isEmpty(current[f]));

        // Tryby: skip, fill_empty, overwrite, update_existing
        // update_existing: jak overwrite ale TYLKO dla istniejacych (allCurrentEmpty=false), inaczej pomin
        const isUpdateExisting = mode === 'update_existing';
        const recordExists = !allCurrentEmpty;

        for (const f of fields) {
            const cur = current[f] || '';
            const src = source[f] || '';
            let newVal = cur;
            let action = 'keep';

            if (!enabledFields.has(f)) {
                // Pole wylaczone w UI - nie ruszamy
                planned[f] = cur;
                continue;
            }

            if (mode === 'overwrite') {
                newVal = src;
                if (cur !== src) action = 'overwrite';
            } else if (mode === 'fill_empty') {
                if (isEmpty(cur) && !isEmpty(src)) {
                    newVal = src;
                    action = 'fill';
                }
            } else if (mode === 'skip') {
                if (allCurrentEmpty && !isEmpty(src)) {
                    newVal = src;
                    action = 'add';
                }
            } else if (isUpdateExisting) {
                // Tylko gdy rekord juz istnieje (cokolwiek ustawione)
                if (recordExists) {
                    newVal = src;
                    if (cur !== src) action = 'update';
                }
            }
            planned[f] = newVal;
            if (action !== 'keep') willChange = true;
            changes.push({field: f, from: cur, to: newVal, action});
        }
        // VAT
        let vatPlanned = current.vat;
        if (enabledFields.has('vat')) {
            if (mode === 'overwrite') vatPlanned = source.vat;
            else if (mode === 'skip' && allCurrentEmpty) vatPlanned = source.vat;
            else if (isUpdateExisting && recordExists) vatPlanned = source.vat;
            else if (mode === 'fill_empty' && isEmpty(current.vat)) vatPlanned = source.vat;
        }
        if (vatPlanned !== current.vat) willChange = true;
        planned.vat = vatPlanned;

        // Pola subregionu (name/postcode)
        if (current.isSubregion) {
            const subFields = ['name', 'postcodefrom', 'postcodeto'];
            for (const f of subFields) {
                const cur = current[f] || '';
                const src = (source[f] !== undefined) ? (source[f] || '') : null;
                if (src === null) continue;
                let newVal = cur, action = 'keep';
                if (mode === 'overwrite') {
                    newVal = src;
                    if (cur !== src) action = 'overwrite';
                } else if (mode === 'fill_empty') {
                    if (isEmpty(cur) && !isEmpty(src)) { newVal = src; action = 'fill'; }
                } else if (mode === 'skip') {
                    if (allCurrentEmpty && !isEmpty(src)) { newVal = src; action = 'add'; }
                } else if (isUpdateExisting && recordExists) {
                    newVal = src;
                    if (cur !== src) action = 'update';
                }
                planned[f] = newVal;
                if (action !== 'keep') {
                    willChange = true;
                    changes.push({field: f, from: cur, to: newVal, action});
                }
            }
        }

        // Wielojezyczna nazwa kraju (languages[lang][regionname]) - tylko dla krajow (nie subregionow)
        if (!current.isSubregion && source.languages && enabledLangs && enabledLangs.size) {
            const curLangs = current.languages || {};
            planned.languages = {};
            for (const lang of enabledLangs) {
                const srcName = source.languages[lang];
                if (srcName === undefined) continue;          // jezyka nie ma w pliku - pomin
                const curName = curLangs[lang] || '';
                let newVal = curName, action = 'keep';
                if (mode === 'overwrite') {
                    newVal = srcName;
                    if (curName !== srcName) action = 'overwrite';
                } else if (mode === 'fill_empty') {
                    if (isEmpty(curName) && !isEmpty(srcName)) { newVal = srcName; action = 'fill'; }
                } else if (mode === 'skip') {
                    if (allCurrentEmpty && !isEmpty(srcName)) { newVal = srcName; action = 'add'; }
                } else if (isUpdateExisting && recordExists) {
                    newVal = srcName;
                    if (curName !== srcName) action = 'update';
                }
                planned.languages[lang] = newVal;
                if (action !== 'keep') {
                    willChange = true;
                    changes.push({ field: `nazwa[${lang}]`, from: curName, to: newVal, action });
                }
            }
        }

        return { planned, changes, willChange };
    }

    async function postAssignment(shopId, country, idr, current, planned, src) {
        // Pobierz swiezy formularz docelowy (z parentem jesli subregion)
        const editDoc = await fetchEditPage(shopId, country, idr, src && src.parent);
        const form = findEditForm(editDoc);
        if (!form) throw new Error('Brak formularza edycji');

        const setVal = (name, value) => {
            const el = form.querySelector(`[name="${name}"]`);
            if (el) el.value = value == null ? '' : value;
        };
        const setRadio = (name, value) => {
            form.querySelectorAll(`[name="${name}"]`).forEach(el => { el.checked = (el.value === value); });
        };
        setVal(`profile_${shopId}`, planned.profile);
        setVal(`profile_wholesale_${shopId}`, planned.profile_wholesale);
        setVal(`payform_${shopId}`, planned.payform);
        setVal(`payform_wholesale_${shopId}`, planned.payform_wholesale);
        setRadio('vat', planned.vat || 'd');

        // Subregion - podmien name/postcode jesli sa w eksporcie
        if (current.isSubregion) {
            if (src && src.name) setVal('name', src.name);
            if (src && src.postcodefrom !== undefined) setVal('postcodefrom', src.postcodefrom);
            if (src && src.postcodeto !== undefined) setVal('postcodeto', src.postcodeto);
        } else if (planned.languages) {
            // Kraj - podmien wielojezyczne nazwy zgodnie z planem (tylko wybrane jezyki obecne w formularzu)
            for (const lang in planned.languages) {
                setVal(`languages[${lang}][regionname]`, planned.languages[lang]);
            }
        }

        const fd = new FormData(form);
        const ensure = (name, value) => {
            if (!fd.has(name) && value !== undefined && value !== null) fd.set(name, value);
        };
        ensure(`profile_${shopId}`, planned.profile);
        ensure(`profile_wholesale_${shopId}`, planned.profile_wholesale);
        ensure(`payform_${shopId}`, planned.payform);
        ensure(`payform_wholesale_${shopId}`, planned.payform_wholesale);
        if (current.isSubregion && src) {
            if (src.name) ensure('name', src.name);
            if (src.postcodefrom !== undefined) ensure('postcodefrom', src.postcodefrom);
            if (src.postcodeto !== undefined) ensure('postcodeto', src.postcodeto);
            if (src.parent) ensure('parent', src.parent);
        }

        const res = await fetch(`${PANEL_ORIGIN}/panel/config-shipping.php`, {
            method: 'POST',
            credentials: 'include',
            body: fd
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        if (!/msg=1/.test(res.url)) {
            const txt = await res.text();
            if (/error|błąd|nieprawidłow/i.test(txt.substring(0, 50000))) {
                throw new Error('Serwer odrzucil zmiany (brak msg=1)');
            }
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // Tworzenie nowego subregionu przez add_region (zeby nazwa pojawila sie w liscie)
    // -----------------------------------------------------------------------
    async function createSubregion(shopId, country, parentIdr, srcSub) {
        const url = `${PANEL_ORIGIN}/panel/config-shipping.php?action=add_region&parent=${parentIdr}&shop=${shopId}`;
        const getRes = await fetch(url, { credentials: 'include' });
        if (!getRes.ok) throw new Error(`GET add_region ${getRes.status}`);
        const doc = new DOMParser().parseFromString(await getRes.text(), 'text/html');
        const form = findEditForm(doc);
        if (!form) throw new Error('Brak formularza add_region');
        const setVal = (n, v) => { const el = form.querySelector(`[name="${n}"]`); if (el) el.value = v == null ? '' : v; };
        setVal('name', srcSub.name);
        setVal('postcodefrom', srcSub.postcodefrom);
        setVal('postcodeto', srcSub.postcodeto);
        setVal(`profile_${shopId}`, srcSub.profile);
        setVal(`profile_wholesale_${shopId}`, srcSub.profile_wholesale);
        setVal(`payform_${shopId}`, srcSub.payform);
        setVal(`payform_wholesale_${shopId}`, srcSub.payform_wholesale);
        // VAT - radio
        form.querySelectorAll('[name="vat"]').forEach(el => { el.checked = (el.value === (srcSub.vat || 'd')); });
        const fd = new FormData(form);
        const newIdr = fd.get('idr');
        const ensure = (n, v) => { if (!fd.has(n) && v != null) fd.set(n, v); };
        ensure(`profile_${shopId}`, srcSub.profile);
        ensure(`profile_wholesale_${shopId}`, srcSub.profile_wholesale);
        ensure(`payform_${shopId}`, srcSub.payform);
        ensure(`payform_wholesale_${shopId}`, srcSub.payform_wholesale);
        const res = await fetch(`${PANEL_ORIGIN}/panel/config-shipping.php`, {
            method: 'POST', credentials: 'include', body: fd
        });
        if (!res.ok) throw new Error(`POST add_region ${res.status}`);
        if (!/msg=1/.test(res.url)) {
            const txt = await res.text();
            if (/error|błąd|nieprawidłow/i.test(txt.substring(0, 50000))) {
                throw new Error('add_region odrzucony (brak msg=1)');
            }
        }
        return { newIdr };
    }

    // -----------------------------------------------------------------------
    // Helper: pobierz subregiony docelowego sklepu dla danego kraju
    // Zwraca [{idr, name, postcodefrom, postcodeto, listName, hasListName}]
    // listName = nazwa renderowana w tabeli listy (moze byc pusta dla "uszkodzonych")
    // -----------------------------------------------------------------------
    async function fetchTargetSubregions(shopId, country, parentIdr) {
        const html = await (await fetch(`${PANEL_ORIGIN}/panel/config-shipping.php?shop=${shopId}`, { credentials: 'include' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = Array.from(doc.querySelectorAll('table tr[id^="tr_row_"]'));
        const subs = [];
        for (const tr of rows) {
            const a = tr.querySelector('a[href*="action=edit"][href*="config-shipping.php"]');
            if (!a) continue;
            const href = a.getAttribute('href');
            const m = href.match(/[?&]id=([a-z]{2,3}).*?[?&]idr=(\d+).*?[?&]parent=(\d+)/);
            if (!m) continue;
            if (m[1] !== country || m[3] !== parentIdr) continue;
            const cellHtml = tr.querySelector('td')?.innerHTML || '';
            // listName - tekst po stripie diva wciecia
            const listNameMatch = cellHtml.match(/<div[^>]*>([^<]*)<\/div>/);
            const listName = listNameMatch ? listNameMatch[1].trim() : '';
            // Pobierz pelne dane edit
            try {
                const editHtml = await (await fetch(`${PANEL_ORIGIN}/panel/config-shipping.php?action=edit&id=${country}&shop=${shopId}&idr=${m[2]}&parent=${parentIdr}`, { credentials: 'include' })).text();
                const eDoc = new DOMParser().parseFromString(editHtml, 'text/html');
                const form = findEditForm(eDoc);
                const get = (n) => { const el = form && form.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
                subs.push({
                    idr: m[2],
                    name: get('name'),
                    postcodefrom: get('postcodefrom'),
                    postcodeto: get('postcodeto'),
                    profile: get(`profile_${shopId}`) || '',
                    profile_wholesale: get(`profile_wholesale_${shopId}`) || '',
                    payform: get(`payform_${shopId}`) || '',
                    payform_wholesale: get(`payform_wholesale_${shopId}`) || '',
                    vat: get('vat') || 'd',
                    listName,
                    hasListName: !!listName
                });
            } catch (e) {}
        }
        return subs;
    }

    // Dopasuj subregion zrodlowy do docelowego po name+postcode
    function matchSubregion(srcSub, targetSubs) {
        return targetSubs.find(t =>
            t.name === srcSub.name &&
            String(t.postcodefrom) === String(srcSub.postcodefrom) &&
            String(t.postcodeto) === String(srcSub.postcodeto)
        );
    }

    // -----------------------------------------------------------------------
    // Podglad zmian
    // -----------------------------------------------------------------------
    async function buildPreview(config, shopId, mode, enabledFields, enabledLangs, onProgress) {
        const items = [];
        const total = config.assignments.length;
        const totalSubs = config.assignments.reduce((n, c) => n + (c.subregions ? c.subregions.length : 0), 0);
        log(`Buduje podglad dla ${total} krajow${totalSubs ? ` (+ ${totalSubs} subregionow)` : ''} (sklep docelowy: ${shopId}, tryb: ${mode})...`);
        if (onProgress) onProgress(0, total);
        for (let i = 0; i < total; i++) {
            const src = config.assignments[i];
            try {
                const editDoc = await fetchEditPage(shopId, src.country, src.idr, src.parent);
                const current = readFormState(editDoc, shopId);
                if (!current) {
                    items.push({ src, error: 'Nie znaleziono formularza w docelowym sklepie' });
                    continue;
                }
                const { planned, changes, willChange } = diffPlanned(current, src, mode, enabledFields, enabledLangs);
                let mpChange = null;
                if (Array.isArray(src.profile_auctions) && (!enabledFields || enabledFields.has('profile_auctions'))) {
                    const curMp = await fetchMarketplaceState(shopId, src.idr);
                    mpChange = computeMarketplaceChange(curMp, src.profile_auctions, mode, current, enabledFields);
                    if (mpChange.willChange) {
                        changes.push({ field: 'profile_auctions', from: `[${curMp.length}]`, to: `[${mpChange.target.length}]`, action: mpChange.action });
                    }
                }
                const item = { src, current, planned, changes, willChange: willChange || (mpChange && mpChange.willChange), subItems: [], mpChange };
                // Subregiony
                if (src.subregions && src.subregions.length > 0) {
                    const targetSubs = await fetchTargetSubregions(shopId, src.country, src.idr);
                    const orphans = targetSubs.filter(t => !t.hasListName);
                    for (const srcSub of src.subregions) {
                        const matched = matchSubregion(srcSub, targetSubs);
                        if (matched) {
                            const subPlanned = diffPlanned(matched, srcSub, mode, enabledFields);
                            let subMp = null;
                            if (Array.isArray(srcSub.profile_auctions) && (!enabledFields || enabledFields.has('profile_auctions'))) {
                                const curMpSub = await fetchMarketplaceState(shopId, matched.idr);
                                subMp = computeMarketplaceChange(curMpSub, srcSub.profile_auctions, mode, matched, enabledFields);
                                if (subMp.willChange) {
                                    subPlanned.changes.push({ field: 'profile_auctions', from: `[${curMpSub.length}]`, to: `[${subMp.target.length}]`, action: subMp.action });
                                    subPlanned.willChange = true;
                                }
                            }
                            item.subItems.push({
                                kind: 'edit',
                                src: srcSub,
                                current: matched,
                                planned: subPlanned.planned,
                                changes: subPlanned.changes,
                                willChange: subPlanned.willChange,
                                mpChange: subMp
                            });
                        } else {
                            // Brak dopasowania w docelowym
                            // W trybie update_existing - NIE tworzymy nowych. W innych - kind=create.
                            if (mode === 'update_existing') {
                                item.subItems.push({
                                    kind: 'skip',
                                    src: srcSub,
                                    willChange: false,
                                    reason: 'tryb "tylko aktualizacja" - subregion nie istnieje'
                                });
                            } else {
                                item.subItems.push({
                                    kind: 'create',
                                    src: srcSub,
                                    willChange: true,
                                    orphans: orphans.length > 0 ? orphans : null
                                });
                            }
                        }
                    }
                }
                items.push(item);
            } catch (e) {
                items.push({ src, error: e.message });
            }
            if ((i + 1) % 5 === 0) log(`  Pobrano ${i + 1}/${total}...`);
            if (onProgress) onProgress(i + 1, total);
        }
        return items;
    }

    function renderPreview(items) {
        const el = document.getElementById('sa-preview');
        el.innerHTML = '';
        let nNew = 0, nOver = 0, nSkip = 0, nErr = 0, nCreate = 0, nWarn = 0;
        for (const it of items) {
            const div = document.createElement('div');
            const code = it.src.country.toUpperCase();
            const name = it.src.country_name || '';
            if (it.error) {
                div.className = 'sa-row-error';
                div.textContent = `[${code}] ${name} - BLAD: ${it.error}`;
                nErr++;
            } else if (!it.willChange) {
                div.className = 'sa-row-skip';
                div.textContent = `[${code}] ${name} - bez zmian`;
                nSkip++;
            } else {
                const actions = it.changes.filter(c => c.action !== 'keep');
                const hasOver = actions.some(c => c.action === 'overwrite');
                div.className = hasOver ? 'sa-row-overwrite' : 'sa-row-new';
                if (hasOver) nOver++; else nNew++;
                const summary = actions.map(c => `${c.field}: ${c.from || '∅'} -> ${c.to || '∅'}`).join(', ');
                div.textContent = `[${code}] ${name} - ${summary}`;
            }
            el.appendChild(div);
            // Subregiony - wyswietl pod krajem z wcieciem
            if (it.subItems && it.subItems.length > 0) {
                for (const si of it.subItems) {
                    const sd = document.createElement('div');
                    sd.style.marginLeft = '14px';
                    const sn = si.src.name || '?';
                    if (si.kind === 'create') {
                        sd.className = 'sa-row-new';
                        let txt = `└ subregion "${sn}" (${si.src.postcodefrom}-${si.src.postcodeto}) -> NOWY REKORD (idr zostanie wygenerowany)`;
                        if (si.orphans) txt += ` ⚠ uwaga: w docelowym jest ${si.orphans.length} subregion(ow) bez nazwy w liscie - sprawdz recznie!`;
                        sd.textContent = txt;
                        nCreate++;
                        if (si.orphans) nWarn++;
                    } else if (!si.willChange) {
                        sd.className = 'sa-row-skip';
                        sd.textContent = `└ subregion "${sn}" - bez zmian`;
                        nSkip++;
                    } else {
                        const actions = si.changes.filter(c => c.action !== 'keep');
                        const hasOver = actions.some(c => c.action === 'overwrite');
                        sd.className = hasOver ? 'sa-row-overwrite' : 'sa-row-new';
                        if (hasOver) nOver++; else nNew++;
                        const summary = actions.map(c => `${c.field}: ${c.from || '∅'} -> ${c.to || '∅'}`).join(', ');
                        sd.textContent = `└ subregion "${sn}" - ${summary}`;
                    }
                    el.appendChild(sd);
                }
            }
        }
        const sum = document.createElement('div');
        sum.style.cssText = 'margin-top:6px; padding-top:6px; border-top:1px solid #ddd; font-weight:bold;';
        sum.textContent = `RAZEM: nowe/uzupelnione: ${nNew}, nadpisane: ${nOver}, NOWE subregiony: ${nCreate}, bez zmian: ${nSkip}, bledy: ${nErr}` + (nWarn ? `, OSTRZEZENIA: ${nWarn}` : '');
        el.appendChild(sum);
        return { nNew, nOver, nSkip, nErr, nCreate, nWarn };
    }

    // -----------------------------------------------------------------------
    // ZAZNACZANIE WIELU KRAJOW - kolumna checkboxow + pasek akcji grupowych
    // -----------------------------------------------------------------------
    function getCheckedRows(formDoc) {
        if (!formDoc) return [];
        return Array.from(formDoc.querySelectorAll('input.sa-row-chk:checked')).map(cb => ({
            idr: cb.dataset.idr,
            country: cb.dataset.country,
            parent: cb.dataset.parent || '',
            clearHref: cb.dataset.clear || '',
            name: cb.dataset.name || ''
        }));
    }

    function updateBulkBar(formDoc) {
        const bar = document.getElementById('sa-bulk-bar');
        if (!bar) return;
        const checked = getCheckedRows(formDoc);
        const cnt = document.getElementById('sa-bulk-count');
        if (cnt) cnt.textContent = String(checked.length);
        bar.classList.toggle('sa-visible', checked.length > 0);
        // Stan checkboxa "zaznacz wszystkie"
        const selAll = formDoc.querySelector('input.sa-selectall');
        const all = formDoc.querySelectorAll('input.sa-row-chk');
        if (selAll && all.length) {
            if (checked.length === 0) { selAll.checked = false; selAll.indeterminate = false; }
            else if (checked.length === all.length) { selAll.checked = true; selAll.indeterminate = false; }
            else { selAll.indeterminate = true; }
        }
    }

    // Wstrzykuje kolumne checkboxow do tabeli listy (idempotentnie)
    function injectCheckboxColumn(formDoc) {
        const table = formDoc.querySelector('table');
        if (!table) return;
        if (table.querySelector('.sa-chk-th')) return; // juz wstrzykniete w tej tabeli

        const allRows = Array.from(table.querySelectorAll('tr'));
        // Naglowek wiersz 1 = pierwszy tr z komorka "Kraj" (rowspan=2); fallback: pierwszy tr
        const headerRow1 = allRows.find(tr => /(>|\s)Kraj(<|\s)/.test(tr.innerHTML) && tr.querySelector('td.title, th.title')) || allRows[0];
        if (headerRow1) {
            const th = formDoc.createElement('td');
            th.className = 'title sa-chk-th';
            th.setAttribute('rowspan', '2');
            const selAll = formDoc.createElement('input');
            selAll.type = 'checkbox';
            selAll.className = 'sa-selectall';
            selAll.title = 'Zaznacz / odznacz wszystkie';
            th.appendChild(selAll);
            headerRow1.insertBefore(th, headerRow1.firstChild);
            selAll.addEventListener('change', () => {
                table.querySelectorAll('input.sa-row-chk').forEach(cb => {
                    cb.checked = selAll.checked;
                    const tr = cb.closest('tr');
                    if (tr) tr.classList.toggle('sa-row-checked', selAll.checked);
                });
                selAll.indeterminate = false;
                updateBulkBar(formDoc);
            });
        }

        const dataRows = table.querySelectorAll('tr[id^="tr_row_"]');
        dataRows.forEach(tr => {
            const editLink = tr.querySelector('a[href*="action=edit"][href*="config-shipping.php"]');
            if (!editLink) return;
            const href = editLink.getAttribute('href') || editLink.href;
            const m = href.match(/[?&]id=([a-z]{2,3})(?:&|$).*?[?&]idr=(\d+)/);
            if (!m) return;
            const country = m[1];
            const idr = m[2];
            const parentMatch = href.match(/[?&]parent=(\d+)/);
            const parent = parentMatch ? parentMatch[1] : '';
            const clearLink = tr.querySelector('a[href*="action=clear"]');
            const firstCell = tr.querySelector('td');
            const name = (firstCell ? firstCell.textContent : '').trim();

            const td = formDoc.createElement('td');
            td.className = ((firstCell && firstCell.className) || 'row0') + ' sa-chk-td';
            const cb = formDoc.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'sa-row-chk';
            cb.dataset.idr = idr;
            cb.dataset.country = country;
            cb.dataset.parent = parent;
            cb.dataset.name = name;
            if (clearLink) cb.dataset.clear = clearLink.getAttribute('href') || clearLink.href;
            td.appendChild(cb);
            tr.insertBefore(td, tr.firstChild);
            cb.addEventListener('change', () => {
                tr.classList.toggle('sa-row-checked', cb.checked);
                updateBulkBar(formDoc);
            });
        });
        updateBulkBar(formDoc);
    }

    let bulkBarWired = false;
    function initBulkBar() {
        if (bulkBarWired) return;
        bulkBarWired = true;
        const clearBtn = document.getElementById('sa-bulk-clear');
        const exportBtn = document.getElementById('sa-bulk-export');
        const deleteBtn = document.getElementById('sa-bulk-delete');
        if (clearBtn) clearBtn.onclick = () => {
            if (!currentCtx) return;
            currentCtx.formDoc.querySelectorAll('input.sa-row-chk').forEach(cb => {
                cb.checked = false;
                const tr = cb.closest('tr'); if (tr) tr.classList.remove('sa-row-checked');
            });
            updateBulkBar(currentCtx.formDoc);
        };
        if (exportBtn) exportBtn.onclick = () => {
            if (!currentCtx) return;
            const checked = getCheckedRows(currentCtx.formDoc);
            if (!checked.length) return;
            // Mapuj zaznaczone wiersze na kraje (subregion -> parent)
            const countryIdrs = [...new Set(checked.map(r => r.parent || r.idr))];
            currentCtx.exportDialog.open(countryIdrs);
        };
        if (deleteBtn) deleteBtn.onclick = () => {
            if (!currentCtx) return;
            const checked = getCheckedRows(currentCtx.formDoc);
            if (!checked.length) return;
            currentCtx.deleteDialog.open(currentCtx.formDoc, currentCtx.shopId);
        };
    }

    // -----------------------------------------------------------------------
    // GRUPOWE USUWANIE - reuzje linku "usun" (action=clear) z kazdego wiersza
    // -----------------------------------------------------------------------
    async function clearAssignment(href) {
        // Link "usun" z tabeli wskazuje na nowy panel (/panel/app/...), ktory zwraca tylko skorupe React
        // i NIE wykonuje akcji. Realny backend to /panel/config-shipping.php (bez /app/) - tak jak eksport/import.
        let url = /^https?:/i.test(href) ? href : (PANEL_ORIGIN + (href.startsWith('/') ? href : '/' + href));
        url = url.replace('/panel/app/', '/panel/');
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Po udanej akcji backend przekierowuje na liste krajow; skorupa React (brak <table>) = akcja sie nie wykonala
        const finalUrl = res.url || '';
        if (/\/panel\/app\//.test(finalUrl)) {
            throw new Error('akcja trafila na nowy panel (skorupa) zamiast na backend');
        }
        return true;
    }

    function setupDeleteModal() {
        const modalBg = document.getElementById('sa-delete-modal-bg');
        if (!modalBg) return { open() {}, close() {} };
        const $ = id => document.getElementById(id);
        let rows = [];

        function dLog(msg) {
            const el = $('sad-log');
            const t = new Date().toLocaleTimeString('pl-PL');
            el.textContent += `[${t}] ${msg}\n`;
            el.scrollTop = el.scrollHeight;
            console.log('[DeleteDialog]', msg);
        }

        function open(formDoc, shopId) {
            rows = getCheckedRows(formDoc);
            modalBg.classList.add('sa-visible');
            $('sad-exec-section').style.display = 'none';
            $('sad-log').style.display = 'none';
            $('sad-log').textContent = '';
            $('sad-bar').style.width = '0%'; $('sad-bar').textContent = '0%'; $('sad-bar').classList.remove('done');
            $('sad-confirm').disabled = (rows.length === 0);
            $('sad-confirm').textContent = 'Usuń zaznaczone';
            $('sad-cancel').textContent = 'Anuluj';
            const list = $('sad-list');
            list.innerHTML = '';
            rows.forEach(r => {
                const div = document.createElement('div');
                div.className = 'sad-row-del';
                const kind = r.parent ? 'subregion' : 'kraj (wyczyszczenie przypisań)';
                div.textContent = `[${(r.country || '').toUpperCase()}] ${r.name || ''} — ${kind} (idr ${r.idr})`;
                list.appendChild(div);
            });
            $('sad-header-sub').textContent = `${rows.length} pozycji do usunięcia w sklepie ${shopId}`;
            $('sad-summary').textContent = `${rows.length} pozycji`;
        }
        function close() { modalBg.classList.remove('sa-visible'); }

        $('sad-cancel').onclick = close;
        $('sad-confirm').onclick = async () => {
            if (!rows.length) return;
            $('sad-confirm').disabled = true;
            $('sad-confirm').textContent = 'Usuwam...';
            $('sad-cancel').textContent = 'Zamknij';
            $('sad-exec-section').style.display = 'block';
            $('sad-log').style.display = 'block';
            const total = rows.length;
            let ok = 0, fail = 0;
            for (let i = 0; i < total; i++) {
                const r = rows[i];
                const lab = `[${(r.country || '').toUpperCase()}] ${r.name || r.idr}`;
                try {
                    if (!r.clearHref) throw new Error('brak linku usuwania w wierszu');
                    await clearAssignment(r.clearHref);
                    dLog(`${lab} OK`);
                    ok++;
                } catch (e) {
                    dLog(`${lab} BŁĄD: ${e.message}`);
                    fail++;
                }
                const pct = Math.round((i + 1) / total * 100);
                $('sad-bar').style.width = pct + '%'; $('sad-bar').textContent = pct + '%';
            }
            $('sad-bar').classList.add('done');
            dLog(`KONIEC. Usunięto: ${ok}, błędów: ${fail}.`);
            $('sad-exec-summary').textContent = `Usunięto ${ok} / ${total}` + (fail ? `, błędów: ${fail}` : '');
            $('sad-summary').textContent = `Usunięto ${ok} / ${total}` + (fail ? `, błędów: ${fail}` : '');
            $('sad-confirm').textContent = 'Wykonano';
            // Odswiez liste (reload iframe panelu)
            const ifr = document.querySelector('iframe#oldPanelPage');
            if (ifr) { try { ifr.contentWindow.location.reload(); } catch (e) { ifr.src = ifr.src; } }
        };

        return { open, close };
    }

    // -----------------------------------------------------------------------
    // Inicjalizacja / odporne wstrzykiwanie (naprawia podwojne odswiezanie)
    // -----------------------------------------------------------------------
    let currentCtx = null;     // { formDoc, shopId, exportDialog, importDialog, deleteDialog }
    let dialogs = null;        // SINGLETONY dialogow (tworzone raz) - open() odswieza formDoc/shopId na zywo

    function ensureSetup() {
        if (!isListPage()) {
            const bar = document.getElementById('sa-bulk-bar');
            if (bar) bar.classList.remove('sa-visible');
            return;
        }
        const formDoc = getFormDoc();
        if (!formDoc || !formDoc.querySelector('table tr[id^="tr_row_"]')) return;
        const shopId = getCurrentShopId();

        // Dialogi tworzymy DOKLADNIE RAZ (singletony). Dzieki temu link breadcrumb i przyciski
        // zawsze wskazuja te sama instancje - brak rozjazdu A/B przy re-renderze/reloadzie iframe.
        // Aktualny formDoc/shopId dialogi odczytuja na zywo w open() (getFormDoc/getCurrentShopId).
        if (!dialogs) {
            const exportDialog = setupExportDialog(formDoc, shopId, (data) => {
                log(`Eksport OK. ${data._count} kraj(ów), ${data._subregion_count} subregion(ów).`);
            });
            const importDialog = setupImportDialog(shopId);
            const deleteDialog = setupDeleteModal();
            dialogs = { exportDialog, importDialog, deleteDialog };
            log(`Lista zaladowana. Sklep ${shopId}.`);
        }
        currentCtx = { formDoc, shopId, exportDialog: dialogs.exportDialog, importDialog: dialogs.importDialog, deleteDialog: dialogs.deleteDialog };

        initBulkBar();
        // Idempotentne wstrzykniecia - re-injectuja sie po re-renderze iframe
        injectBreadcrumbLinks(formDoc, currentCtx.exportDialog, currentCtx.importDialog);
        injectCheckboxColumn(formDoc);
        attachObserver(formDoc);
    }

    // MutationObserver na dokumencie iframe - natychmiast re-injectuje po re-renderze
    function attachObserver(formDoc) {
        try {
            if (!formDoc || !formDoc.body || formDoc.__saObserved) return;
            formDoc.__saObserved = true;
            let t = null;
            const obs = new MutationObserver(() => {
                clearTimeout(t);
                t = setTimeout(() => ensureSetup(), 200);
            });
            obs.observe(formDoc.body, { childList: true, subtree: true });
        } catch (e) {}
    }

    // -----------------------------------------------------------------------
    // START
    // -----------------------------------------------------------------------
    console.log('[ShippingAssign] v1.7 - URL:', window.location.href);
    createUI();

    // SPA url tracking - po nawigacji sprobuj ponownie (ensureSetup jest idempotentne)
    window.addEventListener('popstate', () => setTimeout(ensureSetup, 300));
    const op = history.pushState;
    history.pushState = function () { op.apply(this, arguments); setTimeout(ensureSetup, 300); };
    const or = history.replaceState;
    history.replaceState = function () { or.apply(this, arguments); setTimeout(ensureSetup, 300); };

    // Heartbeat - odporny na asynchroniczne ladowanie iframe oraz re-render (bez podwojnego odswiezania)
    setInterval(ensureSetup, 1500);
    ensureSetup();
})();
