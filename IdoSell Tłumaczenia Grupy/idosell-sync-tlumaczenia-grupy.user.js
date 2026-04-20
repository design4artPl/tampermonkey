// ==UserScript==
// @name         IdoSell - Sync tlumaczen grupy wariantow
// @namespace    https://idosell.com/
// @version      1.0.0
// @description  Automat: iteruje po wariantach grupy i submituje basicForm w ukrytym iframe. IdoSell przy zapisie przepisuje languages[lang_0][groupname]/productingroupname ze slownika parameters.php.
// @author       SyncOffer
// @match        https://*.iai-shop.com/panel/app/product-edit.php*
// @match        https://*.idosell.com/panel/app/product-edit.php*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  var DEFAULT_LANGS = ["eng"];
  var HOST = location.origin;

  function getIfrWin() { var f = document.querySelector("iframe"); return f && f.contentWindow; }

  function waitForGroup(cb, n) {
    n = n || 0;
    if (n > 80) return;
    var w = getIfrWin();
    var g = w && w.IAI && w.IAI._GROUP && w.IAI._GROUP.productGroup;
    if (g && g.mainProduct) return cb(g);
    setTimeout(function () { waitForGroup(cb, n + 1); }, 500);
  }

  function styleOnce() {
    if (document.getElementById("tg-styles")) return;
    var s = document.createElement("style");
    s.id = "tg-styles";
    s.textContent = ".tg-fab{position:fixed;right:20px;bottom:24px;z-index:2147483000;background:#2563eb;color:#fff;border:none;border-radius:24px;padding:10px 16px;font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.2);cursor:pointer}.tg-fab:hover{background:#1d4ed8}.tg-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483100;display:flex;align-items:center;justify-content:center;font-family:sans-serif}.tg-mdl{background:#fff;width:640px;max-width:calc(100vw - 40px);max-height:calc(100vh - 60px);overflow:auto;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3)}.tg-hd{padding:14px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}.tg-hd h2{margin:0;font-size:16px;font-weight:600}.tg-bd{padding:16px 20px;font-size:13px;color:#334155;line-height:1.5}.tg-bd label{display:block;margin:10px 0;font-weight:500}.tg-bd input{width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:4px;font-size:13px;box-sizing:border-box}.tg-ft{padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;justify-content:flex-end;gap:8px}.tg-btn{padding:7px 16px;border-radius:5px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155}.tg-btn--p{background:#2563eb;border-color:#2563eb;color:#fff}.tg-btn[disabled]{opacity:.5;cursor:not-allowed}.tg-list{font-family:monospace;font-size:12px;max-height:160px;overflow:auto;border:1px solid #e2e8f0;padding:8px;border-radius:4px;background:#f8fafc;margin:10px 0;word-break:break-all}.tg-pr{margin:12px 0}.tg-pr_b{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}.tg-pr_f{height:100%;background:#2563eb;transition:width .2s}.tg-pr_t{font-size:12px;color:#64748b;margin-top:4px}.tg-close{border:none;background:transparent;cursor:pointer;color:#64748b;font-size:20px;width:28px;height:28px}.tg-log{font-family:monospace;font-size:11px;max-height:220px;overflow:auto;border:1px solid #1e293b;padding:6px 8px;background:#0f172a;color:#e2e8f0;border-radius:4px;margin-top:8px;white-space:pre-wrap}";
    document.head.appendChild(s);
  }

  async function fetchSiblings(mainId) {
    var url = HOST + "/panel/app/products-list.php?version=" + encodeURIComponent(mainId) + "&versionall=1";
    var html = await fetch(url, { credentials: "include" }).then(function (r) { return r.text(); });
    var ids = new Set();
    var re = /product-edit\.php\?idt=(\d+)/g;
    var m;
    while ((m = re.exec(html)) !== null) ids.add(m[1]);
    var re2 = /productRow_(\d+)/g;
    while ((m = re2.exec(html)) !== null) ids.add(m[1]);
    return Array.from(ids).filter(function (x) { return Number(x) > 0; });
  }

  function triggerSave(pid, lang, log) {
    return new Promise(function (resolve, reject) {
      var ifr = document.createElement("iframe");
      ifr.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1280px;height:900px;border:0";
      ifr.src = HOST + "/panel/app/product-edit.php?idt=" + encodeURIComponent(pid) + "&lang=" + encodeURIComponent(lang);
      var done = false, loads = 0, submitted = false;
      var wd = setTimeout(function () { finish(false, new Error("timeout " + pid + "/" + lang)); }, 60000);
      function finish(ok, data) {
        if (done) return;
        done = true;
        clearTimeout(wd);
        try { document.body.removeChild(ifr); } catch (e) {}
        (ok ? resolve : reject)(data);
      }
      function trySubmit() {
        try {
          var inner = ifr.contentDocument && ifr.contentDocument.querySelector("iframe");
          var d = inner && inner.contentDocument;
          if (!d) return false;
          var form = d.getElementById("basicForm");
          if (!form) return false;
          if (log) log("submit basicForm");
          submitted = true;
          form.submit();
          return true;
        } catch (e) { return false; }
      }
      ifr.addEventListener("load", function () {
        loads++;
        if (loads === 1) {
          var tries = 0, t;
          t = setInterval(function () {
            tries++;
            if (trySubmit()) { clearInterval(t); }
            else if (tries > 12) { clearInterval(t); finish(false, new Error("no basicForm " + pid)); }
          }, 700);
        } else if (submitted) {
          setTimeout(function () { finish(true, { pid: pid, lang: lang }); }, 400);
        }
      });
      document.body.appendChild(ifr);
    });
  }

  function addFab(group) {
    styleOnce();
    if (document.getElementById("tg-fab")) return;
    var b = document.createElement("button");
    b.id = "tg-fab";
    b.className = "tg-fab";
    b.textContent = "Sync tlumaczenia grupy";
    b.addEventListener("click", function () { showModal(group); });
    document.body.appendChild(b);
  }

  function showModal(group) {
    var ov = document.createElement("div");
    ov.className = "tg-ov";
    var mdl = document.createElement("div");
    mdl.className = "tg-mdl";
    ov.appendChild(mdl);
    var groupName = group.groupName || "?";
    var H = [];
    H.push('<div class="tg-hd"><h2>Synchronizacja tlumaczen wariantow</h2><button class="tg-close" type="button">x</button></div>');
    H.push('<div class="tg-bd">');
    H.push('<p>Grupa: <b>' + groupName + '</b> main: <b>' + group.mainProduct + '</b></p>');
    H.push('<p>Skrypt otwiera ukryty product-edit.php?lang=X dla kazdego wariantu, czeka na basicForm i wywoluje submit. IdoSell przy zapisie przepisuje groupname/productingroupname ze slownika parameters.php.</p>');
    H.push('<label>Jezyki (oddzielone przecinkami):<br><input type="text" id="tg-langs" value="' + DEFAULT_LANGS.join(",") + '"></label>');
    H.push('<label>Rownoleglosc (1-3):<br><input type="text" id="tg-par" value="1" style="width:60px"></label>');
    H.push('<div class="tg-list" id="tg-sib">Kliknij Skanuj grupe</div>');
    H.push('<div class="tg-pr" style="display:none" id="tg-pr"><div class="tg-pr_b"><div class="tg-pr_f" id="tg-f" style="width:0%"></div></div><div class="tg-pr_t" id="tg-t"></div></div>');
    H.push('<div class="tg-log" id="tg-log" style="display:none"></div>');
    H.push('</div>');
    H.push('<div class="tg-ft"><button class="tg-btn" type="button" id="tg-scan">Skanuj grupe</button><button class="tg-btn tg-btn--p" type="button" id="tg-run" disabled>Uruchom automat</button></div>');
    mdl.innerHTML = H.join("");
    document.body.appendChild(ov);

    var close = function () { try { document.body.removeChild(ov); } catch (e) {} };
    mdl.querySelector(".tg-close").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });

    var siblings = [];
    var q = function (s) { return mdl.querySelector(s); };
    var log = function (s) {
      var l = q("#tg-log");
      l.style.display = "";
      l.textContent += s + "\n";
      l.scrollTop = l.scrollHeight;
    };

    q("#tg-scan").addEventListener("click", async function () {
      var btn = q("#tg-scan");
      btn.disabled = true;
      q("#tg-sib").textContent = "Pobieranie listy wariantow...";
      try {
        siblings = await fetchSiblings(group.mainProduct);
        if (!siblings.length) { q("#tg-sib").textContent = "Nie znaleziono wariantow"; return; }
        q("#tg-sib").innerHTML = "<b>" + siblings.length + " produktow:</b><br>" + siblings.join(", ");
        q("#tg-run").disabled = false;
      } catch (e) { q("#tg-sib").textContent = "Blad: " + e.message; }
      finally { btn.disabled = false; }
    });

    q("#tg-run").addEventListener("click", async function () {
      var langs = q("#tg-langs").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!langs.length) return alert("Podaj co najmniej jeden jezyk");
      var par = Math.max(1, Math.min(3, Number(q("#tg-par").value) || 1));
      var total = siblings.length * langs.length;
      if (!confirm("Zapisze " + total + " kombinacji. Kontynuowac?")) return;
      q("#tg-scan").disabled = true;
      q("#tg-run").disabled = true;
      q("#tg-pr").style.display = "";
      q("#tg-log").textContent = "";

      var tasks = [];
      siblings.forEach(function (id) { langs.forEach(function (lang) { tasks.push({ id: id, lang: lang }); }); });
      var done = 0, ok = 0, fail = 0, idx = 0;
      function upd(m) {
        q("#tg-t").textContent = m + " - " + done + "/" + total + " (ok: " + ok + ", err: " + fail + ")";
        q("#tg-f").style.width = Math.round(done / total * 100) + "%";
      }
      async function runOne(t) {
        log("-> " + t.id + "/" + t.lang);
        try { await triggerSave(t.id, t.lang, function (s) { log("   " + s); }); ok++; log("   OK"); }
        catch (e) { fail++; log("   X " + (e.message || e)); }
        finally { done++; upd("Praca"); }
      }
      async function worker() { while (idx < tasks.length) { var t = tasks[idx++]; await runOne(t); } }
      var ws = [];
      for (var i = 0; i < par; i++) ws.push(worker());
      await Promise.all(ws);
      upd("Zakonczone");
      log("\nGotowe. Sprawdz front.");
      q("#tg-scan").disabled = false;
    });
  }

  waitForGroup(function (g) { if (g && g.mainProduct) addFab(g); });
})();
