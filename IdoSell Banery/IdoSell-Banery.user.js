// ==UserScript==
// @name         IdoSell Banery — Eksport/Import JSON
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      0.8.1
// @description  Eksport i import banerów IdoSell do/z pliku JSON z podziałem na sklepy i strefy
// @match        https://*/panel/config-links.php*
// @match        https://*/panel/app/config-links.php*
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[banery] script loaded, url=' + location.href);

  const REGIONS = ['banner', 'banner2', 'banner3', 'button', 'button2', 'button3'];
  // Slot name → form index (matches IdoSell's postParamsPicures): plik=1, rwd_desktop=2, rwd_tablet=3, rwd_mobile=4.
  const IMAGE_SLOTS = { plik: '1', rwd_desktop: '2', rwd_tablet: '3', rwd_mobile: '4' };
  const sleep = ms => new Promise(res => setTimeout(res, ms));
  const REGION_LABEL = {
    banner: 'Baner (strefa 1)', banner2: 'Baner (strefa 2)', banner3: 'Baner (strefa 3)',
    button: 'Button (strefa 1)', button2: 'Button (strefa 2)', button3: 'Button (strefa 3)'
  };

  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const isListPage = !params.get('id') && action !== 'edit' && action !== 'new';
  if (!isListPage) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    const bodyText = (document.body && document.body.textContent) || '';
    const hasBannerUI = /Baner \(strefa|Button \(strefa/i.test(bodyText);
    console.log('[banery] init — hasBannerUI=' + hasBannerUI + ', body ' + bodyText.length + ' chars');
    if (!hasBannerUI) return;
    const shops = detectShops();
    console.log('[banery] detected shops=', shops);
    insertUI(shops);
  }

  // -------- shop detection --------
  function detectShops() {
    let select = null;
    document.querySelectorAll('td').forEach(td => {
      if (/^\s*Sklep:?\s*$/i.test(td.textContent)) {
        const sel = td.parentElement.querySelector('select');
        if (sel) select = sel;
      }
    });
    if (select) {
      return Array.from(select.options).map(o => ({ id: parseInt(o.value, 10), label: o.text.trim() }));
    }
    const cur = parseInt(params.get('shop'), 10) || 1;
    return [{ id: cur, label: '(bieżący sklep)' }];
  }

  // -------- UI --------
  function insertUI(shops) {
    if (!document.getElementById('be-shared-css')) {
      const css = document.createElement('style');
      css.id = 'be-shared-css';
      css.textContent = [
        '.be-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);',
        '  background: #fff; padding: 20px; border: 2px solid #4a90e2; border-radius: 8px;',
        '  z-index: 999999; box-shadow: 0 4px 24px rgba(0,0,0,0.3); min-width: 360px;',
        '  font-family: Arial, sans-serif; font-size: 13px; max-height: 80vh; overflow-y: auto; }',
        '.be-modal h3 { margin: 0 0 10px; color: #2c5282; }',
        '.be-modal button { padding: 6px 14px; margin-left: 6px; border: 0; border-radius: 4px;',
        '  cursor: pointer; font-size: 13px; }',
        '.be-modal .be-ok { background: #4a90e2; color: #fff; }',
        '.be-modal .be-cancel { background: #ddd; }',
        '.be-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 999998; }',
        '.be-action-link { cursor: pointer; }',
        '#be-status-box { position: fixed; right: 16px; bottom: 16px;',
        '  width: 440px; max-height: 55vh; background: #1a1a2e; color: #e0e6ed;',
        '  border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.35);',
        '  font-family: Consolas, monospace; font-size: 11px; z-index: 999997;',
        '  display: none; overflow: hidden; }',
        '#be-status-box .be-sb-head { display: flex; align-items: center;',
        '  justify-content: space-between; padding: 8px 12px;',
        '  background: #0f172a; color: #e0e6ed; font-family: "DM Sans", Arial, sans-serif;',
        '  font-size: 12px; font-weight: 600; }',
        '#be-status-box .be-sb-actions { display: flex; gap: 6px; align-items: center; }',
        '#be-status-box .be-sb-btn { background: transparent; border: 1px solid #334155;',
        '  color: #e0e6ed; font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer;',
        '  font-family: inherit; }',
        '#be-status-box .be-sb-btn:hover { background: #334155; }',
        '#be-status { padding: 10px 12px; overflow-y: auto; max-height: calc(55vh - 36px);',
        '  white-space: pre-wrap; line-height: 1.5; }'
      ].join('\n');
      document.head.appendChild(css);
    }

    // IdoSell's ace framework re-renders the CMS/Ustawienia row (note data-overrided=""
    // on the native anchors) — any children we inject get wiped on subsequent renders.
    // Solution: inject once, then watch the DOM and re-inject whenever our wrapper is gone.
    let firstInject = true;

    const buildDownloadLog = () => {
      const text = (lastImportLog || []).join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `banery-import-log-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    const makeLinkAnchor = (label, onClick) => {
      const a = document.createElement('a');
      a.href = 'javascript:void(0)';
      a.className = 'be-action-link mr10';
      a.textContent = label;
      a.addEventListener('click', onClick);
      return a;
    };

    const findContentCmsLink = () => {
      // There can be multiple cms-texts.php links (sidebar nav + page content).
      // The page-content one lives inside a flex row that also contains the
      // "Ustawienia" (config-links.php) link — match exactly that row.
      const candidates = document.querySelectorAll('a[href*="cms-texts.php"]');
      for (const link of candidates) {
        const p1 = link.parentElement;
        const row = p1 && p1.parentElement;
        if (!row) continue;
        if (!row.querySelector('a[href*="config-links.php"]')) continue;
        if (row.tagName === 'UL' || row.tagName === 'OL') continue; // skip sidebar menu
        return { link, row };
      }
      return null;
    };

    const doInject = () => {
      const hit = findContentCmsLink();
      if (!hit) return false;
      const row = hit.row;
      if (row.querySelector('[data-be-role="action-links"]')) return true;

      const wrap = document.createElement('div');
      wrap.dataset.beRole = 'action-links';
      wrap.style.cssText = 'display:flex;gap:14px;align-items:center;padding:0 12px;';

      wrap.appendChild(makeLinkAnchor('Eksport do JSON', () => exportFlow(detectShops())));
      wrap.appendChild(makeLinkAnchor('Import z JSON', () => document.getElementById('be-import-file').click()));
      const dl = makeLinkAnchor('Pobierz log', buildDownloadLog);
      dl.dataset.role = 'download-log';
      if (!(typeof lastImportLog !== 'undefined' && lastImportLog.length)) {
        dl.style.display = 'none';
      }
      wrap.appendChild(dl);

      // Insert as middle flex child: CMS (left) | our links | Ustawienia (right)
      const settingsDiv = row.children[1];
      if (settingsDiv) row.insertBefore(wrap, settingsDiv);
      else row.appendChild(wrap);

      if (firstInject) {
        console.info('[banery] v0.7.5 linki wstawione (row=' + row.tagName + ', children=' + row.children.length + ')');
        firstInject = false;
      }
      return true;
    };

    doInject();

    // Re-inject whenever the row gets re-rendered by the ace framework.
    const rootObs = new MutationObserver(() => {
      const cmsLink = document.querySelector('a[href*="cms-texts.php"]');
      if (!cmsLink) return;
      const row = cmsLink.parentElement && cmsLink.parentElement.parentElement;
      if (row && !row.querySelector('[data-be-role="action-links"]')) doInject();
    });
    rootObs.observe(document.body, { childList: true, subtree: true });

    const fileInp = document.createElement('input');
    fileInp.type = 'file';
    fileInp.id = 'be-import-file';
    fileInp.accept = 'application/json';
    fileInp.style.display = 'none';
    document.body.appendChild(fileInp);
    fileInp.addEventListener('change', e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importFlow(f, detectShops());
    });

    const statusBox = document.createElement('div');
    statusBox.id = 'be-status-box';
    statusBox.innerHTML =
      '<div class="be-sb-head">' +
        '<span>Banery — log</span>' +
        '<div class="be-sb-actions">' +
          '<button type="button" class="be-sb-btn" data-role="clear">Wyczyść</button>' +
          '<button type="button" class="be-sb-btn" data-role="hide">Ukryj</button>' +
        '</div>' +
      '</div>' +
      '<div id="be-status"></div>';
    document.body.appendChild(statusBox);
    statusBox.querySelector('[data-role="clear"]').addEventListener('click', () => {
      document.getElementById('be-status').textContent = '';
      if (typeof lastImportLog !== 'undefined' && Array.isArray(lastImportLog)) lastImportLog.length = 0;
    });
    statusBox.querySelector('[data-role="hide"]').addEventListener('click', () => {
      statusBox.style.display = 'none';
    });
  }

  function status(msg, reset = false) {
    const el = document.getElementById('be-status');
    const box = document.getElementById('be-status-box');
    if (!el || !box) return;
    box.style.display = 'block';
    if (reset) el.textContent = '';
    el.textContent += msg + '\n';
    el.scrollTop = el.scrollHeight;
    if (typeof lastImportLog !== 'undefined' && Array.isArray(lastImportLog)) {
      if (reset) lastImportLog.length = 0;
      lastImportLog.push(msg);
    }
    const dl = document.querySelector('a[data-role="download-log"]');
    if (dl) {
      dl.style.display = '';
      if (dl._separator) dl._separator.textContent = ' • ';
    }
  }


  // -------- modals --------
  function modal(html) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'be-overlay';
      const box = document.createElement('div');
      box.className = 'be-modal';
      box.innerHTML = html;
      document.body.appendChild(overlay);
      document.body.appendChild(box);
      const close = (val) => { box.remove(); overlay.remove(); resolve(val); };
      box.addEventListener('click', e => {
        if (e.target.matches('.be-cancel')) close(null);
      });
      overlay.addEventListener('click', () => close(null));
      // expose helpers
      resolve.box = box;
      resolve.close = close;
      // we hand back via DOM-bound _ok button
      box.querySelectorAll('.be-ok').forEach(btn => btn.addEventListener('click', () => {
        const result = box._collect ? box._collect() : true;
        close(result);
      }));
    });
  }

  // Banner field groups — each key maps to form fields kept in exported JSON.
  // `region` and hidden framework fields are always kept (needed for import).
  const FIELD_GROUPS = {
    title:       { label: 'Tytuł',                desc: 'Nazwa banera',                                 fields: ['title'] },
    visibility:  { label: 'Widoczność + daty',    desc: 'Status wł./wył. i daty aktywacji / wygaśnięcia', fields: ['visible', 'is_show_date', 'show_date_ymd', 'show_datey', 'show_datem', 'show_dated', 'show_time[time][hm]', 'show_time[time][h]', 'show_time[time][m]', 'is_hide_date', 'hide_date_ymd', 'hide_datey', 'hide_datem', 'hide_dated', 'hide_time[time][hm]', 'hide_time[time][h]', 'hide_time[time][m]'] },
    type:        { label: 'Typ reklamy + rozmiar', desc: 'img / img_rwd / html / js / cgi + wymiary',   fields: ['link_type', 'width', 'height'] },
    content:     { label: 'Treść',                desc: 'HTML, JavaScript lub treść tekstowa',          fields: ['htmljs', 'html', 'text'] },
    link:        { label: 'Link',                 desc: '"Posiada link", URL, target (_self/_blank/_top)', fields: ['has_link', 'link', 'target'] },
    timeout:     { label: 'Timeout',              desc: 'Opóźnienie wyświetlania (1–10 s)',             fields: ['timeout'] },
    jezyk:       { label: 'Języki banera',        desc: 'Przypisane kody językowe',                     fields: ['jezyk'] },
    shopsFilter: { label: 'Widoczność w sklepach', desc: 'Filtr w panelu multisklepowym',               fields: ['shops_display_filtering', 'shops'] }
  };
  const ALWAYS_FIELDS = ['region', '__iai_shop_panel[__encoding]'];

  async function detectAvailableLanguages(shopId) {
    // Read jezyk[] checkbox options from the add form — fast and doesn't need a banner to exist.
    try {
      const html = await fetchHtml(`/panel/config-links.php?action=new&shop=${shopId}`);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const langs = [];
      doc.querySelectorAll('input[type="checkbox"][name="jezyk[]"]').forEach(cb => {
        const labelEl = cb.closest('label') || (cb.parentElement && cb.parentElement.querySelector('label'));
        let label = cb.value;
        const sibling = cb.nextElementSibling || cb.parentElement;
        if (sibling) {
          const t = (sibling.textContent || '').trim();
          if (t) label = t;
        }
        if (labelEl) {
          const t = (labelEl.textContent || '').replace(cb.value, '').trim();
          if (t) label = t;
        }
        if (!langs.some(l => l.code === cb.value)) langs.push({ code: cb.value, label });
      });
      return langs;
    } catch (e) {
      return [];
    }
  }

  function pickExportOptions(shops) {
    return new Promise(resolve => {
      // Lazy-load DM Sans once.
      if (!document.getElementById('be-dm-sans')) {
        const link = document.createElement('link');
        link.id = 'be-dm-sans';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
        document.head.appendChild(link);
      }

      const state = {
        storeMode: 'all',
        selectedStores: [],
        zoneMode: 'all',
        selectedZones: [],
        langMode: 'all',
        selectedLangs: [],
        settings: Object.fromEntries(Object.keys(FIELD_GROUPS).map(k => [k, true])),
        embedGraphics: false,
        exportOrder: true
      };
      let languages = [];

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(16,24,40,0.45);z-index:999999;' +
        'display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;' +
        "overflow-y:auto;font-family:'DM Sans',Arial,sans-serif;";
      const card = document.createElement('div');
      card.style.cssText =
        'width:100%;max-width:650px;background:#fff;border-radius:16px;' +
        'box-shadow:0 8px 40px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.08);overflow:hidden;';
      overlay.appendChild(card);

      const sectionStyle = 'padding:18px 20px;border-bottom:1px solid #eef0f4;';

      const pill = (name, opts, cur) =>
        '<div style="display:inline-flex;background:#f0f2f5;border-radius:8px;padding:3px;gap:2px;">' +
        opts.map(o =>
          `<button type="button" data-pill="${name}" data-val="${o.value}" style="` +
          'padding:7px 16px;border-radius:6px;border:none;cursor:pointer;' +
          'font-size:13px;font-weight:500;transition:all .2s;' +
          `background:${cur === o.value ? '#fff' : 'transparent'};` +
          `color:${cur === o.value ? '#1a1a2e' : '#667085'};` +
          `box-shadow:${cur === o.value ? '0 1px 3px rgba(0,0,0,.1)' : 'none'};` +
          `font-family:inherit;">${escapeHtml(o.label)}</button>`
        ).join('') +
        '</div>';

      const toggle = (id, checked) =>
        `<button type="button" data-toggle="${id}" style="` +
        'width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;' +
        `background:${checked ? '#4f8cff' : '#d0d5dd'};position:relative;transition:background .2s;flex-shrink:0;">` +
        '<span style="position:absolute;top:2px;' +
        `left:${checked ? '20px' : '2px'};` +
        'width:18px;height:18px;border-radius:50%;background:#fff;' +
        'transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.18);pointer-events:none;"></span>' +
        '</button>';

      const sectionHeader = (n, title, subtitle) =>
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">' +
        `<span style="width:26px;height:26px;border-radius:50%;display:flex;` +
        'align-items:center;justify-content:center;font-size:12px;font-weight:700;' +
        `background:#4f8cff;color:#fff;flex-shrink:0;margin-top:1px;">${n}</span>` +
        '<div>' +
        `<div style="font-size:14.5px;font-weight:600;color:#1a1a2e;">${escapeHtml(title)}</div>` +
        (subtitle ? `<div style="font-size:12.5px;color:#667085;margin-top:2px;">${escapeHtml(subtitle)}</div>` : '') +
        '</div></div>';

      const checkRow = (id, name, sub, checked) =>
        `<div data-row="${id}" style="display:flex;align-items:center;justify-content:space-between;` +
        `padding:8px 12px;border-radius:7px;cursor:pointer;` +
        `background:${checked ? '#eef3ff' : 'transparent'};transition:background .15s;">` +
        '<span style="font-size:13.5px;color:#1a1a2e;' + (sub ? 'display:flex;flex-direction:column;' : '') + '">' +
        `<span>${escapeHtml(name)}</span>` +
        (sub ? `<span style="font-size:11.5px;color:#98a2b3;">${escapeHtml(sub)}</span>` : '') +
        '</span>' +
        toggle(id, checked) +
        '</div>';

      const wrapList = inner =>
        '<div style="background:#f8f9fb;border-radius:10px;padding:4px;max-height:360px;' +
        'overflow-y:auto;margin-top:10px;border:1px solid #e8ebf0;">' + inner + '</div>';

      const render = () => {
        const shopItems = shops.map(s => ({ id: String(s.id), name: s.label, sub: 'id=' + s.id }));
        const zoneItems = REGIONS.map(r => ({ id: r, name: REGION_LABEL[r] }));
        const langItems = languages.map(l => ({ id: l.code, name: l.label, sub: l.code }));

        const shopList = state.storeMode === 'selected'
          ? wrapList(shopItems.map(it => checkRow('shop:' + it.id, it.name, it.sub, state.selectedStores.includes(it.id))).join(''))
          : '';
        const zoneList = state.zoneMode === 'selected'
          ? wrapList(zoneItems.map(it => checkRow('zone:' + it.id, it.name, null, state.selectedZones.includes(it.id))).join(''))
          : '';
        const langList = state.langMode === 'selected'
          ? (languages.length === 0
              ? '<div style="padding:12px;color:#98a2b3;font-size:12.5px;font-style:italic;">Wczytywanie języków…</div>'
              : wrapList(langItems.map(it => checkRow('lang:' + it.id, it.name, it.sub, state.selectedLangs.includes(it.id))).join('')))
          : '';

        const fieldCount = Object.keys(FIELD_GROUPS).length;
        const fieldRows = Object.entries(FIELD_GROUPS).map(([key, g], i) =>
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;' +
          `border-bottom:${i < fieldCount - 1 ? '1px solid #eef0f4' : 'none'};">` +
          '<div>' +
          `<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;">${escapeHtml(g.label)}</div>` +
          (g.desc ? `<div style="font-size:11.5px;color:#98a2b3;margin-top:1px;">${escapeHtml(g.desc)}</div>` : '') +
          '</div>' +
          toggle('field:' + key, !!state.settings[key]) +
          '</div>'
        ).join('');

        const totalShops = shops.length;
        const totalZones = REGIONS.length;
        const totalLangs = languages.length || '?';
        const parts = [
          state.storeMode === 'all' ? `${totalShops} sklep.` : `${state.selectedStores.length} sklep.`,
          state.zoneMode === 'all' ? `${totalZones} stref` : `${state.selectedZones.length} stref`,
          state.langMode === 'all' ? `${totalLangs} jęz.` : `${state.selectedLangs.length} jęz.`
        ];
        const enabledSettings = Object.values(state.settings).filter(Boolean).length;

        card.innerHTML =
          '<div style="padding:22px 24px;border-bottom:1px solid #eef0f4;display:flex;align-items:center;gap:14px;background:#f8f9fb;">' +
            '<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;background:#e8eeff;color:#4f8cff;">↗</div>' +
            '<div>' +
              '<div style="font-size:17px;font-weight:700;color:#1a1a2e;">Eksport banerów</div>' +
              '<div style="font-size:12.5px;color:#667085;margin-top:2px;">Skonfiguruj zakres i ustawienia eksportu</div>' +
            '</div>' +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(1, 'Sklepy', 'Wybierz sklepy do eksportu') +
            pill('storeMode', [{ value: 'all', label: 'Wszystkie sklepy' }, { value: 'selected', label: 'Wybrane sklepy' }], state.storeMode) +
            shopList +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(2, 'Strefy banerowe', 'Które strefy mają być objęte eksportem') +
            pill('zoneMode', [{ value: 'all', label: 'Wszystkie strefy' }, { value: 'selected', label: 'Wybrane strefy' }], state.zoneMode) +
            zoneList +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(3, 'Języki', 'Banery z co najmniej jednym z wybranych języków') +
            pill('langMode', [{ value: 'all', label: 'Wszystkie języki' }, { value: 'selected', label: 'Wybrane języki' }], state.langMode) +
            langList +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(4, 'Ustawienia banerów', 'Które pola będą zapisane w pliku eksportu') +
            '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;">' +
              fieldRows +
            '</div>' +
            '<div style="font-size:11.5px;color:#98a2b3;margin-top:8px;">Pole <code>region</code> oraz metadane (ID źródłowe) są zapisywane zawsze — wymagane do importu.</div>' +
          '</div>' +

          `<div style="${sectionStyle}border-bottom:none;">` +
            sectionHeader(5, 'Ustawienia dodatkowe', 'Opcje rozszerzone eksportu') +
            '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eef0f4;">' +
                '<div>' +
                  '<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;">Wbuduj grafiki</div>' +
                  '<div style="font-size:11.5px;color:#98a2b3;margin-top:1px;">Osadź obrazy w JSON (base64) — zalecane przy imporcie między domenami</div>' +
                '</div>' +
                toggle('embedGraphics', state.embedGraphics) +
              '</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;">' +
                '<div>' +
                  '<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;">Kolejność i liczba na stronie</div>' +
                  '<div style="font-size:11.5px;color:#98a2b3;margin-top:1px;">Eksportuj ustawienia zarządzania dla stref z sekcji 2</div>' +
                '</div>' +
                toggle('exportOrder', state.exportOrder) +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="padding:16px 20px;background:#fafbfc;border-top:1px solid #eef0f4;display:flex;align-items:center;justify-content:space-between;">' +
            `<div style="font-size:12px;color:#98a2b3;">${parts.join(' · ')} · ${enabledSettings}/${fieldCount} ustaw.</div>` +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" data-action="cancel" style="padding:9px 18px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Anuluj</button>' +
              '<button type="button" data-action="ok" style="padding:9px 22px;border-radius:8px;border:none;background:linear-gradient(135deg,#4f8cff,#3b6de0);color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(79,140,255,.35);font-family:inherit;">Eksportuj</button>' +
            '</div>' +
          '</div>';
      };

      const close = v => { overlay.remove(); resolve(v); };

      render();
      document.body.appendChild(overlay);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) { close(null); return; }
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
          if (actionBtn.dataset.action === 'cancel') { close(null); return; }
          // ok
          let chosenShops;
          if (state.storeMode === 'all') chosenShops = shops;
          else chosenShops = shops.filter(s => state.selectedStores.includes(String(s.id)));
          if (chosenShops.length === 0) { alert('Wybierz przynajmniej jeden sklep.'); return; }
          let chosenRegions;
          if (state.zoneMode === 'all') chosenRegions = REGIONS.slice();
          else chosenRegions = state.selectedZones.slice();
          if (chosenRegions.length === 0) { alert('Wybierz przynajmniej jedną strefę.'); return; }
          let chosenLangs = null;
          if (state.langMode === 'selected') {
            chosenLangs = state.selectedLangs.slice();
            if (chosenLangs.length === 0) { alert('Wybierz przynajmniej jeden język.'); return; }
          }
          const chosenFields = Object.entries(state.settings).filter(([, v]) => v).map(([k]) => k);
          close({
            shops: chosenShops,
            regions: chosenRegions,
            languages: chosenLangs,
            fields: chosenFields,
            embedImages: state.embedGraphics,
            exportRegionSettings: state.exportOrder
          });
          return;
        }
        const pillBtn = e.target.closest('[data-pill]');
        if (pillBtn) {
          const name = pillBtn.dataset.pill;
          const val = pillBtn.dataset.val;
          if (name === 'storeMode') state.storeMode = val;
          else if (name === 'zoneMode') state.zoneMode = val;
          else if (name === 'langMode') state.langMode = val;
          render();
          return;
        }
        const rowOrToggle = e.target.closest('[data-toggle], [data-row]');
        if (rowOrToggle) {
          const id = rowOrToggle.dataset.toggle || rowOrToggle.dataset.row;
          if (id === 'embedGraphics') state.embedGraphics = !state.embedGraphics;
          else if (id === 'exportOrder') state.exportOrder = !state.exportOrder;
          else if (id.startsWith('field:')) {
            const k = id.slice(6);
            state.settings[k] = !state.settings[k];
          } else if (id.startsWith('shop:')) {
            const k = id.slice(5);
            const i = state.selectedStores.indexOf(k);
            if (i >= 0) state.selectedStores.splice(i, 1); else state.selectedStores.push(k);
          } else if (id.startsWith('zone:')) {
            const k = id.slice(5);
            const i = state.selectedZones.indexOf(k);
            if (i >= 0) state.selectedZones.splice(i, 1); else state.selectedZones.push(k);
          } else if (id.startsWith('lang:')) {
            const k = id.slice(5);
            const i = state.selectedLangs.indexOf(k);
            if (i >= 0) state.selectedLangs.splice(i, 1); else state.selectedLangs.push(k);
          }
          render();
        }
      });

      // Async: detect languages from the first available shop.
      (async () => {
        const first = shops[0];
        if (first) {
          languages = await detectAvailableLanguages(first.id);
        }
        render();
      })();
    });
  }

  function pickImportOptions(json, dstShops, sourceRegionsInJson, sourceLangs, dstLangs) {
    return new Promise(resolve => {
      if (!document.getElementById('be-dm-sans')) {
        const link = document.createElement('link');
        link.id = 'be-dm-sans'; link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
        document.head.appendChild(link);
      }

      const sourceShopIds = Object.keys(json.shops || {});
      const state = {
        shopMap: Object.fromEntries(sourceShopIds.map(id => {
          const match = dstShops.find(d => String(d.id) === id);
          return [id, match ? String(match.id) : ''];
        })),
        regionMode: 'all',
        regionMap: Object.fromEntries((sourceRegionsInJson || []).map(r => [r, r])),
        langMode: 'all',
        langMap: Object.fromEntries((sourceLangs || []).map(l => {
          const has = (dstLangs || []).some(d => d.code === l);
          return [l, has ? l : ''];
        })),
        settings: Object.fromEntries(Object.keys(FIELD_GROUPS).map(k => [k, true])),
        duplicateMode: 'skip',
        applyRegionSettings: true,
        linkMode: 'absolute'
      };

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(16,24,40,0.45);z-index:999999;' +
        'display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;' +
        "overflow-y:auto;font-family:'DM Sans',Arial,sans-serif;";
      const card = document.createElement('div');
      card.style.cssText =
        'width:100%;max-width:650px;background:#fff;border-radius:16px;' +
        'box-shadow:0 8px 40px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.08);overflow:hidden;';
      overlay.appendChild(card);

      const sectionStyle = 'padding:18px 20px;border-bottom:1px solid #eef0f4;';
      const pill = (name, opts, cur) =>
        '<div style="display:inline-flex;background:#f0f2f5;border-radius:8px;padding:3px;gap:2px;">' +
        opts.map(o =>
          `<button type="button" data-pill="${name}" data-val="${o.value}" style="` +
          'padding:7px 16px;border-radius:6px;border:none;cursor:pointer;' +
          'font-size:13px;font-weight:500;transition:all .2s;' +
          `background:${cur === o.value ? '#fff' : 'transparent'};` +
          `color:${cur === o.value ? '#1a1a2e' : '#667085'};` +
          `box-shadow:${cur === o.value ? '0 1px 3px rgba(0,0,0,.1)' : 'none'};` +
          `font-family:inherit;">${escapeHtml(o.label)}</button>`
        ).join('') +
        '</div>';

      const toggle = (id, checked) =>
        `<button type="button" data-toggle="${id}" style="` +
        'width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;' +
        `background:${checked ? '#4f8cff' : '#d0d5dd'};position:relative;transition:background .2s;flex-shrink:0;">` +
        '<span style="position:absolute;top:2px;' +
        `left:${checked ? '20px' : '2px'};` +
        'width:18px;height:18px;border-radius:50%;background:#fff;' +
        'transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.18);pointer-events:none;"></span>' +
        '</button>';

      const sectionHeader = (n, title, subtitle) =>
        '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">' +
        `<span style="width:26px;height:26px;border-radius:50%;display:flex;` +
        'align-items:center;justify-content:center;font-size:12px;font-weight:700;' +
        `background:#4f8cff;color:#fff;flex-shrink:0;margin-top:1px;">${n}</span>` +
        '<div>' +
        `<div style="font-size:14.5px;font-weight:600;color:#1a1a2e;">${escapeHtml(title)}</div>` +
        (subtitle ? `<div style="font-size:12.5px;color:#667085;margin-top:2px;">${escapeHtml(subtitle)}</div>` : '') +
        '</div></div>';

      const mapRow = (label, selectHtml) =>
        '<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid #eef0f4;">' +
        `<div style="flex:1;font-size:13px;color:#1a1a2e;">${escapeHtml(label)}</div>` +
        '<span style="color:#98a2b3">→</span>' +
        selectHtml +
        '</div>';

      const selectHtml = (dataAttr, value, options) =>
        `<select data-${dataAttr} style="min-width:200px;font-family:inherit;font-size:13px;padding:6px 8px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;">` +
        options.map(o => `<option value="${o.value}"${o.value === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('') +
        '</select>';

      const render = () => {
        // Section 1 — shops
        const shopSelectOptions = [{ value: '', label: '— pomiń —' }]
          .concat(dstShops.map(d => ({ value: String(d.id), label: `${d.label} (id=${d.id})` })));
        const shopRows = sourceShopIds.map(srcId => {
          const shopLabel = (json.shops[srcId] && json.shops[srcId].shopLabel) || srcId;
          return mapRow(
            `${shopLabel} (źr. id=${srcId})`,
            selectHtml(`src="${srcId}"`, state.shopMap[srcId] || '', shopSelectOptions)
          );
        }).join('');

        // Section 2 — regions
        const regionSelectOptions = [{ value: '', label: '— pomiń —' }]
          .concat(REGIONS.map(r => ({ value: r, label: REGION_LABEL[r] })));
        const regionRows = (sourceRegionsInJson || []).map(r =>
          mapRow(REGION_LABEL[r] || r, selectHtml(`src-region="${r}"`, state.regionMap[r] || '', regionSelectOptions))
        ).join('');
        const regionBlock = state.regionMode === 'custom'
          ? '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;margin-top:10px;">' +
              (regionRows || '<div style="padding:12px;color:#98a2b3;font-size:12.5px;">Brak stref w pliku.</div>') +
            '</div>'
          : '';

        // Section 3 — languages
        const langSelectOptions = [{ value: '', label: '— pomiń —' }]
          .concat((dstLangs || []).map(l => ({ value: l.code, label: `${l.label} (${l.code})` })));
        const langRows = (sourceLangs || []).map(l =>
          mapRow(l, selectHtml(`src-lang="${l}"`, state.langMap[l] || '', langSelectOptions))
        ).join('');
        const langBlock = state.langMode === 'custom'
          ? '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;margin-top:10px;">' +
              (langRows || '<div style="padding:12px;color:#98a2b3;font-size:12.5px;">Brak języków w pliku.</div>') +
            '</div>'
          : '';

        // Section 4 — field groups
        const fieldCount = Object.keys(FIELD_GROUPS).length;
        const fieldRows = Object.entries(FIELD_GROUPS).map(([key, g], i) =>
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;' +
          `border-bottom:${i < fieldCount - 1 ? '1px solid #eef0f4' : 'none'};">` +
          '<div>' +
          `<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;">${escapeHtml(g.label)}</div>` +
          (g.desc ? `<div style="font-size:11.5px;color:#98a2b3;margin-top:1px;">${escapeHtml(g.desc)}</div>` : '') +
          '</div>' +
          toggle('field:' + key, !!state.settings[key]) +
          '</div>'
        ).join('');

        // Footer summary
        const mappedShops = Object.values(state.shopMap).filter(Boolean).length;
        const mappedRegions = state.regionMode === 'all'
          ? (sourceRegionsInJson || []).length
          : Object.values(state.regionMap).filter(Boolean).length;
        const mappedLangs = state.langMode === 'all'
          ? (sourceLangs || []).length
          : Object.values(state.langMap).filter(Boolean).length;
        const enabledFields = Object.values(state.settings).filter(Boolean).length;

        card.innerHTML =
          '<div style="padding:22px 24px;border-bottom:1px solid #eef0f4;display:flex;align-items:center;gap:14px;background:#f8f9fb;">' +
            '<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;background:#e8eeff;color:#4f8cff;">↙</div>' +
            '<div>' +
              '<div style="font-size:17px;font-weight:700;color:#1a1a2e;">Import banerów</div>' +
              '<div style="font-size:12.5px;color:#667085;margin-top:2px;">Skonfiguruj mapowanie i opcje importu</div>' +
            '</div>' +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(1, 'Sklepy', 'Do którego sklepu trafią banery z każdego sklepu źródłowego') +
            '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;">' +
              (shopRows || '<div style="padding:12px;color:#98a2b3;font-size:12.5px;">Brak sklepów w pliku.</div>') +
            '</div>' +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(2, 'Strefy', 'Mapowanie stref ze źródła na strefy w panelu') +
            pill('regionMode', [{ value: 'all', label: 'Wszystkie (1:1)' }, { value: 'custom', label: 'Dostosuj' }], state.regionMode) +
            regionBlock +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(3, 'Języki', 'Mapowanie języków ze źródła na języki sklepu docelowego') +
            pill('langMode', [{ value: 'all', label: 'Wszystkie (1:1)' }, { value: 'custom', label: 'Dostosuj' }], state.langMode) +
            langBlock +
          '</div>' +

          `<div style="${sectionStyle}">` +
            sectionHeader(4, 'Ustawienia banerów', 'Które pola będą stosowane z pliku (odznaczone = wartości domyślne panelu)') +
            '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;">' +
              fieldRows +
            '</div>' +
          '</div>' +

          `<div style="${sectionStyle}border-bottom:none;">` +
            sectionHeader(5, 'Ustawienia dodatkowe', 'Kolejność, duplikaty, linki') +
            '<div style="background:#f8f9fb;border-radius:10px;overflow:hidden;border:1px solid #e8ebf0;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eef0f4;">' +
                '<div>' +
                  '<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;">Kolejność i liczba na stronie</div>' +
                  '<div style="font-size:11.5px;color:#98a2b3;margin-top:1px;">Zastosuj eksportowane perPage + order dla zmapowanych stref</div>' +
                '</div>' +
                toggle('applyRegionSettings', state.applyRegionSettings) +
              '</div>' +
              '<div style="padding:12px 14px;border-bottom:1px solid #eef0f4;">' +
                '<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;margin-bottom:4px;">Banery dopasowane po tytule</div>' +
                '<div style="font-size:11.5px;color:#98a2b3;margin-bottom:8px;">Co zrobić z banerem z pliku, którego tytuł istnieje już w strefie docelowej.</div>' +
                pill('duplicateMode', [{ value: 'skip', label: 'Pomiń' }, { value: 'update', label: 'Aktualizuj' }, { value: 'add', label: 'Dodaj duplikat' }], state.duplicateMode) +
              '</div>' +
              '<div style="padding:12px 14px;">' +
                '<div style="font-size:13.5px;font-weight:500;color:#1a1a2e;margin-bottom:4px;">Linki w banerach</div>' +
                '<div style="font-size:11.5px;color:#98a2b3;margin-bottom:8px;">Bezwzględne = URL z eksportu 1:1. Względne = usunięta domena, zostaje tylko ścieżka.</div>' +
                pill('linkMode', [{ value: 'absolute', label: 'Bezwzględne' }, { value: 'relative', label: 'Względne' }], state.linkMode) +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="padding:16px 20px;background:#fafbfc;border-top:1px solid #eef0f4;display:flex;align-items:center;justify-content:space-between;">' +
            `<div style="font-size:12px;color:#98a2b3;">${mappedShops} sklep. · ${mappedRegions} stref · ${mappedLangs} jęz. · ${enabledFields}/${fieldCount} ustaw.</div>` +
            '<div style="display:flex;gap:8px;">' +
              '<button type="button" data-action="cancel" style="padding:9px 18px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;color:#344054;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Anuluj</button>' +
              '<button type="button" data-action="ok" style="padding:9px 22px;border-radius:8px;border:none;background:linear-gradient(135deg,#4f8cff,#3b6de0);color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(79,140,255,.35);font-family:inherit;">Importuj</button>' +
            '</div>' +
          '</div>';
      };

      const close = v => { overlay.remove(); resolve(v); };
      render();
      document.body.appendChild(overlay);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) { close(null); return; }
        const pillBtn = e.target.closest('[data-pill]');
        if (pillBtn) {
          const name = pillBtn.dataset.pill;
          const val = pillBtn.dataset.val;
          if (name === 'regionMode') state.regionMode = val;
          else if (name === 'langMode') state.langMode = val;
          else if (name === 'linkMode') state.linkMode = val;
          else if (name === 'duplicateMode') state.duplicateMode = val;
          render();
          return;
        }
        const tog = e.target.closest('[data-toggle]');
        if (tog) {
          const id = tog.dataset.toggle;
          if (id === 'applyRegionSettings') state.applyRegionSettings = !state.applyRegionSettings;
          else if (id === 'skipDuplicates') state.skipDuplicates = !state.skipDuplicates;
          else if (id.startsWith('field:')) {
            const k = id.slice(6);
            state.settings[k] = !state.settings[k];
          }
          render();
          return;
        }
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
          if (actionBtn.dataset.action === 'cancel') { close(null); return; }
          // validate
          const mapping = {};
          Object.entries(state.shopMap).forEach(([k, v]) => { if (v) mapping[k] = parseInt(v, 10); });
          if (Object.keys(mapping).length === 0) { alert('Zmapuj co najmniej jeden sklep.'); return; }
          const regionMapping = state.regionMode === 'all'
            ? Object.fromEntries((sourceRegionsInJson || []).map(r => [r, r]))
            : Object.fromEntries(Object.entries(state.regionMap).filter(([, v]) => v));
          if (Object.keys(regionMapping).length === 0) { alert('Zmapuj co najmniej jedną strefę.'); return; }
          const languageMapping = state.langMode === 'all'
            ? Object.fromEntries((sourceLangs || []).map(l => [l, l]))
            : Object.fromEntries(Object.entries(state.langMap).filter(([, v]) => v));
          const fieldsToApply = Object.entries(state.settings).filter(([, v]) => v).map(([k]) => k);
          close({
            mapping, regionMapping, languageMapping,
            fieldsToApply,
            applyRegionSettings: state.applyRegionSettings,
            duplicateMode: state.duplicateMode,
            linkMode: state.linkMode
          });
        }
      });

      // Change handler for mapping <select>s.
      overlay.addEventListener('change', e => {
        const t = e.target;
        if (t.matches('[data-src]')) state.shopMap[t.dataset.src] = t.value;
        else if (t.matches('[data-src-region]')) state.regionMap[t.dataset.srcRegion] = t.value;
        else if (t.matches('[data-src-lang]')) state.langMap[t.dataset.srcLang] = t.value;
        // No re-render — the summary update is nice-to-have, skip for responsiveness.
      });
    });
  }

  function pickShopMapping(sourceShops, dstShops, sourceRegionsInJson) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'be-overlay';
      const box = document.createElement('div');
      box.className = 'be-modal';
      box.style.minWidth = '420px';

      const shopRows = Object.entries(sourceShops).map(([srcId, srcData]) => {
        const opts = ['<option value="">— pomiń —</option>']
          .concat(dstShops.map(d => `<option value="${d.id}">${escapeHtml(d.label)} (id=${d.id})</option>`))
          .join('');
        return `<tr>
          <td style="padding:4px 8px">${escapeHtml(srcData.shopLabel || '')} <small style="color:#888">(źr. id=${srcId})</small></td>
          <td style="padding:4px">→</td>
          <td style="padding:4px"><select data-src="${srcId}" style="min-width:200px">${opts}</select></td>
        </tr>`;
      }).join('');

      const regionOpts = (selected) => ['<option value="">— pomiń —</option>']
        .concat(REGIONS.map(r => `<option value="${r}"${r === selected ? ' selected' : ''}>${escapeHtml(REGION_LABEL[r])}</option>`))
        .join('');
      const regionRows = (sourceRegionsInJson || []).map(srcR => {
        return `<tr data-region-row="${srcR}">
          <td style="padding:4px 8px">${escapeHtml(REGION_LABEL[srcR] || srcR)}</td>
          <td style="padding:4px">→</td>
          <td style="padding:4px"><select data-src-region="${srcR}" style="min-width:200px">${regionOpts(srcR)}</select></td>
        </tr>`;
      }).join('');

      box.innerHTML = `
        <h3>Import — mapowanie</h3>

        <div style="margin:6px 0">
          <strong>Sklepy</strong>
          <p style="color:#666;margin:4px 0 6px">Wskaż, do którego sklepu trafią banery z każdego sklepu źródłowego.</p>
          <table>${shopRows}</table>
        </div>

        <div style="margin:14px 0">
          <strong>Strefy</strong>
          <div style="margin:4px 0 6px">
            <label><input type="radio" name="be-region-mode" value="all" checked> Wszystkie (1:1)</label>
            <label style="margin-left:12px"><input type="radio" name="be-region-mode" value="custom"> Dostosuj mapowanie</label>
          </div>
          <div id="be-region-map" style="display:none;margin-top:6px;padding:6px;background:#f8f9fb;border:1px solid #e8ebf0;border-radius:4px">
            ${regionRows || '<p style="color:#888;font-size:12px;margin:4px 0">Brak stref w pliku.</p>'}
          </div>
        </div>

        <div style="margin:12px 0;padding:8px;background:#fff;border:1px solid #ddd;border-radius:3px">
          <label><input type="checkbox" id="be-skip-duplicates" checked> Pomiń banery o tytule już obecnym w strefie docelowej</label>
          <div style="color:#666;font-size:11px;margin:4px 0 0 22px;line-height:1.4">
            Doimport — jeśli w docelowej strefie istnieje już baner o tym samym tytule, nowy nie zostanie dodany.
            Banery bez tytułu są zawsze importowane.
          </div>
        </div>
        <div style="text-align:right;margin-top:12px">
          <button class="be-cancel">Anuluj</button>
          <button class="be-ok">Importuj</button>
        </div>
      `;
      document.body.appendChild(overlay);
      document.body.appendChild(box);
      const regionMapEl = box.querySelector('#be-region-map');
      box.querySelectorAll('input[name="be-region-mode"]').forEach(r => {
        r.addEventListener('change', () => {
          regionMapEl.style.display = box.querySelector('input[name="be-region-mode"]:checked').value === 'custom' ? 'block' : 'none';
        });
      });

      const close = (v) => { box.remove(); overlay.remove(); resolve(v); };
      box.querySelector('.be-cancel').onclick = () => close(null);
      overlay.onclick = () => close(null);
      box.querySelector('.be-ok').onclick = () => {
        const map = {};
        box.querySelectorAll('select[data-src]').forEach(s => { if (s.value) map[s.dataset.src] = parseInt(s.value, 10); });
        if (Object.keys(map).length === 0) { alert('Zmapuj co najmniej jeden sklep.'); return; }

        const regionMode = box.querySelector('input[name="be-region-mode"]:checked').value;
        const regionMapping = {};
        if (regionMode === 'all') {
          (sourceRegionsInJson || []).forEach(r => { regionMapping[r] = r; });
        } else {
          box.querySelectorAll('select[data-src-region]').forEach(s => {
            if (s.value) regionMapping[s.dataset.srcRegion] = s.value;
          });
          if (Object.keys(regionMapping).length === 0) {
            alert('Zmapuj co najmniej jedną strefę lub wybierz "Wszystkie (1:1)".');
            return;
          }
        }

        const skipDuplicates = box.querySelector('#be-skip-duplicates').checked;
        close({ mapping: map, skipDuplicates, regionMapping });
      };
    });
  }

  // -------- EXPORT --------
  async function exportFlow(shops) {
    const choice = await pickExportOptions(shops);
    if (!choice) return;
    const { shops: chosenShops, regions: chosenRegions, languages, fields, embedImages, exportRegionSettings } = choice;

    // Compute the set of field names that should survive the export filter.
    const allowedFields = new Set(ALWAYS_FIELDS);
    fields.forEach(groupKey => {
      (FIELD_GROUPS[groupKey].fields || []).forEach(f => allowedFields.add(f));
    });

    status(`▶ Eksport: ${chosenShops.length} sklep(ów), strefy: ${chosenRegions.length}/${REGIONS.length}, języki: ${languages ? languages.join(',') : 'wszystkie'}, grafiki: ${embedImages ? 'wbudowane' : 'URL'}, ustawienia stref: ${exportRegionSettings ? 'tak' : 'nie'}`, true);

    const out = {
      exportedAt: new Date().toISOString(),
      sourceHost: location.host,
      schemaVersion: 3,
      imagesEmbedded: !!embedImages,
      exportedFieldGroups: fields,
      languageFilter: languages,
      shops: {}
    };
    for (const sh of chosenShops) {
      status(`\n● Sklep ${sh.id} (${sh.label})`);
      const regions = {};
      chosenRegions.forEach(r => regions[r] = { settings: { perPage: null, order: [] }, byLanguage: {} });
      for (const r of chosenRegions) {
        let s;
        try { s = await fetchRegionSettings(sh.id, r); }
        catch (e) { status(`  ⚠ ${REGION_LABEL[r]}: ${e.message}`); continue; }
        if (exportRegionSettings) regions[r].settings = s;
        status(`  ${REGION_LABEL[r]}: ${s.order.length} poz., perPage=${s.perPage}`);
        for (let i = 0; i < s.order.length; i++) {
          const id = s.order[i];
          try {
            const data = await fetchBanner(id, sh.id, embedImages);
            const bannerLangs = Array.isArray(data.jezyk) ? data.jezyk : (data.jezyk ? [data.jezyk] : []);
            if (bannerLangs.length === 0) {
              status(`    ↷ ${data.title || id}: brak języków — pomijam`);
              continue;
            }
            const emitLangs = languages
              ? bannerLangs.filter(l => languages.includes(l))
              : bannerLangs;
            if (emitLangs.length === 0) {
              status(`    ↷ ${data.title || id}: brak dopasowanych języków — pomijam`);
              continue;
            }
            const filtered = filterBannerFields(data, allowedFields);
            for (const lang of emitLangs) {
              if (!regions[r].byLanguage[lang]) regions[r].byLanguage[lang] = [];
              regions[r].byLanguage[lang].push(filtered);
            }
          } catch (e) {
            status(`    ⚠ id=${id}: ${e.message}`);
          }
        }
      }
      out.shops[sh.id] = { shopLabel: sh.label, regions };
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banery-${location.host}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status(`\n✅ Eksport zapisany.`);
  }

  // Collect unique banners from a region, supporting both schemaVersion 2 (items[])
  // and 3 (byLanguage: {lang: [items]}). Deduplicates by _meta.sourceId — a single
  // source banner appears once even if JSON lists it under multiple language buckets.
  function collectRegionItems(regionData) {
    if (!regionData || typeof regionData !== 'object') return [];
    if (Array.isArray(regionData)) return regionData;
    const collected = [];
    const seen = new Map();
    const push = (item) => {
      if (!item || typeof item !== 'object') return;
      const key = item._meta && item._meta.sourceId;
      if (key && seen.has(key)) return;
      if (key) seen.set(key, true);
      collected.push(item);
    };
    if (Array.isArray(regionData.items)) {
      regionData.items.forEach(push);
    }
    if (regionData.byLanguage && typeof regionData.byLanguage === 'object') {
      for (const bucket of Object.values(regionData.byLanguage)) {
        if (Array.isArray(bucket)) bucket.forEach(push);
      }
    }
    return collected;
  }

  function bannerMatchesLanguages(banner, wantedLangs) {
    const bLangs = Array.isArray(banner.jezyk) ? banner.jezyk : (banner.jezyk ? [banner.jezyk] : []);
    if (bLangs.length === 0) return false;
    return bLangs.some(l => wantedLangs.includes(l));
  }

  function filterBannerFields(banner, allowedFields) {
    const filtered = {};
    for (const [k, v] of Object.entries(banner)) {
      if (k === '_meta') { filtered[k] = v; continue; }
      if (allowedFields.has(k)) filtered[k] = v;
    }
    return filtered;
  }

  async function fetchRegionSettings(shopId, region) {
    const html = await fetchHtml(`/panel/config-links.php?action=table&name=order&commercialId=${region}&shopId=${shopId}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const perPageInput = doc.querySelector(`input[name="shop_option_${region}"]`);
    const perPage = perPageInput ? perPageInput.value : null;
    const order = [];
    const ul = doc.getElementById(region);
    if (ul) {
      ul.querySelectorAll(':scope > li').forEach(li => {
        const m = (li.id || '').match(/_(\d+)$/);
        if (m) order.push(m[1]);
      });
    }
    return { perPage, order };
  }

  async function fetchBanner(id, shopId, embedImages) {
    const html = await fetchHtml(`/panel/config-links.php?id=${id}&action=edit&shop=${shopId}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = Array.from(doc.querySelectorAll('form'))
      .find(f => f.querySelector('input[name="operation"][value="edit"]'));
    if (!form) throw new Error('Nie znaleziono formularza edycji');
    const data = serializeForm(form);
    const meta = { sourceId: String(id), sourceShop: String(shopId), images: {} };

    const slots = ['plik', 'rwd_desktop', 'rwd_tablet', 'rwd_mobile'];
    for (const slot of slots) {
      const cont = doc.getElementById('displayFile_' + slot);
      if (!cont) continue;
      const imgEl = cont.querySelector('img[src*="/data/include/img/links/"]');
      if (!imgEl) continue;
      const rawSrc = imgEl.getAttribute('src');
      if (!/\/links\/[^/?]+\./.test(rawSrc)) continue;
      const absUrl = new URL(rawSrc, `${location.protocol}//${location.host}`).href;
      const imgInfo = { url: absUrl, fileName: filenameFromUrl(absUrl) };
      if (embedImages) {
        try {
          const blobResp = await fetch(absUrl, { credentials: 'same-origin' });
          if (!blobResp.ok) throw new Error('HTTP ' + blobResp.status);
          const blob = await blobResp.blob();
          imgInfo.mime = blob.type || 'application/octet-stream';
          imgInfo.base64 = await blobToBase64(blob);
        } catch (e) {
          imgInfo.error = e.message;
        }
      }
      meta.images[slot] = imgInfo;
    }

    data._meta = meta;
    return data;
  }

  function filenameFromUrl(url) {
    try {
      const u = new URL(url);
      const last = u.pathname.split('/').filter(Boolean).pop() || 'image';
      return last;
    } catch { return 'image'; }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = fr.result || '';
        const idx = s.indexOf(',');
        resolve(idx >= 0 ? s.slice(idx + 1) : s);
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  function serializeForm(form) {
    const data = {};
    form.querySelectorAll('input, select, textarea').forEach(el => {
      const name = el.name;
      if (!name) return;
      const t = el.type;
      if (t === 'submit' || t === 'button' || t === 'file' || t === 'image' || t === 'reset') return;
      if (t === 'radio') {
        if (el.checked) data[name] = el.value;
        return;
      }
      if (t === 'checkbox') {
        if (!el.checked) return;
        if (name.endsWith('[]')) {
          const k = name.slice(0, -2);
          (data[k] = data[k] || []).push(el.value);
        } else {
          data[name] = el.value;
        }
        return;
      }
      if (el.tagName === 'SELECT') {
        if (el.multiple) {
          const vals = Array.from(el.selectedOptions).map(o => o.value);
          data[name.endsWith('[]') ? name.slice(0, -2) : name] = vals;
        } else {
          data[name] = el.value;
        }
        return;
      }
      data[name] = el.value;
    });
    return data;
  }

  async function fetchHtml(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' przy ' + url);
    return await r.text();
  }

  // -------- IMPORT --------
  async function importFlow(file, dstShops) {
    let json;
    try { json = JSON.parse(await file.text()); }
    catch (e) { alert('Nieprawidłowy JSON: ' + e.message); return; }
    if (!json.shops || typeof json.shops !== 'object') { alert('Brak klucza "shops" w JSON.'); return; }
    const sourceRegionsInJson = [];
    for (const r of REGIONS) {
      const has = Object.values(json.shops).some(sh => {
        const rd = (sh.regions && sh.regions[r]) || {};
        return collectRegionItems(rd).length > 0;
      });
      if (has) sourceRegionsInJson.push(r);
    }

    // Collect source languages from all banners across the JSON.
    const sourceLangsSet = new Set();
    Object.values(json.shops || {}).forEach(sh => {
      Object.values(sh.regions || {}).forEach(rd => {
        collectRegionItems(rd).forEach(it => {
          (Array.isArray(it.jezyk) ? it.jezyk : [it.jezyk]).forEach(l => { if (l) sourceLangsSet.add(l); });
        });
      });
    });
    const sourceLangs = Array.from(sourceLangsSet);

    // Detect destination languages by fetching the "Add new" form for the first dst shop.
    let dstLangs = [];
    if (dstShops[0]) {
      try { dstLangs = await detectAvailableLanguages(dstShops[0].id); } catch (e) { /* ignore */ }
    }

    const mapResult = await pickImportOptions(json, dstShops, sourceRegionsInJson, sourceLangs, dstLangs);
    if (!mapResult) return;
    const mapping = mapResult.mapping;
    const duplicateMode = mapResult.duplicateMode || 'skip';
    const skipDuplicates = duplicateMode === 'skip';
    const regionMapping = mapResult.regionMapping || {};
    const languageMapping = mapResult.languageMapping || {};
    const fieldsToApply = mapResult.fieldsToApply || Object.keys(FIELD_GROUPS);
    const applyRegionSettings = !!mapResult.applyRegionSettings;
    const linkMode = mapResult.linkMode || 'absolute';

    // Pre-compute the set of field names kept from each item.
    const allowedFields = new Set(ALWAYS_FIELDS);
    fieldsToApply.forEach(k => {
      (FIELD_GROUPS[k].fields || []).forEach(f => allowedFields.add(f));
    });

    function transformItem(item) {
      // Start from fields the user chose to apply; always keep _meta so images + sourceId survive.
      const out = {};
      for (const [k, v] of Object.entries(item)) {
        if (k === '_meta') { out[k] = v; continue; }
        if (allowedFields.has(k)) out[k] = v;
      }
      // Language remap.
      if (out.jezyk && Array.isArray(out.jezyk)) {
        const mapped = out.jezyk.map(l => languageMapping[l] || l).filter(Boolean);
        out.jezyk = Array.from(new Set(mapped));
      }
      // Link conversion.
      if (linkMode === 'relative' && out.link) {
        try {
          const u = new URL(out.link, 'https://example.invalid');
          out.link = u.pathname + u.search + u.hash;
        } catch (e) { /* keep as-is if unparseable */ }
      }
      return out;
    }

    const dupLabel = duplicateMode === 'update' ? 'aktualizacja istniejących' : (duplicateMode === 'add' ? 'dodawanie duplikatów' : 'pomijanie duplikatów');
    status(`▶ Import rozpoczęty (${dupLabel})${linkMode === 'relative' ? ', linki → względne' : ''}`, true);
    let total = 0, ok = 0, err = 0;
    const imageReminders = [];

    for (const [srcShopId, dstId] of Object.entries(mapping)) {
      const src = json.shops[srcShopId];
      if (!src) continue;
      status(`\n● Sklep źr. ${srcShopId} (${src.shopLabel || ''}) → docelowy id=${dstId}`);

      const srcToNew = {};
      for (const srcRegion of REGIONS) {
        const regionData = (src.regions && src.regions[srcRegion]) || {};
        const items = collectRegionItems(regionData);
        if (items.length === 0) continue;
        const dstRegion = regionMapping[srcRegion];
        if (!dstRegion) {
          status(`  ↷ ${REGION_LABEL[srcRegion]}: pominięta (brak mapowania)`);
          continue;
        }
        const region = dstRegion;
        if (srcRegion !== dstRegion) {
          status(`  ↳ ${REGION_LABEL[srcRegion]} → ${REGION_LABEL[dstRegion]}`);
        }

        // Snapshot existing banner IDs in this region BEFORE adding.
        let beforeOrder = [];
        try { beforeOrder = (await fetchRegionSettings(dstId, region)).order; }
        catch (e) { status(`  ⚠ snapshot ${region}: ${e.message}`); }
        const beforeSet = new Set(beforeOrder);

        // Serial POSTs with a small pause between them. Per-POST verification is racy:
        // fetch often sees a stale region snapshot (IdoSell commits async), which made v0.4.1/.2
        // treat created banners as "silent reject" and then alias subsequent newIds to the
        // wrong items. We instead verify once at end of region and map by insertion order.
        // Title -> existingId map for the destination region. Used by duplicateMode to
        // either skip, update or add-duplicate banners with matching titles.
        const titleToExistingId = new Map();
        if (duplicateMode !== 'add') {
          for (const id of beforeOrder) {
            try {
              const eh = await fetchHtml(`/panel/config-links.php?id=${id}&action=edit&shop=${dstId}`);
              const ed = new DOMParser().parseFromString(eh, 'text/html');
              const t = ed.querySelector('input[name="title"]');
              const title = t ? (t.value || '').trim() : '';
              if (title) titleToExistingId.set(title, id);
            } catch (e) { /* ignore */ }
          }
        }

        // IdoSell's operation=add has a server-side rate limit (empirically ~1 POST/sec).
        // Anything faster silently drops rows while still returning 200 + "Reklama została
        // zapisana". 1000ms between POSTs gave 100% success in testing.
        const POST_INTERVAL_MS = 1000;

        async function postAndTrack(item, addedItems) {
          // Duplicate handling (skip/update) is resolved in the main loop below
          // via titleToExistingId/duplicateMode; here we just post and track.
          try {
            await postBanner(transformItem(item), dstId, region);
            addedItems.push(item);
            return 'posted';
          } catch (e) {
            status(`    ❌ POST: ${e.message}`);
            return 'error';
          }
        }

        const addedItems = [];
        let skipped = 0;
        let updated = 0;
        for (const item of items) {
          total++;
          const itemTitle = (item.title || '').trim();
          const existingId = itemTitle ? titleToExistingId.get(itemTitle) : null;

          if (existingId && duplicateMode === 'skip') {
            skipped++;
            status(`  [${region}] ${item.title} — pominięty (duplikat tytułu)`);
            continue;
          }

          if (existingId && duplicateMode === 'update') {
            status(`  [${region}] ${item.title} — aktualizacja (id=${existingId})`);
            try {
              await postBanner(transformItem(item), dstId, region, existingId);
              updated++;
              ok++;
            } catch (e) {
              err++;
              status(`    UPDATE blad: ${e.message}`);
            }
            await sleep(POST_INTERVAL_MS);
            continue;
          }

          status(`  [${region}] ${item.title || '(bez tytułu)'}`);
          const res = await postAndTrack(item, addedItems);
          if (res === 'error') err++;
          await sleep(POST_INTERVAL_MS);
        }
        if (skipped) status(`  ${region}: pominięto ${skipped} duplikatów`);
        if (updated) status(`  ${region}: zaktualizowano ${updated} banerów`);

        await sleep(500);
        let afterOrder = [];
        try { afterOrder = (await fetchRegionSettings(dstId, region)).order; }
        catch (e) { status(`  ⚠ post-fetch ${region}: ${e.message}`); continue; }
        let newIds = afterOrder.filter(id => !beforeSet.has(id)).sort();

        // Retry pass — if some POSTs were silently rejected anyway, re-fetch titles
        // currently present in the region and re-POST any expected title still missing.
        if (newIds.length < addedItems.length) {
          status(`  ⚠ ${region}: POSTowano ${addedItems.length}, w panelu +${newIds.length} — próbuję dodać brakujące ponownie`);
          const presentTitles = new Set();
          for (const id of afterOrder) {
            try {
              const eh = await fetchHtml(`/panel/config-links.php?id=${id}&action=edit&shop=${dstId}`);
              const ed = new DOMParser().parseFromString(eh, 'text/html');
              const t = ed.querySelector('input[name="title"]');
              if (t && t.value) presentTitles.add(t.value.trim());
            } catch (e) { /* ignore */ }
          }
          const missing = addedItems.filter(it => {
            const t = (it.title || '').trim();
            return t && !presentTitles.has(t);
          });
          if (missing.length) {
            status(`  ${region}: retry ${missing.length} brakujących`);
            await sleep(2000);
            for (const item of missing) {
              status(`  [${region}] retry ${item.title}`);
              try { await postBanner(transformItem(item), dstId, region); }
              catch (e) { status(`    ❌ POST retry: ${e.message}`); }
              await sleep(POST_INTERVAL_MS);
            }
            await sleep(500);
            try { afterOrder = (await fetchRegionSettings(dstId, region)).order; }
            catch (e) { /* best effort */ }
            newIds = afterOrder.filter(id => !beforeSet.has(id)).sort();
            status(`  ${region}: po retry +${newIds.length} nowych ID`);
          }
        }

        addedItems.forEach((it, i) => {
          if (newIds[i] && it._meta && it._meta.sourceId) {
            srcToNew[it._meta.sourceId] = newIds[i];
          }
        });
        const matched = Math.min(addedItems.length, newIds.length);
        ok += matched;
        if (addedItems.length > newIds.length) err += addedItems.length - newIds.length;

        // Upload images for each added banner (if the JSON carries them).
        for (let i = 0; i < addedItems.length; i++) {
          const item = addedItems[i];
          const newId = newIds[i];
          if (!newId) continue;
          const images = item._meta && item._meta.images;
          if (!images || Object.keys(images).length === 0) continue;
          try {
            const uploaded = await uploadAndAttachImages(newId, dstId, images);
            const done = Object.keys(uploaded);
            const skipped = Object.keys(images).filter(s => !done.includes(s));
            if (done.length) status(`    🖼 ${region} [${item.title}]: wgrano grafiki: ${done.join(', ')}`);
            skipped.forEach(slot => {
              const info = images[slot] || {};
              imageReminders.push({ title: item.title, region, slot, url: info.url, reason: info.error || 'brak danych / CORS' });
            });
          } catch (e) {
            status(`    ⚠ grafiki [${item.title}]: ${e.message}`);
            Object.entries(images).forEach(([slot, info]) => {
              imageReminders.push({ title: item.title, region, slot, url: info.url, reason: e.message });
            });
          }
        }
      }

      // Apply zone settings (perPage + order) per region, respecting regionMapping.
      for (const srcRegion of REGIONS) {
        const dstRegion = regionMapping[srcRegion];
        if (!dstRegion) continue;
        if (!applyRegionSettings) continue;
        const region = dstRegion;
        const regionData = (src.regions && src.regions[srcRegion]) || {};
        const settings = regionData && regionData.settings;
        if (!settings) continue;
        try {
          if (settings.perPage !== null && settings.perPage !== undefined && settings.perPage !== '') {
            await postShopOption(dstId, region, settings.perPage);
            status(`  ⚙ ${region}: perPage=${settings.perPage}`);
          }
          if (Array.isArray(settings.order) && settings.order.length) {
            const mappedOrder = settings.order.map(srcId => srcToNew[srcId]).filter(Boolean);
            if (mappedOrder.length) {
              await postOrder(dstId, region, mappedOrder);
              status(`  ⚙ ${region}: kolejność (${mappedOrder.length}/${settings.order.length} zmapowanych)`);
            }
          }
        } catch (e) {
          status(`    ❌ ustawienia strefy ${region}: ${e.message}`);
        }
      }
    }

    status(`\n✅ Import zakończony. Razem: ${total}, OK: ${ok}, błędów: ${err}`);
    if (imageReminders.length) {
      status(`\n📷 Grafiki do uzupełnienia ręcznie:`);
      imageReminders.forEach(r => status(`   • [${r.region}] ${r.title} (${r.slot || 'plik'}) — ${r.url || '(brak URL)'} — powód: ${r.reason || 'n/d'}`));
    }
  }

  async function postShopOption(shopId, region, perPage) {
    const body = new URLSearchParams();
    body.append('__iai_shop_panel[__encoding]', 'utf-8');
    body.append('shop_option_name', 'shop_option_' + region);
    body.append('shop_option_' + region, String(perPage));
    const r = await fetch(`/panel/config-links.php?action=save_shop_option&shop=${shopId}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body.toString()
    });
    if (!r.ok) throw new Error('save_shop_option HTTP ' + r.status);
  }

  async function postOrder(shopId, region, ids) {
    const parts = ['action=saveorder'];
    ids.forEach(id => parts.push('size[]=' + encodeURIComponent(id)));
    const r = await fetch(`/panel/config-links.php?action=save_order&shop=${shopId}&region=${region}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: parts.join('&')
    });
    if (!r.ok) throw new Error('save_order HTTP ' + r.status);
  }

  async function uploadImageToSession(blob, fileName, slot, refererUrl) {
    const size = blob.size;
    const dir = 'data/include/img/links/';

    // Step 1: upload file (single chunk for typical banner sizes).
    const chunkUrl = `/panel/ajax/uploadLargeFile.php?largeFileMode=1&fileSize=${size}&fileName=${encodeURIComponent(fileName)}&dir=${dir}&offset=0&chunkSize=${size}`;
    const chunkResp = await fetch(chunkUrl, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/ocet-stream' },
      body: blob,
      referrer: refererUrl
    });
    if (!chunkResp.ok) throw new Error('uploadLargeFile HTTP ' + chunkResp.status);
    const chunkJson = await chunkResp.json();
    if (chunkJson.status !== 'OK') throw new Error('uploadLargeFile: ' + (chunkJson.errmsg || chunkJson.status));
    const serverName = chunkJson.name;

    // Step 2: commit — swfu_files.php writes to /data/tmp/<serverName><slot>.
    const body = new URLSearchParams();
    body.append('completed_fileUploaderField', JSON.stringify([[fileName, serverName]]));
    body.append('operation', 'commercials');
    body.append('image_type', slot);
    body.append('type', 'commercials');
    body.append('name', IMAGE_SLOTS[slot] || '1');
    body.append('complete', 'false');
    body.append('multi', 'false');
    body.append('id', slot);
    body.append('path_url', dir);
    body.append('file', '');
    body.append('display_img', 'displayFile_' + slot);
    const commitResp = await fetch('/panel/swfu_files.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      referrer: refererUrl
    });
    if (!commitResp.ok) throw new Error('swfu_files HTTP ' + commitResp.status);
    const commitJson = await commitResp.json().catch(() => null);
    if (!commitJson) throw new Error('swfu_files: nieprawidłowa odpowiedź');

    // Extract tmp path from the returned HTML fragment.
    const parsed = new DOMParser().parseFromString(commitJson.display_img || '', 'text/html');
    const nameInput = parsed.querySelector(`input[name="file_${slot}[name]"]`);
    if (!nameInput) throw new Error('swfu_files: brak pola file_' + slot + '[name] w odpowiedzi');
    return {
      tmpPath: nameInput.value,
      origName: fileName
    };
  }

  async function uploadAndAttachImages(bannerId, shopId, images) {
    const refererUrl = `${location.protocol}//${location.host}/panel/config-links.php?id=${bannerId}&action=edit&shop=${shopId}`;
    const uploaded = {};
    for (const [slot, info] of Object.entries(images)) {
      if (!info) continue;
      let blob = null;
      let fileName = info.fileName || (slot + '.jpg');
      if (info.base64) {
        try { blob = base64ToBlob(info.base64, info.mime || 'image/jpeg'); }
        catch (e) { info.error = 'base64 decode: ' + e.message; continue; }
      } else if (info.url) {
        try {
          const r = await fetch(info.url, { credentials: 'omit', mode: 'cors' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          blob = await r.blob();
        } catch (e) {
          info.error = 'fetch URL: ' + e.message;
          continue;
        }
      } else {
        continue;
      }
      try {
        const res = await uploadImageToSession(blob, fileName, slot, refererUrl);
        uploaded[slot] = res;
      } catch (e) {
        info.error = 'upload: ' + e.message;
      }
    }
    if (Object.keys(uploaded).length > 0) {
      await attachImagesAndSave(bannerId, shopId, uploaded);
    }
    return uploaded;
  }

  async function attachImagesAndSave(bannerId, shopId, uploadedImages) {
    // Re-fetch edit form to get current field values, then POST edit with file_<slot>[name]/[org_name] added.
    const refererUrl = `${location.protocol}//${location.host}/panel/config-links.php?id=${bannerId}&action=edit&shop=${shopId}`;
    const html = await fetchHtml(`/panel/config-links.php?id=${bannerId}&action=edit&shop=${shopId}`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = Array.from(doc.querySelectorAll('form'))
      .find(f => f.querySelector('input[name="operation"][value="edit"]'));
    if (!form) throw new Error('brak formularza edit dla nowego banera');
    const fd = new FormData();
    form.querySelectorAll('input, select, textarea').forEach(el => {
      const n = el.name; if (!n) return;
      const t = el.type;
      if (t === 'submit' || t === 'button' || t === 'file' || t === 'image' || t === 'reset') return;
      if (t === 'radio') { if (el.checked) fd.append(n, el.value); return; }
      if (t === 'checkbox') { if (el.checked) fd.append(n, el.value); return; }
      if (el.tagName === 'SELECT') { fd.append(n, el.value); return; }
      fd.append(n, el.value);
    });
    for (const [slot, { tmpPath, origName }] of Object.entries(uploadedImages)) {
      fd.set(`file_${slot}[name]`, tmpPath);
      fd.set(`file_${slot}[org_name]`, origName);
    }
    const r = await fetch('/panel/config-links.php', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      referrer: refererUrl
    });
    if (!r.ok) throw new Error('commit edit HTTP ' + r.status);
  }

  // IdoSell stores banner-to-shop visibility as a bitmask in shops[].
  // Shop ID N corresponds to bit value 1 << (N-1): shop 1 = 1, shop 2 = 2, shop 3 = 4, ..., shop 7 = 64.
  // Sending shops[]=<rawShopId> works by coincidence only for shops 1 and 2.
  function shopIdToBit(shopId) {
    const n = parseInt(shopId, 10);
    if (!n || n < 1) return 1;
    return 1 << (n - 1);
  }

  async function postBanner(item, dstShopId, overrideRegion, editId) {
    const fd = new FormData();
    fd.append('__iai_shop_panel[__encoding]', 'utf-8');
    let regionWritten = false;
    for (const [k, v] of Object.entries(item)) {
      if (k === '_meta' || k === 'shop' || k === 'operation' || k === 'id' || k === 'shops') continue;
      if (k === 'region') {
        if (overrideRegion) continue;
        regionWritten = true;
      }
      if (Array.isArray(v)) {
        v.forEach(x => fd.append(k + '[]', x));
      } else if (v !== null && v !== undefined) {
        fd.append(k, String(v));
      }
    }
    if (overrideRegion) { fd.append('region', overrideRegion); regionWritten = true; }
    if (!regionWritten) fd.append('region', 'banner');
    fd.append('shops[]', String(shopIdToBit(dstShopId)));
    fd.append('shop', String(dstShopId));
    if (editId) {
      fd.append('operation', 'edit');
      fd.append('id', String(editId));
    } else {
      fd.append('operation', 'add');
    }
    const r = await fetch('/panel/config-links.php', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin'
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    if (/error|błąd|błędy/i.test(txt) && /class="error"/i.test(txt)) {
      throw new Error('Serwer zwrócił błąd walidacji');
    }
  }

  function mountFallbackBar() {
    if (document.getElementById('be-fallback-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'be-fallback-bar';
    bar.style.cssText = [
      'position:fixed;top:12px;right:12px;z-index:999996;',
      'background:#1a1a2e;color:#e0e6ed;padding:8px 12px;border-radius:10px;',
      "font-family:'DM Sans',Arial,sans-serif;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.35);"
    ].join('');
    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'margin:0 4px;padding:6px 10px;border:0;border-radius:6px;background:#4f8cff;color:#fff;font-size:12px;cursor:pointer;font-family:inherit;';
      b.addEventListener('click', onClick);
      return b;
    };
    bar.appendChild(document.createTextNode('Banery: '));
    bar.appendChild(mkBtn('Eksport JSON', () => exportFlow(detectShops())));
    bar.appendChild(mkBtn('Import JSON', () => document.getElementById('be-import-file').click()));
    document.body.appendChild(bar);

    if (!document.getElementById('be-import-file')) {
      const fi = document.createElement('input');
      fi.type = 'file'; fi.id = 'be-import-file'; fi.accept = 'application/json'; fi.style.display = 'none';
      document.body.appendChild(fi);
      fi.addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = '';
        if (f) importFlow(f, detectShops());
      });
    }
    if (!document.getElementById('be-status-box')) {
      const sb = document.createElement('div');
      sb.id = 'be-status-box';
      sb.innerHTML = '<div class="be-sb-head"><span>Banery — log</span></div><div id="be-status"></div>';
      document.body.appendChild(sb);
    }
  }

  // -------- utils --------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
})();
