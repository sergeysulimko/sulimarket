// One source, two products: `npm run build` writes the Tampermonkey script and the browser extension to dist/.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const core = readFileSync('src/core.js', 'utf8').replaceAll('__VERSION__', version);
const indented = core.split('\n').map(line => (line ? `    ${line}` : line)).join('\n');

const REPO = 'https://github.com/sergeysulimko/sulimarket';
const HOMEPAGE = 'https://sulimko.com/sulimarket';
const MATCHES = ['https://www.ozon.ru/*', 'https://www.wildberries.ru/*'];
const DESCRIPTION = 'Сортирует Ozon и Wildberries по числу отзывов и оценок. Показывает, кто продаёт товар: оценку магазина, продажи и стаж.';

// The GitHub page and the site page show the version: stamp it here so a release never leaves them on an old one.
if (!readFileSync('CHANGELOG.md', 'utf8').includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md has no entry for ${version}`);
}
for (const [file, pattern, text] of [
    ['README.md', /версия-\d+\.\d+\.\d+/, `версия-${version}`],
    ['README.md', /"version": "\d+\.\d+\.\d+"/, `"version": "${version}"`],
    ['site/sulimko-com-page.md', /"softwareVersion": "\d+\.\d+\.\d+"/, `"softwareVersion": "${version}"`],
]) {
    writeFileSync(file, readFileSync(file, 'utf8').replace(pattern, text));
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/extension/icons', { recursive: true });

// ------------------------------------------------------------ Tampermonkey
const header = [
    '// ==UserScript==',
    '// @name         SuliMarket',
    '// @namespace    https://sulimko.com/',
    `// @version      ${version}`,
    `// @description  ${DESCRIPTION}`,
    '// @author       Sergey Sulimko',
    `// @homepageURL  ${HOMEPAGE}`,
    `// @supportURL   ${REPO}/issues`,
    `// @updateURL    ${REPO}/releases/latest/download/sulimarket.user.js`,
    `// @downloadURL  ${REPO}/releases/latest/download/sulimarket.user.js`,
    ...MATCHES.map(match => `// @match        ${match}`),
    '// @grant        GM_getValue',
    '// @grant        GM_setValue',
    '// @run-at       document-idle',
    '// @noframes',
    '// ==/UserScript=='
].join('\n');

writeFileSync('dist/sulimarket.user.js', `${header}

(function () {
    'use strict';

    // Tampermonkey storage; localStorage when the test harness injects the script without Tampermonkey.
    const store = typeof GM_getValue === 'function'
        ? { get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value) }
        : {
            get: (key, fallback) => {
                const raw = localStorage.getItem(\`sulimarket:\${key}\`);
                return raw === null ? fallback : JSON.parse(raw);
            },
            set: (key, value) => localStorage.setItem(\`sulimarket:\${key}\`, JSON.stringify(value))
        };

${indented}
})();
`);

// SSMarket 2.x was installed under another @name/@namespace, so Tampermonkey would add SuliMarket next to it.
// This bridge keeps the old identity (Tampermonkey offers "Обновить" over 2.x) and points its update URL at
// SuliMarket; the next update check renames the same entry in place (checked on Tampermonkey 5.5.1, 20.10.2026).
const bridgeHeader = header
    .replace('// @name         SuliMarket', '// @name         SSMarket')
    .replace('// @namespace    https://sulimko.com/', '// @namespace    http://tampermonkey.net/')
    .replace(`// @version      ${version}`, '// @version      2.9.0');
writeFileSync('dist/ssmarket-bridge.user.js', readFileSync('dist/sulimarket.user.js', 'utf8').replace(header, bridgeHeader));

// --------------------------------------------------------------- Extension
writeFileSync('dist/extension/content.js', `(async function () {
    'use strict';

    // chrome.storage is asynchronous: read it once, then serve reads from memory and write through.
    const cache = await chrome.storage.local.get(null);
    const store = {
        get: (key, fallback) => (key in cache ? cache[key] : fallback),
        set(key, value) {
            cache[key] = value;
            chrome.storage.local.set({ [key]: value });
        }
    };

${indented}
${readFileSync('src/popup-bridge.js', 'utf8')}
})();
`);

// Store listing in two languages (SUL-35: Google asks for English to nominate a Featured extension). Russian is the
// default, so the Russian listing and every browser that is neither Russian nor English stay as they were; a browser
// in English reads _locales/en. The long description and screenshots per language are set only in the store console
// (store/chrome-web-store.md).
const LOCALES = {
    ru: {
        extName: 'SuliMarket - сортировка Ozon и Wildberries по отзывам',
        extDescription: DESCRIPTION,
        extActionTitle: 'SuliMarket'
    },
    en: {
        extName: 'SuliMarket - sort Ozon and Wildberries by reviews',
        extDescription: 'Sorts Ozon and Wildberries by number of reviews and ratings. Shows who sells the item: shop rating, sales and years on the site.',
        extActionTitle: 'SuliMarket'
    }
};
for (const [locale, messages] of Object.entries(LOCALES)) {
    if (messages.extName.length > 75) throw new Error(`${locale} extension name is ${messages.extName.length} chars, the store allows 75`);
    if (messages.extDescription.length > 132) throw new Error(`${locale} description is ${messages.extDescription.length} chars, the store allows 132`);
    mkdirSync(`dist/extension/_locales/${locale}`, { recursive: true });
    writeFileSync(`dist/extension/_locales/${locale}/messages.json`, `${JSON.stringify(
        Object.fromEntries(Object.entries(messages).map(([key, message]) => [key, { message }])), null, 2)}\n`);
}

const manifest = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'SuliMarket',
    default_locale: 'ru',
    version,
    description: '__MSG_extDescription__',
    homepage_url: HOMEPAGE,
    icons: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`])),
    permissions: ['storage', 'activeTab'],
    action: { default_popup: 'popup.html', default_title: '__MSG_extActionTitle__' },
    content_scripts: [{ matches: MATCHES, js: ['content.js'], run_at: 'document_idle' }]
};
writeFileSync('dist/extension/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ['popup.html', 'popup.css', 'popup.js']) {
    copyFileSync(`src/${file}`, `dist/extension/${file}`);
}
copyFileSync('assets/icon.svg', 'dist/extension/icon.svg');
mkdirSync('dist/extension/fonts', { recursive: true });
copyFileSync('assets/fonts/InterVariable.woff2', 'dist/extension/fonts/InterVariable.woff2');
copyFileSync('assets/fonts/OFL-Inter.txt', 'dist/extension/fonts/OFL-Inter.txt');

for (const size of [16, 32, 48, 128]) {
    // assets/icon-512.png is rendered from assets/icon.svg by a browser: ImageMagick's own SVG renderer drops strokes.
    execFileSync('magick', ['assets/icon-512.png', '-resize', `${size}x${size}`, `dist/extension/icons/icon-${size}.png`]);
}
execFileSync('zip', ['-qr', `../sulimarket-${version}-extension.zip`, '.'], { cwd: 'dist/extension' });

console.log(`built ${version}: dist/sulimarket.user.js, dist/ssmarket-bridge.user.js, dist/extension/, dist/sulimarket-${version}-extension.zip`);
