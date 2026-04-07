// ==UserScript==
// @name         IdoSell Product Exporter
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      1.2
// @description  Eksport wszystkich danych produktow z panelu IdoSell z mozliwoscia wyboru sklepu i pol
// @author       design4art
// @match        https://*.iai-shop.com/panel/products-list.php*
// @grant        GM_addStyle
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    if (window.location.pathname.includes('/panel/app/')) return;

    // ==================== CONFIG ====================
    const BATCH_SIZE_DATA = 20;
    const BATCH_SIZE_PRODUCTS = 100;

    // ==================== FIELD DEFINITIONS ====================
    const FIELD_GROUPS = [
        {
            name: 'Podstawowe',
            fields: [
                { key: 'id', label: 'ID produktu', default: true },
                { key: 'name', label: 'Nazwa (PL)', default: true },
                { key: 'name_eng', label: 'Nazwa (EN)', default: true },
                { key: 'product_type', label: 'Typ towaru', default: true },
                { key: 'gratis', label: 'Gratis', default: false },
                { key: 'barcode', label: 'Kod wewnetrzny', default: true },
                { key: 'visible', label: 'Widocznosc', default: true },
                { key: 'zones_shop_mask', label: 'Maska sklepow (shopmask)', default: true },
                { key: 'date_created', label: 'Data utworzenia', default: false },
                { key: 'date_modified', label: 'Data modyfikacji', default: false },
                { key: 'last_modification', label: 'Ostatnia modyfikacja', default: false },
            ]
        },
        {
            name: 'Identyfikacja',
            fields: [
                { key: 'codes_producer', label: 'Kody producenta (EAN)', default: true },
                { key: 'codes_extern', label: 'Kody zewnetrzne', default: false },
                { key: 'producer_codes_standard', label: 'Standard kodu producenta', default: false },
                { key: 'deliverer_codes', label: 'Kody dostawcy', default: false },
            ]
        },
        {
            name: 'Producent / Marka',
            fields: [
                { key: 'producer_id', label: 'ID producenta', default: false },
                { key: 'producer_name', label: 'Nazwa producenta (marka)', default: true },
                { key: 'responsible_producer', label: 'Producent odpowiedzialny', default: false },
                { key: 'responsible_person', label: 'Osoba odpowiedzialna', default: false },
            ]
        },
        {
            name: 'Podatki / Klasyfikacja',
            fields: [
                { key: 'vat', label: 'Stawka VAT', default: true },
                { key: 'cntaric', label: 'CN / TARIC', default: false },
                { key: 'origin_country', label: 'Kraj pochodzenia', default: false },
                { key: 'taxcode', label: 'PKWiU', default: false },
            ]
        },
        {
            name: 'Ceny',
            fields: [
                { key: 'price_retail', label: 'Cena detaliczna', default: true },
                { key: 'price_wholesale', label: 'Cena hurtowa', default: true },
                { key: 'price_min', label: 'Cena minimalna', default: true },
                { key: 'price_auto_calc', label: 'Do obliczen automatycznych', default: false },
                { key: 'price_suggested', label: 'Cena sugerowana', default: false },
                { key: 'price_crossed_retail', label: 'Przekreslona detaliczna', default: false },
                { key: 'price_crossed_wholesale', label: 'Przekreslona hurtowa', default: false },
                { key: 'price_automatic_calculation', label: 'Automatyczne wyliczanie ceny', default: false },
                { key: 'price_type', label: 'Tryb wyliczania ceny', default: false },
                { key: 'currency', label: 'Waluta', default: true },
                { key: 'products_prices', label: 'Ceny per sklep (JSON)', default: false },
                { key: 'last_purchase_price', label: 'Ostatnia cena zakupu brutto', default: false },
                { key: 'last_purchase_price_net', label: 'Ostatnia cena zakupu netto', default: false },
            ]
        },
        {
            name: 'Stany magazynowe',
            fields: [
                { key: 'in_stock_quantity', label: 'Stan magazynowy', default: true },
                { key: 'available_quantity', label: 'Dostepna ilosc', default: true },
                { key: 'reservations', label: 'Rezerwacje', default: false },
                { key: 'avaliable', label: 'Dostepnosc (profil)', default: false },
            ]
        },
        {
            name: 'Logistyka / Wysylka',
            fields: [
                { key: 'weight', label: 'Waga', default: true },
                { key: 'delivery_time', label: 'Czas dostawy', default: false },
                { key: 'dispatch_profile_id', label: 'Profil wysylki', default: false },
                { key: 'deliverer', label: 'Dostawca (ID)', default: false },
                { key: 'deliverers_data', label: 'Dane dostawcow (JSON)', default: false },
            ]
        },
        {
            name: 'Rozmiary / Jednostki',
            fields: [
                { key: 'sizes', label: 'Grupa rozmiarow', default: false },
                { key: 'sizeschart', label: 'Tabela rozmiarow', default: false },
                { key: 'unit', label: 'Jednostka miary', default: false },
                { key: 'sellby_retail', label: 'Sprzedawane po (detal)', default: false },
                { key: 'sellby_wholesale', label: 'Sprzedawane po (hurt)', default: false },
                { key: 'min_qty_retail', label: 'Min. ilosc w zamowieniu (detal)', default: false },
                { key: 'min_qty_wholesale', label: 'Min. ilosc w zamowieniu (hurt)', default: false },
            ]
        },
        {
            name: 'Opisy',
            fields: [
                { key: 'short_description_pol', label: 'Opis krotki (PL)', default: true },
                { key: 'short_description_eng', label: 'Opis krotki (EN)', default: false },
                { key: 'long_description_pol', label: 'Opis dlugi HTML (PL)', default: false },
                { key: 'long_description_eng', label: 'Opis dlugi HTML (EN)', default: false },
            ]
        },
        {
            name: 'SEO / Meta',
            fields: [
                { key: 'meta_title', label: 'Meta title', default: false },
                { key: 'meta_description', label: 'Meta description', default: false },
                { key: 'meta_keywords', label: 'Meta keywords', default: false },
                { key: 'meta_robots_index', label: 'Robots index', default: false },
                { key: 'meta_robots_follow', label: 'Robots follow', default: false },
            ]
        },
        {
            name: 'Kategorie / Grupy',
            fields: [
                { key: 'category_panel', label: 'Kategoria w panelu', default: false },
                { key: 'iai_category', label: 'Kategoria IdoSell', default: false },
                { key: 'series', label: 'Seria', default: false },
                { key: 'warranty', label: 'Gwarancja', default: false },
            ]
        },
        {
            name: 'Marketing / Statusy',
            fields: [
                { key: 'priority', label: 'Priorytet', default: false },
                { key: 'bestseller', label: 'Bestseller', default: false },
                { key: 'newproduct', label: 'Nowosc', default: false },
                { key: 'promotion', label: 'Promocja', default: false },
                { key: 'discount', label: 'Rabat', default: false },
                { key: 'note', label: 'Adnotacja', default: false },
            ]
        },
        {
            name: 'Inne ustawienia',
            fields: [
                { key: 'advance', label: 'Wartosc zaliczki', default: false },
                { key: 'sum_in_basket', label: 'Sumuj w koszyku', default: false },
                { key: 'serialnumbers', label: 'Numery seryjne', default: false },
                { key: 'products_shops', label: 'Dane sklepow (JSON)', default: false },
                { key: 'product_config', label: 'Konfiguracja produktu (JSON)', default: false },
            ]
        },
    ];

    // ==================== STYLES ====================
    GM_addStyle(`
        #iai-exporter-panel {
            position: fixed; top: 10px; right: 20px; z-index: 99999;
            background: #fff; border: 2px solid #337ab7; border-radius: 8px;
            padding: 16px 20px; width: 380px; max-height: 90vh; overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,.25);
            font-family: Inter, Arial, sans-serif; font-size: 13px;
        }
        #iai-exporter-panel h3 { margin: 0 0 10px; color: #337ab7; font-size: 15px; }
        #iai-exporter-panel label.main-label { display: block; margin: 6px 0 2px; font-weight: 600; }
        #iai-exporter-panel select, #iai-exporter-panel button.btn-export {
            width: 100%; padding: 7px 10px; margin: 4px 0 8px; border-radius: 4px;
            border: 1px solid #ccc; font-size: 13px; box-sizing: border-box;
        }
        #iai-exporter-panel button.btn-export {
            background: #337ab7; color: #fff; border: none; cursor: pointer;
            font-weight: 600; transition: background .2s;
        }
        #iai-exporter-panel button.btn-export:hover { background: #286090; }
        #iai-exporter-panel button.btn-export:disabled { background: #999; cursor: not-allowed; }
        #iai-exporter-panel .progress-bar {
            height: 6px; background: #eee; border-radius: 3px; margin: 8px 0; overflow: hidden;
        }
        #iai-exporter-panel .progress-bar-fill {
            height: 100%; background: #337ab7; width: 0%; transition: width .3s;
        }
        #iai-exporter-panel .status { color: #666; font-size: 12px; min-height: 16px; }
        #iai-exporter-panel .toggle-btn {
            position: absolute; top: 8px; right: 12px; background: none; border: none;
            font-size: 18px; cursor: pointer; color: #999; width: auto; padding: 0; margin: 0;
        }
        #iai-exporter-panel.minimized > *:not(.toggle-btn):not(h3) { display: none; }
        /* Fields panel */
        .fields-toggle { cursor: pointer; color: #337ab7; font-weight: 600; margin: 8px 0 4px;
            display: flex; align-items: center; gap: 6px; user-select: none; }
        .fields-toggle::before { content: '\\25B6'; font-size: 10px; transition: transform .2s; }
        .fields-toggle.open::before { transform: rotate(90deg); }
        .fields-container { display: none; border: 1px solid #e0e0e0; border-radius: 6px;
            padding: 8px 10px; margin-bottom: 8px; max-height: 400px; overflow-y: auto; background: #fafafa; }
        .fields-container.open { display: block; }
        .fields-actions { display: flex; gap: 8px; margin-bottom: 8px; }
        .fields-actions button { flex: 1; padding: 4px 8px; font-size: 11px; border: 1px solid #ccc;
            border-radius: 3px; background: #f5f5f5; cursor: pointer; }
        .fields-actions button:hover { background: #e8e8e8; }
        .field-group { margin-bottom: 6px; }
        .field-group-header { font-weight: 600; font-size: 12px; color: #555; margin: 6px 0 3px;
            cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none; }
        .field-group-header::before { content: '\\25B6'; font-size: 8px; transition: transform .2s; }
        .field-group-header.open::before { transform: rotate(90deg); }
        .field-group-items { display: none; padding-left: 4px; }
        .field-group-items.open { display: block; }
        .field-item { display: flex; align-items: center; gap: 5px; padding: 1px 0; }
        .field-item input[type=checkbox] { margin: 0; }
        .field-item label { font-size: 12px; color: #333; cursor: pointer; font-weight: normal; }
        .field-count { font-size: 11px; color: #999; margin-left: auto; }
    `);

    // ==================== UI ====================
    function createUI() {
        if (document.getElementById('iai-exporter-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'iai-exporter-panel';
        panel.innerHTML = `
            <button class="toggle-btn" title="Minimalizuj">_</button>
            <h3>Product Exporter</h3>
            <label class="main-label">Sklep:</label>
            <select id="iai-exp-shop">
                <option value="0">Wszystkie sklepy</option>
            </select>
            <label class="main-label">Format:</label>
            <select id="iai-exp-format">
                <option value="json">JSON (pelne dane)</option>
                <option value="csv">CSV (splaszczone)</option>
            </select>
            <label class="main-label">Zrodlo danych:</label>
            <select id="iai-exp-source">
                <option value="product-data">product-data.php (pelne dane karty towaru)</option>
                <option value="products-ajax">products.php (podstawowe + opisy + stany)</option>
                <option value="both">Oba endpointy (polaczone)</option>
            </select>
            <div class="fields-toggle" id="iai-fields-toggle">Wybierz pola do eksportu <span class="field-count" id="iai-fields-count"></span></div>
            <div class="fields-container" id="iai-fields-container">
                <div class="fields-actions">
                    <button id="iai-fields-all">Zaznacz wszystkie</button>
                    <button id="iai-fields-none">Odznacz wszystkie</button>
                    <button id="iai-fields-default">Domyslne</button>
                </div>
                <div id="iai-fields-list"></div>
            </div>
            <button class="btn-export" id="iai-exp-start">Eksportuj</button>
            <div class="progress-bar"><div class="progress-bar-fill" id="iai-exp-progress"></div></div>
            <div class="status" id="iai-exp-status"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('.toggle-btn').addEventListener('click', () => {
            panel.classList.toggle('minimized');
        });

        populateShops();
        buildFieldsPanel();
        updateFieldCount();

        document.getElementById('iai-fields-toggle').addEventListener('click', function () {
            this.classList.toggle('open');
            document.getElementById('iai-fields-container').classList.toggle('open');
        });
        document.getElementById('iai-fields-all').addEventListener('click', () => setAllFields(true));
        document.getElementById('iai-fields-none').addEventListener('click', () => setAllFields(false));
        document.getElementById('iai-fields-default').addEventListener('click', resetFieldsToDefault);
        document.getElementById('iai-exp-start').addEventListener('click', startExport);
    }

    function populateShops() {
        const select = document.getElementById('iai-exp-shop');
        if (typeof IAI !== 'undefined' && IAI.shops_list) {
            IAI.shops_list.forEach(shop => {
                const opt = document.createElement('option');
                opt.value = shop.id;
                opt.textContent = `${shop.name} (ID: ${shop.id})`;
                select.appendChild(opt);
            });
        }
    }

    function buildFieldsPanel() {
        const container = document.getElementById('iai-fields-list');
        FIELD_GROUPS.forEach((group, gi) => {
            const div = document.createElement('div');
            div.className = 'field-group';

            const header = document.createElement('div');
            header.className = 'field-group-header';
            header.textContent = group.name;
            header.addEventListener('click', function () {
                this.classList.toggle('open');
                this.nextElementSibling.classList.toggle('open');
            });
            div.appendChild(header);

            const items = document.createElement('div');
            items.className = 'field-group-items';

            group.fields.forEach(f => {
                const item = document.createElement('div');
                item.className = 'field-item';
                item.innerHTML = `<input type="checkbox" id="iai-f-${f.key}" data-field="${f.key}" ${f.default ? 'checked' : ''}>
                    <label for="iai-f-${f.key}">${f.label}</label>`;
                item.querySelector('input').addEventListener('change', updateFieldCount);
                items.appendChild(item);
            });

            div.appendChild(items);
            container.appendChild(div);
        });
    }

    function getSelectedFields() {
        return [...document.querySelectorAll('#iai-fields-list input[type=checkbox]:checked')]
            .map(cb => cb.dataset.field);
    }

    function updateFieldCount() {
        const total = document.querySelectorAll('#iai-fields-list input[type=checkbox]').length;
        const checked = document.querySelectorAll('#iai-fields-list input[type=checkbox]:checked').length;
        document.getElementById('iai-fields-count').textContent = `(${checked}/${total})`;
    }

    function setAllFields(state) {
        document.querySelectorAll('#iai-fields-list input[type=checkbox]').forEach(cb => cb.checked = state);
        updateFieldCount();
    }

    function resetFieldsToDefault() {
        FIELD_GROUPS.forEach(group => {
            group.fields.forEach(f => {
                const cb = document.getElementById('iai-f-' + f.key);
                if (cb) cb.checked = f.default;
            });
        });
        updateFieldCount();
    }

    function setStatus(text) {
        document.getElementById('iai-exp-status').textContent = text;
    }

    function setProgress(pct) {
        document.getElementById('iai-exp-progress').style.width = pct + '%';
    }

    // ==================== COLLECT ALL PRODUCT IDS ====================
    async function collectAllProductIds() {
        setStatus('Pobieram liste produktow (strona 1)...');
        const firstPage = await fetchProductListPage(1);
        const totalMatch = firstPage.match(/wszystkich (\d+)/);
        const totalProducts = totalMatch ? parseInt(totalMatch[1]) : 0;
        const totalPages = Math.ceil(totalProducts / 100);

        let allIds = extractIdsFromPage(firstPage);
        setStatus(`Znaleziono ${totalProducts} produktow, ${totalPages} stron...`);

        const pagePromises = [];
        for (let p = 2; p <= totalPages; p++) {
            pagePromises.push(fetchProductListPage(p));
        }
        const pages = await Promise.all(pagePromises);
        pages.forEach(html => { allIds = allIds.concat(extractIdsFromPage(html)); });
        return allIds;
    }

    async function fetchProductListPage(page) {
        const resp = await fetch('/panel/ajax/view-manager.php?type=products&view=ajax_content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `__iai_shop_panel[__encoding]=utf-8&sort[column]=id&sort[type]=a&config_width=1000&specialColumns[input]=1&current_page=${page}`
        });
        return resp.text();
    }

    function extractIdsFromPage(html) {
        return [...html.matchAll(/name="id_products\[\]"[^>]*value="(\d+)"/g)].map(m => parseInt(m[1]));
    }

    // ==================== FILTER BY SHOP ====================
    async function filterByShop(allIds, shopId) {
        if (shopId === 0) return allIds;
        setStatus(`Sprawdzam shopmask dla ${allIds.length} produktow...`);
        const filtered = [];
        for (let i = 0; i < allIds.length; i += BATCH_SIZE_DATA) {
            const batch = allIds.slice(i, i + BATCH_SIZE_DATA);
            const results = await Promise.all(batch.map(id =>
                fetch('/panel/ajax/product-data.php?product=' + id)
                    .then(r => r.json())
                    .then(j => {
                        const mask = parseInt(j.data?.zones_shop_mask || j.data?.shop || '0');
                        return (mask & (1 << (shopId - 1))) ? id : null;
                    })
                    .catch(() => null)
            ));
            results.forEach(id => { if (id) filtered.push(id); });
            setProgress(Math.round((i + batch.length) / allIds.length * 30));
            setStatus(`Shopmask: ${i + batch.length}/${allIds.length} (${filtered.length} znalezionych)`);
        }
        return filtered;
    }

    // ==================== FETCH PRODUCT DATA ====================
    async function fetchProductData(ids, source) {
        const allData = {};
        if (source === 'product-data' || source === 'both') {
            for (let i = 0; i < ids.length; i += BATCH_SIZE_DATA) {
                const batch = ids.slice(i, i + BATCH_SIZE_DATA);
                await Promise.all(batch.map(id =>
                    fetch('/panel/ajax/product-data.php?product=' + id)
                        .then(r => r.json())
                        .then(j => { allData[id] = { ...allData[id], productData: j }; })
                        .catch(e => { allData[id] = { ...allData[id], productDataError: e.message }; })
                ));
                setProgress(30 + Math.round((i + batch.length) / ids.length * 35));
                setStatus(`product-data: ${Math.min(i + BATCH_SIZE_DATA, ids.length)}/${ids.length}`);
            }
        }
        if (source === 'products-ajax' || source === 'both') {
            for (let i = 0; i < ids.length; i += BATCH_SIZE_PRODUCTS) {
                const batch = ids.slice(i, i + BATCH_SIZE_PRODUCTS);
                const idParams = batch.map(id => 'id[]=' + id).join('&');
                try {
                    const resp = await fetch(
                        '/panel/ajax/products.php?getproductdata=1&extendedinfo=1&result=ajaxRequest&' + idParams,
                        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'mode=normal' }
                    );
                    const json = await resp.json();
                    if (json.value) json.value.forEach(p => { allData[p.id] = { ...allData[p.id], productsAjax: p }; });
                } catch (e) { console.error('products.php batch error', e); }
                setProgress(65 + Math.round((i + batch.length) / ids.length * 25));
                setStatus(`products.php: ${Math.min(i + BATCH_SIZE_PRODUCTS, ids.length)}/${ids.length}`);
            }
        }
        return allData;
    }

    // ==================== FLATTEN FOR CSV ====================
    function buildFullRow(id, entry) {
        const pd = entry.productData?.data || {};
        const pa = entry.productsAjax || {};
        const additional = entry.productData?.additional || {};
        const langPol = (pa.lang_data || []).find(l => l.lang_id === 'pol') || {};
        const langEng = (pa.lang_data || []).find(l => l.lang_id === 'eng') || {};
        const stringify = v => (typeof v === 'object' && v !== null) ? JSON.stringify(v) : (v ?? '');

        return {
            id,
            name: pd.name || langPol.name || '',
            name_eng: langEng.name || '',
            product_type: pd.product_type || '',
            gratis: pd.gratis || '',
            barcode: pd.barcode || '',
            visible: pd.visible || '',
            zones_shop_mask: pd.zones_shop_mask || pd.shop || '',
            date_created: pd.date_created || '',
            date_modified: pd.date_modified || '',
            last_modification: pd.last_modification || '',
            codes_producer: stringify(pd.codes_producer),
            codes_extern: stringify(pd.codes_extern),
            producer_codes_standard: pd.producer_codes_standard || '',
            deliverer_codes: stringify(pd.deliverer_codes),
            producer_id: pd.producer || '',
            producer_name: additional.producer_name || '',
            responsible_producer: pd.responsible_producer || '',
            responsible_person: pd.responsible_person || '',
            vat: pd.vat || '',
            cntaric: pd.cntaric || '',
            origin_country: stringify(pd.origin_country),
            taxcode: pd.taxcode || '',
            price_retail: pd.price ?? '',
            price_wholesale: pd.priceg ?? '',
            price_min: pd.pricem ?? '',
            price_auto_calc: pd.priceac ?? '',
            price_suggested: pd.pricerd ?? '',
            price_crossed_retail: pd.price_crossed_retail ?? '',
            price_crossed_wholesale: pd.price_crossed_wholesale ?? '',
            price_automatic_calculation: pd.price_automatic_calculation ?? '',
            price_type: pd.price_type || '',
            currency: pd.currency || additional.currency || '',
            products_prices: stringify(pd.products_prices),
            last_purchase_price: pd.last_purchase_price || '',
            last_purchase_price_net: pd.last_purchase_price_net || '',
            in_stock_quantity: stringify(pa.in_stock_quantity),
            available_quantity: stringify(pa.available_quantity),
            reservations: stringify(pa.reservations),
            avaliable: pd.avaliable || '',
            weight: pd.weight || '',
            delivery_time: pd.delivery_time || '',
            dispatch_profile_id: pd.dispatch_profile_id || '',
            deliverer: pd.deliverer || '',
            deliverers_data: stringify(pd.deliverers_data),
            sizes: pd.sizes || '',
            sizeschart: pd.sizeschart || '',
            unit: pd.unit || '',
            sellby_retail: pd.sellby_retail || '',
            sellby_wholesale: pd.sellby_wholesale || '',
            min_qty_retail: pd.minQuantityPerOrder?.retail ?? '',
            min_qty_wholesale: pd.minQuantityPerOrder?.wholesale ?? '',
            short_description_pol: pd.description || langPol.description || '',
            short_description_eng: langEng.description || '',
            long_description_pol: pd.longdescription || langPol.long_description || '',
            long_description_eng: langEng.long_description || '',
            meta_title: pd.meta_title || '',
            meta_description: pd.meta_description || '',
            meta_keywords: pd.meta_keywords || '',
            meta_robots_index: pd.meta_robots_index || '',
            meta_robots_follow: pd.meta_robots_follow || '',
            category_panel: pd.subcategory || '',
            iai_category: pd.iai_category_id || '',
            series: pd.series || '',
            warranty: pd.warranty || '',
            priority: pd.priority || '',
            bestseller: pd.bestseller || '',
            newproduct: pd.newproduct || '',
            promotion: pd.promotion || '',
            discount: pd.discount || '',
            note: pd.note || '',
            advance: pd.advance || '',
            sum_in_basket: pd.sum_in_basket || '',
            serialnumbers: pd.serialnumbers || '',
            products_shops: stringify(pd.products_shops),
            product_config: stringify(pd.product_config),
        };
    }

    function filterRow(fullRow, selectedFields) {
        const filtered = {};
        selectedFields.forEach(key => {
            if (key in fullRow) filtered[key] = fullRow[key];
        });
        return filtered;
    }

    function toCsv(rows) {
        if (!rows.length) return '';
        const headers = Object.keys(rows[0]);
        const escape = v => {
            const s = String(v ?? '').replace(/"/g, '""');
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
        };
        const lines = [headers.join(',')];
        rows.forEach(row => lines.push(headers.map(h => escape(row[h])).join(',')));
        return lines.join('\n');
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ==================== MAIN EXPORT ====================
    async function startExport() {
        const btn = document.getElementById('iai-exp-start');
        btn.disabled = true;
        setProgress(0);

        try {
            const shopId = parseInt(document.getElementById('iai-exp-shop').value);
            const format = document.getElementById('iai-exp-format').value;
            const source = document.getElementById('iai-exp-source').value;
            const shopName = document.getElementById('iai-exp-shop').selectedOptions[0].textContent;
            const selectedFields = getSelectedFields();

            if (selectedFields.length === 0) {
                setStatus('Zaznacz przynajmniej jedno pole!');
                btn.disabled = false;
                return;
            }

            // 1. Collect IDs
            setStatus('Krok 1/4: Zbieram ID produktow...');
            let allIds = await collectAllProductIds();
            setProgress(10);

            // 2. Filter by shop
            let filteredIds = allIds;
            if (shopId > 0) {
                setStatus(`Krok 2/4: Filtrowanie po sklepie ${shopName}...`);
                filteredIds = await filterByShop(allIds, shopId);
                setStatus(`Po filtrze: ${filteredIds.length} produktow`);
            } else {
                setProgress(30);
            }

            // 3. Fetch data
            setStatus(`Krok 3/4: Pobieram dane ${filteredIds.length} produktow...`);
            const data = await fetchProductData(filteredIds, source);
            setProgress(90);

            // 4. Generate output
            setStatus('Krok 4/4: Generowanie pliku...');
            const timestamp = new Date().toISOString().slice(0, 10);
            const shopSlug = shopId > 0 ? `_shop${shopId}` : '_all';

            if (format === 'json') {
                const products = Object.entries(data).map(([id, entry]) => {
                    const full = buildFullRow(parseInt(id), entry);
                    return filterRow(full, selectedFields);
                });
                const output = {
                    exportDate: new Date().toISOString(),
                    shop: shopName,
                    shopId,
                    totalProducts: products.length,
                    source,
                    selectedFields,
                    products
                };
                downloadFile(JSON.stringify(output, null, 2), `products_export${shopSlug}_${timestamp}.json`, 'application/json');
            } else {
                const rows = Object.entries(data).map(([id, entry]) => {
                    const full = buildFullRow(parseInt(id), entry);
                    return filterRow(full, selectedFields);
                });
                downloadFile('\uFEFF' + toCsv(rows), `products_export${shopSlug}_${timestamp}.csv`, 'text/csv;charset=utf-8');
            }

            setProgress(100);
            setStatus(`Gotowe! Wyeksportowano ${filteredIds.length} produktow (${selectedFields.length} pol).`);
        } catch (e) {
            setStatus('Blad: ' + e.message);
            console.error('Export error:', e);
        } finally {
            btn.disabled = false;
        }
    }

    // ==================== INIT ====================
    function waitForIAI() {
        if (typeof IAI !== 'undefined' && IAI.shops_list) {
            createUI();
        } else {
            setTimeout(waitForIAI, 500);
        }
    }
    waitForIAI();
})();
