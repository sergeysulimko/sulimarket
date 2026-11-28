import { catalogue, sceneSizes } from './catalogue.mjs';
import { mockChrome, mockSellerFetch } from './fixtures/replies.js';
import core from '../src/core.js?raw';
import popup from '../src/popup.html?raw';
import popupCss from '../src/popup.css?raw';
import popupJs from '../src/popup.js?raw';
import promo from '../assets/promo.html?raw';
import social from '../assets/social.html?raw';
import icon from '../assets/icon.svg?raw';
import font from '../assets/fonts/InterVariable.woff2?url';
import thumbnails from '../assets/product-thumbnails.png?url&no-inline';
import { version } from '../package.json';
import ozonHtml from './fixtures/ozon.html?raw';
import wbHtml from './fixtures/wb.html?raw';
import marketCss from './fixtures/market.css?raw';

const policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; form-action 'none'; base-uri 'none'";
const blockNavigation = `for (const type of ['click', 'auxclick', 'contextmenu']) {
    document.addEventListener(type, event => {
        if (event.composedPath().some(node => node instanceof HTMLAnchorElement)) event.preventDefault();
    });
}`;

function html(body, css, scripts = '') {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="${policy}">
        <style>${css}</style></head><body>${body}<script>${blockNavigation}\n${scripts.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

function sourceDocument(source) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    doc.querySelectorAll('script,link').forEach(node => node.remove());
    return {
        body: doc.body.innerHTML,
        css: Array.from(doc.querySelectorAll('style'), node => node.textContent).join('\n')
    };
}

function popupScene(setup) {
    const { body } = sourceDocument(popup);
    return html(body, assets(popupCss), `(${mockChrome})(${JSON.stringify(setup)}, ${JSON.stringify(version)});\n${popupJs}`);
}

function assets(source) {
    return source
        .replaceAll('fonts/InterVariable.woff2', new URL(font, document.baseURI).href)
        .replaceAll('product-thumbnails.png', new URL(thumbnails, document.baseURI).href)
        .replaceAll('src="icon.svg"', `src="data:image/svg+xml,${encodeURIComponent(icon)}"`);
}

function template(source, id) {
    return new DOMParser().parseFromString(source, 'text/html').getElementById(id).innerHTML;
}

function makeStore(initial = {}) {
    const data = new Map(Object.entries(initial));
    return { get: (key, fallback) => data.get(key) ?? fallback, set: (key, value) => data.set(key, value) };
}

function localSession() {
    const items = new Map();
    return {
        getItem: key => items.get(key) ?? null,
        setItem: (key, value) => items.set(key, String(value)),
        removeItem: key => items.delete(key)
    };
}

function marketSetup(setup, { ui, actions, placeLateCard, themeRules, brandAccent, brandInk }) {
    const host = document.querySelector('#sulimarket-ui');
    const fab = host.shadowRoot.querySelector('.fab');
    const panel = host.shadowRoot.querySelector('.panel');
    if (setup === 'pill') {
        const gap = document.createElement('div');
        gap.style.height = '100vh';
        document.querySelector('.fixture h1').after(gap);
    }
    if (/sorted|fresh|^pill$/.test(setup) && !setup.startsWith('offers')) {
        actions.sort({ scroll: false });
        if (setup.includes('fresh') || setup === 'pill') placeLateCard();
    }
    if (setup.startsWith('panel')) {
        fab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }
    if (setup.endsWith('busy') || setup === 'motion') {
        // The story starts partway through loading. Its stop action still produces a sorted fixture.
        ui.setBusy(4500, 10000);
        actions.showBusy('Листаю, ещё <b>5 с</b>', 'Загружено 2 товара');
        panel.querySelector('.stop').addEventListener('click', () => {
            ui.setBusy(null);
            actions.sort();
        }, { once: true });
    }
    if (setup === 'toast' || setup === 'toast-error') {
        const show = () => setup === 'toast-error'
            ? ui.toast('Карточки не найдены - это не страница выдачи')
            : ui.toast('Старый SSMarket ещё стоит в Tampermonkey - удалите его там');
        show();
        fab.addEventListener('dblclick', show);
    }
    if (setup === 'tokens' || setup === 'motion') {
        const sheet = document.createElement('section');
        sheet.dataset.suiteTokens = '';
        sheet.style.cssText = 'width:340px;margin:24px;padding:16px;border:1px solid var(--ssm-border);border-radius:12px;background:var(--ssm-bg);color:var(--ssm-text)';
        const rules = document.createElement('style');
        rules.textContent = themeRules('[data-suite-tokens]');
        sheet.append(rules);
        document.body.prepend(sheet);
        const label = document.createElement('h2');
        label.style.cssText = 'margin:0 0 12px;font-size:17px';
        label.textContent = setup === 'tokens' ? 'Цвета расширения' : 'Кольцо догрузки';
        sheet.append(label);
        if (setup === 'tokens') {
            const tokens = getComputedStyle(sheet);
            for (const name of ['--ssm-bg', '--ssm-text', '--ssm-muted', '--ssm-surface', '--ssm-border', '--ssm-fresh', 'BRAND_ACCENT', 'BRAND_INK']) {
                const value = ({ BRAND_ACCENT: brandAccent, BRAND_INK: brandInk })[name]
                    ?? tokens.getPropertyValue(name).trim();
                const row = document.createElement('p');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;font:13px monospace';
                const swatch = document.createElement('span');
                swatch.style.cssText = 'width:20px;height:20px;border:1px solid var(--ssm-border);border-radius:4px';
                swatch.style.background = value;
                row.append(swatch, `${name}  ${value}`);
                sheet.append(row);
            }
        } else {
            const progress = host.shadowRoot.querySelector('.ring .progress');
            const { transitionProperty, transitionDuration, transitionTimingFunction } = getComputedStyle(progress);
            sheet.append(`${transitionProperty} · ${transitionDuration} · ${transitionTimingFunction}`);
        }
    }
}

function marketScene(scene, setup) {
    const isWb = scene === 'wb';
    const fixture = isWb ? wbHtml : ozonHtml;
    const screen = setup.startsWith('offers') ? 'offers' : setup === 'product' ? 'product' : 'listing';
    const url = new URL(isWb ? 'https://www.wildberries.ru/' : 'https://www.ozon.ru/');
    url.pathname = screen === 'product' ? '/catalog/201/detail.aspx'
        : isWb && screen === 'offers' ? '/catalog/201/other-sellers' : '/search/';
    const initial = {
        lastSeconds: setup === 'panel-preset' ? 5 : 0,
        customSeconds: setup === 'panel-custom' ? 7 : 0,
        keepSorted: setup !== 'panel-unchecked',
        [`position:${isWb ? 'wb' : 'ozon'}`]: {
            'panel-below': { fx: .96, fy: .04 },
            motion: { fx: .43, fy: .10 }
        }[setup]
    };
    const data = [url.href, initial, setup].map(value => JSON.stringify(value)).join(', ');
    const ready = `
        setTimeout(() => (${marketSetup})(setup, {
            ui, actions, themeRules, brandAccent: BRAND_ACCENT, brandInk: BRAND_INK,
            placeLateCard() {
                lastSortAt -= LATE_CARDS_MS;
                document.querySelector('${isWb ? '.product-card-list' : '.product-grid:not(#sulimarket-ozon-sorted .product-grid)'}')
                    .append(document.querySelector('#late-card').content.cloneNode(true));
                site.capture();
                actions.refresh();
            }
        }), 0);`;
    const script = `((fixtureUrl, initial, setup) => {
        const store = (${makeStore})(initial);
        const fetch = (${mockSellerFetch})(setup);
        const sessionStorage = (${localSession})();
        const location = new URL(fixtureUrl);
        ${core.replaceAll('__VERSION__', version)}
        ${ready}
    })(${data});`;
    const thumbnail = new URL(thumbnails, document.baseURI).href;
    const body = template(fixture, screen).replaceAll('{{THUMBNAILS}}', thumbnail);
    return html(body, marketCss.replaceAll('{{THUMBNAILS}}', thumbnail), script);
}

function buildScene(scene, setup) {
    if (scene === 'ozon' || scene === 'wb') return marketScene(scene, setup);
    if (scene === 'popup') return popupScene(setup);
    if (scene === 'icon') return html(icon, `
        body { margin: 0; background: #fcfcfe; display: grid; place-items: center; height: 100vh; }
        @media(prefers-color-scheme:dark) { body { background: #101316; } }
        svg { width: 128px; height: 128px; }`);
    const { css, body } = sourceDocument(scene === 'promo' ? promo : social);
    return html(assets(body), assets(css));
}

const nextFrame = win => new Promise(resolve => win.requestAnimationFrame(resolve));

async function ready(frame, record, setup, state, theme) {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    const shadow = doc.querySelector('#sulimarket-ui')?.shadowRoot;
    const targets = () => [...doc.querySelectorAll(record.target), ...(shadow?.querySelectorAll(record.target) ?? [])];
    const sort = () => doc.querySelector('[data-ssm-offers-sort]');
    const waitFor = async (condition, label) => {
        const deadline = performance.now() + 5000;
        while (!condition()) {
            if (win.fixtureError) throw new Error(win.fixtureError);
            if (performance.now() >= deadline) throw new Error(`${record.slug}/${state}: ${label}`);
            await nextFrame(win);
        }
    };
    if (setup.startsWith('offers-sort')) {
        await waitFor(sort, 'Seller sort button missing');
        sort().click();
        const text = setup.endsWith('sorted') ? /^По отзывам: \d/ : /^(Загружаю|Смотрю)/;
        await waitFor(() => text.test(sort().textContent), 'Seller sort state missing');
    }
    await waitFor(() => targets().some(node => node.getClientRects().length), 'Visible render target missing');
    if (setup === 'offers' || setup === 'offers-error') {
        await waitFor(() => targets().every(node => !node.textContent.includes('загружаю')), 'Seller reply missing');
    }
    if (state === 'focus' || record.family === 'focus') {
        const node = record.slug === 'panel-preset' ? targets()[1] : targets()[0];
        (node.querySelector('input') || node).focus({ preventScroll: true });
    }
    targets().forEach(node => node.setAttribute('data-suite-target', ''));
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images, image => image.decode()));
    if (record.scene === 'popup') {
        const height = doc.querySelector('.popup-surface').offsetHeight;
        frame.height = String(Math.min(height, sceneSizes.popup[1]));
        if (doc.querySelector('#rate:not([hidden])')) {
            targets()[0].scrollIntoView({ block: 'center' });
        }
    }
    if (record.slug === 'toast') {
        await waitFor(() => Number(win.getComputedStyle(targets()[0]).opacity) >= .99, 'Toast is hidden');
    }
    await nextFrame(win);
    await nextFrame(win);
    const actual = win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (actual !== theme && !frame.hasAttribute('data-suite-forced-theme')) throw new Error(`${record.slug}: requested ${theme}, rendered ${actual}`);
}

export function renderScene(slug, state, theme) {
    const record = catalogue.find(item => item.slug === slug);
    const setup = record.states[state];
    const [width, height] = sceneSizes[record.scene];
    const stage = document.createElement('div');
    const background = theme === 'dark' ? '#101316' : '#fcfcfe';
    stage.style.cssText = `padding:16px;width:max-content;max-width:100%;box-sizing:border-box;margin-inline:auto;background:${background}`;
    const frame = document.createElement('iframe');
    frame.title = record.name;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.width = String(width);
    frame.height = String(height);
    frame.style.cssText = `display:block;max-width:100%;border:0;color-scheme:${theme}`;
    frame.addEventListener('load', () => {
        ready(frame, record, setup, state, theme).then(() => {
            frame.dataset.suiteReady = '';
        }, error => {
            frame.dataset.suiteError = error.message;
            const message = document.createElement('p');
            message.textContent = error.message;
            stage.append(message);
        });
    }, { once: true });
    const nativeTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    let content = buildScene(record.scene, setup);
    if (nativeTheme !== theme) {
        // Embedded documents can follow the browser preference instead of the iframe's color-scheme.
        // Resolve the source media queries for the Storybook toolbar without copying their rules.
        content = content.replace(/@media\s*\(prefers-color-scheme:\s*(light|dark)\)/g,
            (_query, scheme) => theme === scheme ? '@media all' : '@media not all');
        content = content.replace('</head>', `<style>:root{color-scheme:${theme} !important}</style></head>`);
        frame.dataset.suiteForcedTheme = '';
    }
    frame.srcdoc = content;
    stage.append(frame);
    return stage;
}
