/* ============================================================================
 * panel-pro v1.2.0
 * Reusable list/tree panel widget for Tampermonkey on IdoSell-style admin pages.
 * ==========================================================================*/
(function (root) {
  'use strict';
  if (root.PanelPro && root.PanelPro.VERSION === '1.2.0') return;

  var VERSION = '1.2.0';
  var STYLE_ID = 'panel-pro-styles-v1_2_0';

  var CSS = [
    /* OpsBar floating cards */
    '.panel-pro__opsbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 12px 0; }',
    '.panel-pro__opsbar-group { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #fff; padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }',
    '.panel-pro__opsbar-label { color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding-right: 4px; }',
    '.panel-pro__opsbar-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; color: #334155; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s; }',
    '.panel-pro__opsbar-btn:hover { background: #f8fafc; border-color: #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }',
    '.panel-pro__opsbar-btn .material-symbols-outlined { font-size: 18px; }',
    '.panel-pro__opsbar-btn--primary { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '.panel-pro__opsbar-btn--primary:hover { background: #1d4ed8; border-color: #1d4ed8; }',
    '.panel-pro__opsbar-btn--danger { color: #dc2626; border-color: #fca5a5; }',
    '.panel-pro__opsbar-btn--danger:hover { background: #fef2f2; border-color: #dc2626; }',

    /* Card panel */
    '.panel-pro { background: #fff; border: 1px solid #dadce0; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; width: 100%; min-width: 0; box-sizing: border-box; font-family: "Google Sans", Roboto, "Segoe UI", Arial, sans-serif; font-size: 14px; color: #202124; margin: 0; }',

    /* Toolbar */
    '.panel-pro__toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #dadce0; }',
    '.panel-pro__toolbar__left { display: flex; align-items: center; gap: 8px; }',
    '.panel-pro__toolbar__right { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }',
    '.panel-pro__group { display: flex; align-items: center; gap: 4px; }',
    '.panel-pro__separator { width: 1px; height: 20px; background: #dadce0; margin: 0 4px; }',
    '.panel-pro__label { color: #80868b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding-right: 4px; }',

    /* Search */
    '.panel-pro__search { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 12px; width: 260px; transition: border-color 0.2s, box-shadow 0.2s, width 0.25s; box-sizing: border-box; }',
    '.panel-pro__search:focus-within { border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1); width: 320px; }',
    '.panel-pro__search .material-symbols-outlined { font-size: 18px; color: #5f6368; flex-shrink: 0; }',
    '.panel-pro__search input { border: none !important; outline: none !important; flex: 1; background: transparent !important; font-size: 14px !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; color: #202124 !important; font-family: inherit; min-width: 0; }',
    '.panel-pro__search input::placeholder { color: #9aa0a6; }',

    /* Buttons */
    '.panel-pro__btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; font-weight: 500; font-family: inherit; color: #334155; transition: background 0.15s; white-space: nowrap; }',
    '.panel-pro__btn:hover:not(:disabled) { background: #f1f5f9; }',
    '.panel-pro__btn:disabled { opacity: 0.5; cursor: not-allowed; }',
    '.panel-pro__btn .material-symbols-outlined { font-size: 18px; color: #5f6368; }',
    '.panel-pro__btn--icon { padding: 5px; }',
    '.panel-pro__btn--icon .material-symbols-outlined { font-size: 20px; }',
    '.panel-pro__btn--text { background: transparent; }',
    '.panel-pro__btn--primary { background: #2563eb; color: #fff; }',
    '.panel-pro__btn--primary:hover:not(:disabled) { background: #1d4ed8; }',
    '.panel-pro__btn--primary .material-symbols-outlined { color: #fff; }',
    '.panel-pro__btn--danger { color: #dc2626; }',
    '.panel-pro__btn--danger:hover:not(:disabled) { background: #fef2f2; }',
    '.panel-pro__btn--danger .material-symbols-outlined { color: #dc2626; }',
    '.panel-pro__btn--accent { color: #1565c0; }',
    '.panel-pro__btn--accent:hover:not(:disabled) { background: #e3f2fd; }',

    /* Dropdown */
    '.panel-pro__dropdown { position: relative; display: inline-block; }',
    '.panel-pro__dropdown__toggle { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border: 1px solid transparent; border-radius: 4px; background: transparent; cursor: pointer; font-size: 13px; color: #334155; font-family: inherit; font-weight: 500; }',
    '.panel-pro__dropdown__toggle:hover { background: #f1f5f9; }',
    '.panel-pro__dropdown__toggle .material-symbols-outlined { font-size: 18px; color: #5f6368; }',
    '.panel-pro__dropdown__menu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 220px; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 10000; display: none; padding: 4px 0; }',
    '.panel-pro__dropdown__menu.panel-pro--open { display: block; }',
    '.panel-pro__dropdown__item { display: flex; align-items: center; padding: 8px 12px; cursor: pointer; font-size: 13px; color: #334155; gap: 8px; }',
    '.panel-pro__dropdown__item:hover { background: #f1f5f9; }',
    '.panel-pro__dropdown__item.panel-pro--active { background: #eff6ff; color: #1d4ed8; font-weight: 600; }',
    '.panel-pro__dropdown__item .material-symbols-outlined { font-size: 16px; width: 16px; opacity: 0; }',
    '.panel-pro__dropdown__item.panel-pro--active .material-symbols-outlined { opacity: 1; }',

    /* Tooltip */
    '[data-pp-tooltip] { position: relative; }',
    '[data-pp-tooltip]::after { content: attr(data-pp-tooltip); position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); background: #323232; color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 6px; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.2); opacity: 0; visibility: hidden; transition: opacity 0.15s, visibility 0.15s; pointer-events: none; z-index: 10001; text-transform: none; letter-spacing: 0; font-weight: 400; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
    '[data-pp-tooltip]:hover::after { opacity: 1; visibility: visible; }',

    /* Header wrapper holds thead + selection bar overlay */
    '.panel-pro__header-wrapper { position: relative; }',

    /* Table header */
    '.panel-pro__thead { display: grid; column-gap: 10px; align-items: center; padding: 12px 0; background: #efefef; border-bottom: 1px solid #dadce0; font-size: 12px; font-weight: 500; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; box-sizing: border-box; }',
    '.panel-pro__thead > div { padding: 0 8px; text-align: center; min-width: 0; }',
    '.panel-pro__thead .panel-pro__col--name { text-align: left; }',
    '.panel-pro__thead .panel-pro__col-hint { font-size: 10px; color: #9aa0a6; font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 6px; }',

    /* Selection bar — display toggle (no transition to avoid CSS conflicts) */
    '.panel-pro__selection-bar { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: #eff6ff; border-bottom: 1px solid #bfdbfe; display: none; column-gap: 10px; align-items: center; z-index: 5; box-sizing: border-box; }',
    '.panel-pro__selection-bar.panel-pro--visible { display: grid; }',
    '.panel-pro__selection-bar > div { padding: 0 8px; min-width: 0; }',
    '.panel-pro__selection-bar__check { display: flex; align-items: center; justify-content: center; }',
    '.panel-pro__selection-bar__check input { accent-color: #1a73e8; width: 16px; height: 16px; cursor: pointer; }',
    '.panel-pro__selection-bar__content { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-width: 0; }',
    '.panel-pro__selection-bar__left { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #1d4ed8; }',
    '.panel-pro__selection-bar__count { background: #fff; color: #1d4ed8; padding: 2px 10px; border-radius: 12px; border: 1px solid #bfdbfe; font-size: 12px; font-weight: 700; }',
    '.panel-pro__selection-bar__right { display: flex; align-items: center; gap: 6px; }',
    '.panel-pro__selection-bar__btn { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; background: #fff; color: #334155; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 0.15s, border-color 0.15s; }',
    '.panel-pro__selection-bar__btn:hover { background: #f1f5f9; border-color: #94a3b8; }',
    '.panel-pro__selection-bar__btn .material-symbols-outlined { font-size: 16px; }',
    '.panel-pro__selection-bar__btn--primary { background: #2563eb; color: #fff; border-color: #2563eb; }',
    '.panel-pro__selection-bar__btn--primary:hover { background: #1d4ed8; border-color: #1d4ed8; }',
    '.panel-pro__selection-bar__btn--danger { color: #dc2626; border-color: #fca5a5; }',
    '.panel-pro__selection-bar__btn--danger:hover { background: #fef2f2; border-color: #dc2626; }',
    '.panel-pro__selection-bar__sep { width: 1px; height: 20px; background: #bfdbfe; margin: 0 4px; }',
    '.panel-pro__selection-bar__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; color: #64748b; border-radius: 4px; margin-left: 4px; transition: background 0.15s; }',
    '.panel-pro__selection-bar__close:hover { background: #dbeafe; color: #1d4ed8; }',
    '.panel-pro__selection-bar__close .material-symbols-outlined { font-size: 20px; }',

    /* Body */
    '.panel-pro__tbody { padding: 0; }',
    '.panel-pro__tbody > ul { list-style: none; margin: 0; padding: 0; }',
    'li.panel-pro__row { display: grid !important; column-gap: 10px; align-items: center; padding: 4px 0 !important; border: none !important; border-radius: 0 !important; border-bottom: 1px solid #e2e8f0 !important; min-height: 37px; transition: background 0.1s; list-style: none !important; margin: 0 !important; box-sizing: border-box; }',
    'li.panel-pro__row > div { padding: 0 8px; min-width: 0; }',
    'li.panel-pro__row:hover { background: #f8fafc; }',
    'li.panel-pro__row.panel-pro--selected { background: #eff6ff; }',
    'li.panel-pro__row.panel-pro--selected:hover { background: #dbeafe; }',
    'li.panel-pro__row.panel-pro--hidden, li.panel-pro__row.panel-pro--filter-hidden, li.panel-pro__row.panel-pro--view-hidden { display: none !important; }',

    /* Status toast */
    '.panel-pro__status { position: fixed; bottom: 20px; right: 20px; background: #323232; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 14px; font-family: inherit; box-shadow: 0 4px 16px rgba(0,0,0,0.25); z-index: 999999; max-width: 400px; animation: panel-pro-fade-in 0.2s ease; }',
    '.panel-pro__status--error { background: #d93025; }',
    '@keyframes panel-pro-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }',

    /* Footer + pagination */
    '.panel-pro__footer { padding: 10px 16px; background: #fff; border-top: 1px solid #dadce0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; font-size: 13px; color: #5f6368; }',
    '.panel-pro__footer:empty { display: none; }',
    '.panel-pro__pagination { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }',
    '.panel-pro__pagination__info { color: #5f6368; font-size: 12px; margin-right: 8px; }',
    '.panel-pro__pagination__btn, .panel-pro__pagination__page { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 30px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; color: #334155; font-family: inherit; }',
    '.panel-pro__pagination__btn:hover:not(:disabled), .panel-pro__pagination__page:hover:not(.panel-pro--active) { background: #f8fafc; border-color: #cbd5e1; }',
    '.panel-pro__pagination__page--active { background: #2563eb !important; color: #fff !important; border-color: #2563eb !important; }',
    '.panel-pro__pagination__btn:disabled { opacity: 0.4; cursor: not-allowed; }',
    '.panel-pro__pagination__per-page select { padding: 4px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #fff; font-size: 13px; font-family: inherit; }',
    ''
  ].join('\n');

  function injectStyles(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  function injectMaterialFont(doc) {
    if (doc.querySelector('link[href*="material-symbols"]')) return;
    var link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap';
    doc.head.appendChild(link);
  }

  function el(doc, tag, attrs, children) {
    var e = doc.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'className') e.className = attrs[k];
        else if (k === 'textContent') e.textContent = attrs[k];
        else if (k === 'innerHTML') e.innerHTML = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') {
          for (var sk in attrs[k]) e.style[sk] = attrs[k][sk];
        }
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') {
          e.addEventListener(k.substring(2).toLowerCase(), attrs[k]);
        }
        else e.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
      });
    }
    return e;
  }

  function icon(doc, name) {
    return el(doc, 'span', { className: 'material-symbols-outlined', textContent: name });
  }

  function buildOpsBarBtn(doc, cfg, ctx) {
    var classes = ['panel-pro__opsbar-btn'];
    if (cfg.variant) classes.push('panel-pro__opsbar-btn--' + cfg.variant);
    var btn = el(doc, 'button', { className: classes.join(' '), type: 'button' });
    if (cfg.tooltip) btn.setAttribute('data-pp-tooltip', cfg.tooltip);
    if (cfg.icon) btn.appendChild(icon(doc, cfg.icon));
    if (cfg.label) btn.appendChild(doc.createTextNode(' ' + cfg.label));
    if (cfg.onClick) btn.addEventListener('click', function (e) { cfg.onClick(e, ctx.api); });
    if (cfg.id) btn.dataset.ppId = cfg.id;
    return btn;
  }

  function buildOpsBar(doc, cfg, ctx) {
    var bar = el(doc, 'div', { className: 'panel-pro__opsbar' });
    function buildSide(side) {
      var group = el(doc, 'div', { className: 'panel-pro__opsbar-group' });
      if (side.label) group.appendChild(el(doc, 'span', { className: 'panel-pro__opsbar-label', textContent: side.label }));
      (side.buttons || []).forEach(function (b) { group.appendChild(buildOpsBarBtn(doc, b, ctx)); });
      return group;
    }
    if (cfg.left) bar.appendChild(buildSide(cfg.left));
    else bar.appendChild(el(doc, 'div'));
    if (cfg.right) bar.appendChild(buildSide(cfg.right));
    else bar.appendChild(el(doc, 'div'));
    return bar;
  }

  function buildButton(doc, cfg, ctx) {
    var classes = ['panel-pro__btn'];
    if (cfg.variant) classes.push('panel-pro__btn--' + cfg.variant);
    var btn = el(doc, 'button', { className: classes.join(' '), type: 'button' });
    if (cfg.tooltip) btn.setAttribute('data-pp-tooltip', cfg.tooltip);
    if (cfg.icon) btn.appendChild(icon(doc, cfg.icon));
    if (cfg.label) btn.appendChild(doc.createTextNode(' ' + cfg.label));
    if (cfg.onClick) btn.addEventListener('click', function (e) { cfg.onClick(e, ctx.api); });
    if (cfg.id) btn.dataset.ppId = cfg.id;
    return btn;
  }

  function buildDropdown(doc, cfg, ctx) {
    var wrap = el(doc, 'div', { className: 'panel-pro__dropdown' });
    var current = (cfg.options || []).find(function (o) { return o.active; }) || (cfg.options || [])[0];
    var toggle = el(doc, 'button', { className: 'panel-pro__dropdown__toggle', type: 'button' });
    if (cfg.icon) toggle.appendChild(icon(doc, cfg.icon));
    var lbl = el(doc, 'span', { className: 'panel-pro__dropdown__label', textContent: current ? current.label : '' });
    toggle.appendChild(lbl);
    toggle.appendChild(icon(doc, 'expand_more'));
    var menu = el(doc, 'div', { className: 'panel-pro__dropdown__menu' });
    function renderItems() {
      menu.innerHTML = '';
      (cfg.options || []).forEach(function (opt) {
        var item = el(doc, 'div', { className: 'panel-pro__dropdown__item' + (opt.active ? ' panel-pro--active' : '') });
        item.appendChild(icon(doc, 'check'));
        item.appendChild(doc.createTextNode(opt.label));
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          (cfg.options || []).forEach(function (o) { o.active = false; });
          opt.active = true;
          lbl.textContent = opt.label;
          menu.classList.remove('panel-pro--open');
          renderItems();
          if (cfg.onChange) cfg.onChange(opt.value, ctx.api);
        });
        menu.appendChild(item);
      });
    }
    renderItems();
    toggle.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('panel-pro--open'); });
    doc.addEventListener('click', function (e) {
      if (!e.target.closest('.panel-pro__dropdown')) menu.classList.remove('panel-pro--open');
    });
    wrap.appendChild(toggle);
    wrap.appendChild(menu);
    return wrap;
  }

  function buildToolbar(doc, cfg, ctx) {
    var toolbar = el(doc, 'div', { className: 'panel-pro__toolbar' });
    var leftWrap = el(doc, 'div', { className: 'panel-pro__toolbar__left' });
    var rightWrap = el(doc, 'div', { className: 'panel-pro__toolbar__right' });

    if (cfg.search) {
      var sb = el(doc, 'div', { className: 'panel-pro__search' });
      sb.appendChild(icon(doc, 'search'));
      var input = el(doc, 'input', { type: 'text', placeholder: cfg.search.placeholder || 'Szukaj...', autocomplete: 'off' });
      if (cfg.search.onChange) input.addEventListener('input', function () { cfg.search.onChange(input.value, ctx.api); });
      sb.appendChild(input);
      leftWrap.appendChild(sb);
    }

    (cfg.sections || []).forEach(function (section, idx) {
      if (idx > 0) rightWrap.appendChild(el(doc, 'div', { className: 'panel-pro__separator' }));
      var group = el(doc, 'div', { className: 'panel-pro__group' });
      if (section.label) group.appendChild(el(doc, 'span', { className: 'panel-pro__label', textContent: section.label }));
      (section.buttons || []).forEach(function (btn) { group.appendChild(buildButton(doc, btn, ctx)); });
      if (section.dropdown) group.appendChild(buildDropdown(doc, section.dropdown, ctx));
      rightWrap.appendChild(group);
    });

    toolbar.appendChild(leftWrap);
    toolbar.appendChild(rightWrap);
    return toolbar;
  }

  function buildSelectionBarBtn(doc, cfg, ctx) {
    var classes = ['panel-pro__selection-bar__btn'];
    if (cfg.variant) classes.push('panel-pro__selection-bar__btn--' + cfg.variant);
    var btn = el(doc, 'button', { className: classes.join(' '), type: 'button' });
    if (cfg.tooltip) btn.setAttribute('data-pp-tooltip', cfg.tooltip);
    if (cfg.icon) btn.appendChild(icon(doc, cfg.icon));
    if (cfg.label) btn.appendChild(doc.createTextNode(' ' + cfg.label));
    if (cfg.onClick) btn.addEventListener('click', function (e) { cfg.onClick(e, ctx.api); });
    return btn;
  }

  function buildSelectionBar(doc, cfg, ctx, columns) {
    var bar = el(doc, 'div', { className: 'panel-pro__selection-bar' });
    var dragWidth = (columns[0] && columns[0].width) || '24px';
    var checkWidth = (columns[1] && columns[1].width) || '40px';
    bar.style.gridTemplateColumns = dragWidth + ' ' + checkWidth + ' 1fr';

    var dragCol = el(doc, 'div');
    var checkCol = el(doc, 'div', { className: 'panel-pro__selection-bar__check' });
    var headerCb = doc.createElement('input');
    headerCb.type = 'checkbox';
    headerCb.checked = true;
    headerCb.addEventListener('change', function () {
      if (cfg.onClear) cfg.onClear(ctx.api);
      ctx.api.setSelection(0);
    });
    checkCol.appendChild(headerCb);

    var contentCol = el(doc, 'div', { className: 'panel-pro__selection-bar__content' });
    var leftCol = el(doc, 'div', { className: 'panel-pro__selection-bar__left' });
    var labelTpl = cfg.selectedLabel || 'Wybrano {n} obiektow';
    leftCol.innerHTML = labelTpl.replace('{n}', '<span class="panel-pro__selection-bar__count">0</span>');

    var rightCol = el(doc, 'div', { className: 'panel-pro__selection-bar__right' });
    (cfg.actions || []).forEach(function (a) { rightCol.appendChild(buildSelectionBarBtn(doc, a, ctx)); });

    if (cfg.extraActions && cfg.extraActions.length) {
      rightCol.appendChild(el(doc, 'span', { className: 'panel-pro__selection-bar__sep' }));
      cfg.extraActions.forEach(function (a) { rightCol.appendChild(buildSelectionBarBtn(doc, a, ctx)); });
    }

    var closeBtn = el(doc, 'button', { className: 'panel-pro__selection-bar__close', type: 'button', title: 'Zamknij' });
    closeBtn.appendChild(icon(doc, 'close'));
    closeBtn.addEventListener('click', function () {
      if (cfg.onClear) cfg.onClear(ctx.api);
      ctx.api.setSelection(0);
    });
    rightCol.appendChild(closeBtn);

    contentCol.appendChild(leftCol);
    contentCol.appendChild(rightCol);

    bar.appendChild(dragCol);
    bar.appendChild(checkCol);
    bar.appendChild(contentCol);
    return bar;
  }

  function updateSelectionBarLabel(bar, count) {
    if (!bar) return;
    var chip = bar.querySelector('.panel-pro__selection-bar__count');
    if (chip) chip.textContent = String(count);
  }

  function buildHeader(doc, columns) {
    var header = el(doc, 'div', { className: 'panel-pro__thead' });
    columns.forEach(function (col) {
      var cell = el(doc, 'div', { className: 'panel-pro__col panel-pro__col--' + col.id });
      if (col.label) cell.appendChild(doc.createTextNode(col.label));
      if (col.hint) cell.appendChild(el(doc, 'span', { className: 'panel-pro__col-hint', textContent: col.hint }));
      header.appendChild(cell);
    });
    return header;
  }

  function gridTemplateFromColumns(columns) {
    return columns.map(function (c) { return c.width || 'auto'; }).join(' ');
  }

  function buildPaginationContainer(doc) {
    return el(doc, 'div', { className: 'panel-pro__pagination', id: 'panel-pro-pagination-' + Math.random().toString(36).slice(2, 9) });
  }

  function paginationRange(page, total) {
    if (total <= 7) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var pages = [1];
    if (page > 3) pages.push('...');
    for (var p = Math.max(2, page - 1); p <= Math.min(total - 1, page + 1); p++) pages.push(p);
    if (page < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  function renderPagination(doc, container, state, opts) {
    container.innerHTML = '';
    var page = state.page;
    var perPage = state.perPage;
    var total = state.total;
    if (total === 0) return;
    var totalPages = perPage === 0 ? 1 : Math.max(1, Math.ceil(total / perPage));
    var start = perPage === 0 ? 1 : (page - 1) * perPage + 1;
    var end = perPage === 0 ? total : Math.min(page * perPage, total);
    container.appendChild(el(doc, 'span', { className: 'panel-pro__pagination__info', textContent: start + '\u2013' + end + ' z ' + total }));
    var prev = el(doc, 'button', { className: 'panel-pro__pagination__btn', type: 'button' });
    prev.appendChild(icon(doc, 'chevron_left'));
    if (page <= 1) prev.disabled = true;
    prev.addEventListener('click', function () { opts.onPageChange(Math.max(1, page - 1)); });
    container.appendChild(prev);
    paginationRange(page, totalPages).forEach(function (p) {
      if (p === '...') {
        container.appendChild(el(doc, 'span', { className: 'panel-pro__pagination__page', textContent: '\u2026', style: { cursor: 'default', border: 'none' } }));
      } else {
        var btn = el(doc, 'button', { className: 'panel-pro__pagination__page' + (p === page ? ' panel-pro__pagination__page--active' : ''), type: 'button', textContent: String(p) });
        btn.addEventListener('click', function () { opts.onPageChange(p); });
        container.appendChild(btn);
      }
    });
    var next = el(doc, 'button', { className: 'panel-pro__pagination__btn', type: 'button' });
    next.appendChild(icon(doc, 'chevron_right'));
    if (page >= totalPages) next.disabled = true;
    next.addEventListener('click', function () { opts.onPageChange(Math.min(totalPages, page + 1)); });
    container.appendChild(next);
    var perWrap = el(doc, 'span', { className: 'panel-pro__pagination__per-page' });
    var sel = el(doc, 'select');
    (opts.perPageOptions || [10, 25, 50, 100, 0]).forEach(function (n) {
      var o = el(doc, 'option', { value: String(n), textContent: n === 0 ? 'Wszystkie' : String(n) });
      if (n === perPage) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { opts.onPerPageChange(parseInt(sel.value, 10)); });
    perWrap.appendChild(sel);
    perWrap.appendChild(doc.createTextNode(' na stron\u0119'));
    container.appendChild(perWrap);
  }

  var _statusTimer = null;
  function showStatus(doc, msg, isError) {
    var existing = doc.querySelector('.panel-pro__status');
    if (existing) existing.remove();
    if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
    var status = el(doc, 'div', { className: 'panel-pro__status' + (isError ? ' panel-pro__status--error' : ''), textContent: msg });
    doc.body.appendChild(status);
    _statusTimer = setTimeout(function () { status.remove(); _statusTimer = null; }, 3500);
  }

  function ensureId(node) {
    if (!node.id) node.id = 'panel-pro-mount-' + Math.random().toString(36).slice(2, 9);
    return node.id;
  }

  function mount(doc, options) {
    if (!doc || !options) throw new Error('PanelPro.mount: doc + options required');
    if (!options.mountTarget) throw new Error('PanelPro.mount: mountTarget required');

    injectStyles(doc);
    injectMaterialFont(doc);

    var columns = options.columns || [];
    var gridTemplate = gridTemplateFromColumns(columns);

    ensureId(options.mountTarget);
    var rowStyleId = 'panel-pro-row-grid-' + Math.random().toString(36).slice(2, 9);
    var rowStyle = doc.createElement('style');
    rowStyle.id = rowStyleId;
    rowStyle.textContent =
      '#' + options.mountTarget.id + ' .panel-pro__thead,' +
      '#' + options.mountTarget.id + ' li.panel-pro__row {' +
      '  grid-template-columns: ' + gridTemplate + ';' +
      '}';
    doc.head.appendChild(rowStyle);

    var ctx = { api: null };
    var opsBar = options.opsBar ? buildOpsBar(doc, options.opsBar, ctx) : null;

    var cardEl = el(doc, 'div', { className: 'panel-pro' });
    var toolbar = options.toolbar ? buildToolbar(doc, options.toolbar, ctx) : null;
    var headerWrapper = el(doc, 'div', { className: 'panel-pro__header-wrapper' });
    var header = buildHeader(doc, columns);
    var selectionBar = options.selectionBar ? buildSelectionBar(doc, options.selectionBar, ctx, columns) : null;
    headerWrapper.appendChild(header);
    if (selectionBar) headerWrapper.appendChild(selectionBar);

    var body = el(doc, 'div', { className: 'panel-pro__tbody' });
    var footer = el(doc, 'div', { className: 'panel-pro__footer' });

    var paginationContainer = null;
    if (options.pagination) {
      paginationContainer = buildPaginationContainer(doc);
      footer.appendChild(paginationContainer);
    }
    if (options.footerSlot) footer.appendChild(options.footerSlot);

    if (toolbar) cardEl.appendChild(toolbar);
    cardEl.appendChild(headerWrapper);
    cardEl.appendChild(body);
    cardEl.appendChild(footer);

    if (opsBar) options.mountTarget.appendChild(opsBar);
    options.mountTarget.appendChild(cardEl);

    if (options.treeRoot) body.appendChild(options.treeRoot);

    var api = {
      version: VERSION,
      root: cardEl,
      opsBar: opsBar,
      toolbar: toolbar,
      tableHeader: header,
      selectionBar: selectionBar,
      body: body,
      footer: footer,
      paginationContainer: paginationContainer,
      columns: columns,
      gridTemplate: gridTemplate,
      applyRowGrid: function (li) { if (li && li.classList) li.classList.add('panel-pro__row'); },
      showStatus: function (msg, isError) { showStatus(doc, msg, isError); },
      renderPagination: function (state, opts) { if (paginationContainer) renderPagination(doc, paginationContainer, state, opts); },
      setSelection: function (count) {
        if (!selectionBar) return;
        if (count > 0) {
          selectionBar.classList.add('panel-pro--visible');
          updateSelectionBarLabel(selectionBar, count);
        } else {
          selectionBar.classList.remove('panel-pro--visible');
        }
      },
      findToolbarBtn: function (id) { return cardEl.querySelector('.panel-pro__btn[data-pp-id="' + id + '"]') || cardEl.querySelector('.panel-pro__opsbar-btn[data-pp-id="' + id + '"]'); },
      destroy: function () {
        cardEl.remove();
        if (opsBar) opsBar.remove();
        var s = doc.getElementById(rowStyleId);
        if (s) s.remove();
      }
    };
    ctx.api = api;
    return api;
  }

  root.PanelPro = { VERSION: VERSION, mount: mount };
})(typeof window !== 'undefined' ? window : this);
