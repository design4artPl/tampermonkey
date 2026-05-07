// ==UserScript==
// @name         IdoSell Full Page Screenshot
// @namespace    https://github.com/design4artPl/tampermonkey
// @version      1.0
// @description  Pelny zrzut ekranowy stron panelu IdoSell z auto-rozwijaniem wewnetrznych kontenerow ze scrollem
// @author       our.shadows.project@gmail.com
// @match        https://shop58339-1.iai-shop.com/panel/app/products-list.php*
// @match        https://shop58339-1.iai-shop.com/panel/app/products/categories*
// @match        https://shop58339-1.iai-shop.com/panel/app/products/producers*
// @match        https://shop58339-1.iai-shop.com/panel/app/navigation.php*
// @match        https://shop58339-1.iai-shop.com/panel/app/config-system-services.php*
// @require      https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = 'idosell-screenshot-btn';
    const DEFAULT_LABEL = 'Pelny zrzut';

    function makeButton() {
        if (document.getElementById(BUTTON_ID)) return;
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.textContent = DEFAULT_LABEL;
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '2147483647',
            padding: '10px 16px',
            background: '#2c5282',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            cursor: 'pointer',
            fontFamily: 'sans-serif',
            fontSize: '13px',
            fontWeight: '600',
            letterSpacing: '0.3px',
        });
        btn.addEventListener('click', captureFullPage);
        document.body.appendChild(btn);
    }

    function setStatus(text, busy) {
        const btn = document.getElementById(BUTTON_ID);
        if (!btn) return;
        btn.textContent = text;
        btn.disabled = !!busy;
        btn.style.opacity = busy ? '0.7' : '1';
        btn.style.cursor = busy ? 'wait' : 'pointer';
    }

    function isScrollableY(el, cs) {
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight - el.clientHeight > 1;
    }

    function isScrollableX(el, cs) {
        return (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth - el.clientWidth > 1;
    }

    function expandScrollContainers() {
        const restore = [];
        const all = document.querySelectorAll('body *');
        all.forEach((el) => {
            if (!(el instanceof HTMLElement)) return;
            if (el.id === BUTTON_ID) return;
            const cs = getComputedStyle(el);
            const yScroll = isScrollableY(el, cs);
            const xScroll = isScrollableX(el, cs);
            if (!yScroll && !xScroll) return;
            restore.push({ el, cssText: el.style.cssText });
            if (yScroll) {
                el.style.maxHeight = 'none';
                el.style.height = 'auto';
                el.style.overflowY = 'visible';
            }
            if (xScroll) {
                el.style.maxWidth = 'none';
                el.style.width = 'auto';
                el.style.overflowX = 'visible';
            }
        });
        const htmlCss = document.documentElement.style.cssText;
        const bodyCss = document.body.style.cssText;
        document.documentElement.style.overflow = 'visible';
        document.body.style.overflow = 'visible';
        restore.push({ el: document.documentElement, cssText: htmlCss });
        restore.push({ el: document.body, cssText: bodyCss });
        return restore;
    }

    function restoreStyles(restore) {
        for (let i = restore.length - 1; i >= 0; i--) {
            const { el, cssText } = restore[i];
            el.style.cssText = cssText;
        }
    }

    function waitForImages() {
        const imgs = Array.from(document.images).filter((img) => !img.complete);
        if (!imgs.length) return Promise.resolve();
        return Promise.all(
            imgs.map(
                (img) =>
                    new Promise((res) => {
                        const done = () => res();
                        img.addEventListener('load', done, { once: true });
                        img.addEventListener('error', done, { once: true });
                        setTimeout(done, 4000);
                    })
            )
        );
    }

    async function scrollThroughPage() {
        const step = Math.max(window.innerHeight - 100, 200);
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y < total; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 150));
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise((r) => setTimeout(r, 200));
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 200));
    }

    function buildFilename() {
        const slug = location.pathname
            .replace(/^\/+|\/+$/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'page';
        const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
        return `idosell-${slug}-${ts}.png`;
    }

    async function captureFullPage() {
        if (typeof html2canvas !== 'function') {
            alert('html2canvas nie zostal zaladowany. Odswiez strone i sprobuj ponownie.');
            return;
        }
        const btn = document.getElementById(BUTTON_ID);
        const prevDisplay = btn.style.display;
        const originalScrollY = window.scrollY;
        const originalScrollX = window.scrollX;

        setStatus('Przygotowuje...', true);
        btn.style.display = 'none';

        const restore = expandScrollContainers();

        try {
            await scrollThroughPage();
            await waitForImages();

            const root = document.documentElement;
            const fullW = Math.max(root.scrollWidth, document.body.scrollWidth, root.clientWidth);
            const fullH = Math.max(root.scrollHeight, document.body.scrollHeight, root.clientHeight);

            const canvas = await html2canvas(document.body, {
                useCORS: true,
                allowTaint: false,
                logging: false,
                backgroundColor: '#ffffff',
                width: fullW,
                height: fullH,
                windowWidth: fullW,
                windowHeight: fullH,
                scrollX: 0,
                scrollY: 0,
                x: 0,
                y: 0,
            });

            await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Nie udalo sie stworzyc obrazu'));
                        return;
                    }
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = buildFilename();
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    resolve();
                }, 'image/png');
            });
        } catch (err) {
            console.error('[IdoSell Screenshot]', err);
            alert('Blad podczas tworzenia zrzutu: ' + (err && err.message ? err.message : err));
        } finally {
            restoreStyles(restore);
            window.scrollTo(originalScrollX, originalScrollY);
            btn.style.display = prevDisplay;
            setStatus(DEFAULT_LABEL, false);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', makeButton);
    } else {
        makeButton();
    }
})();