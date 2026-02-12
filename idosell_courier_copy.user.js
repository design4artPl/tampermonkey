// ==UserScript==
// @name         IdoSell - Kopiowanie ustawień kurierów
// @namespace    idosell-courier-copy
// @version      3.6
// @description  Eksport i import konfiguracji kurierów między panelami IdoSell
// @match        *://*.iai-shop.com/panel/config-shippingdelivery.php*
// @match        *://*.iai-shop.com/panel/app/config-shippingdelivery.php*
// @author       Maciej Dobroń <maciej.dobron@gmail.com>
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/design4artPl/tampermonkey/main/idosell_courier_copy.user.js
// @updateURL    https://raw.githubusercontent.com/design4artPl/tampermonkey/main/idosell_courier_copy.user.js
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Wykryj kontekst: outer page (nowy panel z iframe) vs. bezpośredni formularz
    // -----------------------------------------------------------------------
    const isInIframe = (window.self !== window.top);

    // Jeśli jesteśmy WEWNĄTRZ iframe - nie rób nic, skrypt obsłuży to z outer page
    if (isInIframe) {
        console.log('[CourierCopy] Wewnątrz iframe - pomijam (obsługa z outer page).');
        return;
    }

    // Parametry z URL
    const urlParams = new URLSearchParams(window.location.search);
    const courierId = urlParams.get('id') || '?';
    const profileId = urlParams.get('profile') || '?';

    // -----------------------------------------------------------------------
    // Funkcja znajdująca formularz - szuka w iframe lub bezpośrednio na stronie
    // -----------------------------------------------------------------------
    function getFormDocument() {
        // Sprawdź czy jest iframe (nowy panel)
        const iframe = document.querySelector('iframe#oldPanelPage');
        if (iframe) {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                if (iframeDoc) {
                    const form = iframeDoc.querySelector('form[action*="shippingdelivery"]')
                              || iframeDoc.querySelector('form');
                    if (form) return { doc: iframeDoc, form: form, source: 'iframe' };
                }
            } catch (e) {
                console.log('[CourierCopy] Nie mogę dostać się do iframe:', e.message);
            }
        }

        // Bezpośrednio na stronie (stary panel lub bezpośredni URL)
        const form = document.querySelector('form[action*="shippingdelivery"]')
                  || document.querySelector('form');
        if (form) return { doc: document, form: form, source: 'direct' };

        return null;
    }

    // -----------------------------------------------------------------------
    // Czekaj aż formularz będzie dostępny (iframe może się ładować)
    // -----------------------------------------------------------------------
    function waitForForm(callback, maxAttempts = 30) {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const result = getFormDocument();
            if (result) {
                clearInterval(interval);
                console.log(`[CourierCopy] Formularz znaleziony (${result.source}) po ${attempts} próbach.`);
                callback(result);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.log('[CourierCopy] Nie znaleziono formularza po', maxAttempts, 'próbach.');
            }
        }, 1000);
    }

    // -----------------------------------------------------------------------
    // UI - Pływający panel (dodajemy do outer page - zawsze widoczny)
    // -----------------------------------------------------------------------
    function createUI() {
        // --- Okragla ikonka (FAB) ---
        const fab = document.createElement('div');
        fab.id = 'cc-fab';
        fab.title = 'Kopiowanie kurierow';
        fab.innerHTML = `
            <style>
                #cc-fab {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 1000000;
                    width: 48px;
                    height: 48px;
                    background: #1AAC7A;
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 3px 12px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: transform 0.2s, box-shadow 0.2s;
                    user-select: none;
                }
                #cc-fab:hover {
                    transform: scale(1.1);
                    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                }
                #cc-fab svg {
                    width: 24px;
                    height: 24px;
                    fill: white;
                }
            </style>
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
        `;
        document.body.appendChild(fab);

        // --- Panel glowny (domyslnie ukryty) ---
        const panel = document.createElement('div');
        panel.id = 'courier-copy-panel';
        panel.innerHTML = `
            <style>
                #courier-copy-panel {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    z-index: 999999;
                    background: #fff;
                    border: 2px solid #1AAC7A;
                    border-radius: 8px;
                    padding: 0;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                    font-family: 'Inter', Arial, sans-serif;
                    font-size: 13px;
                    min-width: 320px;
                    max-width: 400px;
                    display: none;
                }
                #courier-copy-panel.cc-visible {
                    display: block;
                }
                #courier-copy-panel .cc-header {
                    background: #1AAC7A;
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px 6px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: move;
                    user-select: none;
                }
                #courier-copy-panel .cc-header h3 {
                    margin: 0;
                    font-size: 13px;
                    font-weight: 600;
                }
                #courier-copy-panel .cc-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 0 4px;
                    line-height: 1;
                }
                #courier-copy-panel .cc-close:hover {
                    opacity: 0.7;
                }
                #courier-copy-panel .cc-body {
                    padding: 12px;
                }
                #courier-copy-panel button.cc-btn {
                    display: block;
                    width: 100%;
                    padding: 8px 12px;
                    margin: 4px 0;
                    border: 1px solid #ddd;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    transition: all 0.2s;
                    text-align: left;
                }
                #courier-copy-panel button.cc-btn:hover {
                    filter: brightness(0.95);
                }
                #courier-copy-panel .cc-btn-export {
                    background: #E8F5E9;
                    border-color: #1AAC7A;
                    color: #1B5E20;
                }
                #courier-copy-panel .cc-btn-import {
                    background: #E3F2FD;
                    border-color: #2196F3;
                    color: #0D47A1;
                }
                #courier-copy-panel .cc-status {
                    margin-top: 8px;
                    padding: 6px 8px;
                    background: #f5f5f5;
                    border-radius: 4px;
                    font-size: 11px;
                    color: #555;
                    max-height: 150px;
                    overflow-y: auto;
                    white-space: pre-wrap;
                    word-break: break-all;
                }
                #courier-copy-panel .cc-info {
                    font-size: 11px;
                    color: #888;
                    margin: 6px 0 2px 0;
                }
                #courier-copy-panel input[type="file"] {
                    display: none;
                }
                #courier-copy-panel .cc-separator {
                    border-top: 1px solid #eee;
                    margin: 8px 0;
                }
                #courier-copy-panel .cc-waiting {
                    text-align: center;
                    padding: 15px;
                    color: #888;
                }
                #courier-copy-panel .cc-waiting .spinner {
                    display: inline-block;
                    width: 16px;
                    height: 16px;
                    border: 2px solid #ddd;
                    border-top-color: #1AAC7A;
                    border-radius: 50%;
                    animation: cc-spin 0.8s linear infinite;
                    vertical-align: middle;
                    margin-right: 6px;
                }
                @keyframes cc-spin { to { transform: rotate(360deg); } }
            </style>

            <div class="cc-header" id="cc-drag-handle">
                <h3>Kopiowanie kurierow v3.6</h3>
                <button class="cc-close" id="cc-close-btn" title="Zamknij">&#10005;</button>
            </div>
            <div class="cc-body" id="cc-body">
                <div class="cc-waiting" id="cc-waiting">
                    <span class="spinner"></span> Czekam na zaladowanie formularza...
                </div>
                <div id="cc-controls" style="display:none;">
                    <div class="cc-info" id="cc-info">
                        ID kuriera: <strong>${courierId}</strong> |
                        Profil: <strong>${profileId}</strong>
                    </div>

                    <div class="cc-separator"></div>

                    <button class="cc-btn cc-btn-export" id="cc-btn-export">
                        Eksportuj konfiguracje do pliku JSON
                    </button>

                    <button class="cc-btn cc-btn-export" id="cc-btn-clipboard"
                        style="background:#F3E5F5; border-color:#9C27B0; color:#4A148C;">
                        Kopiuj konfiguracje do schowka
                    </button>

                    <div class="cc-separator"></div>

                    <button class="cc-btn cc-btn-import" id="cc-btn-import-file">
                        Importuj konfiguracje z pliku JSON
                    </button>
                    <input type="file" id="cc-file-input" accept=".json">

                    <button class="cc-btn cc-btn-import" id="cc-btn-import-clipboard"
                        style="background:#FCE4EC; border-color:#E91E63; color:#880E4F;">
                        Importuj ze schowka
                    </button>

                    <div class="cc-separator"></div>

                    <label style="display:block; font-size:11px; margin:4px 0; cursor:pointer;">
                        <input type="checkbox" id="cc-step-mode"> Tryb krokowy (potwierdzaj kazde pole)
                    </label>
                    <button class="cc-btn" id="cc-btn-step"
                        style="display:none; background:#FFF3E0; border-color:#FF9800; color:#E65100; font-weight:bold; text-align:center;">
                        Dalej >
                    </button>

                    <div class="cc-separator"></div>

                    <div class="cc-status" id="cc-status">Gotowy. Wybierz akcje powyzej.</div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // --- FAB: klik otwiera/zamyka panel ---
        fab.addEventListener('click', () => {
            const isVisible = panel.classList.contains('cc-visible');
            panel.classList.toggle('cc-visible');
            fab.style.display = isVisible ? 'flex' : 'none';
        });

        // --- Zamknij panel (X) -> pokaz FAB ---
        document.getElementById('cc-close-btn').addEventListener('click', () => {
            panel.classList.remove('cc-visible');
            fab.style.display = 'flex';
        });

        // Drag & drop
        const dragHandle = document.getElementById('cc-drag-handle');
        let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;

        dragHandle.addEventListener('mousedown', (e) => {
            if (e.target.id === 'cc-close-btn') return;
            isDragging = true;
            dragOffsetX = e.clientX - panel.getBoundingClientRect().left;
            dragOffsetY = e.clientY - panel.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - dragOffsetX) + 'px';
            panel.style.top = (e.clientY - dragOffsetY) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        return panel;
    }

    // -----------------------------------------------------------------------
    // Logowanie
    // -----------------------------------------------------------------------
    function log(msg) {
        const statusEl = document.getElementById('cc-status');
        if (!statusEl) return;
        const time = new Date().toLocaleTimeString('pl-PL');
        statusEl.textContent += `\n[${time}] ${msg}`;
        statusEl.scrollTop = statusEl.scrollHeight;
        console.log('[CourierCopy]', msg);
    }

    // -----------------------------------------------------------------------
    // EKSPORT - wyciagnij dane z formularza (plaski obiekt)
    // -----------------------------------------------------------------------
    function extractFormDataFlat(form) {
        const data = {};

        form.querySelectorAll('input[type="text"], input[type="hidden"], input[type="number"]').forEach(el => {
            if (el.name) data[el.name] = el.value;
        });

        const radioGroups = {};
        form.querySelectorAll('input[type="radio"]').forEach(el => {
            if (!el.name) return;
            if (!radioGroups[el.name]) radioGroups[el.name] = null;
            if (el.checked) radioGroups[el.name] = el.value;
        });
        for (const [name, value] of Object.entries(radioGroups)) {
            if (value !== null) data[name] = value;
        }

        const checkboxGroups = {};
        form.querySelectorAll('input[type="checkbox"]').forEach(el => {
            if (!el.name) return;
            if (!checkboxGroups[el.name]) checkboxGroups[el.name] = { all: [], checked: [] };
            checkboxGroups[el.name].all.push(el.value);
            if (el.checked) checkboxGroups[el.name].checked.push(el.value);
        });
        for (const [name, group] of Object.entries(checkboxGroups)) {
            data[name] = group.checked;
        }

        form.querySelectorAll('select').forEach(el => {
            if (el.name) data[el.name] = el.value;
        });

        form.querySelectorAll('textarea').forEach(el => {
            if (el.name) data[el.name] = el.value;
        });

        return data;
    }

    // -----------------------------------------------------------------------
    // EKSPORT - strukturalny JSON z sekcjami
    // -----------------------------------------------------------------------
    function extractFormDataStructured(form) {
        const flat = extractFormDataFlat(form);

        // Etykiety pol (nazwy z panelu IdoSell)
        const fieldLabels = {
            'time': 'Przecietny czas dostawy',
            'time_type': 'Jednostka czasu dostawy (day/hour/minute)',
            'currency': 'Ceny za przesylke definiowane w',
            'calendar': 'Klient moze wskazywac preferowany dzien dostawy',
            'max_items_per_package_radio': 'Dziel zamowienie na paczki',
            'max_items_per_package': 'Maksymalna liczba sztuk w paczce',
            'max_weight_per_package': 'Maksymalna waga paczki (g)',
            'dispatch_days[]': 'Dostawy realizowane sa w dni (1=Pon,2=Wt,4=Sr,8=Czw,16=Pt,32=Sob,64=Ndz)',
            'service_additionally_charged[3][1]': 'Doplata za towar ponadgabarytowy (waluta)',
            'service_additionally_charged[3][2]': 'Doplata za towar ponadgabarytowy (punkty)',
            'vat': 'Stawka VAT dla kosztu przesylki (klient)',
            'shop_vat': 'Stawka VAT dla kosztu ponoszonego przez sklep',
            'taxcode': 'PKWiU dla kosztu przesylki',
            'costs_defined_as': 'Kwoty podane w (net/gross)',
            'mode': 'Tryb konfiguracji (s=prosty, a=waga, c=kwota, dim_weight=waga gabarytowa)',
            'dvp': 'Dopuszczac za pobraniem (y/n)',
            'dvp_all_currencies': 'Aktywna dla wszystkich walut (y/n)',
            'active_currencies[]': 'Widoczna tylko dla zamowien w walucie',
            'dvp_minworth': 'Minimalna wartosc zamowienia (pobranie)',
            'dvp_maxworth': 'Maksymalna wartosc zamowienia (pobranie)',
            'dvp_if_limitfree': 'Promocja darmowej przesylki od wartosci (pobranie)',
            'dvp_allegro_surcharge': 'Doplata za kolejna sztuke Allegro (pobranie)',
            'dvp_ebay_surcharge_enabled': 'Doplata za kolejna sztuke eBay (pobranie)',
            'dvp_ebay_surcharge': 'Wysokosc doplaty eBay (pobranie)',
            'prepaid': 'Dopuszczac przedplate (y/n)',
            'prepaid_minworth': 'Minimalna wartosc zamowienia (przedplata)',
            'prepaid_maxworth': 'Maksymalna wartosc zamowienia (przedplata)',
            'prepaid_if_limitfree': 'Promocja darmowej przesylki od wartosci (przedplata)',
            'prepaid_allegro_surcharge': 'Doplata za kolejna sztuke Allegro (przedplata)',
            'prepaid_ebay_surcharge_enabled': 'Doplata za kolejna sztuke eBay (przedplata)',
            'prepaid_ebay_surcharge': 'Wysokosc doplaty eBay (przedplata)',
            // Pola wagowe (w przedzialach)
            'weight_min': 'Waga minimalna',
            'weight_max': 'Waga maksymalna',
            'dvp_cost': 'Koszt przesylki klient (pobranie) [zl]',
            'dvp_percent': 'Koszt przesylki klient (pobranie) [% wartosci zamowienia]',
            'dvp_points': 'Koszt w punktach (pobranie)',
            'dvp_customer_min_cost': 'Wartosc minimalna kosztu klienta (pobranie)',
            'dvp_limitfree': 'Darmowa dostawa od (pobranie)',
            'dvp_shop_cost': 'Koszt dostawy sklep (pobranie) [zl]',
            'dvp_shop_cost_percent': 'Koszt dostawy sklep (pobranie) [% wartosci zamowienia]',
            'dvp_shop_min_cost': 'Koszt sklepu nie mniejszy niz (pobranie)',
            'prepaid_cost': 'Koszt przesylki klient (przedplata) [zl]',
            'prepaid_percent': 'Koszt przesylki klient (przedplata) [% wartosci zamowienia]',
            'prepaid_points': 'Koszt w punktach (przedplata)',
            'prepaid_customer_min_cost': 'Wartosc minimalna kosztu klienta (przedplata)',
            'prepaid_limitfree': 'Darmowa dostawa od (przedplata)',
            'prepaid_shop_cost': 'Koszt dostawy sklep (przedplata) [zl]',
            'prepaid_shop_cost_percent': 'Koszt dostawy sklep (przedplata) [% wartosci zamowienia]',
            'prepaid_shop_min_cost': 'Koszt sklepu nie mniejszy niz (przedplata)',
        };

        // Mapowanie pol do sekcji
        const sections = {
            "ustawienia_ogolne": {
                "_label": "Ustawienia ogolne",
                "_fields": [
                    'time', 'time_type', 'currency', 'calendar',
                    'max_items_per_package_radio', 'max_items_per_package',
                    'max_weight_per_package'
                ]
            },
            "realizacja_dostaw": {
                "_label": "Ustawienia realizowania dostaw przesylek do klientow",
                "_fields": ['dispatch_days[]']
            },
            "uslugi_dodatkowo_platne": {
                "_label": "Uslugi dodatkowo platne",
                "_fields": ['service_additionally_charged[3][1]', 'service_additionally_charged[3][2]']
            },
            "konfiguracja_kosztow": {
                "_label": "Konfiguracja kosztu przesylki ponoszonego przez klienta",
                "_fields": ['vat', 'shop_vat', 'taxcode', 'costs_defined_as', 'mode']
            },
            "koszty_za_pobraniem": {
                "_label": "Koszty dostawy za pobraniem",
                "_fields": [
                    'dvp', 'dvp_all_currencies', 'active_currencies[]',
                    'dvp_minworth', 'dvp_maxworth', 'dvp_if_limitfree',
                    'dvp_allegro_surcharge', 'dvp_ebay_surcharge_enabled', 'dvp_ebay_surcharge'
                ]
            },
            "koszty_za_przedplata": {
                "_label": "Koszty dostawy za przedplata",
                "_fields": [
                    'prepaid', 'prepaid_minworth', 'prepaid_maxworth', 'prepaid_if_limitfree',
                    'prepaid_allegro_surcharge', 'prepaid_ebay_surcharge_enabled', 'prepaid_ebay_surcharge'
                ]
            }
        };

        // Zbierz ID-ki z tabeli wagowej
        const weightRowIds = [];
        for (const key of Object.keys(flat)) {
            const m = key.match(/^weight_min\[(\d+)\]$/);
            if (m) weightRowIds.push(m[1]);
        }
        weightRowIds.sort((a, b) => parseFloat(flat[`weight_min[${a}]`] || 0) - parseFloat(flat[`weight_min[${b}]`] || 0));

        // Buduj strukturalny JSON
        const result = {
            _format: "idosell-courier-config-v2",
            _exported: new Date().toISOString(),
            _source: {
                id: flat['id'] || '?',
                profile: flat['profile'] || '?'
            }
        };

        // Sekcje gornej konfiguracji
        const assignedFields = new Set(['__iai_shop_panel[__encoding]', 'id', 'profile', 'action', 'default']);

        for (const [sectionKey, section] of Object.entries(sections)) {
            const sectionData = { "_sekcja": section._label };
            for (const fieldName of section._fields) {
                if (flat[fieldName] !== undefined) {
                    if (fieldLabels[fieldName]) sectionData[`// ${fieldName}`] = fieldLabels[fieldName];
                    sectionData[fieldName] = flat[fieldName];
                    assignedFields.add(fieldName);
                }
            }
            result[sectionKey] = sectionData;
        }

        // Sekcja przedzialow wagowych
        const weightFieldPrefixes = [
            'weight_min', 'weight_max',
            'dvp_cost', 'dvp_percent', 'dvp_points', 'dvp_customer_min_cost', 'dvp_limitfree',
            'dvp_shop_cost', 'dvp_shop_cost_percent', 'dvp_shop_min_cost',
            'prepaid_cost', 'prepaid_percent', 'prepaid_points', 'prepaid_customer_min_cost', 'prepaid_limitfree',
            'prepaid_shop_cost', 'prepaid_shop_cost_percent', 'prepaid_shop_min_cost',
        ];

        const weightRows = [];
        for (const rowId of weightRowIds) {
            const row = { _row_id: rowId };
            for (const prefix of weightFieldPrefixes) {
                const key = `${prefix}[${rowId}]`;
                if (flat[key] !== undefined) {
                    if (fieldLabels[prefix]) row[`// ${prefix}`] = fieldLabels[prefix];
                    row[prefix] = flat[key];
                    assignedFields.add(key);
                }
            }
            // hide_id
            assignedFields.add(`hide_id[${rowId}]`);
            weightRows.push(row);
        }
        result["przedzialy_wagowe"] = weightRows;

        // Ewentualne nieprzypisane pola (na wszelki wypadek)
        const unassigned = {};
        for (const [key, val] of Object.entries(flat)) {
            if (!assignedFields.has(key) && !key.startsWith('hide_id')) {
                // Sprawdz czy to pole wagowe
                const isWeight = weightFieldPrefixes.some(p => key.startsWith(`${p}[`));
                if (!isWeight) unassigned[key] = val;
            }
        }
        if (Object.keys(unassigned).length > 0) {
            result["_inne_pola"] = unassigned;
        }

        // Debug
        console.log('[CourierCopy] Eksport: sekcje =',
            Object.keys(result).filter(k => !k.startsWith('_')).join(', '));

        return result;
    }

    // -----------------------------------------------------------------------
    // IMPORT HELPER - splaszcz strukturalny JSON do plaskiego formatu
    // -----------------------------------------------------------------------
    function flattenConfig(config) {
        // Juz plaski format (stary lub all_fields_raw)?
        if (config.all_fields_raw) return config.all_fields_raw;
        if (config.time || config['weight_min[1]'] || config.dvp) return config;

        // Nowy format strukturalny (v2)?
        if (config._format === 'idosell-courier-config-v2' || config.ustawienia_ogolne) {
            const flat = {};
            const sectionKeys = [
                'ustawienia_ogolne', 'realizacja_dostaw', 'uslugi_dodatkowo_platne',
                'konfiguracja_kosztow', 'koszty_za_pobraniem', 'koszty_za_przedplata',
                '_inne_pola'
            ];

            // Splaszcz sekcje gornej konfiguracji
            for (const sectionKey of sectionKeys) {
                const section = config[sectionKey];
                if (section && typeof section === 'object' && !Array.isArray(section)) {
                    for (const [key, val] of Object.entries(section)) {
                        if (!key.startsWith('_')) flat[key] = val;
                    }
                }
            }

            // Splaszcz przedzialy wagowe
            const weightFieldPrefixes = [
                'weight_min', 'weight_max',
                'dvp_cost', 'dvp_percent', 'dvp_points', 'dvp_customer_min_cost', 'dvp_limitfree',
                'dvp_shop_cost', 'dvp_shop_cost_percent', 'dvp_shop_min_cost',
                'prepaid_cost', 'prepaid_percent', 'prepaid_points', 'prepaid_customer_min_cost', 'prepaid_limitfree',
                'prepaid_shop_cost', 'prepaid_shop_cost_percent', 'prepaid_shop_min_cost',
            ];

            if (Array.isArray(config.przedzialy_wagowe)) {
                for (const row of config.przedzialy_wagowe) {
                    const rowId = row._row_id;
                    if (!rowId) continue;
                    for (const prefix of weightFieldPrefixes) {
                        if (row[prefix] !== undefined) {
                            flat[`${prefix}[${rowId}]`] = row[prefix];
                        }
                    }
                }
            }

            return flat;
        }

        // Nieznany format - zwroc jak jest
        return config;
    }

    // -----------------------------------------------------------------------
    // Helper: czekaj ms
    // -----------------------------------------------------------------------
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // -----------------------------------------------------------------------
    // Helper: pobierz row IDs z ich wartosciami weight_min
    // Zwraca [{id, weightMin}] posortowane po weightMin
    // -----------------------------------------------------------------------
    function getDestRows(doc) {
        const rows = [];
        doc.querySelectorAll('input[name^="weight_min["]').forEach(el => {
            const m = el.name.match(/weight_min\[(\d+)\]/);
            if (m) rows.push({ id: m[1], weightMin: el.value.trim() });
        });
        return rows;
    }

    // Kompatybilnosc - zwraca same ID (uzywane w findAddRowButton itp.)
    function getDestRowIds(doc) {
        return getDestRows(doc).map(r => r.id);
    }

    // -----------------------------------------------------------------------
    // Helper: znajdz przycisk "Dodaj przedzial"
    // -----------------------------------------------------------------------
    function findAddRowButton(formDoc) {
        return formDoc.querySelector('a[href*="addWeightRow"], a.add_weight_row, [onclick*="addRow"]')
            || Array.from(formDoc.querySelectorAll('a, span, button')).find(el =>
                el.textContent.includes('Dodaj przedzia') || el.textContent.includes('dodaj przedzia')
            );
    }

    // -----------------------------------------------------------------------
    // IMPORT - wypelnij formularz danymi z JSON (ASYNC)
    // -----------------------------------------------------------------------
    async function applyConfigToForm(form, formDoc, config) {
        _formRef = form; // ustawienie referencji formularza dla getByName

        const skipFields = new Set([
            '__iai_shop_panel[__encoding]', 'id', 'profile', 'action', 'default'
        ]);
        const skipPrefixes = ['hide_id'];

        // Zbierz source row IDs
        const sourceRowIds = [];
        for (const key of Object.keys(config)) {
            const match = key.match(/^weight_min\[(\d+)\]$/);
            if (match) sourceRowIds.push(match[1]);
        }
        sourceRowIds.sort((a, b) =>
            parseFloat(config[`weight_min[${a}]`] || 0) - parseFloat(config[`weight_min[${b}]`] || 0)
        );

        // --- KROK 1: Wypelnij pola NIE-wagowe w PRAWIDLOWEJ KOLEJNOSCI ---
        log('Krok 1: Wypelniam ustawienia ogolne...');

        const weightFieldPrefixes = [
            'weight_min', 'weight_max',
            'dvp_cost', 'dvp_percent', 'dvp_points', 'dvp_customer_min_cost', 'dvp_limitfree',
            'dvp_shop_cost', 'dvp_shop_cost_percent', 'dvp_shop_min_cost',
            'prepaid_cost', 'prepaid_percent', 'prepaid_points', 'prepaid_customer_min_cost', 'prepaid_limitfree',
            'prepaid_shop_cost', 'prepaid_shop_cost_percent', 'prepaid_shop_min_cost',
        ];

        function isWeightKey(key) {
            return weightFieldPrefixes.some(p => key.startsWith(`${p}[`));
        }

        // Radio buttony sterujace widocznoscia pol zaleznych
        const parentFields = new Set([
            'costs_defined_as', 'mode', 'time_type', 'calendar',
            'max_items_per_package_radio', 'dvp', 'prepaid',
        ]);

        // Kolejnosc pol od gory do dolu formularza (dokladnie jak w panelu)
        const FORM_FIELD_ORDER = [
            // --- Ustawienia ogolne ---
            'time',
            'time_type',
            'currency',
            'calendar',
            'max_items_per_package_radio',
            'max_items_per_package',
            'max_weight_per_package',
            // --- Realizacja dostaw ---
            'dispatch_days[]',
            // --- Uslugi dodatkowo platne ---
            'service_additionally_charged[3][1]',
            'service_additionally_charged[3][2]',
            // --- Konfiguracja kosztow ---
            'vat',
            'shop_vat',
            'taxcode',
            'costs_defined_as',
            'mode',
            // --- Koszty dostawy za pobraniem ---
            'dvp',
            'dvp_all_currencies',
            'active_currencies[]',
            'dvp_minworth',
            'dvp_maxworth',
            'dvp_if_limitfree',
            'dvp_allegro_surcharge',
            'dvp_ebay_surcharge_enabled',
            'dvp_ebay_surcharge',
            // --- Koszty dostawy za przedplata ---
            'prepaid',
            'prepaid_minworth',
            'prepaid_maxworth',
            'prepaid_if_limitfree',
            'prepaid_allegro_surcharge',
            'prepaid_ebay_surcharge_enabled',
            'prepaid_ebay_surcharge',
        ];

        let filled = 0, skipped = 0;

        // Diagnostyka: sprawdz kontekst iframe
        const iframeWin = formDoc.defaultView || formDoc.parentWindow;
        const hasJQ = iframeWin && (iframeWin.jQuery || iframeWin.$);
        const hasIAI = iframeWin && iframeWin.IAI && iframeWin.IAI.shippingDeliveries;
        log(`Kontekst iframe: jQuery=${hasJQ ? 'TAK' : 'NIE'}, IAI.shippingDeliveries=${hasIAI ? 'TAK' : 'NIE'}`);

        // Wypelniaj pola sekwencyjnie od gory do dolu
        log('Krok 1: Wypelniam ustawienia ogolne (od gory do dolu)...');
        const processed = new Set();

        for (const name of FORM_FIELD_ORDER) {
            if (config[name] === undefined) continue;

            log(`  -> ${name} = ${JSON.stringify(config[name])}`);
            const r = fillField(formDoc, name, config[name]);
            filled += r;
            processed.add(name);

            // Po polach nadrzednych (radio) daj czas na reakcje JS panelu
            if (parentFields.has(name) && r > 0) {
                await sleep(400);
            }

            // Tryb krokowy - czekaj na potwierdzenie
            await waitForStep();
        }

        // Pozostale pola nie-wagowe (dynamiczne, np. service_additionally_charged)
        for (const [name, value] of Object.entries(config)) {
            if (processed.has(name)) continue;
            if (skipFields.has(name)) continue;
            if (skipPrefixes.some(p => name.startsWith(p))) continue;
            if (isWeightKey(name)) continue;

            log(`  -> ${name} = ${JSON.stringify(value)}`);
            filled += fillField(formDoc, name, value);
            await waitForStep();
        }
        log(`Ustawienia ogolne: wypelniono ${filled} pol.`);

        // --- KROK 2: Przedzialy wagowe (matchowanie po weight_min) ---
        let destRows = getDestRows(formDoc);
        log(`Krok 2: Tabela wagowa - zrodlo: ${sourceRowIds.length}, cel: ${destRows.length} wierszy`);

        if (sourceRowIds.length === 0) {
            log(`IMPORT ZAKONCZONY! Lacznie: ${filled} pol.`);
            log('Sprawdz dane i kliknij "Zmien" aby zapisac.');
            return { filled, skipped };
        }

        const addBtn = findAddRowButton(formDoc);
        let weightFilled = 0;

        // Wypelnij jeden wiersz wagowy (src -> dest)
        function fillWeightRow(srcRowId, destRowId) {
            let count = 0;
            for (const prefix of weightFieldPrefixes) {
                const srcKey = `${prefix}[${srcRowId}]`;
                if (config[srcKey] !== undefined) {
                    const destName = `${prefix}[${destRowId}]`;
                    count += fillField(formDoc, destName, config[srcKey]);
                }
            }
            return count;
        }

        // Buduj mape istniejacych wierszy wg weight_min
        const destByWeightMin = {};
        for (const row of destRows) {
            destByWeightMin[row.weightMin] = row.id;
        }

        for (let i = 0; i < sourceRowIds.length; i++) {
            const srcId = sourceRowIds[i];
            const srcMin = config[`weight_min[${srcId}]`] || '?';
            const srcMax = config[`weight_max[${srcId}]`] || '?';

            // Szukaj istniejacego wiersza o tym samym weight_min
            const existingId = destByWeightMin[srcMin];

            if (existingId) {
                // Wiersz z takim weight_min juz istnieje -> aktualizuj
                log(`  Wiersz ${i + 1}/${sourceRowIds.length} [${srcMin}-${srcMax} kg] -> AKTUALIZACJA row ${existingId}`);
                weightFilled += fillWeightRow(srcId, existingId);
                await waitForStep();
            } else {
                // Brak takiego przedzialu -> dodaj nowy
                if (!addBtn) {
                    log(`  [!] Brak przycisku "Dodaj przedzial" - nie moge dodac wiersza ${i + 1}`);
                    break;
                }
                addBtn.click();
                await sleep(600);

                // Pobierz nowe row IDs - ostatni dodany to nowy wiersz
                const newRows = getDestRows(formDoc);
                const newRow = newRows[newRows.length - 1];
                if (!newRow) {
                    log(`  [!] Nie wykryto nowego wiersza po kliknieciu "Dodaj"`);
                    break;
                }

                log(`  Wiersz ${i + 1}/${sourceRowIds.length} [${srcMin}-${srcMax} kg] -> NOWY row ${newRow.id}`);
                weightFilled += fillWeightRow(srcId, newRow.id);
                await waitForStep();

                // Dodaj nowy wiersz do mapy (po wypelnieniu ma juz srcMin)
                destByWeightMin[srcMin] = newRow.id;
            }
        }

        filled += weightFilled;
        log(`Tabela wagowa: wypelniono ${weightFilled} pol.`);
        log(`IMPORT ZAKONCZONY! Lacznie: ${filled} pol.`);
        log('Sprawdz dane i kliknij "Zmien" aby zapisac.');

        // Usun podswietlenie i schowaj przycisk "Dalej"
        highlightField(null);
        const stepBtn = document.getElementById('cc-btn-step');
        if (stepBtn) stepBtn.style.display = 'none';

        return { filled, skipped };
    }

    // -----------------------------------------------------------------------
    // Helper: wykonaj onclick handler elementu w kontekscie iframe
    // IdoSell uzywa inline onclick np. IAI.shippingDeliveries.change_dvp_percent()
    // Te funkcje istnieja w window iframe - trzeba je wywolac w tym kontekscie
    // -----------------------------------------------------------------------
    function executeOnclick(doc, el) {
        try {
            const iframeWin = doc.defaultView || doc.parentWindow;
            if (!iframeWin) return;

            // 1. Sprobuj wywolac onclick jako funkcje
            if (typeof el.onclick === 'function') {
                el.onclick.call(el);
                return;
            }

            // 2. Odczytaj atrybut onclick i wykonaj w kontekscie iframe
            const onclickAttr = el.getAttribute('onclick');
            if (onclickAttr) {
                iframeWin.eval(onclickAttr);
                return;
            }
        } catch (e) {
            console.log('[CourierCopy] executeOnclick error:', e.message);
        }
    }

    // -----------------------------------------------------------------------
    // Helper: wyslij eventy na elemencie (natywne + jQuery jesli dostepne)
    // -----------------------------------------------------------------------
    function triggerEvents(doc, el, eventNames) {
        const iframeWin = doc.defaultView || doc.parentWindow;
        const $ = iframeWin && (iframeWin.jQuery || iframeWin.$);
        for (const evName of eventNames) {
            if ($) {
                try { $(el).trigger(evName); } catch (e) { /* ignore */ }
            }
            el.dispatchEvent(new Event(evName, { bubbles: true }));
        }
    }

    // -----------------------------------------------------------------------
    // Debug: podswietl element na czerwono (jego TD lub rodzic)
    // -----------------------------------------------------------------------
    let lastHighlighted = null;
    function highlightField(el) {
        // Usun poprzednie podswietlenie
        if (lastHighlighted) {
            lastHighlighted.style.backgroundColor = lastHighlighted._origBg || '';
            lastHighlighted = null;
        }
        if (!el) return;
        // Szukaj najblizszego TD lub rodzica
        const cell = el.closest('td') || el.parentElement;
        if (cell) {
            cell._origBg = cell.style.backgroundColor;
            cell.style.backgroundColor = '#ff6b6b';
            lastHighlighted = cell;
        }
    }

    // -----------------------------------------------------------------------
    // Debug: czekaj na klik przycisku "Dalej" (tryb krokowy)
    // -----------------------------------------------------------------------
    let stepMode = false;
    let stepResolve = null;

    function waitForStep() {
        if (!stepMode) return Promise.resolve();
        return new Promise(resolve => {
            stepResolve = resolve;
            const btn = document.getElementById('cc-btn-step');
            if (btn) {
                btn.style.display = 'inline-block';
                btn.textContent = 'Dalej >';
            }
        });
    }

    // -----------------------------------------------------------------------
    // Helper: znajdz elementy formularza po nazwie
    // Uzywa querySelectorAll('input,select,textarea') + filtr .name w JS
    // (getElementsByName i CSS [name="..."] nie dzialaja dla nazw z [])
    // -----------------------------------------------------------------------
    let _formRef = null; // ustawiane w applyConfigToForm
    function getByName(doc, name, filter) {
        let all = [];

        // Szukaj w formularzu
        const form = _formRef || doc.querySelector('form[action*="shippingdelivery"]') || doc.querySelector('form');
        if (form) {
            form.querySelectorAll('input, select, textarea').forEach(el => {
                if (el.name === name) all.push(el);
            });
        }

        // Fallback - szukaj w calym dokumencie
        if (all.length === 0) {
            doc.querySelectorAll('input, select, textarea').forEach(el => {
                if (el.name === name) all.push(el);
            });
        }

        // Debug - loguj gdy nic nie znaleziono
        if (all.length === 0) {
            log(`    [getByName] "${name}" - nie znaleziono (form=${!!form})`);
        }

        if (!filter) return all;
        return all.filter(el => {
            if (filter.type && el.type !== filter.type) return false;
            if (filter.value !== undefined && el.value !== filter.value) return false;
            if (filter.tag && el.tagName.toLowerCase() !== filter.tag) return false;
            return true;
        });
    }

    // -----------------------------------------------------------------------
    // Helper: wypelnij pojedyncze pole formularza
    // Dla radio buttonow: ustawia checked + wywoluje inline onclick handler
    // -----------------------------------------------------------------------
    function fillField(doc, name, value) {
        try {
            // Tablica (checkboxy) - w tym pusta [] = odznacz wszystko
            if (Array.isArray(value)) {
                const allCb = getByName(doc, name, {type: 'checkbox'});
                log(`    [checkbox] ${name}: znaleziono ${allCb.length} checkboxow, wartosci do zaznaczenia: ${JSON.stringify(value)}`);
                if (allCb.length > 0) {
                    log(`    [checkbox] Dostepne wartosci w DOM: ${allCb.map(cb => cb.value).join(', ')}`);
                    highlightField(allCb[0]);
                }
                const toCheck = new Set(value);
                let count = 0;
                allCb.forEach(el => {
                    const shouldBeChecked = toCheck.has(el.value);
                    if (shouldBeChecked && !el.checked) {
                        el.click(); // kliknij zeby zaznaczyc
                        highlightField(el);
                        count++;
                        log(`    [checkbox] ${el.value} -> ZAZNACZONO (click)`);
                    } else if (!shouldBeChecked && el.checked) {
                        el.click(); // kliknij zeby odznaczyc
                        count++;
                        log(`    [checkbox] ${el.value} -> ODZNACZONO (click)`);
                    }
                });
                if (count === 0) log(`    [checkbox] ${name}: wszystko juz zgodne, brak zmian`);
                return count || (allCb.length > 0 ? 1 : 0);
            }

            // Checkboxy (pojedynczy, stary format)
            const checkboxes = getByName(doc, name, {type: 'checkbox'});
            if (checkboxes.length > 0) {
                highlightField(checkboxes[0]);
                const shouldBeChecked = !!value;
                checkboxes.forEach(el => {
                    if (shouldBeChecked && el.value === value && !el.checked) {
                        el.click();
                        highlightField(el);
                    } else if (!shouldBeChecked && el.checked) {
                        el.click();
                    }
                });
                return 1;
            }

            // Radio - KLUCZOWE: ustaw checked + wywolaj inline onclick handler
            const radios = getByName(doc, name, {type: 'radio'});
            if (radios.length > 0) {
                const radio = radios.find(r => r.value === value);
                if (!radio) {
                    log(`  [!] ${name}: brak opcji radio z value="${value}"`);
                    return 0;
                }
                highlightField(radio);
                if (radio.checked) {
                    log(`  [radio] ${name}=${value} - juz zaznaczony, pomijam`);
                    return 1;
                }
                radio.checked = true;
                log(`  [radio] ${name}=${value} - ustawiam checked=true`);

                executeOnclick(doc, radio);
                triggerEvents(doc, radio, ['click', 'change']);

                if (!radio.checked) {
                    log(`  [radio] UWAGA: ${name} - checked zresetowany po onclick!`);
                    radio.checked = true;
                }
                return 1;
            }

            // Select
            const selects = getByName(doc, name, {tag: 'select'});
            if (selects.length > 0) {
                highlightField(selects[0]);
                selects[0].value = value;
                triggerEvents(doc, selects[0], ['change']);
                return 1;
            }

            // Input (text, hidden, number)
            const inputs = getByName(doc, name);
            const input = inputs.find(el => el.tagName === 'INPUT' && el.type !== 'radio' && el.type !== 'checkbox');
            if (input) {
                highlightField(input);
                input.value = '';
                input.value = value;
                triggerEvents(doc, input, ['input', 'change']);
                return 1;
            }

            // Textarea
            const textarea = inputs.find(el => el.tagName === 'TEXTAREA');
            if (textarea) {
                highlightField(textarea);
                textarea.value = value;
                triggerEvents(doc, textarea, ['input', 'change']);
                return 1;
            }

            log(`  [!] Nie znaleziono pola: ${name}`);
            return 0;
        } catch (e) {
            log(`Blad pola ${name}: ${e.message}`);
            return 0;
        }
    }

    // -----------------------------------------------------------------------
    // Inicjalizacja po znalezieniu formularza
    // -----------------------------------------------------------------------
    function initControls(formResult) {
        const { doc: formDoc, form, source } = formResult;

        // Schowaj waiting, pokaz kontrolki
        document.getElementById('cc-waiting').style.display = 'none';
        document.getElementById('cc-controls').style.display = 'block';

        log(`Formularz znaleziony (${source}). Gotowy!`);

        // ----- Tryb krokowy -----
        document.getElementById('cc-step-mode').addEventListener('change', (e) => {
            stepMode = e.target.checked;
            log(stepMode ? 'Tryb krokowy WLACZONY' : 'Tryb krokowy WYLACZONY');
            if (!stepMode) {
                document.getElementById('cc-btn-step').style.display = 'none';
                // Odblokuj jesli czeka
                if (stepResolve) { stepResolve(); stepResolve = null; }
            }
        });
        document.getElementById('cc-btn-step').addEventListener('click', () => {
            document.getElementById('cc-btn-step').style.display = 'none';
            if (stepResolve) { stepResolve(); stepResolve = null; }
        });

        // ----- Eksport do pliku -----
        document.getElementById('cc-btn-export').addEventListener('click', () => {
            try {
                const data = extractFormDataStructured(form);
                const json = JSON.stringify(data, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `courier_config_id${courierId}_profile${profileId}.json`;
                a.click();
                URL.revokeObjectURL(url);
                log(`Eksport OK! ${Object.keys(data).length} pol. Plik pobrany.`);
            } catch (e) {
                log(`BLAD eksportu: ${e.message}`);
            }
        });

        // ----- Eksport do schowka -----
        document.getElementById('cc-btn-clipboard').addEventListener('click', async () => {
            try {
                const data = extractFormDataStructured(form);
                const json = JSON.stringify(data, null, 2);
                await navigator.clipboard.writeText(json);
                log(`Skopiowano do schowka! ${Object.keys(data).length} pol.`);
            } catch (e) {
                // Fallback
                const data = extractFormDataStructured(form);
                const json = JSON.stringify(data, null, 2);
                const ta = document.createElement('textarea');
                ta.value = json;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                log(`Skopiowano do schowka (fallback)! ${Object.keys(data).length} pol.`);
            }
        });

        // ----- Import z pliku -----
        const fileInput = document.getElementById('cc-file-input');
        document.getElementById('cc-btn-import-file').addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const config = JSON.parse(ev.target.result);
                    log(`Wczytano plik: ${file.name} (${Object.keys(config).length} pol)`);
                    const dataToApply = flattenConfig(config);
                    await applyConfigToForm(form, formDoc, dataToApply);
                } catch (err) {
                    log(`BLAD parsowania JSON: ${err.message}`);
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });

        // ----- Import ze schowka -----
        document.getElementById('cc-btn-import-clipboard').addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                const config = JSON.parse(text);
                log(`Wczytano ze schowka (${Object.keys(config).length} pol)`);
                const dataToApply = flattenConfig(config);
                await applyConfigToForm(form, formDoc, dataToApply);
            } catch (e) {
                log(`BLAD: ${e.message}`);
                log('Sprobuj: Ctrl+V do pola ponizej lub "Zezwol na odczyt schowka"');
                const text = prompt('Wklej JSON z konfiguracja:');
                if (text) {
                    try {
                        const config = JSON.parse(text);
                        const dataToApply = flattenConfig(config);
                        await applyConfigToForm(form, formDoc, dataToApply);
                    } catch (err) {
                        log(`BLAD parsowania: ${err.message}`);
                    }
                }
            }
        });
    }

    // -----------------------------------------------------------------------
    // START
    // -----------------------------------------------------------------------
    console.log('[CourierCopy] v2.5 - Uruchamiam na:', window.location.href);

    // Dodaj UI do strony glownej
    createUI();

    // Szukaj formularza (moze byc w iframe - czekaj az sie zaladuje)
    waitForForm(initControls, 30);

})();
