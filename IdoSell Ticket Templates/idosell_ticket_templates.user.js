// ==UserScript==
// @name         IdoSell - Szablony odpowiedzi w ticketach
// @namespace    idosell-ticket-templates
// @version      1.1
// @description  System szablonów odpowiedzi i podpisów dla ticketów IdoSell
// @match        *://*.iai-system.com/panel/tickets.php*
// @match        *://*.iai-shop.com/panel/tickets.php*
// @author       Maciej Dobroń <maciej.dobron@gmail.com>
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // Stałe
    // -----------------------------------------------------------------------
    const STORAGE_KEY = 'iai-ticket-templates';
    const DRAFT_PREFIX = 'iai-ticket-draft-';
    const PREFIX = '[TicketTemplates]';
    const ACCENT_COLOR = '#4599DD';
    const ACCENT_HOVER = '#3578b5';
    const DAYS_PL = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
    const CURSOR_MARKER = '{{kursor}}';

    // Zestawy znaków do pickera (źródło: copychar.cc)
    const CHAR_SETS = {
        'Interpunkcja': '– — · • ‣ ⁃ ° ′ ″ ‴ ⁗ § ¶ † ‡ ※ ‼ ⁈ ⁉ ‽ ⸮ ¡ ¿ ⁂ ❧ ☞ ☛ ☜ ☚ ◊ ⁕ ❖ ★ ☆ ✓ ✔ ✕ ✖ ✗ ✘ ✚ ♠ ♣ ♥ ♦ ♤ ♧ ♡ ♢ ☼ ☀ ☁ ☂ ☃ ❄ ❅ ❆ ☽ ☾ ✿ ❀ ❁ ✾ ✽ ❃ ✺ ✲ ✱ ✳ ✴ ✵ ✶ ✷ ✸ ✹ ❇ ❈ ❉ ❊ ❋',
        'Liczby': '⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ⁺ ⁻ ⁼ ⁽ ⁾ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉ ₊ ₋ ₌ ₍ ₎ ½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘ ⅙ ⅚ ⅛ ⅜ ⅝ ⅞ ⅐ ⅑ ⅒ ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ ⑪ ⑫ ⑬ ⑭ ⑮ ⑯ ⑰ ⑱ ⑲ ⑳ Ⅰ Ⅱ Ⅲ Ⅳ Ⅴ Ⅵ Ⅶ Ⅷ Ⅸ Ⅹ Ⅺ Ⅻ',
        'Waluta': '$ € £ ¥ ¢ ₽ ₹ ₱ ₿ ₫ ₴ ₸ ₺ ₼ ₾ ₡ ₣ ₤ ₥ ₦ ₧ ₨ ₩ ₪ ₭ ₮ ₯ ₰ ₲ ₳ ₵ ₶ ₷ ₻',
        'Symbole': '© ® ™ ℠ ℗ ℃ ℉ ° ∞ ♻ ⚠ ☠ ☢ ☣ ♿ ⚡ ✉ ☎ ☏ ✆ ✈ ⚓ ⚔ ⚖ ⚗ ⚙ ⛏ ♲ ♳ ♴ ♵ ♶ ♷ ♸ ♹ ♺ ← → ↑ ↓ ↔ ↕ ⇐ ⇒ ⇑ ⇓ ⇔ ⇕ ☐ ☑ ☒ ✓ ✔ ✗ ✘ ◯ ◉ ● ○ ◌ ■ □ ▪ ▫ ▲ △ ▶ ▷ ▼ ▽ ◀ ◁ ◆ ◇ ♩ ♪ ♫ ♬ ♭ ♮ ♯',
        'Strzałki': '↳ ⤷ ➥ ➦ » ← → ↑ ↓ ↔ ↕ ↖ ↗ ↘ ↙ ↚ ↛ ↜ ↝ ↞ ↟ ↠ ↡ ↢ ↣ ↤ ↥ ↦ ↧ ↨ ↩ ↪ ↫ ↬ ↭ ↮ ↯ ↰ ↱ ↲ ↴ ↵ ↶ ↷ ↸ ↹ ↺ ↻ ⇄ ⇅ ⇆ ⇇ ⇈ ⇉ ⇊ ⇋ ⇌ ⇍ ⇎ ⇏ ⇐ ⇑ ⇒ ⇓ ⇔ ⇕ ⇖ ⇗ ⇘ ⇙ ⇚ ⇛ ⟵ ⟶ ⟷ ⟸ ⟹ ⟺ ➔ ➘ ➙ ➚ ➛ ➜ ➝ ➞ ➟ ➠ ➡ ➢ ➣ ➤ ➧ ➨ ➩ ➪ ➫ ➬ ➭ ➮ ➯ ➱ ➲',
        'Emoji': '💬 🗨 🗯 😀 😁 😂 🤣 😃 😄 😅 😆 😉 😊 😋 😎 😍 😘 🥰 😗 😙 😚 🙂 🤗 🤩 🤔 🤨 😐 😑 😶 🙄 😏 😣 😥 😮 🤐 😯 😪 😫 😴 😌 😛 😜 😝 🤤 😒 😓 😔 😕 🙃 🤑 😲 🙁 😖 😞 😟 😤 😢 😭 😦 😧 😨 😩 🤯 😬 😰 😱 🥵 🥶 😳 🤪 😵 😡 😠 🤬 😷 🤒 🤕 🤢 🤮 🥴 😇 🥳 🥺 🤠 🤡 🤥 🤫 🤭 👋 🤚 🖐 ✋ 🖖 👌 🤞 ✌ 🤟 🤘 🤙 👈 👉 👆 👇 ☝ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 ❤ 🧡 💛 💚 💙 💜 🖤 💔 ❣ 💕 💞 💓 💗 💖 💘 💝 💟 ⭐ 🌟 ✨ ⚡ 🔥 💥 🎉 🎊 🏆 🥇 🥈 🥉 🎯 🎮 🎲 🔔 📌 📎 💡 📝 📊 📈 📉 📁 📂 🗂 📋 📆 📅 ⏰ ⏳ ✅ ❌ ⭕ ❗ ❓ ❕ ❔ 🔴 🟢 🔵 🟡 🟠 🟣 ⚫ ⚪ 🟤'
    };

    // ID ticketu z URL
    const urlParams = new URLSearchParams(window.location.search);
    const TICKET_ID = urlParams.get('ticketId') || '';

    // -----------------------------------------------------------------------
    // Storage — odczyt / zapis / domyślne dane
    // -----------------------------------------------------------------------
    const CATEGORY_COLORS = [
        '#7b8a9a', '#4599DD', '#5cb85c', '#f0ad4e', '#d9534f',
        '#8e44ad', '#2c3e50', '#e67e22', '#1abc9c', '#e74c3c'
    ];

    function getDefaultData() {
        return {
            templates: [],
            signatures: [],
            categories: [],
            settings: {
                uiMode: 'both',       // 'toolbar' | 'fab' | 'both'
                autoAppendSignature: true,
                defaultTemplateId: '',  // '' = brak domyślnego
                autosaveDrafts: true
            }
        };
    }

    // Prototype.js nadpisuje Array.prototype.toJSON, co psuje JSON.stringify.
    // safeStringify tymczasowo usuwa toJSON na czas serializacji.
    function safeStringify(obj, indent) {
        const arrayToJSON = Array.prototype.toJSON;
        const stringToJSON = String.prototype.toJSON;
        delete Array.prototype.toJSON;
        delete String.prototype.toJSON;
        try {
            return JSON.stringify(obj, null, indent);
        } finally {
            if (arrayToJSON) Array.prototype.toJSON = arrayToJSON;
            if (stringToJSON) String.prototype.toJSON = stringToJSON;
        }
    }

    function ensureArray(val) {
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') {
            try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch (e) {}
        }
        if (val && typeof val === 'object') return Object.values(val);
        return [];
    }

    function loadData() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return getDefaultData();
            const parsed = JSON.parse(raw);
            const defaults = getDefaultData();
            return {
                templates: ensureArray(parsed.templates || defaults.templates),
                signatures: ensureArray(parsed.signatures || defaults.signatures),
                categories: ensureArray(parsed.categories || defaults.categories),
                settings: { ...defaults.settings, ...(parsed.settings || {}) }
            };
        } catch (e) {
            console.error(PREFIX, 'Błąd odczytu danych:', e);
            return getDefaultData();
        }
    }

    function saveData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, safeStringify(data));
        } catch (e) {
            console.error(PREFIX, 'Błąd zapisu danych:', e);
            alert('Nie udało się zapisać danych szablonów.');
        }
    }

    function generateId(prefix) {
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }

    // -----------------------------------------------------------------------
    // Szkice (drafty) — zapis per ticket ID w localStorage
    // -----------------------------------------------------------------------
    function saveDraft(ticketId, content) {
        if (!ticketId) return;
        try {
            if (content.trim()) {
                localStorage.setItem(DRAFT_PREFIX + ticketId, content);
            } else {
                localStorage.removeItem(DRAFT_PREFIX + ticketId);
            }
        } catch (e) { /* ignore */ }
    }

    function loadDraft(ticketId) {
        if (!ticketId) return '';
        try {
            return localStorage.getItem(DRAFT_PREFIX + ticketId) || '';
        } catch (e) { return ''; }
    }

    function clearDraft(ticketId) {
        if (!ticketId) return;
        try { localStorage.removeItem(DRAFT_PREFIX + ticketId); } catch (e) { /* ignore */ }
    }

    // -----------------------------------------------------------------------
    // Eksport / Import danych (plik JSON)
    // -----------------------------------------------------------------------
    function exportToFile(data) {
        // Eksport z content jako tablica linii (czytelniejszy format)
        const exportData = {
            _format: 'idosell-ticket-templates-v1',
            _exported: new Date().toISOString(),
            templates: data.templates.map(function (t) {
                var obj = { id: t.id, name: t.name };
                if (t.category) obj.category = t.category;
                obj.content = t.content.split('\n');
                if (t.formSettings) obj.formSettings = t.formSettings;
                obj.createdAt = t.createdAt;
                obj.updatedAt = t.updatedAt;
                return obj;
            }),
            signatures: data.signatures.map(function (s) {
                return {
                    id: s.id,
                    name: s.name,
                    content: s.content.split('\n'),
                    isDefault: !!s.isDefault
                };
            }),
            categories: data.categories,
            settings: data.settings
        };
        const blob = new Blob([safeStringify(exportData, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ticket-templates-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importFromFile() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = () => {
                const file = input.files[0];
                if (!file) return reject(new Error('Nie wybrano pliku'));
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const imported = JSON.parse(reader.result);
                        if (imported._format !== 'idosell-ticket-templates-v1') {
                            return reject(new Error('Nierozpoznany format pliku'));
                        }
                        resolve(imported);
                    } catch (e) {
                        reject(new Error('Błąd parsowania pliku JSON'));
                    }
                };
                reader.onerror = () => reject(new Error('Błąd odczytu pliku'));
                reader.readAsText(file);
            };
            input.click();
        });
    }

    // -----------------------------------------------------------------------
    // Scrapowanie danych ze strony ticketu
    // -----------------------------------------------------------------------
    function scrapeConcernsText() {
        const rows = document.querySelectorAll('#newTicketForm td.tableRowDescription');
        for (const td of rows) {
            if (td.textContent.trim() === 'Concerns') {
                const valueTd = td.nextElementSibling;
                if (!valueTd) return '';
                // Klonuj i zamień <br> na \n — innerText nie zawsze jest wiarygodny
                const clone = valueTd.cloneNode(true);
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                return clone.textContent;
            }
        }
        return '';
    }

    function scrapeConcernsField(fieldLabel) {
        const text = scrapeConcernsText();
        const lines = text.split('\n');
        for (const line of lines) {
            const idx = line.indexOf(fieldLabel + ':');
            if (idx !== -1) {
                return line.substring(idx + fieldLabel.length + 1).trim();
            }
        }
        return '';
    }

    function scrapeCompanyName() {
        const rows = document.querySelectorAll('#newTicketForm td.tableRowDescription');
        for (const td of rows) {
            if (td.textContent.trim() === 'Concerns') {
                const link = td.nextElementSibling.querySelector('a.purelink');
                return link ? link.textContent.trim() : '';
            }
        }
        return '';
    }

    function scrapeClientId() {
        const el = document.getElementById('shop_info_client_id');
        if (el && el.value) return el.value;
        // Fallback: z atrybutu title spana w Concerns
        const rows = document.querySelectorAll('#newTicketForm td.tableRowDescription');
        for (const td of rows) {
            if (td.textContent.trim() === 'Concerns') {
                const shopSpan = td.nextElementSibling.querySelector('span[title*="id klienta"]');
                if (shopSpan) {
                    const match = shopSpan.title.match(/id klienta: (\d+)/);
                    return match ? match[1] : '';
                }
            }
        }
        return '';
    }

    function scrapeTicketId() {
        const el = document.getElementById('fg_ticketId');
        if (el && el.value) return el.value;
        // Fallback: z tekstu na stronie
        const rows = document.querySelectorAll('#newTicketForm td.tableRowDescription');
        for (const td of rows) {
            if (td.textContent.trim() === 'Ticket ID') {
                const text = td.nextElementSibling.textContent.trim();
                return text.replace('#', '');
            }
        }
        return TICKET_ID;
    }

    // -----------------------------------------------------------------------
    // System zmiennych
    // -----------------------------------------------------------------------
    const VARIABLES = {
        'data': {
            label: 'Bieżąca data (DD.MM.YYYY). Dni robocze: {{data+3d}}, tygodnie: {{data+2w}}',
            resolve: () => formatDate(new Date())
        },
        'godzina': {
            label: 'Bieżąca godzina (HH:MM). Z przesunięciem: {{godzina+30m}}, {{godzina+2h}}',
            resolve: () => formatTime(new Date())
        },
        'dzien_tygodnia': {
            label: 'Dzień tygodnia',
            resolve: () => DAYS_PL[new Date().getDay()]
        },
        'podpis': {
            label: 'Domyślny podpis. Po nazwie: {{podpis:Nazwa}}',
            resolve: () => {
                const data = loadData();
                const defaultSig = data.signatures.find(s => s.isDefault);
                return defaultSig ? defaultSig.content : '';
            }
        },
        'firma': {
            label: 'Nazwa firmy klienta',
            resolve: () => scrapeCompanyName()
        },
        'id_klienta': {
            label: 'Identyfikator klienta (np. 56722)',
            resolve: () => scrapeClientId()
        },
        'ticket_id': {
            label: 'Numer ticketu',
            resolve: () => scrapeTicketId()
        },
        'account_manager': {
            label: 'Account Manager',
            resolve: () => scrapeConcernsField('Account Manager')
        },
        'webpage_supervisor': {
            label: 'Webpage supervisor',
            resolve: () => scrapeConcernsField('Webpage supervisor')
        },
        'support_supervisor': {
            label: 'Support supervisor',
            resolve: () => scrapeConcernsField('Support supervisor')
        },
        'plan': {
            label: 'Plan klienta',
            resolve: () => scrapeConcernsField('Plan')
        },
        'kursor': {
            label: 'Pozycja kursora po wstawieniu szablonu',
            resolve: () => CURSOR_MARKER  // zachowaj marker — usuwany dopiero przy wstawianiu
        }
    };

    // Pomocnicze — formatowanie daty i godziny
    function formatDate(d) {
        return String(d.getDate()).padStart(2, '0') + '.'
             + String(d.getMonth() + 1).padStart(2, '0') + '.'
             + d.getFullYear();
    }

    function formatDateYmd(d) {
        return d.getFullYear() + '-'
             + String(d.getMonth() + 1).padStart(2, '0') + '-'
             + String(d.getDate()).padStart(2, '0');
    }

    function formatTime(d) {
        return String(d.getHours()).padStart(2, '0') + ':'
             + String(d.getMinutes()).padStart(2, '0');
    }

    // Przesunięcie daty o X jednostek (dr = dni robocze, dk = dni kalendarzowe,
    // w = tygodnie, d = alias dla dr — zgodność wsteczna)
    function offsetDate(num, unit) {
        var d = new Date();
        var n = parseInt(num, 10);
        if (unit === 'w') {
            d.setDate(d.getDate() + n * 7);
        } else if (unit === 'dk') {
            d.setDate(d.getDate() + n);
        } else {
            // 'dr' lub 'd' (alias wsteczny) — dni robocze, pomija sob/nd
            while (n > 0) {
                d.setDate(d.getDate() + 1);
                var day = d.getDay();
                if (day !== 0 && day !== 6) n--;
            }
        }
        return d;
    }

    // sideEffects (opcjonalny) to obiekt akumulujący efekty uboczne rozwinięcia
    // zmiennych (np. datę do wpisania w pole Reopen). insertTemplate przekazuje
    // obiekt i czyta go po rozwinięciu; podgląd nie przekazuje — brak mutacji formularza.
    function resolveVariables(text, sideEffects) {
        var pass1 = _resolveVariablesOnce(text, sideEffects);
        // Drugi przebieg — pozwala rozwinąć zmienne osadzone w treści podpisu
        // (np. {{data}} w środku {{podpis}}). Cap na 1 dodatkowy pass → brak ryzyka pętli.
        return pass1 !== text ? _resolveVariablesOnce(pass1, sideEffects) : pass1;
    }

    function _resolveVariablesOnce(text, sideEffects) {
        let result = text;
        // Statyczne zmienne
        for (const [key, variable] of Object.entries(VARIABLES)) {
            const regex = new RegExp('\\{\\{' + key + '\\}\\}', 'g');
            result = result.replace(regex, variable.resolve());
        }
        // Dynamiczne: {{data+Xdr}} (dni robocze), {{data+Xdk}} (dni kalendarzowe),
        //            {{data+Xw}} (tygodnie), {{data+Xd}} — alias dla Xdr (zgodność wsteczna)
        result = result.replace(/\{\{data\+(\d+)(dr|dk|d|w)\}\}/g, function (_, num, unit) {
            return formatDate(offsetDate(num, unit));
        });
        // Dynamiczne: {{data_reopen+Xdr/Xdk/Xw/Xd}} — jak wyżej + efekt uboczny:
        // pierwsza napotkana wartość trafi do pola "Reopen date" w formularzu ticketu.
        result = result.replace(/\{\{data_reopen\+(\d+)(dr|dk|d|w)\}\}/g, function (_, num, unit) {
            var d = offsetDate(num, unit);
            if (sideEffects && !sideEffects.reopenDate) {
                sideEffects.reopenDate = formatDateYmd(d);
            }
            return formatDate(d);
        });
        // Dynamiczne: {{godzina+Xm}}, {{godzina+Xh}}
        result = result.replace(/\{\{godzina\+(\d+)([mh])\}\}/g, function (_, num, unit) {
            var d = new Date();
            var offset = parseInt(num, 10) * (unit === 'h' ? 60 : 1);
            d.setMinutes(d.getMinutes() + offset);
            return formatTime(d);
        });
        // Dynamiczne: {{podpis:Nazwa podpisu}}
        result = result.replace(/\{\{podpis:(.+?)\}\}/g, function (_, sigName) {
            var data = loadData();
            var sig = data.signatures.find(function (s) { return s.name === sigName; });
            return sig ? sig.content : '{{podpis:' + sigName + '}}';
        });
        return result;
    }

    // -----------------------------------------------------------------------
    // Dokumentacja zmiennych — wyświetlana w zwijanej legendzie
    // (chipy nad edytorem wciąż pochodzą z VARIABLES — to opisowy dodatek).
    // -----------------------------------------------------------------------
    const VARIABLES_DOC = [
        {
            cat: 'Data i godzina',
            rows: [
                { tag: '{{data}}',              desc: 'Bieżąca data',                                                         example: '→ 16.02.2026' },
                { tag: '{{data+Xdr}}',          desc: 'Bieżąca data + X dni roboczych (pn–pt, pomija sob/nd)',                example: '{{data+5dr}} → 23.02.2026' },
                { tag: '{{data+Xdk}}',          desc: 'Bieżąca data + X dni kalendarzowych (z weekendami)',                   example: '{{data+5dk}} → 21.02.2026' },
                { tag: '{{data+Xw}}',           desc: 'Bieżąca data + X tygodni',                                             example: '{{data+2w}} → 02.03.2026' },
                { tag: '{{data_reopen+Xdr}}',   desc: 'Jak {{data+Xdr}} + automatycznie ustawia „Reopen date" w formularzu',  example: '{{data_reopen+5dr}} → 23.02.2026' },
                { tag: '{{data_reopen+Xdk}}',   desc: 'Jak {{data+Xdk}} + automatycznie ustawia „Reopen date" w formularzu',  example: '{{data_reopen+7dk}} → 23.02.2026' },
                { tag: '{{godzina}}',           desc: 'Bieżąca godzina (HH:MM)',                                              example: '→ 14:35' },
                { tag: '{{godzina+Xm}}',        desc: 'Bieżąca godzina + X minut',                                            example: '{{godzina+30m}} → 15:05' },
                { tag: '{{godzina+Xh}}',        desc: 'Bieżąca godzina + X godzin',                                           example: '{{godzina+2h}} → 16:35' },
                { tag: '{{dzien_tygodnia}}',    desc: 'Dzień tygodnia po polsku',                                             example: '→ poniedziałek' }
            ]
        },
        {
            cat: 'Dane z ticketu',
            rows: [
                { tag: '{{firma}}',              desc: 'Nazwa firmy klienta (z sekcji Concerns)',    example: '→ Janusz Lissy P.P.H.U.' },
                { tag: '{{id_klienta}}',         desc: 'Identyfikator klienta',                       example: '→ 56815' },
                { tag: '{{ticket_id}}',          desc: 'Numer bieżącego ticketu',                     example: '→ 1239822801' },
                { tag: '{{account_manager}}',    desc: 'Account Manager przypisany do klienta',       example: '→ Joanna Jacheć' },
                { tag: '{{webpage_supervisor}}', desc: 'Webpage supervisor klienta',                  example: '—' },
                { tag: '{{support_supervisor}}', desc: 'Support supervisor klienta',                  example: '—' },
                { tag: '{{plan}}',               desc: 'Plan klienta (Start / Pro / VIP itp.)',       example: '→ Plan Start' }
            ]
        },
        {
            cat: 'Podpis i edycja',
            rows: [
                { tag: '{{podpis}}',         desc: 'Domyślny podpis (ustawiany w zakładce „Podpisy")',                          example: '—' },
                { tag: '{{podpis:Nazwa}}',   desc: 'Konkretny podpis o podanej nazwie; zmienne wewnątrz podpisu też się rozwijają', example: '{{podpis:Formalny}}' },
                { tag: '{{kursor}}',         desc: 'Miejsce, w którym znajdzie się kursor po wstawieniu szablonu',              example: '—' }
            ]
        }
    ];

    // Tworzy zwijany panel „Dostępne zmienne" z tabelą opisującą każdą zmienną.
    // onInsert(tag) — opcjonalny callback wołany po kliknięciu w tag (wstawia tekst).
    // Jeśli nie przekazany, tagi są tylko do odczytu.
    function buildVariablesLegend(onInsert) {
        const wrap = document.createElement('details');
        wrap.className = 'tt-var-legend';

        const summary = document.createElement('summary');
        summary.textContent = 'Dostępne zmienne — pełna legenda';
        wrap.appendChild(summary);

        const intro = document.createElement('p');
        intro.className = 'tt-var-legend-intro';
        intro.textContent = 'Kliknij nazwę zmiennej aby wstawić. W przykładach z "X" — podmień X na liczbę.';
        wrap.appendChild(intro);

        VARIABLES_DOC.forEach(section => {
            const h = document.createElement('div');
            h.className = 'tt-var-legend-section';
            h.textContent = section.cat;
            wrap.appendChild(h);

            const table = document.createElement('table');
            table.className = 'tt-var-legend-table';
            const thead = document.createElement('thead');
            thead.innerHTML = '<tr><th>Zmienna</th><th>Opis</th><th>Przykład</th></tr>';
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            section.rows.forEach(row => {
                const tr = document.createElement('tr');
                const td1 = document.createElement('td');
                const codeEl = document.createElement('code');
                codeEl.className = 'tt-var-chip';
                codeEl.dataset.var = row.tag;
                codeEl.textContent = row.tag;
                if (onInsert) {
                    codeEl.style.cursor = 'pointer';
                    codeEl.onclick = () => onInsert(row.tag);
                }
                td1.appendChild(codeEl);
                const td2 = document.createElement('td');
                td2.textContent = row.desc;
                const td3 = document.createElement('td');
                td3.className = 'tt-var-legend-example';
                td3.textContent = row.example;
                tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
        });

        return wrap;
    }

    // -----------------------------------------------------------------------
    // Prosty parser IdoSell markdown → HTML
    // -----------------------------------------------------------------------
    function markdownToHtml(text) {
        // Escape HTML
        var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Bloki kodu (``` ... ```)
        html = html.replace(/```([\s\S]*?)```/g, function (_, code) {
            return '<pre style="background:#f4f4f4;padding:8px 12px;border-radius:4px;font-family:monospace;overflow-x:auto;">' + code.trim() + '</pre>';
        });

        // Inline code (`...`)
        html = html.replace(/`([^`]+)`/g, '<code style="background:#f4f4f4;padding:1px 4px;border-radius:3px;font-family:monospace;">$1</code>');

        // Bold (**...**)
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Italic (*...*)
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Linki IdoSell [url tekst]
        html = html.replace(/\[(https?:\/\/\S+)\s+(.+?)\]/g, '<a href="$1" style="color:' + ACCENT_COLOR + ';">$2</a>');

        // Blockquote (> ...)
        html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote style="border-left:3px solid #ddd;padding-left:10px;color:#666;margin:4px 0;">$1</blockquote>');

        // Linie → paragrafy (podziel po podwójnym \n, pojedyncze \n → <br>)
        var paragraphs = html.split('\n\n');
        html = paragraphs.map(function (p) {
            p = p.trim();
            if (!p) return '';
            // Nie zawijaj w <p> jeśli to już blokowy element
            if (/^<(pre|blockquote|ul|ol)/i.test(p)) return p;
            return '<p style="margin:0 0 8px 0;">' + p.replace(/\n/g, '<br>') + '</p>';
        }).join('');

        return html;
    }

    // -----------------------------------------------------------------------
    // Pomocnicze — tworzenie przycisków z type="button" (zapobiega submitowi formularza)
    // -----------------------------------------------------------------------
    function btn() {
        const b = document.createElement('button');
        b.type = 'button';
        return b;
    }

    // -----------------------------------------------------------------------
    // Pomocnicze — odpalenie eventów na textarea (kompatybilność z IdoSell)
    // -----------------------------------------------------------------------
    function fireTextareaEvents(textarea) {
        ['input', 'change', 'keyup'].forEach(evtName => {
            textarea.dispatchEvent(new Event(evtName, { bubbles: true }));
        });
    }

    function insertIntoTextarea(textarea, content) {
        var cursorPos = content.indexOf(CURSOR_MARKER);
        if (cursorPos !== -1) {
            content = content.replace(CURSOR_MARKER, '');
        }
        textarea.value = content;
        textarea.focus();
        if (cursorPos !== -1) {
            textarea.setSelectionRange(cursorPos, cursorPos);
        }
        fireTextareaEvents(textarea);
    }

    // -----------------------------------------------------------------------
    // UI — Style (jeden <style> wstrzykiwany programatycznie)
    // -----------------------------------------------------------------------
    function injectStyles() {
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            /* --- Toolbar nad textarea --- */
            #tt-toolbar {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 8px;
                background: #f5f7fa;
                border: 1px solid #ddd;
                border-bottom: none;
                border-radius: 4px 4px 0 0;
                font-family: 'Inter', 'DM Sans', Arial, sans-serif;
                font-size: 12px;
                flex-wrap: wrap;
            }
            #tt-toolbar select {
                flex: 1;
                min-width: 180px;
                padding: 5px 8px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 12px;
                background: #fff;
            }
            #tt-toolbar .tt-btn {
                padding: 5px 10px;
                border: 1px solid ${ACCENT_COLOR};
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                transition: all 0.15s;
                white-space: nowrap;
            }
            #tt-toolbar .tt-btn-primary {
                background: ${ACCENT_COLOR};
                color: #fff;
            }
            #tt-toolbar .tt-btn-primary:hover {
                background: ${ACCENT_HOVER};
            }
            #tt-toolbar .tt-btn-secondary {
                background: #fff;
                color: ${ACCENT_COLOR};
            }
            #tt-toolbar .tt-btn-secondary:hover {
                background: #eef4fb;
            }

            /* --- FAB --- */
            #tt-fab {
                position: fixed;
                bottom: 100px;
                right: 20px;
                z-index: 1000000;
                width: 44px;
                height: 44px;
                background: ${ACCENT_COLOR};
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 3px 12px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.2s, box-shadow 0.2s;
                user-select: none;
                border: none;
            }
            #tt-fab:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            }
            #tt-fab svg {
                width: 22px;
                height: 22px;
                fill: white;
            }

            /* --- FAB Panel --- */
            #tt-fab-panel {
                position: fixed;
                bottom: 155px;
                right: 20px;
                z-index: 999999;
                background: #fff;
                border: 2px solid ${ACCENT_COLOR};
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                font-family: 'Inter', 'DM Sans', Arial, sans-serif;
                font-size: 13px;
                min-width: 300px;
                max-width: 360px;
                display: none;
            }
            #tt-fab-panel.tt-visible { display: block; }
            #tt-fab-panel .tt-fp-header {
                background: ${ACCENT_COLOR};
                color: #fff;
                padding: 8px 12px;
                border-radius: 6px 6px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 13px;
                font-weight: 600;
            }
            #tt-fab-panel .tt-fp-header button {
                background: none; border: none; color: #fff;
                font-size: 18px; cursor: pointer; padding: 0 4px; line-height: 1;
            }
            #tt-fab-panel .tt-fp-header button:hover { opacity: 0.7; }
            #tt-fab-panel .tt-fp-body {
                padding: 10px 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            #tt-fab-panel .tt-fp-body select {
                width: 100%;
                padding: 6px 8px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 12px;
            }
            #tt-fab-panel .tt-fp-body .tt-fp-actions {
                display: flex;
                gap: 6px;
            }
            #tt-fab-panel .tt-fp-body .tt-fp-actions button {
                flex: 1;
                padding: 6px 10px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                transition: all 0.15s;
            }
            #tt-fab-panel .tt-fp-body .tt-fp-btn-insert {
                background: ${ACCENT_COLOR};
                color: #fff;
                border: 1px solid ${ACCENT_COLOR};
            }
            #tt-fab-panel .tt-fp-body .tt-fp-btn-insert:hover {
                background: ${ACCENT_HOVER};
            }
            #tt-fab-panel .tt-fp-body .tt-fp-btn-manage {
                background: #fff;
                color: ${ACCENT_COLOR};
                border: 1px solid ${ACCENT_COLOR};
            }
            #tt-fab-panel .tt-fp-body .tt-fp-btn-manage:hover {
                background: #eef4fb;
            }

            /* --- Modal zarządzania --- */
            #tt-modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.45);
                z-index: 2000000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #tt-modal {
                background: #fff !important;
                border-radius: 12px !important;
                box-shadow: 0 8px 40px rgba(0,0,0,0.3) !important;
                font-family: 'Inter', 'DM Sans', Arial, sans-serif;
                width: 860px;
                max-width: 95vw;
                max-height: 85vh;
                display: flex !important;
                flex-direction: column;
                overflow: hidden !important;
            }
            #tt-modal .tt-m-header {
                background: ${ACCENT_COLOR};
                color: #fff;
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 15px;
                font-weight: 700;
            }
            #tt-modal .tt-m-header button {
                background: none; border: none; color: #fff;
                font-size: 22px; cursor: pointer; padding: 0 4px; line-height: 1;
            }
            #tt-modal .tt-m-header button:hover { opacity: 0.7; }

            /* Zakładki */
            #tt-modal .tt-m-tabs {
                display: flex;
                border-bottom: 2px solid #e0e0e0;
                background: #fafafa;
            }
            #tt-modal .tt-m-tab {
                padding: 10px 20px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                color: #666;
                border-bottom: 2px solid transparent;
                margin-bottom: -2px;
                transition: all 0.15s;
                user-select: none;
            }
            #tt-modal .tt-m-tab:hover { color: ${ACCENT_COLOR}; }
            #tt-modal .tt-m-tab.tt-active {
                color: ${ACCENT_COLOR};
                border-bottom-color: ${ACCENT_COLOR};
            }

            /* Zawartość zakładek */
            #tt-modal .tt-m-content {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
            }

            /* Lista elementów (szablony / podpisy) */
            .tt-list-item {
                display: flex;
                align-items: center;
                padding: 8px 10px;
                border: 1px solid #eee;
                border-radius: 6px;
                margin-bottom: 6px;
                transition: background 0.1s;
            }
            .tt-list-item:hover { background: #f8f9fb; }
            .tt-list-item .tt-li-name {
                flex: 1;
                min-width: 0;
                font-size: 13px;
                font-weight: 500;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .tt-list-item .tt-li-category {
                flex-shrink: 0;
                font-size: 10px;
                font-weight: 600;
                color: #fff;
                background: #7b8a9a;
                margin-left: 8px;
                margin-right: 8px;
                padding: 2px 8px;
                border-radius: 10px;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                white-space: nowrap;
            }
            .tt-list-item .tt-li-default {
                flex-shrink: 0;
                color: #f0ad4e;
                margin-right: 6px;
                font-size: 16px;
            }
            .tt-list-item .tt-li-actions {
                flex-shrink: 0;
                display: flex;
                gap: 4px;
                margin-left: auto;
            }
            .tt-list-item .tt-li-actions button {
                padding: 3px 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                cursor: pointer;
                font-size: 11px;
                background: #fff;
                transition: all 0.1s;
            }
            .tt-list-item .tt-li-actions button:hover {
                background: #f0f0f0;
            }
            .tt-list-item .tt-li-actions button.tt-btn-danger {
                color: #d9534f;
                border-color: #d9534f;
            }
            .tt-list-item .tt-li-actions button.tt-btn-danger:hover {
                background: #fdf0f0;
            }

            /* Przyciski akcji w sekcji */
            .tt-section-actions {
                display: flex;
                gap: 8px;
                margin-bottom: 12px;
                flex-wrap: wrap;
            }
            .tt-section-actions button {
                padding: 6px 14px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                transition: all 0.15s;
            }
            .tt-btn-add {
                background: ${ACCENT_COLOR};
                color: #fff;
                border: 1px solid ${ACCENT_COLOR};
            }
            .tt-btn-add:hover { background: ${ACCENT_HOVER}; }
            .tt-btn-export {
                background: #fff;
                color: #5cb85c;
                border: 1px solid #5cb85c;
            }
            .tt-btn-export:hover { background: #f0faf0; }
            .tt-btn-import {
                background: #fff;
                color: #f0ad4e;
                border: 1px solid #f0ad4e;
            }
            .tt-btn-import:hover { background: #fef8f0; }

            /* Formularz edycji */
            .tt-form { margin-top: 12px; }
            .tt-form label {
                display: block;
                font-size: 12px;
                font-weight: 600;
                color: #555;
                margin-bottom: 4px;
                margin-top: 10px;
            }
            .tt-form label:first-child { margin-top: 0; }
            .tt-form input[type="text"],
            .tt-form textarea,
            .tt-form select {
                width: 100%;
                padding: 7px 10px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 13px;
                font-family: inherit;
                box-sizing: border-box;
            }
            .tt-form textarea {
                min-height: 120px;
                resize: vertical;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 12px;
                line-height: 1.5;
            }
            .tt-form .tt-form-actions {
                display: flex;
                gap: 8px;
                margin-top: 14px;
                justify-content: flex-end;
            }
            .tt-form .tt-form-actions button {
                padding: 7px 18px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
            }
            .tt-form .tt-form-btn-save {
                background: ${ACCENT_COLOR};
                color: #fff;
                border: 1px solid ${ACCENT_COLOR};
            }
            .tt-form .tt-form-btn-save:hover { background: ${ACCENT_HOVER}; }
            .tt-form .tt-form-btn-cancel {
                background: #fff;
                color: #666;
                border: 1px solid #ccc;
            }
            .tt-form .tt-form-btn-cancel:hover { background: #f5f5f5; }
            .tt-form .tt-form-btn-preview {
                background: #fff;
                color: ${ACCENT_COLOR};
                border: 1px solid ${ACCENT_COLOR};
            }
            .tt-form .tt-form-btn-preview:hover { background: #eef4fb; }

            /* Hint ze zmiennymi */
            .tt-variables-hint {
                font-size: 11px;
                color: #888;
                margin-top: 4px;
                line-height: 1.6;
            }
            .tt-variables-hint code {
                background: #f0f0f0;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 11px;
                cursor: pointer;
            }
            .tt-variables-hint code:hover {
                background: #e0e8f0;
            }

            /* Legenda zmiennych (zwijana) */
            .tt-var-legend {
                margin-top: 8px;
                border: 1px solid #e0e6ec;
                border-radius: 6px;
                background: #fafbfc;
                font-size: 12px;
            }
            .tt-var-legend > summary {
                cursor: pointer;
                padding: 8px 12px;
                font-weight: 600;
                color: #555;
                user-select: none;
                list-style: none;
            }
            .tt-var-legend > summary::-webkit-details-marker { display: none; }
            .tt-var-legend > summary::before {
                content: '\\25B6';
                display: inline-block;
                margin-right: 6px;
                font-size: 10px;
                transition: transform 0.15s;
            }
            .tt-var-legend[open] > summary::before {
                transform: rotate(90deg);
            }
            .tt-var-legend > summary:hover { background: #f0f4f8; border-radius: 6px; }
            .tt-var-legend-intro {
                margin: 0;
                padding: 6px 12px 8px;
                color: #888;
                font-size: 11px;
                font-style: italic;
            }
            .tt-var-legend-section {
                padding: 8px 12px 4px;
                font-weight: 600;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: ${ACCENT_COLOR};
                border-top: 1px solid #edf1f5;
            }
            .tt-var-legend-table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 4px;
            }
            .tt-var-legend-table thead { display: none; }
            .tt-var-legend-table td {
                padding: 4px 12px;
                vertical-align: top;
                border-top: 1px solid #eef2f6;
                font-size: 11.5px;
                line-height: 1.45;
            }
            .tt-var-legend-table td:first-child {
                white-space: nowrap;
                width: 1%;
            }
            .tt-var-legend-table td:nth-child(2) { color: #444; }
            .tt-var-legend-example {
                color: #888;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 11px;
                white-space: nowrap;
            }
            .tt-var-legend .tt-var-chip {
                background: #f0f0f0;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 11px;
                font-family: 'Consolas', 'Monaco', monospace;
            }
            .tt-var-legend .tt-var-chip:hover { background: #e0e8f0; }

            /* Podgląd */
            .tt-preview-box {
                background: #fafafa;
                border: 1px solid #ddd;
                border-radius: 6px;
                padding: 14px;
                font-size: 13px;
                line-height: 1.6;
                max-height: 300px;
                overflow-y: auto;
                font-family: inherit;
            }

            /* Ustawienia */
            .tt-setting-row {
                display: flex;
                align-items: center;
                padding: 10px 0;
                border-bottom: 1px solid #f0f0f0;
            }
            .tt-setting-row:last-child { border-bottom: none; }
            .tt-setting-row label {
                flex: 1;
                font-size: 13px;
                font-weight: 500;
            }
            .tt-setting-row select,
            .tt-setting-row input[type="checkbox"] {
                cursor: pointer;
            }
            .tt-setting-row select {
                padding: 5px 8px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 12px;
            }

            /* Pusta lista */
            .tt-empty {
                text-align: center;
                color: #aaa;
                padding: 30px 10px;
                font-size: 13px;
            }

            /* SimpleMDE w modalu */
            #tt-modal .CodeMirror {
                min-height: 150px;
                border: 1px solid #ccc;
                border-radius: 0 0 4px 4px;
            }
            #tt-modal .editor-toolbar {
                border: 1px solid #ccc;
                border-bottom: none;
                border-radius: 4px 4px 0 0;
            }
            #tt-modal .editor-toolbar button {
                color: #555 !important;
            }
            #tt-modal .editor-toolbar button:hover,
            #tt-modal .editor-toolbar button.active {
                background: #eef4fb;
            }
            #tt-modal .CodeMirror-fullscreen,
            #tt-modal .editor-toolbar.fullscreen,
            #tt-modal .editor-preview-side {
                z-index: 2000010;
            }
        `;
        document.head.appendChild(styleEl);
    }

    // -----------------------------------------------------------------------
    // Odświeżanie selektorów szablonów (toolbar + FAB)
    // -----------------------------------------------------------------------
    function refreshSelectors() {
        const data = loadData();
        const selectors = document.querySelectorAll('.tt-template-selector');
        selectors.forEach(sel => {
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">-- Wybierz szablon --</option>';

            // Grupuj po kategoriach
            const withCategory = data.templates.filter(t => t.category);
            const withoutCategory = data.templates.filter(t => !t.category);
            const categories = [...new Set(withCategory.map(t => t.category))].sort();

            withoutCategory.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                sel.appendChild(opt);
            });

            categories.forEach(cat => {
                const group = document.createElement('optgroup');
                group.label = cat;
                withCategory.filter(t => t.category === cat).forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = t.name;
                    group.appendChild(opt);
                });
                sel.appendChild(group);
            });

            sel.value = currentVal;
        });
    }

    // -----------------------------------------------------------------------
    // Ustawienie pola Reopen date (YYYY-MM-DD) w formularzu ticketu.
    // Synchronizuje ukryte pola y/m/d, bo IdoSell wysyła je osobno z formularzem.
    // -----------------------------------------------------------------------
    function applyReopenDate(ymd) {
        const el = document.getElementById('fg_reopen_ymd');
        if (!el) {
            console.warn(PREFIX, 'Pole Reopen date nie znalezione — pomijam ustawienie', ymd);
            return;
        }
        el.value = ymd;
        const parts = ymd.split('-');
        const y = document.getElementById('fg_reopeny');
        const m = document.getElementById('fg_reopenm');
        const d = document.getElementById('fg_reopend');
        if (y && parts[0]) y.value = parts[0];
        if (m && parts[1]) m.value = parts[1];
        if (d && parts[2]) d.value = parts[2];
        el.dispatchEvent(new Event('change'));
        if (typeof jQuery !== 'undefined') jQuery(el).trigger('change');
        console.log(PREFIX, 'Ustawiono Reopen date:', ymd);
    }

    // -----------------------------------------------------------------------
    // Ustawienia formularza — zastosowanie do pól strony
    // -----------------------------------------------------------------------
    function applyFormSettings(formSettings) {
        if (!formSettings) return;

        // Type of message (radio: textType)
        if (formSettings.textType) {
            const radio = document.querySelector('input[name="textType"][value="' + formSettings.textType + '"]');
            if (radio) {
                radio.checked = true;
                radio.click(); // odpali onclick handlery IdoSell (viewSelected, toggleFollowUp, etc.)
            }
        }

        // Assigned to (select z select2)
        if (formSettings.assigned) {
            const el = document.getElementById('fg_assigned');
            if (el) {
                el.value = formSettings.assigned;
                if (typeof jQuery !== 'undefined') {
                    jQuery('#fg_assigned').val(formSettings.assigned).trigger('change');
                }
            }
        }

        // Change ticket type (select)
        if (formSettings.newType) {
            const el = document.getElementById('fg_newType') || document.getElementById('fg_typeId');
            if (el) {
                el.value = formSettings.newType;
                if (el.onchange) el.onchange();
                if (typeof jQuery !== 'undefined') jQuery(el).trigger('change');
            }
        }

        // Change ticket subtype (select)
        if (formSettings.newSubtype) {
            const el = document.getElementById('fg_newSubtype');
            if (el) {
                el.value = formSettings.newSubtype;
                if (el.onchange) el.onchange();
                if (typeof jQuery !== 'undefined') jQuery(el).trigger('change');
            }
        }

        // Reopen date (input)
        if (formSettings.reopen_ymd) {
            applyReopenDate(formSettings.reopen_ymd);
        }

        // SMS notification (radio: sms)
        if (formSettings.sms) {
            const radio = document.querySelector('input[name="sms"][value="' + formSettings.sms + '"]');
            if (radio) radio.checked = true;
        }

        // EMAIL notification (radio: employeeMail)
        if (formSettings.employeeMail) {
            const radio = document.querySelector('input[name="employeeMail"][value="' + formSettings.employeeMail + '"]');
            if (radio) radio.checked = true;
        }
    }

    // Odczyt bieżących opcji z formularza do listy select w edytorze szablonu
    function readPageSelectOptions(selectorId) {
        const el = document.getElementById(selectorId);
        if (!el || el.tagName !== 'SELECT') return [];
        const opts = [];
        for (const opt of el.options) {
            opts.push({ value: opt.value, label: opt.textContent.trim() });
        }
        return opts;
    }

    function insertTemplate(templateId, textarea) {
        const data = loadData();
        const tpl = data.templates.find(t => t.id === templateId);
        if (!tpl) return;

        const sideEffects = {};
        let content = resolveVariables(tpl.content, sideEffects);

        // Auto-dodawanie podpisu jeśli włączone i szablon nie zawiera {{podpis}}
        if (data.settings.autoAppendSignature && !tpl.content.includes('{{podpis}}')) {
            const defaultSig = data.signatures.find(s => s.isDefault);
            if (defaultSig && defaultSig.content) {
                content += '\n\n' + defaultSig.content;
            }
        }

        insertIntoTextarea(textarea, content);

        // Zastosuj ustawienia formularza
        if (tpl.formSettings) {
            applyFormSettings(tpl.formSettings);
        }

        // Dynamiczny Reopen date z {{data_reopen+...}} — nadpisuje statyczny
        // formSettings.reopen_ymd jeśli obie wartości występują w szablonie.
        if (sideEffects.reopenDate) {
            applyReopenDate(sideEffects.reopenDate);
        }
    }

    // -----------------------------------------------------------------------
    // UI: Toolbar (wbudowany nad textarea)
    // -----------------------------------------------------------------------
    function createToolbar(textarea) {
        const toolbar = document.createElement('div');
        toolbar.id = 'tt-toolbar';

        const select = document.createElement('select');
        select.className = 'tt-template-selector';

        const btnInsert = btn();
        btnInsert.className = 'tt-btn tt-btn-primary';
        btnInsert.textContent = 'Wstaw';
        btnInsert.title = 'Wstaw wybrany szablon do pola odpowiedzi';
        btnInsert.onclick = () => {
            if (!select.value) return alert('Wybierz szablon z listy');
            insertTemplate(select.value, textarea);
        };

        const btnPreview = btn();
        btnPreview.className = 'tt-btn tt-btn-secondary';
        btnPreview.textContent = 'Podgląd';
        btnPreview.title = 'Podgląd szablonu z rozwiniętymi zmiennymi';
        btnPreview.onclick = () => {
            if (!select.value) return alert('Wybierz szablon z listy');
            showPreview(select.value);
        };

        const btnManage = btn();
        btnManage.className = 'tt-btn tt-btn-secondary';
        btnManage.textContent = 'Zarządzaj';
        btnManage.title = 'Otwórz panel zarządzania szablonami i podpisami';
        btnManage.onclick = () => openManager();

        const btnClear = btn();
        btnClear.className = 'tt-btn tt-btn-secondary';
        btnClear.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d9534f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
        btnClear.title = 'Wyczyść pole komunikatu';
        btnClear.style.cssText = 'border-color:#eee;padding:5px 8px;display:flex;align-items:center;';
        btnClear.onclick = () => {
            if (textarea.value.trim() && !confirm('Wyczyścić treść komunikatu?')) return;
            insertIntoTextarea(textarea, '');
            clearDraft(TICKET_ID);
        };

        toolbar.appendChild(select);
        toolbar.appendChild(btnInsert);
        toolbar.appendChild(btnPreview);
        toolbar.appendChild(btnManage);
        toolbar.appendChild(btnClear);

        // Wstaw toolbar przed textarea
        const parent = textarea.parentNode;
        parent.insertBefore(toolbar, textarea);

        return toolbar;
    }

    // -----------------------------------------------------------------------
    // UI: FAB + Panel pływający
    // -----------------------------------------------------------------------
    function createFAB(textarea) {
        // FAB button
        const fab = btn();
        fab.id = 'tt-fab';
        fab.title = 'Szablony odpowiedzi';
        fab.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
            <polyline points="14 2 14 8 20 8" fill="none" stroke="white" stroke-width="1.5"/>
            <line x1="8" y1="13" x2="16" y2="13" stroke="white" stroke-width="1.5"/>
            <line x1="8" y1="17" x2="13" y2="17" stroke="white" stroke-width="1.5"/>
        </svg>`;

        // Panel pływający
        const panel = document.createElement('div');
        panel.id = 'tt-fab-panel';
        panel.innerHTML = `
            <div class="tt-fp-header">
                <span>Szablony odpowiedzi</span>
                <button type="button" class="tt-fp-close">&times;</button>
            </div>
            <div class="tt-fp-body">
                <select class="tt-template-selector"></select>
                <div class="tt-fp-actions">
                    <button type="button" class="tt-fp-btn-insert">Wstaw</button>
                    <button type="button" class="tt-fp-btn-manage">Zarządzaj</button>
                </div>
            </div>
        `;

        fab.onclick = () => panel.classList.toggle('tt-visible');
        panel.querySelector('.tt-fp-close').onclick = () => panel.classList.remove('tt-visible');
        panel.querySelector('.tt-fp-btn-insert').onclick = () => {
            const sel = panel.querySelector('.tt-template-selector');
            if (!sel.value) return alert('Wybierz szablon z listy');
            insertTemplate(sel.value, textarea);
            panel.classList.remove('tt-visible');
        };
        panel.querySelector('.tt-fp-btn-manage').onclick = () => {
            panel.classList.remove('tt-visible');
            openManager();
        };

        document.body.appendChild(fab);
        document.body.appendChild(panel);
        return { fab, panel };
    }

    // -----------------------------------------------------------------------
    // UI: Podgląd szablonu
    // -----------------------------------------------------------------------
    function showPreview(templateId) {
        const data = loadData();
        const tpl = data.templates.find(t => t.id === templateId);
        if (!tpl) return;

        let content = resolveVariables(tpl.content);
        if (data.settings.autoAppendSignature && !tpl.content.includes('{{podpis}}')) {
            const defaultSig = data.signatures.find(s => s.isDefault);
            if (defaultSig && defaultSig.content) {
                content += '\n\n' + defaultSig.content;
            }
        }

        const overlay = document.createElement('div');
        overlay.id = 'tt-modal-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
            <div id="tt-modal" style="width:550px;">
                <div class="tt-m-header">
                    <span>Podgląd: ${escHtml(tpl.name)}</span>
                    <button type="button" class="tt-preview-close">&times;</button>
                </div>
                <div class="tt-m-content">
                    <div class="tt-preview-box" style="line-height:1.6;">${markdownToHtml(content)}</div>
                </div>
            </div>
        `;
        overlay.querySelector('.tt-preview-close').onclick = () => overlay.remove();
        document.body.appendChild(overlay);
    }

    // -----------------------------------------------------------------------
    // UI: Modal zarządzania — główna funkcja
    // -----------------------------------------------------------------------
    function openManager(initialTab) {
        // Zamknij istniejący modal jeśli jest
        const existing = document.getElementById('tt-modal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'tt-modal-overlay';
        // Celowo brak zamykania kliknięciem w overlay — chroni przed przypadkową utratą edycji

        const modal = document.createElement('div');
        modal.id = 'tt-modal';

        // Header
        const header = document.createElement('div');
        header.className = 'tt-m-header';
        header.innerHTML = '<span>Zarządzanie szablonami</span>';
        const closeBtn = btn();
        closeBtn.textContent = '\u00D7';
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(closeBtn);

        // Tabs
        const tabs = document.createElement('div');
        tabs.className = 'tt-m-tabs';
        const tabNames = [
            { id: 'templates', label: 'Szablony' },
            { id: 'categories', label: 'Kategorie' },
            { id: 'signatures', label: 'Podpisy' },
            { id: 'settings', label: 'Ustawienia' }
        ];

        const content = document.createElement('div');
        content.className = 'tt-m-content';

        let activeTab = initialTab || 'templates';

        function renderTab(tabId) {
            activeTab = tabId;
            tabs.querySelectorAll('.tt-m-tab').forEach(t => {
                t.classList.toggle('tt-active', t.dataset.tab === tabId);
            });
            if (tabId === 'templates') renderTemplatesTab(content);
            else if (tabId === 'categories') renderCategoriesTab(content);
            else if (tabId === 'signatures') renderSignaturesTab(content);
            else if (tabId === 'settings') renderSettingsTab(content);
        }

        tabNames.forEach(tn => {
            const tab = document.createElement('div');
            tab.className = 'tt-m-tab' + (tn.id === activeTab ? ' tt-active' : '');
            tab.dataset.tab = tn.id;
            tab.textContent = tn.label;
            tab.onclick = () => renderTab(tn.id);
            tabs.appendChild(tab);
        });

        modal.appendChild(header);
        modal.appendChild(tabs);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        renderTab(activeTab);
    }

    // -----------------------------------------------------------------------
    // Tab: Szablony
    // -----------------------------------------------------------------------
    function renderTemplatesTab(container) {
        const data = loadData();
        container.innerHTML = '';

        // Przyciski akcji
        const actions = document.createElement('div');
        actions.className = 'tt-section-actions';

        const btnAdd = btn();
        btnAdd.className = 'tt-btn-add';
        btnAdd.textContent = '+ Nowy szablon';
        btnAdd.onclick = () => showTemplateForm(container, null);

        const btnExport = btn();
        btnExport.className = 'tt-btn-export';
        btnExport.textContent = 'Eksportuj';
        btnExport.onclick = () => exportToFile(loadData());

        const btnImport = btn();
        btnImport.className = 'tt-btn-import';
        btnImport.textContent = 'Importuj';
        btnImport.onclick = async () => {
            try {
                const imported = await importFromFile();
                // Normalizacja — content może być tablicą linii (nowy format eksportu)
                (imported.templates || []).forEach(function (t) {
                    if (Array.isArray(t.content)) t.content = t.content.join('\n');
                });
                (imported.signatures || []).forEach(function (s) {
                    if (Array.isArray(s.content)) s.content = s.content.join('\n');
                });
                const currentData = loadData();
                // Merge — dodaj importowane, nie nadpisuj istniejących
                const existingIds = new Set(currentData.templates.map(t => t.id));
                const newTemplates = imported.templates.filter(t => !existingIds.has(t.id));
                // Nadaj nowe ID aby uniknąć konfliktów
                newTemplates.forEach(t => { t.id = generateId('t'); });
                currentData.templates.push(...newTemplates);

                if (imported.signatures) {
                    const existingSigIds = new Set(currentData.signatures.map(s => s.id));
                    const newSigs = imported.signatures.filter(s => !existingSigIds.has(s.id));
                    newSigs.forEach(s => { s.id = generateId('s'); s.isDefault = false; });
                    currentData.signatures.push(...newSigs);
                }

                saveData(currentData);
                refreshSelectors();
                renderTemplatesTab(container);
                alert('Zaimportowano ' + newTemplates.length + ' szablonów' +
                      (imported.signatures ? ' i ' + (imported.signatures.length || 0) + ' podpisów' : ''));
            } catch (e) {
                alert('Błąd importu: ' + e.message);
            }
        };

        actions.appendChild(btnAdd);
        actions.appendChild(btnExport);
        actions.appendChild(btnImport);
        container.appendChild(actions);

        // Filtry: szukajka + filtr kategorii
        const filters = document.createElement('div');
        filters.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;align-items:center;';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Szukaj po nazwie lub treści...';
        searchInput.style.cssText = 'flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:12px;';

        const catFilter = document.createElement('select');
        catFilter.style.cssText = 'padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;min-width:130px;';
        const optAll = document.createElement('option');
        optAll.value = '';
        optAll.textContent = 'Wszystkie kategorie';
        catFilter.appendChild(optAll);
        const optNoCat = document.createElement('option');
        optNoCat.value = '__none__';
        optNoCat.textContent = 'Bez kategorii';
        catFilter.appendChild(optNoCat);
        data.categories.forEach(cat => {
            const o = document.createElement('option');
            o.value = cat.name;
            o.textContent = cat.name;
            catFilter.appendChild(o);
        });

        filters.appendChild(searchInput);
        filters.appendChild(catFilter);
        container.appendChild(filters);

        // Kontener na listę szablonów (do filtrowania)
        const listContainer = document.createElement('div');
        container.appendChild(listContainer);

        function renderFilteredList() {
            listContainer.innerHTML = '';
            const query = searchInput.value.toLowerCase().trim();
            const catVal = catFilter.value;

            let filtered = data.templates;
            if (catVal === '__none__') {
                filtered = filtered.filter(t => !t.category);
            } else if (catVal) {
                filtered = filtered.filter(t => t.category === catVal);
            }
            if (query) {
                filtered = filtered.filter(t =>
                    t.name.toLowerCase().includes(query) ||
                    t.content.toLowerCase().includes(query)
                );
            }

            if (data.templates.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'tt-empty';
                empty.textContent = 'Brak szablonów. Kliknij "+ Nowy szablon" aby dodać pierwszy.';
                listContainer.appendChild(empty);
                return;
            }

            if (filtered.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'tt-empty';
                empty.textContent = 'Brak szablonów pasujących do filtrów.';
                listContainer.appendChild(empty);
                return;
            }

            filtered.forEach(tpl => {
                renderTemplateRow(listContainer, tpl, data, container);
            });
        }

        searchInput.oninput = renderFilteredList;
        catFilter.onchange = renderFilteredList;
        renderFilteredList();
    }

    function renderTemplateRow(listContainer, tpl, data, parentContainer) {
        const isDefault = data.settings.defaultTemplateId === tpl.id;
        const item = document.createElement('div');
        item.className = 'tt-list-item';

        const defaultMark = document.createElement('span');
        defaultMark.className = 'tt-li-default';
        defaultMark.textContent = isDefault ? '\u2605' : '';
        defaultMark.title = isDefault ? 'Szablon domyślny' : '';

        const name = document.createElement('span');
        name.className = 'tt-li-name';
        name.textContent = tpl.name;

        const category = document.createElement('span');
        category.className = 'tt-li-category';
        if (tpl.category) {
            category.textContent = tpl.category;
            const catObj = data.categories.find(c => c.name === tpl.category);
            category.style.background = catObj ? catObj.color : CATEGORY_COLORS[0];
        } else {
            category.style.display = 'none';
        }

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'tt-li-actions';

        const btnDefaultTpl = btn();
        if (isDefault) {
            btnDefaultTpl.textContent = 'Usuń domyślny';
            btnDefaultTpl.title = 'Przestań ładować ten szablon automatycznie';
            btnDefaultTpl.onclick = () => {
                const d = loadData();
                d.settings.defaultTemplateId = '';
                saveData(d);
                renderTemplatesTab(parentContainer);
            };
        } else {
            btnDefaultTpl.textContent = 'Domyślny';
            btnDefaultTpl.title = 'Ładuj ten szablon automatycznie przy nowych ticketach';
            btnDefaultTpl.onclick = () => {
                const d = loadData();
                d.settings.defaultTemplateId = tpl.id;
                saveData(d);
                renderTemplatesTab(parentContainer);
            };
        }

        const btnPreview = btn();
        btnPreview.textContent = 'Podgląd';
        btnPreview.title = 'Podgląd z rozwiniętymi zmiennymi';
        btnPreview.onclick = (e) => { e.stopPropagation(); showPreview(tpl.id); };

        const btnEdit = btn();
        btnEdit.textContent = 'Edytuj';
        btnEdit.onclick = () => showTemplateForm(parentContainer, tpl);

        const btnDuplicate = btn();
        btnDuplicate.textContent = 'Powiel';
        btnDuplicate.onclick = () => {
            const d = loadData();
            const copy = { ...tpl, id: generateId('t'), name: tpl.name + ' (kopia)', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
            d.templates.push(copy);
            saveData(d);
            refreshSelectors();
            renderTemplatesTab(parentContainer);
        };

        const btnDelete = btn();
        btnDelete.className = 'tt-btn-danger';
        btnDelete.textContent = 'Usuń';
        btnDelete.onclick = () => {
            if (!confirm('Czy na pewno usunąć szablon "' + tpl.name + '"?')) return;
            const d = loadData();
            if (d.settings.defaultTemplateId === tpl.id) d.settings.defaultTemplateId = '';
            d.templates = d.templates.filter(t => t.id !== tpl.id);
            saveData(d);
            refreshSelectors();
            renderTemplatesTab(parentContainer);
        };

        actionsDiv.appendChild(btnDefaultTpl);
        actionsDiv.appendChild(btnPreview);
        actionsDiv.appendChild(btnEdit);
        actionsDiv.appendChild(btnDuplicate);
        actionsDiv.appendChild(btnDelete);

        item.appendChild(defaultMark);
        item.appendChild(name);
        item.appendChild(category);
        item.appendChild(actionsDiv);
        listContainer.appendChild(item);
    }

    // -----------------------------------------------------------------------
    // Formularz edycji szablonu
    // -----------------------------------------------------------------------
    function showTemplateForm(container, existingTemplate) {
        container.innerHTML = '';
        const isEdit = !!existingTemplate;

        const form = document.createElement('div');
        form.className = 'tt-form';

        // Nazwa
        const lblName = document.createElement('label');
        lblName.textContent = 'Nazwa szablonu';
        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.placeholder = 'np. Powitanie importowe';
        inputName.value = isEdit ? existingTemplate.name : '';

        // Kategoria
        const lblCat = document.createElement('label');
        lblCat.textContent = 'Kategoria (opcjonalnie)';
        const inputCat = document.createElement('select');
        const catData = loadData();
        const optNone = document.createElement('option');
        optNone.value = '';
        optNone.textContent = '-- Brak kategorii --';
        inputCat.appendChild(optNone);
        catData.categories.forEach(cat => {
            const o = document.createElement('option');
            o.value = cat.name;
            o.textContent = cat.name;
            if (isEdit && existingTemplate.category === cat.name) o.selected = true;
            inputCat.appendChild(o);
        });

        // Treść
        const lblContent = document.createElement('label');
        lblContent.textContent = 'Treść szablonu (Markdown)';
        const inputContent = document.createElement('textarea');
        inputContent.id = 'tt-template-editor-' + Date.now();
        inputContent.placeholder = 'Dzień dobry,\n\nTreść wiadomości...\n\n{{podpis}}';
        inputContent.value = isEdit ? existingTemplate.content : '';

        // Hint ze zmiennymi (wstawianie będzie przez SimpleMDE API)
        const hint = document.createElement('div');
        hint.className = 'tt-variables-hint';
        hint.innerHTML = 'Dostępne zmienne (kliknij aby wstawić): ' +
            Object.entries(VARIABLES).map(([key, v]) =>
                `<code title="${escHtml(v.label)}" data-var="{{${key}}}">{{${key}}}</code>`
            ).join(' ');

        // Getter — zwraca wartość z SimpleMDE lub textarea
        let mdeInstance = null;
        function getContent() {
            return mdeInstance ? mdeInstance.value() : inputContent.value;
        }

        function insertIntoEditor(tag) {
            if (mdeInstance) {
                const cm = mdeInstance.codemirror;
                cm.replaceSelection(tag);
                cm.focus();
            } else {
                const pos = inputContent.selectionStart || 0;
                const before = inputContent.value.substring(0, pos);
                const after = inputContent.value.substring(inputContent.selectionEnd || 0);
                inputContent.value = before + tag + after;
                inputContent.focus();
                const newPos = pos + tag.length;
                inputContent.setSelectionRange(newPos, newPos);
            }
            if (typeof schedulePreviewUpdate === 'function') schedulePreviewUpdate();
        }

        // Zwijany panel „Dostępne zmienne — pełna legenda"
        const legend = buildVariablesLegend(insertIntoEditor);

        // ---- Sekcja: Ustawienia formularza (zwijana) ----
        const existingFS = (isEdit && existingTemplate.formSettings) ? existingTemplate.formSettings : {};

        const formSettingsWrap = document.createElement('div');
        formSettingsWrap.className = 'tt-form-settings';

        const fsToggle = btn();
        fsToggle.className = 'tt-form-settings-toggle';
        fsToggle.textContent = 'Ustawienia formularza ticketu \u25BC';
        fsToggle.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:#f0f4f8;border:1px solid #dce3ea;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;color:#555;margin-top:8px;';
        const fsBody = document.createElement('div');
        fsBody.style.cssText = 'display:none;padding:10px 0;';
        fsToggle.onclick = () => {
            const open = fsBody.style.display !== 'none';
            fsBody.style.display = open ? 'none' : 'block';
            fsToggle.textContent = 'Ustawienia formularza ticketu ' + (open ? '\u25BC' : '\u25B2');
            if (!open) {
                // Przescrolluj kontener modalu aby przyciski na dole były widoczne
                setTimeout(() => {
                    const scrollable = formSettingsWrap.closest('.tt-m-content');
                    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
                }, 50);
            }
        };

        // Helper — tworzy wiersz ustawienia
        function fsRow(labelText, inputEl) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
            const lbl = document.createElement('label');
            lbl.textContent = labelText;
            lbl.style.cssText = 'min-width:180px;font-size:12px;color:#555;flex-shrink:0;';
            inputEl.style.cssText = (inputEl.style.cssText || '') + 'flex:1;font-size:12px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;';
            row.appendChild(lbl);
            row.appendChild(inputEl);
            return row;
        }

        // Type of message
        const fsTextType = document.createElement('select');
        [
            { value: '', label: '-- Nie zmieniaj --' },
            { value: 'unset', label: 'undetermined' },
            { value: 'comment', label: 'comment' },
            { value: 'open', label: 'reply (open)' },
            { value: 'closed', label: 'ticket (close)' },
            { value: 'closed_reopen', label: 'ticket (close and reopen)' }
        ].forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (existingFS.textType === o.value) opt.selected = true;
            fsTextType.appendChild(opt);
        });

        // Assigned to — pobierz opcje z formularza strony
        const fsAssigned = document.createElement('select');
        const assignedNone = document.createElement('option');
        assignedNone.value = ''; assignedNone.textContent = '-- Nie zmieniaj --';
        fsAssigned.appendChild(assignedNone);
        readPageSelectOptions('fg_assigned').forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (existingFS.assigned === o.value) opt.selected = true;
            fsAssigned.appendChild(opt);
        });

        // Change ticket type
        const fsNewType = document.createElement('select');
        const typeNone = document.createElement('option');
        typeNone.value = ''; typeNone.textContent = '-- Nie zmieniaj --';
        fsNewType.appendChild(typeNone);
        readPageSelectOptions(document.getElementById('fg_newType') ? 'fg_newType' : 'fg_typeId').forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (existingFS.newType === o.value) opt.selected = true;
            fsNewType.appendChild(opt);
        });

        // Change ticket subtype
        const fsNewSubtype = document.createElement('select');
        const subtypeNone = document.createElement('option');
        subtypeNone.value = ''; subtypeNone.textContent = '-- Nie zmieniaj --';
        fsNewSubtype.appendChild(subtypeNone);
        readPageSelectOptions('fg_newSubtype').forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (existingFS.newSubtype === o.value) opt.selected = true;
            fsNewSubtype.appendChild(opt);
        });

        // Reopen date
        const fsReopen = document.createElement('input');
        fsReopen.type = 'text';
        fsReopen.placeholder = 'YYYY-MM-DD (puste = nie zmieniaj)';
        fsReopen.value = existingFS.reopen_ymd || '';
        fsReopen.maxLength = 10;

        // SMS notification
        const fsSms = document.createElement('select');
        [
            { value: '', label: '-- Nie zmieniaj --' },
            { value: 'n', label: 'no' },
            { value: 'y', label: 'yes' }
        ].forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (existingFS.sms === o.value) opt.selected = true;
            fsSms.appendChild(opt);
        });

        // EMAIL notification
        const fsEmail = document.createElement('select');
        [
            { value: '', label: '-- Nie zmieniaj --' },
            { value: 'n', label: 'no' },
            { value: 'y', label: 'yes' }
        ].forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            if (existingFS.employeeMail === o.value) opt.selected = true;
            fsEmail.appendChild(opt);
        });

        // Getter — zbierz ustawienia formularza
        function getFormSettings() {
            const fs = {};
            if (fsTextType.value) fs.textType = fsTextType.value;
            if (fsAssigned.value) fs.assigned = fsAssigned.value;
            if (fsNewType.value) fs.newType = fsNewType.value;
            if (fsNewSubtype.value) fs.newSubtype = fsNewSubtype.value;
            if (fsReopen.value.trim()) fs.reopen_ymd = fsReopen.value.trim();
            if (fsSms.value) fs.sms = fsSms.value;
            if (fsEmail.value) fs.employeeMail = fsEmail.value;
            return Object.keys(fs).length > 0 ? fs : null;
        }

        fsBody.appendChild(fsRow('Type of message', fsTextType));
        fsBody.appendChild(fsRow('Assigned to', fsAssigned));
        fsBody.appendChild(fsRow('Change ticket type', fsNewType));
        fsBody.appendChild(fsRow('Change ticket subtype', fsNewSubtype));
        fsBody.appendChild(fsRow('Reopen date', fsReopen));
        fsBody.appendChild(fsRow('SMS notification', fsSms));
        fsBody.appendChild(fsRow('EMAIL notification', fsEmail));

        const fsResetBtn = btn();
        fsResetBtn.textContent = 'Resetuj ustawienia';
        fsResetBtn.style.cssText = 'margin-top:8px;padding:4px 12px;font-size:11px;color:#999;border:1px solid #ddd;border-radius:4px;cursor:pointer;background:#fff;';
        fsResetBtn.onmouseenter = () => { fsResetBtn.style.color = '#d9534f'; fsResetBtn.style.borderColor = '#d9534f'; };
        fsResetBtn.onmouseleave = () => { fsResetBtn.style.color = '#999'; fsResetBtn.style.borderColor = '#ddd'; };
        fsResetBtn.onclick = () => {
            fsTextType.value = '';
            fsAssigned.value = '';
            fsNewType.value = '';
            fsNewSubtype.value = '';
            fsReopen.value = '';
            fsSms.value = '';
            fsEmail.value = '';
        };
        fsBody.appendChild(fsResetBtn);

        formSettingsWrap.appendChild(fsToggle);
        formSettingsWrap.appendChild(fsBody);

        // Przyciski
        const formActions = document.createElement('div');
        formActions.className = 'tt-form-actions';

        const btnCancel = btn();
        btnCancel.className = 'tt-form-btn-cancel';
        btnCancel.textContent = 'Anuluj';
        btnCancel.onclick = () => {
            if (mdeInstance) { mdeInstance.toTextArea(); mdeInstance = null; }
            renderTemplatesTab(container);
        };

        const btnSave = btn();
        btnSave.className = 'tt-form-btn-save';
        btnSave.textContent = isEdit ? 'Zapisz zmiany' : 'Utwórz szablon';
        btnSave.onclick = () => {
            const name = inputName.value.trim();
            const content = getContent();
            if (!name) return alert('Nazwa szablonu jest wymagana');
            if (!content) return alert('Treść szablonu jest wymagana');

            const data = loadData();
            const fs = getFormSettings();
            if (isEdit) {
                const tpl = data.templates.find(t => t.id === existingTemplate.id);
                if (tpl) {
                    tpl.name = name;
                    tpl.category = inputCat.value;
                    tpl.content = content;
                    tpl.formSettings = fs;
                    tpl.updatedAt = new Date().toISOString();
                }
            } else {
                data.templates.push({
                    id: generateId('t'),
                    name: name,
                    content: content,
                    category: inputCat.value,
                    formSettings: fs,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
            if (mdeInstance) { mdeInstance.toTextArea(); mdeInstance = null; }
            saveData(data);
            refreshSelectors();
            renderTemplatesTab(container);
        };

        // Live preview — panel z rozwiniętymi zmiennymi
        let previewBox = null;
        let previewContent = null;
        let previewTimer = null;

        function updatePreview() {
            if (!previewBox || !previewContent) return;
            const content = getContent();
            if (!content.trim()) {
                previewContent.textContent = '(pusty szablon)';
                previewContent.style.color = '#999';
                return;
            }
            let resolved = resolveVariables(content);
            const data = loadData();
            if (data.settings.autoAppendSignature && !content.includes('{{podpis}}')) {
                const sig = data.signatures.find(s => s.isDefault);
                if (sig) resolved += '\n\n' + sig.content;
            }
            previewContent.innerHTML = markdownToHtml(resolved);
            previewContent.style.color = '#333';
        }

        function schedulePreviewUpdate() {
            if (previewTimer) clearTimeout(previewTimer);
            previewTimer = setTimeout(updatePreview, 150);
        }

        const btnPreviewFinal = btn();
        btnPreviewFinal.className = 'tt-form-btn-preview';
        btnPreviewFinal.textContent = 'Podgląd finalny';
        btnPreviewFinal.onclick = () => {
            if (previewBox) {
                previewBox.remove();
                previewBox = null;
                previewContent = null;
                btnPreviewFinal.textContent = 'Podgląd finalny';
                return;
            }
            previewBox = document.createElement('div');
            previewBox.className = 'tt-form-preview';
            previewBox.style.cssText = 'margin-top:12px;padding:14px 16px;background:#f8f9fa;border:1px solid #e0e0e0;border-radius:6px;font-size:13px;line-height:1.6;max-height:300px;overflow-y:auto;';
            const previewLabel = document.createElement('div');
            previewLabel.style.cssText = 'font-size:11px;color:#999;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;';
            previewLabel.textContent = 'Podgląd z rozwiniętymi zmiennymi (live)';
            previewContent = document.createElement('div');
            previewContent.style.cssText = 'line-height:1.6;';
            previewBox.appendChild(previewLabel);
            previewBox.appendChild(previewContent);
            form.insertBefore(previewBox, formActions);
            btnPreviewFinal.textContent = 'Ukryj podgląd';
            updatePreview();
        };

        formActions.appendChild(btnCancel);
        formActions.appendChild(btnPreviewFinal);
        formActions.appendChild(btnSave);

        form.appendChild(lblName);
        form.appendChild(inputName);
        form.appendChild(lblCat);
        form.appendChild(inputCat);
        form.appendChild(lblContent);
        form.appendChild(inputContent);
        form.appendChild(hint);
        form.appendChild(legend);
        form.appendChild(formSettingsWrap);
        form.appendChild(formActions);
        container.appendChild(form);

        // Pomocnicze — prefixuj zaznaczone linie (lub wstaw nowe)
        function prefixSelectedLines(cm, prefix) {
            var sel = cm.getSelection();
            if (sel) {
                var lines = sel.split('\n').map(function (l) {
                    return l.trim() ? prefix + l.trim() : l;
                });
                cm.replaceSelection(lines.join('\n'));
            } else {
                cm.replaceSelection(prefix);
            }
            cm.focus();
        }

        // Pomocnicze — popup z opcjami przy klikniętym przycisku toolbara
        function showEditorPopup(editor, btnClassName, items, onSelect) {
            // Zamknij istniejące popupy
            document.querySelectorAll('.tt-editor-popup').forEach(function (el) { el.remove(); });

            var cm = editor.codemirror;
            // Znajdź toolbar — sibling CodeMirror wrappera
            var wrapper = cm.getWrapperElement().parentNode;
            var toolbar = wrapper ? wrapper.querySelector('.editor-toolbar') : null;
            var anchorBtn = toolbar ? toolbar.querySelector('.' + btnClassName) : null;

            var popup = document.createElement('div');
            popup.className = 'tt-editor-popup';
            popup.style.cssText = 'position:fixed;z-index:2000020;background:#fff;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:6px;display:flex;flex-wrap:wrap;gap:3px;max-width:240px;';

            if (anchorBtn) {
                var rect = anchorBtn.getBoundingClientRect();
                popup.style.top = (rect.bottom + 4) + 'px';
                popup.style.left = rect.left + 'px';
            } else {
                // Fallback — środek ekranu
                popup.style.top = '40%';
                popup.style.left = '50%';
                popup.style.transform = 'translate(-50%, -50%)';
            }

            items.forEach(function (item) {
                var opt = document.createElement('button');
                opt.type = 'button';
                opt.textContent = item.label;
                opt.title = item.label;
                opt.style.cssText = 'padding:5px 10px;border:1px solid #eee;border-radius:4px;cursor:pointer;font-size:13px;background:#fff;white-space:nowrap;transition:background 0.1s;';
                opt.onmouseenter = function () { opt.style.background = '#eef4fb'; };
                opt.onmouseleave = function () { opt.style.background = '#fff'; };
                opt.onclick = function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    popup.remove();
                    onSelect(item.char, cm);
                };
                popup.appendChild(opt);
            });

            document.body.appendChild(popup);

            // Zamknij popup przy kliknięciu poza nim
            setTimeout(function () {
                document.addEventListener('mousedown', function closePopup(e) {
                    if (!popup.contains(e.target)) {
                        popup.remove();
                        document.removeEventListener('mousedown', closePopup);
                    }
                });
            }, 10);
        }

        // Pomocnicze — obsługa Enter w liście ramkowej ╠
        function setupFrameListEnter(cm) {
            cm.addKeyMap({
                'Enter': function (cm) {
                    var cursor = cm.getCursor();
                    var line = cm.getLine(cursor.line);
                    // Jeśli linia zaczyna się od ╠ i ma treść
                    if (/^\u2560\s.+/.test(line)) {
                        cm.replaceRange('\n\u2551\n\u2560 ', { line: cursor.line, ch: line.length });
                        return;
                    }
                    // Jeśli linia to pusty ╠ (zakończ listę)
                    if (/^\u2560\s*$/.test(line)) {
                        cm.replaceRange('\u255D', { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
                        cm.setCursor({ line: cursor.line, ch: 1 });
                        return;
                    }
                    // Standardowy Enter
                    return cm.constructor.Pass;
                }
            });
        }

        // Pomocnicze — modal z pickerem znaków/emotikon
        function showCharPickerModal(editor) {
            // Zamknij istniejące popupy
            document.querySelectorAll('.tt-char-picker-modal').forEach(function (el) { el.remove(); });

            var cm = editor.codemirror;
            var categories = Object.keys(CHAR_SETS);

            // Overlay
            var overlay = document.createElement('div');
            overlay.className = 'tt-char-picker-modal';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.35);z-index:2000030;display:flex;align-items:center;justify-content:center;';

            // Modal
            var modal = document.createElement('div');
            modal.style.cssText = 'background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.25);width:520px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';

            // Header
            var header = document.createElement('div');
            header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;';
            var title = document.createElement('span');
            title.textContent = 'Znaki i emotikony';
            title.style.cssText = 'font-weight:600;font-size:15px;';
            var closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.textContent = '\u2715';
            closeBtn.style.cssText = 'background:none;border:none;font-size:18px;cursor:pointer;color:#999;padding:2px 6px;';
            closeBtn.onclick = function () { overlay.remove(); cm.focus(); };
            header.appendChild(title);
            header.appendChild(closeBtn);

            // Szukajka
            var searchBox = document.createElement('div');
            searchBox.style.cssText = 'padding:8px 16px;border-bottom:1px solid #eee;';
            var searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = 'Szukaj znaku...';
            searchInput.style.cssText = 'width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:5px;font-size:13px;box-sizing:border-box;outline:none;';
            searchBox.appendChild(searchInput);

            // Tabs (kategorie)
            var tabBar = document.createElement('div');
            tabBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px;padding:8px 16px;border-bottom:1px solid #eee;';

            // Grid znaków
            var gridWrap = document.createElement('div');
            gridWrap.style.cssText = 'padding:12px 16px;overflow-y:auto;flex:1;';
            var grid = document.createElement('div');
            grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
            gridWrap.appendChild(grid);

            var activeCategory = categories[0];

            function renderGrid(filterText) {
                grid.innerHTML = '';
                var chars = CHAR_SETS[activeCategory].split(' ').filter(function (c) { return c.trim(); });
                if (filterText) {
                    // Szukaj we wszystkich kategoriach
                    chars = [];
                    categories.forEach(function (cat) {
                        CHAR_SETS[cat].split(' ').forEach(function (c) {
                            if (c.trim() && chars.indexOf(c) === -1) chars.push(c);
                        });
                    });
                    // Filtr to w zasadzie dopasowanie znaku — przydatne przy emoji
                    var ft = filterText.toLowerCase();
                    chars = chars.filter(function (c) { return c.toLowerCase().indexOf(ft) !== -1; });
                }
                if (chars.length === 0) {
                    var empty = document.createElement('div');
                    empty.textContent = 'Brak wyników';
                    empty.style.cssText = 'color:#999;font-size:13px;padding:12px;';
                    grid.appendChild(empty);
                    return;
                }
                chars.forEach(function (ch) {
                    var cell = document.createElement('button');
                    cell.type = 'button';
                    cell.textContent = ch;
                    cell.title = 'U+' + ch.codePointAt(0).toString(16).toUpperCase();
                    cell.style.cssText = 'width:36px;height:36px;font-size:18px;border:1px solid #eee;border-radius:5px;cursor:pointer;background:#fff;display:flex;align-items:center;justify-content:center;transition:background 0.1s,transform 0.1s;';
                    cell.onmouseenter = function () { cell.style.background = '#eef4fb'; cell.style.transform = 'scale(1.15)'; };
                    cell.onmouseleave = function () { cell.style.background = '#fff'; cell.style.transform = 'scale(1)'; };
                    cell.onclick = function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        cm.replaceSelection(ch);
                        cm.focus();
                        // Nie zamykaj modalu — pozwól wstawiać wiele znaków
                    };
                    grid.appendChild(cell);
                });
            }

            function renderTabs() {
                tabBar.innerHTML = '';
                categories.forEach(function (cat) {
                    var tab = document.createElement('button');
                    tab.type = 'button';
                    tab.textContent = cat;
                    tab.style.cssText = 'padding:5px 12px;border:1px solid ' + (cat === activeCategory ? ACCENT_COLOR : '#ddd') + ';border-radius:15px;cursor:pointer;font-size:12px;background:' + (cat === activeCategory ? ACCENT_COLOR : '#fff') + ';color:' + (cat === activeCategory ? '#fff' : '#333') + ';transition:all 0.15s;white-space:nowrap;';
                    tab.onclick = function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        activeCategory = cat;
                        searchInput.value = '';
                        renderTabs();
                        renderGrid();
                    };
                    tabBar.appendChild(tab);
                });
            }

            searchInput.oninput = function () {
                var val = searchInput.value.trim();
                renderGrid(val || null);
            };

            // Zamknij na Escape
            overlay.onkeydown = function (e) {
                if (e.key === 'Escape') { overlay.remove(); cm.focus(); }
            };
            // Zamknij kliknięciem w overlay (poza modalem)
            overlay.onclick = function (e) {
                if (e.target === overlay) { overlay.remove(); cm.focus(); }
            };

            modal.appendChild(header);
            modal.appendChild(searchBox);
            modal.appendChild(tabBar);
            modal.appendChild(gridWrap);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            renderTabs();
            renderGrid();
            searchInput.focus();
        }

        // Inicjalizacja SimpleMDE po wstawieniu do DOM
        if (typeof SimpleMDE !== 'undefined') {
            try {
                mdeInstance = new SimpleMDE({
                    element: inputContent,
                    spellChecker: false,
                    status: false,
                    placeholder: 'Dzień dobry,\n\nTreść wiadomości...\n\n{{podpis}}',
                    toolbar: [
                        'bold', 'italic', '|',
                        'unordered-list', 'ordered-list',
                        {
                            name: 'indent-list',
                            action: function (editor) {
                                var cm = editor.codemirror;
                                var ranges = cm.listSelections();
                                for (var i = 0; i < ranges.length; i++) {
                                    var from = ranges[i].from().line;
                                    var to = ranges[i].to().line;
                                    for (var j = from; j <= to; j++) {
                                        cm.indentLine(j, 'add');
                                    }
                                }
                                cm.focus();
                            },
                            className: 'fa fa-indent',
                            title: 'Zagnieźdź listę (Tab)'
                        },
                        {
                            name: 'outdent-list',
                            action: function (editor) {
                                var cm = editor.codemirror;
                                var ranges = cm.listSelections();
                                for (var i = 0; i < ranges.length; i++) {
                                    var from = ranges[i].from().line;
                                    var to = ranges[i].to().line;
                                    for (var j = from; j <= to; j++) {
                                        cm.indentLine(j, 'subtract');
                                    }
                                }
                                cm.focus();
                            },
                            className: 'fa fa-outdent',
                            title: 'Cofnij zagnieżdżenie (Shift+Tab)'
                        },
                        {
                            name: 'bullet-picker',
                            action: function (editor) {
                                showEditorPopup(editor, 'fa-th-list', [
                                    { char: '\u2022', label: '\u2022 Bullet' },
                                    { char: '\u25B6', label: '\u25B6 Trójkąt' },
                                    { char: '\u25B7', label: '\u25B7 Trójkąt pusty' },
                                    { char: '\u25C6', label: '\u25C6 Romb' },
                                    { char: '\u25A0', label: '\u25A0 Kwadrat' },
                                    { char: '\u25A1', label: '\u25A1 Kwadrat pusty' },
                                    { char: '\u27A7', label: '\u27A7 Strzałka zakr.' },
                                    { char: '\u279C', label: '\u279C Strzałka' },
                                    { char: '\u27AD', label: '\u27AD Strzałka 3D' },
                                    { char: '\u27A1\uFE0F', label: '\u27A1\uFE0F Strzałka prawa' }
                                ], function (char, cm) {
                                    prefixSelectedLines(cm, char + ' ');
                                });
                            },
                            className: 'fa fa-th-list',
                            title: 'Własny bullet listy'
                        },
                        '|',
                        {
                            name: 'checklist',
                            action: function (editor) {
                                prefixSelectedLines(editor.codemirror, '\u2713 ');
                            },
                            className: 'fa fa-check',
                            title: 'Lista kontrolna \u2713'
                        },
                        {
                            name: 'task-picker',
                            action: function (editor) {
                                showEditorPopup(editor, 'fa-check-square-o', [
                                    { char: '\u2610', label: '\u2610 Do zrobienia' },
                                    { char: '\u2611', label: '\u2611 Wykonane' },
                                    { char: '\u2612', label: '\u2612 Nie wykonane' }
                                ], function (char, cm) {
                                    prefixSelectedLines(cm, char + ' ');
                                });
                            },
                            className: 'fa fa-check-square-o',
                            title: 'Zadanie \u2610 \u2611 \u2612'
                        },
                        {
                            name: 'frame-list',
                            action: function (editor) {
                                var cm = editor.codemirror;
                                var sel = cm.getSelection();
                                if (sel) {
                                    // Owij zaznaczenie w ramkę
                                    var lines = sel.split('\n').filter(function(l) { return l.trim(); });
                                    var result = '\u2557\n';
                                    lines.forEach(function (line, i) {
                                        result += '\u2560 ' + line.trim() + '\n';
                                        if (i < lines.length - 1) result += '\u2551\n';
                                    });
                                    result += '\u255D';
                                    cm.replaceSelection(result);
                                } else {
                                    // Wstaw początek — Enter kontynuuje
                                    cm.replaceSelection('\u2557\n\u2560 ');
                                }
                                cm.focus();
                            },
                            className: 'fa fa-columns',
                            title: 'Lista ramkowa (Enter = nowa pozycja, pusty Enter = zamknij)'
                        },
                        '|',
                        {
                            name: 'char-picker',
                            action: function (editor) {
                                showCharPickerModal(editor);
                            },
                            className: 'fa fa-smile-o',
                            title: 'Znaki i emotikony'
                        },
                        '|',
                        'quote', 'code',
                        {
                            name: 'iai-link',
                            action: function (editor) {
                                var cm = editor.codemirror;
                                var selectedText = cm.getSelection();
                                var url = prompt('Podaj URL:', 'http://');
                                if (!url) return;
                                var label = selectedText || prompt('Podaj tekst linku:', '') || url;
                                cm.replaceSelection('[' + url + ' ' + label + ']');
                                cm.focus();
                            },
                            className: 'fa fa-link',
                            title: 'Wstaw link [url tekst]'
                        },
                        '|',
                        'preview', 'side-by-side', 'fullscreen'
                    ],
                    minHeight: '150px',
                    tabSize: 2,
                    indentWithTabs: false
                });
                // Obsługa Enter w liście ramkowej
                setupFrameListEnter(mdeInstance.codemirror);
                // Live preview — aktualizacja przy każdej zmianie
                mdeInstance.codemirror.on('change', schedulePreviewUpdate);
                // Kliknięcie zmiennej wstawia do SimpleMDE
                hint.querySelectorAll('code').forEach(codeEl => {
                    codeEl.onclick = () => {
                        const cm = mdeInstance.codemirror;
                        cm.replaceSelection(codeEl.dataset.var);
                        cm.focus();
                    };
                });
            } catch (e) {
                console.warn(PREFIX, 'Nie udało się zainicjować SimpleMDE:', e);
                // Fallback — kliknięcie zmiennej wstawia do zwykłej textarea
                hint.querySelectorAll('code').forEach(codeEl => {
                    codeEl.onclick = () => {
                        const pos = inputContent.selectionStart;
                        const before = inputContent.value.substring(0, pos);
                        const after = inputContent.value.substring(inputContent.selectionEnd);
                        inputContent.value = before + codeEl.dataset.var + after;
                        inputContent.focus();
                        const newPos = pos + codeEl.dataset.var.length;
                        inputContent.setSelectionRange(newPos, newPos);
                    };
                });
            }
        } else {
            // Brak SimpleMDE — fallback do plain textarea
            hint.querySelectorAll('code').forEach(codeEl => {
                codeEl.onclick = () => {
                    const pos = inputContent.selectionStart;
                    const before = inputContent.value.substring(0, pos);
                    const after = inputContent.value.substring(inputContent.selectionEnd);
                    inputContent.value = before + codeEl.dataset.var + after;
                    inputContent.focus();
                    const newPos = pos + codeEl.dataset.var.length;
                    inputContent.setSelectionRange(newPos, newPos);
                };
            });
        }

        inputName.focus();
    }

    // -----------------------------------------------------------------------
    // Tab: Kategorie
    // -----------------------------------------------------------------------
    function renderCategoriesTab(container) {
        const data = loadData();
        container.innerHTML = '';

        const actions = document.createElement('div');
        actions.className = 'tt-section-actions';
        const btnAdd = btn();
        btnAdd.className = 'tt-btn-add';
        btnAdd.textContent = '+ Nowa kategoria';
        btnAdd.onclick = () => showCategoryForm(container, null);
        actions.appendChild(btnAdd);
        container.appendChild(actions);

        if (data.categories.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tt-empty';
            empty.textContent = 'Brak kategorii. Kliknij "+ Nowa kategoria" aby dodać pierwszą.';
            container.appendChild(empty);
            return;
        }

        data.categories.forEach(cat => {
            const item = document.createElement('div');
            item.className = 'tt-list-item';

            const badge = document.createElement('span');
            badge.className = 'tt-li-category';
            badge.textContent = cat.name;
            badge.style.background = cat.color;
            badge.style.display = 'inline-block';

            const name = document.createElement('span');
            name.className = 'tt-li-name';
            name.textContent = cat.name;

            const count = document.createElement('span');
            count.style.cssText = 'flex-shrink:0;font-size:11px;color:#999;margin-left:6px;margin-right:8px;white-space:nowrap;';
            const tplCount = data.templates.filter(t => t.category === cat.name).length;
            count.textContent = '(' + tplCount + ' szt.)';

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'tt-li-actions';

            const btnEdit = btn();
            btnEdit.textContent = 'Edytuj';
            btnEdit.onclick = () => showCategoryForm(container, cat);

            const btnDelete = btn();
            btnDelete.className = 'tt-btn-danger';
            btnDelete.textContent = 'Usuń';
            btnDelete.onclick = () => {
                const tplCount = loadData().templates.filter(t => t.category === cat.name).length;
                const msg = tplCount > 0
                    ? 'Kategoria "' + cat.name + '" zawiera ' + tplCount + ' szablonów. Szablony nie zostaną usunięte, tylko stracą przypisanie. Kontynuować?'
                    : 'Czy na pewno usunąć kategorię "' + cat.name + '"?';
                if (!confirm(msg)) return;
                const d = loadData();
                d.templates.forEach(t => { if (t.category === cat.name) t.category = ''; });
                d.categories = d.categories.filter(c => c.id !== cat.id);
                saveData(d);
                refreshSelectors();
                renderCategoriesTab(container);
            };

            actionsDiv.appendChild(btnEdit);
            actionsDiv.appendChild(btnDelete);

            item.appendChild(badge);
            item.appendChild(name);
            item.appendChild(count);
            item.appendChild(actionsDiv);
            container.appendChild(item);
        });
    }

    // -----------------------------------------------------------------------
    // Formularz edycji kategorii
    // -----------------------------------------------------------------------
    function showCategoryForm(container, existingCategory) {
        container.innerHTML = '';
        const isEdit = !!existingCategory;

        const form = document.createElement('div');
        form.className = 'tt-form';

        const lblName = document.createElement('label');
        lblName.textContent = 'Nazwa kategorii';
        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.placeholder = 'np. Import, Ogólne, Zakończenie';
        inputName.value = isEdit ? existingCategory.name : '';

        const lblColor = document.createElement('label');
        lblColor.textContent = 'Kolor';
        const colorPicker = document.createElement('div');
        colorPicker.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;';
        let selectedColor = isEdit ? existingCategory.color : CATEGORY_COLORS[0];

        CATEGORY_COLORS.forEach(color => {
            const swatch = document.createElement('div');
            swatch.style.cssText = 'width:28px;height:28px;border-radius:6px;cursor:pointer;border:3px solid transparent;transition:border-color 0.15s;';
            swatch.style.background = color;
            if (color === selectedColor) swatch.style.borderColor = '#333';
            swatch.onclick = () => {
                selectedColor = color;
                colorPicker.querySelectorAll('div').forEach(s => s.style.borderColor = 'transparent');
                swatch.style.borderColor = '#333';
            };
            colorPicker.appendChild(swatch);
        });

        const formActions = document.createElement('div');
        formActions.className = 'tt-form-actions';

        const btnCancel = btn();
        btnCancel.className = 'tt-form-btn-cancel';
        btnCancel.textContent = 'Anuluj';
        btnCancel.onclick = () => renderCategoriesTab(container);

        const btnSave = btn();
        btnSave.className = 'tt-form-btn-save';
        btnSave.textContent = isEdit ? 'Zapisz zmiany' : 'Utwórz kategorię';
        btnSave.onclick = () => {
            const name = inputName.value.trim();
            if (!name) return alert('Nazwa kategorii jest wymagana');

            const data = loadData();
            if (isEdit) {
                const cat = data.categories.find(c => c.id === existingCategory.id);
                if (cat) {
                    const oldName = cat.name;
                    cat.name = name;
                    cat.color = selectedColor;
                    // Zaktualizuj szablony z tą kategorią
                    if (oldName !== name) {
                        data.templates.forEach(t => { if (t.category === oldName) t.category = name; });
                    }
                }
            } else {
                if (data.categories.some(c => c.name === name)) return alert('Kategoria o tej nazwie już istnieje');
                data.categories.push({
                    id: generateId('c'),
                    name: name,
                    color: selectedColor
                });
            }
            saveData(data);
            refreshSelectors();
            renderCategoriesTab(container);
        };

        formActions.appendChild(btnCancel);
        formActions.appendChild(btnSave);

        form.appendChild(lblName);
        form.appendChild(inputName);
        form.appendChild(lblColor);
        form.appendChild(colorPicker);
        form.appendChild(formActions);
        container.appendChild(form);

        inputName.focus();
    }

    // -----------------------------------------------------------------------
    // Tab: Podpisy
    // -----------------------------------------------------------------------
    function renderSignaturesTab(container) {
        const data = loadData();
        container.innerHTML = '';

        const actions = document.createElement('div');
        actions.className = 'tt-section-actions';

        const btnAdd = btn();
        btnAdd.className = 'tt-btn-add';
        btnAdd.textContent = '+ Nowy podpis';
        btnAdd.onclick = () => showSignatureForm(container, null);

        actions.appendChild(btnAdd);
        container.appendChild(actions);

        if (data.signatures.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'tt-empty';
            empty.textContent = 'Brak podpisów. Kliknij "+ Nowy podpis" aby dodać pierwszy.';
            container.appendChild(empty);
            return;
        }

        data.signatures.forEach(sig => {
            const item = document.createElement('div');
            item.className = 'tt-list-item';

            const defaultMark = document.createElement('span');
            defaultMark.className = 'tt-li-default';
            defaultMark.textContent = sig.isDefault ? '\u2605' : '';
            defaultMark.title = sig.isDefault ? 'Domyślny podpis' : '';

            const name = document.createElement('span');
            name.className = 'tt-li-name';
            name.textContent = sig.name;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'tt-li-actions';

            const btnDefault = btn();
            btnDefault.textContent = sig.isDefault ? 'Domyślny' : 'Ustaw domyślny';
            btnDefault.disabled = sig.isDefault;
            btnDefault.style.opacity = sig.isDefault ? '0.5' : '1';
            btnDefault.onclick = () => {
                const d = loadData();
                d.signatures.forEach(s => { s.isDefault = (s.id === sig.id); });
                saveData(d);
                renderSignaturesTab(container);
            };

            const btnEdit = btn();
            btnEdit.textContent = 'Edytuj';
            btnEdit.onclick = () => showSignatureForm(container, sig);

            const btnDelete = btn();
            btnDelete.className = 'tt-btn-danger';
            btnDelete.textContent = 'Usuń';
            btnDelete.onclick = () => {
                if (!confirm('Czy na pewno usunąć podpis "' + sig.name + '"?')) return;
                const d = loadData();
                d.signatures = d.signatures.filter(s => s.id !== sig.id);
                saveData(d);
                renderSignaturesTab(container);
            };

            actionsDiv.appendChild(btnDefault);
            actionsDiv.appendChild(btnEdit);
            actionsDiv.appendChild(btnDelete);

            item.appendChild(defaultMark);
            item.appendChild(name);
            item.appendChild(actionsDiv);
            container.appendChild(item);
        });
    }

    // -----------------------------------------------------------------------
    // Formularz edycji podpisu
    // -----------------------------------------------------------------------
    function showSignatureForm(container, existingSignature) {
        container.innerHTML = '';
        const isEdit = !!existingSignature;

        const form = document.createElement('div');
        form.className = 'tt-form';

        const lblName = document.createElement('label');
        lblName.textContent = 'Nazwa podpisu';
        const inputName = document.createElement('input');
        inputName.type = 'text';
        inputName.placeholder = 'np. Standardowy, Formalny';
        inputName.value = isEdit ? existingSignature.name : '';

        const lblContent = document.createElement('label');
        lblContent.textContent = 'Treść podpisu';
        const inputContent = document.createElement('textarea');
        inputContent.style.minHeight = '80px';
        inputContent.placeholder = 'Pozdrawiam,\nMaciej Dobroń';
        inputContent.value = isEdit ? existingSignature.content : '';

        // Legenda zmiennych — treść podpisu rozwija te same zmienne co szablon
        // (dzięki dwuprzebiegowej resolveVariables).
        const sigLegend = buildVariablesLegend((tag) => {
            const pos = inputContent.selectionStart || 0;
            const before = inputContent.value.substring(0, pos);
            const after = inputContent.value.substring(inputContent.selectionEnd || 0);
            inputContent.value = before + tag + after;
            inputContent.focus();
            const newPos = pos + tag.length;
            inputContent.setSelectionRange(newPos, newPos);
        });

        const formActions = document.createElement('div');
        formActions.className = 'tt-form-actions';

        const btnCancel = btn();
        btnCancel.className = 'tt-form-btn-cancel';
        btnCancel.textContent = 'Anuluj';
        btnCancel.onclick = () => renderSignaturesTab(container);

        const btnSave = btn();
        btnSave.className = 'tt-form-btn-save';
        btnSave.textContent = isEdit ? 'Zapisz zmiany' : 'Utwórz podpis';
        btnSave.onclick = () => {
            const name = inputName.value.trim();
            const content = inputContent.value;
            if (!name) return alert('Nazwa podpisu jest wymagana');
            if (!content) return alert('Treść podpisu jest wymagana');

            const data = loadData();
            if (isEdit) {
                const sig = data.signatures.find(s => s.id === existingSignature.id);
                if (sig) {
                    sig.name = name;
                    sig.content = content;
                }
            } else {
                const isFirst = data.signatures.length === 0;
                data.signatures.push({
                    id: generateId('s'),
                    name: name,
                    content: content,
                    isDefault: isFirst
                });
            }
            saveData(data);
            renderSignaturesTab(container);
        };

        formActions.appendChild(btnCancel);
        formActions.appendChild(btnSave);

        form.appendChild(lblName);
        form.appendChild(inputName);
        form.appendChild(lblContent);
        form.appendChild(inputContent);
        form.appendChild(sigLegend);
        form.appendChild(formActions);
        container.appendChild(form);

        inputName.focus();
    }

    // -----------------------------------------------------------------------
    // Tab: Ustawienia
    // -----------------------------------------------------------------------
    function renderSettingsTab(container) {
        const data = loadData();
        container.innerHTML = '';

        // Tryb UI
        const row1 = document.createElement('div');
        row1.className = 'tt-setting-row';
        const lbl1 = document.createElement('label');
        lbl1.textContent = 'Tryb interfejsu';
        const sel1 = document.createElement('select');
        [
            { value: 'toolbar', label: 'Toolbar nad polem tekstowym' },
            { value: 'fab', label: 'Pływający przycisk (FAB)' },
            { value: 'both', label: 'Oba (toolbar + FAB)' }
        ].forEach(opt => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            if (opt.value === data.settings.uiMode) o.selected = true;
            sel1.appendChild(o);
        });
        sel1.onchange = () => {
            const d = loadData();
            d.settings.uiMode = sel1.value;
            saveData(d);
            applyUIMode(sel1.value);
        };
        row1.appendChild(lbl1);
        row1.appendChild(sel1);

        // Auto-podpis
        const row2 = document.createElement('div');
        row2.className = 'tt-setting-row';
        const lbl2 = document.createElement('label');
        lbl2.textContent = 'Automatycznie dodawaj podpis do szablonów';
        const chk2 = document.createElement('input');
        chk2.type = 'checkbox';
        chk2.checked = data.settings.autoAppendSignature;
        chk2.onchange = () => {
            const d = loadData();
            d.settings.autoAppendSignature = chk2.checked;
            saveData(d);
        };
        row2.appendChild(lbl2);
        row2.appendChild(chk2);

        // Auto-zapis szkiców
        const row3 = document.createElement('div');
        row3.className = 'tt-setting-row';
        const lbl3 = document.createElement('label');
        lbl3.textContent = 'Automatycznie zapisuj szkice wiadomości';
        const chk3 = document.createElement('input');
        chk3.type = 'checkbox';
        chk3.checked = data.settings.autosaveDrafts;
        chk3.onchange = () => {
            const d = loadData();
            d.settings.autosaveDrafts = chk3.checked;
            saveData(d);
        };
        row3.appendChild(lbl3);
        row3.appendChild(chk3);

        container.appendChild(row1);
        container.appendChild(row2);
        container.appendChild(row3);
    }

    // -----------------------------------------------------------------------
    // Przełączanie trybu UI
    // -----------------------------------------------------------------------
    function applyUIMode(mode) {
        const toolbar = document.getElementById('tt-toolbar');
        const fab = document.getElementById('tt-fab');
        const fabPanel = document.getElementById('tt-fab-panel');

        if (toolbar) toolbar.style.display = (mode === 'fab') ? 'none' : 'flex';
        if (fab) fab.style.display = (mode === 'toolbar') ? 'none' : 'flex';
        if (fabPanel && mode === 'toolbar') fabPanel.classList.remove('tt-visible');
    }

    // -----------------------------------------------------------------------
    // Pomocnicze — escape HTML
    // -----------------------------------------------------------------------
    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // -----------------------------------------------------------------------
    // Inicjalizacja — czekaj na textarea i uruchom UI
    // -----------------------------------------------------------------------
    function init() {
        const textarea = document.getElementById('fg_insert');
        if (!textarea) {
            console.log(PREFIX, 'Textarea #fg_insert nie znaleziona — pomijam.');
            return;
        }

        console.log(PREFIX, 'Textarea znaleziona — inicjalizuję szablony odpowiedzi.');
        injectStyles();

        const data = loadData();

        // Zawsze twórz oba elementy UI, potem ukryj zgodnie z ustawieniem
        createToolbar(textarea);
        createFAB(textarea);
        refreshSelectors();
        applyUIMode(data.settings.uiMode);

        // --- Auto-zapis szkiców ---
        if (TICKET_ID && data.settings.autosaveDrafts) {
            // Przy wpisywaniu — zapisuj szkic
            let saveTimeout = null;
            textarea.addEventListener('input', () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => saveDraft(TICKET_ID, textarea.value), 500);
            });
            console.log(PREFIX, 'Auto-zapis szkiców włączony dla ticketu', TICKET_ID);
        }

        // --- Ładowanie: szkic > domyślny szablon ---
        // Wykryj czy wiadomość została właśnie wysłana (wtedy czyścimy szkic)
        const urlP = new URLSearchParams(window.location.search);
        if (urlP.get('message') === 'ok') {
            clearDraft(TICKET_ID);
            console.log(PREFIX, 'Wiadomość wysłana — szkic wyczyszczony.');
            return; // Nie ładuj nic, IdoSell sam czyści textarea
        }

        // Tylko jeśli textarea jest pusta (IdoSell mógł sam coś wstawić)
        if (textarea.value.trim()) return;

        // Priorytet 1: Szkic
        const draft = loadDraft(TICKET_ID);
        if (draft) {
            insertIntoTextarea(textarea, draft);
            console.log(PREFIX, 'Załadowano szkic dla ticketu', TICKET_ID);
            return;
        }

        // Priorytet 2: Domyślny szablon
        if (data.settings.defaultTemplateId) {
            const tpl = data.templates.find(t => t.id === data.settings.defaultTemplateId);
            if (tpl) {
                insertTemplate(tpl.id, textarea);
                console.log(PREFIX, 'Załadowano domyślny szablon:', tpl.name);
            }
        }
    }

    // Czekaj aż textarea będzie dostępna (formularz może się ładować)
    function waitForTextarea(maxAttempts) {
        if (maxAttempts === undefined) maxAttempts = 30;
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (document.getElementById('fg_insert')) {
                clearInterval(interval);
                init();
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.log(PREFIX, 'Nie znaleziono textarea po', maxAttempts, 'próbach.');
            }
        }, 500);
    }

    // Start
    if (document.getElementById('fg_insert')) {
        init();
    } else {
        waitForTextarea();
    }

})();
