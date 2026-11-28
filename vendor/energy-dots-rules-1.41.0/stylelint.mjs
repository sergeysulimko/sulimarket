import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import stylelint from 'stylelint';
import unknownCustomProperties from 'stylelint-value-no-unknown-custom-properties';
import { opacityMessage } from './values.mjs';

const languageCss = fileURLToPath(new URL('../generated/energy-dots.css', import.meta.url));
const nativeValues = ['inherit', 'initial', 'unset', 'revert', 'revert-layer'];
const systemFonts = ['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar'];
const cssNumber = String.raw`[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?`;
const spaceProperty = '/^(?:margin|padding)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$|^(?:row-|column-)?gap$/i';
const radiusProperty = '/^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/i';
const lineWidth = '/^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?-width|outline-width|column-rule-width|stroke-width)$/i';
const lineShorthand = '/^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?|outline|column-rule)$/i';
const paintProperty = '/^(?:color|(?:background|outline|text-decoration|caret|accent|column-rule|stop|flood|lighting)-color|fill|stroke)$/i';
const borderColors = '/^border(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?-color$/i';
const motionTime = '/^(?:transition|animation)-(?:duration|delay)$/i';
const motionCurve = '/^(?:transition|animation)-timing-function$/i';
const motionShorthand = '/^(?:transition|animation)$/i';
const layerProperty = '/^z-index$/i';
const weightProperty = '/^font-weight$/i';
const leadingProperty = '/^line-height$/i';
const trackingProperty = '/^letter-spacing$/i';
const familyProperty = '/^font-family$/i';
const sizeProperty = '/^font-size$/i';
const fontProperty = '/^font$/i';
const iconDimensions = '/^(?:(?:min-|max-)?(?:width|height)|inline-size|block-size)$/i';
const systemPaint = /^(?:AccentColor(?:Text)?|ActiveText|Button(?:Border|Face|Text)|Canvas(?:Text)?|Field(?:Text)?|GrayText|Highlight(?:Text)?|LinkText|Mark(?:Text)?|SelectedItem(?:Text)?|VisitedText)$/i;
const colorFunctions = ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'device-cmyk'];

const tokenKinds = {
  space: /^--(?:sp-\d+(?:-\d+)?|ed-safe-(?:top|bottom|left|right)-padding)$/,
  radius: /^--radius(?:-|$)/,
  line: /^--(?:hairline|focus-width|(?:chart|icon)-stroke)$/,
  layer: /^--z-/,
  duration: /^--(?:t-|motion-)/,
  curve: /^--(?:ease-|motion-)/,
  fontWeight: /^--(?:text-.+--font-weight|font-weight-.+)$/,
  lineHeight: /^--(?:text-.+--line-height|line-height-.+)$/,
  letterSpacing: /^--(?:text-.+--letter-spacing|letter-spacing-.+)$/,
  fontFamily: /^--font-(?:sans|mono)$/,
  shadow: /^--shadow(?:-|$)/,
  icon: /^--icon-(?!stroke$)/,
};

const variable = String.raw`var\(\s*--[\w-]+\s*\)`;
const whole = pattern => new RegExp(`^${pattern}$`, 'i');
const values = (...extra) => [...nativeValues, ...extra];
// CSS calc requires whitespace around addition. Only a leading -1 can multiply a token.
const mathBody = token => String.raw`\s*(?:-1\s*\*\s*${token}|${token}(?:\s+\+\s+${token})+)\s*`;
const withMath = token => String.raw`(?:${token}|calc\(${mathBody(token)}\))`;
const tokenMath = withMath(variable);
const disallowedMath = new RegExp(String.raw`\bcalc\((?!${mathBody(variable)}\))`, 'i');
const fromNames = names => String.raw`var\(\s*(?:${names.map(name => RegExp.escape(name)).join('|') || '(?!)'})\s*\)`;
const list = value => String.raw`${value}(?:\s*,\s*${value})*`;

export const legacyStylelintRuleNames = {
  'energy-dots/color-no-hex': 'color-no-hex',
  'energy-dots/function-disallowed-list': 'function-disallowed-list',
};

// Core paint rules also visit palette definitions. Opacity has a keyframe exception.
function scopedCoreRule(ruleName, coreRule, options, inScope, message) {
  return stylelint.createPlugin(ruleName, option => async (root, result) => {
    const { checkAgainstRule, report, validateOptions } = stylelint.utils;
    if (!validateOptions(result, ruleName, { actual: option, possible: [true] })) return;
    await checkAgainstRule({ ruleName: coreRule, ruleSettings: options, root }, warning => {
      if (!inScope(warning.node)) return;
      report({
        ruleName, result, node: warning.node,
        start: { line: warning.line, column: warning.column },
        end: { line: warning.endLine, column: warning.endColumn },
        message: message?.(warning.node) ?? warning.text.replace(` (${coreRule})`, ` (${ruleName})`),
      });
    });
  });
}

const paintPlugins = Object.entries(legacyStylelintRuleNames).map(([rule, core]) =>
  scopedCoreRule(rule, core, core === 'color-no-hex' ? true : colorFunctions, node => !node.prop.startsWith('--')),
);
const opacityRule = 'energy-dots/opacity';
const opacity = String.raw`(?:[+-]?(?:0+(?:\.0*)?|\.0+|0*1(?:\.0*)?)(?:e[+-]?0+)?|var\([^)]*(?:\([^)]*\)[^)]*)*\))`;
const opacityPlugin = scopedCoreRule(opacityRule, 'declaration-property-value-allowed-list',
  { '/^opacity$/i': [whole(opacity)] }, node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /^(?:-\w+-)?keyframes$/i.test(parent.name)) return false;
    }
    return true;
  }, node => `Energy + dots ${opacityMessage} Found "${node.prop}: ${node.value}" (${opacityRule})`);

const iconRule = 'energy-dots/icon-size';
const iconMessage = '10.4: take icon size from the language (--icon-*).';
const ICON_SELECTOR = /svg|icon/i;
const isIcon = node => node.parent?.type === 'rule' && ICON_SELECTOR.test(node.parent.selector);
function iconPlugin(allowedTokens) {
  const size = whole(`(?:0|auto|1em|100%|${withMath(fromNames(allowedTokens))})`);
  return scopedCoreRule(iconRule, 'declaration-property-value-allowed-list',
    { [iconDimensions]: values(size) }, isIcon,
    node => `Energy + dots ${iconMessage} Found "${node.prop}: ${node.value}" (${iconRule})`);
}

// MULTILINGUAL §2: physical inline edges require an explicit exception in RTL products.
const logicalValues = {
  'text-align': [/^(?:left|right)$/i],
  float: [/^(?:left|right)$/i],
  clear: [/^(?:left|right)$/i],
};
const logicalProperties = [
  'left', 'right',
  /^(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)$/i,
  /^border-(?:left|right)(?:-(?:color|style|width))?$/i,
  /^border-(?:top|bottom)-(?:left|right)-radius$/i,
];

export function stylelintRules({
  tokenFiles = existsSync(languageCss) ? [languageCss] : [],
  tokenNames = [],
  fontSizeTokenNames = [],
  kindTokenNames = {},
  breakpoints,
  ignoreFiles = [],
  logical = false,
} = {}) {
  const files = tokenFiles.map(file => resolve(file));
  const declared = new Set(tokenNames);
  const mediaSteps = [];
  for (const file of files) {
    postcss.parse(readFileSync(file, 'utf8'), { from: file }).walkDecls(/^--/, ({ prop, value }) => {
      declared.add(prop);
      if (prop.startsWith('--breakpoint-')) mediaSteps.push(value);
    });
  }

  const names = (kind, pattern) => kindTokenNames[kind] ?? [...declared].filter(name => pattern.test(name));
  const space = names('space', tokenKinds.space);
  const radius = names('radius', tokenKinds.radius);
  const line = names('line', tokenKinds.line);
  const duration = kindTokenNames.motion ?? names('duration', tokenKinds.duration);
  const curve = kindTokenNames.motion ?? names('curve', tokenKinds.curve);
  const layer = names('layer', tokenKinds.layer);
  const tracking = names('letterSpacing', tokenKinds.letterSpacing);
  const leading = names('lineHeight', tokenKinds.lineHeight);
  const weight = names('fontWeight', tokenKinds.fontWeight);
  const family = names('fontFamily', tokenKinds.fontFamily);
  const shadow = names('shadow', tokenKinds.shadow);
  const icon = names('icon', tokenKinds.icon);
  const sizes = fontSizeTokenNames.length ? fontSizeTokenNames
    : [...declared].filter(name => /^--text-(?!.*--)[\w-]+$/.test(name));

  const sizeToken = fromNames(sizes);
  const fontSize = String.raw`(?:${sizeToken}|clamp\(\s*${sizeToken}\s*,\s*${sizeToken}\s*,\s*${sizeToken}\s*\))`;
  const lineHeight = `(?:normal|1|${fromNames(leading)})`;
  const fontModifiers = String.raw`normal|italic|oblique(?:\s+${cssNumber}(?:deg|grad|rad|turn))?|small-caps|(?:ultra-|extra-|semi-)?(?:condensed|expanded)|${cssNumber}%|${fromNames(weight)}`;
  const fontShorthand = String.raw`(?:(?:${fontModifiers})\s+){0,4}${fontSize}(?:\s*/\s*${lineHeight})?\s+${fromNames(family)}`;
  const paintMix = String.raw`color-mix\(in [\w -]+,\s*(?:${variable}|transparent)(?: \d+(?:\.\d+)?%)?,\s*(?:${variable}|transparent)(?: \d+(?:\.\d+)?%)?\)`;
  const paintValues = ['transparent', 'currentColor', 'currentcolor', 'none', systemPaint, whole(variable), whole(paintMix)];
  const spacingValue = `(?:0|auto|${tokenMath})`;
  const radiusValue = `(?:0|50%|${tokenMath})`;
  const radii = String.raw`${radiusValue}(?:\s+${radiusValue}){0,3}`;
  const curveValue = String.raw`(?:${variable}|linear|step-start|step-end|steps\([^)]*\))`;
  const timeValue = `(?:${tokenMath}|0m?s)`;

  const breakpointValues = (breakpoints ?? mediaSteps).flatMap(value => {
    const rem = value.match(/^([\d.]+)rem$/);
    const px = rem ? Number(rem[1]) * 16 : Number.parseFloat(value);
    return [value, `${px}px`, `${px - 1}px`, `${Math.round((px - 0.02) * 100) / 100}px`];
  });
  const explicitNames = [...tokenNames, ...sizes, ...Object.values(kindTokenNames).flat()];
  const available = [...new Set([...declared, ...explicitNames])];
  const importFrom = [...files, { customProperties: Object.fromEntries(explicitNames.map(name => [name, {}])) }];

  return {
    ignoreFiles,
    plugins: [...paintPlugins, opacityPlugin, iconPlugin(icon), unknownCustomProperties],
    reportDescriptionlessDisables: logical ? true : [true, { except: ['property-disallowed-list'] }],
    rules: {
      'declaration-property-custom-property-allowed-list': {
        [spaceProperty]: space, [radiusProperty]: radius, [lineWidth]: line,
        [lineShorthand]: available, [paintProperty]: available, [borderColors]: available,
        [layerProperty]: layer, [motionTime]: duration, [motionCurve]: curve,
        [motionShorthand]: [...duration, ...curve],
        [weightProperty]: weight, [leadingProperty]: leading, [trackingProperty]: tracking, [familyProperty]: family,
        '/^(?:box|text)-shadow$/i': shadow,
      },
      'declaration-property-value-allowed-list': {
        [spaceProperty]: values(whole(String.raw`${spacingValue}(?:\s+${spacingValue}){0,3}`)),
        [radiusProperty]: values(whole(String.raw`${radii}(?:\s*/\s*${radii})?`)),
        [lineWidth]: values('0', 'none', whole(tokenMath)),
        [layerProperty]: values('auto', '0', '-1', whole(tokenMath)),
        [motionTime]: values(whole(list(timeValue))),
        [motionCurve]: values(whole(list(curveValue))),
        [weightProperty]: values(whole(variable)),
        [leadingProperty]: values(whole(lineHeight)),
        [familyProperty]: values(whole(variable)),
        [trackingProperty]: values('normal', '0', whole(tokenMath)),
        '/^(?:box|text)-shadow$/i': values('none', whole(list(variable))),
        [paintProperty]: values(...paintValues, 'auto'),
        [borderColors]: values(...paintValues, whole(String.raw`${variable}(?:\s+${variable}){1,3}`)),
        [sizeProperty]: values(whole(fontSize)),
        [fontProperty]: values(...systemFonts, whole(fontShorthand)),
      },
      'declaration-property-unit-allowed-list': {
        [spaceProperty]: [], [radiusProperty]: ['%'], [lineWidth]: [], [lineShorthand]: ['%'],
        [layerProperty]: [], [weightProperty]: [], [leadingProperty]: [], [trackingProperty]: [],
        '/^(?:box|text)-shadow$/i': [],
      },
      'declaration-property-value-disallowed-list': {
        [lineShorthand]: [/(?<![\w-])(?:thin|medium|thick)(?![\w-])/i, disallowedMath],
        [motionShorthand]: [
          new RegExp(String.raw`(?<![\w.-])(?![+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?m?s\b)${cssNumber}m?s(?![\w-])`, 'i'),
          /cubic-bezier\(|(?<![\w-])ease(?:-in|-out|-in-out)?(?![\w-])/i,
          disallowedMath,
        ],
        ...(logical ? logicalValues : {}),
      },
      'unit-disallowed-list': ['vh'],
      'csstools/value-no-unknown-custom-properties': [true, { importFrom }],
      ...(breakpointValues.length && {
        'media-feature-name-value-allowed-list': { '/^(?:min-|max-)?width$/i': [...new Set(breakpointValues)] },
      }),
      'energy-dots/color-no-hex': true,
      'energy-dots/function-disallowed-list': true,
      'color-named': ['never', { ignoreProperties: [/^--/, 'mask-image', '-webkit-mask-image'] }],
      [opacityRule]: true,
      [iconRule]: true,
      ...(logical ? { 'property-disallowed-list': logicalProperties } : {}),
    },
  };
}
