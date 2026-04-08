// ==UserScript==
// @name         IdoSell - Panel Migrator
// @namespace    https://idosell.com/
// @version      1.2.0
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

  function mapBrandForImport(producer) {
    const langConfigs = (producer.lang_data || []).map(ld => ({
      languageId: ld.lang_id,
      productsListImagesConfiguration: {
        graphicType: ld.productsListImagesConfiguration?.graphicType || 'img',
        singleGraphic: '',
        pcGraphic: '',
        tabletGraphic: '',
        phoneGraphic: '',
      },
      productCardImagesConfiguration: {
        graphicType: ld.productCardImagesConfiguration?.graphicType || 'img',
        singleGraphic: '',
        pcGraphic: '',
        tabletGraphic: '',
        phoneGraphic: '',
      },
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

    return {
      nameInPanel: producer.name,
      languagesConfigurations: langConfigs,
    };
  }

  async function importBrands(domain, apiKey, producers, log) {
    // Filter out the default "id=0" brand
    const toImport = producers.filter(p => p.id !== 0);
    const batchSize = 10;
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < toImport.length; i += batchSize) {
      const batch = toImport.slice(i, i + batchSize);
      const mapped = batch.map(mapBrandForImport);
      const batchNum = Math.floor(i / batchSize) + 1;
      const batchNames = batch.map(b => b.name).join(', ');

      log(`Batch ${batchNum}: importowanie ${batch.length} marek (${batchNames.substring(0, 80)})...`);

      try {
        const url = buildUrl(domain, '/api/admin/v7/products/brands');
        log(`  POST -> ${url}`);
        const res = await apiRequest('POST', url, apiKey, {
          params: { producers: mapped },
        });

        // Log global errors
        if (res.errors) {
          const errStr = typeof res.errors === 'string' ? res.errors : JSON.stringify(res.errors);
          log(`  Blad globalny: ${errStr}`);
        }

        // Check per-producer responses
        if (res.producersResponse && Array.isArray(res.producersResponse)) {
          for (let j = 0; j < res.producersResponse.length; j++) {
            const pr = res.producersResponse[j];
            const name = pr.nameInPanel || batch[j]?.name || '?';
            if (pr.errors) {
              const perErr = typeof pr.errors === 'string' ? pr.errors : JSON.stringify(pr.errors);
              log(`  [FAIL] ${name}: ${perErr}`);
              errors.push(`${name}: ${perErr}`);
              failCount++;
            } else {
              successCount++;
            }
          }
        } else if (!res.errors) {
          successCount += batch.length;
        } else {
          // Global error, no per-producer detail
          failCount += batch.length;
          errors.push(`Batch ${batchNum}: ${JSON.stringify(res.errors)}`);
        }
      } catch (err) {
        failCount += batch.length;
        errors.push(`Batch ${batchNum} (${batchNames.substring(0, 40)}): ${err.message}`);
        log(`  BLAD: ${err.message}`);
      }

      log(`Postep: ${successCount} OK, ${failCount} bledow / ${toImport.length} lacznie`);
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
        const producers = await fetchAllBrands(cfg.sourceDomain, cfg.sourceApiKey, log);
        log(`Pobrano ${producers.length} marek ze zrodla.`);

        const result = await importBrands(cfg.targetDomain, cfg.targetApiKey, producers, log);
        log(`--- Zakonczono: ${result.imported} OK, ${result.failed} bledow ---`);
        if (result.errors.length > 0) {
          log('Szczegoly bledow:\n' + result.errors.join('\n'));
        }
      },
    },
    // Future modules go here, e.g.:
    // { id: 'categories', label: 'Kategorie', icon: '\uD83D\uDCC2', run: async (cfg, log) => { ... } },
    // { id: 'parameters', label: 'Parametry', icon: '\u2699\uFE0F', run: async (cfg, log) => { ... } },
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
      .migrator-log { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; max-height: 250px; overflow-y: auto; white-space: pre-wrap; margin-top: 12px; line-height: 1.6; }
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
    MODULES.forEach(mod => {
      const label = document.createElement('label');
      label.className = 'migrator-checkbox';
      label.innerHTML = `<input type="checkbox" data-module="${mod.id}"> <span>${mod.icon} ${mod.label}</span>`;
      modulesContainer.appendChild(label);
    });

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
          await mod.run(currentCfg, log);
        } catch (err) {
          log(`BLAD w module ${mod.label}: ${err.message}`);
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
