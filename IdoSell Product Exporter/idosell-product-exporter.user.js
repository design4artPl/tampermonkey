// ==UserScript==
// @name         IdoSell Product Exporter
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      1.1
// @description  Eksport wszystkich danych produktow z panelu IdoSell z mozliwoscia wyboru sklepu
// @author       design4art
// @match        https://*.iai-shop.com/panel/products-list.php*
// @grant        GM_addStyle
// @grant        GM_download
// ==/UserScript==

(function () {
    'use strict';

    // Skip the /app/ wrapper frame - only run in the actual products-list iframe
    if (window.location.pathname.includes('/panel/app/')) return;

    // ==================== CONFIG ====================
    const BATCH_SIZE_IDS = 100;    // products per page when collecting IDs
    const BATCH_SIZE_DATA = 20;    // concurrent product-data requests
    const BATCH_SIZE_PRODUCTS = 100; // products per batch for ajax/products.php

    // ==================== STYLES ====================
    GM_addStyle(`
        #iai-exporter-panel {
            position: fixed; top: 60px; right: 20px; z-index: 99999;
            background: #fff; border: 2px solid #337ab7; border-radius: 8px;
            padding: 16px 20px; min-width: 340px; box-shadow: 0 4px 20px rgba(0,0,0,.25);
            font-family: Inter, Arial, sans-serif; font-size: 13px;
        }
        #iai-exporter-panel h3 { margin: 0 0 12px; color: #337ab7; font-size: 15px; }
        #iai-exporter-panel label { display: block; margin: 6px 0 2px; font-weight: 600; }
        #iai-exporter-panel select, #iai-exporter-panel button {
            width: 100%; padding: 7px 10px; margin: 4px 0 8px; border-radius: 4px;
            border: 1px solid #ccc; font-size: 13px; box-sizing: border-box;
        }
        #iai-exporter-panel button {
            background: #337ab7; color: #fff; border: none; cursor: pointer;
            font-weight: 600; transition: background .2s;
        }
        #iai-exporter-panel button:hover { background: #286090; }
        #iai-exporter-panel button:disabled { background: #999; cursor: not-allowed; }
        #iai-exporter-panel .progress-bar {
            height: 6px; background: #eee; border-radius: 3px; margin: 8px 0; overflow: hidden;
        }
        #iai-exporter-panel .progress-bar-fill {
            height: 100%; background: #337ab7; width: 0%; transition: width .3s;
        }
        #iai-exporter-panel .status { color: #666; font-size: 12px; min-height: 16px; }
        #iai-exporter-panel .toggle-btn {
            position: absolute; top: 8px; right: 12px; background: none; border: none;
            font-size: 18px; cursor: pointer; color: #999; width: auto; padding: 0;
        }
        #iai-exporter-panel.minimized > *:not(.toggle-btn):not(h3) { display: none; }
    `);

    // ==================== UI ====================
    function createUI() {
        if (document.getElementById('iai-exporter-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'iai-exporter-panel';
        panel.innerHTML = `
            <button class="toggle-btn" title="Minimalizuj">_</button>
            <h3>Product Exporter</h3>
            <label>Sklep:</label>
            <select id="iai-exp-shop">
                <option value="0">Wszystkie sklepy</option>
            </select>
            <label>Format:</label>
            <select id="iai-exp-format">
                <option value="json">JSON (pelne dane)</option>
                <option value="csv">CSV (splaszczone)</option>
            </select>
            <label>Zrodlo danych:</label>
            <select id="iai-exp-source">
                <option value="product-data">product-data.php (pelne dane karty towaru)</option>
                <option value="products-ajax">products.php (podstawowe + opisy + stany)</option>
                <option value="both">Oba endpointy (polaczone)</option>
            </select>
            <button id="iai-exp-start">Eksportuj</button>
            <div class="progress-bar"><div class="progress-bar-fill" id="iai-exp-progress"></div></div>
            <div class="status" id="iai-exp-status"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('.toggle-btn').addEventListener('click', () => {
            panel.classList.toggle('minimized');
        });

        populateShops();
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
        pages.forEach(html => {
            allIds = allIds.concat(extractIdsFromPage(html));
        });

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

    // ==================== FILTER BY SHOP (shopmask) ====================
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
            setStatus(`Shopmask: ${i + batch.length}/${allIds.length} (znaleziono ${filtered.length})...`);
        }
        return filtered;
    }

    // ==================== FETCH PRODUCT DATA ====================
    async function fetchProductData(ids, source) {
        const allData = {};

        if (source === 'product-data' || source === 'both') {
            setStatus('Pobieram pelne dane z product-data.php...');
            for (let i = 0; i < ids.length; i += BATCH_SIZE_DATA) {
                const batch = ids.slice(i, i + BATCH_SIZE_DATA);
                await Promise.all(batch.map(id =>
                    fetch('/panel/ajax/product-data.php?product=' + id)
                        .then(r => r.json())
                        .then(j => { allData[id] = { ...allData[id], productData: j }; })
                        .catch(e => { allData[id] = { ...allData[id], productDataError: e.message }; })
                ));
                const pct = 30 + Math.round((i + batch.length) / ids.length * 35);
                setProgress(pct);
                setStatus(`product-data: ${Math.min(i + BATCH_SIZE_DATA, ids.length)}/${ids.length}`);
            }
        }

        if (source === 'products-ajax' || source === 'both') {
            setStatus('Pobieram dane z products.php (opisy, stany)...');
            for (let i = 0; i < ids.length; i += BATCH_SIZE_PRODUCTS) {
                const batch = ids.slice(i, i + BATCH_SIZE_PRODUCTS);
                const idParams = batch.map(id => 'id[]=' + id).join('&');
                try {
                    const resp = await fetch(
                        '/panel/ajax/products.php?getproductdata=1&extendedinfo=1&result=ajaxRequest&' + idParams,
                        { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'mode=normal' }
                    );
                    const json = await resp.json();
                    if (json.value) {
                        json.value.forEach(p => {
                            allData[p.id] = { ...allData[p.id], productsAjax: p };
                        });
                    }
                } catch (e) { console.error('products.php batch error', e); }
                const pct = 65 + Math.round((i + batch.length) / ids.length * 25);
                setProgress(pct);
                setStatus(`products.php: ${Math.min(i + BATCH_SIZE_PRODUCTS, ids.length)}/${ids.length}`);
            }
        }

        return allData;
    }

    // ==================== FLATTEN FOR CSV ====================
    function flattenProduct(id, entry) {
        const pd = entry.productData?.data || {};
        const pa = entry.productsAjax || {};
        const additional = entry.productData?.additional || {};

        const langPol = (pa.lang_data || []).find(l => l.lang_id === 'pol') || {};
        const langEng = (pa.lang_data || []).find(l => l.lang_id === 'eng') || {};

        return {
            id,
            name: pd.name || langPol.name || '',
            name_eng: langEng.name || '',
            product_type: pd.product_type || '',
            gratis: pd.gratis || '',
            vat: pd.vat || '',
            cntaric: pd.cntaric || '',
            origin_country: typeof pd.origin_country === 'object' ? JSON.stringify(pd.origin_country) : (pd.origin_country || ''),
            producer_id: pd.producer || '',
            producer_name: additional.producer_name || '',
            responsible_producer: pd.responsible_producer || '',
            responsible_person: pd.responsible_person || '',
            warranty: pd.warranty || '',
            series: pd.series || '',
            category_panel: pd.subcategory || '',
            iai_category: pd.iai_category_id || '',
            note: pd.note || '',
            advance: pd.advance || '',
            sum_in_basket: pd.sum_in_basket || '',
            serialnumbers: pd.serialnumbers || '',
            producer_codes_standard: pd.producer_codes_standard || '',
            codes_producer: typeof pd.codes_producer === 'object' ? JSON.stringify(pd.codes_producer) : '',
            codes_extern: Array.isArray(pd.codes_extern) ? JSON.stringify(pd.codes_extern) : '',
            barcode: pd.barcode || '',
            price_retail: pd.price || '',
            price_wholesale: pd.priceg || '',
            price_min: pd.pricem || '',
            price_auto_calc: pd.priceac || '',
            price_suggested: pd.pricerd || '',
            price_crossed_retail: pd.price_crossed_retail || '',
            price_crossed_wholesale: pd.price_crossed_wholesale || '',
            price_automatic_calculation: pd.price_automatic_calculation || '',
            price_type: pd.price_type || '',
            currency: pd.currency || additional.currency || '',
            last_purchase_price: pd.last_purchase_price || '',
            last_purchase_price_net: pd.last_purchase_price_net || '',
            products_prices: typeof pd.products_prices === 'object' ? JSON.stringify(pd.products_prices) : '',
            zones_shop_mask: pd.zones_shop_mask || pd.shop || '',
            visible: pd.visible || '',
            priority: pd.priority || '',
            bestseller: pd.bestseller || '',
            weight: pd.weight || '',
            delivery_time: pd.delivery_time || '',
            sellby_retail: pd.sellby_retail || '',
            sellby_wholesale: pd.sellby_wholesale || '',
            min_qty_retail: typeof pd.minQuantityPerOrder === 'object' ? (pd.minQuantityPerOrder.retail || '') : '',
            min_qty_wholesale: typeof pd.minQuantityPerOrder === 'object' ? (pd.minQuantityPerOrder.wholesale || '') : '',
            unit: pd.unit || '',
            sizeschart: pd.sizeschart || '',
            sizes: pd.sizes || '',
            deliverer: pd.deliverer || '',
            deliverers_data: Array.isArray(pd.deliverers_data) ? JSON.stringify(pd.deliverers_data) : '',
            deliverer_codes: Array.isArray(pd.deliverer_codes) ? JSON.stringify(pd.deliverer_codes) : '',
            dispatch_profile_id: pd.dispatch_profile_id || '',
            short_description_pol: pd.description || langPol.description || '',
            short_description_eng: langEng.description || '',
            long_description_pol: pd.longdescription || langPol.long_description || '',
            long_description_eng: langEng.long_description || '',
            meta_title: pd.meta_title || '',
            meta_description: pd.meta_description || '',
            meta_keywords: pd.meta_keywords || '',
            meta_robots_index: pd.meta_robots_index || '',
            meta_robots_follow: pd.meta_robots_follow || '',
            date_created: pd.date_created || '',
            date_modified: pd.date_modified || '',
            last_modification: pd.last_modification || '',
            promotion: pd.promotion || '',
            discount: pd.discount || '',
            newproduct: pd.newproduct || '',
            avaliable: pd.avaliable || '',
            in_stock_quantity: pa.in_stock_quantity ? JSON.stringify(pa.in_stock_quantity) : '',
            available_quantity: pa.available_quantity ? JSON.stringify(pa.available_quantity) : '',
            reservations: pa.reservations ? JSON.stringify(pa.reservations) : '',
            products_shops: typeof pd.products_shops === 'object' ? JSON.stringify(pd.products_shops) : '',
            product_config: typeof pd.product_config === 'object' ? JSON.stringify(pd.product_config) : '',
        };
    }

    function toCsv(rows) {
        if (!rows.length) return '';
        const headers = Object.keys(rows[0]);
        const escape = (v) => {
            const s = String(v ?? '').replace(/"/g, '""');
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
        };
        const lines = [headers.join(',')];
        rows.forEach(row => lines.push(headers.map(h => escape(row[h])).join(',')));
        return lines.join('\n');
    }

    // ==================== DOWNLOAD ====================
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

            // 1. Collect all product IDs
            setStatus('Krok 1/4: Zbieram ID produktow...');
            let allIds = await collectAllProductIds();
            setProgress(10);
            setStatus(`Znaleziono ${allIds.length} produktow.`);

            // 2. Filter by shop if needed
            let filteredIds = allIds;
            if (shopId > 0) {
                setStatus(`Krok 2/4: Filtrowanie po sklepie ${shopName}...`);
                filteredIds = await filterByShop(allIds, shopId);
                setStatus(`Po filtrze: ${filteredIds.length} produktow w sklepie ${shopName}`);
            } else {
                setProgress(30);
            }

            // 3. Fetch product data
            setStatus(`Krok 3/4: Pobieram dane ${filteredIds.length} produktow...`);
            const data = await fetchProductData(filteredIds, source);
            setProgress(90);

            // 4. Generate output
            setStatus('Krok 4/4: Generowanie pliku...');
            const timestamp = new Date().toISOString().slice(0, 10);
            const shopSlug = shopId > 0 ? `_shop${shopId}` : '_all';

            if (format === 'json') {
                const output = {
                    exportDate: new Date().toISOString(),
                    shop: shopName,
                    shopId,
                    totalProducts: filteredIds.length,
                    source,
                    products: Object.entries(data).map(([id, entry]) => ({ id: parseInt(id), ...entry }))
                };
                downloadFile(JSON.stringify(output, null, 2), `products_export${shopSlug}_${timestamp}.json`, 'application/json');
            } else {
                const rows = Object.entries(data).map(([id, entry]) => flattenProduct(parseInt(id), entry));
                downloadFile('\uFEFF' + toCsv(rows), `products_export${shopSlug}_${timestamp}.csv`, 'text/csv;charset=utf-8');
            }

            setProgress(100);
            setStatus(`Gotowe! Wyeksportowano ${filteredIds.length} produktow.`);
        } catch (e) {
            setStatus('Blad: ' + e.message);
            console.error('Export error:', e);
        } finally {
            btn.disabled = false;
        }
    }

    // ==================== INIT ====================
    // Wait for IAI object to be available (it loads asynchronously)
    function waitForIAI() {
        if (typeof IAI !== 'undefined' && IAI.shops_list) {
            createUI();
        } else {
            setTimeout(waitForIAI, 500);
        }
    }
    waitForIAI();
})();
