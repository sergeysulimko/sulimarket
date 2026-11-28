import { readFileSync } from 'node:fs';
import { eslintRules } from '@energy-dots/rules/eslint';
import { stylelintRules } from '@energy-dots/rules/stylelint';

// Plain HTML/CSS/JS extension: no Tailwind, JSX or Tailwind entry point, so only the checks for CSS values and
// literal values in plain scripts apply. The language stylesheets are the source of known token names.
const tokenFiles = ['vendor/energy-dots/energy-dots.css', 'vendor/energy-dots/primitives.css'];
const languageCss = tokenFiles.map(file => readFileSync(file, 'utf8')).join('\n');
const fontSizeTokenNames = [...new Set(Array.from(languageCss.matchAll(/^\s+(--text-[\w]+(?:-[\w]+)*):/gm), match => match[1]))];

export default {
  baseline: 'energy-dots-baseline.json',
  eslint: {
    // core.js carries the in-page UI as CSS strings the CSS rules cannot see; it is outside this scope until its
    // styles move to files.
    files: ['src/popup.js', 'src/popup-bridge.js'],
    config: eslintRules(),
  },
  stylelint: {
    files: ['src/popup.css'],
    config: stylelintRules({ tokenFiles, fontSizeTokenNames }),
  },
  markup: { files: ['src/popup.html'] },
};
