// One source, two products: `npm run build` writes the Tampermonkey script and the browser extension to dist/.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const core = readFileSync('src/core.js', 'utf8').replaceAll('__VERSION__', version);
const indented = core.split('\n').map(line => (line ? `    ${line}` : line)).join('\n');

const REPO = 'https://github.com/sergeysulimko/sulimarket';
const MATCHES = ['https://www.ozon.ru/*', 'https://www.wildberries.ru/*'];
const DESCRIPTION = 'Сортирует Ozon и Wildberries по количеству отзывов и оценок, показывает, кто продаёт товар. Вёрстка сайта цела.';

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
    `// @homepageURL  ${REPO}`,
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
})();
`);

const manifest = {
    manifest_version: 3,
    name: 'SuliMarket - сортировка Ozon и Wildberries по отзывам',
    short_name: 'SuliMarket',
    version,
    description: DESCRIPTION,
    homepage_url: REPO,
    icons: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`])),
    permissions: ['storage'],
    content_scripts: [{ matches: MATCHES, js: ['content.js'], run_at: 'document_idle' }]
};
if (manifest.description.length > 132) {
    throw new Error(`manifest description is ${manifest.description.length} chars, the store allows 132`);
}
writeFileSync('dist/extension/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

for (const size of [16, 32, 48, 128]) {
    // assets/icon-512.png is rendered from assets/icon.svg by a browser: ImageMagick's own SVG renderer drops strokes.
    execFileSync('magick', ['assets/icon-512.png', '-resize', `${size}x${size}`, `dist/extension/icons/icon-${size}.png`]);
}
execFileSync('zip', ['-qr', `../sulimarket-${version}-extension.zip`, '.'], { cwd: 'dist/extension' });

console.log(`built ${version}: dist/sulimarket.user.js, dist/ssmarket-bridge.user.js, dist/extension/, dist/sulimarket-${version}-extension.zip`);
