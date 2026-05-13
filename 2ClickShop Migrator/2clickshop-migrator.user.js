// ==UserScript==
// @name         2ClickShop Migrator
// @namespace    https://noblelashes.pl/
// @version      1.6
// @description  Panel boczny do scrapowania i eksportu danych z panelu admina 2ClickShop (kategorie, produkty, klienci, blogi)
// @author       SyncOffer
// @match        https://noblelashes.pl/admin/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // =========================================================================
  // ASSETS (inline base64 — niezależne od zewnętrznych URLi)
  // =========================================================================
  const ASSET_HEADER_BG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABLAAAAABCAYAAADO+FcMAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAADVSURBVHja7JVLDsIwDET77oU4RO/K1Vgh0UWFRMH52JmEIsWbVGN7ZpzWKuvl+mTZ43WmnnlD8vkajLo6bD4Obsr6NdrlfgqecjwEeo6TErgfuZ7Fgb+Hiu8ofWLPQL2eTxe3x91L+h3cHvcvH4u1f9g76cU+91fP2YIh5oti5Os4kZdhGKFeuQ/oOmvv+9BjjNGlVMcJ9ravlx5+QpwofDJwft0/SeFN5c/FQ0x3hFe1fnsOKefve0kmS/2t/tQ1vjqkfN7aSP2MGTP+LzYAAAD//wMAQCIFhJ8oIucAAAAASUVORK5CYII=';
  const ASSET_LOGO = 'data:image/png;base64,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';

  // =========================================================================
  // STYLES
  // =========================================================================
  GM_addStyle(`
    #tcm-handle {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 38px;
      height: 160px;
      background: #e94555;
      color: #fff;
      cursor: pointer;
      z-index: 999998;
      border-radius: 6px 0 0 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: -2px 0 8px rgba(0,0,0,0.25);
      user-select: none;
      transition: background 0.2s;
      overflow: hidden;
    }
    #tcm-handle:hover { background: #d63848; }
    #tcm-handle img {
      width: 120px;
      height: auto;
      transform: rotate(-90deg);
      pointer-events: none;
      filter: brightness(0) invert(1);
    }
    #tcm-panel {
      position: fixed;
      right: -380px;
      top: 0;
      width: 380px;
      height: 100vh;
      background: #f8fafc;
      box-shadow: -4px 0 16px rgba(0,0,0,0.15);
      z-index: 999999;
      transition: right 0.3s ease;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #tcm-panel.open { right: 0; }
    #tcm-header {
      padding: 0;
      height: 71px;
      background-color: #2b2b2b;
      color: #fff;
      display: flex;
      align-items: center;
      box-sizing: border-box;
    }
    #tcm-logo-area {
      width: 180px;
      height: 100%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    #tcm-logo {
      height: 33px;
      width: auto;
      display: block;
    }
    #tcm-title {
      flex: 1;
      margin: 0;
      font-size: 17px;
      font-weight: 600;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.6);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #tcm-close {
      background: rgba(0,0,0,0.35);
      border: 1px solid rgba(255,255,255,0.2);
      color: #fff;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      flex-shrink: 0;
      margin-right: 16px;
    }
    #tcm-close:hover { background: rgba(0,0,0,0.55); }
    #tcm-breadcrumb {
      padding: 8px 20px;
      background: #e2e8f0;
      font-size: 12px;
      color: #475569;
      display: none;
    }
    #tcm-breadcrumb.visible { display: block; }
    #tcm-breadcrumb a { color: #1e40af; cursor: pointer; text-decoration: none; }
    #tcm-breadcrumb a:hover { text-decoration: underline; }
    #tcm-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .tcm-menu-item {
      display: flex;
      align-items: center;
      padding: 14px 16px;
      margin-bottom: 8px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      gap: 12px;
    }
    .tcm-menu-item:hover {
      background: #eff6ff;
      border-color: #3b82f6;
      transform: translateX(-2px);
    }
    .tcm-menu-icon {
      width: 32px;
      height: 32px;
      background: #dbeafe;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    .tcm-menu-label { font-size: 14px; font-weight: 500; color: #1e293b; flex: 1; }
    .tcm-menu-count { font-size: 12px; color: #64748b; }
    .tcm-section-title {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 0 0 12px 0;
    }
    .tcm-btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .tcm-btn:hover { background: #2563eb; }
    .tcm-btn-secondary { background: #fff; color: #475569; border: 1px solid #cbd5e1; }
    .tcm-btn-secondary:hover { background: #f1f5f9; }
    .tcm-btn-sm { padding: 4px 8px; font-size: 12px; }
    .tcm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .tcm-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .tcm-list { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    .tcm-list-item {
      padding: 10px 14px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .tcm-list-item:last-child { border-bottom: none; }
    .tcm-list-item:hover { background: #f8fafc; }
    .tcm-list-id { color: #94a3b8; font-family: monospace; font-size: 11px; min-width: 40px; }
    .tcm-list-name { flex: 1; color: #1e293b; }
    .tcm-progress {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      font-size: 12px;
    }
    .tcm-progress-bar {
      height: 6px;
      background: #e2e8f0;
      border-radius: 3px;
      overflow: hidden;
      margin-top: 6px;
    }
    .tcm-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      transition: width 0.2s;
    }
    .tcm-log {
      font-family: monospace;
      font-size: 11px;
      background: #1e293b;
      color: #cbd5e1;
      padding: 10px;
      border-radius: 6px;
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      margin-top: 12px;
    }
    .tcm-empty {
      text-align: center;
      padding: 40px 20px;
      color: #94a3b8;
      font-size: 13px;
    }
    .tcm-badge {
      display: inline-block;
      background: #fef3c7;
      color: #92400e;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }
  `);

  // =========================================================================
  // STATE
  // =========================================================================
  const state = {
    currentView: 'menu',
    blogList: GM_getValue('tcm_blogList', null),
  };

  // =========================================================================
  // UI HELPERS
  // =========================================================================
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function showBreadcrumb(items) {
    const bc = document.getElementById('tcm-breadcrumb');
    if (!items || items.length === 0) {
      bc.classList.remove('visible');
      bc.innerHTML = '';
      return;
    }
    bc.classList.add('visible');
    bc.innerHTML = '';
    items.forEach((it, i) => {
      if (i > 0) bc.appendChild(document.createTextNode(' / '));
      if (it.onClick) {
        const a = document.createElement('a');
        a.textContent = it.label;
        a.onclick = it.onClick;
        bc.appendChild(a);
      } else {
        bc.appendChild(document.createTextNode(it.label));
      }
    });
  }

  function setContent(node) {
    const c = document.getElementById('tcm-content');
    c.innerHTML = '';
    c.appendChild(node);
  }

  // =========================================================================
  // VIEWS
  // =========================================================================
  const MENU = [
    { id: 'categories', label: 'Kategorie produktów', icon: '📂', impl: false },
    { id: 'products', label: 'Produkty', icon: '📦', impl: false },
    { id: 'customers', label: 'Klienci', icon: '👥', impl: false },
    { id: 'blogCategories', label: 'Kategorie blogów', icon: '📑', impl: false },
    { id: 'blogs', label: 'Blogi', icon: '✍️', impl: true },
  ];

  function renderMenu() {
    state.currentView = 'menu';
    showBreadcrumb(null);
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Moduły migracji'));
    MENU.forEach(item => {
      const node = el('div', {
        class: 'tcm-menu-item',
        onClick: () => openModule(item.id),
      }, [
        el('div', { class: 'tcm-menu-icon' }, item.icon),
        el('div', { class: 'tcm-menu-label' }, item.label),
        item.impl
          ? el('span', { class: 'tcm-menu-count' }, '✓ gotowe')
          : el('span', { class: 'tcm-badge' }, 'placeholder'),
      ]);
      wrap.appendChild(node);
    });
    setContent(wrap);
  }

  function openModule(id) {
    const item = MENU.find(m => m.id === id);
    if (!item.impl) {
      renderPlaceholder(item);
      return;
    }
    if (id === 'blogs') renderBlogs();
  }

  function renderPlaceholder(item) {
    state.currentView = item.id;
    showBreadcrumb([
      { label: '← Menu', onClick: renderMenu },
      { label: item.label },
    ]);
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'tcm-empty' }, `Moduł "${item.label}" — w przygotowaniu (v1.x)`));
    setContent(wrap);
  }

  // =========================================================================
  // BLOGS MODULE
  // =========================================================================
  function renderBlogs() {
    state.currentView = 'blogs';
    showBreadcrumb([
      { label: '← Menu', onClick: renderMenu },
      { label: 'Blogi' },
    ]);
    const wrap = el('div');

    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Akcje'));

    const actions = el('div', { class: 'tcm-actions' });
    actions.appendChild(el('button', {
      class: 'tcm-btn',
      onClick: scrapeBlogList,
    }, 'Pobierz listę z admina'));
    actions.appendChild(el('button', {
      class: 'tcm-btn tcm-btn-secondary',
      onClick: exportBlogListJSON,
    }, 'Eksport listy (JSON)'));
    if (state.blogList && state.blogList.length) {
      actions.appendChild(el('button', {
        class: 'tcm-btn tcm-btn-secondary',
        onClick: clearBlogList,
      }, 'Wyczyść'));
    }
    wrap.appendChild(actions);

    const progress = el('div', { id: 'tcm-blog-progress' });
    wrap.appendChild(progress);

    if (!state.blogList || state.blogList.length === 0) {
      wrap.appendChild(el('div', { class: 'tcm-empty' }, 'Brak danych. Kliknij "Pobierz listę z admina" aby zacząć.'));
    } else {
      const meta = el('div', { class: 'tcm-section-title' }, `Lista wpisów (${state.blogList.length})`);
      wrap.appendChild(meta);
      const list = el('div', { class: 'tcm-list' });
      state.blogList.slice(0, 100).forEach(b => {
        list.appendChild(el('div', { class: 'tcm-list-item' }, [
          el('span', { class: 'tcm-list-id' }, '#' + b.id),
          el('span', { class: 'tcm-list-name' }, b.name || '(brak)'),
        ]));
      });
      wrap.appendChild(list);
      if (state.blogList.length > 100) {
        wrap.appendChild(el('div', { class: 'tcm-empty' },
          `... + ${state.blogList.length - 100} wpisów (eksportuj JSON aby zobaczyć wszystkie)`));
      }
    }

    setContent(wrap);
  }

  async function scrapeBlogList() {
    const progress = document.getElementById('tcm-blog-progress');
    progress.innerHTML = '';
    const box = el('div', { class: 'tcm-progress' });
    const label = el('div', {}, 'Pobieranie strony 1...');
    const bar = el('div', { class: 'tcm-progress-bar' });
    const fill = el('div', { class: 'tcm-progress-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
    progress.appendChild(box);

    const all = [];
    const maxPages = 100;
    try {
      for (let p = 1; p <= maxPages; p++) {
        label.textContent = `Pobieranie strony ${p}...`;
        const url = `/admin/index.php?k=news&w=blog&page=${p}`;
        const res = await fetch(url, { credentials: 'include' });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll("tr[id^='news_']");
        if (rows.length === 0) break;
        rows.forEach(tr => {
          const id = tr.id.replace('news_', '');
          const tds = tr.querySelectorAll('td');
          if (tds.length < 3) return;
          all.push({
            id,
            order: tds[0]?.textContent.trim().replace('.', '') || '',
            name: tds[1]?.textContent.trim().slice(0, 200) || '',
            key: tds[2]?.textContent.trim() || '',
            category: tds[4]?.textContent.trim() || '',
          });
        });
        fill.style.width = Math.min(p * 5, 95) + '%';
      }
      fill.style.width = '100%';
      label.textContent = `✓ Pobrano ${all.length} wpisów`;
      state.blogList = all;
      GM_setValue('tcm_blogList', all);
      setTimeout(renderBlogs, 600);
    } catch (e) {
      label.textContent = '✗ Błąd: ' + e.message;
    }
  }

  function exportBlogListJSON() {
    if (!state.blogList || !state.blogList.length) {
      alert('Najpierw pobierz listę z admina.');
      return;
    }
    const blob = new Blob([JSON.stringify(state.blogList, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blogs_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearBlogList() {
    if (!confirm('Wyczyścić zapisaną listę blogów?')) return;
    state.blogList = null;
    GM_setValue('tcm_blogList', null);
    renderBlogs();
  }

  // =========================================================================
  // PANEL CREATION
  // =========================================================================
  function createPanel() {
    if (document.getElementById('tcm-panel')) return;

    const handle = el('div', { id: 'tcm-handle', title: 'Migrator' }, [
      el('img', { src: ASSET_LOGO, alt: '' }),
    ]);
    const panel = el('div', { id: 'tcm-panel' });
    const header = el('div', { id: 'tcm-header' }, [
      el('div', { id: 'tcm-logo-area' }, [
        el('img', {
          id: 'tcm-logo',
          src: ASSET_LOGO,
          alt: 'logo',
        }),
      ]),
      el('h2', { id: 'tcm-title' }, 'Migrator'),
      el('button', { id: 'tcm-close', onClick: () => panel.classList.remove('open') }, '×'),
    ]);
    const breadcrumb = el('div', { id: 'tcm-breadcrumb' });
    const content = el('div', { id: 'tcm-content' });

    panel.appendChild(header);
    panel.appendChild(breadcrumb);
    panel.appendChild(content);

    document.body.appendChild(handle);
    document.body.appendChild(panel);

    handle.onclick = () => panel.classList.toggle('open');

    renderMenu();
  }

  createPanel();
})();
