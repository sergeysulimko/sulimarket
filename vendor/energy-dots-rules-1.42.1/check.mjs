#!/usr/bin/env node
import { ESLint } from 'eslint';
import parser from '@typescript-eslint/parser';
import stylelint from 'stylelint';
import postcss from 'postcss';
import { legacyStylelintRuleNames } from './stylelint.mjs';
import { sharedEslintRules } from './eslint.mjs';
import { glob, readFile, writeFile } from 'node:fs/promises';
import { markupFindings } from './markup.mjs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  config: { type: 'string', default: 'energy-dots.config.mjs' },
  'write-baseline': { type: 'boolean' },
} });
const configPath = resolve(values.config);
const { default: config } = await import(pathToFileURL(configPath));
const baselinePath = config.baseline && resolve(config.baseline);
if (values['write-baseline'] && !baselinePath) throw new Error('Configure a baseline path before writing a baseline.');

const findings = [];
const failures = [];
const disables = [];
const migratedEslintRules = new Set(['energy-dots/color', 'energy-dots/motion', 'energy-dots/space', 'energy-dots/type-size']);

function auditDisable(file, line, text, syntax, activeRules) {
  const match = text.trim().match(syntax);
  if (!match) return;
  const [, directive, body] = match;
  const [rules, reason] = body.split(/\s+--\s+/, 2).map(part => part.trim());
  disables.push({ file, line, directive, rules: rules || 'all', reason });
  if (!reason && (!rules || rules.split(/\s*,\s*/).some(rule => activeRules.has(rule)))) {
    failures.push({ file, line, message: `${directive} needs a reason after --.` });
  }
}

if (config.eslint) {
  const { files, config: overrideConfig } = config.eslint;
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig,
    ruleFilter: ({ ruleId }) => sharedEslintRules.has(ruleId),
  });
  for (const result of await eslint.lintFiles(files)) {
    const file = relative('.', result.filePath);
    const source = await readFile(result.filePath, 'utf8');
    const { rules } = (await eslint.calculateConfigForFile(result.filePath)) ?? {};
    const activeRules = new Set(Object.keys(rules ?? {}).filter(rule => sharedEslintRules.has(rule) && rules[rule][0]));
    if (!result.messages.some(message => message.fatal) && source.includes('eslint-disable')) {
      const { ast } = parser.parseForESLint(source, { filePath: result.filePath, jsx: true });
      for (const comment of ast.comments) {
        auditDisable(file, comment.loc.start.line, comment.value,
          /^(eslint-disable(?:-next-line|-line)?)(?=\s|$)([\s\S]*)$/, activeRules);
      }
    }
    for (const warning of result.messages) {
      // ESLint can still report a missing rule in an inline directive even with ruleFilter.
      if (warning.ruleId && !activeRules.has(warning.ruleId)) continue;
      const entry = { file, line: warning.line, rule: warning.ruleId, message: warning.message };
      (warning.fatal || !warning.ruleId ? failures : findings).push(entry);
    }
  }
}

if (config.stylelint) {
  const { files, config: stylelintConfig } = config.stylelint;
  const { results } = await stylelint.lint({ files, config: stylelintConfig });
  const activeRules = new Set(Object.keys(stylelintConfig.rules).filter(rule => stylelintConfig.rules[rule] !== null));
  for (const result of results) {
    if (result.ignored) continue;
    const file = relative('.', result.source);
    for (const warning of result.warnings) {
      const entry = { file, line: warning.line, rule: warning.rule, message: warning.text };
      (activeRules.has(warning.rule) ? findings : failures).push(entry);
    }
    for (const warning of result.invalidOptionWarnings) failures.push({ file, message: warning.text });
    const source = await readFile(result.source, 'utf8');
    if (source.includes('stylelint-disable') && !result.warnings.some(warning => warning.rule === 'CssSyntaxError')) {
      postcss.parse(source, { from: result.source }).walkComments(comment => {
        auditDisable(file, comment.source.start.line, comment.text,
          /^(stylelint-disable(?:-next-line|-line)?)(?=\s|$)([\s\S]*)$/, activeRules);
      });
    }
  }
}

// HTML written as text (Python strings, templates): raw controls the language has a component for.
if (config.markup) {
  const { files, exclude = [] } = config.markup;
  for await (const path of glob(files, { exclude })) {
    const source = await readFile(path, 'utf8');
    for (const finding of markupFindings(source)) findings.push({ file: relative('.', resolve(path)), ...finding });
  }
}

let baseline;
if (baselinePath) {
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const totals = new Map();
let legacy = 0;
let newFindings = 0;
for (const entry of findings) {
  const key = JSON.stringify([entry.file, entry.rule, entry.message]);
  const count = (totals.get(key) ?? 0) + 1;
  totals.set(key, count);
  // A 1.17.0 baseline remains valid while the scoped Stylelint rules take over the native IDs.
  const legacyRule = legacyStylelintRuleNames[entry.rule];
  const legacyKey = legacyRule && JSON.stringify([
    entry.file, legacyRule, entry.message.slice(0, -` (${entry.rule})`.length) + ` (${legacyRule})`,
  ]);
  // The same message could previously be counted under both JSX and Tailwind rules in one file.
  const legacyEslintCount = migratedEslintRules.has(entry.rule)
    ? ['no-restricted-syntax', 'better-tailwindcss/no-restricted-classes'].reduce((sum, rule) =>
      sum + (baseline?.[JSON.stringify([entry.file, rule, entry.message])] ?? 0), 0)
    : 0;
  if (count <= (baseline?.[key] ?? baseline?.[legacyKey] ?? legacyEslintCount)) {
    legacy++;
  } else if (baseline || !values['write-baseline']) {
    newFindings++;
    failures.push(entry);
  }
}

if (values['write-baseline'] && !failures.length) {
  const sorted = Object.fromEntries([...totals].sort(([a], [b]) => a.localeCompare(b, 'en')));
  await writeFile(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Baseline recorded: ${findings.length} violation(s).`);
}

for (const { file, line, directive, rules, reason } of disables) {
  console.log(`${file}:${line} ${directive} ${rules} -- ${reason || '(no reason recorded)'}`);
}
for (const { file, line, message } of failures) console.error(`${file}${line ? `:${line}` : ''} ${message}`);
console.log(`Energy + dots: ${legacy} legacy, ${newFindings} new, ${disables.length} disable directive(s).`);
if (failures.length) process.exitCode = 1;
