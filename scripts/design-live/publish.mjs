import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { catalogue, sceneSizes } from '../../.storybook/catalogue.mjs';
import { checkCoverage, mapFile, key, output, project, root } from './coverage.mjs';
import { generateStories } from './generate.mjs';

const viewport = { width: 1470, height: 956 };
const themes = ['light', 'dark'];
const limit = 150_000_000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const types = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};

async function readIfPresent(path) {
    try {
        return await readFile(path);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return null;
    }
}

async function files(folder, relative = '') {
    const paths = [];
    for (const entry of await readdir(join(folder, relative), { withFileTypes: true })) {
        const path = join(relative, entry.name);
        if (entry.isDirectory()) paths.push(...await files(folder, path));
        else if (entry.isFile()) paths.push(path);
    }
    return paths.sort();
}

async function storybookDigest(folder, paths) {
    const contents = [];
    for (const path of paths) {
        let bytes = await readFile(join(folder, path));
        if (path === 'project.json') {
            // Storybook writes timestamps even when the build is otherwise identical.
            const { generatedAt, userSince, ...project } = JSON.parse(bytes);
            bytes = JSON.stringify(project);
        }
        contents.push(`${path} ${digest(bytes)}`);
    }
    return digest(contents.join('\n')).slice(0, 16);
}

async function atomicWrite(path, data) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temp, data);
        await rename(temp, path);
    } finally {
        await rm(temp, { force: true });
    }
}

async function serve(folder) {
    const server = createServer(async (request, response) => {
        try {
            const { pathname } = new URL(request.url, 'http://localhost');
            const path = resolve(folder, '.' + decodeURIComponent(pathname));
            if (path.startsWith(folder + sep) && (await stat(path)).isFile()) {
                response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
                createReadStream(path).pipe(response);
                return;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                response.writeHead(500).end();
                return;
            }
        }
        response.writeHead(404).end();
    });
    await new Promise((ready, fail) => server.once('error', fail).listen(0, '127.0.0.1', ready));
    return { host: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function capture(page, host, id, theme) {
    const address = `${host}/iframe.html?id=${encodeURIComponent(id)}&globals=theme:${theme}`;
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(address, { waitUntil: 'load' });
    const scene = page.locator('[data-suite-ready], [data-suite-error]');
    await scene.waitFor();
    if (await scene.getAttribute('data-suite-forced-theme') !== null) {
        throw new Error('Chromium did not use the native color preference');
    }
    const error = await scene.getAttribute('data-suite-error');
    if (error) throw new Error(error);
    const frame = await scene.boundingBox();
    const clip = await scene.contentFrame().locator('[data-suite-target]').first().evaluate(node => {
        const doc = node.ownerDocument;
        const boxes = [...doc.querySelectorAll('[data-suite-target]'), ...(
            doc.querySelector('#sulimarket-ui')?.shadowRoot.querySelectorAll('[data-suite-target]') ?? []
        )].flatMap(target => Array.from(target.getClientRects()))
            .filter(box => box.width > 0 && box.height > 0);
        const x = Math.max(-16, Math.floor(Math.min(...boxes.map(box => box.left))) - 16);
        const y = Math.max(-16, Math.floor(Math.min(...boxes.map(box => box.top))) - 16);
        const right = Math.min(innerWidth + 16, Math.ceil(Math.max(...boxes.map(box => box.right))) + 16);
        const bottom = Math.min(innerHeight + 16, Math.ceil(Math.max(...boxes.map(box => box.bottom))) + 16);
        return { x, y, width: right - x, height: bottom - y };
    });
    return page.screenshot({
        clip: { ...clip, x: frame.x + clip.x, y: frame.y + clip.y }, scale: 'css', animations: 'disabled'
    });
}

async function main() {
    const work = await mkdtemp(join(tmpdir(), 'sulimarket-design-live-'));
    try {
        await generateStories(root);
        const build = join(work, 'storybook');
        execFileSync(join(root, 'node_modules/.bin/storybook'), ['build', '--output-dir', build, '--quiet', '--loglevel', 'warn'], {
            cwd: root, stdio: 'inherit', env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' }
        });
        const index = JSON.parse(await readFile(join(build, 'index.json')));
        const previous = JSON.parse(await readIfPresent(join(output, 'manifest.json')) ?? '{}');
        const oldComponents = new Map((previous.components ?? []).map(item => [key(item.source, item.name), item]));
        const sourceRevisions = new Map([...new Set(catalogue.map(item => item.source))].map(source => {
            const [sha, date] = git('log', '-1', '--format=%h %cI', '--', source).split(' ');
            if (!sha || !date) throw new Error(`No committed source revision for ${source}`);
            return [source, { sha, date }];
        }));
        const buildPaths = await files(build);
        const fingerprint = await storybookDigest(build, buildPaths);
        let buildFolder = `storybook/${fingerprint}`;
        if (previous.storybook) {
            const previousFolder = dirname(previous.storybook);
            const published = join(output, previousFolder);
            if (await readIfPresent(join(published, 'index.html')) &&
                await storybookDigest(published, await files(published)) === fingerprint) {
                buildFolder = previousFolder;
            }
        }
        const assets = new Map(buildPaths.map(path => [join(buildFolder, path), join(build, path)]));
        const components = [];
        const playwright = await chromium.launch();
        try {
            const server = await serve(build);
            try {
                const context = await playwright.newContext({
                    viewport, deviceScaleFactor: 1, serviceWorkers: 'block', locale: 'ru-RU'
                });
                const blocked = new Set();
                await context.route('**/*', route => {
                    if (new URL(route.request().url()).origin === server.host) return route.continue();
                    blocked.add(route.request().url());
                    return route.abort();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(9000);
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                page.on('console', message => {
                    if (message.text().includes('Content Security Policy')) errors.push(message.text());
                });
                for (const item of catalogue) {
                    const { source, name, slug, states, scene } = item;
                    const windowName = sceneSizes[scene].join('x');
                    const versions = [...(oldComponents.get(key(source, name))?.versions ?? [])];
                    const { sha, date } = sourceRevisions.get(source);
                    const shots = [];
                    for (const state of Object.keys(states)) {
                        const id = `${slug}--${state}`;
                        if (index.entries[id]?.type !== 'story') throw new Error(`Missing Storybook story ${id}`);
                        for (const theme of themes) {
                            try {
                                const bytes = await capture(page, server.host, id, theme);
                                if (errors.length) throw new Error(errors.join('\n'));
                                if (blocked.size) throw new Error(`External requests: ${[...blocked].join(', ')}`);
                                const previousShot = versions.at(-1)?.shots.find(shot =>
                                    shot.theme === theme && shot.state === state && shot.window === windowName);
                                const previousBytes = previousShot && await readIfPresent(join(output, previousShot.png));
                                const png = previousBytes?.equals(bytes) ? previousShot.png :
                                    `shots/${slug}/${sha}/${theme}-${state}-${windowName}-${digest(bytes).slice(0, 12)}.png`;
                                if (!previousBytes?.equals(bytes)) {
                                    const staged = join(work, png);
                                    await mkdir(dirname(staged), { recursive: true });
                                    await writeFile(staged, bytes);
                                    assets.set(png, staged);
                                }
                                shots.push({ theme, state, window: windowName, png });
                            } catch (error) {
                                throw new Error(`${id}/${theme}: ${[error.message, ...errors, ...blocked].join(' | ')}`, { cause: error });
                            }
                        }
                    }
                    const at = versions.findIndex(revision => revision.sha === sha);
                    if (at === -1) versions.push({ sha, date, shots });
                    else versions[at] = { sha, date, shots: [
                        ...versions[at].shots.filter(old => !shots.some(shot =>
                            shot.theme === old.theme && shot.state === old.state && shot.window === old.window)),
                        ...shots
                    ] };
                    versions.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
                    components.push({ slug, name, source, story: slug, versions });
                    if (components.length % 10 === 0) console.log(`Captured ${components.length}/${catalogue.length} stories`);
                }
                await context.close();
            } finally {
                server.close();
            }
        } finally {
            await playwright.close();
        }

        const manifest = {
            project, producer: 'storybook', generated: new Date().toISOString(),
            storybook: `${buildFolder}/index.html`, components
        };
        const json = JSON.stringify(manifest, null, 2) + '\n';
        await mkdir(output, { recursive: true });
        let size = Buffer.byteLength(json);
        for (const path of await files(output)) {
            if (path !== 'manifest.json' && !assets.has(path)) size += (await stat(join(output, path))).size;
        }
        for (const path of assets.values()) size += (await stat(path)).size;
        if (size > limit) throw new Error(`Design folder would reach ${size} bytes (limit ${limit})`);
        for (const [path, staged] of assets) {
            const target = join(output, path);
            try {
                await access(target);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                await atomicWrite(target, await readFile(staged));
            }
        }
        const coverage = checkCoverage(output, mapFile, manifest);
        if (coverage.gaps.length) throw new Error(JSON.stringify(coverage, null, 2));
        await atomicWrite(join(output, 'manifest.json'), json);
        console.log(`${coverage.coverage} · ${components.length} stories · ${(size / 1e6).toFixed(2)} MB`);
        if (coverage.blocked.length) console.log(JSON.stringify(coverage.blocked, null, 2));
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}

await main();
