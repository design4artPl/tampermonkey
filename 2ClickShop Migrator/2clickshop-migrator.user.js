// ==UserScript==
// @name         2ClickShop Migrator
// @namespace    https://noblelashes.pl/
// @version      1.33
// @description  Panel boczny do scrapowania i eksportu danych z panelu admina 2ClickShop (kategorie, produkty, opinie, klienci, blogi)
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
  const ASSET_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI0AAAAhCAYAAADkgCgwAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAAqjSURBVHja7Jx7lFVVHcc/59w7MwzMMD4oSkmrBUtegSAhJIUhCARUlJSASFYrTXwCKmUkCfJoaaKuBYSGUC4xXJJSaCEKJYsoHgUCJvJGQWIYHiOvedzdH+d75m7OnHPvnTugNN7fWnfNOfeevc8+e39/39/399tnjbO/z3WksB7gDAa6Aq2AOLAbWAvmRWAxGVgjA01ffZ6cNQyLR3yfB85UYHTIbxcCncD5ITAfzM1AeW4qc6CZGABMAtgFVAOftdoNBacKzI2pbuLm5rlBmQsOOKcta3dw7rPOV4HpDqYdmC+A6QLmdev3EcC1yVMn4pOzhsU08RhUGTAGoB3wV7FKhcLPbqvNemA4sAH4hIAyHMyS3HR+7MKTzwbmKe9jWy2meB94FRim8/Y5Nvn4gSYfKLAAYiPARLQ9YB0XACXSPtXA8dzUNmzQ9KOqejrGFAsgjqVdjYAQZk2t41bAJrWtBKbrk7MGCpohGHNZPfvJBy62zm/0QeMCxxwoys11gwKNH4r2ADPqAJJ7gSY6fwOv0PctvEJgDTsVGFha4DL49PZXAH2AzwEx3ft19XMmrESCHmAvsDPweyFwoh79FwId5RPvqRxxNqw9UAysA06dS6DxQ9EuYGr6JgZgJDiFyS/MGHBWAxcJNK7PMuUOLG4Us0EzRYALlm8mAHOAH0kXhVmeQmFL4FNAGbAD2A4csq7rCvjZ3HTgbut5HwEGAIuAsSnCbyr7PPB3HT8M3FPH9hcAbfUc/tzvErjt8cwBvqj77TiXQBOPSpEiAPNNcH6dXHQzH1itC2LWXzffkFiT77IvVtP1KGBcsv7D7wSQYcBXgO8Da0MYL6aFGQ60pnZRcp8WcbQm30QI+RbAHTq+G3gIOJjFvBmNO5YiUYgC/UTgB0CzkN83A3cCS3WeSJOMfGSg8Re6Og1YAG4A58lkpsXbFggAqvTXBVwHEhvzXP9LB2gDrAT+67EVR3X9swJRW+A2YK6VgTUD5gO9rfscEcs0xdvW+LTYY1SqwQP7da/ewMvW/ckSOHVd0FlyjFIx3n80V58Ro3wJqMggcz1nQJNIPd+MA2eKdf4umCGeHqlhkmqLGZwE0LkywYp81+/stohxlAOzFUraiI43CpzPWIDZBvwKeBE4LE3VAxgi+n4/zfOeEFvVV9NkY20EmL3ANQJM0JpnyXwfWXiqjgBMHjhzSRbyRKNmkLQEEUzjnHKgS0WCTvkZyYaDVh/+WIYBfXW8ScfvWW2OA3/QJxNzpIViuse+FJqjpViuUtdtr0P9Ka5Q6Jcvtkn8A7wSARifCcOs2ipzXKz+DwqA6Z73ErFxpeauLOK6YrHcSX13kUBchbcjcARrcVOFpybg/CkAmJfB9EoCxgl7uJiveRLAwJMZgabYAs1R9THKQvBdAcBkY3kKS29LCAe1UZH01EbgH8oIl+BtnWwCemZwDxdYIH3ylrQawDH9bVzHMVdpnI8qy9yMt4WzWxln14h2I5R17ZRO3KDjuQJ0cO7XA5PlVH/xIgnr1G6r7t8oBdMYvAuc+Zy2GclTYEYl464T5RGu/2OFAy2rEpkwwAgdb1CYaWd551Zg+Rli1yItXFFIsfIl4GprsbYrRF6qz54MnmMe1CSLDwBP63idvL2vtMvKDHVTJfBboJP02FsCfy/1tQi4Smzm273ANAF1lpitSGWOkdJPfQUMf9zNgEFAP2Fimhi2hdbmLjHPSFvTVAWef5I68e1BMA+kechaTJOhmrsD6K7jmeqntfX78trjy9qqI5j1xxZglilbe1ML9GXVfrZHAMW3x71koaa08KD12y7ptlHy5InAc5y+GRw21kLVa64QQ/r2S+CPwEDgu2IJv7YzVaHuawKrbw+pRDBGjPoNa3nKFZLXiB1tzTcDWAEMBV4KCU8GZSJjLMDfGg6YWnA4ZQvhmidPnczfTnLLYbGEL9TsoEMKDXCmrFigQaFxuCi9Qt76Z+D3KcIHWjRf6D8G/DTk2juVNRXKk7foea9OM75HAoDx7VELKL7dqrmfHACMb+MF/kEBx4xZDhxMEnZaDnB9mKaJgWN5iJkk70+XjtugcW2mKTCRsX+GvBMtzPXWIsRCFuZsWVuFH6Rh9tWh7bvKin4iCfe4VUwMY46xwOVigzIBdJmq4d1D5ggxSqrkwa/M5wP9LbaMyiAX6vjKgHgvk54Ls0Vyog6u6NdemMFAZx2/I2RmWLKoqTHUME0MOOyECWxesLx7Ht4WxAfWNfbxhWcZNJ+0jlfXse0gy+NPiP7TReSNAll74HsS3T3kOB1DQHM0hYayF6BYc3WC099CCNpuq9hp3+sw0dsVR1VfahYXOuUFBuDbFhi26GFiGSj8lQGmcQDyDbzSKFYT6EXN8y29NCWCyu1M6aoPofQQBH6m1i/gDE8CX8+wnzI5zHNeksENCisDU1S1U1nMKidUpVkvLMKw7xN1r4REeTxuNfQzog4WkAdI36SzY2DOA+eYLYQd4IQDq/JdGzS/EGASYprZEX1uVl2ksdR+8xR1jPqazWot6tj2mELOJWKPvsD9ypwytVN4e2/DgG7KdLJ5Wf+4xnOB+iiNuK7EqqzbgGkiPFSGtCkAzgM+cAOgyVc1Npv6hxMQwvEYUOY6lCb3nnppggFuSgEYlN4utNLhcWeRaXZYEzWQur2GOEdp7USSm5jjgeuyAF91MInIAvzr1Ueq1126WY5ps0+zQAISrGiXADttpqn2aNq8phBSFysXUm1Nk5dnYEvc4WhyCm7RhCxS7SGdPSbvc1UnOKVMK7hdcJli+cosJ3ubBPAA9TVaGYttXZQ2HwhZbF/PjJQmKtHY10sXZmJ9tBYbA8xXV5uFt+3ip/ZhgBkgFloVEOlxvLcM7g9p5zvtazZoXHCOgxmY3VgdP+75oMkH2BNz/S/PtyqqTRS73YiOZmsh1yj194XmfRKOy6UHCrXIXeTlPbOcaKNspp/G/jDe/tA6VUE76vzKENDYz/CO0uq5KsPPEbtWKvw0xntpf7tEp5EI7w1MUh8TyO51DaxM6w1JgJl4e3V7tc7dgCcEjvEagz3vFQqxe1ToPKJ1u1k1nQPAb2zQnIqo8majDWJAnsF7a89NeqqfpVyjT5Qtsyqc0zX4CdINzVXMCtqhCGHbKKQmQ0hFeAXeG4dPSBP0t9JXO131gRKP6H+ewHuTkohZ8t5LBfh7Qgqhfvp8O8nXIuwxuimEL5y+NVGhTHSBmP0WsUqhnLUa+LnGRWCe3sTbmpipcshBgSamPoYC2+zsqUR6xqmHt7awQeNoZuU2JzWgdF7khoSfp4X8nsqkLlfXh4B/6/PPgIj2tdOaAAX/TKAoDRnLs/LS/sBX8V65OKGUeIlVZNynWkwscF+7wr1WC+FoUcfi7c530scvI2wC/qa5CdaHJmsMpSl031i8bRbbShXurhXjdJKEWKoC6qaI/orwtiAWAt8RM5Xj7de9oJoUzv4+Q8p1cbVotD6giVnM1Tkf/rU15jKtOM7zC54hZ+eslajqWyrBW5WuPuF7ViyDekymtgXYUwG0qkrQujKRW5b/H0tLGnGlhh3OIGCM6LLUjzXnm9xKNCSLqyC06mzdwNQzFcjZh2Z5RP9DiFqgyVnODN572xm9avq/AQC4Jsm55It2rgAAAABJRU5ErkJggg==';

  // =========================================================================
  // STYLES
  // =========================================================================
  GM_addStyle(`
    #tcm-handle {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 50px;
      height: 160px;
      background: #944149;
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
    #tcm-handle:hover { background: #7d363d; }
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
      background-color: #944149;
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
    #tcm-footer {
      padding: 10px 16px;
      background: #f1f5f9;
      border-top: 1px solid #e2e8f0;
      font-size: 11px;
      color: #64748b;
      text-align: center;
      flex-shrink: 0;
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
    .tcm-info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 16px;
    }
    .tcm-lang-switch {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .tcm-lang-btn {
      background: #fff;
      border: 1px solid #cbd5e1;
      color: #64748b;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    .tcm-lang-btn:hover { background: #f1f5f9; }
    .tcm-lang-btn.has-data {
      color: #1e293b;
      border-color: #94a3b8;
    }
    .tcm-lang-btn.active {
      background: #944149;
      color: #fff;
      border-color: #944149;
    }
    .tcm-pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 12px;
      padding: 8px 0;
    }
    .tcm-pager-info {
      font-size: 12px;
      color: #475569;
      font-weight: 600;
    }
    .tcm-stats {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .tcm-stats-total {
      padding: 10px 12px;
      background: #fef2f4;
      border-bottom: 1px solid #e2e8f0;
      font-size: 13px;
      color: #475569;
    }
    .tcm-stats-total strong { color: #944149; font-size: 16px; }
    .tcm-stats-loading {
      padding: 12px;
      color: #94a3b8;
      font-size: 12px;
      text-align: center;
    }
    .tcm-stats-row {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
      gap: 8px;
    }
    .tcm-stats-row:last-child { border-bottom: none; }
    .tcm-stats-lang {
      font-weight: 700;
      color: #944149;
      width: 32px;
      flex-shrink: 0;
    }
    .tcm-stats-pages { color: #64748b; min-width: 70px; }
    .tcm-stats-count { color: #475569; flex: 1; }
    .tcm-stats-downloaded {
      font-size: 11px;
      color: #94a3b8;
      font-style: italic;
    }
    .tcm-stats-downloaded.ok {
      color: #16a34a;
      font-style: normal;
      font-weight: 600;
    }
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
    .tcm-list-name.tcm-list-empty { color: #cbd5e1; font-style: italic; }
    .tcm-list-badges { display: flex; gap: 2px; flex-shrink: 0; }
    .tcm-badge-lang {
      font-size: 9px;
      font-weight: 700;
      padding: 2px 4px;
      background: #f1f5f9;
      color: #94a3b8;
      border-radius: 3px;
      letter-spacing: 0.5px;
    }
    .tcm-badge-lang.active { background: #944149; color: #fff; }
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
  const BLOG_LANGS = ['pl', 'en', 'de', 'ua', 'cz', 'pt', 'fr'];
  const BLOG_PAGE_SIZE = 25;
  const BLOG_DOMAINS = {
    pl: 'https://noblelashes.pl',
    en: 'https://noblelashes.eu',
    de: 'https://noble-lashes.de',
    ua: 'https://noblelashes.com.ua',
    cz: 'https://noblelashes.cz',
    pt: 'https://noblelashes.pl',
    fr: 'https://noblelashes.pl',
  };
  const LANG_CLASS_MAP = {pl:'pl_PL', en:'en_EN', de:'de_DE', ua:'ua_UA', cz:'cz_CZ', pt:'pt_PT', fr:'fr_FR'};

  const state = {
    currentView: 'menu',
    blogData: GM_getValue('tcm_blogData', {}),
    blogDetails: cleanBlogDetails(GM_getValue('tcm_blogDetails', {})),
    blogLang: 'pl',
    blogPage: 1,
    blogStats: null,
    reviewData: GM_getValue('tcm_reviewData', {}),
    reviewLang: 'pl',
    reviewPage: 1,
    reviewStats: null,
    productSlugMap: GM_getValue('tcm_productSlugMap', {}),
    productNameMap: GM_getValue('tcm_productNameMap', {}),
    reviewConfig: migrateReviewConfig(GM_getValue('tcm_reviewConfig', null)),
  };

  function migrateReviewConfig(cfg) {
    const defaults = {
      shopIdByLang: { pl: '1', en: '', de: '', ua: '', cz: '', pt: '', fr: '' },
      defaultLanguage: 'pol',
      forceConfirmedByPurchase: 'auto',
    };
    if (!cfg || typeof cfg !== 'object') return defaults;
    // Migracja starego pojedynczego shopId → shopIdByLang (kopiujemy do PL i pustych pozostałych)
    if (cfg.shopId && !cfg.shopIdByLang) {
      cfg.shopIdByLang = { ...defaults.shopIdByLang, pl: cfg.shopId };
      delete cfg.shopId;
    }
    return { ...defaults, ...cfg, shopIdByLang: { ...defaults.shopIdByLang, ...(cfg.shopIdByLang || {}) } };
  }

  function cleanBlogDetails(d) {
    if (!d || typeof d !== 'object') return {};
    const out = {};
    Object.entries(d).forEach(([k, v]) => {
      // Klucz musi być liczbowy (id wpisu), wartość musi być obiektem
      if (!/^\d+$/.test(String(k))) return;
      if (!v || typeof v !== 'object') return;
      out[k] = v;
    });
    return out;
  }

  // =========================================================================
  // UI HELPERS
  // =========================================================================
  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
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
    { id: 'reviews', label: 'Opinie o produktach', icon: '⭐', impl: true },
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
    else if (id === 'reviews') renderReviews();
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
  function blogListForCurrentLang() {
    return (state.blogData && state.blogData[state.blogLang]) || [];
  }

  function renderBlogs() {
    const firstEntry = state.currentView !== 'blogs';
    state.currentView = 'blogs';
    showBreadcrumb([
      { label: '← Menu', onClick: renderMenu },
      { label: 'Blogi' },
    ]);
    const wrap = el('div');

    // Statystyki per język
    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Dostępne dane'));
    const statsBox = el('div', { id: 'tcm-blog-stats', class: 'tcm-stats' });
    renderBlogStats(statsBox);
    wrap.appendChild(statsBox);

    // Language switcher
    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Język'));
    const langSwitch = el('div', { class: 'tcm-lang-switch' });
    BLOG_LANGS.forEach(code => {
      const detailsCountForLang = Object.values(state.blogDetails)
        .filter(d => d.name && d.name[code]).length;
      const basicCountForLang = (state.blogData[code] || []).length;
      const has = basicCountForLang > 0 || detailsCountForLang > 0;
      const count = basicCountForLang || detailsCountForLang;
      const btn = document.createElement('button');
      btn.className = 'tcm-lang-btn'
        + (state.blogLang === code ? ' active' : '')
        + (has ? ' has-data' : '');
      btn.textContent = code.toUpperCase() + (count ? ` (${count})` : '');
      btn.type = 'button';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        state.blogLang = code;
        state.blogPage = 1;
        renderBlogs();
      });
      langSwitch.appendChild(btn);
    });
    wrap.appendChild(langSwitch);

    // Actions
    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Akcje'));
    const actions = el('div', { class: 'tcm-actions' });
    const detailsCount = Object.keys(state.blogDetails).length;
    const langStat = state.blogStats && state.blogStats[state.blogLang];
    const langCount = langStat ? langStat.exactCount : 0;
    const allCount = state.blogStats
      ? BLOG_LANGS.reduce((s, l) => s + ((state.blogStats[l]?.exactCount) || 0), 0)
      : 0;

    actions.appendChild(el('button', {
      class: 'tcm-btn',
      style: { background: '#944149' },
      onClick: () => scrapeBlogAll(state.blogLang),
    }, langCount
      ? `Pobierz wpisy ${state.blogLang.toUpperCase()} (${langCount})`
      : `Pobierz wpisy ${state.blogLang.toUpperCase()}`));

    actions.appendChild(el('button', {
      class: 'tcm-btn tcm-btn-secondary',
      onClick: () => scrapeBlogAll('__all__'),
    }, allCount
      ? `Pobierz wpisy wszystkich języków (${allCount} łącznie)`
      : 'Pobierz wpisy wszystkich języków'));

    if (detailsCount > 0) {
      const statusInfo = el('div', { class: 'tcm-info' },
        `Pobrane pełne dane: ${detailsCount} wpisów`);
      wrap.appendChild(actions);
      wrap.appendChild(statusInfo);
    } else {
      wrap.appendChild(actions);
    }

    // Export row
    const exports = el('div', { class: 'tcm-actions' });
    exports.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportBlog('json') }, 'JSON'));
    exports.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportBlog('csv') }, 'CSV'));
    exports.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportBlog('xml') }, 'XML'));
    if (Object.keys(state.blogData).length > 0 || detailsCount > 0) {
      exports.appendChild(el('button', {
        class: 'tcm-btn tcm-btn-secondary',
        onClick: clearBlogList,
      }, 'Wyczyść'));
    }
    wrap.appendChild(exports);

    const progress = el('div', { id: 'tcm-blog-progress' });
    wrap.appendChild(progress);

    // List for current language - prefer details if available, fallback to other lang lists
    const lang = state.blogLang;
    const detailsArr = Object.values(state.blogDetails);
    let list;
    let listSource = '';
    if (detailsArr.length > 0) {
      list = detailsArr.map(d => {
        const availableLangs = BLOG_LANGS.filter(l => d.name && d.name[l] && d.name[l].length > 0);
        const nameInLang = d.name && d.name[lang];
        return {
          id: d.id,
          name: nameInLang || (d.name && d.name.pl) || '(brak)',
          hasInLang: !!nameInLang,
          availableLangs,
          key: (d.key && d.key[lang]) || '',
          category: (d.categories && d.categories[0] && d.categories[0][lang]) || (d.sub || ''),
        };
      }).sort((a, b) => parseInt(a.id) - parseInt(b.id));
      listSource = `pełne dane (${lang.toUpperCase()})`;
    } else if ((state.blogData[lang] || []).length > 0) {
      list = state.blogData[lang].map(b => ({ ...b, hasInLang: b.hasTranslation }));
      listSource = `lista podstawowa (${lang.toUpperCase()})`;
    } else if ((state.blogData.pl || []).length > 0) {
      list = state.blogData.pl.map(b => ({ ...b, hasInLang: b.hasTranslation }));
      listSource = `lista PL (fallback - brak ${lang.toUpperCase()})`;
    } else {
      list = [];
    }
    if (list.length === 0) {
      wrap.appendChild(el('div', { class: 'tcm-empty' }, `Brak żadnych pobranych danych. Kliknij "Pobierz listę" aby zacząć.`));
    } else {
      const totalPages = Math.ceil(list.length / BLOG_PAGE_SIZE);
      const cur = Math.min(state.blogPage, totalPages);
      const start = (cur - 1) * BLOG_PAGE_SIZE;
      const end = Math.min(start + BLOG_PAGE_SIZE, list.length);
      wrap.appendChild(el('div', { class: 'tcm-section-title' },
        `Lista – ${listSource} – ${list.length} wpisów, strona ${cur}/${totalPages}`));
      const listEl = el('div', { class: 'tcm-list' });
      list.slice(start, end).forEach(b => {
        const children = [
          el('span', { class: 'tcm-list-id' }, '#' + b.id),
          el('span', {
            class: 'tcm-list-name' + (b.hasInLang === false ? ' tcm-list-empty' : '')
          }, b.name || '(brak tłumaczenia)'),
        ];
        if (b.availableLangs && b.availableLangs.length) {
          const badges = el('span', { class: 'tcm-list-badges' });
          b.availableLangs.forEach(l => {
            badges.appendChild(el('span', {
              class: 'tcm-badge-lang' + (l === lang ? ' active' : '')
            }, l.toUpperCase()));
          });
          children.push(badges);
        }
        listEl.appendChild(el('div', { class: 'tcm-list-item' }, children));
      });
      wrap.appendChild(listEl);

      // Pagination controls
      if (totalPages > 1) {
        const pager = el('div', { class: 'tcm-pager' });
        pager.appendChild(el('button', {
          class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
          disabled: cur === 1 ? '' : null,
          onClick: () => { if (cur > 1) { state.blogPage = cur - 1; renderBlogs(); } },
        }, '‹ Poprzednia'));
        pager.appendChild(el('span', { class: 'tcm-pager-info' }, `${cur} / ${totalPages}`));
        pager.appendChild(el('button', {
          class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
          disabled: cur === totalPages ? '' : null,
          onClick: () => { if (cur < totalPages) { state.blogPage = cur + 1; renderBlogs(); } },
        }, 'Następna ›'));
        wrap.appendChild(pager);
      }
    }

    setContent(wrap);

    // Po pierwszym wejściu - auto preview stats jeśli ich nie ma
    if (firstEntry && !state.blogStats) {
      previewBlogStats();
    }
  }

  function renderBlogStats(box) {
    box.innerHTML = '';
    const stats = state.blogStats;
    if (!stats) {
      box.appendChild(el('div', { class: 'tcm-stats-loading' }, 'Sprawdzanie liczby wpisów per język...'));
      return;
    }

    // Łączna liczba unikalnych: union ze wszystkich pobranych list lub max z preview
    const allIds = new Set();
    BLOG_LANGS.forEach(l => (state.blogData[l] || []).forEach(b => allIds.add(b.id)));
    Object.keys(state.blogDetails).forEach(id => allIds.add(id));
    const uniqueCount = allIds.size
      || Math.max(...BLOG_LANGS.map(l => (stats[l]?.exactCount) || 0));

    box.appendChild(el('div', { class: 'tcm-stats-total' }, [
      el('span', {}, 'Łącznie unikalnych wpisów: '),
      el('strong', {}, String(uniqueCount)),
    ]));

    BLOG_LANGS.forEach(lang => {
      const info = stats[lang] || {};
      const listData = state.blogData[lang] || [];
      // Liczba z faktyczną nazwą (tłumaczeniem) jeśli mamy listę
      const translated = listData.length > 0
        ? listData.filter(b => b.hasTranslation).length
        : 0;
      const totalRows = listData.length || info.exactCount || 0;
      const detailsTranslated = Object.values(state.blogDetails)
        .filter(d => d.name && d.name[lang] && d.name[lang].length > 0).length;

      const row = el('div', { class: 'tcm-stats-row' }, [
        el('span', { class: 'tcm-stats-lang' }, lang.toUpperCase()),
        el('span', { class: 'tcm-stats-pages' },
          info.pages ? `${info.pages} stron` : (info.error ? '❌ błąd' : '...')),
        el('span', { class: 'tcm-stats-count' },
          totalRows
            ? (translated > 0 ? `${translated}/${totalRows} tłumaczeń` : `${totalRows} wpisów`)
            : ''),
        el('span', { class: 'tcm-stats-downloaded' + (detailsTranslated ? ' ok' : '') },
          detailsTranslated ? `✓ ${detailsTranslated}` : ''),
      ]);
      box.appendChild(row);
    });
  }

  async function previewBlogStats() {
    state.blogStats = {};
    const box = document.getElementById('tcm-blog-stats');
    if (box) renderBlogStats(box);

    const results = await Promise.all(BLOG_LANGS.map(async lang => {
      try {
        // Page 1
        const res = await fetch(buildBlogUrl(1, lang), { credentials: 'include' });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const rowsOnFirst = doc.querySelectorAll("tr[id^='news_']").length;
        let pages = detectTotalPages(doc);
        if (pages <= 1 && rowsOnFirst >= 10) {
          pages = await findLastBlogPage(lang, doc);
        }
        // Page last - liczy partial rows na ostatniej stronie
        let exactCount = rowsOnFirst;
        if (pages > 1) {
          const resL = await fetch(buildBlogUrl(pages, lang), { credentials: 'include' });
          const htmlL = await resL.text();
          const docL = new DOMParser().parseFromString(htmlL, 'text/html');
          const rowsOnLast = docL.querySelectorAll("tr[id^='news_']").length;
          exactCount = (pages - 1) * rowsOnFirst + rowsOnLast;
        }
        return [lang, { pages, rowsOnFirst, exactCount }];
      } catch (e) {
        return [lang, { error: e.message }];
      }
    }));
    state.blogStats = Object.fromEntries(results);
    const box2 = document.getElementById('tcm-blog-stats');
    if (box2) renderBlogStats(box2);
  }

  async function scrapeAllLangLists() {
    if (!confirm(`Pobrać listy dla wszystkich 7 języków sekwencyjnie?`)) return;
    for (const lang of BLOG_LANGS) {
      state.blogLang = lang;
      await scrapeBlogList(lang);
    }
    state.blogLang = 'pl';
    renderBlogs();
  }

  function detectTotalPages(doc) {
    // 2ClickShop używa select[name="page"] z opcjami 1..N do paginacji.
    // Inne selecty (np. per_page) mogą zawierać liczby ale nie reprezentują stron.
    const sel = doc.querySelector('select[name="page"]');
    if (sel) {
      let max = 1;
      sel.querySelectorAll('option').forEach(opt => {
        const v = opt.value || '';
        if (/^\d+$/.test(v)) {
          const n = parseInt(v, 10);
          if (n > max) max = n;
        }
      });
      if (max > 1) return max;
    }
    // Fallback: linki z page=N (zazwyczaj jest tylko Następna page=2, więc to słabe źródło)
    let max = 1;
    doc.querySelectorAll('a[href*="page="]').forEach(a => {
      const m = a.getAttribute('href').match(/[?&]page=(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max && n < 10000) max = n;
      }
    });
    return max;
  }

  // Iteracyjne wyszukiwanie ostatniej strony (binary jump) gdy detectTotalPages zwraca podejrzanie mało
  async function findLastBlogPage(lang, firstPageDoc) {
    const firstId = firstPageDoc.querySelector("tr[id^='news_']")?.id || '';
    const rowsOnFirst = firstPageDoc.querySelectorAll("tr[id^='news_']").length;
    if (rowsOnFirst === 0) return 0;

    const fetchFirstId = async (p) => {
      const r = await fetch(buildBlogUrl(p, lang), { credentials: 'include' });
      const html = await r.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const rows = doc.querySelectorAll("tr[id^='news_']");
      return { firstId: rows[0]?.id || '', count: rows.length };
    };

    // Skoki: 2, 4, 8, 16, 32, 64, 128, 256...
    let lo = 1, hi = -1, p = 2;
    while (p <= 512) {
      const r = await fetchFirstId(p);
      if (r.count === 0 || r.firstId === firstId) { hi = p; break; }
      lo = p;
      p *= 2;
    }
    if (hi === -1) return lo; // limit safety

    // Binary search między lo+1 a hi-1
    while (lo + 1 < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const r = await fetchFirstId(mid);
      if (r.count === 0 || r.firstId === firstId) hi = mid;
      else lo = mid;
    }
    return lo;
  }

  function buildBlogUrl(page, lang) {
    let url = `/admin/index.php?k=news&w=blog&page=${page}`;
    if (lang && lang !== 'pl') url += `&lang=${lang}`;
    return url;
  }

  async function scrapeBlogList(lang) {
    lang = lang || state.blogLang || 'pl';
    const progress = document.getElementById('tcm-blog-progress');
    progress.innerHTML = '';
    const box = el('div', { class: 'tcm-progress' });
    const label = el('div', {}, `Wykrywanie liczby stron (${lang.toUpperCase()})...`);
    const bar = el('div', { class: 'tcm-progress-bar' });
    const fill = el('div', { class: 'tcm-progress-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
    progress.appendChild(box);

    try {
      // 1. Pobierz pierwszą stronę i wykryj total
      const res1 = await fetch(buildBlogUrl(1, lang), { credentials: 'include' });
      const html1 = await res1.text();
      const doc1 = new DOMParser().parseFromString(html1, 'text/html');
      const total = detectTotalPages(doc1);

      const all = [];
      const seenIds = new Set();

      const parseRows = (doc) => {
        const out = [];
        doc.querySelectorAll("tr[id^='news_']").forEach(tr => {
          const id = tr.id.replace('news_', '');
          if (seenIds.has(id)) return;
          const tds = tr.querySelectorAll('td');
          if (tds.length < 3) return;
          seenIds.add(id);
          out.push({
            id,
            order: tds[0]?.textContent.trim().replace('.', '') || '',
            name: tds[1]?.textContent.trim().slice(0, 200) || '',
            key: tds[2]?.textContent.trim() || '',
            category: tds[4]?.textContent.trim() || '',
          });
        });
        return out;
      };

      // 2. Strona 1 z już pobranego HTML
      label.textContent = `Pobieranie 1/${total} (${lang.toUpperCase()})...`;
      all.push(...parseRows(doc1));
      fill.style.width = (1 / total * 100) + '%';

      // 3. Reszta stron
      for (let p = 2; p <= total; p++) {
        label.textContent = `Pobieranie ${p}/${total} (${lang.toUpperCase()})...`;
        const res = await fetch(buildBlogUrl(p, lang), { credentials: 'include' });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const pageNew = parseRows(doc);
        if (pageNew.length === 0) break;
        all.push(...pageNew);
        fill.style.width = (p / total * 100) + '%';
      }

      fill.style.width = '100%';
      label.textContent = `✓ Pobrano ${all.length} wpisów z ${total} stron (${lang.toUpperCase()})`;
      state.blogData[lang] = all;
      GM_setValue('tcm_blogData', state.blogData);
      setTimeout(renderBlogs, 600);
    } catch (e) {
      label.textContent = '✗ Błąd: ' + e.message;
    }
  }

  // -------------------------------------------------------------------------
  // Scrape pełnych detali per wpis (popup edycji + popup SEO)
  // -------------------------------------------------------------------------
  async function scrapeBlogPostDetail(id) {
    const data = { id: String(id) };

    // Popup edycji
    const r1 = await fetch(`/admin/popup.php?k=news&w=blog&id=${id}`, { credentials: 'include' });
    if (!r1.ok) throw new Error(`HTTP ${r1.status} popup id=${id}`);
    const html1 = await r1.text();
    const doc = new DOMParser().parseFromString(html1, 'text/html');

    // Robust extraction: .value (live) → getAttribute('value') → textContent
    const val = n => {
      const e = doc.querySelector(`input[name="${n}"],textarea[name="${n}"]`);
      if (!e) return '';
      if (e.tagName === 'TEXTAREA') {
        // Dla textarea: .value zwykle == innerHTML/textContent po parsowaniu
        return e.value || e.textContent || '';
      }
      return e.value || e.getAttribute('value') || '';
    };
    const chk = n => {
      const e = doc.querySelector(`input[name="${n}"]`);
      if (!e) return false;
      // .checked może nie działać na detached DOMParser → fallback do hasAttribute
      return e.checked || e.hasAttribute('checked');
    };
    const sel = n => {
      const e = doc.querySelector(`select[name="${n}"]`);
      if (!e) return '';
      const selected = e.querySelector('option[selected]') || e.options[0];
      return selected ? selected.textContent.trim() : '';
    };

    data.author = val('author');
    data.date = val('date');
    data.sub = sel('sub');
    data.name = {}; data.key = {}; data.desc = {}; data.link = {};
    data.visible = {}; data.visible_slider = {};
    data.photo_icon = {};
    data.photo_banner = '';

    BLOG_LANGS.forEach(lang => {
      data.name[lang] = val(`name_${lang}`);
      data.key[lang] = val(`key_${lang}`);
      let desc = val(`desc_${lang}`);
      // Zamień względne URL-e na bezwzględne
      if (desc) {
        desc = desc.replace(/(src=["'])(\/?)(?!https?:\/\/)(files\/|images\/|template\/)/g,
          `$1${BLOG_DOMAINS.pl}/$3`);
      }
      data.desc[lang] = desc;
      data.visible[lang] = chk(`visible_${lang}`);
      data.visible_slider[lang] = chk(`visible_blogSlider_${lang}`);
      if (data.key[lang]) {
        data.link[lang] = `${BLOG_DOMAINS[lang]}/blog/${data.key[lang]}.html`;
      }
    });

    // Kategorie - per język ze spanów lang_field
    data.categories = [];
    doc.querySelectorAll('input[name="news_category[]"]').forEach(cb => {
      if (!cb.checked) return;
      const container = cb.closest('tr, div, li') || cb.parentElement;
      const item = {};
      BLOG_LANGS.forEach(lang => {
        const cls = LANG_CLASS_MAP[lang];
        let span = null;
        container.querySelectorAll('span.lang_field, span[class*="lang_field"]').forEach(s => {
          if (s.className.includes(cls)) span = s;
        });
        item[lang] = span ? span.textContent.trim() : '';
      });
      if (!item.pl) {
        const plSpan = container.querySelector('.pl_PL');
        item.pl = plSpan ? plSpan.textContent.trim() : cb.value;
      }
      data.categories.push(item);
    });

    // Zdjęcia
    doc.querySelectorAll('img').forEach(img => {
      const src = img.src || '';
      if (!src.includes('news') && !src.includes('blog')) return;
      if (src.includes('fotob')) { data.photo_banner = src; return; }
      BLOG_LANGS.forEach(lang => {
        if (src.includes(`foto-${lang}.`) || src.includes(`foto_${lang}.`)) {
          data.photo_icon[lang] = src;
        }
      });
    });

    // Załączniki - próba różnych wzorców 2ClickShop
    data.attachments = [];
    // Wzorzec 1: input[name^="files"] z indeksem
    const fileInputs = {};
    doc.querySelectorAll('input[name^="files"], input[name^="attachment"], input[name^="zalacznik"]').forEach(inp => {
      const m = inp.name.match(/^(?:files|attachment|zalacznik)\[?(\d+)\]?(?:\[(.*?)\])?(?:\[(.*?)\])?/);
      if (!m) return;
      const idx = m[1] || '0';
      const key = m[2] || 'value';
      const lang = m[3] || '';
      fileInputs[idx] = fileInputs[idx] || {};
      if (lang) {
        fileInputs[idx][key] = fileInputs[idx][key] || {};
        fileInputs[idx][key][lang] = inp.value;
      } else {
        fileInputs[idx][key] = inp.value;
      }
    });
    Object.values(fileInputs).forEach(f => {
      if (f.name || f.url || f.file) data.attachments.push(f);
    });
    // Wzorzec 2: <tr class="file"> lub linki do plików w sekcji "Załączniki"
    doc.querySelectorAll('a[href*="/news/"][href*="/files/"], a[href*="files.php"]').forEach(a => {
      const href = a.href;
      if (!data.attachments.some(x => JSON.stringify(x).includes(href))) {
        data.attachments.push({ url: { pl: href }, name: { pl: a.textContent.trim() } });
      }
    });

    // Popup SEO
    try {
      const r2 = await fetch(`/admin/popup.php?k=seo&key=news_${id}&no_parent_refresh`, { credentials: 'include' });
      const html2 = await r2.text();
      const seoDoc = new DOMParser().parseFromString(html2, 'text/html');
      const sVal = n => {
        const e = seoDoc.querySelector(`input[name="${n}"],textarea[name="${n}"]`);
        return e ? e.value : '';
      };
      const sChk = n => {
        const e = seoDoc.querySelector(`input[name="${n}"]`);
        return e ? e.checked : false;
      };
      data.seo = {};
      BLOG_LANGS.forEach(lang => {
        data.seo[lang] = {
          title: sVal(`seo[${lang}][title]`),
          description: sVal(`seo[${lang}][description]`),
          keywords: sVal(`seo[${lang}][keywords]`),
          noindex: sChk(`seo[${lang}][noindex]`),
        };
      });
    } catch (e) {
      data.seo_error = e.message;
    }

    return data;
  }

  // Pobierz wpisy: dla jednego języka lub union ze wszystkich
  // sourceLang = 'pl'|'en'|...|'__all__'
  async function scrapeBlogAll(sourceLang) {
    sourceLang = sourceLang || state.blogLang;
    const langs = sourceLang === '__all__' ? BLOG_LANGS : [sourceLang];

    const progress = document.getElementById('tcm-blog-progress');
    progress.innerHTML = '';
    const box = el('div', { class: 'tcm-progress' });
    const label = el('div', {}, 'Zbieranie ID-ków...');
    const bar = el('div', { class: 'tcm-progress-bar' });
    const fill = el('div', { class: 'tcm-progress-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
    progress.appendChild(box);

    try {
      const idsSet = new Set();

      const parseRowsInto = (doc, perLangList) => {
        doc.querySelectorAll("tr[id^='news_']").forEach(tr => {
          const id = tr.id.replace('news_', '');
          const tds = tr.querySelectorAll('td');
          if (tds.length < 3) return;
          if (!idsSet.has(id)) idsSet.add(id);
          perLangList.push({
            id,
            order: tds[0]?.textContent.trim().replace('.', '') || '',
            name: tds[1]?.textContent.trim().slice(0, 200) || '',
            key: tds[2]?.textContent.trim() || '',
            category: tds[4]?.textContent.trim() || '',
          });
        });
      };

      // Etap 1: zbieranie ID-ków z list (jednego lub wszystkich języków)
      for (let i = 0; i < langs.length; i++) {
        const lang = langs[i];
        label.textContent = `Lista ${lang.toUpperCase()}: wykrywanie liczby stron...`;
        const res1 = await fetch(buildBlogUrl(1, lang), { credentials: 'include' });
        const html1 = await res1.text();
        const doc1 = new DOMParser().parseFromString(html1, 'text/html');
        const rowsOnFirst = doc1.querySelectorAll("tr[id^='news_']").length;
        let totalPages = detectTotalPages(doc1);
        if (totalPages <= 1 && rowsOnFirst >= 10) {
          totalPages = await findLastBlogPage(lang, doc1);
        }

        const perLangList = [];
        const seenInLang = new Set();
        const captureRow = (doc) => {
          doc.querySelectorAll("tr[id^='news_']").forEach(tr => {
            const id = tr.id.replace('news_', '');
            if (seenInLang.has(id)) return;
            seenInLang.add(id);
            idsSet.add(id);
            const tds = tr.querySelectorAll('td');
            const name = tds[1]?.textContent.trim() || '';
            perLangList.push({
              id,
              order: tds[0]?.textContent.trim().replace('.', '') || '',
              name: name.slice(0, 200),
              key: tds[2]?.textContent.trim() || '',
              category: tds[4]?.textContent.trim() || '',
              hasTranslation: name.length > 0,
            });
          });
        };
        captureRow(doc1);

        for (let p = 2; p <= totalPages; p++) {
          label.textContent = `Lista ${lang.toUpperCase()}: strona ${p}/${totalPages}...`;
          const res = await fetch(buildBlogUrl(p, lang), { credentials: 'include' });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const before = seenInLang.size;
          captureRow(doc);
          if (seenInLang.size === before) break;
        }
        state.blogData[lang] = perLangList;
        GM_setValue('tcm_blogData', state.blogData);

        // Pasek po etapie 1: pierwsze 20% podzielone proporcjonalnie między języki
        fill.style.width = ((i + 1) / langs.length * 20) + '%';
      }

      const ids = Array.from(idsSet).sort((a, b) => parseInt(a) - parseInt(b));

      // Etap 2: pełne dane per ID (popup + SEO) - wszystkie 7 języków na raz
      console.log(`[Migrator] Etap 2: pobieram detale dla ${ids.length} unikalnych ID`);
      let done = 0, errors = 0;
      for (const id of ids) {
        done++;
        label.textContent = `Pełne dane ${done}/${ids.length} (id=${id})...`;
        try {
          const d = await scrapeBlogPostDetail(id);
          // Diagnostic dla pierwszego wpisu - sprawdź czy pola są wypełnione
          if (done === 1) {
            console.log(`[Migrator] Sample detail id=${id}:`, {
              name_pl: d.name?.pl,
              name_en: d.name?.en,
              desc_pl_len: (d.desc?.pl || '').length,
              date: d.date,
              author: d.author,
            });
          }
          state.blogDetails[id] = d;
          if (done % 25 === 0) GM_setValue('tcm_blogDetails', state.blogDetails);
        } catch (e) {
          errors++;
          console.error(`[Migrator] Error id=${id}:`, e);
          state.blogDetails[id] = { id: String(id), error: e.message };
        }
        fill.style.width = (20 + (done / ids.length * 80)) + '%';
      }
      GM_setValue('tcm_blogDetails', state.blogDetails);
      fill.style.width = '100%';
      const label2 = `✓ Pobrano ${done - errors}/${ids.length} wpisów`
        + ` (źródło: ${sourceLang === '__all__' ? 'wszystkie języki' : sourceLang.toUpperCase()},`
        + ` błędów: ${errors})`;
      label.textContent = label2;
      setTimeout(renderBlogs, 800);
    } catch (e) {
      label.textContent = '✗ Błąd: ' + e.message;
    }
  }

  async function scrapeBlogDetails() {
    // Union ID-ków ze wszystkich list językowych
    const idsSet = new Set();
    BLOG_LANGS.forEach(lang => (state.blogData[lang] || []).forEach(b => idsSet.add(b.id)));
    const ids = Array.from(idsSet).sort((a, b) => parseInt(a) - parseInt(b));
    if (!ids.length) {
      if (confirm('Brak listy ID-ków. Pobrać najpierw listę PL?')) {
        await scrapeBlogList('pl');
        return scrapeBlogDetails();
      }
      return;
    }
    if (!confirm(`Pobrać pełne dane dla ${ids.length} wpisów? Każdy wpis = 2 requesty (popup + SEO) i zawiera wszystkie 7 języków jednocześnie. Może potrwać kilka minut.`)) return;

    const progress = document.getElementById('tcm-blog-progress');
    progress.innerHTML = '';
    const box = el('div', { class: 'tcm-progress' });
    const label = el('div', {}, `Pobieranie detali 0/${ids.length}...`);
    const bar = el('div', { class: 'tcm-progress-bar' });
    const fill = el('div', { class: 'tcm-progress-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
    progress.appendChild(box);

    let done = 0, errors = 0;
    for (const id of ids) {
      done++;
      label.textContent = `Pobieranie detali ${done}/${ids.length} (id=${id})...`;
      try {
        const d = await scrapeBlogPostDetail(id);
        state.blogDetails[id] = d;
        // Autosave co 25
        if (done % 25 === 0) GM_setValue('tcm_blogDetails', state.blogDetails);
      } catch (e) {
        errors++;
        state.blogDetails[id] = { id: String(id), error: e.message };
      }
      fill.style.width = (done / ids.length * 100) + '%';
    }
    GM_setValue('tcm_blogDetails', state.blogDetails);
    label.textContent = `✓ Pobrano detale ${done - errors}/${ids.length} (błędów: ${errors})`;
    setTimeout(renderBlogs, 800);
  }

  // -------------------------------------------------------------------------
  // Eksport: JSON / CSV / XML
  // -------------------------------------------------------------------------
  function exportBlog(format) {
    const detailsArr = Object.values(state.blogDetails).sort((a, b) =>
      parseInt(a.id) - parseInt(b.id));
    const ts = new Date().toISOString().slice(0, 10);

    let blob, ext;
    if (detailsArr.length > 0) {
      // Eksport pełnych detali
      if (format === 'json') {
        blob = new Blob([JSON.stringify(detailsArr, null, 2)], { type: 'application/json' });
        ext = 'json';
      } else if (format === 'csv') {
        blob = new Blob(['﻿' + blogToCSV(detailsArr)], { type: 'text/csv;charset=utf-8' });
        ext = 'csv';
      } else if (format === 'xml') {
        blob = new Blob([blogToXML(detailsArr)], { type: 'application/xml' });
        ext = 'xml';
      }
    } else {
      // Fallback: eksport podstawowej listy bieżącego języka
      const list = blogListForCurrentLang();
      if (!list.length) { alert('Brak danych do eksportu.'); return; }
      if (format === 'json') {
        blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
        ext = 'json';
      } else if (format === 'csv') {
        const cols = ['id', 'order', 'name', 'key', 'category'];
        const rows = [cols.join(';')].concat(
          list.map(b => cols.map(c => csvCell(b[c])).join(';'))
        );
        blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        ext = 'csv';
      } else if (format === 'xml') {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<blogs>\n';
        list.forEach(b => {
          xml += `  <blog id="${b.id}">\n`;
          ['order', 'name', 'key', 'category'].forEach(k => {
            xml += `    <${k}>${xmlEscape(b[k] || '')}</${k}>\n`;
          });
          xml += '  </blog>\n';
        });
        xml += '</blogs>\n';
        blob = new Blob([xml], { type: 'application/xml' });
        ext = 'xml';
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blogs_${detailsArr.length ? 'full' : state.blogLang}_${ts}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[;\n"]/.test(s) ? `"${s}"` : s;
  }

  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function blogToCSV(arr) {
    const cols = ['id', 'date', 'author', 'sub', 'photo_banner'];
    BLOG_LANGS.forEach(l => cols.push(`name_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`link_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`key_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`visible_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`category_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`photo_icon_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`desc_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`seo_title_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`seo_description_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`seo_keywords_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`seo_noindex_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`attachments_name_${l}`));
    BLOG_LANGS.forEach(l => cols.push(`attachments_url_${l}`));

    const lines = [cols.join(';')];
    arr.forEach(d => {
      const row = [];
      const get = k => d[k] || '';
      cols.forEach(col => {
        let v = '';
        if (['id', 'date', 'author', 'sub', 'photo_banner'].includes(col)) {
          v = get(col);
        } else {
          const m = col.match(/^(name|link|key|visible|desc|photo_icon)_(\w+)$/);
          const m2 = col.match(/^(category)_(\w+)$/);
          const m3 = col.match(/^seo_(title|description|keywords|noindex)_(\w+)$/);
          const m4 = col.match(/^attachments_(name|url)_(\w+)$/);
          if (m) v = (d[m[1]] && d[m[1]][m[2]]) || '';
          else if (m2) {
            const lang = m2[2];
            v = (d.categories || []).map(c => c[lang]).filter(Boolean).join('\n');
          } else if (m3) {
            v = (d.seo && d.seo[m3[2]] && d.seo[m3[2]][m3[1]]) || '';
          } else if (m4) {
            const lang = m4[2];
            v = (d.attachments || []).map(a => (a[m4[1]] && a[m4[1]][lang]) || '').filter(Boolean).join('\n');
          }
        }
        row.push(csvCell(v));
      });
      lines.push(row.join(';'));
    });
    return lines.join('\n');
  }

  function blogToXML(arr) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<blogs>\n';
    arr.forEach(d => {
      xml += `  <blog id="${d.id}">\n`;
      xml += `    <date>${xmlEscape(d.date)}</date>\n`;
      xml += `    <author>${xmlEscape(d.author)}</author>\n`;
      xml += `    <sub>${xmlEscape(d.sub)}</sub>\n`;
      xml += `    <photo_banner>${xmlEscape(d.photo_banner)}</photo_banner>\n`;
      // Per-lang fields
      ['name', 'key', 'link', 'visible', 'photo_icon', 'desc'].forEach(field => {
        if (!d[field]) return;
        xml += `    <${field}s>\n`;
        BLOG_LANGS.forEach(lang => {
          const v = d[field][lang];
          if (v === undefined || v === '') return;
          if (field === 'desc') {
            xml += `      <${field} lang="${lang}"><![CDATA[${v}]]></${field}>\n`;
          } else {
            xml += `      <${field} lang="${lang}">${xmlEscape(v)}</${field}>\n`;
          }
        });
        xml += `    </${field}s>\n`;
      });
      // Categories
      xml += `    <categories>\n`;
      (d.categories || []).forEach(c => {
        xml += `      <category>\n`;
        BLOG_LANGS.forEach(lang => {
          if (c[lang]) xml += `        <name lang="${lang}">${xmlEscape(c[lang])}</name>\n`;
        });
        xml += `      </category>\n`;
      });
      xml += `    </categories>\n`;
      // SEO
      xml += `    <seo>\n`;
      BLOG_LANGS.forEach(lang => {
        const s = (d.seo || {})[lang];
        if (!s) return;
        xml += `      <lang code="${lang}">\n`;
        xml += `        <title>${xmlEscape(s.title)}</title>\n`;
        xml += `        <description>${xmlEscape(s.description)}</description>\n`;
        xml += `        <keywords>${xmlEscape(s.keywords)}</keywords>\n`;
        xml += `        <noindex>${s.noindex ? 'true' : 'false'}</noindex>\n`;
        xml += `      </lang>\n`;
      });
      xml += `    </seo>\n`;
      // Attachments
      xml += `    <attachments>\n`;
      (d.attachments || []).forEach(a => {
        xml += `      <attachment>\n`;
        if (a.name) {
          xml += `        <names>\n`;
          BLOG_LANGS.forEach(lang => {
            if (a.name[lang]) xml += `          <name lang="${lang}">${xmlEscape(a.name[lang])}</name>\n`;
          });
          xml += `        </names>\n`;
        }
        if (a.url) {
          xml += `        <urls>\n`;
          BLOG_LANGS.forEach(lang => {
            if (a.url[lang]) xml += `          <url lang="${lang}">${xmlEscape(a.url[lang])}</url>\n`;
          });
          xml += `        </urls>\n`;
        }
        xml += `      </attachment>\n`;
      });
      xml += `    </attachments>\n`;
      xml += `  </blog>\n`;
    });
    xml += '</blogs>\n';
    return xml;
  }

  function clearBlogList() {
    if (!confirm('Wyczyścić wszystkie pobrane dane blogów (listy + detale)?')) return;
    state.blogData = {};
    state.blogDetails = {};
    state.blogPage = 1;
    GM_setValue('tcm_blogData', {});
    GM_setValue('tcm_blogDetails', {});
    renderBlogs();
  }

  // =========================================================================
  // REVIEWS MODULE (opinie o produktach)
  // Struktura panelu: /admin/index.php?k=comment&type=all&page=N&lang=XX
  //   tr#comment_<ID> (9 kolumn) + następny <tr> (1 kolumna z treścią)
  //   Brak popupu edycji — komplet danych jest na liście.
  // =========================================================================
  const REVIEW_PAGE_SIZE = 25;
  // ISO 639-2/B mapping (kod 3-literowy bibliograficzny)
  const REVIEW_LANG_CODE = {
    pl: 'pol', en: 'eng', de: 'ger', ua: 'ukr', cz: 'cze', pt: 'por', fr: 'fre',
  };

  function buildReviewUrl(page, lang) {
    // UWAGA: 2ClickShop wymaga jawnego &lang=pl dla PL — bez tego parametru
    // zwraca pustą listę zamiast wszystkich opinii PL.
    return `/admin/index.php?k=comment&type=all&page=${page}&lang=${lang || 'pl'}`;
  }

  function buildProductUrl(page) {
    // Analogicznie do buildReviewUrl — bez &lang=pl 2ClickShop może zwracać
    // listę zależną od stanu sesji panelu (filtr languge dropdown). Wymuszamy.
    return `/admin/index.php?k=product&page=${page}&lang=pl`;
  }

  function reviewListForCurrentLang() {
    return (state.reviewData && state.reviewData[state.reviewLang]) || [];
  }

  // Wyłuskanie slugu z URL produktu typu .../produkt/SLUG.html
  function extractProductSlug(url) {
    if (!url) return '';
    const m = url.match(/\/produkt\/([^/?#]+?)\.html/i);
    return m ? m[1].toLowerCase() : '';
  }

  // Wyłuskanie order_id z URL typu .../order/product-rate.html?order_id=XXX
  function extractOrderId(url) {
    if (!url) return '';
    const m = url.match(/[?&]order_id=(\d+)/);
    return m ? m[1] : '';
  }

  function parseReviewRows(doc) {
    const out = [];
    doc.querySelectorAll("tr[id^='comment_']").forEach(tr => {
      const id = tr.id.replace('comment_', '');
      const tds = tr.querySelectorAll('td');
      if (tds.length < 8) return;
      const productLink = tds[3]?.querySelector('a');
      const visibleBox = tr.querySelector('input[name="list_visible"]');
      const contentTr = tr.nextElementSibling;
      const content = (contentTr && contentTr.querySelectorAll('td').length === 1)
        ? contentTr.textContent.trim()
        : '';
      const productUrl = productLink ? productLink.href : '';
      out.push({
        id,
        nick: tds[1]?.textContent.trim().replace(/\s+/g, ' ') || '',
        email: tds[2]?.textContent.trim() || '',
        productName: productLink ? productLink.textContent.trim() : (tds[3]?.textContent.trim() || ''),
        productUrl,
        productSlug: extractProductSlug(productUrl),
        orderSerialNumber: extractOrderId(productUrl),
        rating: tds[4]?.textContent.trim() || '',
        date: tds[5]?.textContent.trim() || '',
        ip: tds[6]?.textContent.trim() || '',
        visible: visibleBox ? visibleBox.hasAttribute('checked') : false,
        content,
      });
    });
    return out;
  }

  // Próbuje wyłuskać slug produktu z wiersza listy.
  // 2ClickShop ma kilka możliwych miejsc — w zależności od konfiguracji/języka kolumna w surowym
  // HTML może być pusta a wartość pojawia się dopiero po renderowaniu JS.
  function extractSlugFromRow(tr, tds) {
    // 1) Najsilniejsze: link do strony produktu /produkt/SLUG.html
    const a = tr.querySelector('a[href*="/produkt/"]');
    if (a) {
      const m = a.getAttribute('href').match(/\/produkt\/([^/?#]+?)\.html/i);
      if (m) return m[1].toLowerCase();
    }
    // 2) Wzorzec /produkt/X.html gdziekolwiek w outerHTML (np. wewnątrz onclick, data-*, JS)
    const html = tr.outerHTML;
    const m2 = html.match(/\/produkt\/([a-z0-9][a-z0-9-]+)\.html/i);
    if (m2) return m2[1].toLowerCase();
    // 3) <span class="lang_field pl_PL">slug</span> lub podobne — slug per-lang
    const langSpan = tr.querySelector('span.lang_field.pl_PL, span[class*="pl_PL"], span.lang_field');
    if (langSpan) {
      const t = langSpan.textContent.trim();
      if (/^[a-z0-9-]+$/i.test(t) && !/^[a-f0-9]{32}$/i.test(t) && t.length >= 3) return t.toLowerCase();
    }
    // 4) td[4] textContent (najczęstszy układ na renderowanej stronie)
    const fallback = tds[4]?.textContent.trim() || '';
    if (/^[a-z0-9-]+$/i.test(fallback) && !/^[a-f0-9]{32}$/i.test(fallback) && fallback.length >= 3) {
      return fallback.toLowerCase();
    }
    // 5) Skanuj wszystkie td szukając slug-like text
    for (const td of tds) {
      const t = td.textContent.trim();
      if (/^[a-z][a-z0-9-]{3,}$/.test(t) && t.includes('-') && !/^[a-f0-9]{32}$/i.test(t)) {
        return t.toLowerCase();
      }
    }
    return '';
  }

  let _productDiagDumped = false;
  function parseProductRows(doc) {
    const out = [];
    const rows = doc.querySelectorAll("tr[id^='product_']");
    rows.forEach((tr, idx) => {
      const id = tr.id.replace('product_', '');
      const tds = tr.querySelectorAll('td');
      if (tds.length < 4) return;
      const name = tds[3]?.textContent.trim() || tds[2]?.textContent.trim() || '';
      const slug = extractSlugFromRow(tr, tds);

      // Diagnostyka: dump pierwszego wiersza pierwszej fetchowanej strony do konsoli
      if (!_productDiagDumped && idx === 0) {
        _productDiagDumped = true;
        console.log('[Migrator][diag] Pierwszy wiersz produktu — surowy HTML:', tr.outerHTML.slice(0, 2000));
        console.log('[Migrator][diag] td[] textContent:',
          Array.from(tds).map((td, i) => `td[${i}]="${td.textContent.trim().slice(0, 80)}"`));
        console.log('[Migrator][diag] id=', id, ' name=', name, ' detected slug=', slug);
      }

      out.push({ id, name, slug });
    });
    return out;
  }

  function renderReviews() {
    const firstEntry = state.currentView !== 'reviews';
    state.currentView = 'reviews';
    showBreadcrumb([
      { label: '← Menu', onClick: renderMenu },
      { label: 'Opinie o produktach' },
    ]);
    const wrap = el('div');

    // --- Konfiguracja eksportu (układ pionowy: label nad polem) ---
    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Konfiguracja eksportu'));
    const cfg = state.reviewConfig;
    const cfgBox = el('div', { class: 'tcm-stats' });

    const mkLabel = (text) => el('div', {
      style: { padding: '8px 4px 2px', fontSize: '11px', fontWeight: '600', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.3px' },
    }, text);

    // shopId per język — grid 4 kolumny (PL/EN/DE/UA + CZ/PT/FR)
    cfgBox.appendChild(mkLabel('shopId per język opinii'));
    const shopIdGrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', padding: '4px' } });
    BLOG_LANGS.forEach(lang => {
      const cell = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } });
      cell.appendChild(el('span', { style: { fontSize: '10px', color: '#64748b', fontWeight: '700', letterSpacing: '0.5px' } }, lang.toUpperCase()));
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = (cfg.shopIdByLang && cfg.shopIdByLang[lang]) || '';
      inp.placeholder = lang === 'pl' ? '1' : '';
      inp.style.cssText = 'width:100%;padding:4px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;box-sizing:border-box;';
      inp.addEventListener('change', () => {
        if (!cfg.shopIdByLang) cfg.shopIdByLang = {};
        cfg.shopIdByLang[lang] = inp.value.trim();
        GM_setValue('tcm_reviewConfig', cfg);
      });
      cell.appendChild(inp);
      shopIdGrid.appendChild(cell);
    });
    cfgBox.appendChild(shopIdGrid);

    // language (gdy nieznany)
    cfgBox.appendChild(mkLabel('language (gdy nieznany)'));
    const langInp = document.createElement('input');
    langInp.type = 'text';
    langInp.value = cfg.defaultLanguage || '';
    langInp.placeholder = 'pol';
    langInp.style.cssText = 'width:120px;margin:0 4px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;';
    langInp.addEventListener('change', () => {
      cfg.defaultLanguage = langInp.value.trim();
      GM_setValue('tcm_reviewConfig', cfg);
    });
    cfgBox.appendChild(langInp);

    // opinionConfirmedByPurchase
    cfgBox.appendChild(mkLabel('opinionConfirmedByPurchase'));
    const cbpSel = document.createElement('select');
    cbpSel.style.cssText = 'width:calc(100% - 8px);margin:0 4px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:12px;';
    [
      ['auto', 'auto (true gdy URL ma order_id)'],
      ['true', 'wymuś true'],
      ['false', 'wymuś false'],
    ].forEach(([v, lbl]) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = lbl;
      if ((cfg.forceConfirmedByPurchase || 'auto') === v) opt.selected = true;
      cbpSel.appendChild(opt);
    });
    cbpSel.addEventListener('change', () => {
      cfg.forceConfirmedByPurchase = cbpSel.value;
      GM_setValue('tcm_reviewConfig', cfg);
    });
    cfgBox.appendChild(cbpSel);

    // Mapping products_id — status na osobnej linii, przyciski pod
    cfgBox.appendChild(mkLabel('Mapping products_id'));
    const slugCount = Object.keys(state.productSlugMap).length;
    const nameCount = Object.keys(state.productNameMap).length;
    const mapStatus = el('div', {
      style: {
        padding: '2px 4px 6px', fontSize: '11px',
        color: slugCount ? '#16a34a' : '#dc2626',
      },
    }, slugCount
      ? `✓ ${slugCount} po slug, ${nameCount} po nazwie`
      : '⚠ brak — products_id będzie pusty');
    cfgBox.appendChild(mapStatus);
    const mapBtns = el('div', { style: { display: 'flex', gap: '6px', padding: '0 4px 4px' } });
    mapBtns.appendChild(el('button', {
      class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
      style: { flex: '1' },
      onClick: scrapeProductMap,
    }, slugCount ? 'Odśwież mapping' : 'Pobierz mapping'));
    if (slugCount > 0) {
      mapBtns.appendChild(el('button', {
        class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
        style: { flex: '1' },
        onClick: diagnoseMapping,
      }, 'Diagnostyka'));
    }
    cfgBox.appendChild(mapBtns);

    wrap.appendChild(cfgBox);

    const dataTitleRow = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
      el('div', { class: 'tcm-section-title', style: { margin: '0' } }, 'Dostępne dane'),
      el('button', {
        class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
        style: { fontSize: '10px', padding: '2px 8px', marginRight: '4px' },
        onClick: () => { state.reviewStats = null; previewReviewStats(); },
      }, '↻ Odśwież statystyki'),
    ]);
    wrap.appendChild(dataTitleRow);
    const statsBox = el('div', { id: 'tcm-review-stats', class: 'tcm-stats' });
    renderReviewStats(statsBox);
    wrap.appendChild(statsBox);

    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Język'));
    const langSwitch = el('div', { class: 'tcm-lang-switch' });
    BLOG_LANGS.forEach(code => {
      const count = (state.reviewData[code] || []).length;
      const btn = document.createElement('button');
      btn.className = 'tcm-lang-btn'
        + (state.reviewLang === code ? ' active' : '')
        + (count > 0 ? ' has-data' : '');
      btn.textContent = code.toUpperCase() + (count ? ` (${count})` : '');
      btn.type = 'button';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        state.reviewLang = code;
        state.reviewPage = 1;
        renderReviews();
      });
      langSwitch.appendChild(btn);
    });
    wrap.appendChild(langSwitch);

    wrap.appendChild(el('div', { class: 'tcm-section-title' }, 'Akcje'));
    const actions = el('div', { class: 'tcm-actions' });
    const langStat = state.reviewStats && state.reviewStats[state.reviewLang];
    const langCount = langStat ? langStat.exactCount : 0;
    const allCount = state.reviewStats
      ? BLOG_LANGS.reduce((s, l) => s + ((state.reviewStats[l]?.exactCount) || 0), 0)
      : 0;

    actions.appendChild(el('button', {
      class: 'tcm-btn',
      style: { background: '#944149' },
      onClick: () => scrapeReviewAll(state.reviewLang),
    }, langCount
      ? `Pobierz opinie ${state.reviewLang.toUpperCase()} (${langCount})`
      : `Pobierz opinie ${state.reviewLang.toUpperCase()}`));

    actions.appendChild(el('button', {
      class: 'tcm-btn tcm-btn-secondary',
      onClick: () => scrapeReviewAll('__all__'),
    }, allCount
      ? `Pobierz opinie wszystkich języków (${allCount} łącznie)`
      : 'Pobierz opinie wszystkich języków'));

    wrap.appendChild(actions);

    // Eksport tylko bieżącego języka
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: '#475569', padding: '8px 4px 2px', fontWeight: '600' } },
      `Eksport ${state.reviewLang.toUpperCase()} (${(state.reviewData[state.reviewLang] || []).length} opinii)`));
    const exportsLang = el('div', { class: 'tcm-actions' });
    exportsLang.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportReview('json', state.reviewLang) }, 'JSON'));
    exportsLang.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportReview('csv', state.reviewLang) }, 'CSV'));
    exportsLang.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportReview('xml', state.reviewLang) }, 'XML'));
    wrap.appendChild(exportsLang);

    // Eksport wszystkich języków
    const allReviewsCount = BLOG_LANGS.reduce((s, l) => s + (state.reviewData[l] || []).length, 0);
    wrap.appendChild(el('div', { style: { fontSize: '11px', color: '#475569', padding: '8px 4px 2px', fontWeight: '600' } },
      `Eksport wszystkich języków (${allReviewsCount} opinii)`));
    const exportsAll = el('div', { class: 'tcm-actions' });
    exportsAll.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportReview('json') }, 'JSON'));
    exportsAll.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportReview('csv') }, 'CSV'));
    exportsAll.appendChild(el('button', { class: 'tcm-btn tcm-btn-secondary', onClick: () => exportReview('xml') }, 'XML'));
    if (allReviewsCount > 0) {
      exportsAll.appendChild(el('button', {
        class: 'tcm-btn tcm-btn-secondary',
        onClick: clearReviewList,
      }, 'Wyczyść'));
    }
    wrap.appendChild(exportsAll);

    const progress = el('div', { id: 'tcm-review-progress' });
    wrap.appendChild(progress);

    const list = reviewListForCurrentLang();
    if (list.length === 0) {
      wrap.appendChild(el('div', { class: 'tcm-empty' }, `Brak pobranych opinii dla ${state.reviewLang.toUpperCase()}. Kliknij "Pobierz opinie" aby zacząć.`));
    } else {
      const totalPages = Math.ceil(list.length / REVIEW_PAGE_SIZE);
      const cur = Math.min(state.reviewPage, totalPages);
      const start = (cur - 1) * REVIEW_PAGE_SIZE;
      const end = Math.min(start + REVIEW_PAGE_SIZE, list.length);
      wrap.appendChild(el('div', { class: 'tcm-section-title' },
        `Lista – ${state.reviewLang.toUpperCase()} – ${list.length} opinii, strona ${cur}/${totalPages}`));
      const listEl = el('div', { class: 'tcm-list' });
      list.slice(start, end).forEach(r => {
        const main = el('div', { class: 'tcm-list-item', style: { display: 'block' } }, [
          el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
            el('span', { class: 'tcm-list-id' }, '#' + r.id),
            el('span', { class: 'tcm-list-name', style: { fontWeight: '600' } }, r.nick || '(anonim)'),
            el('span', { class: 'tcm-badge-lang' + (r.visible ? ' active' : '') }, r.visible ? 'WIDOCZNA' : 'UKRYTA'),
            el('span', { class: 'tcm-list-id' }, r.rating || ''),
          ]),
          el('div', { style: { fontSize: '11px', color: '#64748b', marginTop: '2px' } }, r.productName || ''),
          r.content
            ? el('div', { style: { fontSize: '12px', color: '#334155', marginTop: '4px', fontStyle: 'italic' } }, r.content.slice(0, 200))
            : null,
        ]);
        listEl.appendChild(main);
      });
      wrap.appendChild(listEl);

      if (totalPages > 1) {
        const pager = el('div', { class: 'tcm-pager' });
        pager.appendChild(el('button', {
          class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
          disabled: cur === 1 ? '' : null,
          onClick: () => { if (cur > 1) { state.reviewPage = cur - 1; renderReviews(); } },
        }, '‹ Poprzednia'));
        pager.appendChild(el('span', { class: 'tcm-pager-info' }, `${cur} / ${totalPages}`));
        pager.appendChild(el('button', {
          class: 'tcm-btn tcm-btn-sm tcm-btn-secondary',
          disabled: cur === totalPages ? '' : null,
          onClick: () => { if (cur < totalPages) { state.reviewPage = cur + 1; renderReviews(); } },
        }, 'Następna ›'));
        wrap.appendChild(pager);
      }
    }

    setContent(wrap);

    // Preview stats: gdy nigdy nie były policzone (null lub pusty obiekt)
    // — niezależnie od firstEntry, żeby po re-renderze panelu (np. po
    // pobraniu mappingu) nadal się odpaliły.
    const statsEmpty = !state.reviewStats || Object.keys(state.reviewStats).length === 0;
    if (statsEmpty && !state._previewInFlight) {
      previewReviewStats();
    }
  }

  function renderReviewStats(box) {
    box.innerHTML = '';
    const stats = state.reviewStats;
    if (!stats) {
      box.appendChild(el('div', { class: 'tcm-stats-loading' }, 'Sprawdzanie liczby opinii per język...'));
      return;
    }
    const totalAll = BLOG_LANGS.reduce((s, l) => s + ((stats[l]?.exactCount) || 0), 0);
    box.appendChild(el('div', { class: 'tcm-stats-total' }, [
      el('span', {}, 'Łącznie opinii (suma języków): '),
      el('strong', {}, String(totalAll)),
    ]));
    BLOG_LANGS.forEach(lang => {
      const info = stats[lang] || {};
      const downloaded = (state.reviewData[lang] || []).length;
      const row = el('div', { class: 'tcm-stats-row' }, [
        el('span', { class: 'tcm-stats-lang' }, lang.toUpperCase()),
        el('span', { class: 'tcm-stats-pages' },
          info.pages ? `${info.pages} stron` : (info.error ? '❌ błąd' : '...')),
        el('span', { class: 'tcm-stats-count' },
          info.exactCount != null ? `${info.exactCount} opinii` : ''),
        el('span', { class: 'tcm-stats-downloaded' + (downloaded ? ' ok' : '') },
          downloaded ? `✓ ${downloaded}` : ''),
      ]);
      box.appendChild(row);
    });
  }

  async function previewReviewStats() {
    if (state._previewInFlight) {
      console.log('[Migrator] previewReviewStats: już w toku, pomijam');
      return;
    }
    state._previewInFlight = true;
    state.reviewStats = {};
    const box = document.getElementById('tcm-review-stats');
    if (box) renderReviewStats(box);
    console.log('[Migrator] previewReviewStats: start');

    try {
      const results = await Promise.all(BLOG_LANGS.map(async lang => {
        try {
          const res = await fetch(buildReviewUrl(1, lang), { credentials: 'include' });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const rowsOnFirst = doc.querySelectorAll("tr[id^='comment_']").length;
          const pages = detectTotalPages(doc);
          let exactCount = rowsOnFirst;
          if (pages > 1) {
            const resL = await fetch(buildReviewUrl(pages, lang), { credentials: 'include' });
            const htmlL = await resL.text();
            const docL = new DOMParser().parseFromString(htmlL, 'text/html');
            const rowsOnLast = docL.querySelectorAll("tr[id^='comment_']").length;
            exactCount = (pages - 1) * rowsOnFirst + rowsOnLast;
          }
          return [lang, { pages, rowsOnFirst, exactCount }];
        } catch (e) {
          console.warn(`[Migrator] previewReviewStats(${lang}): błąd`, e);
          return [lang, { error: e.message || String(e) }];
        }
      }));
      state.reviewStats = Object.fromEntries(results);
      console.log('[Migrator] previewReviewStats: gotowe', state.reviewStats);
    } catch (e) {
      console.error('[Migrator] previewReviewStats: nieprzewidziany błąd', e);
      // Wstaw chociaż info o błędzie do każdego języka, żeby UI się odblokował
      state.reviewStats = Object.fromEntries(BLOG_LANGS.map(l => [l, { error: e.message || String(e) }]));
    } finally {
      state._previewInFlight = false;
      const box2 = document.getElementById('tcm-review-stats');
      if (box2) renderReviewStats(box2);
    }
  }

  async function scrapeReviewAll(sourceLang) {
    sourceLang = sourceLang || state.reviewLang;
    const langs = sourceLang === '__all__' ? BLOG_LANGS : [sourceLang];

    const progress = document.getElementById('tcm-review-progress');
    progress.innerHTML = '';
    const box = el('div', { class: 'tcm-progress' });
    const label = el('div', {}, 'Start...');
    const bar = el('div', { class: 'tcm-progress-bar' });
    const fill = el('div', { class: 'tcm-progress-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
    progress.appendChild(box);

    try {
      let totalDone = 0;
      const totalLangs = langs.length;
      for (let li = 0; li < langs.length; li++) {
        const lang = langs[li];
        label.textContent = `${lang.toUpperCase()}: wykrywanie liczby stron...`;
        const res1 = await fetch(buildReviewUrl(1, lang), { credentials: 'include' });
        const html1 = await res1.text();
        const doc1 = new DOMParser().parseFromString(html1, 'text/html');
        const totalPages = detectTotalPages(doc1);

        const perLang = [];
        const seen = new Set();
        const capture = (doc) => {
          parseReviewRows(doc).forEach(r => {
            if (seen.has(r.id)) return;
            seen.add(r.id);
            perLang.push(r);
          });
        };
        capture(doc1);
        label.textContent = `${lang.toUpperCase()}: 1/${totalPages} (${perLang.length} opinii)...`;
        fill.style.width = ((li + 1 / Math.max(totalPages, 1)) / totalLangs * 100) + '%';

        for (let p = 2; p <= totalPages; p++) {
          label.textContent = `${lang.toUpperCase()}: ${p}/${totalPages} (${perLang.length} opinii)...`;
          const res = await fetch(buildReviewUrl(p, lang), { credentials: 'include' });
          const html = await res.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const before = perLang.length;
          capture(doc);
          if (perLang.length === before) break;
          fill.style.width = ((li + p / Math.max(totalPages, 1)) / totalLangs * 100) + '%';
        }

        state.reviewData[lang] = perLang;
        GM_setValue('tcm_reviewData', state.reviewData);
        totalDone += perLang.length;
        fill.style.width = ((li + 1) / totalLangs * 100) + '%';
      }

      fill.style.width = '100%';
      label.textContent = `✓ Pobrano ${totalDone} opinii (${langs.map(l => l.toUpperCase()).join(', ')})`;
      setTimeout(renderReviews, 600);
    } catch (e) {
      label.textContent = '✗ Błąd: ' + e.message;
    }
  }

  async function scrapeProductMap() {
    if (Object.keys(state.productSlugMap).length > 0) {
      if (!confirm('Mapping produktów już istnieje. Pobrać ponownie (nadpisanie)?')) return;
    }
    const progress = document.getElementById('tcm-review-progress');
    progress.innerHTML = '';
    const box = el('div', { class: 'tcm-progress' });
    const label = el('div', {}, 'Wykrywanie liczby stron produktów...');
    const bar = el('div', { class: 'tcm-progress-bar' });
    const fill = el('div', { class: 'tcm-progress-fill', style: { width: '0%' } });
    bar.appendChild(fill);
    box.appendChild(label);
    box.appendChild(bar);
    progress.appendChild(box);

    try {
      const slugMap = {};
      const nameMap = {};
      const res1 = await fetch(buildProductUrl(1), { credentials: 'include' });
      const html1 = await res1.text();
      const doc1 = new DOMParser().parseFromString(html1, 'text/html');
      const totalPages = detectTotalPages(doc1);
      const captureProducts = (doc) => {
        parseProductRows(doc).forEach(p => {
          if (p.slug) slugMap[p.slug] = p.id;
          if (p.name) {
            const key = normalizeProductName(p.name);
            if (key && !nameMap[key]) nameMap[key] = p.id;
          }
        });
      };
      captureProducts(doc1);
      label.textContent = `Pobrano stronę 1/${totalPages} (${Object.keys(slugMap).length} po slug, ${Object.keys(nameMap).length} po nazwie)`;
      fill.style.width = (1 / totalPages * 100) + '%';

      for (let p = 2; p <= totalPages; p++) {
        const res = await fetch(buildProductUrl(p), { credentials: 'include' });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        captureProducts(doc);
        label.textContent = `Pobrano stronę ${p}/${totalPages} (${Object.keys(slugMap).length} po slug, ${Object.keys(nameMap).length} po nazwie)`;
        fill.style.width = (p / totalPages * 100) + '%';
      }

      state.productSlugMap = slugMap;
      state.productNameMap = nameMap;
      GM_setValue('tcm_productSlugMap', slugMap);
      GM_setValue('tcm_productNameMap', nameMap);
      fill.style.width = '100%';
      label.textContent = `✓ Mapping gotowy: ${Object.keys(slugMap).length} produktów po slug, ${Object.keys(nameMap).length} po nazwie`;
      setTimeout(renderReviews, 800);
    } catch (e) {
      label.textContent = '✗ Błąd: ' + e.message;
    }
  }

  function normalizeProductName(name) {
    if (!name) return '';
    // Agresywna normalizacja: usuń wszystko poza literami i cyframi.
    // Dzięki temu różnice typu "3 g" vs "3g", myślniki, ampersandy,
    // prefix "PROMOCJA!" — wszystkie znikają i strings stają się równe.
    // Działa dla polskich diakrytyków (\p{L}).
    return name
      .toLowerCase()
      .replace(/^promocja!?\s*/i, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  function resolveProductId(review) {
    // Slug — najpierw zapisane pole, jeśli brak (np. opinia scrape'owana przed v1.22)
    // to wyłuskaj z productUrl w locie
    const slug = review.productSlug || extractProductSlug(review.productUrl);
    if (slug && state.productSlugMap[slug]) {
      return state.productSlugMap[slug];
    }
    // Fallback: po nazwie (dla URL-i z order/product-rate bez slug w URL)
    if (review.productName) {
      const key = normalizeProductName(review.productName);
      if (state.productNameMap[key]) return state.productNameMap[key];
    }
    return '';
  }

  function diagnoseMapping() {
    const allReviews = [];
    BLOG_LANGS.forEach(lang => {
      (state.reviewData[lang] || []).forEach(r => allReviews.push({ ...r, _lang: lang }));
    });

    let resolvedBySlug = 0, resolvedByName = 0, unresolved = 0;
    let withoutStoredSlug = 0, slugRefExtracted = 0;
    const unresolvedSamples = [];
    allReviews.forEach(r => {
      let id = '';
      if (!r.productSlug) withoutStoredSlug++;
      const slug = r.productSlug || extractProductSlug(r.productUrl);
      if (!r.productSlug && slug) slugRefExtracted++;
      if (slug && state.productSlugMap[slug]) {
        id = state.productSlugMap[slug];
        resolvedBySlug++;
      } else if (r.productName) {
        const key = normalizeProductName(r.productName);
        if (state.productNameMap[key]) {
          id = state.productNameMap[key];
          resolvedByName++;
        }
      }
      if (!id) {
        unresolved++;
        // Zbieramy WSZYSTKIE nierozwiązane — przy 7-50 sztukach to ok
        unresolvedSamples.push({
          reviewId: r.id,
          lang: r._lang,
          productSlugStored: r.productSlug || '',
          productSlugFromUrl: extractProductSlug(r.productUrl) || '',
          productName: r.productName || '',
          normalizedName: normalizeProductName(r.productName || ''),
          productUrl: r.productUrl,
        });
      }
    });

    const slugKeys = Object.keys(state.productSlugMap);
    const nameKeys = Object.keys(state.productNameMap);

    const report = {
      'Liczba opinii': allReviews.length,
      'Rozwiązane po slug': resolvedBySlug,
      'Rozwiązane po nazwie': resolvedByName,
      'NIEROZWIĄZANE': unresolved,
      'productSlugMap rozmiar': slugKeys.length,
      'productNameMap rozmiar': nameKeys.length,
      'Bez zapisanego productSlug': withoutStoredSlug,
      '  z tego — slug odczytany z URL': slugRefExtracted,
    };
    console.log('[Migrator][diag] Statystyki rozwiązywania products_id:');
    console.table(report);

    console.log('[Migrator][diag] 10 przykładów slugMap:');
    console.table(slugKeys.slice(0, 10).map(k => ({ slug: k, id: state.productSlugMap[k] })));

    console.log('[Migrator][diag] 10 przykładów nameMap:');
    console.table(nameKeys.slice(0, 10).map(k => ({ name: k, id: state.productNameMap[k] })));

    console.log('[Migrator][diag] Próbka nierozwiązanych opinii:');
    console.table(unresolvedSamples);

    // Też pokaż w UI raport
    const progress = document.getElementById('tcm-review-progress');
    if (progress) {
      progress.innerHTML = '';
      const box = el('div', { class: 'tcm-progress' });
      box.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '8px' } }, 'Diagnostyka mapping (szczegóły w konsoli F12):'));
      Object.entries(report).forEach(([k, v]) => {
        box.appendChild(el('div', { style: { fontSize: '11px', padding: '2px 0' } },
          `${k}: ${v}`));
      });
      if (unresolvedSamples.length > 0) {
        box.appendChild(el('div', { style: { marginTop: '12px', fontWeight: '600', fontSize: '12px', color: '#dc2626' } },
          `Wszystkie nierozwiązane (${unresolvedSamples.length}):`));

        // Pełna lista nierozwiązanych. Także zbiorczo do console.table dla analizy.
        const consoleSummary = [];
        unresolvedSamples.forEach((s, idx) => {
          const closestNames = findClosestKeys(s.normalizedName, nameKeys, 3);
          const closestSlugs = s.productSlugFromUrl
            ? findClosestKeys(s.productSlugFromUrl, slugKeys, 3)
            : [];
          // Heurystyczna klasyfikacja
          let cause;
          if (!s.productSlugFromUrl && !s.productName) {
            cause = 'brak slug i nazwy w danych opinii';
          } else if (!s.productSlugFromUrl && !closestNames.length) {
            cause = 'produkt nie istnieje w katalogu';
          } else if (s.productSlugFromUrl && !closestSlugs.length && !closestNames.length) {
            cause = 'produkt usunięty z katalogu (slug nie istnieje)';
          } else if (closestNames.length || closestSlugs.length) {
            cause = 'produkt jest w katalogu pod inną nazwą/slugiem';
          } else {
            cause = 'nieznana';
          }
          consoleSummary.push({
            reviewId: s.reviewId,
            lang: s.lang,
            productName: s.productName,
            cause,
            closestName: closestNames[0] || '',
            closestNameId: closestNames[0] ? state.productNameMap[closestNames[0]] : '',
          });

          // UI: jeden blok per opinia
          const card = el('div', {
            style: {
              marginTop: '8px', padding: '8px', border: '1px solid #fecaca',
              borderRadius: '4px', background: '#fef2f2',
            },
          });
          card.appendChild(el('div', { style: { fontWeight: '600', fontSize: '11px', color: '#991b1b', wordBreak: 'break-all' } },
            `${idx + 1}. [${s.lang.toUpperCase()}] reviewId=${s.reviewId}`));
          card.appendChild(el('div', { style: { fontSize: '11px', color: '#7f1d1d', marginTop: '4px' } },
            `Powód: ${cause}`));
          card.appendChild(el('div', { style: { fontSize: '11px', color: '#64748b', wordBreak: 'break-all', marginTop: '4px' } },
            `productName: ${s.productName || '(brak)'}`));
          card.appendChild(el('div', { style: { fontSize: '11px', color: '#64748b', wordBreak: 'break-all' } },
            `slug from URL: ${s.productSlugFromUrl || '(brak)'}`));
          card.appendChild(el('div', { style: { fontSize: '11px', color: '#64748b', wordBreak: 'break-all' } },
            `normalized name: ${s.normalizedName || '(brak)'}`));
          card.appendChild(el('div', { style: { fontSize: '11px', color: '#64748b', wordBreak: 'break-all' } },
            `URL: ${s.productUrl || '(brak)'}`));
          if (closestNames.length) {
            card.appendChild(el('div', { style: { fontSize: '11px', color: '#0369a1', fontWeight: '600', marginTop: '4px' } },
              `Najbliższe nameMap:`));
            closestNames.forEach(k => {
              card.appendChild(el('div', { style: { fontSize: '11px', color: '#0369a1', wordBreak: 'break-all', paddingLeft: '12px' } },
                `• "${k}" → id=${state.productNameMap[k]}`));
            });
          }
          if (closestSlugs.length) {
            card.appendChild(el('div', { style: { fontSize: '11px', color: '#0369a1', fontWeight: '600', marginTop: '4px' } },
              `Najbliższe slugMap:`));
            closestSlugs.forEach(k => {
              card.appendChild(el('div', { style: { fontSize: '11px', color: '#0369a1', wordBreak: 'break-all', paddingLeft: '12px' } },
                `• "${k}" → id=${state.productSlugMap[k]}`));
            });
          }
          box.appendChild(card);
        });

        console.log('[Migrator][diag] Klasyfikacja nierozwiązanych (root cause):');
        console.table(consoleSummary);
      }
      progress.appendChild(box);
    }
  }

  // Znajdź klucze w mapie najbardziej podobne do query.
  // Heurystyka: dopasowanie substring + długość wspólnego prefixu.
  function findClosestKeys(query, keys, limit) {
    if (!query) return [];
    const q = query.toLowerCase();
    const scored = [];
    keys.forEach(k => {
      const kl = k.toLowerCase();
      let score = 0;
      let prefix = 0;
      const minLen = Math.min(q.length, kl.length);
      for (let i = 0; i < minLen && q[i] === kl[i]; i++) prefix++;
      score += prefix * 2;
      if (kl.includes(q)) score += q.length * 3;
      else if (q.includes(kl)) score += kl.length * 3;
      const trigrams = new Set();
      for (let i = 0; i <= q.length - 3; i++) trigrams.add(q.slice(i, i + 3));
      let common = 0;
      for (let i = 0; i <= kl.length - 3; i++) {
        if (trigrams.has(kl.slice(i, i + 3))) common++;
      }
      score += common;
      if (score > 0) scored.push({ key: k, score });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(x => x.key);
  }

  function reviewToExportRecord(review, sourceLang) {
    const cfg = state.reviewConfig;
    const ratingNum = (() => {
      const m = (review.rating || '').match(/^(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    })();
    const langCode = REVIEW_LANG_CODE[sourceLang] || cfg.defaultLanguage || 'pol';
    const force = cfg.forceConfirmedByPurchase || 'auto';
    let confirmedByPurchase;
    if (force === 'true') confirmedByPurchase = true;
    else if (force === 'false') confirmedByPurchase = false;
    else confirmedByPurchase = !!review.orderSerialNumber;

    const shopId = (cfg.shopIdByLang && cfg.shopIdByLang[sourceLang]) || '';
    return {
      createDate: review.date || '',
      confirmed: review.visible === false ? false : true,
      rating: ratingNum,
      content: review.content || '',
      language: langCode,
      shopId,
      host: review.ip || '',
      clients_name: review.nick || '',
      clients_email: review.email || '',
      products_type: 'id',
      products_id: resolveProductId(review),
      orderSerialNumber: review.orderSerialNumber || '',
      opinionConfirmedByPurchase: confirmedByPurchase,
    };
  }

  // langFilter: null/undefined = wszystkie języki, string = pojedynczy język
  function exportReview(format, langFilter) {
    const all = [];
    const langs = langFilter ? [langFilter] : BLOG_LANGS;
    langs.forEach(lang => {
      (state.reviewData[lang] || []).forEach(r => all.push(reviewToExportRecord(r, lang)));
    });
    if (!all.length) {
      alert(langFilter
        ? `Brak opinii dla języka ${langFilter.toUpperCase()}.`
        : 'Brak danych do eksportu.');
      return;
    }
    all.sort((a, b) => (a.createDate < b.createDate ? 1 : -1));

    const ts = new Date().toISOString().slice(0, 10);
    const langSuffix = langFilter ? `_${langFilter}` : '_all';
    let blob, ext;
    if (format === 'json') {
      blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      ext = 'json';
    } else if (format === 'csv') {
      const cols = ['createDate', 'confirmed', 'rating', 'content', 'language', 'shopId', 'host',
        'clients_name', 'clients_email', 'products_type', 'products_id', 'orderSerialNumber',
        'opinionConfirmedByPurchase'];
      const lines = [cols.join(';')];
      all.forEach(r => {
        lines.push(cols.map(c => {
          const v = r[c];
          if (typeof v === 'boolean') return v ? 'true' : 'false';
          return csvCell(v == null ? '' : v);
        }).join(';'));
      });
      blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
      ext = 'csv';
    } else if (format === 'xml') {
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<reviews>\n';
      all.forEach(r => {
        xml += `  <review>\n`;
        xml += `    <createDate>${xmlEscape(r.createDate)}</createDate>\n`;
        xml += `    <confirmed>${r.confirmed ? 'true' : 'false'}</confirmed>\n`;
        xml += `    <rating>${r.rating == null ? '' : r.rating}</rating>\n`;
        xml += `    <content><![CDATA[${r.content}]]></content>\n`;
        xml += `    <language>${xmlEscape(r.language)}</language>\n`;
        xml += `    <shopId>${xmlEscape(r.shopId)}</shopId>\n`;
        xml += `    <host>${xmlEscape(r.host)}</host>\n`;
        xml += `    <clients_name>${xmlEscape(r.clients_name)}</clients_name>\n`;
        xml += `    <clients_email>${xmlEscape(r.clients_email)}</clients_email>\n`;
        xml += `    <products_type>${xmlEscape(r.products_type)}</products_type>\n`;
        xml += `    <products_id>${xmlEscape(r.products_id)}</products_id>\n`;
        xml += `    <orderSerialNumber>${xmlEscape(r.orderSerialNumber)}</orderSerialNumber>\n`;
        xml += `    <opinionConfirmedByPurchase>${r.opinionConfirmedByPurchase ? 'true' : 'false'}</opinionConfirmedByPurchase>\n`;
        xml += `  </review>\n`;
      });
      xml += '</reviews>\n';
      blob = new Blob([xml], { type: 'application/xml' });
      ext = 'xml';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reviews${langSuffix}_${ts}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearReviewList() {
    if (!confirm('Wyczyścić wszystkie pobrane opinie?')) return;
    state.reviewData = {};
    state.reviewPage = 1;
    state.reviewStats = null;
    GM_setValue('tcm_reviewData', {});
    renderReviews();
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

    const footer = el('div', { id: 'tcm-footer' }, 'by Maciej Dobroń');

    panel.appendChild(header);
    panel.appendChild(breadcrumb);
    panel.appendChild(content);
    panel.appendChild(footer);

    document.body.appendChild(handle);
    document.body.appendChild(panel);

    handle.onclick = () => panel.classList.toggle('open');

    renderMenu();
  }

  createPanel();
})();
