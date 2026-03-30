// ==UserScript==
// @name         JIRA Worklog Timer - Loader
// @namespace    https://iai-jira.atlassian.net
// @version      1.0.0
// @description  Loader: licencjonowanie i aktualizacja skryptu JIRA Worklog Timer
// @match        *://*/panel/tickets.php*
// @match        *://enova.iai-system.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      license.tampermonkey.pl
// @connect      iai-jira.atlassian.net
// @connect      api.tempo.io
// @connect      enova.iai-system.com
// @connect      enova.iai-system.com
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // Na enova: tylko sync ContextHandle do GM storage i wyjdz
    // =========================================================================
    if (window.location.hostname === 'enova.iai-system.com') {
        console.log('[JiraWorklog] Bridge aktywny na enova');
        var _w = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

        // === AUTO-LOGIN: jesli jestesmy na stronie logowania, wypelnij formularz ===
        function tryAutoLogin() {
            var enovaLogin = GM_getValue('jiraWorklog_enovaLogin', '');
            var enovaPassword = GM_getValue('jiraWorklog_enovaPassword', '');
            if (!enovaLogin || !enovaPassword) {
                console.log('[JiraWorklog] Auto-login: brak loginu/hasla w ustawieniach');
                return;
            }

            // Szukaj pola login w DOM (SPA renderuje formularz dynamicznie)
            // Szerokie selektory — enova moze uzyc roznych atrybutow
            var allInputs = _w.document.querySelectorAll('input:not([type="hidden"])');
            var loginInput = null, passwordInput = null, submitBtn = null;

            allInputs.forEach(function(inp) {
                if (inp.type === 'password') passwordInput = inp;
                else if (inp.type === 'text' || inp.type === 'email' || !inp.type) {
                    if (!loginInput) loginInput = inp;
                }
            });

            submitBtn = _w.document.querySelector('button[type="submit"], input[type="submit"], button:not([type])');

            console.log('[JiraWorklog] Auto-login: login=', !!loginInput, 'password=', !!passwordInput, 'submit=', !!submitBtn, 'inputs:', allInputs.length);

            if (loginInput && passwordInput) {
                console.log('[JiraWorklog] Auto-login: formularz znaleziony, wypelniam...');
                // Ustawiamy wartosci przez nativeInputValueSetter (React/Angular friendly)
                var nativeSetter = Object.getOwnPropertyDescriptor(_w.HTMLInputElement.prototype, 'value').set;
                nativeSetter.call(loginInput, enovaLogin);
                loginInput.dispatchEvent(new _w.Event('input', { bubbles: true }));
                loginInput.dispatchEvent(new _w.Event('change', { bubbles: true }));

                nativeSetter.call(passwordInput, enovaPassword);
                passwordInput.dispatchEvent(new _w.Event('input', { bubbles: true }));
                passwordInput.dispatchEvent(new _w.Event('change', { bubbles: true }));

                // Kliknij submit po krotkim opoznieniu
                setTimeout(function() {
                    if (submitBtn) {
                        console.log('[JiraWorklog] Auto-login: klikam zaloguj...');
                        submitBtn.click();
                    } else {
                        // Fallback: Enter na polu hasla
                        passwordInput.dispatchEvent(new _w.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                        passwordInput.dispatchEvent(new _w.KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                        passwordInput.dispatchEvent(new _w.KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    }
                }, 500);
                return true;
            }
            return false;
        }

        // Na stronie logowania probuj auto-login (formularz moze sie pojawic z opoznieniem)
        // Tez probuj na /db/ bo SPA moze pokazac formularz logowania wewnatrz
        var isLoginPage = _w.location.pathname.toLowerCase().indexOf('/login') !== -1;
        var isDbPage = _w.location.pathname.toLowerCase().indexOf('/db/') !== -1;
        if (isLoginPage || isDbPage) {
            console.log('[JiraWorklog] Probuje auto-login na:', _w.location.pathname);
            var loginAttempts = 0;
            var loginTimer = setInterval(function() {
                loginAttempts++;
                if (tryAutoLogin() || loginAttempts > 30) {
                    if (loginAttempts > 30) console.log('[JiraWorklog] Auto-login: formularz nie znaleziony po 30 probach');
                    clearInterval(loginTimer);
                }
            }, 2000);
        }

        // === SYNC HANDLE + FETCH RCP DATA ===
        function syncEnovaHandle() {
            try {
                var appCtx = _w.sessionStorage.getItem('AppCtx');
                if (appCtx) {
                    var config = JSON.parse(appCtx).config;
                    if (config && config.handle) {
                        GM_setValue('jiraWorklog_enovaContextHandle', config.handle);
                        console.log('[JiraWorklog] enova handle synced:', config.handle);
                        fetchRcpData(config.handle);
                    }
                }
            } catch(e) { console.warn('[JiraWorklog] Bridge error:', e); }
        }

        var OKRES_FIELD_NAME = '_124963';

        function fetchRcpForMonth(windowHandle, year, month) {
            var lastDay = new Date(year, month, 0).getDate();
            var okres = '1...' + lastDay + '.' + String(month).padStart(2,'0') + '.' + year;
            var cacheKey = 'jiraWorklog_rcpData_' + year + '_' + month;

            console.log('[JiraWorklog] Fetching RCP for', okres);
            return _w.fetch('/WindowJSON/Execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    WindowHandle: windowHandle,
                    LiveCounter: 1,
                    UpdateValues: [{ Name: OKRES_FIELD_NAME, EditValue: okres }]
                })
            }).then(function(r) { return r.json(); }).then(function(data) {
                var listData = data.Forms && data.Forms[0] && data.Forms[0].Lists && data.Forms[0].Lists[0] && data.Forms[0].Lists[0].Data;
                if (listData) {
                    GM_setValue(cacheKey, JSON.stringify(listData));
                    GM_setValue(cacheKey + '_ts', Date.now());
                    console.log('[JiraWorklog] RCP saved for', year + '-' + month + ':', listData.length, 'entries');
                }
                return listData || [];
            });
        }

        function fetchRcpData(handle) {
            // Fetch only if last fetch was >5 min ago
            var lastFetch = GM_getValue('jiraWorklog_rcpLastFetch', 0);
            var requestedMonth = GM_getValue('jiraWorklog_rcpRequestMonth', '');

            // Check if there's a specific month request from main script
            var hasRequest = !!requestedMonth;
            var reqYear, reqMonth;
            if (hasRequest) {
                var parts = requestedMonth.split('-');
                reqYear = parseInt(parts[0], 10);
                reqMonth = parseInt(parts[1], 10);
            }

            if (!hasRequest && Date.now() - lastFetch < 5 * 60 * 1000) return;

            console.log('[JiraWorklog] Fetching RCP data from enova...' + (hasRequest ? ' (requested: ' + requestedMonth + ')' : ''));

            _w.fetch('/FolderJSON/GetStart', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    Path: 'Folder/PulpitPracownika/CzasPracyINieobecnosci/DaneZRCP',
                    ContextHandle: handle
                })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.ExceptionType) {
                    console.warn('[JiraWorklog] RCP fetch error:', data.Message);
                    return;
                }

                var windowHandle = data.Forms && data.Forms[0] && data.Forms[0].WindowHandle;
                // Save current month data from GetStart
                var listData = data.Forms && data.Forms[0] && data.Forms[0].Lists && data.Forms[0].Lists[0] && data.Forms[0].Lists[0].Data;
                if (listData) {
                    GM_setValue('jiraWorklog_rcpRawData', JSON.stringify(listData));
                    GM_setValue('jiraWorklog_rcpLastFetch', Date.now());
                    // Also save per-month cache for current month
                    var now = new Date();
                    GM_setValue('jiraWorklog_rcpData_' + now.getFullYear() + '_' + (now.getMonth()+1), JSON.stringify(listData));
                    GM_setValue('jiraWorklog_rcpData_' + now.getFullYear() + '_' + (now.getMonth()+1) + '_ts', Date.now());
                    console.log('[JiraWorklog] RCP data saved:', listData.length, 'entries');
                }

                // If specific month requested, fetch it via Execute
                if (hasRequest && windowHandle) {
                    GM_deleteValue('jiraWorklog_rcpRequestMonth');
                    fetchRcpForMonth(windowHandle, reqYear, reqMonth).then(function() {
                        setTimeout(function() { _w.close(); }, 2000);
                    });
                } else {
                    setTimeout(function() { _w.close(); }, 2000);
                }
            }).catch(function(e) {
                console.warn('[JiraWorklog] RCP fetch failed:', e);
            });
        }

        var syncAttempts = 0;
        var syncTimer = setInterval(function() {
            syncEnovaHandle();
            syncAttempts++;
            if (syncAttempts >= 12) { clearInterval(syncTimer); setInterval(syncEnovaHandle, 300000); }
        }, 5000);
        return;
    }

    // =========================================================================
    // Uruchamiaj tylko na szczegółach komunikatu (action=ins)
    // =========================================================================
    if (!window.location.search.includes('action=ins')) {
        return;
    }

    // =========================================================================
    // CONFIG
    // =========================================================================
    const WORKER_URL = 'https://license.tampermonkey.pl';
    const SCRIPT_ID = 'jira-worklog';
    const CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1h

    // =========================================================================
    // LICENSE KEY MANAGEMENT
    // =========================================================================

    function getLicenseKey() {
        return GM_getValue('licenseKey', '');
    }

    function setLicenseKey(key) {
        GM_setValue('licenseKey', key.trim());
        // Wyczyść cache przy zmianie klucza
        GM_deleteValue('cachedScript');
        GM_deleteValue('cachedVersion');
        GM_deleteValue('cacheTimestamp');
    }

    function promptForKey(message) {
        const key = prompt(
            (message ? message + '\n\n' : '') +
            'Wpisz klucz licencyjny JIRA Worklog Timer:\n(format: JWTMR-XXXX-XXXX-XXXX)'
        );
        if (key && key.trim()) {
            setLicenseKey(key);
            location.reload();
        }
    }

    // =========================================================================
    // TAMPERMONKEY MENU COMMANDS
    // =========================================================================

    GM_registerMenuCommand('🔑 Ustaw klucz licencyjny', () => {
        promptForKey('Aktualny klucz: ' + maskKey(getLicenseKey()));
    });

    GM_registerMenuCommand('ℹ️ Info o licencji', () => {
        const key = getLicenseKey();
        const version = GM_getValue('cachedVersion', 'brak');
        const lastValidation = GM_getValue('lastValidation', 'nigdy');
        alert(
            'JIRA Worklog Timer\n\n' +
            'Klucz: ' + maskKey(key) + '\n' +
            'Wersja skryptu: ' + version + '\n' +
            'Ostatnia walidacja: ' + lastValidation
        );
    });

    function maskKey(key) {
        if (!key) return '(nie ustawiony)';
        if (key.length <= 12) return key;
        return key.substring(0, 10) + '...' + key.substring(key.length - 4);
    }

    // =========================================================================
    // SCRIPT INJECTION (eval — działa w kontekście Tampermonkey sandbox,
    // więc GM_* API są naturalnie dostępne jako zmienne closure)
    // =========================================================================

    function injectScript(code) {
        try {
            eval(code);
        } catch (e) {
            showStatus('Błąd uruchomienia skryptu: ' + e.message, true);
            console.error('[JiraWorklog Loader] Eval error:', e);
        }
    }

    // =========================================================================
    // CACHE
    // =========================================================================

    function getCachedScript() {
        const script = GM_getValue('cachedScript', '');
        const version = GM_getValue('cachedVersion', '');
        const timestamp = GM_getValue('cacheTimestamp', 0);
        if (!script || !version) return null;
        return { script, version, timestamp };
    }

    function setCachedScript(script, version) {
        GM_setValue('cachedScript', script);
        GM_setValue('cachedVersion', version);
        GM_setValue('cacheTimestamp', Date.now());
    }

    function isCacheExpired() {
        const ts = GM_getValue('cacheTimestamp', 0);
        return !ts || (Date.now() - ts > CACHE_TTL_MS);
    }

    // =========================================================================
    // VALIDATION
    // =========================================================================

    function validate(key, domain, cachedVersion) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: WORKER_URL + '/api/validate',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ key, domain, cachedVersion, scriptId: SCRIPT_ID }),
                timeout: 15000,
                onload(response) {
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch {
                        reject(new Error('Nieprawidłowa odpowiedź serwera'));
                    }
                },
                onerror() {
                    reject(new Error('Błąd sieci'));
                },
                ontimeout() {
                    reject(new Error('Timeout'));
                },
            });
        });
    }

    // =========================================================================
    // UI FEEDBACK
    // =========================================================================

    function showStatus(message, isError) {
        const div = document.createElement('div');
        div.textContent = message;
        Object.assign(div.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            zIndex: '999999',
            padding: '12px 20px',
            borderRadius: '6px',
            fontSize: '14px',
            fontFamily: 'Arial, sans-serif',
            color: '#fff',
            backgroundColor: isError ? '#c0392b' : '#27ae60',
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
        });
        document.body.appendChild(div);
        setTimeout(() => div.remove(), isError ? 8000 : 3000);
    }

    // =========================================================================
    // LICENSE EXPIRY WARNING
    // =========================================================================

    function checkExpiryWarning(expiresAt) {
        if (!expiresAt) return;
        const now = new Date();
        const expires = new Date(expiresAt);
        const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
        if (daysLeft > 3) return;

        const msg = daysLeft <= 0
            ? 'Licencja JIRA Worklog Timer wygasła! Skontaktuj się z administratorem.'
            : daysLeft === 1
                ? 'Licencja JIRA Worklog Timer wygasa jutro!'
                : 'Licencja JIRA Worklog Timer wygasa za ' + daysLeft + ' dni.';

        const existing = document.getElementById('jwl-license-warning');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'jwl-license-warning';
        div.textContent = msg;
        Object.assign(div.style, {
            position: 'fixed',
            bottom: '16px',
            right: '16px',
            zIndex: '999999',
            padding: '14px 22px',
            borderRadius: '8px',
            fontSize: '13px',
            fontFamily: 'Arial, sans-serif',
            color: '#92400e',
            backgroundColor: '#fef3c7',
            border: '1px solid #f59e0b',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '340px',
            lineHeight: '1.4',
        });
        const close = document.createElement('span');
        close.textContent = '\u00d7';
        Object.assign(close.style, {
            position: 'absolute',
            top: '6px',
            right: '10px',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#92400e',
            fontWeight: 'bold',
        });
        close.onclick = () => div.remove();
        div.style.paddingRight = '32px';
        div.appendChild(close);
        document.body.appendChild(div);
    }

    // =========================================================================
    // MAIN FLOW
    // =========================================================================

    async function main() {
        const key = getLicenseKey();
        if (!key) {
            promptForKey('Brak klucza licencyjnego.');
            return;
        }

        const domain = location.hostname;
        const cache = getCachedScript();

        // Czy cache jest świeży? (< 24h)
        if (cache && !isCacheExpired()) {
            // Wstrzyknij z cache, waliduj w tle
            injectScript(cache.script);
            try {
                const result = await validate(key, domain, cache.version);
                if (result.status === 'valid') {
                    // Nowa wersja — zapisz, użyj przy następnym załadowaniu
                    setCachedScript(result.script, result.version);
                    GM_setValue('lastValidation', new Date().toLocaleString('pl'));
                    checkExpiryWarning(result.expiresAt);
                } else if (result.status === 'current') {
                    GM_setValue('lastValidation', new Date().toLocaleString('pl'));
                    checkExpiryWarning(result.expiresAt);
                } else if (result.status === 'invalid' || result.status === 'expired') {
                    // Klucz unieważniony — wyczyść cache na następne załadowanie
                    GM_deleteValue('cachedScript');
                    GM_deleteValue('cachedVersion');
                    GM_deleteValue('cacheTimestamp');
                    showStatus('Licencja: ' + result.message, true);
                }
            } catch (_e) {
                // Offline — cache nadal działa
            }
            return;
        }

        // Brak cache lub wygasły — wymagana walidacja online
        try {
            const result = await validate(key, domain, cache?.version);

            if (result.status === 'valid') {
                setCachedScript(result.script, result.version);
                GM_setValue('lastValidation', new Date().toLocaleString('pl'));
                injectScript(result.script);
                checkExpiryWarning(result.expiresAt);
            } else if (result.status === 'current' && cache) {
                // Serwer potwierdził — odśwież timestamp cache
                GM_setValue('cacheTimestamp', Date.now());
                GM_setValue('lastValidation', new Date().toLocaleString('pl'));
                injectScript(cache.script);
                checkExpiryWarning(result.expiresAt);
            } else if (result.status === 'invalid') {
                showStatus('Licencja: ' + result.message, true);
            } else if (result.status === 'expired') {
                showStatus('Licencja wygasła: ' + result.message, true);
            }
        } catch (err) {
            // Offline + wygasły cache — fallback jeśli jest cache
            if (cache) {
                injectScript(cache.script);
                showStatus('Tryb offline — cache może być nieaktualny', false);
            } else {
                showStatus('Nie można zwalidować licencji. Sprawdź połączenie.', true);
            }
        }
    }

    main();
})();
