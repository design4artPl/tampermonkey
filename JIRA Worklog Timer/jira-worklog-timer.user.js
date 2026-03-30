// ==UserScript==
// @name         JIRA Worklog Timer - IAI Tickets
// @namespace    https://iai-jira.atlassian.net
// @version      2.30
// @description  Start/Stop worklog timer for JIRA tasks (via Tempo API) from IAI ticket page
// @match        *://*/panel/tickets.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_deleteValue
// @connect      iai-jira.atlassian.net
// @connect      api.tempo.io
// @connect      enova.iai-system.com
// @connect      license.tampermonkey.pl
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Uruchamiaj tylko na szczegolach komunikatu (action=ins&ticketId=...)
    if (!window.location.search.includes('action=ins')) {
        return;
    }

    console.log('[JiraWorklog] v2.29 - Skrypt uruchomiony na:', window.location.href);

    // ========== CONFIGURATION ==========
    const JIRA_BASE_URL = 'https://iai-jira.atlassian.net';
    const TEMPO_API_URL = 'https://api.tempo.io/4';
    const STORAGE_KEY_PREFIX = 'jiraWorklog_';
    const ENOVA_BASE_URL = 'https://enova.iai-system.com';
    const ENOVA_DB_NAME = 'IAI';
    // Watermark — loaded from GM (set by loader before eval)
    var __WM__ = '';
    try { __WM__ = GM_getValue('__wm', ''); } catch(e) {}

    var monthlyCache = {}; // key: "YYYY-MM" -> dayMap
    var rcpCache = {}; // key: "YYYY-MM" -> rcpMap
    var iaiCache = {}; // key: "YYYY-MM" -> iaiMap
    var _loadMonthlyData = null; // ref exposed for settings modal
    var _renderMonthlyData = null;
    var _monthlyYear = null, _monthlyMonth = null;

    // Watermark validation helpers (obfuscator will transform these)
    function _wmOk() {
        if (!__WM__) return true; // no watermark = no loader = skip check (local test)
        return __WM__.length > 20 && __WM__.indexOf('.') > 0;
    }
    function _halt() {
        var f = document.getElementById('jwl-fab'); if (f) f.remove();
        var p = document.getElementById('jira-worklog-panel'); if (p) p.remove();
        try { GM_deleteValue('cachedScript'); GM_deleteValue('cachedVersion'); GM_deleteValue('cacheTimestamp'); } catch(e) {}
    }

    // Kill signal listener — loader sets __killSignal when license revoked
    setInterval(function() {
        try {
            var ks = GM_getValue('__killSignal', 0);
            if (ks && (Date.now() - ks < 60000)) {
                GM_deleteValue('__killSignal');
                _halt();
            }
        } catch(e) {}
    }, 5000);

    // Runtime heartbeat — co 5 min walidacja sesji
    var __hbToken = null;
    var __hbFails = 0;
    try { __hbToken = GM_getValue('__sessionToken', null); } catch(e) {}

    function __doHeartbeat() {
        if (!__hbToken) return;
        var lk = '';
        try { lk = GM_getValue('licenseKey', ''); } catch(e) {}
        if (!lk) return;

        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://license.tampermonkey.pl/api/heartbeat',
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ sessionToken: __hbToken, key: lk, domain: location.hostname }),
            timeout: 10000,
            onload: function(r) {
                try {
                    var d = JSON.parse(r.responseText);
                    if (d.status === 'ok' && d.newToken) {
                        __hbToken = d.newToken;
                        __hbFails = 0;
                        try { GM_setValue('__sessionToken', d.newToken); } catch(e) {}
                    } else {
                        __hbFails++;
                        if (__hbFails >= 3) _halt();
                    }
                } catch(e) { __hbFails++; if (__hbFails >= 3) _halt(); }
            },
            onerror: function() { __hbFails++; if (__hbFails >= 3) _halt(); },
            ontimeout: function() { __hbFails++; if (__hbFails >= 3) _halt(); }
        });
    }

    if (__hbToken) {
        setInterval(__doHeartbeat, 5 * 60 * 1000);
        // Pierwszy heartbeat po 30s (daj czas na init)
        setTimeout(__doHeartbeat, 30000);
    }

    // ========== ENOVA RCP FUNCTIONS ==========
    var enovaTabOpened = false;

    function parseEnovaRcpList(listData) {
        var rcpMap = {};
        listData.forEach(function(row) {
            var dateParts = (row[2] || '').split('.');
            if (dateParts.length !== 3) return;
            var dateKey = dateParts[2] + '-' + dateParts[1].padStart(2, '0') + '-' + dateParts[0].padStart(2, '0');
            if (!rcpMap[dateKey]) rcpMap[dateKey] = { entries: [] };
            rcpMap[dateKey].entries.push({ time: row[3] || '', type: row[4] || '' });
        });
        Object.keys(rcpMap).forEach(function(dateKey) {
            var entries = rcpMap[dateKey].entries;
            var firstEntry = null, lastExit = null;
            entries.forEach(function(e) {
                var tp = e.time.split(':');
                var mins = parseInt(tp[0], 10) * 60 + parseInt(tp[1] || '0', 10);
                if (e.type === 'Wej\u015bcie' && (firstEntry === null || mins < firstEntry)) firstEntry = mins;
                if (e.type === 'Wyj\u015bcie' && (lastExit === null || mins > lastExit)) lastExit = mins;
            });
            rcpMap[dateKey].firstEntryMin = firstEntry;
            rcpMap[dateKey].lastExitMin = lastExit;
        });
        return rcpMap;
    }

    function fetchEnovaRcpData(enovaContextHandle, fromDate, toDate, callback) {
        var parts = fromDate.split('-');
        var reqYear = parseInt(parts[0], 10);
        var reqMonth = parseInt(parts[1], 10);
        var perMonthKey = STORAGE_KEY_PREFIX + 'rcpData_' + reqYear + '_' + reqMonth;

        var perMonthData = GM_getValue(perMonthKey, '');
        var perMonthTs = GM_getValue(perMonthKey + '_ts', 0);
        var perMonthAge = Math.round((Date.now() - perMonthTs) / 60000);

        if (perMonthData && perMonthAge < 60) {
            console.log('[JiraWorklog] Enova RCP from per-month cache (' + reqYear + '-' + reqMonth + '), age:', perMonthAge, 'min');
            try {
                callback(null, parseEnovaRcpList(JSON.parse(perMonthData)));
            } catch(e) { callback(null, {}); }
            return;
        }

        var rawData = GM_getValue(STORAGE_KEY_PREFIX + 'rcpRawData', '');
        var lastFetch = GM_getValue(STORAGE_KEY_PREFIX + 'rcpLastFetch', 0);
        var ageMin = Math.round((Date.now() - lastFetch) / 60000);
        console.log('[JiraWorklog] Reading RCP from GM storage, age:', ageMin, 'min');

        if (!rawData || ageMin > 60) {
            if (!enovaTabOpened) {
                enovaTabOpened = true;
                GM_setValue(STORAGE_KEY_PREFIX + 'rcpRequestMonth', reqYear + '-' + reqMonth);
                console.log('[JiraWorklog] Opening enova in background tab to fetch RCP data for', reqYear + '-' + reqMonth);
                GM_openInTab(ENOVA_BASE_URL + '/login/' + ENOVA_DB_NAME, { active: false });
                var retryCount = 0;
                var retryTimer = setInterval(function() {
                    retryCount++;
                    var pmData = GM_getValue(perMonthKey, '');
                    var pmTs = GM_getValue(perMonthKey + '_ts', 0);
                    var legacyData = GM_getValue(STORAGE_KEY_PREFIX + 'rcpRawData', '');
                    var legacyTs = GM_getValue(STORAGE_KEY_PREFIX + 'rcpLastFetch', 0);
                    if ((pmData && (Date.now() - pmTs) < 60000) || (legacyData && (Date.now() - legacyTs) < 60000)) {
                        clearInterval(retryTimer);
                        console.log('[JiraWorklog] RCP data received from background tab');
                        enovaTabOpened = false;
                        fetchEnovaRcpData(enovaContextHandle, fromDate, toDate, callback);
                    } else if (retryCount > 30) {
                        clearInterval(retryTimer);
                        enovaTabOpened = false;
                        callback('Timeout \u2014 enova nie dostarczyla danych RCP');
                    }
                }, 2000);
                return;
            }
            if (!rawData) {
                callback('Brak danych RCP');
                return;
            }
        }

        try {
            var listData = JSON.parse(rawData);
            console.log('[JiraWorklog] RCP entries from legacy cache:', listData.length);
            if (!listData || !listData.length) {
                callback(null, {});
                return;
            }
            callback(null, parseEnovaRcpList(listData));
        } catch(e) {
            callback('Blad parsowania enova: ' + e.message);
        }
    }

    function formatMinutesToTime(totalMinutes) {
        var h = Math.floor(totalMinutes / 60);
        var m = totalMinutes % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    // ========== IAI RCP FUNCTIONS ==========
    var IAI_CACHE_TTL = 30 * 60 * 1000; // 30 min

    function parseIaiRcpHtml(html) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var innerTable = doc.querySelector('table table');
        if (!innerTable) return null;

        var thead = innerTable.querySelector(':scope > thead');
        var tbody = innerTable.querySelector(':scope > tbody');
        var headerRow = null, dataRow = null;
        if (thead && tbody) {
            headerRow = thead.querySelector('tr');
            dataRow = tbody.querySelector('tr');
        } else {
            var allTr = innerTable.querySelectorAll('tr');
            if (allTr.length >= 2) { headerRow = allTr[0]; dataRow = allTr[1]; }
        }
        if (!headerRow || !dataRow) return null;

        var headerCells = headerRow.querySelectorAll(':scope > td, :scope > th');
        var dataCells = dataRow.querySelectorAll(':scope > td, :scope > th');
        var iaiMap = {};
        for (var i = 0; i < headerCells.length && i < dataCells.length; i++) {
            var dateText = (headerCells[i].textContent || '').trim();
            var dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/);
            if (!dateMatch) continue;
            var dateKey = dateMatch[1];
            var cellText = (dataCells[i].textContent || '').trim();
            var tmMatch = cellText.match(/TM:\s*(\d+):(\d+)/);
            var rcpMatch = cellText.match(/RCP:\s*(\d+):(\d+)/);
            if (tmMatch || rcpMatch) {
                var tmMin = tmMatch ? (parseInt(tmMatch[1], 10) * 60 + parseInt(tmMatch[2], 10)) : 0;
                var rcpMin = rcpMatch ? (parseInt(rcpMatch[1], 10) * 60 + parseInt(rcpMatch[2], 10)) : 0;
                iaiMap[dateKey] = { tmMin: tmMin, rcpMin: rcpMin, rcpStart: null, rcpEnd: null, tmStart: null, tmEnd: null };
            }
        }

        // Extract RCP IN/OUT and TM START/STOP from embedded JS
        var tmBlockRegex = /tmp\["(\d{4}-\d{2}-\d{2})"\]\s*=\s*'([^']+)'/g;
        var tmBlockMatch;
        while ((tmBlockMatch = tmBlockRegex.exec(html)) !== null) {
            var bDate = tmBlockMatch[1];
            var bHtml = tmBlockMatch[2];
            if (!iaiMap[bDate]) continue;
            var rcpTableMatch = bHtml.match(/summary_RCP[\s\S]*?<\/table>/);
            if (rcpTableMatch) {
                var rcpTimeRegex = /(\d{2}):(\d{2}):\d{2}/g;
                var rcpTimes = [];
                var rMatch;
                while ((rMatch = rcpTimeRegex.exec(rcpTableMatch[0])) !== null) {
                    rcpTimes.push(parseInt(rMatch[1], 10) * 60 + parseInt(rMatch[2], 10));
                }
                if (rcpTimes.length >= 2) {
                    iaiMap[bDate].rcpStart = rcpTimes[0];
                    iaiMap[bDate].rcpEnd = rcpTimes[rcpTimes.length - 1];
                }
            }
            var tmTableMatch = bHtml.match(/summary_TM[\s\S]*?<\/table>/);
            if (tmTableMatch) {
                var tmTimeRegex = /(\d{2}):(\d{2}):\d{2}/g;
                var times = [];
                var tMatch;
                while ((tMatch = tmTimeRegex.exec(tmTableMatch[0])) !== null) {
                    times.push(parseInt(tMatch[1], 10) * 60 + parseInt(tMatch[2], 10));
                }
                if (times.length >= 2) {
                    iaiMap[bDate].tmStart = times[0];
                    iaiMap[bDate].tmEnd = times[times.length - 1];
                }
            }
        }
        return iaiMap;
    }

    function fetchIaiRcpData(year, month, callback) {
        var now = new Date();
        var curKey = now.getFullYear() * 12 + now.getMonth();
        var reqKey = year * 12 + month;
        if (reqKey < curKey - 1) {
            callback('unavailable');
            return;
        }

        var cacheKey = 'iaiRcp_' + year + '_' + (month + 1);
        var cached = GM_getValue(STORAGE_KEY_PREFIX + cacheKey, '');
        var cachedTs = GM_getValue(STORAGE_KEY_PREFIX + cacheKey + '_ts', 0);
        var age = Date.now() - cachedTs;
        if (cached && age < IAI_CACHE_TTL) {
            console.log('[JiraWorklog] IAI RCP from cache, age:', Math.round(age / 60000), 'min');
            try { callback(null, JSON.parse(cached)); } catch(e) { callback(null, {}); }
            return;
        }

        var type = (year === now.getFullYear() && month === now.getMonth()) ? 'my_current' : 'my_prior';
        var url = '/panel/rcp.php?action=search&type=' + type;
        console.log('[JiraWorklog] Fetching IAI RCP from:', url);
        GM_xmlhttpRequest({
            method: 'GET',
            url: window.location.origin + url,
            onload: function(response) {
                if (response.status !== 200) { callback('IAI RCP HTTP ' + response.status); return; }
                try {
                    var iaiMap = parseIaiRcpHtml(response.responseText);
                    if (!iaiMap) { callback(null, {}); return; }
                    console.log('[JiraWorklog] IAI RCP parsed:', Object.keys(iaiMap).length, 'days \u2014 caching');
                    GM_setValue(STORAGE_KEY_PREFIX + cacheKey, JSON.stringify(iaiMap));
                    GM_setValue(STORAGE_KEY_PREFIX + cacheKey + '_ts', Date.now());
                    callback(null, iaiMap);
                } catch(e) { callback('IAI RCP parse error: ' + e.message); }
            },
            onerror: function() { callback('IAI RCP connection error'); }
        });
    }

    // ========== STYLES (dodane programatycznie jak w skrypcie kurierow) ==========
    const jwlStyleEl = document.createElement('style');
    jwlStyleEl.textContent = `
        /* FAB - floating action button (circular icon) - stala pozycja, mniejszy */
        #jwl-fab {
            position: fixed;
            bottom: 160px;
            right: 20px;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #2684FF;
            border: none;
            cursor: pointer;
            z-index: 1000000;
            box-shadow: 0 3px 12px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.2s, box-shadow 0.2s;
            user-select: none;
        }
        #jwl-fab:hover {
            transform: scale(1.05);
            box-shadow: 0 4px 16px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15);
        }
        #jwl-fab-tooltip {
            position: absolute;
            right: 52px;
            top: 50%;
            transform: translateY(-50%) translateX(8px);
            background: #1a1a1a;
            color: #fff;
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            font-weight: 500;
            padding: 6px 12px;
            border-radius: 6px;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
        }
        #jwl-fab-tooltip::after {
            content: '';
            position: absolute;
            top: 50%;
            right: -4px;
            transform: translateY(-50%) rotate(45deg);
            width: 8px;
            height: 8px;
            background: #1a1a1a;
        }
        #jwl-fab:hover #jwl-fab-tooltip {
            opacity: 1;
            transform: translateY(-50%) translateX(0);
        }
        #jwl-fab:active {
            transform: scale(0.95);
        }
        #jwl-fab.running {
            background: #fff;
            box-shadow: 0 2px 10px rgba(0,135,90,0.5), 0 0 0 2px rgba(0,135,90,0.3);
            animation: jwl-pulse 2s ease-in-out infinite;
        }
        @keyframes jwl-pulse {
            0%, 100% { box-shadow: 0 2px 10px rgba(0,135,90,0.5), 0 0 0 2px rgba(0,135,90,0.3); }
            50% { box-shadow: 0 2px 16px rgba(0,135,90,0.6), 0 0 0 5px rgba(0,135,90,0.15); }
        }
        #jwl-fab svg {
            width: 22px;
            height: 22px;
        }
        #jwl-fab-badge {
            position: absolute;
            top: -2px;
            right: -2px;
            background: #DE350B;
            color: #fff;
            font-size: 9px;
            font-weight: 700;
            padding: 2px 5px;
            border-radius: 8px;
            font-family: 'DM Sans', Arial, sans-serif;
            display: none;
            line-height: 1;
        }
        #jwl-fab-badge.visible {
            display: block;
        }

        /* Panel */
        #jira-worklog-panel {
            position: fixed;
            top: 10px;
            right: 10px;
            width: 420px;
            background: #fff;
            border: none;
            border-radius: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            z-index: 999999;
            font-family: 'DM Sans', 'Inter', Arial, sans-serif;
            font-size: 13px;
            display: none;
        }
        #jira-worklog-panel.jwl-visible {
            display: block;
        }
        .jwl-header {
            background: #0052CC;
            color: #fff;
            padding: 8px 12px;
            border-radius: 6px 6px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            user-select: none;
        }
        .jwl-header-title {
            font-weight: 700;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .jwl-header-buttons {
            display: flex;
            gap: 4px;
        }
        .jwl-header-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            width: 26px;
            height: 26px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .jwl-header-btn:hover {
            background: rgba(255,255,255,0.4);
        }
        .jwl-body {
            padding: 12px;
            max-height: calc(100vh - 60px);
            overflow-y: auto;
        }
        .jwl-section {
            margin-bottom: 10px;
        }
        .jwl-section:last-child {
            margin-bottom: 0;
        }
        .jwl-label {
            font-weight: 600;
            color: #172B4D;
            margin-bottom: 4px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .jwl-select {
            width: 100%;
            padding: 8px 10px;
            border: 2px solid #DFE1E6;
            border-radius: 4px;
            font-size: 12px;
            font-family: inherit;
            background: #FAFBFC;
            color: #172B4D;
            cursor: pointer;
            transition: border-color 0.2s;
        }
        .jwl-select:focus {
            border-color: #0052CC;
            outline: none;
            background: #fff;
        }
        .jwl-select optgroup {
            font-weight: 700;
            color: #0052CC;
            font-size: 12px;
        }
        .jwl-select option {
            font-weight: 400;
            color: #172B4D;
            padding: 4px;
        }
        .jwl-timer-display {
            text-align: center;
            padding: 12px;
            background: #F4F5F7;
            border-radius: 6px;
            margin-bottom: 10px;
        }
        .jwl-timer-time {
            font-size: 36px;
            font-weight: 700;
            color: #172B4D;
            font-variant-numeric: tabular-nums;
            letter-spacing: 2px;
        }
        .jwl-timer-time.running {
            color: #00875A;
        }
        .jwl-timer-task {
            font-size: 11px;
            color: #6B778C;
            margin-top: 4px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .jwl-btn-row {
            display: flex;
            gap: 8px;
        }
        .jwl-btn {
            flex: 1;
            padding: 10px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .jwl-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .jwl-btn-start {
            background: #00875A;
            color: #fff;
        }
        .jwl-btn-start:hover:not(:disabled) {
            background: #006644;
        }
        .jwl-btn-stop {
            background: #DE350B;
            color: #fff;
        }
        .jwl-btn-stop:hover:not(:disabled) {
            background: #BF2600;
        }
        .jwl-btn-send {
            background: #0052CC;
            color: #fff;
        }
        .jwl-btn-send:hover:not(:disabled) {
            background: #0747A6;
        }
        .jwl-btn-settings {
            background: #DFE1E6;
            color: #172B4D;
        }
        .jwl-btn-settings:hover {
            background: #C1C7D0;
        }
        .jwl-textarea {
            width: 100%;
            padding: 8px 10px;
            border: 2px solid #DFE1E6;
            border-radius: 4px;
            font-size: 12px;
            font-family: inherit;
            resize: vertical;
            min-height: 50px;
            max-height: 120px;
            background: #FAFBFC;
            color: #172B4D;
            transition: border-color 0.2s;
            box-sizing: border-box;
        }
        .jwl-textarea:focus {
            border-color: #0052CC;
            outline: none;
            background: #fff;
        }
        .jwl-status {
            text-align: center;
            padding: 6px;
            border-radius: 4px;
            font-size: 12px;
            margin-top: 8px;
            display: none;
        }
        .jwl-status a {
            color: inherit;
            font-weight: 600;
            text-decoration: underline;
        }
        .jwl-status a:hover {
            opacity: 0.8;
        }
        .jwl-status.warning {
            display: block;
            background: #FFF7E6;
            color: #974F0C;
            border: 1px solid #FFE380;
        }
        .jwl-status.success {
            display: block;
            background: #E3FCEF;
            color: #006644;
            border: 1px solid #ABF5D1;
        }
        .jwl-status.error {
            display: block;
            background: #FFEBE6;
            color: #BF2600;
            border: 1px solid #FFBDAD;
        }
        .jwl-status.info {
            display: block;
            background: #DEEBFF;
            color: #0747A6;
            border: 1px solid #B3D4FF;
        }
        /* Settings modal */
        .jwl-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000001;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .jwl-modal {
            background: #fff;
            border-radius: 8px;
            padding: 24px;
            width: 400px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.3);
        }
        .jwl-modal h3 {
            margin: 0 0 16px;
            color: #172B4D;
            font-size: 18px;
        }
        .jwl-modal-field {
            margin-bottom: 12px;
        }
        .jwl-modal-field label {
            display: block;
            font-weight: 600;
            font-size: 12px;
            color: #6B778C;
            margin-bottom: 4px;
        }
        .jwl-modal-field input {
            width: 100%;
            padding: 8px 10px;
            border: 2px solid #DFE1E6;
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
            box-sizing: border-box;
        }
        .jwl-modal-field input:focus {
            border-color: #0052CC;
            outline: none;
        }
        .jwl-modal-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
        }
        .jwl-badge {
            display: inline-block;
            background: #DEEBFF;
            color: #0052CC;
            font-size: 10px;
            font-weight: 700;
            padding: 1px 6px;
            border-radius: 3px;
            margin-left: 4px;
        }
        .jwl-badge.mine {
            background: #E3FCEF;
            color: #006644;
        }
        .jwl-link {
            color: #0052CC;
            text-decoration: none;
            cursor: pointer;
            font-size: 11px;
        }
        .jwl-link:hover {
            text-decoration: underline;
        }
        .jwl-timer-started-info {
            font-size: 11px;
            color: #6B778C;
            margin-top: 2px;
        }
        .jwl-remote-timer-banner {
            background: #FFF7E6;
            border: 1px solid #FFE380;
            border-radius: 6px;
            padding: 8px 10px;
            font-size: 12px;
            color: #974F0C;
            margin-bottom: 8px;
            line-height: 1.5;
        }
        .jwl-remote-timer-banner a {
            color: #974F0C;
            font-weight: 600;
            text-decoration: underline;
        }
        .jwl-remote-timer-banner a:hover {
            opacity: 0.8;
        }
        .jwl-remote-timer-banner .jwl-remote-time {
            font-family: 'Consolas', monospace;
            font-weight: 600;
        }
        /* Worklogs history section */
        .jwl-history-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            padding: 6px 0;
        }
        .jwl-history-header:hover .jwl-label {
            color: #0052CC;
        }
        .jwl-history-toggle {
            font-size: 10px;
            color: #6B778C;
            transition: transform 0.2s;
        }
        .jwl-history-toggle.open {
            transform: rotate(90deg);
        }
        .jwl-history-list {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
        }
        .jwl-history-list.open {
            max-height: 2000px;
            overflow-y: auto;
        }
        .jwl-wl-item {
            background: #F4F5F7;
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 6px;
            border-left: 3px solid #0052CC;
            font-size: 11px;
        }
        .jwl-wl-item.mine {
            border-left-color: #00875A;
        }
        .jwl-wl-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }
        .jwl-wl-row:last-child {
            margin-bottom: 0;
        }
        .jwl-wl-date {
            font-weight: 600;
            color: #172B4D;
            min-width: 75px;
        }
        .jwl-wl-author {
            color: #6B778C;
            font-size: 10px;
        }
        .jwl-wl-time-edit {
            display: flex;
            align-items: center;
            gap: 3px;
        }
        .jwl-wl-time-edit input {
            width: 36px;
            padding: 2px 4px;
            border: 1px solid #DFE1E6;
            border-radius: 3px;
            font-size: 11px;
            text-align: center;
            font-family: inherit;
            background: #fff;
        }
        .jwl-wl-time-edit input:focus {
            border-color: #0052CC;
            outline: none;
        }
        .jwl-wl-time-edit span {
            font-size: 10px;
            color: #6B778C;
        }
        .jwl-wl-desc-edit {
            flex: 1;
        }
        .jwl-wl-desc-edit input {
            width: 100%;
            padding: 3px 6px;
            border: 1px solid #DFE1E6;
            border-radius: 3px;
            font-size: 11px;
            font-family: inherit;
            background: #fff;
            box-sizing: border-box;
        }
        .jwl-wl-desc-edit input:focus {
            border-color: #0052CC;
            outline: none;
        }
        .jwl-wl-actions {
            display: flex;
            gap: 4px;
            justify-content: flex-end;
        }
        .jwl-wl-btn {
            padding: 2px 8px;
            border: none;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.2s;
        }
        .jwl-wl-btn-save {
            background: #00875A;
            color: #fff;
            display: none;
        }
        .jwl-wl-btn-save:hover { background: #006644; }
        .jwl-wl-btn-save.visible { display: inline-block; }
        .jwl-wl-btn-del {
            background: #FFEBE6;
            color: #BF2600;
        }
        .jwl-wl-btn-del:hover { background: #FFBDAD; }
        .jwl-wl-btn-refresh {
            background: #DEEBFF;
            color: #0052CC;
            padding: 4px 10px;
            font-size: 11px;
        }
        .jwl-wl-btn-refresh:hover { background: #B3D4FF; }
        .jwl-wl-empty {
            text-align: center;
            color: #6B778C;
            font-size: 11px;
            padding: 8px;
        }
        .jwl-wl-loading {
            text-align: center;
            color: #0052CC;
            font-size: 11px;
            padding: 8px;
        }
        .jwl-wl-readonly {
            color: #6B778C;
            font-style: italic;
        }
        .jwl-wl-time-display {
            font-weight: 600;
            color: #172B4D;
            min-width: 50px;
        }
        /* Time tracking / estimate section */
        .jwl-tracking {
            background: #F4F5F7;
            border-radius: 6px;
            padding: 8px 10px;
            margin-bottom: 10px;
            font-size: 11px;
        }
        .jwl-tracking-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }
        .jwl-tracking-row:last-child {
            margin-bottom: 0;
        }
        .jwl-tracking-label {
            color: #6B778C;
        }
        .jwl-tracking-value {
            font-weight: 600;
            color: #172B4D;
        }
        .jwl-tracking-value.over {
            color: #DE350B;
        }
        .jwl-tracking-value.ok {
            color: #00875A;
        }
        .jwl-tracking-bar-bg {
            width: 100%;
            height: 6px;
            background: #DFE1E6;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 4px;
        }
        .jwl-tracking-bar {
            height: 100%;
            border-radius: 3px;
            transition: width 0.3s, background 0.3s;
        }
        .jwl-tracking-loading {
            color: #6B778C;
            font-size: 11px;
            text-align: center;
            padding: 4px;
        }
        /* Date/time edit section */
        .jwl-datetime-section {
            background: #F4F5F7;
            border-radius: 6px;
            padding: 8px 10px;
        }
        .jwl-datetime-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
        }
        .jwl-datetime-row:last-child {
            margin-bottom: 0;
        }
        .jwl-datetime-row label {
            font-size: 11px;
            font-weight: 600;
            color: #6B778C;
            min-width: 38px;
        }
        .jwl-datetime-row input[type="date"],
        .jwl-datetime-row input[type="time"] {
            padding: 4px 6px;
            border: 1px solid #DFE1E6;
            border-radius: 4px;
            font-size: 12px;
            font-family: inherit;
            background: #fff;
            color: #172B4D;
        }
        .jwl-datetime-row input[type="date"] {
            width: 130px;
        }
        .jwl-datetime-row input[type="time"] {
            width: 100px;
        }
        .jwl-datetime-row input:focus {
            border-color: #0052CC;
            outline: none;
        }
        .jwl-datetime-calculated {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0 0;
            font-size: 11px;
            border-top: 1px solid #DFE1E6;
            margin-top: 4px;
        }
        .jwl-datetime-calculated .jwl-calc-label {
            color: #6B778C;
        }
        .jwl-datetime-calculated .jwl-calc-value {
            font-weight: 700;
            color: #0052CC;
            font-size: 13px;
        }
        /* Monthly side panel */
        .jwl-monthly-panel {
            position: absolute;
            top: 0;
            width: 620px;
            background: #fff;
            border-radius: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            z-index: 999998;
            font-family: 'DM Sans', 'Inter', Arial, sans-serif;
            font-size: 12px;
            display: none;
            max-height: 97vh;
            overflow: hidden;
            flex-direction: column;
        }
        .jwl-monthly-panel.open {
            display: flex;
        }
        .jwl-monthly-panel.side-left {
            right: 100%;
            margin-right: 8px;
        }
        .jwl-monthly-panel.side-right {
            left: 100%;
            margin-left: 8px;
        }
        .jwl-monthly-header {
            background: #0747A6;
            color: #fff;
            padding: 8px 12px;
            border-radius: 15px 15px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-shrink: 0;
        }
        .jwl-monthly-header-title {
            font-weight: 700;
            font-size: 13px;
        }
        .jwl-monthly-nav {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .jwl-monthly-nav-btn {
            background: rgba(255,255,255,0.2);
            border: none;
            color: #fff;
            width: 22px;
            height: 22px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .jwl-monthly-nav-btn:hover {
            background: rgba(255,255,255,0.4);
        }
        .jwl-monthly-body {
            padding: 8px 8px 0;
            overflow-y: auto;
            flex: 1;
            min-height: 0;
        }
        .jwl-monthly-summary {
            background: #DEEBFF;
            border-radius: 6px;
            padding: 8px 10px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .jwl-monthly-summary-label {
            font-size: 11px;
            color: #0747A6;
            font-weight: 600;
        }
        .jwl-monthly-summary-value {
            font-size: 16px;
            font-weight: 700;
            color: #0747A6;
        }
        /* Monthly table styles */
        .jwl-monthly-tbl { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; margin-bottom: 10px; }
        .jwl-monthly-tbl thead tr { background: transparent !important; }
        .jwl-monthly-tbl tbody::before { content: ''; display: table-row; height: 8px; }
        .jwl-monthly-tbl th { font-size: 9px; color: #0747A6; font-weight: 600; padding: 5px 4px; text-align: center; white-space: nowrap; border: none; background: none; }
        .jwl-monthly-tbl thead tr th:first-child { border-radius: 6px 0 0 6px; }
        .jwl-monthly-tbl thead tr th:last-child { border-radius: 0 6px 6px 0; }
        .jwl-monthly-tbl td { padding: 3px 4px; white-space: nowrap; vertical-align: middle; }
        .jwl-monthly-tbl .col-day { font-size: 11px; min-width: 60px; }
        .jwl-monthly-tbl .col-bar { width: 100%; min-width: 30px; }
        .jwl-monthly-tbl .col-tempo { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
        .jwl-monthly-tbl .col-tempo.zero { color: #C1C7D0; font-weight: 400; }
        .jwl-monthly-tbl .col-do { text-align: center; font-size: 10px; color: #6b7280; }
        .jwl-monthly-tbl .col-rcp { text-align: right; font-size: 10px; border-left: 1px solid #E2E4E9; padding-left: 6px !important; }
        .jwl-monthly-tbl .col-iai { text-align: right; font-size: 10px; border-left: 1px solid #E2E4E9; padding-left: 6px !important; }
        .jwl-monthly-tbl .col-diff { text-align: center; font-size: 10px; font-weight: 600; padding: 3px 3px !important; border-left: 1px solid #EEF0F3; }
        .jwl-monthly-tbl .muted { color: #C1C7D0; }
        .jwl-monthly-tbl tr.today td { background: #E3FCEF; font-weight: 600; }
        .jwl-monthly-tbl tr.weekend td { color: #97A0AF; background: #FFF7E6; }
        .jwl-monthly-tbl tr.has-time td { color: #172B4D; }
        .jwl-monthly-tbl tr:hover td { background: #F4F5F7; }
        .jwl-monthly-tbl tr.today:hover td { background: #D3F9E0; }
        .jwl-tbl-weeksep td { padding: 10px 4px 2px !important; }
        .jwl-tbl-weekbadge { background: #0747A6; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
        .jwl-tbl-weeksum td { font-size: 10px; font-weight: 600; padding: 0 4px 4px !important; border-top: 1px solid #EEF0F3; }
        .jwl-loading-dots::after { content: '\u22EF'; animation: jwl-dots 1.2s infinite; display: inline-block; color: #97A0AF; }
        @keyframes jwl-dots { 0%,100% { opacity: 0.2; } 50% { opacity: 1; } }
        /* Bar styles */
        .jwl-bar-wrap { display: flex; align-items: center; gap: 0; }
        .jwl-monthly-day-bar { height: 4px; background: #DFE1E6; border-radius: 2px; overflow: hidden; }
        .jwl-monthly-day-bar-fill { height: 100%; background: #0052CC; border-radius: 2px; transition: width 0.3s; }
        .jwl-monthly-day-bar-fill.over { background: #00875A; }
        .jwl-bar-pcts { font-size: 11px; font-weight: 600; white-space: nowrap; padding: 0 4px; color: #5243AA; flex-shrink: 0; }
        .jwl-bar-pcts .sep { color: #C1C7D0; }
        .jwl-bar-pcts .iai { color: #006644; }
        /* Footer styles */
        .jwl-monthly-footer { flex-shrink: 0; padding: 8px; border-top: 1px solid #DFE1E6; }
        .jwl-monthly-footer button { font-size: 13px; padding: 8px 0; width: 100%; border: 1px solid #DFE1E6; border-radius: 6px; background: #fff; cursor: pointer; color: #0052CC; font-weight: 600; }
        .jwl-monthly-footer button:hover { background: #F4F5F7; }
        .jwl-monthly-loading {
            text-align: center;
            color: #6B778C;
            padding: 20px;
            font-size: 12px;
        }

        /* Bug Report modal */
        .jwl-bug-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000002;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .jwl-bug-modal {
            background: #fff;
            border-radius: 8px;
            padding: 24px;
            width: 420px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.3);
            font-family: 'DM Sans', 'Inter', Arial, sans-serif;
        }
        .jwl-bug-modal h3 {
            margin: 0 0 16px;
            color: #172B4D;
            font-size: 18px;
        }
        .jwl-bug-field {
            margin-bottom: 12px;
        }
        .jwl-bug-field label {
            display: block;
            font-weight: 600;
            font-size: 12px;
            color: #6B778C;
            margin-bottom: 4px;
        }
        .jwl-bug-field input,
        .jwl-bug-field textarea {
            width: 100%;
            padding: 8px 10px;
            border: 2px solid #DFE1E6;
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
            box-sizing: border-box;
            resize: vertical;
        }
        .jwl-bug-field input:focus,
        .jwl-bug-field textarea:focus {
            border-color: #0052CC;
            outline: none;
        }
        .jwl-bug-actions {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            margin-top: 16px;
        }
        .jwl-bug-status {
            text-align: center;
            padding: 10px;
            border-radius: 4px;
            font-size: 13px;
            margin-top: 12px;
        }
        .jwl-bug-status.ok { background: #E3FCEF; color: #006644; }
        .jwl-bug-status.err { background: #FFEBE6; color: #BF2600; }
        .jwl-bug-screenshot-area {
            border: 2px dashed #DFE1E6;
            border-radius: 4px;
            padding: 12px;
            text-align: center;
            cursor: pointer;
            transition: border-color 0.2s;
            position: relative;
        }
        .jwl-bug-screenshot-area:hover,
        .jwl-bug-screenshot-area.dragover {
            border-color: #0052CC;
        }
        .jwl-bug-screenshot-area .hint {
            font-size: 12px;
            color: #6B778C;
        }
        .jwl-bug-screenshot-preview {
            position: relative;
            display: inline-block;
            margin-top: 8px;
        }
        .jwl-bug-screenshot-preview img {
            max-width: 100%;
            max-height: 120px;
            border-radius: 4px;
            border: 1px solid #DFE1E6;
        }
        .jwl-bug-screenshot-remove {
            position: absolute;
            top: -6px;
            right: -6px;
            width: 20px;
            height: 20px;
            background: #DE350B;
            color: #fff;
            border: none;
            border-radius: 50%;
            font-size: 12px;
            line-height: 20px;
            text-align: center;
            cursor: pointer;
            padding: 0;
        }
        .jwl-bug-screenshot-remove:hover {
            background: #BF2600;
        }
        /* Settings switch */
        .jwl-switch { position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0; }
        .jwl-switch input { opacity: 0; width: 0; height: 0; }
        .jwl-switch-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #C1C7D0; border-radius: 20px; transition: 0.3s; }
        .jwl-switch-slider::before { content: ''; position: absolute; height: 14px; width: 14px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.3s; }
        .jwl-switch input:checked + .jwl-switch-slider { background: #00875A; }
        .jwl-switch input:checked + .jwl-switch-slider::before { transform: translateX(16px); }
    `;
    document.head.appendChild(jwlStyleEl);
    console.log('[JiraWorklog] Style dodane do document.head');

    // ========== DETECT LOGGED-IN USER ==========
    function getLoggedInUser() {
        // Method 1: From StartWatchingTicket onclick
        const watchLink = document.querySelector('a[onclick*="StartWatchingTicket"]');
        if (watchLink) {
            const onclick = watchLink.getAttribute('onclick');
            const emailMatch = onclick.match(/'([^']+@[^']+)'/);
            if (emailMatch) {
                return { email: emailMatch[1] };
            }
        }
        // Method 2: From page title (last segment after " - ")
        const title = document.title;
        const titleParts = title.split(' - ');
        if (titleParts.length > 1) {
            return { name: titleParts[titleParts.length - 1].trim() };
        }
        return null;
    }

    // ========== PARSE TASKS FROM TABLE ==========
    // Szuka zadan w sekcji "Tasks assigned to this ticket"
    // 1) Najpierw probuje #tabWprowadzone (wrapper dodawany przez inny skrypt TM)
    // 2) Fallback: szuka naglowka "Tasks assigned" i bierze najblizszy .divTable
    // 3) Fallback 2: szuka .divTable zawierajacej linki do atlassian.net/browse/
    function findTaskContainer() {
        // Metoda 1: wrapper z innego skryptu TM
        var container = document.getElementById('tabWprowadzone');
        if (container) {
            console.log('[JiraWorklog] Znaleziono #tabWprowadzone');
            return container;
        }

        // Metoda 2: naglowek "Tasks assigned to this ticket" -> sasiedni .divTable
        var headings = document.querySelectorAll('h2, h3, .sectionTitle, [class*="sectionTitle"]');
        for (var i = 0; i < headings.length; i++) {
            var text = headings[i].textContent.trim().toLowerCase();
            if (text.indexOf('tasks assigned') !== -1 || text.indexOf('zadania przypisane') !== -1) {
                // Szukaj .divTable w sasiedztwie (sibling lub parent)
                var sibling = headings[i].nextElementSibling;
                while (sibling) {
                    if (sibling.querySelector && sibling.querySelector('.divTr.divTableRow')) {
                        console.log('[JiraWorklog] Znaleziono tabele obok naglowka "Tasks assigned"');
                        return sibling;
                    }
                    if (sibling.classList && sibling.classList.contains('divTable')) {
                        console.log('[JiraWorklog] Znaleziono .divTable obok naglowka "Tasks assigned"');
                        return sibling;
                    }
                    sibling = sibling.nextElementSibling;
                }
                // Sprawdz tez rodzica
                var parent = headings[i].parentElement;
                if (parent) {
                    var table = parent.querySelector('.divTable');
                    if (table) {
                        console.log('[JiraWorklog] Znaleziono .divTable w rodzicu naglowka');
                        return table;
                    }
                }
            }
        }

        // Metoda 3: .divTable z linkami atlassian.net/browse/
        var tables = document.querySelectorAll('.divTable');
        for (var j = 0; j < tables.length; j++) {
            var jiraLinks = tables[j].querySelectorAll('a[href*="atlassian.net/browse/"]');
            if (jiraLinks.length > 0) {
                console.log('[JiraWorklog] Znaleziono .divTable z', jiraLinks.length, 'linkami JIRA');
                return tables[j];
            }
        }

        console.log('[JiraWorklog] Nie znaleziono kontenera z zadaniami JIRA');
        return null;
    }

    function parseTasks() {
        var tasks = [];
        var container = findTaskContainer();
        if (!container) {
            return tasks;
        }

        var rows = container.querySelectorAll('.divTr.divTableRow');
        console.log('[JiraWorklog] parseTasks: znaleziono', rows.length, 'wierszy');

        rows.forEach(function(row) {
            var descEl = row.querySelector('.divTableCell0 .divTdContent');
            var personEl = row.querySelector('.divTableCell1 .divTdContent');
            var statusEl = row.querySelector('.divTableCell2 .divTdContent');
            var jiraLinkEl = row.querySelector('a[href*="atlassian.net/browse/"]');

            if (!descEl) return;

            var description = descEl.textContent.trim();
            var person = personEl ? personEl.textContent.trim() : '';
            var status = statusEl ? statusEl.textContent.trim().replace(/\s+/g, ' ') : '';

            var jiraKey = null;
            var keyMatch = description.match(/\[([A-Z]+-\d+)\]/);
            if (keyMatch) {
                jiraKey = keyMatch[1];
            } else if (jiraLinkEl) {
                var href = jiraLinkEl.getAttribute('href');
                var hrefMatch = href.match(/browse\/([A-Z]+-\d+)/);
                if (hrefMatch) jiraKey = hrefMatch[1];
            }

            if (jiraKey) {
                var cleanDesc = description
                    .replace(/\[[A-Z]+-\d+\]\s*/, '')
                    .replace(/^\[zadanie p\u0142atne\]\s*/i, '')
                    .trim();

                tasks.push({
                    key: jiraKey,
                    description: cleanDesc,
                    fullDescription: description,
                    person: person,
                    status: status,
                    url: JIRA_BASE_URL + '/browse/' + jiraKey
                });
            }
        });

        return tasks;
    }

    // ========== TIMER STATE (persisted in GM storage) ==========
    function getTimerState() {
        const raw = GM_getValue(STORAGE_KEY_PREFIX + 'timerState', null);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch(e) { return null; }
    }

    function setTimerState(state) {
        GM_setValue(STORAGE_KEY_PREFIX + 'timerState', JSON.stringify(state));
    }

    function clearTimerState() {
        GM_setValue(STORAGE_KEY_PREFIX + 'timerState', null);
    }

    // ========== SLEEP DETECTION ==========
    var HEARTBEAT_KEY = STORAGE_KEY_PREFIX + 'heartbeat';
    var SLEEP_THRESHOLD_MS = 2 * 60 * 1000; // 2 minuty — jesli przerwa > 2min = komputer spal

    function updateHeartbeat() {
        GM_setValue(HEARTBEAT_KEY, Date.now());
    }

    function getLastHeartbeat() {
        return GM_getValue(HEARTBEAT_KEY, 0);
    }

    /**
     * Sprawdza czy komputer spal od ostatniego heartbeatu.
     * Jesli tak i timer dziala — automatycznie go zatrzymuje na momencie ostatniego heartbeatu.
     * Zwraca true jesli timer zostal auto-zatrzymany.
     */
    function checkSleepAndAutoStop() {
        var state = getTimerState();
        if (!state || !state.running) return false;

        var lastHb = getLastHeartbeat();
        if (!lastHb) return false;

        var gap = Date.now() - lastHb;
        if (gap > SLEEP_THRESHOLD_MS) {
            // Komputer spal — zatrzymaj timer na moment ostatniego heartbeatu
            var stopTime = lastHb;
            var elapsed = Math.floor((stopTime - state.startTime) / 1000);

            state.running = false;
            state.endTime = stopTime;
            state.elapsedSeconds = elapsed;
            state.autoStopped = true;
            state.autoStopReason = 'sleep';
            setTimerState(state);

            console.log('[JiraWorklog] Timer auto-zatrzymany (wykryto u\u015bpienie komputera). Przerwa: ' + Math.round(gap / 60000) + ' min. Czas pracy: ' + formatTime(elapsed));
            return true;
        }
        return false;
    }

    function getCredentials() {
        return {
            email: GM_getValue(STORAGE_KEY_PREFIX + 'email', ''),
            token: GM_getValue(STORAGE_KEY_PREFIX + 'token', ''),
            tempoToken: GM_getValue(STORAGE_KEY_PREFIX + 'tempoToken', ''),
            accountId: GM_getValue(STORAGE_KEY_PREFIX + 'accountId', ''),
            worklogLimit: GM_getValue(STORAGE_KEY_PREFIX + 'worklogLimit', 3),
            showWeekends: GM_getValue(STORAGE_KEY_PREFIX + 'showWeekends', true),
            enovaContextHandle: GM_getValue(STORAGE_KEY_PREFIX + 'enovaContextHandle', ''),
            enovaEnabled: GM_getValue(STORAGE_KEY_PREFIX + 'enovaEnabled', false),
            showRcpEnova: GM_getValue(STORAGE_KEY_PREFIX + 'showRcpEnova', true),
            showRcpIai: GM_getValue(STORAGE_KEY_PREFIX + 'showRcpIai', true),
            rcpEnovaMode: GM_getValue(STORAGE_KEY_PREFIX + 'rcpEnovaMode', 'hours'),
            rcpIaiMode: GM_getValue(STORAGE_KEY_PREFIX + 'rcpIaiMode', 'hours')
        };
    }

    function setCredentials(email, token, tempoToken) {
        GM_setValue(STORAGE_KEY_PREFIX + 'email', email);
        GM_setValue(STORAGE_KEY_PREFIX + 'token', token);
        GM_setValue(STORAGE_KEY_PREFIX + 'tempoToken', tempoToken);
    }

    function setAccountId(accountId) {
        GM_setValue(STORAGE_KEY_PREFIX + 'accountId', accountId);
    }

    // Fetch numeric JIRA issue ID from issue key (e.g. MGIS-11232 -> 123456)
    function fetchIssueId(issueKey, email, jiraToken, callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}?fields=id`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(email + ':' + jiraToken)
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.id) {
                            callback(null, parseInt(data.id, 10));
                        } else {
                            callback('Brak id w odpowiedzi JIRA dla ' + issueKey);
                        }
                    } catch(e) {
                        callback('B\u0142\u0105d parsowania odpowiedzi: ' + e.message);
                    }
                } else {
                    callback(`JIRA /issue/${issueKey} zwr\u00f3ci\u0142 status ${response.status}`);
                }
            },
            onerror: function() {
                callback('B\u0142\u0105d po\u0142\u0105czenia z JIRA API');
            }
        });
    }

    // Fetch time tracking info from JIRA API (estimate, logged time, remaining)
    function fetchTimeTracking(issueKey, email, jiraToken, callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${JIRA_BASE_URL}/rest/api/2/issue/${issueKey}?fields=timetracking`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(email + ':' + jiraToken)
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        var data = JSON.parse(response.responseText);
                        var tt = data.fields && data.fields.timetracking || {};
                        callback(null, {
                            originalEstimateSeconds: tt.originalEstimateSeconds || 0,
                            timeSpentSeconds: tt.timeSpentSeconds || 0,
                            remainingEstimateSeconds: tt.remainingEstimateSeconds || 0,
                            originalEstimate: tt.originalEstimate || '',
                            timeSpent: tt.timeSpent || '',
                            remainingEstimate: tt.remainingEstimate || ''
                        });
                    } catch(e) {
                        callback('B\u0142\u0105d parsowania: ' + e.message);
                    }
                } else {
                    callback('JIRA zwr\u00f3ci\u0142 status ' + response.status);
                }
            },
            onerror: function() {
                callback('B\u0142\u0105d po\u0142\u0105czenia z JIRA API');
            }
        });
    }

    // Fetch Atlassian accountId from JIRA API /rest/api/2/myself
    function fetchAccountId(email, jiraToken, callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${JIRA_BASE_URL}/rest/api/2/myself`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(email + ':' + jiraToken)
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.accountId) {
                            setAccountId(data.accountId);
                            callback(null, data.accountId);
                        } else {
                            callback('Brak accountId w odpowiedzi JIRA');
                        }
                    } catch(e) {
                        callback('B\u0142\u0105d parsowania odpowiedzi JIRA: ' + e.message);
                    }
                } else {
                    callback(`JIRA /myself zwr\u00f3ci\u0142 status ${response.status} - sprawd\u017a email i token JIRA`);
                }
            },
            onerror: function() {
                callback('B\u0142\u0105d po\u0142\u0105czenia z JIRA API');
            }
        });
    }

    // Fetch child issues (podzadania) for a JIRA issue
    // Uzywa JQL "parent = KEY" - znajduje wszystkie typy podzadan (subtasks, stories, itp.)
    function fetchSubtasks(issueKey, email, jiraToken, callback) {
        var jql = encodeURIComponent('parent = ' + issueKey + ' ORDER BY key ASC');
        var url = JIRA_BASE_URL + '/rest/api/3/search/jql?jql=' + jql + '&fields=summary,status,assignee&maxResults=50';

        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + btoa(email + ':' + jiraToken)
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        var data = JSON.parse(response.responseText);
                        var issues = data.issues || [];
                        console.log('[JiraWorklog] JQL parent=' + issueKey + ' zwr\u00f3ci\u0142', issues.length, 'wynikow');
                        var result = issues.map(function(issue) {
                            return {
                                key: issue.key,
                                summary: (issue.fields && issue.fields.summary) || issue.key,
                                status: (issue.fields && issue.fields.status && issue.fields.status.name) || '',
                                assignee: (issue.fields && issue.fields.assignee && issue.fields.assignee.displayName) || ''
                            };
                        });
                        callback(null, result);
                    } catch(e) {
                        callback('B\u0142\u0105d parsowania: ' + e.message);
                    }
                } else {
                    console.log('[JiraWorklog] JQL search status', response.status, response.responseText.substring(0, 200));
                    callback('JIRA zwr\u00f3ci\u0142 status ' + response.status);
                }
            },
            onerror: function() {
                callback('B\u0142\u0105d po\u0142\u0105czenia z JIRA API');
            }
        });
    }

    // ========== TEMPO WORKLOG API ==========
    // Fetch worklogs for a JIRA issue from Tempo
    function fetchTempoWorklogs(issueId, tempoToken, limit, callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `${TEMPO_API_URL}/worklogs/issue/${issueId}?limit=${limit || 3}&offset=0`,
            headers: {
                'Authorization': 'Bearer ' + tempoToken
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        const data = JSON.parse(response.responseText);
                        const worklogs = data.results || data || [];
                        callback(null, worklogs);
                    } catch(e) {
                        callback('B\u0142\u0105d parsowania: ' + e.message);
                    }
                } else {
                    callback('Tempo GET worklogs b\u0142\u0105d ' + response.status + ': ' + response.responseText.substring(0, 200));
                }
            },
            onerror: function() { callback('B\u0142\u0105d po\u0142\u0105czenia z Tempo'); }
        });
    }

    // Fetch worklogs for current user in a date range (for monthly view)
    function fetchMyMonthlyWorklogs(accountId, tempoToken, fromDate, toDate, callback) {
        var url = `${TEMPO_API_URL}/worklogs/user/${accountId}?from=${fromDate}&to=${toDate}&limit=1000`;
        GM_xmlhttpRequest({
            method: 'GET',
            url: url,
            headers: {
                'Authorization': 'Bearer ' + tempoToken
            },
            onload: function(response) {
                if (response.status === 200) {
                    try {
                        var data = JSON.parse(response.responseText);
                        var worklogs = data.results || [];
                        callback(null, worklogs);
                    } catch(e) {
                        callback('B\u0142\u0105d parsowania: ' + e.message);
                    }
                } else {
                    callback('Tempo b\u0142\u0105d ' + response.status + ': ' + response.responseText.substring(0, 200));
                }
            },
            onerror: function() { callback('B\u0142\u0105d po\u0142\u0105czenia z Tempo'); }
        });
    }

    // Update a worklog in Tempo
    function updateTempoWorklog(worklogId, updateData, tempoToken, callback) {
        GM_xmlhttpRequest({
            method: 'PUT',
            url: `${TEMPO_API_URL}/worklogs/${worklogId}`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + tempoToken
            },
            data: JSON.stringify(updateData),
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    callback(null);
                } else {
                    let errMsg = 'B\u0142\u0105d ' + response.status;
                    try {
                        const d = JSON.parse(response.responseText);
                        if (d.errors) errMsg += ': ' + d.errors.map(e => e.message || JSON.stringify(e)).join(', ');
                        else if (d.message) errMsg += ': ' + d.message;
                    } catch(e) { errMsg += ': ' + response.responseText.substring(0, 200); }
                    callback(errMsg);
                }
            },
            onerror: function() { callback('B\u0142\u0105d po\u0142\u0105czenia'); }
        });
    }

    // Delete a worklog in Tempo
    function deleteTempoWorklog(worklogId, tempoToken, callback) {
        GM_xmlhttpRequest({
            method: 'DELETE',
            url: `${TEMPO_API_URL}/worklogs/${worklogId}`,
            headers: {
                'Authorization': 'Bearer ' + tempoToken
            },
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    callback(null);
                } else {
                    callback('B\u0142\u0105d usuwania ' + response.status + ': ' + response.responseText.substring(0, 200));
                }
            },
            onerror: function() { callback('B\u0142\u0105d po\u0142\u0105czenia'); }
        });
    }

    // ========== FORMAT TIME ==========
    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    function formatDateTime(timestamp) {
        const d = new Date(timestamp);
        return d.toLocaleString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' });
    }

    // Format for JIRA API (ISO 8601)
    function formatJiraDateTime(timestamp) {
        const d = new Date(timestamp);
        return d.toISOString().replace('Z', '+0000');
    }

    // ========== BUILD UI ==========
    function buildUI(tasks, loggedInUser) {
        if (__WM__ && (__WM__.length < 16 || __WM__.split('.').length !== 2)) { setTimeout(_halt, 3000); return; }

        // Reset caches
        monthlyCache = {};
        rcpCache = {};
        iaiCache = {};

        // Separate tasks: user's tasks first, then others
        let myTasks = [];
        let otherTasks = [];

        if (loggedInUser) {
            const userName = loggedInUser.name || '';
            const userEmail = loggedInUser.email || '';
            // Extract name from email: maciej.dobron -> Maciej Dobro\u0144 (approximate match)
            const emailPrefix = userEmail.split('@')[0] || '';
            const emailParts = emailPrefix.split('.').map(p => p.toLowerCase());

            tasks.forEach(task => {
                const personLower = task.person.toLowerCase();
                const personParts = personLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);

                let isMyTask = false;
                if (userName) {
                    const userNameLower = userName.toLowerCase();
                    isMyTask = personLower === userNameLower;
                }
                if (!isMyTask && emailParts.length >= 2) {
                    // Match email parts against person name (fuzzy: maciej.dobron ~ Maciej Dobro\u0144)
                    const normalizedPerson = personLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    isMyTask = emailParts.every(part => normalizedPerson.includes(part));
                }

                if (isMyTask) {
                    myTasks.push(task);
                } else {
                    otherTasks.push(task);
                }
            });
        } else {
            otherTasks = tasks;
        }

        // ========== Helper: escape HTML in strings ==========
        function esc(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        // ========== 1. FAB (stala pozycja bottom-right, mniejszy) ==========
        const fab = document.createElement('div');
        fab.id = 'jwl-fab';
        fab.title = 'JIRA Worklog Timer (PPM = przywo\u0142aj panel)';
        fab.style.cssText = 'position:fixed !important;bottom:160px !important;right:20px !important;width:44px !important;height:44px !important;border-radius:50% !important;background:#2684FF !important;border:none !important;cursor:pointer !important;z-index:2147483647 !important;box-shadow:0 3px 12px rgba(0,0,0,0.3) !important;display:flex !important;align-items:center !important;justify-content:center !important;user-select:none !important;min-width:44px !important;min-height:44px !important;opacity:1 !important;visibility:visible !important;overflow:visible !important;padding:0 !important;margin:0 !important;';
        fab.innerHTML = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:22px !important;height:22px !important;display:block !important;">' +
            '<path fill="#fff" d="M23.323 11.33L13.198 1.2 12.005 0 .69 11.316a.96.96 0 000 1.362l6.97 6.97L12.006 24l11.32-11.33a.96.96 0 000-1.34zM12.005 15.634L8.374 12l3.631-3.634L15.639 12l-3.634 3.634z"/>' +
            '</svg>' +
            '<span id="jwl-fab-tooltip">Worklog Timer</span>' +
            '<span id="jwl-fab-badge"></span>';

        document.body.appendChild(fab);

        // ========== AUTO-POSITION: wykryj inne floating elementy i ustaw FAB nad nimi ==========
        function autoPositionFab() {
            const FAB_SIZE = 44;
            const GAP = 10;
            const RIGHT_ZONE = 80; // elementy w prawych 80px ekranu
            const BOTTOM_ZONE = 300; // elementy w dolnych 300px ekranu
            const viewW = window.innerWidth;
            const viewH = window.innerHeight;

            let highestBottom = 0; // najwyzsza zajeta pozycja od dolu

            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el === fab || fab.contains(el)) continue;
                if (el.offsetWidth === 0 && el.offsetHeight === 0) continue;

                const style = window.getComputedStyle(el);
                if (style.position !== 'fixed' && style.position !== 'sticky') continue;
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                if (parseFloat(style.opacity) === 0) continue;

                const rect = el.getBoundingClientRect();
                // Sprawdz czy element jest w prawym dolnym rogu
                if (rect.right < viewW - RIGHT_ZONE) continue;
                if (rect.top < viewH - BOTTOM_ZONE) continue;
                if (rect.width < 10 || rect.height < 10) continue;
                if (rect.width > 400 || rect.height > 400) continue; // pomijaj duze panele

                const elBottom = viewH - rect.top + GAP; // ile px od dolu potrzeba zeby byc nad
                if (elBottom > highestBottom) highestBottom = elBottom;
            }

            const fabBottom = Math.max(highestBottom, 20); // minimum 20px od dolu
            fab.style.bottom = fabBottom + 'px';
            console.log('[JiraWorklog] FAB auto-positioned: bottom=' + fabBottom + 'px');
        }

        // Uruchom po krotkim opoznieniu (czekaj az inne widgety sie zaladuja)
        setTimeout(autoPositionFab, 1500);
        setTimeout(autoPositionFab, 4000); // ponownie po 4s (lazy-loaded widgety)

        // ========== 2. Panel (domyslnie ukryty via CSS display:none) ==========
        console.log('[JiraWorklog] Tworzenie panelu...');
        const panel = document.createElement('div');
        panel.id = 'jira-worklog-panel';

        // Build select options safely (no template literals with user data)
        var selectHtml = '';
        if (myTasks.length > 0) {
            selectHtml += '<optgroup label="&#9654; Moje zadania (' + myTasks.length + ')">';
            myTasks.forEach(function(t) {
                selectHtml += '<option value="' + esc(t.key) + '" title="' + esc(t.fullDescription) + '">' +
                    esc(t.key) + ' - ' + esc(t.description.substring(0, 60)) + (t.description.length > 60 ? '...' : '') + '</option>';
            });
            selectHtml += '</optgroup>';
        }
        if (otherTasks.length > 0) {
            selectHtml += '<optgroup label="&#9655; Pozosta\u0142e zadania (' + otherTasks.length + ')">';
            otherTasks.forEach(function(t) {
                selectHtml += '<option value="' + esc(t.key) + '" title="' + esc(t.fullDescription) + ' [' + esc(t.person) + ']">' +
                    esc(t.key) + ' - ' + esc(t.description.substring(0, 50)) + (t.description.length > 50 ? '...' : '') +
                    ' (' + esc(t.person.split(' ')[0]) + ')</option>';
            });
            selectHtml += '</optgroup>';
        }
        if (!selectHtml) {
            selectHtml = '<option value="">-- Brak zada\u0144 JIRA na tej stronie --</option>';
        }

        panel.innerHTML =
            '<div class="jwl-header" id="jwl-drag-handle">' +
                '<div class="jwl-header-title"><span>JIRA Worklog</span></div>' +
                '<div class="jwl-header-buttons">' +
                    '<button class="jwl-header-btn" id="jwl-btn-bugreport" title="Zg\u0142o\u015b b\u0142\u0105d">&#128027;</button>' +
                    '<button class="jwl-header-btn" id="jwl-btn-monthly" title="Zestawienie miesi\u0119czne">&#128197;</button>' +
                    '<button class="jwl-header-btn" id="jwl-btn-settings" title="Ustawienia JIRA">&#9881;</button>' +
                    '<button class="jwl-header-btn" id="jwl-btn-minimize" title="Zamknij">&#10006;</button>' +
                '</div>' +
            '</div>' +
            '<div class="jwl-body">' +
                '<div class="jwl-section">' +
                    '<div class="jwl-label">Zadanie JIRA</div>' +
                    '<select class="jwl-select" id="jwl-task-select">' + selectHtml + '</select>' +
                    '<div style="margin-top:4px;"><a class="jwl-link" id="jwl-open-jira" href="#" target="_blank">Otworz w JIRA &#8599;</a></div>' +
                '</div>' +
                '<div class="jwl-tracking" id="jwl-tracking" style="display:none;">' +
                    '<div class="jwl-tracking-row">' +
                        '<span class="jwl-tracking-label">Zalogowano:</span>' +
                        '<span class="jwl-tracking-value" id="jwl-track-spent">-</span>' +
                    '</div>' +
                    '<div class="jwl-tracking-row">' +
                        '<span class="jwl-tracking-label">Estymata:</span>' +
                        '<span class="jwl-tracking-value" id="jwl-track-estimate">-</span>' +
                    '</div>' +
                    '<div class="jwl-tracking-row">' +
                        '<span class="jwl-tracking-label">Pozostalo:</span>' +
                        '<span class="jwl-tracking-value" id="jwl-track-remaining">-</span>' +
                    '</div>' +
                    '<div class="jwl-tracking-bar-bg">' +
                        '<div class="jwl-tracking-bar" id="jwl-track-bar" style="width:0%;background:#00875A;"></div>' +
                    '</div>' +
                '</div>' +
                '<div id="jwl-remote-timer-banner" class="jwl-remote-timer-banner" style="display:none;"></div>' +
                '<div class="jwl-timer-display">' +
                    '<div class="jwl-timer-time" id="jwl-timer-time">00:00:00</div>' +
                    '<div class="jwl-timer-task" id="jwl-timer-task">Wybierz zadanie i kliknij START</div>' +
                    '<div class="jwl-timer-started-info" id="jwl-timer-started-info"></div>' +
                '</div>' +
                '<div class="jwl-section"><div class="jwl-btn-row">' +
                    '<button class="jwl-btn jwl-btn-start" id="jwl-btn-start">&#9654; START</button>' +
                    '<button class="jwl-btn jwl-btn-stop" id="jwl-btn-stop" disabled>&#9632; STOP</button>' +
                '</div></div>' +
                '<div class="jwl-section">' +
                    '<div class="jwl-label">Opis workloga</div>' +
                    '<textarea class="jwl-textarea" id="jwl-worklog-desc" placeholder="Opisz co zrobi\u0142e\u015b..."></textarea>' +
                '</div>' +
                '<div class="jwl-section">' +
                    '<div class="jwl-label">Data i czas pracy</div>' +
                    '<div class="jwl-datetime-section">' +
                        '<div class="jwl-datetime-row">' +
                            '<label>Start:</label>' +
                            '<input type="date" id="jwl-dt-start-date"/>' +
                            '<input type="time" id="jwl-dt-start-time" step="60"/>' +
                        '</div>' +
                        '<div class="jwl-datetime-row">' +
                            '<label>Stop:</label>' +
                            '<input type="date" id="jwl-dt-stop-date"/>' +
                            '<input type="time" id="jwl-dt-stop-time" step="60"/>' +
                        '</div>' +
                        '<div class="jwl-datetime-row">' +
                            '<label>Czas:</label>' +
                            '<input type="number" id="jwl-dt-dur-h" min="0" max="23" value="0" style="width:50px;text-align:center;"/>' +
                            '<span style="font-size:11px;color:#6B778C;">h</span>' +
                            '<input type="number" id="jwl-dt-dur-m" min="0" max="59" value="0" style="width:50px;text-align:center;"/>' +
                            '<span style="font-size:11px;color:#6B778C;">min</span>' +
                        '</div>' +
                        '<div class="jwl-datetime-calculated">' +
                            '<span class="jwl-calc-label">Do zalogowania:</span>' +
                            '<span class="jwl-calc-value" id="jwl-dt-calc">0h 0m</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="jwl-section">' +
                    '<button class="jwl-btn jwl-btn-send" id="jwl-btn-send" style="width:100%;">&#8593; Wy\u015blij worklog do JIRA (Tempo)</button>' +
                '</div>' +
                '<div class="jwl-status" id="jwl-status"></div>' +
                '<div class="jwl-section" style="margin-top:10px;border-top:1px solid #DFE1E6;padding-top:8px;">' +
                    '<div class="jwl-history-header" id="jwl-history-toggle">' +
                        '<div class="jwl-label" style="margin:0;">Ostatnie worklogi</div>' +
                        '<div style="display:flex;align-items:center;gap:6px;">' +
                            '<button class="jwl-wl-btn jwl-wl-btn-refresh" id="jwl-btn-refresh-wl">Od\u015bwie\u017c</button>' +
                            '<span class="jwl-history-toggle" id="jwl-history-arrow">&#9654;</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="jwl-history-list" id="jwl-history-list">' +
                        '<div class="jwl-wl-empty">Wybierz zadanie i kliknij Od\u015bwie\u017c</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.appendChild(panel);

        // ========== 2b. Monthly side panel ==========
        const monthlyPanel = document.createElement('div');
        monthlyPanel.className = 'jwl-monthly-panel';
        monthlyPanel.id = 'jwl-monthly-panel';
        monthlyPanel.innerHTML =
            '<div class="jwl-monthly-header">' +
                '<div class="jwl-monthly-header-title" id="jwl-monthly-title">-</div>' +
                '<div class="jwl-monthly-nav">' +
                    '<button class="jwl-monthly-nav-btn" id="jwl-monthly-prev" title="Poprzedni miesi\u0105c">&#9664;</button>' +
                    '<button class="jwl-monthly-nav-btn" id="jwl-monthly-next" title="Nast\u0119pny miesi\u0105c">&#9654;</button>' +
                '</div>' +
            '</div>' +
            '<div class="jwl-monthly-body" id="jwl-monthly-body">' +
                '<div class="jwl-monthly-loading">Kliknij ikon\u0119 kalendarza aby za\u0142adowa\u0107</div>' +
            '</div>' +
            '<div class="jwl-monthly-footer" id="jwl-monthly-footer" style="display:none;">' +
                '<button id="jwl-refresh-rcp">&#8635; Od\u015bwie\u017c dane RCP</button>' +
            '</div>';
        // Panel jest dzieckiem glownego panelu - position: absolute wzgledem niego
        panel.style.position = 'fixed';
        panel.appendChild(monthlyPanel);

        // ========== 3. FAB <-> Panel toggle ==========
        function showFab() {
            fab.style.setProperty('display', 'flex', 'important');
        }
        function hideFab() {
            fab.style.setProperty('display', 'none', 'important');
        }

        fab.addEventListener('click', function() {
            panel.classList.add('jwl-visible');
            hideFab();
            GM_setValue(STORAGE_KEY_PREFIX + 'panelOpen', true);
        });

        // Initial state: always show FAB, restore panel only if was open
        var panelWasOpen = GM_getValue(STORAGE_KEY_PREFIX + 'panelOpen', false);
        if (panelWasOpen) {
            panel.classList.add('jwl-visible');
            hideFab();
        }

        // ========== 4. Draggable (tylko panel, FAB ma stala pozycje) ==========
        makeDraggable(panel, document.getElementById('jwl-drag-handle'));

        // Przywroc pozycje panelu
        var savedPos = GM_getValue(STORAGE_KEY_PREFIX + 'position', null);
        if (savedPos) {
            try {
                var pos = JSON.parse(savedPos);
                panel.style.top = pos.top + 'px';
                panel.style.left = pos.left + 'px';
                panel.style.right = 'auto';
                clampToViewport(panel);
            } catch(e) {}
        }

        // Przy zmianie rozmiaru okna - przywroc panel do widocznego obszaru
        window.addEventListener('resize', function() {
            if (panel.classList.contains('jwl-visible')) {
                clampToViewport(panel);
            }
        });

        // PPM na ikonke -> przywolaj panel do prawego gornego rogu
        fab.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            panel.style.top = '10px';
            panel.style.left = '';
            panel.style.right = '10px';
            GM_setValue(STORAGE_KEY_PREFIX + 'position', JSON.stringify({
                top: 10,
                left: window.innerWidth - 430
            }));
            // Pokaz panel jesli ukryty
            if (!panel.classList.contains('jwl-visible')) {
                panel.classList.add('jwl-visible');
                hideFab();
                GM_setValue(STORAGE_KEY_PREFIX + 'panelOpen', true);
            }
        });

        // ========== EVENT HANDLERS ==========
        const selectEl = document.getElementById('jwl-task-select');
        const timerTimeEl = document.getElementById('jwl-timer-time');
        const timerTaskEl = document.getElementById('jwl-timer-task');
        const timerStartedEl = document.getElementById('jwl-timer-started-info');
        const btnStart = document.getElementById('jwl-btn-start');
        const btnStop = document.getElementById('jwl-btn-stop');
        const btnSend = document.getElementById('jwl-btn-send');
        const btnMinimize = document.getElementById('jwl-btn-minimize');
        const btnSettings = document.getElementById('jwl-btn-settings');
        const worklogDesc = document.getElementById('jwl-worklog-desc');
        const statusEl = document.getElementById('jwl-status');
        const openJiraLink = document.getElementById('jwl-open-jira');
        const dtStartDate = document.getElementById('jwl-dt-start-date');
        const dtStartTime = document.getElementById('jwl-dt-start-time');
        const dtStopDate = document.getElementById('jwl-dt-stop-date');
        const dtStopTime = document.getElementById('jwl-dt-stop-time');
        const dtDurH = document.getElementById('jwl-dt-dur-h');
        const dtDurM = document.getElementById('jwl-dt-dur-m');
        const dtCalc = document.getElementById('jwl-dt-calc');

        let timerInterval = null;
        let elapsedAtStop = 0; // seconds elapsed when stopped
        var _syncLock = false; // blokada zapetlenia synchronizacji

        // Helper: timestamp z pol date+time (null jesli niekompletne)
        function getFieldMs(dateEl, timeEl) {
            if (!dateEl.value || !timeEl.value) return null;
            return new Date(dateEl.value + 'T' + timeEl.value).getTime();
        }

        // Helper: ustaw date+time z timestamp
        function tsToFields(ts, dateEl, timeEl) {
            var d = new Date(ts);
            dateEl.value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
            timeEl.value = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        }

        // Helper: czas trwania z pol h+m (sekundy)
        function getDurSec() {
            return ((parseInt(dtDurH.value) || 0) * 3600) + ((parseInt(dtDurM.value) || 0) * 60);
        }

        // Helper: ustaw pola h+m z sekund
        function setDurFields(sec) {
            if (sec <= 0) { dtDurH.value = 0; dtDurM.value = 0; return; }
            dtDurH.value = Math.floor(sec / 3600);
            dtDurM.value = Math.floor((sec % 3600) / 60);
        }

        // Aktualizuj etykiete "Do zalogowania"
        function updateCalcLabel() {
            var startMs = getFieldMs(dtStartDate, dtStartTime);
            var stopMs = getFieldMs(dtStopDate, dtStopTime);
            var durSec = getDurSec();

            // Preferuj roznice start-stop jesli oba sa
            var sec = 0;
            if (startMs && stopMs) {
                sec = Math.floor((stopMs - startMs) / 1000);
            } else {
                sec = durSec;
            }
            if (sec <= 0) {
                dtCalc.textContent = '0m';
                dtCalc.style.color = sec < 0 ? '#DE350B' : '#6B778C';
            } else {
                var h = Math.floor(sec / 3600);
                var m = Math.floor((sec % 3600) / 60);
                dtCalc.textContent = (h > 0 ? h + 'h ' : '') + m + 'm';
                dtCalc.style.color = '#0052CC';
            }
        }

        // ---- Synchronizacja dwukierunkowa ----

        // Zmiana START -> jesli stop istnieje: przelicz czas; jesli czas > 0: przelicz stop
        function onStartChanged() {
            if (_syncLock) return;
            _syncLock = true;
            var startMs = getFieldMs(dtStartDate, dtStartTime);
            var stopMs = getFieldMs(dtStopDate, dtStopTime);
            var durSec = getDurSec();
            if (startMs && stopMs) {
                // Oba istnieja -> przelicz czas
                var diff = Math.floor((stopMs - startMs) / 1000);
                setDurFields(Math.max(0, diff));
            } else if (startMs && durSec > 0) {
                // Start + czas -> oblicz stop
                tsToFields(startMs + durSec * 1000, dtStopDate, dtStopTime);
            }
            updateCalcLabel();
            _syncLock = false;
        }

        // Zmiana STOP -> jesli start istnieje: przelicz czas; jesli czas > 0: przelicz start
        function onStopChanged() {
            if (_syncLock) return;
            _syncLock = true;
            var startMs = getFieldMs(dtStartDate, dtStartTime);
            var stopMs = getFieldMs(dtStopDate, dtStopTime);
            var durSec = getDurSec();
            if (startMs && stopMs) {
                // Oba istnieja -> przelicz czas
                var diff = Math.floor((stopMs - startMs) / 1000);
                setDurFields(Math.max(0, diff));
            } else if (stopMs && durSec > 0) {
                // Stop + czas -> oblicz start
                tsToFields(stopMs - durSec * 1000, dtStartDate, dtStartTime);
            }
            updateCalcLabel();
            _syncLock = false;
        }

        // Zmiana CZAS -> jesli start istnieje: oblicz stop; jesli stop istnieje: oblicz start
        function onDurationChanged() {
            if (_syncLock) return;
            _syncLock = true;
            var startMs = getFieldMs(dtStartDate, dtStartTime);
            var stopMs = getFieldMs(dtStopDate, dtStopTime);
            var durSec = getDurSec();
            if (durSec > 0 && startMs) {
                // Start + czas -> oblicz stop
                tsToFields(startMs + durSec * 1000, dtStopDate, dtStopTime);
            } else if (durSec > 0 && stopMs) {
                // Stop + czas -> oblicz start
                tsToFields(stopMs - durSec * 1000, dtStartDate, dtStartTime);
            }
            updateCalcLabel();
            _syncLock = false;
        }

        // Podepnij listenery
        dtStartDate.addEventListener('change', onStartChanged);
        dtStartTime.addEventListener('change', onStartChanged);
        dtStopDate.addEventListener('change', onStopChanged);
        dtStopTime.addEventListener('change', onStopChanged);
        dtDurH.addEventListener('input', onDurationChanged);
        dtDurM.addEventListener('input', onDurationChanged);

        // Helper: ustaw pola z timestampow (uzywane przez START/STOP/restore)
        function setDateTimeFields(startTs, stopTs) {
            _syncLock = true;
            if (startTs) tsToFields(startTs, dtStartDate, dtStartTime);
            if (stopTs) tsToFields(stopTs, dtStopDate, dtStopTime);
            // Oblicz czas jesli oba sa ustawione
            if (startTs && stopTs) {
                setDurFields(Math.max(0, Math.floor((stopTs - startTs) / 1000)));
            }
            updateCalcLabel();
            _syncLock = false;
        }

        // Update JIRA link when task changes
        function updateJiraLink() {
            const key = selectEl.value;
            if (key) {
                openJiraLink.href = `${JIRA_BASE_URL}/browse/${key}`;
                openJiraLink.style.display = '';
            } else {
                openJiraLink.style.display = 'none';
            }
        }
        // ========== TIME TRACKING (estymata / zalogowany czas) ==========
        const trackingEl = document.getElementById('jwl-tracking');
        const trackSpentEl = document.getElementById('jwl-track-spent');
        const trackEstimateEl = document.getElementById('jwl-track-estimate');
        const trackRemainingEl = document.getElementById('jwl-track-remaining');
        const trackBarEl = document.getElementById('jwl-track-bar');
        var trackingCache = {}; // cache: key -> {originalEstimateSeconds, timeSpentSeconds, ...}

        function formatHM(seconds) {
            if (!seconds || seconds <= 0) return '0h 0m';
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            if (h > 0 && m > 0) return h + 'h ' + m + 'm';
            if (h > 0) return h + 'h';
            return m + 'm';
        }

        function renderTracking(data) {
            if (!data) {
                trackingEl.style.display = 'none';
                return;
            }
            var spent = data.timeSpentSeconds || 0;
            var estimate = data.originalEstimateSeconds || 0;

            // Pokaz sekcje nawet bez estymaty (zeby widac zalogowany czas)
            trackingEl.style.display = '';

            trackSpentEl.textContent = formatHM(spent);

            if (estimate > 0) {
                trackEstimateEl.textContent = formatHM(estimate);
                var remaining = estimate - spent;
                var pct = Math.min(Math.round((spent / estimate) * 100), 100);

                if (remaining > 0) {
                    trackRemainingEl.textContent = formatHM(remaining);
                    trackRemainingEl.className = 'jwl-tracking-value ok';
                } else if (remaining === 0) {
                    trackRemainingEl.textContent = '0h 0m (100%)';
                    trackRemainingEl.className = 'jwl-tracking-value';
                } else {
                    trackRemainingEl.textContent = '+' + formatHM(Math.abs(remaining)) + ' ponad estymat\u0119!';
                    trackRemainingEl.className = 'jwl-tracking-value over';
                }

                // Pasek - kolor zalezy od % wykorzystania
                var barColor = '#00875A'; // zielony < 75%
                if (pct >= 100) barColor = '#DE350B'; // czerwony >= 100%
                else if (pct >= 90) barColor = '#FF8B00'; // pomaranczowy >= 90%
                else if (pct >= 75) barColor = '#FFAB00'; // zolty >= 75%

                // Pozwol na >100% wizualnie (max 100% szerokosci paska)
                var barWidth = Math.min(pct, 100);
                trackBarEl.style.width = barWidth + '%';
                trackBarEl.style.background = barColor;
            } else {
                trackEstimateEl.textContent = 'brak estymaty';
                trackEstimateEl.style.fontStyle = 'italic';
                trackRemainingEl.textContent = '-';
                trackRemainingEl.className = 'jwl-tracking-value';
                trackBarEl.style.width = '0%';
            }
        }

        function loadTimeTracking(issueKey) {
            if (!issueKey) {
                trackingEl.style.display = 'none';
                return;
            }
            // Uzyj cache jezeli jest
            if (trackingCache[issueKey]) {
                renderTracking(trackingCache[issueKey]);
                return;
            }
            var creds = getCredentials();
            if (!creds.email || !creds.token) {
                trackingEl.style.display = 'none';
                return;
            }

            trackingEl.style.display = '';
            trackSpentEl.textContent = '...';
            trackEstimateEl.textContent = '...';
            trackRemainingEl.textContent = '...';

            fetchTimeTracking(issueKey, creds.email, creds.token, function(err, data) {
                if (err) {
                    console.log('[JiraWorklog] B\u0142\u0105d time tracking:', err);
                    trackingEl.style.display = 'none';
                    return;
                }
                trackingCache[issueKey] = data;
                // Renderuj tylko jesli dalej wybrany ten sam klucz
                if (selectEl.value === issueKey) {
                    renderTracking(data);
                }
            });
        }

        // Laduj podzadania po wybraniu zadania
        var subtasksCache = {}; // cache: parentKey -> [{key, summary, ...}]
        var lastSubtaskParent = null;

        function loadSubtasks(parentKey) {
            if (!parentKey) return;
            // Nie laduj ponownie jesli juz zaladowano lub trwa ladowanie
            if (subtasksCache[parentKey]) {
                if (subtasksCache[parentKey] !== 'loading') {
                    addSubtasksToSelect(parentKey, subtasksCache[parentKey]);
                }
                return;
            }
            var creds = getCredentials();
            if (!creds.email || !creds.token) {
                console.log('[JiraWorklog] Brak tokenow JIRA - nie moge pobrac podzadan');
                showStatus('Skonfiguruj tokeny JIRA \u017ceby pobiera\u0107 podzadania', 'info');
                return;
            }

            subtasksCache[parentKey] = 'loading';
            showStatus('Pobieram podzadania ' + parentKey + '...', 'info');
            console.log('[JiraWorklog] Pobieram podzadania dla', parentKey);

            fetchSubtasks(parentKey, creds.email, creds.token, function(err, subtasks) {
                if (err) {
                    console.log('[JiraWorklog] B\u0142\u0105d pobierania podzada\u0144:', err);
                    showStatus('B\u0142\u0105d pobierania podzada\u0144: ' + err, 'error');
                    subtasksCache[parentKey] = [];
                    return;
                }
                subtasksCache[parentKey] = subtasks;
                console.log('[JiraWorklog] Podzadania dla', parentKey + ':', subtasks.length);
                if (subtasks.length > 0) {
                    addSubtasksToSelect(parentKey, subtasks);
                    showStatus('Za\u0142adowano ' + subtasks.length + ' podzada\u0144 dla ' + parentKey, 'success');
                } else {
                    showStatus(parentKey + ' nie ma podzada\u0144', 'info');
                }
            });
        }

        function addSubtasksToSelect(parentKey, subtasks) {
            if (!subtasks || subtasks.length === 0) return;
            // Usun stara grupe podzadan
            var oldGroup = selectEl.querySelector('optgroup[data-subtasks-of]');
            if (oldGroup) oldGroup.remove();

            // Znajdz option rodzica
            var parentOption = selectEl.querySelector('option[value="' + parentKey + '"]');
            if (!parentOption) return;

            var group = document.createElement('optgroup');
            group.label = '  \u2514 Podzadania ' + parentKey + ' (' + subtasks.length + ')';
            group.setAttribute('data-subtasks-of', parentKey);

            subtasks.forEach(function(st) {
                var opt = document.createElement('option');
                opt.value = st.key;
                opt.title = st.summary + (st.assignee ? ' [' + st.assignee + ']' : '') + (st.status ? ' (' + st.status + ')' : '');
                opt.textContent = '  ' + st.key + ' - ' + st.summary.substring(0, 50) + (st.summary.length > 50 ? '...' : '') +
                    (st.status ? ' [' + st.status + ']' : '');
                group.appendChild(opt);
            });

            // Wstaw grupe po rodzicu (po jego optgroup)
            var parentGroup = parentOption.parentElement;
            if (parentGroup && parentGroup.tagName === 'OPTGROUP' && parentGroup.nextSibling) {
                selectEl.insertBefore(group, parentGroup.nextSibling);
            } else {
                selectEl.appendChild(group);
            }
        }

        selectEl.addEventListener('change', function() {
            updateJiraLink();
            var key = selectEl.value;
            // Zaladuj time tracking
            loadTimeTracking(key);
            if (key && key !== lastSubtaskParent) {
                lastSubtaskParent = key;
                loadSubtasks(key);
            }
        });
        updateJiraLink();
        // Zaladuj podzadania i time tracking dla poczatkowo wybranego zadania
        if (selectEl.value) {
            lastSubtaskParent = selectEl.value;
            loadSubtasks(selectEl.value);
            loadTimeTracking(selectEl.value);
        }

        // Close panel -> show FAB
        btnMinimize.addEventListener('click', () => {
            panel.classList.remove('jwl-visible');
            monthlyPanel.classList.remove('open');
            showFab();
            GM_setValue(STORAGE_KEY_PREFIX + 'panelOpen', false);
        });

        // Settings
        btnSettings.addEventListener('click', showSettingsModal);

        // ========== BUG REPORT ==========
        var btnBugReport = document.getElementById('jwl-btn-bugreport');
        if (btnBugReport) {
            btnBugReport.addEventListener('click', function() {
                showBugReportModal();
            });
        }

        function showBugReportModal() {
            // Remove existing
            var existing = document.getElementById('jwl-bug-overlay');
            if (existing) existing.remove();

            var overlay = document.createElement('div');
            overlay.id = 'jwl-bug-overlay';
            overlay.className = 'jwl-bug-overlay';
            overlay.innerHTML =
                '<div class="jwl-bug-modal">' +
                    '<h3>&#128027; Zg\u0142o\u015b b\u0142\u0105d</h3>' +
                    '<div class="jwl-bug-field">' +
                        '<label>Tytu\u0142 *</label>' +
                        '<input id="jwl-bug-title" type="text" placeholder="Kr\u00f3tki opis problemu..." maxlength="200">' +
                    '</div>' +
                    '<div class="jwl-bug-field">' +
                        '<label>Opis (opcjonalny)</label>' +
                        '<textarea id="jwl-bug-desc" rows="4" placeholder="Szczeg\u00f3\u0142owy opis b\u0142\u0119du, kroki do odtworzenia..." maxlength="2000"></textarea>' +
                    '</div>' +
                    '<div class="jwl-bug-field">' +
                        '<label>Screenshot (opcjonalny)</label>' +
                        '<div class="jwl-bug-screenshot-area" id="jwl-bug-ss-area">' +
                            '<input type="file" id="jwl-bug-ss-input" accept="image/*" style="display:none">' +
                            '<div id="jwl-bug-ss-placeholder"><span class="hint">Kliknij aby wybra\u0107 plik lub wklej ze schowka (Ctrl+V)<br>Max 2MB, format: PNG, JPG, GIF</span></div>' +
                            '<div id="jwl-bug-ss-preview" class="jwl-bug-screenshot-preview" style="display:none"></div>' +
                        '</div>' +
                    '</div>' +
                    '<div id="jwl-bug-msg"></div>' +
                    '<div class="jwl-bug-actions">' +
                        '<button class="jwl-btn jwl-btn-settings" id="jwl-bug-cancel">Anuluj</button>' +
                        '<button class="jwl-btn jwl-btn-send" id="jwl-bug-submit">Wy\u015blij zg\u0142oszenie</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            // Screenshot state
            var bugScreenshotData = null;

            var ssArea = document.getElementById('jwl-bug-ss-area');
            var ssInput = document.getElementById('jwl-bug-ss-input');
            var ssPlaceholder = document.getElementById('jwl-bug-ss-placeholder');
            var ssPreview = document.getElementById('jwl-bug-ss-preview');

            // Click area -> open file picker
            ssArea.addEventListener('click', function(e) {
                if (e.target.closest('.jwl-bug-screenshot-remove')) return;
                if (!bugScreenshotData) ssInput.click();
            });

            // File input change
            ssInput.addEventListener('change', function() {
                if (ssInput.files && ssInput.files[0]) {
                    handleBugScreenshotFile(ssInput.files[0]);
                }
            });

            // Paste handler on the modal
            var bugModal = overlay.querySelector('.jwl-bug-modal');
            bugModal.addEventListener('paste', function(e) {
                var items = (e.clipboardData || e.originalEvent.clipboardData).items;
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        e.preventDefault();
                        handleBugScreenshotFile(items[i].getAsFile());
                        return;
                    }
                }
            });

            function handleBugScreenshotFile(file) {
                if (!file || !file.type.match(/^image\//)) {
                    showBugScreenshotError('Tylko pliki graficzne (PNG, JPG, GIF)');
                    return;
                }
                if (file.size > 2 * 1024 * 1024) {
                    showBugScreenshotError('Plik zbyt duzy (max 2MB). Rozmiar: ' + (file.size / 1024 / 1024).toFixed(1) + 'MB');
                    return;
                }
                var reader = new FileReader();
                reader.onload = function(ev) {
                    bugScreenshotData = ev.target.result;
                    ssPlaceholder.style.display = 'none';
                    ssPreview.style.display = 'inline-block';
                    ssPreview.innerHTML = '<img src="' + bugScreenshotData + '">' +
                        '<button class="jwl-bug-screenshot-remove" title="Usun screenshot">&times;</button>';
                    ssPreview.querySelector('.jwl-bug-screenshot-remove').addEventListener('click', function(e) {
                        e.stopPropagation();
                        removeBugScreenshot();
                    });
                };
                reader.readAsDataURL(file);
            }

            function removeBugScreenshot() {
                bugScreenshotData = null;
                ssInput.value = '';
                ssPreview.style.display = 'none';
                ssPreview.innerHTML = '';
                ssPlaceholder.style.display = 'block';
            }

            function showBugScreenshotError(msg) {
                var msgEl = document.getElementById('jwl-bug-msg');
                msgEl.innerHTML = '<div class="jwl-bug-status err">' + esc(msg) + '</div>';
                setTimeout(function() { msgEl.innerHTML = ''; }, 4000);
            }

            // Store screenshot getter on overlay for submitBugReport
            overlay._getScreenshot = function() { return bugScreenshotData; };

            // Close on background click
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) overlay.remove();
            });

            document.getElementById('jwl-bug-cancel').addEventListener('click', function() {
                overlay.remove();
            });

            document.getElementById('jwl-bug-submit').addEventListener('click', function() {
                submitBugReport(overlay);
            });

            document.getElementById('jwl-bug-title').focus();
        }

        function submitBugReport(overlay) {
            var title = document.getElementById('jwl-bug-title').value.trim();
            var desc = document.getElementById('jwl-bug-desc').value.trim();
            var msgEl = document.getElementById('jwl-bug-msg');

            if (!title) {
                msgEl.innerHTML = '<div class="jwl-bug-status err">Tytu\u0142 jest wymagany</div>';
                return;
            }

            // Get license key from loader context
            var licenseKey = '';
            try { licenseKey = GM_getValue('licenseKey', ''); } catch(e) {}

            if (!licenseKey) {
                msgEl.innerHTML = '<div class="jwl-bug-status err">Brak klucza licencyjnego. Ustaw klucz w loaderze.</div>';
                return;
            }

            var submitBtn = document.getElementById('jwl-bug-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Wysy\u0142anie...';

            var screenshotData = overlay._getScreenshot ? overlay._getScreenshot() : null;

            var payload = {
                key: licenseKey,
                scriptId: 'jira-worklog',
                domain: location.hostname,
                title: title,
                description: desc,
                browserInfo: navigator.userAgent
            };
            if (screenshotData) {
                payload.screenshot = screenshotData;
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://license.tampermonkey.pl/api/bugs',
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(payload),
                timeout: 15000,
                onload: function(response) {
                    try {
                        var data = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300 && data.submitted) {
                            msgEl.innerHTML = '<div class="jwl-bug-status ok">Dzi\u0119kujemy! Zg\u0142oszenie wys\u0142ane (ID: ' + esc(data.id) + ')</div>';
                            submitBtn.style.display = 'none';
                            document.getElementById('jwl-bug-title').disabled = true;
                            document.getElementById('jwl-bug-desc').disabled = true;
                            setTimeout(function() { overlay.remove(); }, 3000);
                        } else {
                            msgEl.innerHTML = '<div class="jwl-bug-status err">' + esc(data.error || 'B\u0142\u0105d wysy\u0142ki') + '</div>';
                            submitBtn.disabled = false;
                            submitBtn.textContent = 'Wy\u015blij zg\u0142oszenie';
                        }
                    } catch(e) {
                        msgEl.innerHTML = '<div class="jwl-bug-status err">B\u0142\u0105d parsowania odpowiedzi</div>';
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Wy\u015blij zg\u0142oszenie';
                    }
                },
                onerror: function() {
                    msgEl.innerHTML = '<div class="jwl-bug-status err">B\u0142\u0105d sieci. Sprawd\u017a po\u0142\u0105czenie.</div>';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Wy\u015blij zg\u0142oszenie';
                },
                ontimeout: function() {
                    msgEl.innerHTML = '<div class="jwl-bug-status err">Timeout. Spr\u00f3buj ponownie.</div>';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Wy\u015blij zg\u0142oszenie';
                }
            });
        }

        // ========== MONTHLY PANEL LOGIC ==========
        const btnMonthly = document.getElementById('jwl-btn-monthly');
        const monthlyTitle = document.getElementById('jwl-monthly-title');
        const monthlyBody = document.getElementById('jwl-monthly-body');
        const monthlyPrev = document.getElementById('jwl-monthly-prev');
        const monthlyNext = document.getElementById('jwl-monthly-next');

        var monthlyYear = new Date().getFullYear();
        var monthlyMonth = new Date().getMonth(); // 0-based

        const MONTH_NAMES_PL = ['Styczen','Luty','Marzec','Kwiecien','Maj','Czerwiec',
            'Lipiec','Sierpien','Wrzesien','Pazdziernik','Listopad','Grudzien'];
        const DAY_NAMES_PL = ['Nd','Pn','Wt','Sr','Cz','Pt','So'];

        function updateMonthlySide() {
            // Ustaw strone panelu: jesli prawy brzeg panelu jest blisko prawej krawedzi okna -> lewa; inaczej prawa
            var panelRect = panel.getBoundingClientRect();
            var spaceRight = window.innerWidth - panelRect.right;
            var spaceLeft = panelRect.left;
            monthlyPanel.classList.remove('side-left', 'side-right');
            if (spaceRight < 300 && spaceLeft >= 300) {
                monthlyPanel.classList.add('side-left');
            } else {
                monthlyPanel.classList.add('side-right');
            }
        }

        function toggleMonthlyPanel() {
            var isOpen = monthlyPanel.classList.contains('open');
            if (isOpen) {
                monthlyPanel.classList.remove('open');
            } else {
                updateMonthlySide();
                monthlyPanel.classList.add('open');
                loadMonthlyData();
            }
        }

        btnMonthly.addEventListener('click', toggleMonthlyPanel);
        monthlyPrev.addEventListener('click', function() {
            monthlyMonth--;
            if (monthlyMonth < 0) { monthlyMonth = 11; monthlyYear--; }
            loadMonthlyData();
        });
        monthlyNext.addEventListener('click', function() {
            monthlyMonth++;
            if (monthlyMonth > 11) { monthlyMonth = 0; monthlyYear++; }
            loadMonthlyData();
        });

        // Refresh RCP button
        document.getElementById('jwl-refresh-rcp').addEventListener('click', function() {
            this.textContent = '\u21BB Od\u015bwie\u017cam...';
            this.disabled = true;
            monthlyCache = {};
            rcpCache = {};
            iaiCache = {};
            for (var cm = 0; cm < 12; cm++) {
                var cy = _monthlyYear || new Date().getFullYear();
                GM_deleteValue(STORAGE_KEY_PREFIX + 'iaiRcp_' + cy + '_' + (cm + 1));
                GM_deleteValue(STORAGE_KEY_PREFIX + 'iaiRcp_' + cy + '_' + (cm + 1) + '_ts');
            }
            GM_deleteValue(STORAGE_KEY_PREFIX + 'rcpRawData');
            GM_deleteValue(STORAGE_KEY_PREFIX + 'rcpLastFetch');
            enovaTabOpened = false;
            loadMonthlyData();
        });

        function loadMonthlyData() {
            if (__WM__ && __WM__.indexOf('.') < 1) { _halt(); return; }
            _loadMonthlyData = loadMonthlyData;
            _monthlyYear = monthlyYear;
            _monthlyMonth = monthlyMonth;

            var creds = getCredentials();
            if (!creds.tempoToken || !creds.accountId) {
                monthlyBody.innerHTML = '<div class="jwl-monthly-loading">Skonfiguruj tokeny i uruchom test po\u0142\u0105czenia</div>';
                monthlyTitle.textContent = MONTH_NAMES_PL[monthlyMonth] + ' ' + monthlyYear;
                return;
            }

            var cacheKey = monthlyYear + '-' + String(monthlyMonth + 1).padStart(2, '0');
            monthlyTitle.textContent = MONTH_NAMES_PL[monthlyMonth] + ' ' + monthlyYear;

            if (monthlyCache[cacheKey]) {
                renderMonthlyData(monthlyCache[cacheKey], rcpCache[cacheKey] || null, iaiCache[cacheKey] || null);
                return;
            }

            monthlyBody.innerHTML = '<div class="jwl-monthly-loading">\u0141adowanie danych za ' + MONTH_NAMES_PL[monthlyMonth] + '...</div>';

            var fromDate = monthlyYear + '-' + String(monthlyMonth + 1).padStart(2, '0') + '-01';
            // Ostatni dzien miesiaca
            var lastDay = new Date(monthlyYear, monthlyMonth + 1, 0).getDate();
            var toDate = monthlyYear + '-' + String(monthlyMonth + 1).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');

            var tempoLoaded = false, rcpLoaded = false, iaiLoaded = false;
            var dayMap = null, rcpMap = null, iaiMap = null;
            var tempoErr = null;
            var rcpUnavailable = false, iaiUnavailable = false;

            function tryRender() {
                if (!tempoLoaded) return;
                if (tempoErr) {
                    monthlyBody.innerHTML = '<div class="jwl-monthly-loading" style="color:#DE350B;">B\u0142\u0105d: ' + tempoErr + '</div>';
                    return;
                }
                monthlyCache[cacheKey] = dayMap;
                if (rcpMap) rcpCache[cacheKey] = rcpMap;
                if (iaiMap) iaiCache[cacheKey] = iaiMap;
                renderMonthlyData(dayMap, rcpLoaded ? rcpMap : null, iaiLoaded ? iaiMap : null, rcpUnavailable, iaiUnavailable);
            }

            // Fetch Tempo data
            fetchMyMonthlyWorklogs(creds.accountId, creds.tempoToken, fromDate, toDate, function(err, worklogs) {
                if (err) {
                    tempoErr = err;
                    tempoLoaded = true;
                    tryRender();
                    return;
                }
                // Grupuj po startDate
                dayMap = {};
                worklogs.forEach(function(wl) {
                    var d = wl.startDate || '';
                    if (!dayMap[d]) dayMap[d] = { seconds: 0, lastEnd: null };
                    dayMap[d].seconds += (wl.timeSpentSeconds || 0);
                    if (wl.startTime && wl.timeSpentSeconds) {
                        var parts = wl.startTime.split(':');
                        var startMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
                        var endMin = startMin + Math.floor(wl.timeSpentSeconds / 60);
                        if (!dayMap[d].lastEnd || endMin > dayMap[d].lastEnd) {
                            dayMap[d].lastEnd = endMin;
                        }
                    }
                });
                tempoLoaded = true;
                tryRender();
            });

            // Fetch Enova RCP if enabled
            if (creds.enovaEnabled) {
                fetchEnovaRcpData(creds.enovaContextHandle || '', fromDate, toDate, function(err, data) {
                    if (err) {
                        console.log('[JiraWorklog] Enova RCP error:', err);
                        rcpUnavailable = true;
                    } else {
                        rcpMap = data;
                    }
                    rcpLoaded = true;
                    tryRender();
                });
            } else {
                rcpUnavailable = true;
                rcpLoaded = true;
            }

            // Fetch IAI RCP
            fetchIaiRcpData(monthlyYear, monthlyMonth, function(err, data) {
                if (err) {
                    console.log('[JiraWorklog] IAI RCP error:', err);
                    iaiUnavailable = true;
                } else {
                    iaiMap = data;
                }
                iaiLoaded = true;
                tryRender();
            });
        }

        // Numer tygodnia ISO z daty
        function getWeekNumber(date) {
            var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            var dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        }

        function renderMonthlyData(dayMap, rcpMap, iaiMap, _rcpUnavail, _iaiUnavail) {
            _renderMonthlyData = renderMonthlyData;
            var creds = getCredentials();
            var showWeekends = creds.showWeekends !== false;
            var showRcp = creds.enovaEnabled && creds.showRcpEnova !== false;
            var showIai = creds.showRcpIai !== false;
            var hasRcp = rcpMap && Object.keys(rcpMap).length > 0;
            var hasIai = iaiMap && Object.keys(iaiMap).length > 0;
            var rcpLoading = showRcp && !hasRcp && !_rcpUnavail;
            var iaiLoading = showIai && !hasIai && !_iaiUnavail;
            var rcpMode = creds.rcpEnovaMode || 'hours';
            var iaiMode = creds.rcpIaiMode || 'hours';

            var colCount = 4 + (showRcp ? 2 : 0) + (showIai ? 2 : 0);

            var daysInMonth = new Date(monthlyYear, monthlyMonth + 1, 0).getDate();
            var today = new Date();
            var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

            var totalSeconds = 0;
            var workingDays = 0;
            var totalRcpMin = 0, totalIaiTmMin = 0, totalIaiRcpMin = 0;

            // Pre-calculate totals
            for (var d = 1; d <= daysInMonth; d++) {
                var dateStr = monthlyYear + '-' + String(monthlyMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                var entry = dayMap[dateStr];
                totalSeconds += (entry ? entry.seconds : 0);
                var dow = new Date(monthlyYear, monthlyMonth, d).getDay();
                if (dow >= 1 && dow <= 5) workingDays++;
                if (hasRcp && rcpMap[dateStr]) {
                    var re = rcpMap[dateStr];
                    if (re.firstEntryMin !== null && re.lastExitMin !== null) {
                        totalRcpMin += (re.lastExitMin - re.firstEntryMin);
                    }
                }
                if (hasIai && iaiMap[dateStr]) {
                    totalIaiTmMin += (iaiMap[dateStr].tmMin || 0);
                    totalIaiRcpMin += (iaiMap[dateStr].rcpMin || 0);
                }
            }

            var totalH = Math.floor(totalSeconds / 3600);
            var totalM = Math.floor((totalSeconds % 3600) / 60);
            var normSeconds = workingDays * 8 * 3600;
            var normH = workingDays * 8;
            var pct = normSeconds > 0 ? Math.round((totalSeconds / normSeconds) * 100) : 0;
            var pctColor = pct >= 100 ? '#00875A' : pct >= 75 ? '#FF8B00' : '#DE350B';

            var html = '';

            // Summary
            html += '<div class="jwl-monthly-summary" style="flex-wrap:wrap;gap:4px;">';
            html += '<div style="display:flex;justify-content:space-between;width:100%;">';
            html += '<span class="jwl-monthly-summary-label">Zalogowano:</span>';
            html += '<span class="jwl-monthly-summary-value">' + totalH + 'h ' + totalM + 'm</span>';
            html += '</div>';
            html += '<div style="display:flex;justify-content:space-between;width:100%;font-size:11px;">';
            html += '<span class="jwl-monthly-summary-label">Norma (' + workingDays + ' dni \u00d7 8h):</span>';
            html += '<span style="font-weight:600;color:#0747A6;">' + normH + 'h</span>';
            html += '</div>';

            // RCP enova summary
            if (showRcp) {
                html += '<div style="display:flex;justify-content:space-between;width:100%;font-size:11px;">';
                html += '<span class="jwl-monthly-summary-label">RCP enova:</span>';
                if (hasRcp) {
                    html += '<span style="font-weight:600;color:#5243AA;">' + Math.floor(totalRcpMin / 60) + 'h ' + (totalRcpMin % 60) + 'm</span>';
                } else if (rcpLoading) {
                    html += '<span class="jwl-loading-dots" style="color:#97A0AF;font-size:10px;"></span>';
                } else {
                    html += '<span style="color:#C1C7D0;font-size:10px;">niedost\u0119pne</span>';
                }
                html += '</div>';
            }

            // RCP IAI summary
            if (showIai) {
                html += '<div style="display:flex;justify-content:space-between;width:100%;font-size:11px;">';
                html += '<span class="jwl-monthly-summary-label">RCP IAI:</span>';
                if (hasIai) {
                    html += '<span style="font-weight:600;color:#006644;">' + Math.floor(totalIaiRcpMin / 60) + 'h ' + (totalIaiRcpMin % 60) + 'm</span>';
                } else if (iaiLoading) {
                    html += '<span class="jwl-loading-dots" style="color:#97A0AF;font-size:10px;"></span>';
                } else {
                    html += '<span style="color:#C1C7D0;font-size:10px;">niedost\u0119pne</span>';
                }
                html += '</div>';
            }

            html += '<div style="width:100%;height:6px;background:#DFE1E6;border-radius:3px;overflow:hidden;margin-top:2px;">';
            html += '<div style="height:100%;width:' + Math.min(pct, 100) + '%;background:' + pctColor + ';border-radius:3px;transition:width 0.3s;"></div>';
            html += '</div>';
            html += '<div style="width:100%;text-align:center;font-size:12px;font-weight:700;color:' + pctColor + ';margin-top:1px;">' + pct + '%</div>';
            html += '</div>';

            // Table
            html += '<table class="jwl-monthly-tbl"><thead><tr>';
            html += '<th>Dzie\u0144</th>';
            html += '<th></th>'; // bar
            html += '<th>Tempo</th>';
            html += '<th>do</th>';
            if (showRcp) { html += '<th>RCP E</th><th>+/-</th>'; }
            if (showIai) { html += '<th>RCP I</th><th>+/-</th>'; }
            html += '</tr></thead><tbody>';

            var maxDaySec = 8 * 3600;
            var lastWeekNum = -1;
            var weekSeconds = 0;
            var weekWorkDays = 0;
            var weekRcpMin = 0, weekIaiMin = 0;

            function fmtHM(sec) {
                if (!sec || sec <= 0) return '-';
                var h = Math.floor(sec / 3600);
                var m = Math.floor((sec % 3600) / 60);
                return h + 'h ' + m + 'm';
            }

            function fmtMinHM(min) {
                if (!min || min <= 0) return '-';
                var h = Math.floor(min / 60);
                var m = min % 60;
                return h + 'h ' + m + 'm';
            }

            function fmtDiff(tempoSec, rcpMin) {
                if (rcpMin === null || rcpMin === undefined || rcpMin <= 0) return '';
                var tempoMin = Math.floor(tempoSec / 60);
                var diff = tempoMin - rcpMin;
                var sign = diff >= 0 ? '+' : '';
                var h = Math.floor(Math.abs(diff) / 60);
                var m = Math.abs(diff) % 60;
                var color = diff >= 0 ? '#00875A' : '#DE350B';
                var txt = sign + (h > 0 ? h + 'h' : '') + m + 'm';
                return '<span style="color:' + color + ';">' + txt + '</span>';
            }

            for (var d2 = 1; d2 <= daysInMonth; d2++) {
                var dateObj = new Date(monthlyYear, monthlyMonth, d2);
                var dateStr2 = monthlyYear + '-' + String(monthlyMonth + 1).padStart(2, '0') + '-' + String(d2).padStart(2, '0');
                var dayEntry = dayMap[dateStr2];
                var sec2 = dayEntry ? dayEntry.seconds : 0;
                var dow2 = dateObj.getDay();
                var isWeekend = (dow2 === 0 || dow2 === 6);
                var weekNum = getWeekNumber(dateObj);

                // RCP data for this day
                var dayRcp = hasRcp ? (rcpMap[dateStr2] || null) : null;
                var dayIai = hasIai ? (iaiMap[dateStr2] || null) : null;
                var dayRcpMin = (dayRcp && dayRcp.firstEntryMin !== null && dayRcp.lastExitMin !== null) ? (dayRcp.lastExitMin - dayRcp.firstEntryMin) : 0;
                var dayIaiRcpMin = dayIai ? (dayIai.rcpMin || 0) : 0;

                // Week separator
                if (weekNum !== lastWeekNum) {
                    // Week summary for previous week
                    if (lastWeekNum !== -1 && weekSeconds > 0) {
                        var wH = Math.floor(weekSeconds / 3600);
                        var wM = Math.floor((weekSeconds % 3600) / 60);
                        var wNorm = weekWorkDays * 8 * 3600;
                        var wPct = wNorm > 0 ? Math.round((weekSeconds / wNorm) * 100) : 0;
                        var wPctColor = wPct >= 100 ? '#00875A' : wPct >= 75 ? '#FF8B00' : '#DE350B';
                        html += '<tr class="jwl-tbl-weeksum"><td></td><td></td>';
                        html += '<td class="col-tempo" style="color:#0747A6;">' + wH + 'h ' + wM + 'm</td>';
                        html += '<td class="col-do" style="color:' + wPctColor + ';">' + wPct + '%</td>';
                        if (showRcp) {
                            html += '<td class="col-rcp" style="color:#5243AA;">' + (weekRcpMin > 0 ? fmtMinHM(weekRcpMin) : '') + '</td>';
                            html += '<td class="col-diff">' + fmtDiff(weekSeconds, weekRcpMin > 0 ? weekRcpMin : null) + '</td>';
                        }
                        if (showIai) {
                            html += '<td class="col-iai" style="color:#006644;">' + (weekIaiMin > 0 ? fmtMinHM(weekIaiMin) : '') + '</td>';
                            html += '<td class="col-diff">' + fmtDiff(weekSeconds, weekIaiMin > 0 ? weekIaiMin : null) + '</td>';
                        }
                        html += '</tr>';
                    }
                    weekSeconds = 0;
                    weekWorkDays = 0;
                    weekRcpMin = 0;
                    weekIaiMin = 0;

                    // Week separator row
                    html += '<tr class="jwl-tbl-weeksep"><td colspan="' + colCount + '">';
                    html += '<span class="jwl-tbl-weekbadge">Tydz ' + weekNum + '</span>';
                    html += '</td></tr>';
                    lastWeekNum = weekNum;
                }

                weekSeconds += sec2;
                if (!isWeekend) weekWorkDays++;
                weekRcpMin += dayRcpMin;
                weekIaiMin += dayIaiRcpMin;

                // Skip weekends if hidden
                if (isWeekend && !showWeekends) continue;

                var isToday = (dateStr2 === todayStr);
                var hasTime = (sec2 > 0);

                var dH = Math.floor(sec2 / 3600);
                var dMin = Math.floor((sec2 % 3600) / 60);
                var timeStr = hasTime ? (dH + 'h ' + dMin + 'm') : '-';
                var barPct = Math.min(100, Math.round((sec2 / maxDaySec) * 100));
                var barClass = sec2 >= maxDaySec ? 'over' : '';

                var trClasses = '';
                if (isToday) trClasses += ' today';
                if (isWeekend) trClasses += ' weekend';
                if (hasTime) trClasses += ' has-time';

                // Last end time
                var lastEndStr = '';
                if (hasTime && dayEntry && dayEntry.lastEnd) {
                    var eH = Math.floor(dayEntry.lastEnd / 60);
                    var eM = dayEntry.lastEnd % 60;
                    lastEndStr = String(eH).padStart(2, '0') + ':' + String(eM).padStart(2, '0');
                }

                // Bar center badge (E%/I%)
                var barBadge = '';
                if (hasTime) {
                    var badges = [];
                    if (showRcp && hasRcp && dayRcpMin > 0) {
                        var ePct = Math.round((sec2 / (dayRcpMin * 60)) * 100);
                        badges.push(ePct + '%');
                    }
                    if (showIai && hasIai && dayIaiRcpMin > 0) {
                        var iPct = Math.round((sec2 / (dayIaiRcpMin * 60)) * 100);
                        badges.push('<span class="iai">' + iPct + '%</span>');
                    }
                    if (badges.length > 0) {
                        barBadge = '<span class="jwl-bar-pcts">' + badges.join('<span class="sep">/</span>') + '</span>';
                    }
                }

                html += '<tr class="' + trClasses.trim() + '">';
                html += '<td class="col-day">' + DAY_NAMES_PL[dow2] + ' ' + String(d2).padStart(2, '0') + '.' + String(monthlyMonth + 1).padStart(2, '0') + '</td>';
                html += '<td class="col-bar"><div class="jwl-bar-wrap"><div class="jwl-monthly-day-bar" style="flex:1;"><div class="jwl-monthly-day-bar-fill ' + barClass + '" style="width:' + barPct + '%;"></div></div>' + barBadge + '</div></td>';
                html += '<td class="col-tempo' + (hasTime ? '' : ' zero') + '">' + timeStr + '</td>';
                html += '<td class="col-do">' + lastEndStr + '</td>';

                if (showRcp) {
                    if (hasRcp && dayRcp && dayRcp.firstEntryMin !== null) {
                        if (rcpMode === 'range') {
                            html += '<td class="col-rcp">' + formatMinutesToTime(dayRcp.firstEntryMin) + '-' + formatMinutesToTime(dayRcp.lastExitMin) + '</td>';
                        } else {
                            html += '<td class="col-rcp">' + (dayRcpMin > 0 ? fmtMinHM(dayRcpMin) : '<span class="muted">-</span>') + '</td>';
                        }
                        // Diff column
                        if (!isWeekend) {
                            html += '<td class="col-diff">' + fmtDiff(sec2, dayRcpMin > 0 ? dayRcpMin : null) + '</td>';
                        } else {
                            // Weekend: show positive contribution
                            html += '<td class="col-diff">' + (sec2 > 0 ? '<span style="color:#00875A;">+' + fmtHM(sec2).replace('-','') + '</span>' : '') + '</td>';
                        }
                    } else if (rcpLoading) {
                        html += '<td class="col-rcp"><span class="jwl-loading-dots"></span></td>';
                        html += '<td class="col-diff"></td>';
                    } else {
                        html += '<td class="col-rcp"><span class="muted">-</span></td>';
                        html += '<td class="col-diff"></td>';
                    }
                }

                if (showIai) {
                    if (hasIai && dayIai) {
                        if (iaiMode === 'range') {
                            var iStart = dayIai.rcpStart !== null ? formatMinutesToTime(dayIai.rcpStart) : '';
                            var iEnd = dayIai.rcpEnd !== null ? formatMinutesToTime(dayIai.rcpEnd) : '';
                            html += '<td class="col-iai">' + (iStart && iEnd ? iStart + '-' + iEnd : (dayIaiRcpMin > 0 ? fmtMinHM(dayIaiRcpMin) : '<span class="muted">-</span>')) + '</td>';
                        } else {
                            html += '<td class="col-iai">' + (dayIaiRcpMin > 0 ? fmtMinHM(dayIaiRcpMin) : '<span class="muted">-</span>') + '</td>';
                        }
                        if (!isWeekend) {
                            html += '<td class="col-diff">' + fmtDiff(sec2, dayIaiRcpMin > 0 ? dayIaiRcpMin : null) + '</td>';
                        } else {
                            html += '<td class="col-diff">' + (sec2 > 0 ? '<span style="color:#00875A;">+' + fmtHM(sec2).replace('-','') + '</span>' : '') + '</td>';
                        }
                    } else if (iaiLoading) {
                        html += '<td class="col-iai"><span class="jwl-loading-dots"></span></td>';
                        html += '<td class="col-diff"></td>';
                    } else {
                        html += '<td class="col-iai"><span class="muted">-</span></td>';
                        html += '<td class="col-diff"></td>';
                    }
                }

                html += '</tr>';
            }

            // Last week summary
            if (weekSeconds > 0) {
                var wH2 = Math.floor(weekSeconds / 3600);
                var wM2 = Math.floor((weekSeconds % 3600) / 60);
                var wNorm2 = weekWorkDays * 8 * 3600;
                var wPct2 = wNorm2 > 0 ? Math.round((weekSeconds / wNorm2) * 100) : 0;
                var wPctColor2 = wPct2 >= 100 ? '#00875A' : wPct2 >= 75 ? '#FF8B00' : '#DE350B';
                html += '<tr class="jwl-tbl-weeksum"><td></td><td></td>';
                html += '<td class="col-tempo" style="color:#0747A6;">' + wH2 + 'h ' + wM2 + 'm</td>';
                html += '<td class="col-do" style="color:' + wPctColor2 + ';">' + wPct2 + '%</td>';
                if (showRcp) {
                    html += '<td class="col-rcp" style="color:#5243AA;">' + (weekRcpMin > 0 ? fmtMinHM(weekRcpMin) : '') + '</td>';
                    html += '<td class="col-diff">' + fmtDiff(weekSeconds, weekRcpMin > 0 ? weekRcpMin : null) + '</td>';
                }
                if (showIai) {
                    html += '<td class="col-iai" style="color:#006644;">' + (weekIaiMin > 0 ? fmtMinHM(weekIaiMin) : '') + '</td>';
                    html += '<td class="col-diff">' + fmtDiff(weekSeconds, weekIaiMin > 0 ? weekIaiMin : null) + '</td>';
                }
                html += '</tr>';
            }

            html += '</tbody></table>';

            monthlyBody.innerHTML = html;

            // Footer visibility
            var footer = document.getElementById('jwl-monthly-footer');
            if (footer) {
                footer.style.display = (showRcp || showIai) ? '' : 'none';
            }

            // Dynamic panel width
            var panelWidth = 380 + (showRcp ? 120 : 0) + (showIai ? 120 : 0);
            monthlyPanel.style.width = panelWidth + 'px';

            // Reset refresh button
            var refreshBtn = document.getElementById('jwl-refresh-rcp');
            if (refreshBtn) {
                refreshBtn.textContent = '\u21BB Od\u015bwie\u017c dane RCP';
                refreshBtn.disabled = false;
            }
        }

        // Sprawdz czy zadanie jest dostepne w dropdownie na biezacej stronie
        function isTaskOnCurrentPage(taskKey) {
            for (var i = 0; i < selectEl.options.length; i++) {
                if (selectEl.options[i].value === taskKey) return true;
            }
            return false;
        }

        // Timer display updater
        const fabBadge = document.getElementById('jwl-fab-badge');
        const remoteBanner = document.getElementById('jwl-remote-timer-banner');
        var lastTickMs = Date.now();

        function updateTimerDisplay() {
            // Detekcja uspienia: jesli od ostatniego ticku minelo > 2min, komputer spal
            var now = Date.now();
            var tickGap = now - lastTickMs;
            lastTickMs = now;

            const state = getTimerState();

            if (state && state.running && tickGap > SLEEP_THRESHOLD_MS) {
                // Komputer wrocil z uspienia — auto-stop na moment ostatniego heartbeatu
                var stopAt = getLastHeartbeat() || (now - tickGap);
                var elapsed = Math.floor((stopAt - state.startTime) / 1000);
                if (elapsed < 0) elapsed = 0;

                state.running = false;
                state.endTime = stopAt;
                state.elapsedSeconds = elapsed;
                state.autoStopped = true;
                state.autoStopReason = 'sleep';
                setTimerState(state);

                clearInterval(timerInterval);
                timerInterval = null;
                elapsedAtStop = elapsed;

                if (isTaskOnCurrentPage(state.taskKey)) {
                    setDateTimeFields(state.startTime, stopAt);
                    selectEl.disabled = false;
                    btnStop.disabled = true;
                }

                showStatus(
                    '\u26a0\ufe0f Timer auto-zatrzymany (wykryto u\u015bpienie komputera). Czas pracy: ' + formatTime(elapsed),
                    'warning', true
                );
                // Przejdz do renderowania stanu "zatrzymany" ponizej
            }

            // Aktualizuj heartbeat gdy timer dziala
            if (state && state.running) {
                updateHeartbeat();
            }

            if (state && state.running) {
                const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
                const isLocal = isTaskOnCurrentPage(state.taskKey);

                // FAB: zawsze pulsuje gdy timer dziala (globalnie)
                fab.classList.add('running');
                fab.title = `${state.taskKey} - ${formatTime(elapsed)}`;
                fabBadge.textContent = formatTime(elapsed).substring(0, 5);
                fabBadge.classList.add('visible');

                if (isLocal) {
                    // Timer na zadaniu z biezacej strony — pelna obsluga
                    remoteBanner.style.display = 'none';
                    timerTimeEl.textContent = formatTime(elapsed);
                    timerTimeEl.classList.add('running');
                    timerTaskEl.textContent = `${state.taskKey} - ${state.taskDesc || ''}`;
                    timerStartedEl.textContent = `Start: ${formatDateTime(state.startTime)}`;
                    btnStart.disabled = true;
                    btnStop.disabled = false;
                    selectEl.disabled = true;
                    if (selectEl.value !== state.taskKey) {
                        selectEl.value = state.taskKey;
                        updateJiraLink();
                    }
                } else {
                    // Timer dziala na innym komunikacie — pokaz banner, nie przejmuj panelu
                    const jiraLink = JIRA_BASE_URL + '/browse/' + state.taskKey;
                    remoteBanner.innerHTML = '\u26a0\ufe0f Timer dzia\u0142a na innym zadaniu: <a href="' + jiraLink + '" target="_blank">' + esc(state.taskKey) + '</a>' +
                        (state.taskDesc ? ' \u2014 ' + esc(state.taskDesc.substring(0, 60)) : '') +
                        '<br><span class="jwl-remote-time">' + formatTime(elapsed) + '</span> (od ' + formatDateTime(state.startTime) + ')' +
                        '<br>Zako\u0144cz tamto zadanie (STOP) aby wystartowa\u0107 nowe.';
                    remoteBanner.style.display = 'block';
                    timerTimeEl.classList.remove('running');
                    timerTimeEl.textContent = '00:00:00';
                    timerTaskEl.textContent = 'Wybierz zadanie i kliknij START';
                    timerStartedEl.textContent = '';
                    btnStart.disabled = true;
                    btnStop.disabled = true;
                    selectEl.disabled = false;
                }
            } else {
                remoteBanner.style.display = 'none';
                timerTimeEl.classList.remove('running');
                if (elapsedAtStop > 0) {
                    timerTimeEl.textContent = formatTime(elapsedAtStop);
                }
                btnStart.disabled = false;
                // FAB: back to normal
                fab.classList.remove('running');
                fab.title = 'JIRA Worklog Timer';
                fabBadge.classList.remove('visible');
            }
        }

        // Detekcja powrotu z uspienia przez visibilitychange
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                var state = getTimerState();
                if (state && state.running) {
                    // Sprawdz gap od ostatniego heartbeatu
                    var gap = Date.now() - getLastHeartbeat();
                    if (gap > SLEEP_THRESHOLD_MS) {
                        // Wymus tick z duzym gapem — updateTimerDisplay wykryje uspienie
                        lastTickMs = getLastHeartbeat();
                    }
                    updateTimerDisplay();
                } else if (state && state.autoStopped) {
                    // Timer byl auto-zatrzymany (moze z innej karty) — odswierz UI
                    updateTimerDisplay();
                }
            }
        });

        // Przy starcie: sprawdz czy timer nie powinien byc auto-zatrzymany (np. komputer spal)
        var sleepDetected = checkSleepAndAutoStop();

        // Restore running timer if any
        const savedState = getTimerState();
        if (savedState && savedState.running) {
            updateHeartbeat(); // pierwszy heartbeat
            if (isTaskOnCurrentPage(savedState.taskKey)) {
                // Timer na zadaniu z biezacej strony — przywroc pelny stan
                setDateTimeFields(savedState.startTime, null);
                dtStopDate.value = '';
                dtStopTime.value = '';
            }
            // Zawsze startuj interval (banner lub timer)
            timerInterval = setInterval(updateTimerDisplay, 1000);
            updateTimerDisplay();
        } else if (savedState && !savedState.running && savedState.startTime && savedState.endTime) {
            if (isTaskOnCurrentPage(savedState.taskKey)) {
                // Timer zatrzymany na zadaniu z biezacej strony - przywroc oba pola
                setDateTimeFields(savedState.startTime, savedState.endTime);
                elapsedAtStop = savedState.elapsedSeconds || Math.floor((savedState.endTime - savedState.startTime) / 1000);
                timerTimeEl.textContent = formatTime(elapsedAtStop);
            }
            if (savedState.autoStopped && sleepDetected) {
                showStatus(
                    '\u26a0\ufe0f Timer zosta\u0142 auto-zatrzymany (u\u015bpienie komputera). Czas pracy: ' + formatTime(savedState.elapsedSeconds || 0),
                    'warning', true
                );
            }
        }

        // START
        btnStart.addEventListener('click', () => {
            const key = selectEl.value;
            if (!key) {
                showStatus('Wybierz zadanie!', 'error');
                return;
            }

            // Sprawdz czy inny timer juz dziala
            const existingState = getTimerState();
            if (existingState && existingState.running) {
                const runningKey = existingState.taskKey;
                if (runningKey !== key) {
                    const elapsed = Math.floor((Date.now() - existingState.startTime) / 1000);
                    const jiraLink = JIRA_BASE_URL + '/browse/' + runningKey;
                    showStatus(
                        '\u26a0\ufe0f Uwaga! Timer ju\u017c dzia\u0142a dla <a href="' + jiraLink + '" target="_blank">' + esc(runningKey) + '</a> (' + formatTime(elapsed) + '). ' +
                        'Zako\u0144cz najpierw tamto zadanie (STOP) aby m\u00f3c wystartowa\u0107 nowe.',
                        'warning', true
                    );
                    return;
                }
            }

            const selectedOption = selectEl.options[selectEl.selectedIndex];
            const taskDesc = selectedOption ? selectedOption.textContent : '';

            var now = Date.now();
            const state = {
                running: true,
                startTime: now,
                taskKey: key,
                taskDesc: taskDesc
            };
            setTimerState(state);
            updateHeartbeat();
            lastTickMs = Date.now();
            elapsedAtStop = 0;

            // Ustaw pola start, wyczysc stop i czas
            _syncLock = true;
            tsToFields(now, dtStartDate, dtStartTime);
            dtStopDate.value = '';
            dtStopTime.value = '';
            dtDurH.value = 0;
            dtDurM.value = 0;
            updateCalcLabel();
            _syncLock = false;

            btnStart.disabled = true;
            btnStop.disabled = false;
            selectEl.disabled = true;

            timerInterval = setInterval(updateTimerDisplay, 1000);
            updateTimerDisplay();
            showStatus(`Timer uruchomiony dla ${key}`, 'info');
        });

        // STOP
        btnStop.addEventListener('click', () => {
            const state = getTimerState();
            if (!state || !state.running) return;

            var now = Date.now();
            elapsedAtStop = Math.floor((now - state.startTime) / 1000);

            state.running = false;
            state.endTime = now;
            state.elapsedSeconds = elapsedAtStop;
            setTimerState(state);

            clearInterval(timerInterval);
            timerInterval = null;

            btnStart.disabled = false;
            btnStop.disabled = true;
            selectEl.disabled = false;

            timerTimeEl.classList.remove('running');
            timerTimeEl.textContent = formatTime(elapsedAtStop);

            // Wypelnij pola daty/czasu start i stop
            setDateTimeFields(state.startTime, now);

            timerStartedEl.textContent = `${formatDateTime(state.startTime)} - ${formatDateTime(now)}`;

            showStatus(`Zatrzymano: ${formatTime(elapsedAtStop)}`, 'info');
        });

        // SEND WORKLOG (via Tempo API)
        btnSend.addEventListener('click', () => {
            if (!_wmOk()) { showStatus('B\u0142\u0105d konfiguracji', 'error'); return; }
            const creds = getCredentials();
            if (!creds.tempoToken) {
                showStatus('Najpierw skonfiguruj Tempo API token (ikona \u2699)', 'error');
                showSettingsModal();
                return;
            }
            if (!creds.email || !creds.token) {
                showStatus('Najpierw skonfiguruj email i token JIRA (ikona \u2699)', 'error');
                showSettingsModal();
                return;
            }

            const key = selectEl.value;
            if (!key) {
                showStatus('Wybierz zadanie!', 'error');
                return;
            }

            // Determine time to log - z pol daty/czasu lub pola czasu
            var sDate = dtStartDate.value;
            var sTime = dtStartTime.value;
            var eDate = dtStopDate.value;
            var eTime = dtStopTime.value;
            var durSec = getDurSec();

            if (!sDate || !sTime) {
                showStatus('Uzupe\u0142nij dat\u0119 i godzin\u0119 startu!', 'error');
                return;
            }

            var timeSeconds = 0;
            if (sDate && sTime && eDate && eTime) {
                // Start + Stop -> oblicz roznice
                var startMs = new Date(sDate + 'T' + sTime).getTime();
                var stopMs = new Date(eDate + 'T' + eTime).getTime();
                timeSeconds = Math.floor((stopMs - startMs) / 1000);
            } else if (durSec > 0) {
                // Tylko start + czas przepracowany
                timeSeconds = durSec;
            }

            if (timeSeconds < 60) {
                showStatus('Minimalny czas workloga to 1 minuta! Uzupe\u0142nij czas lub stop.', 'error');
                return;
            }

            const comment = worklogDesc.value.trim();

            // Data i czas startu z pol formularza
            const startDate = sDate; // YYYY-MM-DD
            const startTime = sTime + ':00'; // HH:MM:SS

            btnSend.disabled = true;
            btnSend.textContent = 'Wysy\u0142anie...';

            // Helper: send worklog to Tempo (needs numeric issueId)
            function sendToTempo(accountId, issueId) {
                const tempoData = {
                    issueId: issueId,
                    timeSpentSeconds: timeSeconds,
                    startDate: startDate,
                    startTime: startTime,
                    description: comment || '',
                    authorAccountId: accountId
                };

                showStatus(`Wysy\u0142am ${formatTime(timeSeconds)} do Tempo (${key}, id:${issueId})...`, 'info');

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: `${TEMPO_API_URL}/worklogs`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + creds.tempoToken
                    },
                    data: JSON.stringify(tempoData),
                    onload: function(response) {
                        btnSend.disabled = false;
                        btnSend.textContent = '\u2191 Wy\u015blij worklog do JIRA (Tempo)';

                        if (response.status >= 200 && response.status < 300) {
                            showStatus(`Worklog wys\u0142any! ${formatTime(timeSeconds)} -> ${key}`, 'success');
                            // Reset
                            clearTimerState();
                            elapsedAtStop = 0;
                            timerTimeEl.textContent = '00:00:00';
                            timerTaskEl.textContent = 'Wybierz zadanie i kliknij START';
                            timerStartedEl.textContent = '';
                            worklogDesc.value = '';
                            dtStartDate.value = '';
                            dtStartTime.value = '';
                            dtStopDate.value = '';
                            dtStopTime.value = '';
                            dtDurH.value = 0;
                            dtDurM.value = 0;
                            dtCalc.textContent = '0h 0m';
                            // Auto-refresh worklog history + time tracking
                            setTimeout(loadWorklogs, 1000);
                            // Wyczysc cache trackingu i monthly zeby przeladowal z aktualnymi danymi
                            delete trackingCache[key];
                            monthlyCache = {};
                            setTimeout(function() { loadTimeTracking(key); }, 1500);
                            // Odswierz panel miesieczny jesli otwarty
                            if (monthlyPanel.classList.contains('open')) {
                                setTimeout(loadMonthlyData, 2000);
                            }
                        } else {
                            let errMsg = `Tempo b\u0142\u0105d ${response.status}`;
                            try {
                                const errData = JSON.parse(response.responseText);
                                if (errData.errors) {
                                    errMsg += ': ' + errData.errors.map(e => e.message || JSON.stringify(e)).join(', ');
                                } else if (errData.message) {
                                    errMsg += ': ' + errData.message;
                                }
                            } catch(e) {
                                errMsg += ': ' + response.responseText.substring(0, 200);
                            }
                            showStatus(errMsg, 'error');
                        }
                    },
                    onerror: function() {
                        btnSend.disabled = false;
                        btnSend.textContent = '\u2191 Wy\u015blij worklog do JIRA (Tempo)';
                        showStatus('B\u0142\u0105d po\u0142\u0105czenia z Tempo API!', 'error');
                    }
                });
            }

            // Step 1: ensure accountId, Step 2: fetch issueId, Step 3: send to Tempo
            function proceedWithAccountId(accountId) {
                showStatus(`Pobieram issueId dla ${key}...`, 'info');
                fetchIssueId(key, creds.email, creds.token, function(err, issueId) {
                    if (err) {
                        btnSend.disabled = false;
                        btnSend.textContent = '\u2191 Wy\u015blij worklog do JIRA (Tempo)';
                        showStatus('B\u0142\u0105d pobrania issueId: ' + err, 'error');
                        return;
                    }
                    sendToTempo(accountId, issueId);
                });
            }

            if (creds.accountId) {
                proceedWithAccountId(creds.accountId);
            } else {
                showStatus('Pobieram accountId z JIRA...', 'info');
                fetchAccountId(creds.email, creds.token, function(err, accountId) {
                    if (err) {
                        btnSend.disabled = false;
                        btnSend.textContent = '\u2191 Wy\u015blij worklog do JIRA (Tempo)';
                        showStatus(err, 'error');
                        return;
                    }
                    proceedWithAccountId(accountId);
                });
            }
        });

        function showStatus(msg, type, isHtml) {
            if (isHtml) {
                statusEl.innerHTML = msg;
            } else {
                statusEl.textContent = msg;
            }
            statusEl.className = 'jwl-status ' + type;
            if (type === 'success' || type === 'info') {
                setTimeout(() => { statusEl.className = 'jwl-status'; }, 5000);
            }
        }

        // ========== WORKLOG HISTORY ==========
        const historyToggle = document.getElementById('jwl-history-toggle');
        const historyArrow = document.getElementById('jwl-history-arrow');
        const historyList = document.getElementById('jwl-history-list');
        const btnRefreshWl = document.getElementById('jwl-btn-refresh-wl');

        // Toggle history section
        historyToggle.addEventListener('click', (e) => {
            if (e.target.closest('.jwl-wl-btn-refresh')) return; // don't toggle on refresh click
            historyList.classList.toggle('open');
            historyArrow.classList.toggle('open');
        });

        // Refresh button
        btnRefreshWl.addEventListener('click', (e) => {
            e.stopPropagation();
            loadWorklogs();
        });

        // Auto-load worklogs when task changes
        selectEl.addEventListener('change', () => {
            if (historyList.classList.contains('open')) {
                loadWorklogs();
            }
        });

        function loadWorklogs() {
            const creds = getCredentials();
            const key = selectEl.value;
            if (!key) {
                historyList.innerHTML = '<div class="jwl-wl-empty">Wybierz zadanie</div>';
                return;
            }
            if (!creds.tempoToken || !creds.email || !creds.token) {
                historyList.innerHTML = '<div class="jwl-wl-empty">Skonfiguruj tokeny w Ustawieniach</div>';
                return;
            }

            historyList.innerHTML = '<div class="jwl-wl-loading">\u0141adowanie worklog\u00f3w...</div>';
            if (!historyList.classList.contains('open')) {
                historyList.classList.add('open');
                historyArrow.classList.add('open');
            }

            // First get issueId
            fetchIssueId(key, creds.email, creds.token, function(err, issueId) {
                if (err) {
                    historyList.innerHTML = '<div class="jwl-wl-empty">B\u0142\u0105d:' + err + '</div>';
                    return;
                }
                // Then fetch worklogs
                var wlLimit = creds.worklogLimit || 3;
                fetchTempoWorklogs(issueId, creds.tempoToken, wlLimit, function(err2, worklogs) {
                    if (err2) {
                        historyList.innerHTML = '<div class="jwl-wl-empty">B\u0142\u0105d:' + err2 + '</div>';
                        return;
                    }
                    renderWorklogs(worklogs, issueId, creds);
                });
            });
        }

        function renderWorklogs(worklogs, issueId, creds) {
            if (!worklogs || worklogs.length === 0) {
                historyList.innerHTML = '<div class="jwl-wl-empty">Brak worklog\u00f3w dla tego zadania</div>';
                return;
            }

            // Sort by startDate+startTime descending (newest first), take last 5
            worklogs.sort((a, b) => {
                const da = (a.startDate || '') + (a.startTime || '');
                const db = (b.startDate || '') + (b.startTime || '');
                return db.localeCompare(da);
            });
            var wlLimit = creds.worklogLimit || 3;
            const recentWorklogs = worklogs.slice(0, wlLimit);

            const currentAccountId = creds.accountId;

            // Helper: oblicz endTime (HH:MM) z startTime + seconds
            function calcEndTime(sDate, sTime, seconds) {
                if (!sDate || !sTime || !seconds) return '';
                var ms = new Date(sDate + 'T' + sTime).getTime();
                if (isNaN(ms)) return '';
                var end = new Date(ms + seconds * 1000);
                return String(end.getHours()).padStart(2,'0') + ':' + String(end.getMinutes()).padStart(2,'0');
            }

            historyList.innerHTML = '';
            recentWorklogs.forEach(wl => {
                const wlId = wl.tempoWorklogId;
                const authorId = wl.author ? wl.author.accountId : '';
                const authorName = wl.author ? wl.author.displayName : 'Nieznany';
                const isMine = currentAccountId && authorId === currentAccountId;
                const seconds = wl.timeSpentSeconds || 0;
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const desc = wl.description || '';
                const startDate = wl.startDate || '';
                const startTime = wl.startTime || '';
                const startTimeShort = startTime ? startTime.substring(0, 5) : '';
                const endTimeShort = calcEndTime(startDate, startTime, seconds);

                const item = document.createElement('div');
                item.className = 'jwl-wl-item' + (isMine ? ' mine' : '');
                item.dataset.wlId = wlId;
                item.dataset.issueId = issueId;
                item.dataset.authorId = authorId;
                item.dataset.origH = h;
                item.dataset.origM = m;
                item.dataset.origDesc = desc;
                item.dataset.startDate = startDate;
                item.dataset.startTime = startTime;

                if (isMine) {
                    item.innerHTML = `
                        <div class="jwl-wl-row" style="gap:4px;flex-wrap:wrap;">
                            <input type="date" class="jwl-wl-sdate" value="${startDate}" data-orig="${startDate}" style="width:105px;padding:2px 3px;border:1px solid #DFE1E6;border-radius:3px;font-size:11px;font-family:inherit;background:#fff;"/>
                            <input type="time" class="jwl-wl-stime" value="${startTimeShort}" data-orig="${startTimeShort}" step="60" style="width:72px;padding:2px 3px;border:1px solid #DFE1E6;border-radius:3px;font-size:11px;font-family:inherit;background:#fff;"/>
                            <span style="font-size:10px;color:#6B778C;">-</span>
                            <input type="time" class="jwl-wl-etime" value="${endTimeShort}" data-orig="${endTimeShort}" step="60" style="width:72px;padding:2px 3px;border:1px solid #DFE1E6;border-radius:3px;font-size:11px;font-family:inherit;background:#fff;"/>
                            <div class="jwl-wl-time-edit" style="margin-left:auto;">
                                <input type="number" class="jwl-wl-h" min="0" max="23" value="${h}" data-orig="${h}"/>
                                <span>h</span>
                                <input type="number" class="jwl-wl-m" min="0" max="59" value="${m}" data-orig="${m}"/>
                                <span>m</span>
                            </div>
                        </div>
                        <div class="jwl-wl-row">
                            <div class="jwl-wl-desc-edit">
                                <input type="text" class="jwl-wl-desc" value="${desc.replace(/"/g, '&quot;')}" placeholder="(brak opisu)" data-orig="${desc.replace(/"/g, '&quot;')}"/>
                            </div>
                        </div>
                        <div class="jwl-wl-row jwl-wl-actions">
                            <button class="jwl-wl-btn jwl-wl-btn-save" title="Zapisz zmiany">Zapisz</button>
                            <button class="jwl-wl-btn jwl-wl-btn-del" title="Usu\u0144 worklog">Usu\u0144</button>
                        </div>
                    `;
                } else {
                    item.innerHTML = `
                        <div class="jwl-wl-row">
                            <span class="jwl-wl-date">${startDate}</span>
                            <span style="font-size:10px;color:#6B778C;">${startTimeShort}${endTimeShort ? ' - ' + endTimeShort : ''}</span>
                            <span class="jwl-wl-author">${authorName}</span>
                            <span class="jwl-wl-time-display" style="margin-left:auto;">${h}h ${m}m</span>
                        </div>
                        <div class="jwl-wl-row">
                            <span class="jwl-wl-readonly">${desc || '(brak opisu)'}</span>
                        </div>
                    `;
                }

                historyList.appendChild(item);
            });

            // Attach edit/delete handlers
            historyList.querySelectorAll('.jwl-wl-item.mine').forEach(item => {
                const hInput = item.querySelector('.jwl-wl-h');
                const mInput = item.querySelector('.jwl-wl-m');
                const sdateInput = item.querySelector('.jwl-wl-sdate');
                const stimeInput = item.querySelector('.jwl-wl-stime');
                const etimeInput = item.querySelector('.jwl-wl-etime');
                const descInput = item.querySelector('.jwl-wl-desc');
                const saveBtn = item.querySelector('.jwl-wl-btn-save');
                const delBtn = item.querySelector('.jwl-wl-btn-del');

                var _wlSyncLock = false;

                // Sync: zmiana godziny start/stop -> przelicz czas
                function onWlTimesChanged() {
                    if (_wlSyncLock) return;
                    _wlSyncLock = true;
                    if (sdateInput.value && stimeInput.value && etimeInput.value) {
                        var sMs = new Date(sdateInput.value + 'T' + stimeInput.value).getTime();
                        var eMs = new Date(sdateInput.value + 'T' + etimeInput.value).getTime();
                        var diff = Math.max(0, Math.floor((eMs - sMs) / 1000));
                        hInput.value = Math.floor(diff / 3600);
                        mInput.value = Math.floor((diff % 3600) / 60);
                    }
                    _wlSyncLock = false;
                    checkChanges();
                }

                // Sync: zmiana czasu h/m -> przelicz godzine stop
                function onWlDurationChanged() {
                    if (_wlSyncLock) return;
                    _wlSyncLock = true;
                    if (sdateInput.value && stimeInput.value) {
                        var sMs = new Date(sdateInput.value + 'T' + stimeInput.value).getTime();
                        var durSec = ((parseInt(hInput.value) || 0) * 3600) + ((parseInt(mInput.value) || 0) * 60);
                        if (durSec > 0) {
                            var end = new Date(sMs + durSec * 1000);
                            etimeInput.value = String(end.getHours()).padStart(2,'0') + ':' + String(end.getMinutes()).padStart(2,'0');
                        }
                    }
                    _wlSyncLock = false;
                    checkChanges();
                }

                stimeInput.addEventListener('change', onWlTimesChanged);
                etimeInput.addEventListener('change', onWlTimesChanged);
                sdateInput.addEventListener('change', onWlTimesChanged);
                hInput.addEventListener('input', onWlDurationChanged);
                mInput.addEventListener('input', onWlDurationChanged);

                // Show save button when something changes
                function checkChanges() {
                    const changed = hInput.value !== hInput.dataset.orig ||
                                    mInput.value !== mInput.dataset.orig ||
                                    sdateInput.value !== sdateInput.dataset.orig ||
                                    stimeInput.value !== stimeInput.dataset.orig ||
                                    etimeInput.value !== etimeInput.dataset.orig ||
                                    descInput.value !== descInput.dataset.orig;
                    saveBtn.classList.toggle('visible', changed);
                }
                descInput.addEventListener('input', checkChanges);

                // Save
                saveBtn.addEventListener('click', () => {
                    const wlId = item.dataset.wlId;
                    const newH = parseInt(hInput.value) || 0;
                    const newM = parseInt(mInput.value) || 0;
                    const newSeconds = newH * 3600 + newM * 60;
                    const newDesc = descInput.value;
                    const newStartDate = sdateInput.value;
                    const newStartTime = stimeInput.value ? stimeInput.value + ':00' : '09:00:00';

                    if (newSeconds < 60) {
                        showStatus('Min. czas workloga to 1 minuta!', 'error');
                        return;
                    }

                    saveBtn.textContent = '...';
                    saveBtn.disabled = true;

                    const updateData = {
                        issueId: parseInt(item.dataset.issueId),
                        timeSpentSeconds: newSeconds,
                        startDate: newStartDate,
                        startTime: newStartTime,
                        description: newDesc,
                        authorAccountId: item.dataset.authorId
                    };

                    updateTempoWorklog(wlId, updateData, creds.tempoToken, function(err) {
                        saveBtn.textContent = 'Zapisz';
                        saveBtn.disabled = false;
                        if (err) {
                            showStatus('B\u0142\u0105d edycji: ' + err, 'error');
                        } else {
                            showStatus('Worklog zaktualizowany!', 'success');
                            hInput.dataset.orig = String(newH);
                            mInput.dataset.orig = String(newM);
                            sdateInput.dataset.orig = newStartDate;
                            stimeInput.dataset.orig = stimeInput.value;
                            etimeInput.dataset.orig = etimeInput.value;
                            descInput.dataset.orig = newDesc;
                            saveBtn.classList.remove('visible');
                        }
                    });
                });

                // Delete
                delBtn.addEventListener('click', () => {
                    if (!confirm('Na pewno usun\u0105\u0107 ten worklog?\n' + item.dataset.startDate + ' ' + hInput.value + 'h ' + mInput.value + 'm')) {
                        return;
                    }
                    delBtn.textContent = '...';
                    delBtn.disabled = true;

                    deleteTempoWorklog(item.dataset.wlId, creds.tempoToken, function(err) {
                        if (err) {
                            delBtn.textContent = 'Usu\u0144';
                            delBtn.disabled = false;
                            showStatus('B\u0142\u0105d usuwania: ' + err, 'error');
                        } else {
                            item.remove();
                            showStatus('Worklog usuni\u0119ty!', 'success');
                            if (historyList.querySelectorAll('.jwl-wl-item').length === 0) {
                                historyList.innerHTML = '<div class="jwl-wl-empty">Brak worklog\u00f3w</div>';
                            }
                        }
                    });
                });
            });
        }

        // Check if no tasks found
        if (tasks.length === 0) {
            selectEl.innerHTML = '<option value="">-- Brak zada\u0144 JIRA na tej stronie --</option>';
            btnStart.disabled = true;
        }
    }

    // ========== SETTINGS MODAL ==========
    function showSettingsModal() {
        const creds = getCredentials();

        // Snapshot for cancel
        var origSettings = {
            showWeekends: creds.showWeekends !== false,
            enovaEnabled: !!creds.enovaEnabled,
            showRcpEnova: creds.showRcpEnova !== false,
            showRcpIai: creds.showRcpIai !== false,
            rcpEnovaMode: creds.rcpEnovaMode || 'hours',
            rcpIaiMode: creds.rcpIaiMode || 'hours'
        };

        const overlay = document.createElement('div');
        overlay.className = 'jwl-overlay';

        var modalHtml = '<div class="jwl-modal" style="max-height:90vh;overflow-y:auto;">';
        modalHtml += '<h3>\u2699 Ustawienia JIRA + Tempo</h3>';

        // JIRA tokens
        modalHtml += '<div class="jwl-modal-field">';
        modalHtml += '<label>E-mail konta Atlassian</label>';
        modalHtml += '<input type="email" id="jwl-cfg-email" value="' + (creds.email || '') + '" placeholder="twoj.email@firma.com"/>';
        modalHtml += '</div>';

        modalHtml += '<div class="jwl-modal-field">';
        modalHtml += '<label>JIRA API Token (<a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" style="color:#0052CC">wygeneruj tutaj</a>)</label>';
        modalHtml += '<input type="password" id="jwl-cfg-token" value="' + (creds.token || '') + '" placeholder="Token JIRA (do pobrania accountId)"/>';
        modalHtml += '</div>';

        modalHtml += '<div class="jwl-modal-field">';
        modalHtml += '<label>Tempo API Token (<a href="' + JIRA_BASE_URL + '/plugins/servlet/ac/io.tempo.jira/tempo-app#!/configuration/api-integration" target="_blank" style="color:#0052CC">wygeneruj w Tempo</a>)</label>';
        modalHtml += '<input type="password" id="jwl-cfg-tempo" value="' + (creds.tempoToken || '') + '" placeholder="Token Tempo (do wysy\u0142ania worklog\u00f3w)"/>';
        modalHtml += '</div>';

        // Account ID
        modalHtml += '<div class="jwl-modal-field">';
        if (creds.accountId) {
            modalHtml += '<label>Account ID <span style="color:#00875A;">(pobrano: ' + creds.accountId + ')</span></label>';
        } else {
            modalHtml += '<label>Account ID <span style="color:#97A0AF;">(zostanie pobrany automatycznie)</span></label>';
        }
        modalHtml += '</div>';

        // Worklog limit
        modalHtml += '<div class="jwl-modal-field">';
        modalHtml += '<label>Liczba ostatnich worklog\u00f3w do wy\u015bwietlenia</label>';
        modalHtml += '<input type="number" id="jwl-cfg-wl-limit" min="1" max="50" value="' + (creds.worklogLimit || 3) + '" style="width:80px;"/>';
        modalHtml += '</div>';

        // Calendar settings section
        modalHtml += '<div style="border-top:1px solid #DFE1E6;margin:16px 0 12px;padding-top:12px;">';
        modalHtml += '<div style="font-weight:700;font-size:13px;color:#172B4D;margin-bottom:12px;">Ustawienia kalendarza</div>';

        // Show weekends switch
        modalHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
        modalHtml += '<span style="font-size:12px;color:#172B4D;">Pokazuj weekendy</span>';
        modalHtml += '<label class="jwl-switch"><input type="checkbox" id="jwl-cfg-show-weekends" ' + (creds.showWeekends !== false ? 'checked' : '') + '/><span class="jwl-switch-slider"></span></label>';
        modalHtml += '</div>';

        // RCP Enova switch
        modalHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        modalHtml += '<span style="font-size:12px;color:#172B4D;">RCP enova</span>';
        modalHtml += '<label class="jwl-switch"><input type="checkbox" id="jwl-cfg-enova-enabled" ' + (creds.enovaEnabled ? 'checked' : '') + '/><span class="jwl-switch-slider"></span></label>';
        modalHtml += '</div>';

        // Enova expanded settings
        modalHtml += '<div id="jwl-cfg-enova-details" style="margin-left:16px;margin-bottom:10px;padding:8px;background:#F4F5F7;border-radius:6px;' + (creds.enovaEnabled ? '' : 'display:none;') + '">';
        modalHtml += '<div style="margin-bottom:6px;"><label style="font-size:11px;color:#6B778C;">Tryb wy\u015bwietlania</label>';
        modalHtml += '<select id="jwl-cfg-rcp-enova-mode" style="width:100%;padding:4px 6px;border:1px solid #DFE1E6;border-radius:4px;font-size:12px;">';
        modalHtml += '<option value="hours"' + (creds.rcpEnovaMode === 'hours' || !creds.rcpEnovaMode ? ' selected' : '') + '>Godzina wej\u015bcia / wyj\u015bcia</option>';
        modalHtml += '<option value="total"' + (creds.rcpEnovaMode === 'total' ? ' selected' : '') + '>\u0141\u0105czny zapisany czas</option>';
        modalHtml += '</select></div>';
        modalHtml += '<div class="jwl-modal-field" style="margin-bottom:4px;"><label style="font-size:11px;color:#6B778C;">Login enova</label>';
        modalHtml += '<input type="text" id="jwl-cfg-enova-login" value="' + GM_getValue(STORAGE_KEY_PREFIX + 'enovaLogin', '') + '" placeholder="nazwa u\u017Cytkownika enova" style="font-size:12px;padding:4px 8px;"/></div>';
        modalHtml += '<div class="jwl-modal-field" style="margin-bottom:4px;"><label style="font-size:11px;color:#6B778C;">Has\u0142o enova</label>';
        modalHtml += '<input type="password" id="jwl-cfg-enova-password" value="' + (GM_getValue(STORAGE_KEY_PREFIX + 'enovaPassword', '') ? '********' : '') + '" placeholder="has\u0142o do enova" style="font-size:12px;padding:4px 8px;"/></div>';
        modalHtml += '<div style="font-size:10px;color:#6b7280;margin-top:4px;">Context Handle: ' + (creds.enovaContextHandle ? '<span style="color:#00875A;">' + creds.enovaContextHandle + ' \u2014 auto-sync</span>' : '<span style="color:#97A0AF;">auto \u2014 po zalogowaniu</span>') + '</div>';
        modalHtml += '<div style="font-size:10px;color:#97A0AF;margin-top:2px;">Wymaga aktywnego VPN.</div>';
        modalHtml += '</div>';

        // RCP IAI switch
        modalHtml += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        modalHtml += '<span style="font-size:12px;color:#172B4D;">RCP IAI</span>';
        modalHtml += '<label class="jwl-switch"><input type="checkbox" id="jwl-cfg-show-rcp-iai" ' + (creds.showRcpIai !== false ? 'checked' : '') + '/><span class="jwl-switch-slider"></span></label>';
        modalHtml += '</div>';

        // IAI expanded settings
        modalHtml += '<div id="jwl-cfg-iai-details" style="margin-left:16px;margin-bottom:10px;' + (creds.showRcpIai !== false ? '' : 'display:none;') + '">';
        modalHtml += '<div style="margin-bottom:6px;"><label style="font-size:11px;color:#6B778C;">Tryb wy\u015bwietlania</label>';
        modalHtml += '<select id="jwl-cfg-rcp-iai-mode" style="width:100%;padding:4px 6px;border:1px solid #DFE1E6;border-radius:4px;font-size:12px;">';
        modalHtml += '<option value="hours"' + (creds.rcpIaiMode === 'hours' || !creds.rcpIaiMode ? ' selected' : '') + '>Godzina wej\u015bcia / wyj\u015bcia</option>';
        modalHtml += '<option value="total"' + (creds.rcpIaiMode === 'total' ? ' selected' : '') + '>\u0141\u0105czny zapisany czas</option>';
        modalHtml += '</select></div>';
        modalHtml += '</div>';

        modalHtml += '</div>'; // end calendar settings section

        // Actions
        modalHtml += '<div class="jwl-modal-actions">';
        modalHtml += '<button class="jwl-btn jwl-btn-settings" id="jwl-cfg-test">Testuj po\u0142\u0105czenie</button>';
        modalHtml += '<button class="jwl-btn jwl-btn-settings" id="jwl-cfg-cancel">Anuluj</button>';
        modalHtml += '<button class="jwl-btn jwl-btn-send" id="jwl-cfg-save">Zapisz</button>';
        modalHtml += '</div>';

        modalHtml += '</div>';
        overlay.innerHTML = modalHtml;
        document.body.appendChild(overlay);

        // Toggle enova details
        document.getElementById('jwl-cfg-enova-enabled').addEventListener('change', function() {
            document.getElementById('jwl-cfg-enova-details').style.display = this.checked ? '' : 'none';
            liveRefreshCalendar();
        });

        // Toggle IAI details
        document.getElementById('jwl-cfg-show-rcp-iai').addEventListener('change', function() {
            document.getElementById('jwl-cfg-iai-details').style.display = this.checked ? '' : 'none';
            liveRefreshCalendar();
        });

        // Live refresh on switch toggle
        document.getElementById('jwl-cfg-show-weekends').addEventListener('change', liveRefreshCalendar);

        function liveRefreshCalendar() {
            // Save switch states immediately for live preview
            GM_setValue(STORAGE_KEY_PREFIX + 'showWeekends', document.getElementById('jwl-cfg-show-weekends').checked);
            GM_setValue(STORAGE_KEY_PREFIX + 'enovaEnabled', document.getElementById('jwl-cfg-enova-enabled').checked);
            GM_setValue(STORAGE_KEY_PREFIX + 'showRcpEnova', document.getElementById('jwl-cfg-enova-enabled').checked);
            GM_setValue(STORAGE_KEY_PREFIX + 'showRcpIai', document.getElementById('jwl-cfg-show-rcp-iai').checked);
            var enovaModeEl = document.getElementById('jwl-cfg-rcp-enova-mode');
            var iaiModeEl = document.getElementById('jwl-cfg-rcp-iai-mode');
            if (enovaModeEl) GM_setValue(STORAGE_KEY_PREFIX + 'rcpEnovaMode', enovaModeEl.value);
            if (iaiModeEl) GM_setValue(STORAGE_KEY_PREFIX + 'rcpIaiMode', iaiModeEl.value);
            // Re-render from cache without re-fetching (no flicker)
            if (_monthlyYear !== null) {
                var ck = _monthlyYear + '-' + String(_monthlyMonth + 1).padStart(2, '0');
                var needRcp = document.getElementById('jwl-cfg-enova-enabled').checked && !rcpCache[ck];
                var needIai = document.getElementById('jwl-cfg-show-rcp-iai').checked && !iaiCache[ck];
                if (needRcp || needIai) {
                    delete monthlyCache[ck];
                    if (_loadMonthlyData) _loadMonthlyData();
                } else if (_renderMonthlyData) {
                    _renderMonthlyData(monthlyCache[ck] || {}, rcpCache[ck] || null, iaiCache[ck] || null);
                }
            }
        }

        // Cancel - restore origSettings
        document.getElementById('jwl-cfg-cancel').addEventListener('click', function() {
            GM_setValue(STORAGE_KEY_PREFIX + 'showWeekends', origSettings.showWeekends);
            GM_setValue(STORAGE_KEY_PREFIX + 'enovaEnabled', origSettings.enovaEnabled);
            GM_setValue(STORAGE_KEY_PREFIX + 'showRcpEnova', origSettings.showRcpEnova);
            GM_setValue(STORAGE_KEY_PREFIX + 'showRcpIai', origSettings.showRcpIai);
            GM_setValue(STORAGE_KEY_PREFIX + 'rcpEnovaMode', origSettings.rcpEnovaMode);
            GM_setValue(STORAGE_KEY_PREFIX + 'rcpIaiMode', origSettings.rcpIaiMode);
            overlay.remove();
            // Refresh calendar if it was changed
            var mp = document.getElementById('jwl-monthly-panel');
            if (mp && mp.classList.contains('open') && _loadMonthlyData) {
                monthlyCache = {};
                _loadMonthlyData();
            }
        });

        // Test connection
        document.getElementById('jwl-cfg-test').addEventListener('click', () => {
            const email = document.getElementById('jwl-cfg-email').value.trim();
            const token = document.getElementById('jwl-cfg-token').value.trim();
            const tempoToken = document.getElementById('jwl-cfg-tempo').value.trim();
            const testBtn = document.getElementById('jwl-cfg-test');
            testBtn.textContent = 'Testuje...';
            testBtn.disabled = true;

            let results = [];
            let done = 0;
            const checkDone = () => {
                done++;
                if (done === 2) {
                    testBtn.textContent = 'Testuj po\u0142\u0105czenie';
                    testBtn.disabled = false;
                    alert(results.join('\n\n'));
                }
            };

            // Test JIRA
            if (email && token) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${JIRA_BASE_URL}/rest/api/2/myself`,
                    headers: {
                        'Authorization': 'Basic ' + btoa(email + ':' + token)
                    },
                    onload: function(r) {
                        if (r.status === 200) {
                            const data = JSON.parse(r.responseText);
                            results.push('JIRA: OK - zalogowano jako ' + data.displayName + ' (accountId: ' + data.accountId + ')');
                            setAccountId(data.accountId);
                        } else {
                            results.push('JIRA: B\u0141\u0104D ' + r.status + ' - sprawd\u017a email i token');
                        }
                        checkDone();
                    },
                    onerror: function() { results.push('JIRA: B\u0141\u0104D po\u0142\u0105czenia'); checkDone(); }
                });
            } else {
                results.push('JIRA: pominiety (brak email/token)');
                checkDone();
            }

            // Test Tempo
            if (tempoToken) {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: `${TEMPO_API_URL}/worklogs?from=2025-01-01&to=2025-01-01&limit=1`,
                    headers: {
                        'Authorization': 'Bearer ' + tempoToken
                    },
                    onload: function(r) {
                        if (r.status === 200) {
                            results.push('Tempo: OK - po\u0142\u0105czenie dzia\u0142a');
                        } else {
                            results.push('Tempo: B\u0141\u0104D ' + r.status + ' - sprawd\u017a token Tempo');
                        }
                        checkDone();
                    },
                    onerror: function() { results.push('Tempo: B\u0141\u0104D po\u0142\u0105czenia'); checkDone(); }
                });
            } else {
                results.push('Tempo: pominiety (brak tokenu)');
                checkDone();
            }
        });

        // Save
        document.getElementById('jwl-cfg-save').addEventListener('click', function() {
            try {
                var email = document.getElementById('jwl-cfg-email').value.trim();
                var token = document.getElementById('jwl-cfg-token').value.trim();
                var tempoToken = document.getElementById('jwl-cfg-tempo').value.trim();
                var wlLimit = parseInt(document.getElementById('jwl-cfg-wl-limit').value) || 3;
                var showWeekends = document.getElementById('jwl-cfg-show-weekends').checked;
                var enovaEnabled = document.getElementById('jwl-cfg-enova-enabled').checked;
                var showRcpIai = document.getElementById('jwl-cfg-show-rcp-iai').checked;
                var rcpEnovaMode = document.getElementById('jwl-cfg-rcp-enova-mode').value;
                var rcpIaiMode = document.getElementById('jwl-cfg-rcp-iai-mode').value;
                var enovaHandle = document.getElementById('jwl-cfg-enova-handle').value.trim();

                if (!email || !token || !tempoToken) {
                    alert('Wszystkie 3 pola s\u0105 wymagane:\n- Email Atlassian\n- JIRA API Token\n- Tempo API Token');
                    return;
                }
                setCredentials(email, token, tempoToken);
                GM_setValue(STORAGE_KEY_PREFIX + 'worklogLimit', Math.max(1, Math.min(50, wlLimit)));
                GM_setValue(STORAGE_KEY_PREFIX + 'showWeekends', showWeekends);
                GM_setValue(STORAGE_KEY_PREFIX + 'enovaEnabled', enovaEnabled);
                GM_setValue(STORAGE_KEY_PREFIX + 'showRcpEnova', enovaEnabled);
                GM_setValue(STORAGE_KEY_PREFIX + 'showRcpIai', showRcpIai);
                GM_setValue(STORAGE_KEY_PREFIX + 'rcpEnovaMode', rcpEnovaMode);
                GM_setValue(STORAGE_KEY_PREFIX + 'rcpIaiMode', rcpIaiMode);
                // Save enova login/password
                var enovaLoginEl = document.getElementById('jwl-cfg-enova-login');
                if (enovaLoginEl) GM_setValue(STORAGE_KEY_PREFIX + 'enovaLogin', enovaLoginEl.value.trim());
                var enovaPwdEl = document.getElementById('jwl-cfg-enova-password');
                var enovaPwd = enovaPwdEl ? enovaPwdEl.value.trim() : '';
                if (enovaPwd && enovaPwd !== '********') GM_setValue(STORAGE_KEY_PREFIX + 'enovaPassword', enovaPwd);

                // Update origSettings
                origSettings.showWeekends = showWeekends;
                origSettings.enovaEnabled = enovaEnabled;
                origSettings.showRcpEnova = enovaEnabled;
                origSettings.showRcpIai = showRcpIai;
                origSettings.rcpEnovaMode = rcpEnovaMode;
                origSettings.rcpIaiMode = rcpIaiMode;

                overlay.remove();

                // Toast
                var toast = document.createElement('div');
                toast.textContent = '\u2713 Zapisano zmiany';
                toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#00875A;color:#fff;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;z-index:100001;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;';
                document.body.appendChild(toast);
                setTimeout(function() { toast.style.opacity = '0'; }, 1500);
                setTimeout(function() { toast.remove(); }, 1900);

                // Reload calendar
                monthlyCache = {};
                var mp = document.getElementById('jwl-monthly-panel');
                if (mp && mp.classList.contains('open') && _loadMonthlyData) {
                    _loadMonthlyData();
                }

                // Auto-fetch accountId if not present
                var curCreds = getCredentials();
                if (!curCreds.accountId) {
                    fetchAccountId(email, token, function(err, accountId) {
                        if (!err && statusEl) {
                            statusEl.textContent = 'AccountId pobrano: ' + accountId;
                            statusEl.className = 'jwl-status success';
                            setTimeout(function() { statusEl.className = 'jwl-status'; }, 4000);
                        }
                    });
                }
            } catch(e) {
                alert('B\u0142\u0105d zapisu ustawie\u0144: ' + e.message);
            }
        });
    }

    // ========== DRAGGABLE ==========
    // Clamp pozycji elementu do widocznego obszaru okna
    function clampToViewport(element) {
        var rect = element.getBoundingClientRect();
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var t = parseInt(element.style.top) || 0;
        var l = parseInt(element.style.left) || 0;
        var w = rect.width || 56;
        var h = rect.height || 56;

        // Nie pozwol wyjsc poza ekran (min 10px widoczne z kazdej strony)
        var minVisible = 10;
        var clampedLeft = Math.max(0, Math.min(l, vw - Math.min(w, minVisible)));
        var clampedTop = Math.max(0, Math.min(t, vh - Math.min(h, minVisible)));

        if (clampedLeft !== l) element.style.left = clampedLeft + 'px';
        if (clampedTop !== t) element.style.top = clampedTop + 'px';

        return { top: clampedTop, left: clampedLeft };
    }

    function makeDraggable(element, handle) {
        let isDragging = false;
        let offsetX, offsetY;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('.jwl-header-btn')) return;
            isDragging = true;
            const rect = element.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            element.style.right = 'auto';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            var rect = element.getBoundingClientRect();
            var w = rect.width;
            var h = rect.height;
            var vw = window.innerWidth;
            var vh = window.innerHeight;

            var x = e.clientX - offsetX;
            var y = e.clientY - offsetY;

            // Clamp do viewportu
            x = Math.max(0, Math.min(x, vw - w));
            y = Math.max(0, Math.min(y, vh - h));

            element.style.left = x + 'px';
            element.style.top = y + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                GM_setValue(STORAGE_KEY_PREFIX + 'position', JSON.stringify({
                    top: parseInt(element.style.top),
                    left: parseInt(element.style.left)
                }));
            }
        });
    }

    // ========== INIT ==========
    var uiBuilt = false;
    var selectElRef = null;

    function init() {
        if (!_wmOk()) { _halt(); return; }
        console.log('[JiraWorklog] init() - parsowanie zadan...');
        var tasks = parseTasks();
        var user = getLoggedInUser();
        console.log('[JiraWorklog] Znaleziono', tasks.length, 'zadan, user:', user);
        buildUI(tasks, user);
        selectElRef = document.getElementById('jwl-task-select');
        uiBuilt = true;
        console.log('[JiraWorklog] UI zbudowane.');

        // Jesli nie znaleziono zadan, obserwuj DOM na pojawienie sie tabeli
        if (tasks.length === 0) {
            console.log('[JiraWorklog] Brak zadan - uruchamiam MutationObserver...');
            watchForTasks();
        }
    }

    function watchForTasks() {
        var found = false;

        function tryParse() {
            if (found) return false;
            var tasks = parseTasks();
            if (tasks.length > 0) {
                found = true;
                console.log('[JiraWorklog] Znaleziono', tasks.length, 'zadan (dynamiczne ladowanie)');
                updateTaskSelect(tasks);
                return true;
            }
            return false;
        }

        // Obserwuj caly body - kontener moze sie pojawic dynamicznie
        // (zarowno #tabWprowadzone z innego skryptu, jak i .divTable z oryginalna tabela)
        var bodyObserver = new MutationObserver(function() {
            if (found) return;
            setTimeout(tryParse, 200);
        });
        bodyObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Polling co 1s jako fallback (max 60s)
        var pollCount = 0;
        var pollInterval = setInterval(function() {
            pollCount++;
            if (found) {
                clearInterval(pollInterval);
                bodyObserver.disconnect();
                return;
            }
            if (pollCount > 60) {
                clearInterval(pollInterval);
                bodyObserver.disconnect();
                console.log('[JiraWorklog] Timeout 60s - brak zadan JIRA');
                return;
            }
            tryParse();
        }, 1000);
    }

    // Aktualizuj dropdown z zadaniami (bez przebudowy calego UI)
    function updateTaskSelect(tasks) {
        if (!selectElRef) return;
        var user = getLoggedInUser();
        var myTasks = [];
        var otherTasks = [];

        if (user) {
            var userName = user.name || '';
            var userEmail = user.email || '';
            var emailPrefix = userEmail.split('@')[0] || '';
            var emailParts = emailPrefix.split('.').map(function(p) { return p.toLowerCase(); });

            tasks.forEach(function(task) {
                var personLower = task.person.toLowerCase();
                var isMyTask = false;
                if (userName) {
                    isMyTask = personLower === userName.toLowerCase();
                }
                if (!isMyTask && emailParts.length >= 2) {
                    var normalizedPerson = personLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    isMyTask = emailParts.every(function(part) { return normalizedPerson.includes(part); });
                }
                if (isMyTask) {
                    myTasks.push(task);
                } else {
                    otherTasks.push(task);
                }
            });
        } else {
            otherTasks = tasks;
        }

        function esc(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        var html = '';
        if (myTasks.length > 0) {
            html += '<optgroup label="&#9654; Moje zadania (' + myTasks.length + ')">';
            myTasks.forEach(function(t) {
                html += '<option value="' + esc(t.key) + '" title="' + esc(t.fullDescription) + '">' +
                    esc(t.key) + ' - ' + esc(t.description.substring(0, 60)) + (t.description.length > 60 ? '...' : '') + '</option>';
            });
            html += '</optgroup>';
        }
        if (otherTasks.length > 0) {
            html += '<optgroup label="&#9655; Pozosta\u0142e zadania (' + otherTasks.length + ')">';
            otherTasks.forEach(function(t) {
                html += '<option value="' + esc(t.key) + '" title="' + esc(t.fullDescription) + ' [' + esc(t.person) + ']">' +
                    esc(t.key) + ' - ' + esc(t.description.substring(0, 50)) + (t.description.length > 50 ? '...' : '') +
                    ' (' + esc(t.person.split(' ')[0]) + ')</option>';
            });
            html += '</optgroup>';
        }
        if (!html) {
            html = '<option value="">-- Brak zada\u0144 JIRA na tej stronie --</option>';
        }

        selectElRef.innerHTML = html;
        var btnStart = document.getElementById('jwl-btn-start');
        if (btnStart) btnStart.disabled = (tasks.length === 0);
        console.log('[JiraWorklog] Selector zaktualizowany:', tasks.length, 'zadan');
    }

    // Wait for DOM to be ready, then init
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('DOMContentLoaded', function() { setTimeout(init, 500); });
    }

})();