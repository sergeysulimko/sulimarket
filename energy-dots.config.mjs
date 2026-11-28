import { readFileSync } from 'node:fs';
import { eslintRules } from '@energy-dots/rules/eslint';
import { stylelintRules } from '@energy-dots/rules/stylelint';

// Plain HTML/CSS/JS extension: no Tailwind, JSX or Tailwind entry point, so only the checks for CSS values and
// literal values in plain scripts apply. The language stylesheets are the source of known token names.
const tokenFiles = ['vendor/energy-dots/energy-dots.css', 'vendor/energy-dots/primitives.css'];
const languageCss = tokenFiles.map(file => readFileSync(file, 'utf8')).join('\n');
const fontSizeTokenNames = [...new Set(Array.from(languageCss.matchAll(/^\s+(--text-[\w]+(?:-[\w]+)*):/gm), match => match[1]))];

// The popup is built from the language's primitives and keeps the look Sergey accepted on boards 03 (dark), 04 LimeLight
// (light) and 08 PopUp (lime accent, lime switches, the boards' type sizes). Everything the shared rules flag there is recorded in energy-dots-baseline.json
// with one reason: accepted by Sergey 02.11.2026 (sulimko-com docs/products/sulimarket/COURSE.md). New findings still fail.
export default {
  baseline: 'energy-dots-baseline.json',
  eslint: {
    files: ['src/popup.js', 'src/popup-bridge.js', 'src/sort-ui.js', 'src/core.js'],
    config: eslintRules(),
  },
  stylelint: {
    files: ['src/popup.css', 'src/brand.css', 'src/market.css'],
    // --brand and --brand-ink are the product's brand slot that the language's brand variant reads.
    config: stylelintRules({ tokenFiles: [...tokenFiles, 'src/brand.css', 'src/market.css'], fontSizeTokenNames, tokenNames: ['--brand', '--brand-ink'] }),
  },
  markup: { files: ['src/popup.html'] },
};
