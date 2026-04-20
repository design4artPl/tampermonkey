// ==UserScript==
// @name         Menu PRO
// @namespace    https://idosell.com/
// @version      1.5.0
// @description  Loader: bridge LLM API + licencjonowanie skryptu grupowej edycji menu
// @match        https://*.iai-shop.com/panel/*
// @match        https://*.idosell.com/panel/*
// @match        https://*/panel/app/navigation.php*
// @match        https://*/panel/navigation.php*
// @updateURL    https://license.tampermonkey.pl/install/idosell-menu.user.js
// @downloadURL  https://license.tampermonkey.pl/install/idosell-menu.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      license.tampermonkey.pl
// @connect      integrate.api.nvidia.com
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      openrouter.ai
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================
    const WORKER_URL = 'https://license.tampermonkey.pl';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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
            'Wpisz klucz licencyjny IdoSell Menu:\n(format: XXXXX-XXXX-XXXX-XXXX)'
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

    GM_registerMenuCommand('🔄 Wymuś aktualizację skryptu', () => {
        GM_deleteValue('cachedScript');
        GM_deleteValue('cachedVersion');
        GM_deleteValue('cacheTimestamp');
        GM_notification({ text: 'Cache wyczyszczony. Pobieram nową wersję...', title: 'IdoSell Menu', timeout: 2000 });
        setTimeout(() => location.reload(), 500);
    });

    GM_registerMenuCommand('🤖 Ustaw klucz API (LLM)', () => {
        const provider = GM_getValue('llmProvider', 'nvidia');
        const storageKey = provider === 'nvidia' ? 'nvidiaApiKey' : ('llmApiKey_' + provider);
        const current = GM_getValue(storageKey, '');
        const key = prompt('Klucz API dla dostawcy: ' + provider + '\n(aktualny: ' + (current ? current.substring(0, 8) + '...' : 'brak') + ')', current);
        if (key !== null) GM_setValue(storageKey, key.trim());
    });

    // Track switcher (widoczny tylko gdy backend przyznał betaAccess)
    if (GM_getValue('betaAccess', false)) {
        const currentTrack = getReleaseTrack();
        const altTrack = currentTrack === 'beta' ? 'stable' : 'beta';
        const altLabel = altTrack === 'beta' ? 'Beta (dev)' : 'Stabilna';
        GM_registerMenuCommand('📡 Kanał: ' + (currentTrack === 'beta' ? 'Beta → przełącz na Stabilną' : 'Stabilna → przełącz na Beta'), () => {
            if (!confirm('Przełączyć na kanał ' + altLabel + '?

Skrypt zostanie przeładowany.')) return;
            setReleaseTrack(altTrack);
            GM_notification({ text: 'Przełączam na ' + altLabel + '...', title: 'Menu PRO', timeout: 2000 });
            setTimeout(() => location.reload(), 400);
        });
    }

        GM_registerMenuCommand('ℹ️ Info o licencji', () => {
        const key = getLicenseKey();
        const version = GM_getValue('cachedVersion', 'brak');
        const lastValidation = GM_getValue('lastValidation', 'nigdy');
        alert(
            'IdoSell Menu - Grupowa edycja\n\n' +
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
    // LLM API BRIDGE (unsafeWindow — direct function calls, no events needed)
    // =========================================================================

    // Shared result slot — page context polls this
    unsafeWindow.__tmLLMResult = null;

    // Migrate old nvidia key to new storage pattern
    var oldNvidiaKey = GM_getValue('nvidiaApiKey', '');
    // Keep nvidiaApiKey for backward compat, but also store as llmApiKey_nvidia
    if (oldNvidiaKey && !GM_getValue('llmApiKey_nvidia', '')) {
        GM_setValue('llmApiKey_nvidia', oldNvidiaKey);
    }

    // Expose license key directly for bug report modal (accessible from injected script context)
    unsafeWindow.__tmLicenseKey = GM_getValue('licenseKey', '');

    unsafeWindow.__tmLLM = {
        getLicenseKey: function () {
            return GM_getValue('licenseKey', '');
        },
        getKey: function (storageKey) {
            // Backward compat: no arg or 'nvidiaApiKey' → try both old and new
            if (!storageKey || storageKey === 'nvidiaApiKey') {
                return GM_getValue('llmApiKey_nvidia', '') || GM_getValue('nvidiaApiKey', '');
            }
            return GM_getValue(storageKey, '');
        },
        setKey: function (storageKey, k) {
            if (!storageKey) storageKey = 'nvidiaApiKey';
            var val = (k || '').trim();
            GM_setValue(storageKey, val);
            // Backward compat: also update old key for nvidia
            if (storageKey === 'llmApiKey_nvidia') GM_setValue('nvidiaApiKey', val);
        },
        getProvider: function () {
            return GM_getValue('llmProvider', 'nvidia');
        },
        setProvider: function (p) {
            GM_setValue('llmProvider', (p || 'nvidia').trim());
        },
        // Generic call — accepts endpoint URL and headers JSON from main script
        call: function (payloadJson, endpoint, headersJson) {
            unsafeWindow.__tmLLMResult = null;

            // Parse headers
            var headers;
            try { headers = headersJson ? JSON.parse(headersJson) : null; } catch (_) { headers = null; }

            // Backward compat: no endpoint/headers → old NVIDIA-only behavior
            if (!endpoint || !headers) {
                var apiKey = GM_getValue('llmApiKey_nvidia', '') || GM_getValue('nvidiaApiKey', '');
                if (!apiKey) { unsafeWindow.__tmLLMResult = '{"error":"NO_KEY"}'; return; }
                endpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';
                headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
            }

            if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';

            GM_xmlhttpRequest({
                method: 'POST',
                url: endpoint,
                headers: headers,
                data: payloadJson,
                timeout: 120000,
                onload: function (resp) {
                    try {
                        var parsed = JSON.parse(resp.responseText);
                        if (resp.status >= 400) {
                            var errMsg = parsed.detail || (parsed.error && (parsed.error.message || parsed.error.type)) || 'HTTP ' + resp.status;
                            unsafeWindow.__tmLLMResult = JSON.stringify({ error: errMsg });
                        } else {
                            unsafeWindow.__tmLLMResult = JSON.stringify({ result: parsed });
                        }
                    } catch (e) {
                        unsafeWindow.__tmLLMResult = JSON.stringify({ error: 'HTTP ' + resp.status + ': ' + (resp.responseText || '').substring(0, 300) });
                    }
                },
                onerror: function () { unsafeWindow.__tmLLMResult = '{"error":"Błąd sieci — sprawdź połączenie internetowe"}'; },
                ontimeout: function () { unsafeWindow.__tmLLMResult = '{"error":"Timeout API (120s)"}'; },
            });
        },
    };

    // =========================================================================
    // SCRIPT INJECTION (page scope)
    // =========================================================================

    function injectScript(code) {
        // Dev mode: skip injection if main script is already running (installed directly)
        if (unsafeWindow.__tmMenuLoaded) return;
        const s = document.createElement('script');
        // Próba inline injection
        try {
            s.textContent = code;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
        } catch (_e) {
            // Fallback: blob URL (jeśli CSP blokuje inline)
            const blob = new Blob([code], { type: 'text/javascript' });
            s.src = URL.createObjectURL(blob);
            (document.head || document.documentElement).appendChild(s);
            s.addEventListener('load', () => {
                URL.revokeObjectURL(s.src);
                s.remove();
            });
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

    const LOADER_VERSION = '1.5.0';

    function getReleaseTrack() {
        const v = GM_getValue('releaseTrack', 'stable');
        return (v === 'beta') ? 'beta' : 'stable';
    }

    function setReleaseTrack(track) {
        GM_setValue('releaseTrack', track === 'beta' ? 'beta' : 'stable');
        GM_deleteValue('cachedScript');
        GM_deleteValue('cachedVersion');
        GM_deleteValue('cacheTimestamp');
    }

    function showLoaderUpdateBanner(newVersion) {
        if (document.getElementById('idm-loader-update-banner')) return;
        const banner = document.createElement('div');
        banner.id = 'idm-loader-update-banner';
        banner.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1a1d27;color:#fff;padding:14px 18px;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.3);z-index:300000;font-family:system-ui,sans-serif;font-size:13px;display:flex;align-items:center;gap:12px;max-width:340px;';
        banner.innerHTML = '<div style="flex:1">🔄 <strong>Nowa wersja loadera: ' + newVersion + '</strong><br><span style="font-size:11px;color:#9aa3b0">Kliknij aby zaktualizować</span></div>'
            + '<a href="https://license.tampermonkey.pl/install/idosell-menu.user.js" target="_blank" style="background:#3b82f6;color:#fff;padding:6px 12px;border-radius:6px;text-decoration:none;font-weight:500">Update</a>'
            + '<span style="cursor:pointer;padding:4px 8px;font-size:18px;color:#9aa3b0" onclick="this.parentElement.remove()">×</span>';
        document.body.appendChild(banner);
    }

    function syncValidateMeta(result) {
        if (result.betaAccess !== undefined) GM_setValue('betaAccess', !!result.betaAccess);
        // Jeśli serwer zwrócił inny track niż lokalny (silent downgrade) — sync
        if (result.track && result.track !== getReleaseTrack()) {
            GM_setValue('releaseTrack', result.track);
        }
        // Banner aktualizacji loadera
        if (result.newestLoaderVersion) {
            setTimeout(() => showLoaderUpdateBanner(result.newestLoaderVersion), 1500);
        }
    }

        function validate(key, domain, cachedVersion) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: WORKER_URL + '/api/validate',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({ key, domain, cachedVersion, track: getReleaseTrack(), loaderVersion: LOADER_VERSION }),
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
        // Only show on menuTree page, not on navigation.php list
        if (!/[?&]action=menuTree/.test(location.search)) return;
        const now = new Date();
        const expires = new Date(expiresAt);
        const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
        if (daysLeft > 3) return;

        const msg = daysLeft <= 0
            ? 'Licencja IdoSell Menu wygasła! Skontaktuj się z administratorem w celu odnowienia.'
            : daysLeft === 1
                ? 'Licencja IdoSell Menu wygasa jutro! Skontaktuj się z administratorem w celu odnowienia.'
                : 'Licencja IdoSell Menu wygasa za ' + daysLeft + ' dni. Skontaktuj się z administratorem w celu odnowienia.';

        // Remove existing warning if any
        const existing = document.getElementById('idm-license-warning');
        if (existing) existing.remove();

        const div = document.createElement('div');
        div.id = 'idm-license-warning';
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
        div.style.position = 'fixed';
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
                    syncValidateMeta(result);
                } else if (result.status === 'current') {
                    GM_setValue('lastValidation', new Date().toLocaleString('pl'));
                    checkExpiryWarning(result.expiresAt);
                    syncValidateMeta(result);
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
                syncValidateMeta(result);
            } else if (result.status === 'current' && cache) {
                // Serwer potwierdził — odśwież timestamp cache
                GM_setValue('cacheTimestamp', Date.now());
                GM_setValue('lastValidation', new Date().toLocaleString('pl'));
                injectScript(cache.script);
                checkExpiryWarning(result.expiresAt);
                syncValidateMeta(result);
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

    // Uruchom main() tylko na stronie menu (navigation.php)
    function isMenuPage() {
        return location.pathname.includes('navigation.php');
    }

    if (isMenuPage()) {
        main();
    } else {
        // SPA — obserwuj zmiany URL i uruchom gdy użytkownik przejdzie do menu
        let lastUrl = location.href;
        let started = false;
        const observer = new MutationObserver(() => {
            if (started) return;
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                if (isMenuPage()) {
                    started = true;
                    observer.disconnect();
                    main();
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
