// ==UserScript==
// @name         IdoSell - Panel Migrator
// @namespace    https://idosell.com/
// @version      1.7.0
// @description  Migracja danych (marki, i inne) między panelami IdoSell przez API
// @author       SyncOffer
// @match        https://*.iai-shop.com/panel/*
// @match        https://*.idosell.com/panel/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      *.iai-shop.com
// @connect      *.idosell.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // STORAGE HELPERS
  // =========================================================================

  function loadConfig() {
    const defaults = {
      sourceDomain: '',
      sourceApiKey: '',
      targetDomain: '',
      targetApiKey: '',
    };
    try {
      const saved = GM_getValue('migratorConfig', null);
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  }

  function saveConfig(cfg) {
    GM_setValue('migratorConfig', JSON.stringify(cfg));
  }

  // =========================================================================
  // API HELPERS
  // =========================================================================

  function apiRequest(method, url, apiKey, body) {
    return new Promise((resolve, reject) => {
      const opts = {
        method,
        url,
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
        onload(res) {
          if (res.status >= 400) {
            reject(new Error(`HTTP ${res.status}: ${res.responseText.substring(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(res.responseText));
          } catch {
            reject(new Error('Nieprawidlowa odpowiedz JSON: ' + res.responseText.substring(0, 300)));
          }
        },
        onerror(err) {
          reject(new Error('Blad sieci: status=' + (err.status || '?') + ' ' + (err.statusText || '') + ' url=' + url));
        },
        onabort() {
          reject(new Error('Przerwane: ' + url));
        },
        ontimeout() {
          reject(new Error('Timeout: ' + url));
        },
        timeout: 30000,
      };
      if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.data = JSON.stringify(body);
      }
      GM_xmlhttpRequest(opts);
    });
  }

  function buildUrl(domain, path) {
    const d = domain.replace(/\/+$/, '');
    const base = d.startsWith('http') ? d : 'https://' + d;
    return base + path;
  }

  // =========================================================================
  // MODULE: BRANDS (MARKI / PRODUCERS)
  // =========================================================================

  async function fetchAllBrands(domain, apiKey, log) {
    const allProducers = [];
    let page = 0;
    const limit = 50;
    let total = null;

    while (true) {
      const url = buildUrl(domain, `/api/admin/v7/products/brands?results_page=${page}&results_limit=${limit}`);
      log(`Pobieranie marek: strona ${page + 1}...`);
      const data = await apiRequest('GET', url, apiKey);

      if (!data.producers) {
        throw new Error('Brak danych producers w odpowiedzi: ' + JSON.stringify(data).substring(0, 300));
      }

      allProducers.push(...data.producers);
      if (total === null) total = data.results_number_all;
      log(`Pobrano ${allProducers.length} / ${total} marek`);

      if (allProducers.length >= total) break;
      page++;
    }

    return allProducers;
  }

  function mapBrandForImport(producer, targetId) {
    const langConfigs = (producer.lang_data || []).map(ld => ({
      languageId: ld.lang_id,
      shopsConfigurations: [
        {
          shopId: 1,
          name: producer.name,
          headerName: '',
          descriptionTop: ld.text || '',
          descriptionBottom: '',
        },
      ],
    }));

    const mapped = {
      nameInPanel: producer.name,
      languagesConfigurations: langConfigs,
    };
    if (targetId) mapped.id = targetId;
    return mapped;
  }

  async function importBrands(domain, apiKey, producers, targetBrandsMap, log) {
    const toImport = producers.filter(p => p.id !== 0);

    // Map source brands: existing get target ID (PUT update), new get source ID (PUT create)
    const items = toImport.map(p => {
      const key = p.name.toLowerCase().trim();
      const targetId = targetBrandsMap.get(key);
      return { producer: p, targetId: targetId || p.id, isNew: !targetId };
    });

    const newCount = items.filter(i => i.isNew).length;
    const updateCount = items.filter(i => !i.isNew).length;
    log(`Nowe marki: ${newCount}, do aktualizacji: ${updateCount}`);

    const batchSize = 10;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const mapped = batch.map(b => mapBrandForImport(b.producer, b.targetId));
      const batchNum = Math.floor(i / batchSize) + 1;
      const batchNames = batch.map(b => b.producer.name).join(', ');

      log(`PUT batch ${batchNum}: ${batchNames.substring(0, 80)}`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/products/brands');
        const res = await apiRequest('PUT', url, apiKey, { params: { producers: mapped } });

        if (res.producersResponse) {
          for (const pr of res.producersResponse) {
            if (pr.producerErrors) {
              failCount++;
              const err = pr.producerErrors.map(e => e.faultCode).join(', ');
              errors.push(`${pr.nameInPanel}: ${err}`);
              log(`  [FAIL] ${pr.nameInPanel}: ${err}`);
            } else {
              successCount++;
            }
          }
        }
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch ${batchNum}: ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }

      log(`Postep: ${successCount} OK, ${failCount} bledow / ${items.length} lacznie`);
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: SIZES (ROZMIARY - definicje grup i rozmiarow)
  // =========================================================================

  async function fetchSizeGroups(domain, apiKey, log) {
    const url = buildUrl(domain, '/api/admin/v7/sizes/sizes');
    log('Pobieranie grup rozmiarow...');
    const data = await apiRequest('GET', url, apiKey);
    const groups = data.size_groups || [];
    log(`Pobrano ${groups.length} grup rozmiarow`);
    return groups;
  }

  // Create size group via panel AJAX endpoint.
  // Discovered via network inspection: POST /panel/ajax/sizesview.php
  // Body: name={name}&parent=0&action=addnode&tree=sizes&lang=pol&shop=undefined&mode=
  async function createSizeGroupViaPanel(groupName, log) {
    try {
      const resp = await fetch('/panel/ajax/sizesview.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
        body: `name=${encodeURIComponent(groupName)}&parent=0&action=addnode&tree=sizes&lang=pol&shop=undefined&mode=`,
      });
      if (!resp.ok) {
        log(`  [FAIL] "${groupName}": HTTP ${resp.status}`);
        return { ok: false };
      }
      const text = await resp.text();
      if (text.includes('panel_login') || text.includes('Logowanie')) {
        log(`  [FAIL] "${groupName}": brak sesji - uruchom skrypt z panelu docelowego`);
        return { ok: false };
      }
      log(`  Odpowiedz: ${text.substring(0, 200)}`);
      return { ok: true };
    } catch (e) {
      log(`  [FAIL] "${groupName}": ${e.message}`);
      return { ok: false };
    }
  }

  async function importSizeDefinitions(domain, apiKey, sizesToAdd, log) {
    const batchSize = 20;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < sizesToAdd.length; i += batchSize) {
      const batch = sizesToAdd.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      log(`PUT batch ${batchNum}: ${batch.length} rozmiarow`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/sizes/sizes');
        const res = await apiRequest('PUT', url, apiKey, {
          params: { sizes: batch },
        });

        if (res.sizes && Array.isArray(res.sizes)) {
          for (const s of res.sizes) {
            if (s.faultCode && s.faultCode !== 0) {
              failCount++;
              errors.push(`${s.name || s.id} (gr.${s.group_id}): [${s.faultCode}] ${s.faultString}`);
              log(`  [FAIL] ${s.name || s.id}: ${s.faultString}`);
            } else {
              successCount++;
            }
          }
        }
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch ${batchNum}: ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: PARAMETERS (PARAMETRY)
  // =========================================================================

  async function fetchAllParameters(domain, apiKey, log) {
    const all = {};
    let page = 0;
    let total = null;
    while (true) {
      const url = buildUrl(domain, '/api/admin/v7/products/parameters/search');
      log(`Pobieranie parametrow: strona ${page + 1}...`);
      const data = await apiRequest('POST', url, apiKey, {
        params: { resultsPage: page, resultsLimit: 100, languagesIds: ['pol', 'eng'], parameterValueIds: true },
      });
      const results = data.parametersResult || {};
      for (const [k, v] of Object.entries(results)) all[k] = v;
      if (total === null) total = data.resultsNumberAll;
      log(`Pobrano ${Object.keys(all).length} / ${total} elementow`);
      if (Object.keys(all).length >= total) break;
      page++;
    }
    return all;
  }

  function getParamNamePl(item) {
    return (item.names || []).find(n => n.languageId === 'pol')?.value || '?';
  }

  // item_text_ids format:
  //   "SectionName"           -> creates section
  //   "ParamName\"            -> creates parameter (trailing backslash)
  //   "ParamName\ValueName"   -> creates value under parameter
  async function importParameters(domain, apiKey, srcParams, log) {
    const parameters = Object.values(srcParams).filter(p => p.type === 'parameter');
    const values = Object.values(srcParams).filter(p => p.type === 'value');
    const sections = Object.values(srcParams).filter(p => p.type === 'section');
    let successCount = 0, failCount = 0;
    const errors = [];
    const batchSize = 20;
    const apiUrl = buildUrl(domain, '/api/admin/v7/products/parameters');

    // Helper to build item_text_ids with backslash convention
    function buildTextId(name, langId) { return { languageId: langId, value: name }; }

    // 1. Import sections (just name, no backslash)
    if (sections.length > 0) {
      log(`Importowanie ${sections.length} sekcji...`);
      const items = sections.map(s => ({
        item_text_ids: s.names.map(n => buildTextId(n.value, n.languageId)),
        names: s.names.map(n => ({ lang_id: n.languageId, value: n.value })),
        descriptions: (s.descriptions || []).map(d => ({ lang_id: d.languageId, value: d.value })),
      }));
      try {
        const res = await apiRequest('PUT', apiUrl, apiKey, { items });
        for (const r of (res.results || [])) { if (r.faultCode === 0) successCount++; else { failCount++; errors.push(`Section: ${r.faultString}`); } }
      } catch (err) { failCount += sections.length; errors.push(`Sections: ${err.message}`); }
    }

    // 2. Import parameters (name + trailing backslash)
    log(`Importowanie ${parameters.length} parametrow...`);
    for (let i = 0; i < parameters.length; i += batchSize) {
      const batch = parameters.slice(i, i + batchSize);
      const items = batch.map(p => ({
        item_text_ids: p.names.map(n => buildTextId(n.value + '\\', n.languageId)),
        names: p.names.map(n => ({ lang_id: n.languageId, value: n.value })),
        descriptions: (p.descriptions || []).map(d => ({ lang_id: d.languageId, value: d.value })),
      }));
      try {
        const res = await apiRequest('PUT', apiUrl, apiKey, { items });
        for (let j = 0; j < (res.results || []).length; j++) {
          const r = res.results[j];
          if (r.faultCode === 0) successCount++;
          else { failCount++; errors.push(`"${getParamNamePl(batch[j])}": ${r.faultString}`); log(`  [FAIL] ${getParamNamePl(batch[j])}: ${r.faultString}`); }
        }
      } catch (err) { failCount += batch.length; errors.push(`Params: ${err.message}`); }
    }

    // 3. Import values (ParamName\ValueName)
    log(`Importowanie ${values.length} wartosci...`);
    for (let i = 0; i < values.length; i += batchSize) {
      const batch = values.slice(i, i + batchSize);
      const items = batch.map(v => {
        const parent = srcParams[v.parameterId];
        const parentNamePl = parent ? getParamNamePl(parent) : '';
        return {
          item_text_ids: v.names.map(n => {
            const pName = parent ? ((parent.names || []).find(pn => pn.languageId === n.languageId)?.value || parentNamePl) : parentNamePl;
            return buildTextId(pName + '\\' + n.value, n.languageId);
          }),
          names: v.names.map(n => ({ lang_id: n.languageId, value: n.value })),
          descriptions: (v.descriptions || []).map(d => ({ lang_id: d.languageId, value: d.value })),
        };
      });
      try {
        const res = await apiRequest('PUT', apiUrl, apiKey, { items });
        for (let j = 0; j < (res.results || []).length; j++) {
          const r = res.results[j];
          if (r.faultCode === 0) successCount++;
          else { failCount++; errors.push(`"${getParamNamePl(batch[j])}": ${r.faultString}`); log(`  [FAIL] ${getParamNamePl(batch[j])}: ${r.faultString}`); }
        }
      } catch (err) { failCount += batch.length; errors.push(`Values: ${err.message}`); }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: SUPPLIERS (DOSTAWCY)
  // =========================================================================

  async function fetchAllSuppliers(domain, apiKey, log) {
    const all = [];
    let page = 0;
    while (true) {
      const url = buildUrl(domain, `/api/admin/v7/wms/suppliers/suppliers?resultsPage=${page}&resultsLimit=100`);
      log(`Pobieranie dostawcow: strona ${page + 1}...`);
      const data = await apiRequest('GET', url, apiKey);
      all.push(...(data.suppliers || []));
      const total = data.resultsNumberAll || 0;
      log(`Pobrano ${all.length} / ${total}`);
      if (all.length >= total) break;
      page++;
    }
    return all;
  }

  async function importSuppliers(domain, apiKey, suppliers, targetNames, log) {
    const toImport = suppliers.filter(s => !targetNames.has(s.name.toLowerCase().trim()));
    if (toImport.length === 0) { log('Brak nowych dostawcow.'); return { imported: 0, failed: 0, errors: [] }; }

    const batchSize = 20;
    let successCount = 0, failCount = 0;
    const errors = [];

    for (let i = 0; i < toImport.length; i += batchSize) {
      const batch = toImport.slice(i, i + batchSize);
      const mapped = batch.map(s => ({
        id: 0,
        name: s.name || '',
        email: s.email || '',
        phone: s.phone || '',
        fax: s.fax || '',
        street: s.street || '',
        zipCode: s.zipCode || '',
        city: s.city || '',
        country: s.country || 1,
        taxCode: s.taxCode || '',
        description: s.description || '',
      }));

      log(`PUT batch ${Math.floor(i / batchSize) + 1}: ${batch.length} dostawcow`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/wms/suppliers/suppliers');
        const res = await apiRequest('PUT', url, apiKey, { params: { suppliers: mapped } });
        for (const r of (res.suppliersResponse || [])) {
          if (r.id && r.id > 0) successCount++;
          else { failCount++; errors.push(`${r.name}: blad`); }
        }
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch: ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: RESPONSIBILITY ENTITIES (Producenci i Osoby odpowiedzialne)
  // =========================================================================

  async function fetchEntities(domain, apiKey, type, log) {
    const all = [];
    let page = 0;
    while (true) {
      const url = buildUrl(domain, `/api/admin/v7/responsibility/entities?type=${type}&resultsPage=${page}&resultsLimit=100`);
      log(`Pobieranie ${type}: strona ${page + 1}...`);
      const data = await apiRequest('GET', url, apiKey);
      all.push(...(data.results || []));
      const total = data.pagination?.resultsNumberAll || 0;
      log(`Pobrano ${all.length} / ${total}`);
      if (all.length >= total) break;
      page++;
    }
    return all;
  }

  async function importEntities(domain, apiKey, entities, type, log) {
    const batchSize = 20;
    let successCount = 0, failCount = 0;
    const errors = [];

    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      const mapped = batch.map(e => ({
        code: e.code,
        name: e.name || '',
        mail: e.mail || '',
        street: e.street || '-',
        number: e.number || '-',
        subnumber: e.subnumber || '',
        zipcode: e.zipcode || '00-000',
        city: e.city || '-',
        country: e.country || 'pl',
        phone: e.phone || '',
        description: e.description || '',
        url: e.url || '',
      }));

      log(`POST batch ${Math.floor(i / batchSize) + 1}: ${batch.length} ${type}s`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/responsibility/entities');
        const res = await apiRequest('POST', url, apiKey, { params: { entities: mapped, type } });
        for (const r of (res.results || [])) {
          if (!r.errors || r.errors.length === 0) {
            successCount++;
          } else {
            // Check if it's a duplicate
            const isDuplicate = r.errors.some(e => e.code === 'DUPLICATE_CODE');
            if (isDuplicate) {
              successCount++; // already exists, that's OK
            } else {
              failCount++;
              errors.push(`${r.code}: ${r.errors.map(e => e.code).join(', ')}`);
              log(`  [FAIL] ${r.code}: ${r.errors.map(e => e.code).join(', ')}`);
            }
          }
        }
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch: ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: SERIES (SERIE)
  // =========================================================================

  async function fetchAllSeries(domain, apiKey, log) {
    const all = [];
    let page = 0;
    while (true) {
      const url = buildUrl(domain, `/api/admin/v7/products/series?resultsPage=${page}&resultsLimit=100&languagesIds=pol`);
      log(`Pobieranie serii: strona ${page + 1}...`);
      const data = await apiRequest('GET', url, apiKey);
      all.push(...(data.series || []));
      const total = data.resultsNumberAll || 0;
      log(`Pobrano ${all.length} / ${total} serii`);
      if (all.length >= total) break;
      page++;
    }
    return all;
  }

  async function importSeries(domain, apiKey, seriesList, targetNamesMap, log) {
    const toImport = seriesList.filter(s => !targetNamesMap.has(s.name.toLowerCase().trim()));
    if (toImport.length === 0) { log('Brak nowych serii.'); return { imported: 0, failed: 0, errors: [] }; }

    const batchSize = 10;
    let successCount = 0, failCount = 0;
    const errors = [];

    for (let i = 0; i < toImport.length; i += batchSize) {
      const batch = toImport.slice(i, i + batchSize);
      const mapped = batch.map(s => ({
        id: 1,
        nameInPanel: s.name,
        shopsConfigurations: (s.lang_data || []).map(ld => ({
          shopId: 1,
          language: ld.lang_id,
          nameOnPage: ld.name || s.name,
          headerName: '',
          description: ld.desc_projector || '',
          descriptionBottom: '',
          view: '',
          enableSort: true,
          enableChangeDisplayCount: true,
        })),
      }));

      log(`PUT batch ${Math.floor(i / batchSize) + 1}: ${batch.map(s => s.name).join(', ').substring(0, 80)}`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/products/series');
        await apiRequest('PUT', url, apiKey, { params: { series: mapped } });
        successCount += batch.length;
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch: ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: CATEGORIES (KATEGORIE)
  // =========================================================================

  async function fetchAllCategories(domain, apiKey, log) {
    const all = [];
    let page = 0;
    while (true) {
      const url = buildUrl(domain, `/api/admin/v7/products/categories?results_page=${page}&results_limit=100&languages=pol`);
      log(`Pobieranie kategorii: strona ${page + 1}...`);
      const data = await apiRequest('GET', url, apiKey);
      all.push(...(data.categories || []));
      const total = data.results_number_all || 0;
      log(`Pobrano ${all.length} / ${total} kategorii`);
      if (all.length >= total) break;
      page++;
    }
    return all;
  }

  function sortCategoriesParentsFirst(categories) {
    const result = [];
    const byParent = new Map();
    for (const c of categories) {
      const pid = c.parent_id || 0;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(c);
    }
    function addLevel(parentId) {
      const children = byParent.get(parentId) || [];
      for (const c of children) {
        result.push(c);
        addLevel(c.id);
      }
    }
    addLevel(0);
    const added = new Set(result.map(c => c.id));
    for (const c of categories) {
      if (!added.has(c.id)) result.push(c);
    }
    return result;
  }

  function getCatNamePl(cat) {
    return ((cat.lang_data || []).find(l => l.lang_id === 'pol') || {}).plural_name || '';
  }

  async function importCategories(domain, apiKey, categories, targetNamesMap, log) {
    const sorted = sortCategoriesParentsFirst(categories);
    const toImport = sorted.filter(c => !targetNamesMap.has(getCatNamePl(c).toLowerCase().trim()));
    if (toImport.length === 0) { log('Brak nowych kategorii.'); return { imported: 0, failed: 0, errors: [] }; }

    const createdNameToId = new Map();
    let successCount = 0, failCount = 0;
    const errors = [];

    for (const cat of toImport) {
      const namePl = getCatNamePl(cat);
      let targetParentId = 0;
      if (cat.parent_id && cat.parent_id !== 0) {
        const parentCat = categories.find(c => c.id === cat.parent_id);
        if (parentCat) {
          const parentName = getCatNamePl(parentCat).toLowerCase().trim();
          targetParentId = targetNamesMap.get(parentName) || createdNameToId.get(parentName) || 0;
        }
      }

      const mapped = {
        id: 0,
        parent_id: targetParentId,
        priority: cat.priority || 1,
        operation: 'add',
        lang_data: (cat.lang_data || []).map(ld => ({
          lang_id: ld.lang_id,
          singular_name: ld.singular_name || '',
          plural_name: ld.plural_name || '',
        })),
      };

      log(`PUT kategoria: "${namePl}" (parent_id=${targetParentId})`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/products/categories');
        const res = await apiRequest('PUT', url, apiKey, { params: { categories: [mapped] } });
        const created = (res.categories || [])[0];
        if (created && created.id) {
          createdNameToId.set(namePl.toLowerCase().trim(), created.id);
        }
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`"${namePl}": ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: WARRANTIES (GWARANCJE)
  // =========================================================================

  async function fetchAllWarranties(domain, apiKey, log) {
    const all = [];
    let page = 0;
    while (true) {
      const url = buildUrl(domain, `/api/admin/v7/warranties/warranties?results_limit=100&results_page=${page}`);
      log(`Pobieranie gwarancji: strona ${page + 1}...`);
      const data = await apiRequest('GET', url, apiKey);
      all.push(...(data.warranties || []));
      const total = data.results_number_all || 0;
      log(`Pobrano ${all.length} / ${total} gwarancji`);
      if (all.length >= total) break;
      page++;
    }
    return all;
  }

  async function importWarranties(domain, apiKey, warranties, targetNamesMap, log) {
    const toImport = warranties.filter(w => !targetNamesMap.has(w.name.toLowerCase().trim()));
    if (toImport.length === 0) { log('Brak nowych gwarancji.'); return { imported: 0, failed: 0, errors: [] }; }

    const batchSize = 10;
    let successCount = 0, failCount = 0;
    const errors = [];

    for (let i = 0; i < toImport.length; i += batchSize) {
      const batch = toImport.slice(i, i + batchSize);
      const mapped = batch.map(w => ({
        id: 'new_id',
        name: w.name,
        type: w.type || 'producer',
        period: w.period || 0,
      }));

      log(`PUT batch ${Math.floor(i / batchSize) + 1}: ${batch.map(w => w.name).join(', ').substring(0, 80)}`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/warranties/warranties');
        await apiRequest('PUT', url, apiKey, { params: { warranties: mapped } });
        successCount += batch.length;
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch: ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE: SIZE CHARTS (TABELE ROZMIAROW)
  // =========================================================================

  async function fetchAllSizeCharts(domain, apiKey, log) {
    const url = buildUrl(domain, '/api/admin/v7/sizecharts/sizecharts?resultsLimit=100');
    log('Pobieranie tabel rozmiarow...');
    const data = await apiRequest('GET', url, apiKey);
    const charts = data.sizeCharts || {};
    const result = [];
    for (const [id, chart] of Object.entries(charts)) {
      result.push({ id, ...chart });
    }
    log(`Pobrano ${result.length} tabel rozmiarow`);
    return result;
  }

  function getSizeChartName(chart) {
    if (chart.nameInPanel) return chart.nameInPanel;
    const ld = (chart.languagesData || [])[0];
    if (ld && ld.columns) {
      const cols = Object.values(ld.columns);
      if (cols.length > 0) return cols[0].columnTitle || ('Chart ' + chart.id);
    }
    return 'Chart ' + chart.id;
  }

  async function importSizeCharts(domain, apiKey, charts, targetNamesSet, log) {
    const toImport = charts.filter(c => !targetNamesSet.has(getSizeChartName(c).toLowerCase().trim()));
    if (toImport.length === 0) { log('Brak nowych tabel rozmiarow.'); return { imported: 0, failed: 0, errors: [] }; }

    let successCount = 0, failCount = 0;
    const errors = [];

    for (const chart of toImport) {
      const name = getSizeChartName(chart);
      const languagesData = (chart.languagesData || []).map(ld => {
        const columns = Object.values(ld.columns || {}).map(col => ({
          columnNumber: col.columnNumber,
          columnTitle: col.columnTitle || '',
        }));
        const sizes = Object.values(ld.sizes || {}).map(sz => ({
          sizeId: String(sz.sizeId),
          priority: sz.priority || 1,
          descriptions: Object.values(sz.descriptions || {}).map(d => ({
            columnNumber: d.columnNumber,
            value: d.value || '',
          })),
        }));
        return { language: ld.language || 'pol', columns, sizes };
      });

      const mapped = {
        id: 1,
        nameInPanel: name,
        displayMode: 'single',
        languagesData,
      };

      log(`PUT tabela: "${name}"`);
      try {
        const url = buildUrl(domain, '/api/admin/v7/sizecharts/sizecharts');
        await apiRequest('PUT', url, apiKey, { params: { sizeCharts: [mapped] } });
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`"${name}": ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }
    }

    return { imported: successCount, failed: failCount, errors };
  }

  // =========================================================================
  // MODULE REGISTRY
  // =========================================================================

  const MODULES = [
    {
      id: 'brands',
      label: 'Marki (Brands / Producers)',
      icon: '\uD83C\uDFF7\uFE0F',
      run: async (cfg, log) => {
        log('--- Start migracji marek ---');

        log('Pobieranie marek ze zrodla...');
        const producers = await fetchAllBrands(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${producers.length} marek ze zrodla.`);

        log('Pobieranie marek z panelu docelowego (do mapowania ID)...');
        const targetBrands = await fetchAllBrands(cfg.targetDomain, cfg.targetApiKey, log);
        const targetBrandsMap = new Map();
        for (const b of targetBrands) {
          targetBrandsMap.set(b.name.toLowerCase().trim(), b.id);
        }
        log(`Panel docelowy ma ${targetBrands.length} marek.`);

        const result = await importBrands(cfg.targetDomain, cfg.targetApiKey, producers, targetBrandsMap, log);
        log(`--- Zakonczono: ${result.imported} OK, ${result.failed} bledow ---`);
        if (result.errors.length > 0) {
          log('Szczegoly bledow:\n' + result.errors.join('\n'));
        }

        // Weryfikacja: porownanie danych zrodlo vs cel
        log('--- Weryfikacja po imporcie ---');
        const sourceList = producers.filter(p => p.id !== 0);
        const afterImport = await fetchAllBrands(cfg.targetDomain, cfg.targetApiKey, log);
        const afterMap = new Map();
        for (const b of afterImport) {
          afterMap.set(b.name.toLowerCase().trim(), b);
        }

        let matchCount = 0;
        const mismatches = [];
        const missing = [];

        for (const src of sourceList) {
          const key = src.name.toLowerCase().trim();
          const tgt = afterMap.get(key);
          if (!tgt) {
            missing.push(src.name);
            continue;
          }
          let brandOk = true;
          for (const srcLang of (src.lang_data || [])) {
            const tgtLang = (tgt.lang_data || []).find(l => l.lang_id === srcLang.lang_id);
            if (!tgtLang) {
              mismatches.push(`${src.name} [${srcLang.lang_id}]: brak jezyka w celu`);
              brandOk = false;
              continue;
            }
            const srcText = (srcLang.text || '').trim();
            const tgtText = (tgtLang.text || '').trim();
            if (srcText !== tgtText) {
              mismatches.push(`${src.name} [${srcLang.lang_id}]: opis rozni sie (zrodlo: ${srcText.length} zn, cel: ${tgtText.length} zn)`);
              brandOk = false;
            }
          }
          if (brandOk) matchCount++;
        }

        const totalIssues = mismatches.length + missing.length;
        log(`Weryfikacja: ${matchCount} zgodnych, ${mismatches.length} roznic, ${missing.length} brakujacych`);
        if (missing.length > 0) log(`Brakujace: ${missing.join(', ')}`);
        if (mismatches.length > 0) {
          log(`Roznice (max 20):\n${mismatches.slice(0, 20).join('\n')}`);
          if (mismatches.length > 20) log(`...i ${mismatches.length - 20} wiecej`);
        }
        if (matchCount === sourceList.length) log('Wszystkie marki zgodne 1:1!');

        // Return validation result for UI badge
        return { ok: totalIssues === 0, matchCount, total: sourceList.length, issues: [...missing.map(m => `BRAK: ${m}`), ...mismatches] };
      },
    },
    {
      id: 'sizes',
      label: 'Rozmiary (grupy + definicje)',
      icon: '\uD83D\uDCCF',
      run: async (cfg, log) => {
        log('--- Start migracji rozmiarow ---');

        // 1. Fetch source and target size groups
        const srcGroups = await fetchSizeGroups(cfg.sourceDomain, cfg.sourceApiKey, log);
        const tgtGroups = await fetchSizeGroups(cfg.targetDomain, cfg.targetApiKey, log);

        const srcGroupMap = new Map(srcGroups.map(g => [g.group_id, g]));
        const tgtGroupMap = new Map(tgtGroups.map(g => [g.group_id, g]));
        const tgtGroupByName = new Map(tgtGroups.map(g => [g.group_name.toLowerCase().trim(), g]));

        log(`Zrodlo: ${srcGroups.length} grup, Cel: ${tgtGroups.length} grup`);

        // 2. Find missing groups and try to create them
        const missingGroups = srcGroups.filter(g => g.group_id >= 0 && !tgtGroupMap.has(g.group_id) && !tgtGroupByName.has(g.group_name.toLowerCase().trim()));
        const createdGroups = [];
        const failedGroups = [];

        if (missingGroups.length > 0) {
          log(`Brakujace grupy: ${missingGroups.map(g => `"${g.group_name}" (${g.group_id})`).join(', ')}`);
          log('Probuje utworzyc brakujace grupy przez panel...');

          for (const mg of missingGroups) {
            log(`  Tworzenie grupy "${mg.group_name}"...`);
            const result = await createSizeGroupViaPanel(mg.group_name, log);
            if (result.ok) {
              createdGroups.push(mg);
            } else {
              failedGroups.push(mg);
              log(`  [FAIL] Nie udalo sie utworzyc grupy "${mg.group_name}" - musisz ja utworzyc recznie w panelu`);
            }
          }

          if (createdGroups.length > 0) {
            log(`Utworzono ${createdGroups.length} grup. Odswiezam dane...`);
          }
        }

        // 3. Re-fetch target groups after creation
        const tgtGroupsAfter = await fetchSizeGroups(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtAfterByName = new Map(tgtGroupsAfter.map(g => [g.group_name.toLowerCase().trim(), g]));
        const tgtAfterById = new Map(tgtGroupsAfter.map(g => [g.group_id, g]));

        // 4. Map source group_id -> target group_id (by name first, then by id)
        const groupIdMapping = new Map();
        for (const sg of srcGroups) {
          if (sg.group_id < 0) {
            groupIdMapping.set(sg.group_id, sg.group_id); // universal group
            continue;
          }
          // Always prefer name-based mapping (IDs differ between panels)
          const tgtByName = tgtAfterByName.get(sg.group_name.toLowerCase().trim());
          if (tgtByName) {
            groupIdMapping.set(sg.group_id, tgtByName.group_id);
            if (sg.group_id !== tgtByName.group_id) {
              log(`  Mapowanie: "${sg.group_name}" src:${sg.group_id} -> tgt:${tgtByName.group_id}`);
            }
          } else if (tgtAfterById.has(sg.group_id)) {
            groupIdMapping.set(sg.group_id, sg.group_id);
          }
        }

        // 5. Build global map of all existing sizes in target (across all groups)
        const allTargetSizes = new Map(); // size_name_lower -> { size_id, group_id }
        for (const g of tgtGroupsAfter) {
          for (const s of (g.sizes || [])) {
            allTargetSizes.set(s.size_name.toLowerCase().trim(), { size_id: s.size_id, group_id: g.group_id });
          }
        }

        const sizesToImport = [];
        const unmappedGroups = [];
        let skippedExisting = 0;

        for (const sg of srcGroups) {
          if (sg.group_id < 0) continue; // skip universal

          const targetGroupId = groupIdMapping.get(sg.group_id);
          if (!targetGroupId) {
            unmappedGroups.push(sg.group_name);
            continue;
          }

          for (const size of sg.sizes) {
            const key = size.size_name.toLowerCase().trim();
            const existing = allTargetSizes.get(key);

            if (existing && existing.group_id === targetGroupId) {
              // Exists in correct group — edit with its ID
              sizesToImport.push({
                group_id: targetGroupId,
                id: existing.size_id,
                name: size.size_name,
                description: '',
                operation: 'edit',
                lang_data: (size.lang_data || []).map(ld => ({ lang_id: ld.lang_id, name: ld.name })),
              });
            } else if (existing) {
              // Exists in wrong group — skip (can't add duplicate name)
              skippedExisting++;
            } else {
              // New size — add
              sizesToImport.push({
                group_id: targetGroupId,
                name: size.size_name,
                description: '',
                operation: 'add',
                lang_data: (size.lang_data || []).map(ld => ({ lang_id: ld.lang_id, name: ld.name })),
              });
            }
          }
        }

        if (skippedExisting > 0) {
          log(`Pominieto ${skippedExisting} rozmiarow (istnieja w innych grupach z poprzedniego importu)`);
        }

        if (unmappedGroups.length > 0) {
          log(`Grupy bez mapowania (pominiete): ${unmappedGroups.join(', ')}`);
        }

        log(`Rozmiarow do importu: ${sizesToImport.length}`);

        // 6. Import sizes
        if (sizesToImport.length > 0) {
          const result = await importSizeDefinitions(cfg.targetDomain, cfg.targetApiKey, sizesToImport, log);
          log(`Import: ${result.imported} OK, ${result.failed} bledow`);
          if (result.errors.length > 0) {
            log('Bledy:\n' + result.errors.slice(0, 20).join('\n'));
          }
        }

        // 7. Weryfikacja
        log('--- Weryfikacja ---');
        const finalGroups = await fetchSizeGroups(cfg.targetDomain, cfg.targetApiKey, log);
        const finalByName = new Map(finalGroups.map(g => [g.group_name.toLowerCase().trim(), g]));

        let matchCount = 0;
        const issues = [];

        for (const sg of srcGroups) {
          if (sg.group_id < 0) continue;
          const tg = finalByName.get(sg.group_name.toLowerCase().trim());
          if (!tg) {
            issues.push(`Grupa "${sg.group_name}": brak w celu`);
            continue;
          }
          const srcSizeNames = new Set(sg.sizes.map(s => s.size_name.toLowerCase().trim()));
          const tgtSizeNames = new Set(tg.sizes.map(s => s.size_name.toLowerCase().trim()));
          const missingSizes = [...srcSizeNames].filter(n => !tgtSizeNames.has(n));
          if (missingSizes.length > 0) {
            issues.push(`Grupa "${sg.group_name}" (src:${sg.group_id}->tgt:${tg.group_id}): brak ${missingSizes.length} rozmiarow: ${missingSizes.join(', ')}`);
          } else {
            matchCount++;
          }
        }

        const totalGroups = srcGroups.filter(g => g.group_id >= 0).length;
        log(`Weryfikacja: ${matchCount}/${totalGroups} grup zgodnych`);
        if (issues.length > 0) log(`Problemy:\n${issues.join('\n')}`);
        if (matchCount === totalGroups) log('Wszystkie grupy i rozmiary zgodne!');

        return { ok: issues.length === 0, matchCount, total: totalGroups, issues };
      },
    },
    {
      id: 'parameters',
      label: 'Parametry (Parameters)',
      icon: '\u2699\uFE0F',
      run: async (cfg, log) => {
        log('--- Start migracji parametrow ---');

        const srcParams = await fetchAllParameters(cfg.sourceDomain, cfg.sourceApiKey, log);
        const srcItems = Object.values(srcParams);
        const params = srcItems.filter(i => i.type === 'parameter');
        const vals = srcItems.filter(i => i.type === 'value');
        const sects = srcItems.filter(i => i.type === 'section');
        log(`Zrodlo: ${sects.length} sekcji, ${params.length} parametrow, ${vals.length} wartosci`);

        const result = await importParameters(cfg.targetDomain, cfg.targetApiKey, srcParams, log);
        log(`--- Zakonczono: ${result.imported} OK, ${result.failed} bledow ---`);
        if (result.errors.length > 0) {
          log('Bledy:\n' + result.errors.slice(0, 20).join('\n'));
        }

        // Weryfikacja
        log('--- Weryfikacja ---');
        const tgtParams = await fetchAllParameters(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtNames = new Set(Object.values(tgtParams).map(p => getParamNamePl(p).toLowerCase().trim()));
        const srcNames = srcItems.filter(i => i.type !== 'section').map(i => getParamNamePl(i));

        let matchCount = 0;
        const issues = [];
        for (const name of srcNames) {
          if (tgtNames.has(name.toLowerCase().trim())) {
            matchCount++;
          } else {
            issues.push(`Brak: "${name}"`);
          }
        }

        log(`Weryfikacja: ${matchCount}/${srcNames.length} elementow zgodnych`);
        if (issues.length > 0) log(`Problemy:\n${issues.join('\n')}`);
        if (matchCount === srcNames.length) log('Wszystkie parametry zgodne!');

        return { ok: issues.length === 0, matchCount, total: srcNames.length, issues };
      },
    },
    {
      id: 'entities',
      label: 'Producenci i Osoby odpowiedzialne',
      icon: '\uD83C\uDFED',
      run: async (cfg, log) => {
        log('--- Start migracji producentow i osob odpowiedzialnych ---');
        const issues = [];
        let totalMatch = 0, totalItems = 0;

        for (const type of ['producer', 'person']) {
          log(`\n=== ${type === 'producer' ? 'Producenci' : 'Osoby odpowiedzialne'} ===`);
          const srcEntities = await fetchEntities(cfg.sourceDomain, cfg.sourceApiKey, type, log);
          log(`Pobrano ${srcEntities.length} ${type}s ze zrodla.`);

          if (srcEntities.length === 0) { log('Brak danych.'); continue; }

          const result = await importEntities(cfg.targetDomain, cfg.targetApiKey, srcEntities, type, log);
          log(`Import: ${result.imported} OK, ${result.failed} bledow`);
          if (result.errors.length > 0) log('Bledy:\n' + result.errors.slice(0, 10).join('\n'));

          // Weryfikacja
          const tgtEntities = await fetchEntities(cfg.targetDomain, cfg.targetApiKey, type, log);
          const tgtCodes = new Set(tgtEntities.map(e => e.code.toLowerCase().trim()));
          for (const src of srcEntities) {
            totalItems++;
            if (tgtCodes.has(src.code.toLowerCase().trim())) {
              totalMatch++;
            } else {
              issues.push(`[${type}] "${src.code}": brak w celu`);
            }
          }
        }

        log(`\n--- Weryfikacja: ${totalMatch}/${totalItems} zgodnych ---`);
        if (issues.length > 0) log('Problemy:\n' + issues.join('\n'));
        if (totalMatch === totalItems) log('Wszystkie podmioty przeniesione!');

        return { ok: issues.length === 0, matchCount: totalMatch, total: totalItems, issues };
      },
    },
    {
      id: 'suppliers',
      label: 'Dostawcy (Suppliers)',
      icon: '\uD83D\uDE9A',
      run: async (cfg, log) => {
        log('--- Start migracji dostawcow ---');

        const srcSuppliers = await fetchAllSuppliers(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${srcSuppliers.length} dostawcow ze zrodla.`);

        if (srcSuppliers.length === 0) {
          log('Brak dostawcow w zrodle.');
          return { ok: true, matchCount: 0, total: 0, issues: [] };
        }

        const tgtSuppliers = await fetchAllSuppliers(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtNames = new Set(tgtSuppliers.map(s => s.name.toLowerCase().trim()));
        log(`Panel docelowy: ${tgtSuppliers.length} dostawcow, nowych do importu: ${srcSuppliers.filter(s => !tgtNames.has(s.name.toLowerCase().trim())).length}`);

        const result = await importSuppliers(cfg.targetDomain, cfg.targetApiKey, srcSuppliers, tgtNames, log);
        log(`Import: ${result.imported} OK, ${result.failed} bledow`);
        if (result.errors.length > 0) log('Bledy:\n' + result.errors.join('\n'));

        // Weryfikacja
        log('--- Weryfikacja ---');
        const afterImport = await fetchAllSuppliers(cfg.targetDomain, cfg.targetApiKey, log);
        const afterNames = new Set(afterImport.map(s => s.name.toLowerCase().trim()));
        let matchCount = 0;
        const issues = [];
        for (const s of srcSuppliers) {
          if (afterNames.has(s.name.toLowerCase().trim())) matchCount++;
          else issues.push(`Brak: "${s.name}"`);
        }

        log(`Weryfikacja: ${matchCount}/${srcSuppliers.length} dostawcow`);
        if (matchCount === srcSuppliers.length) log('Wszystko OK!');

        return { ok: issues.length === 0, matchCount, total: srcSuppliers.length, issues };
      },
    },
    {
      id: 'series',
      label: 'Serie (Series)',
      icon: '\uD83D\uDCDA',
      run: async (cfg, log) => {
        log('--- Start migracji serii ---');

        const srcSeries = await fetchAllSeries(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${srcSeries.length} serii ze zrodla.`);

        if (srcSeries.length === 0) {
          log('Brak serii w zrodle.');
          return { ok: true, matchCount: 0, total: 0, issues: [] };
        }

        const tgtSeries = await fetchAllSeries(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtNamesMap = new Map(tgtSeries.map(s => [s.name.toLowerCase().trim(), s.id]));
        log(`Panel docelowy: ${tgtSeries.length} serii, nowych: ${srcSeries.filter(s => !tgtNamesMap.has(s.name.toLowerCase().trim())).length}`);

        const result = await importSeries(cfg.targetDomain, cfg.targetApiKey, srcSeries, tgtNamesMap, log);
        log(`Import: ${result.imported} OK, ${result.failed} bledow`);
        if (result.errors.length > 0) log('Bledy:\n' + result.errors.join('\n'));

        // Weryfikacja
        log('--- Weryfikacja ---');
        const afterImport = await fetchAllSeries(cfg.targetDomain, cfg.targetApiKey, log);
        const afterNames = new Set(afterImport.map(s => s.name.toLowerCase().trim()));
        let matchCount = 0;
        const issues = [];
        for (const s of srcSeries) {
          if (afterNames.has(s.name.toLowerCase().trim())) matchCount++;
          else issues.push(`Brak: "${s.name}"`);
        }

        log(`Weryfikacja: ${matchCount}/${srcSeries.length} serii`);
        if (matchCount === srcSeries.length) log('Wszystkie serie przeniesione!');

        return { ok: issues.length === 0, matchCount, total: srcSeries.length, issues };
      },
    },
    {
      id: 'categories',
      label: 'Kategorie (Categories)',
      icon: '\uD83D\uDCC2',
      run: async (cfg, log) => {
        log('--- Start migracji kategorii ---');

        const srcCategories = await fetchAllCategories(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${srcCategories.length} kategorii ze zrodla.`);

        if (srcCategories.length === 0) {
          log('Brak kategorii w zrodle.');
          return { ok: true, matchCount: 0, total: 0, issues: [] };
        }

        const tgtCategories = await fetchAllCategories(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtNamesMap = new Map();
        for (const c of tgtCategories) {
          const name = getCatNamePl(c).toLowerCase().trim();
          if (name) tgtNamesMap.set(name, c.id);
        }
        const newCount = srcCategories.filter(c => !tgtNamesMap.has(getCatNamePl(c).toLowerCase().trim())).length;
        log(`Panel docelowy: ${tgtCategories.length} kategorii, nowych: ${newCount}`);

        const result = await importCategories(cfg.targetDomain, cfg.targetApiKey, srcCategories, tgtNamesMap, log);
        log(`Import: ${result.imported} OK, ${result.failed} bledow`);
        if (result.errors.length > 0) log('Bledy:\n' + result.errors.slice(0, 20).join('\n'));

        // Weryfikacja
        log('--- Weryfikacja ---');
        const afterImport = await fetchAllCategories(cfg.targetDomain, cfg.targetApiKey, log);
        const afterNames = new Set(afterImport.map(c => getCatNamePl(c).toLowerCase().trim()).filter(n => n));
        let matchCount = 0;
        const issues = [];
        for (const c of srcCategories) {
          const name = getCatNamePl(c);
          if (!name) continue;
          if (afterNames.has(name.toLowerCase().trim())) matchCount++;
          else issues.push(`Brak: "${name}"`);
        }

        const totalSrc = srcCategories.filter(c => getCatNamePl(c)).length;
        log(`Weryfikacja: ${matchCount}/${totalSrc} kategorii`);
        if (matchCount === totalSrc) log('Wszystkie kategorie przeniesione!');

        return { ok: issues.length === 0, matchCount, total: totalSrc, issues };
      },
    },
    {
      id: 'warranties',
      label: 'Gwarancje (Warranties)',
      icon: '\uD83D\uDEE1\uFE0F',
      run: async (cfg, log) => {
        log('--- Start migracji gwarancji ---');

        const srcWarranties = await fetchAllWarranties(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${srcWarranties.length} gwarancji ze zrodla.`);

        if (srcWarranties.length === 0) {
          log('Brak gwarancji w zrodle.');
          return { ok: true, matchCount: 0, total: 0, issues: [] };
        }

        const tgtWarranties = await fetchAllWarranties(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtNamesMap = new Map(tgtWarranties.map(w => [w.name.toLowerCase().trim(), w.id]));
        log(`Panel docelowy: ${tgtWarranties.length} gwarancji, nowych: ${srcWarranties.filter(w => !tgtNamesMap.has(w.name.toLowerCase().trim())).length}`);

        const result = await importWarranties(cfg.targetDomain, cfg.targetApiKey, srcWarranties, tgtNamesMap, log);
        log(`Import: ${result.imported} OK, ${result.failed} bledow`);
        if (result.errors.length > 0) log('Bledy:\n' + result.errors.join('\n'));

        // Weryfikacja
        log('--- Weryfikacja ---');
        const afterImport = await fetchAllWarranties(cfg.targetDomain, cfg.targetApiKey, log);
        const afterNames = new Set(afterImport.map(w => w.name.toLowerCase().trim()));
        let matchCount = 0;
        const issues = [];
        for (const w of srcWarranties) {
          if (afterNames.has(w.name.toLowerCase().trim())) matchCount++;
          else issues.push(`Brak: "${w.name}"`);
        }

        log(`Weryfikacja: ${matchCount}/${srcWarranties.length} gwarancji`);
        if (matchCount === srcWarranties.length) log('Wszystkie gwarancje przeniesione!');

        return { ok: issues.length === 0, matchCount, total: srcWarranties.length, issues };
      },
    },
    {
      id: 'sizecharts',
      label: 'Tabele rozmiarow (Size Charts)',
      icon: '\uD83D\uDCCA',
      run: async (cfg, log) => {
        log('--- Start migracji tabel rozmiarow ---');

        const srcCharts = await fetchAllSizeCharts(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${srcCharts.length} tabel ze zrodla.`);

        if (srcCharts.length === 0) {
          log('Brak tabel rozmiarow w zrodle.');
          return { ok: true, matchCount: 0, total: 0, issues: [] };
        }

        const tgtCharts = await fetchAllSizeCharts(cfg.targetDomain, cfg.targetApiKey, log);
        const tgtNamesSet = new Set(tgtCharts.map(c => getSizeChartName(c).toLowerCase().trim()));
        log(`Panel docelowy: ${tgtCharts.length} tabel, nowych: ${srcCharts.filter(c => !tgtNamesSet.has(getSizeChartName(c).toLowerCase().trim())).length}`);

        const result = await importSizeCharts(cfg.targetDomain, cfg.targetApiKey, srcCharts, tgtNamesSet, log);
        log(`Import: ${result.imported} OK, ${result.failed} bledow`);
        if (result.errors.length > 0) log('Bledy:\n' + result.errors.join('\n'));

        // Weryfikacja
        log('--- Weryfikacja ---');
        const afterImport = await fetchAllSizeCharts(cfg.targetDomain, cfg.targetApiKey, log);
        const afterNames = new Set(afterImport.map(c => getSizeChartName(c).toLowerCase().trim()));
        let matchCount = 0;
        const issues = [];
        for (const c of srcCharts) {
          const name = getSizeChartName(c);
          if (afterNames.has(name.toLowerCase().trim())) matchCount++;
          else issues.push(`Brak: "${name}"`);
        }

        log(`Weryfikacja: ${matchCount}/${srcCharts.length} tabel`);
        if (matchCount === srcCharts.length) log('Wszystkie tabele rozmiarow przeniesione!');

        return { ok: issues.length === 0, matchCount, total: srcCharts.length, issues };
      },
    },
  ];

  // =========================================================================
  // UI
  // =========================================================================

  function createUI() {
    const cfg = loadConfig();

    // Floating trigger button
    const trigger = document.createElement('div');
    trigger.textContent = '\u21C4';
    Object.assign(trigger.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
      width: '48px', height: '48px', borderRadius: '50%',
      background: '#2563eb', color: '#fff', fontSize: '22px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'transform 0.2s',
    });
    trigger.id = 'migrator-trigger';
    trigger.title = 'IdoSell Panel Migrator';
    trigger.addEventListener('mouseenter', () => trigger.style.transform = 'scale(1.1)');
    trigger.addEventListener('mouseleave', () => trigger.style.transform = 'scale(1)');
    document.body.appendChild(trigger);

    // Modal overlay
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '1000000',
      background: 'rgba(0,0,0,0.5)', display: 'none',
      alignItems: 'center', justifyContent: 'center',
    });
    document.body.appendChild(overlay);

    // Modal
    const modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#fff', borderRadius: '12px', padding: '24px',
      width: '560px', maxHeight: '85vh', overflowY: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px', color: '#1e293b',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    });
    overlay.appendChild(modal);

    const css = `
      .migrator-label { display: block; font-weight: 600; margin: 12px 0 4px; color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
      .migrator-input { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; box-sizing: border-box; outline: none; transition: border 0.2s; }
      .migrator-input:focus { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
      .migrator-section { background: #f8fafc; border-radius: 8px; padding: 14px; margin: 12px 0; border: 1px solid #e2e8f0; }
      .migrator-btn { padding: 10px 20px; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
      .migrator-btn-primary { background: #2563eb; color: #fff; }
      .migrator-btn-primary:hover { background: #1d4ed8; }
      .migrator-btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
      .migrator-btn-secondary { background: #e2e8f0; color: #475569; }
      .migrator-btn-secondary:hover { background: #cbd5e1; }
      .migrator-checkbox { display: flex; align-items: center; gap: 8px; padding: 8px 0; cursor: pointer; }
      .migrator-checkbox input { width: 16px; height: 16px; accent-color: #2563eb; cursor: pointer; }
      .migrator-checkbox .migrator-badge { margin-left: auto; font-size: 12px; padding: 2px 8px; border-radius: 10px; cursor: pointer; font-weight: 600; }
      .migrator-badge-ok { background: #dcfce7; color: #166534; }
      .migrator-badge-fail { background: #fee2e2; color: #991b1b; }
      .migrator-log { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; max-height: 250px; overflow-y: auto; white-space: pre-wrap; margin-top: 12px; line-height: 1.6; }
      .migrator-issues-popup { position: fixed; inset: 0; z-index: 1000001; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; }
      .migrator-issues-inner { background: #fff; border-radius: 10px; padding: 20px; width: 480px; max-height: 70vh; overflow-y: auto; font-size: 13px; }
      .migrator-issues-inner h3 { margin: 0 0 12px; font-size: 15px; }
      .migrator-issues-inner ul { margin: 0; padding: 0 0 0 18px; }
      .migrator-issues-inner li { padding: 3px 0; color: #991b1b; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    modal.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <h2 style="margin:0; font-size:18px; color:#0f172a;">\u21C4 IdoSell Panel Migrator</h2>
        <span id="migrator-close" style="cursor:pointer; font-size:22px; color:#94a3b8; line-height:1;">&times;</span>
      </div>

      <div class="migrator-section">
        <div style="font-weight:600; margin-bottom:8px; color:#2563eb;">Panel zrodlowy (FROM)</div>
        <label class="migrator-label">Domena</label>
        <input class="migrator-input" id="m-src-domain" placeholder="np. dermafiller.iai-shop.com" value="${cfg.sourceDomain}">
        <label class="migrator-label">API Key</label>
        <input class="migrator-input" id="m-src-key" type="password" placeholder="X-API-KEY" value="${cfg.sourceApiKey}">
      </div>

      <div class="migrator-section">
        <div style="font-weight:600; margin-bottom:8px; color:#16a34a;">Panel docelowy (TO)</div>
        <label class="migrator-label">Domena</label>
        <input class="migrator-input" id="m-tgt-domain" placeholder="np. shop58058-1.iai-shop.com" value="${cfg.targetDomain}">
        <label class="migrator-label">API Key</label>
        <input class="migrator-input" id="m-tgt-key" type="password" placeholder="X-API-KEY" value="${cfg.targetApiKey}">
      </div>

      <div class="migrator-section">
        <div style="font-weight:600; margin-bottom:8px; color:#7c3aed;">Co przenosimy?</div>
        <div id="m-modules"></div>
      </div>

      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px;">
        <button class="migrator-btn migrator-btn-secondary" id="m-save-btn">Zapisz config</button>
        <button class="migrator-btn migrator-btn-primary" id="m-run-btn">Uruchom migracje</button>
      </div>

      <div id="m-log-container" style="display:none;">
        <div class="migrator-log" id="m-log"></div>
      </div>
    `;

    // Render module checkboxes
    const modulesContainer = modal.querySelector('#m-modules');
    const badgeRefs = {};
    MODULES.forEach(mod => {
      const label = document.createElement('label');
      label.className = 'migrator-checkbox';
      label.innerHTML = `<input type="checkbox" data-module="${mod.id}"> <span>${mod.icon} ${mod.label}</span><span class="migrator-badge" id="badge-${mod.id}" style="display:none;"></span>`;
      modulesContainer.appendChild(label);
      badgeRefs[mod.id] = label.querySelector(`#badge-${mod.id}`);
    });

    function showIssuesPopup(title, issues) {
      const popup = document.createElement('div');
      popup.className = 'migrator-issues-popup';
      const inner = document.createElement('div');
      inner.className = 'migrator-issues-inner';
      inner.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><h3>${title}</h3><span style="cursor:pointer;font-size:20px;color:#94a3b8;" id="close-issues">&times;</span></div>`;
      const ul = document.createElement('ul');
      issues.forEach(issue => {
        const li = document.createElement('li');
        li.textContent = issue;
        ul.appendChild(li);
      });
      inner.appendChild(ul);
      popup.appendChild(inner);
      document.body.appendChild(popup);
      inner.querySelector('#close-issues').addEventListener('click', () => popup.remove());
      popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
    }

    function setBadge(modId, validationResult) {
      const badge = badgeRefs[modId];
      if (!badge || !validationResult) return;
      badge.style.display = 'inline-block';
      if (validationResult.ok) {
        badge.className = 'migrator-badge migrator-badge-ok';
        badge.textContent = `${validationResult.matchCount}/${validationResult.total}`;
        badge.title = 'Weryfikacja OK - kliknij po szczegoly';
        badge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showIssuesPopup(`${modId} - weryfikacja OK`, [`Zgodne: ${validationResult.matchCount}/${validationResult.total}`]); };
      } else {
        badge.className = 'migrator-badge migrator-badge-fail';
        badge.textContent = `${validationResult.issues.length} problem(ow)`;
        badge.title = 'Bledy walidacji - kliknij po szczegoly';
        badge.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showIssuesPopup(`${modId} - problemy walidacji`, validationResult.issues); };
      }
    }

    // Events
    const open = () => { overlay.style.display = 'flex'; };
    const close = () => { overlay.style.display = 'none'; };

    trigger.addEventListener('click', open);
    modal.querySelector('#migrator-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    modal.querySelector('#m-save-btn').addEventListener('click', () => {
      const newCfg = {
        sourceDomain: modal.querySelector('#m-src-domain').value.trim(),
        sourceApiKey: modal.querySelector('#m-src-key').value.trim(),
        targetDomain: modal.querySelector('#m-tgt-domain').value.trim(),
        targetApiKey: modal.querySelector('#m-tgt-key').value.trim(),
      };
      saveConfig(newCfg);
      alert('Konfiguracja zapisana!');
    });

    modal.querySelector('#m-run-btn').addEventListener('click', async () => {
      const currentCfg = {
        sourceDomain: modal.querySelector('#m-src-domain').value.trim(),
        sourceApiKey: modal.querySelector('#m-src-key').value.trim(),
        targetDomain: modal.querySelector('#m-tgt-domain').value.trim(),
        targetApiKey: modal.querySelector('#m-tgt-key').value.trim(),
      };

      if (!currentCfg.sourceDomain || !currentCfg.sourceApiKey) {
        alert('Uzupelnij dane panelu zrodlowego!');
        return;
      }
      if (!currentCfg.targetDomain || !currentCfg.targetApiKey) {
        alert('Uzupelnij dane panelu docelowego!');
        return;
      }

      const selected = [...modal.querySelectorAll('#m-modules input:checked')]
        .map(cb => cb.dataset.module);

      if (selected.length === 0) {
        alert('Wybierz co chcesz przenosisc!');
        return;
      }

      // Save config automatically
      saveConfig(currentCfg);

      const logEl = modal.querySelector('#m-log');
      const logContainer = modal.querySelector('#m-log-container');
      logContainer.style.display = 'block';
      logEl.textContent = '';

      const runBtn = modal.querySelector('#m-run-btn');
      runBtn.disabled = true;
      runBtn.textContent = 'Trwa migracja...';

      const log = (msg) => {
        const ts = new Date().toLocaleTimeString('pl-PL');
        logEl.textContent += `[${ts}] ${msg}\n`;
        logEl.scrollTop = logEl.scrollHeight;
      };

      for (const modId of selected) {
        const mod = MODULES.find(m => m.id === modId);
        if (!mod) continue;
        try {
          const validationResult = await mod.run(currentCfg, log);
          setBadge(mod.id, validationResult);
        } catch (err) {
          log(`BLAD w module ${mod.label}: ${err.message}`);
          setBadge(mod.id, { ok: false, matchCount: 0, total: 0, issues: [`Blad: ${err.message}`] });
        }
      }

      log('=== Migracja zakonczona ===');
      runBtn.disabled = false;
      runBtn.textContent = 'Uruchom migracje';
    });
  }

  // =========================================================================
  // INIT
  // =========================================================================

  if (document.getElementById('migrator-trigger')) return; // already initialized

  if (document.readyState === 'complete') {
    createUI();
  } else {
    window.addEventListener('load', createUI);
  }

})();
