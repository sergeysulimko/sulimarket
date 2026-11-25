import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogue } from '../../.storybook/catalogue.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const project = 'sulimarket';
export const output = process.env.DESIGN_LIVE_OUTPUT
    ? resolve(process.env.DESIGN_LIVE_OUTPUT) : join(root, 'design-live-output');
export const key = (source, name) => JSON.stringify([source, name]);

export const mapFile = process.env.DESIGN_MAP;

function readMap(path) {
    const ref = path === mapFile ? process.env.DESIGN_MAP_REF : null;
    const json = ref
        ? execFileSync('git', ['show', `${ref}:./${basename(path)}`], { cwd: dirname(resolve(path)), encoding: 'utf8' })
        : readFileSync(path, 'utf8');
    return JSON.parse(json);
}

export function checkCoverage(folder, mapPath, manifest) {
    const byIdentity = new Map(manifest.components.map(item => [key(item.source, item.name), item]));
    const byStory = new Map(catalogue.map(item => [key(item.source, item.name), item]));
    const index = JSON.parse(readFileSync(join(folder, dirname(manifest.storybook), 'index.json'), 'utf8'));
    const map = mapPath ? readMap(mapPath) : null;
    if (map && !map.elements.some(element => element.kind === 'instance')) {
        throw new Error(`No instances in design map: ${mapPath}`);
    }
    const entries = map?.elements ?? catalogue.map(item => ({
        path: item.source, symbol: item.name, kind: 'instance', family: item.family
    }));
    const mapKeys = new Set(entries.map(item => key(item.path, item.symbol)));
    const instances = entries.filter(item => item.kind === 'instance');
    const coveredFamilies = new Set();
    const gaps = [];
    let total = 0;
    let covered = 0;

    function shotsFor(component) {
        const current = component?.versions.at(-1);
        const expected = byStory.get(key(component?.source, component?.name));
        if (!current || !expected) return { missing: 'No story in the manifest' };
        for (const state of Object.keys(expected.states)) {
            if (index.entries[`${component.story}--${state}`]?.type !== 'story') {
                return { missing: `No ${state} Storybook entry` };
            }
            const light = current.shots.filter(shot => shot.state === state && shot.theme === 'light');
            const dark = current.shots.filter(shot => shot.state === state && shot.theme === 'dark');
            const exists = shot => existsSync(join(folder, shot.png)) && statSync(join(folder, shot.png)).size > 0;
            if (!light.some(a => exists(a) && dark.some(b => a.window === b.window && exists(b)))) {
                return { missing: `Missing light/dark PNG pair for ${state}` };
            }
        }
        return { both: true };
    }

    for (const item of instances) {
        const id = key(item.path, item.symbol);
        const record = byStory.get(id);
        const result = shotsFor(byIdentity.get(id));
        if (!record?.sheet) total++;
        if (result.both) {
            coveredFamilies.add(item.family);
            if (!record.sheet) covered++;
        } else {
            gaps.push({ path: item.path, name: item.symbol, why: result.missing });
        }
    }
    const blocked = entries.filter(item => item.kind === 'composition').flatMap(item => {
        const missing = item.uses.filter(family => !coveredFamilies.has(family));
        return missing.length ? [{ path: item.path, name: item.symbol, families: missing }] : [];
    });
    const extras = catalogue.filter(item => !mapKeys.has(key(item.source, item.name))).map(item => ({
        path: item.source, name: item.name, family: item.family,
        both: shotsFor(byIdentity.get(key(item.source, item.name))).both === true
    }));
    return {
        coverage: `${covered} из ${total}`, gaps, extras, blocked,
        mapCoverage: `${entries.length - gaps.length - blocked.length} из ${entries.length}`
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const map = process.argv[2] ?? mapFile;
    const folder = process.argv[3] ? resolve(process.argv[3]) : output;
    if (!map) throw new Error('Pass the design map path or set DESIGN_MAP');
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
    const report = checkCoverage(folder, map, manifest);
    console.log(JSON.stringify(report, null, 2));
    if (report.gaps.length || report.blocked.length) process.exitCode = 1;
}
