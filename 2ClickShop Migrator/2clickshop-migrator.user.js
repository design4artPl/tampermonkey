// ==UserScript==
// @name         2ClickShop Migrator
// @namespace    https://noblelashes.pl/
// @version      1.0
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
  // STYLES
  // =========================================================================
  GM_addStyle(`
    #tcm-handle {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 28px;
      height: 90px;
      background: linear-gradient(135deg, #1e3a8a, #3b82f6);
      color: #fff;
      cursor: pointer;
      z-index: 999998;
      border-radius: 6px 0 0 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      letter-spacing: 1px;
      box-shadow: -2px 0 8px rgba(0,0,0,0.2);
      user-select: none;
      transition: background 0.2s;
    }
    #tcm-handle:hover { background: linear-gradient(135deg, #1e40af, #2563eb); }
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
      padding: 16px 20px;
      background: linear-gradient(135deg, #1e3a8a, #3b82f6);
      color: #fff;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #tcm-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
    #tcm-close {
      background: rgba(255,255,255,0.2);
      border: none;
      color: #fff;
      width: 28px;
      height: 28px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    #tcm-close:hover { background: rgba(255,255,255,0.35); }
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

    const handle = el('div', { id: 'tcm-handle', title: '2ClickShop Migrator' }, '2ClickShop Migrator');
    const panel = el('div', { id: 'tcm-panel' });
    const header = el('div', { id: 'tcm-header' }, [
      el('h2', {}, '2ClickShop Migrator'),
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
