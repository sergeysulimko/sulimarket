import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogue } from '../../.storybook/catalogue.mjs';

export async function generateStories(root) {
    const dir = join(root, '.storybook/generated');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const item of catalogue) {
        const { slug, source, name, family, states, scene } = item;
        const title = `${family}/${name.replaceAll('/', '∕')} (${scene})`;
        const tags = ['design-source:' + source, 'design-name:' + name];
        const meta = { id: slug, title, tags };
        const exports = Object.keys(states).map(state => {
            const identifier = state[0].toUpperCase() + state.slice(1);
            return `export const ${identifier} = { render: (_args, { globals }) => renderScene(${JSON.stringify(slug)}, ${JSON.stringify(state)}, globals.theme) };`;
        });
        await writeFile(join(dir, `${slug}.stories.js`), [
            "import { renderScene } from '../scene.js';",
            `export default ${JSON.stringify(meta)};`,
            ...exports,
            ''
        ].join('\n'));
    }
}
