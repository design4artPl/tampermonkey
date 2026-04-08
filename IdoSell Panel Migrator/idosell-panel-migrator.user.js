// ==UserScript==
// @name         IdoSell - Panel Migrator
// @namespace    https://idosell.com/
// @version      1.6.0
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

  // Create size group by submitting a form into a hidden iframe.
  // This mimics exactly what the panel does: POST to /panel/sizes-group.php?
  // with fields name={groupName}&parent=0, targeting an iframe.
  function createSizeGroupViaPanel(groupName, log) {
    return new Promise((resolve) => {
      const frameName = 'migrator_sizegroup_' + Date.now();

      // Create hidden iframe as form target
      const iframe = document.createElement('iframe');
      iframe.name = frameName;
      iframe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;';
      document.body.appendChild(iframe);

      // Create form targeting the hidden iframe
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/panel/sizes-group.php?';
      form.target = frameName;

      const nameInput = document.createElement('input');
      nameInput.type = 'hidden';
      nameInput.name = 'name';
      nameInput.value = groupName;
      form.appendChild(nameInput);

      const parentInput = document.createElement('input');
      parentInput.type = 'hidden';
      parentInput.name = 'parent';
      parentInput.value = '0';
      form.appendChild(parentInput);

      document.body.appendChild(form);

      // When iframe loads after form submit, check result
      iframe.onload = () => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          const html = doc.body ? doc.body.innerHTML : '';
          if (html.includes(groupName)) {
            log(`  OK: "${groupName}" utworzona`);
          } else {
            log(`  Formularz wyslany, "${groupName}" weryfikacja przez API...`);
          }
        } catch (e) {
          log(`  Formularz wyslany (cross-origin), weryfikacja przez API...`);
        }
        iframe.remove();
        form.remove();
        resolve({ ok: true });
      };

      setTimeout(() => {
        iframe.remove();
        form.remove();
        log(`  [TIMEOUT] "${groupName}"`);
        resolve({ ok: false });
      }, 10000);

      // Submit the form
      form.submit();
    });
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

        // 4. Map source group_id -> target group_id (by name or same id)
        const groupIdMapping = new Map();
        for (const sg of srcGroups) {
          if (sg.group_id < 0) {
            groupIdMapping.set(sg.group_id, sg.group_id); // universal group
            continue;
          }
          if (tgtAfterById.has(sg.group_id)) {
            groupIdMapping.set(sg.group_id, sg.group_id);
          } else {
            const tgt = tgtAfterByName.get(sg.group_name.toLowerCase().trim());
            if (tgt) {
              groupIdMapping.set(sg.group_id, tgt.group_id);
              log(`  Mapowanie: grupa "${sg.group_name}" src:${sg.group_id} -> tgt:${tgt.group_id}`);
            }
          }
        }

        // 5. Build sizes to add/edit
        const sizesToImport = [];
        const unmappedGroups = [];

        for (const sg of srcGroups) {
          if (sg.group_id < 0) continue; // skip universal

          const targetGroupId = groupIdMapping.get(sg.group_id);
          if (!targetGroupId) {
            unmappedGroups.push(sg.group_name);
            continue;
          }

          // Check which sizes already exist in target group
          const tgtGroup = tgtAfterById.get(targetGroupId) || tgtAfterByName.get(sg.group_name.toLowerCase().trim());
          const existingSizeNames = new Set((tgtGroup?.sizes || []).map(s => s.size_name.toLowerCase().trim()));

          for (const size of sg.sizes) {
            const exists = existingSizeNames.has(size.size_name.toLowerCase().trim());
            sizesToImport.push({
              group_id: targetGroupId,
              id: exists ? size.size_id : undefined,
              name: size.size_name,
              description: '',
              operation: exists ? 'edit' : 'add',
              lang_data: (size.lang_data || []).map(ld => ({
                lang_id: ld.lang_id,
                name: ld.name,
              })),
            });
          }
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
            issues.push(`Grupa "${sg.group_name}": brak ${missingSizes.length} rozmiarow`);
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

  if (document.readyState === 'complete') {
    createUI();
  } else {
    window.addEventListener('load', createUI);
  }

})();
