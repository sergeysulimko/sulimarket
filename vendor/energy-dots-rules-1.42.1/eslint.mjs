import parser from '@typescript-eslint/parser';
import tailwindcss from 'eslint-plugin-better-tailwindcss';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import namedColors from 'color-name';
import { spacingSteps } from './spacing.generated.mjs';
import { hasViewportHeight, isAllowedOpacity, opacityMessage, strokeMessage, viewportMessage } from './values.mjs';

const sourceFiles = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'];
const jsxFiles = ['**/*.{jsx,tsx}'];
const inlineStyle = 'JSXAttribute[name.name="style"] > JSXExpressionContainer > ObjectExpression > Property';
const paint = /^(?:color|background(?:Color)?|border(?:Top|Right|Bottom|Left|Block(?:Start|End)?|Inline(?:Start|End)?)?Color|outlineColor|textDecorationColor|fill|stroke|stopColor|floodColor)$/;
const hexColor = String.raw`#(?:[a-fA-F\d]{3,4}|[a-fA-F\d]{6}|[a-fA-F\d]{8})`;
const colorFunction = '(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)';
const colorNotation = String.raw`${hexColor}$|${colorFunction}\(`;
const rawColor = new RegExp(`^(?:${colorNotation}|(?:${Object.keys(namedColors).join('|')})$)`, 'i');
const svgPaint = 'JSXOpeningElement[name.name=/^(svg|g|path|circle|ellipse|line|polyline|polygon|rect|text|tspan|use|stop|feFlood)$/]' +
  ' > JSXAttribute[name.name=/^(fill|stroke|stopColor|floodColor|color)$/]';
const rawSize = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|pt|%)$/i;
const jsxChild = ':matches(JSXElement, JSXFragment) > JSXExpressionContainer';

const spaceKey = /^(?:(?:margin|padding)(?:Top|Right|Bottom|Left|Block|Inline)?(?:Start|End)?|gap|rowGap|columnGap)$/;
const radiusKey = /^border(?:(?:Top|Bottom|Start|End)(?:Left|Right|Start|End))?Radius$/;
const lineKey = /^(?:border(?:Top|Right|Bottom|Left|Block|Inline)?(?:Start|End)?(?:Width)?|outline(?:Width)?|strokeWidth)$/;
const lengthLiteral = 'Literal:matches([value=/\\d(?:px|r?em)\\b/], [raw=/^[-+]?(?:\\d*\\.)?\\d+$/]:not([raw=/^[-+]?0*(?:\\.0*)?$/]))';
const rawMotion = '/(?:^|[^\\w.-])(?=[\\d.]*[1-9])[\\d.]+m?s\\b|cubic-bezier|(?:^|[^\\w-])ease(?:-in|-out|-in-out)?(?![\\w-])/';

const colorMessage = 'Energy + dots 1.1: use a semantic color token.';
const sizeMessage = 'Energy + dots 9.4: use a type role token.';
const spaceMessage = 'Energy + dots 5.12: take spacing from the scale (--sp-*).';
const radiusMessage = 'Energy + dots 5.7: take the radius of the role from the language (--radius-*).';
const lineHeightMessage = 'Energy + dots 9.4: take line height from the type role.';
const weightMessage = 'Energy + dots 9.4: take weight from the type role.';
const familyMessage = 'Energy + dots 9.5: take the family from the language (--font-sans, --font-mono).';
const trackingMessage = 'Energy + dots 9.4: take tracking from the type role.';
const lineMessage = 'Energy + dots 5.9: take line width from the language (--hairline).';
const shadowMessage = 'Energy + dots 1.4: take the shadow from the language (--shadow-*).';
const motionMessage = 'Energy + dots 2.1: take duration and curve from the language (--t-*, --ease-*).';
const headingMessage = 'Energy + dots 9.13: use text-balance for headings.';
const layerMessage = 'Energy + dots 4.4: take the layer from the ladder (--z-*).';
const iconMessage = 'Energy + dots 10.4: take icon size from the language (--icon-* through a size class or the shared icon).';
const numberMessage = 'Energy + dots 9.6: use the shared numeric formatter (including percentages).';
const styleKey = key => `:matches([key.name=${key}], [key.value=${key}])`;

// Tailwind arbitrary values bypass the theme generated from the language. `p-(--sp-3)` and `p-[var(--sp-3)]` stay allowed.
const variants = String.raw`^(?:[\w-]+:|\[[^\]]+\]:)*!?-?`;
const handValue = String.raw`\[(?!var\()[^\]]*\d[^\]]*\]!?$`;
const bracketValue = String.raw`(?:[^\[\]]|\[[^\[\]]*\])*`;
const variant = String.raw`(?:[\w@-]+(?:-\[${bracketValue}\])?|\[${bracketValue}\])(?:/[\w-]+)?`;
const utility = String.raw`^(?:${variant}:)*!?-?`;
const number = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const stockPalette = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe)-(?:50|[1-9]00|950)';
const paintUtility = '(?:bg|text|border(?:-[xytrblse]|-b[se])?|ring(?:-offset)?|inset-ring|from|via|to|fill|stroke|divide|outline|decoration|accent|caret|shadow|inset-shadow|drop-shadow|placeholder)';
const spaceUtility = '(?:[pm](?:[xytrblse]|b[se])?|gap(?:-[xy])?|space-[xy])';
const utilityModifier = String.raw`(?:/[\w.-]+|/\[${bracketValue}\]|/\(--[\w-]+\))?`;
const foundClass = (pattern, message) => ({ pattern, message: `${message} Found "$0".` });

function colorClasses(colorNames) {
  const registered = colorNames.length ? `(?!(?:${colorNames.map(RegExp.escape).join('|')})(?=/|!?$))` : '';
  const literal = String.raw`(?i:${hexColor}|${colorFunction}\(${bracketValue}\)|${Object.keys(namedColors).join('|')})`;
  const arbitrary = String.raw`\[(?:color:)?${literal}\]`;
  const bareValue = String.raw`[^()[\]'"]`;
  const mixInput = String.raw`(?:${bareValue}|\((?:${bareValue}|\(${bareValue}*\))*\))*`;
  const hex = String.raw`${hexColor}(?![\da-fA-F])`;
  const mixWithHex = String.raw`(?i:color-mix)\(${mixInput}(?:${hex}|\(${bareValue}*${hex}${bareValue}*\))${mixInput}\)`;
  return [
    foundClass(String.raw`${utility}${paintUtility}-${registered}(?:${stockPalette}|black|white)${utilityModifier}!?$`, colorMessage),
    foundClass(String.raw`${utility}${paintUtility}-${arbitrary}${utilityModifier}!?$`, colorMessage),
    foundClass(String.raw`${utility}\[--[\w-]+:${literal}\]!?$`, colorMessage),
    foundClass(String.raw`${utility}(?:[\w-]+-)?\[(?!(?i:url)\()[^'"\]]*\b${mixWithHex}${bracketValue}\]${utilityModifier}!?$`, colorMessage),
  ];
}

function spacingScaleClass(steps) {
  const allowed = [0, ...steps].map(step => RegExp.escape(String(step))).join('|');
  return foundClass(String.raw`${utility}${spaceUtility}-(?!(?:${allowed})!?$)(?:${number}|px)!?$`, spaceMessage);
}

function typeScaleClass(typeNames) {
  const registered = typeNames.length ? `(?!(?:${typeNames.map(RegExp.escape).join('|')})(?=/|!?$))` : '';
  return foundClass(String.raw`${utility}text-${registered}(?:xs|sm|base|lg|xl|[2-9]xl)${utilityModifier}!?$`, sizeMessage);
}
const viewportHeight = String.raw`(?<![a-zA-Z\d.#-])(?<!\b(?:var|env)\([\w-]*)[-+]?${number}(?:[eE][+-]?\d+)?[vV][hH](?![a-zA-Z0-9])`;
const viewportClasses = [
  { pattern: String.raw`${utility}(?:(?:min-|max-)?h|size)-screen!?$`, message: `Energy + dots ${viewportMessage}` },
  { pattern: String.raw`${utility}[\w-]+-\[(?!.*(?:['"]|[uU][rR][lL]\())${bracketValue}${viewportHeight}${bracketValue}\]!?$`, message: `Energy + dots ${viewportMessage}` },
];

function opacityClasses(colorNames) {
  const colors = ['black', 'white', 'current', 'transparent', ...colorNames].map(name => RegExp.escape(name));
  const arbitraryColor = String.raw`(?:\[(?:color:${bracketValue}|#[\da-fA-F]+|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|var)\(${bracketValue}\)|${Object.keys(namedColors).join('|')}|currentColor|transparent)\]|\((?:color:)?--[\w-]+\))`;
  const paint = String.raw`(?:bg|text|border(?:-[xytrblse])?)-(?:${colors.join('|')}|${stockPalette}|${arbitraryColor})`;
  const numericModifier = String.raw`(?:${number}|\[${number}%?\])`;
  return [
    { pattern: String.raw`${utility}opacity-(?!(?:0|100)!?$)${number}!?$`, message: `Energy + dots ${opacityMessage}` },
    { pattern: String.raw`${utility}${paint}/${numericModifier}!?$`, message: `Energy + dots ${opacityMessage}` },
  ];
}
const arbitrarySpace = { pattern: `${variants}${spaceUtility}-${handValue}`, message: spaceMessage };
const arbitrarySize = { pattern: String.raw`${variants}text-\[(?!var\()[\d.]+(?:px|r?em)\]!?$`, message: sizeMessage };
const arbitraryMotion = { pattern: `${variants}(?:duration|delay|ease)-${handValue}`, message: motionMessage };
const otherArbitraryClasses = [
  { pattern: `${variants}rounded(?:-[a-z]{1,2})?-${handValue}`, message: radiusMessage },
  { pattern: `${variants}leading-${handValue}`, message: lineHeightMessage },
  { pattern: String.raw`${variants}font-\[\d+\]!?$`, message: weightMessage },
  { pattern: `${variants}tracking-${handValue}`, message: trackingMessage },
  { pattern: String.raw`${variants}(?:border(?:-[xytrblse])?|outline|ring|stroke)-\[(?!var\()[\d.]+(?:px|r?em)?\]!?$`, message: lineMessage },
  { pattern: `${variants}shadow-${handValue}`, message: shadowMessage },
  { pattern: `${variants}z-${handValue}`, message: layerMessage },
];
export const arbitraryClassRules = [arbitrarySpace, arbitrarySize, arbitraryMotion, ...otherArbitraryClasses];

const colorSelectors = [
  {
    selector: `${inlineStyle}:matches([key.name=${paint}], [key.value=${paint}]) > Literal[value=${rawColor}]`,
    message: colorMessage,
  },
  {
    selector: `:matches(${svgPaint} > Literal, ${svgPaint} > JSXExpressionContainer > Literal)[value=${rawColor}]`,
    message: colorMessage,
  },
];
const sizeSelector = {
  selector: `${inlineStyle}:matches([key.name="fontSize"], [key.value="fontSize"]) > Literal` +
    `:matches([raw=/^[-+.0-9]/], [value=${rawSize}])`,
  message: sizeMessage,
};
const spaceSelector = { selector: `${inlineStyle}${styleKey(spaceKey)} > ${lengthLiteral}`, message: spaceMessage };
const motionSelector = {
  selector: `${inlineStyle}${styleKey('/^(?:transition|animation)(?:Duration|Delay|TimingFunction)?$/')} > Literal[value=${rawMotion}]`,
  message: motionMessage,
};

const tokenSelectors = [
  { selector: `${inlineStyle}${styleKey(radiusKey)} > ${lengthLiteral}`, message: radiusMessage },
  {
    selector: `${inlineStyle}${styleKey('"lineHeight"')} > Literal:matches([raw=/^[.0-9]/]:not([raw="1"]), [value=/\\d/])`,
    message: lineHeightMessage,
  },
  {
    selector: `${inlineStyle}${styleKey('"fontWeight"')} > Literal:matches([raw=/^[0-9]/], [value=/^(?:\\d+|bold|bolder|lighter|normal)$/])`,
    message: weightMessage,
  },
  { selector: `${inlineStyle}${styleKey('"fontFamily"')} > Literal[value=/^(?!var\\()/]`, message: familyMessage },
  { selector: `${inlineStyle}${styleKey('"letterSpacing"')} > ${lengthLiteral}`, message: trackingMessage },
  { selector: `${inlineStyle}${styleKey(lineKey)} > ${lengthLiteral}`, message: lineMessage },
  { selector: `${inlineStyle}${styleKey('/^(?:box|text)Shadow$/')} > Literal[value=/\\d/]`, message: shadowMessage },
  { selector: `${inlineStyle}${styleKey('"zIndex"')} > Literal:matches([raw=/^[1-9]/], [value=/^[1-9]/])`, message: layerMessage },
  // Icon libraries take a numeric size prop; the size comes from the language.
  { selector: 'JSXAttribute[name.name="size"] > JSXExpressionContainer > Literal[raw=/^[1-9]/]', message: iconMessage },
];

const numberSelectors = [
  {
    selector: `${jsxChild} > CallExpression[callee.property.name=/^(toFixed|toLocaleString)$/]`,
    message: numberMessage,
  },
  {
    selector: `${jsxChild} > TemplateLiteral > TemplateElement[tail=true][value.raw=/^\\s*%\\s*$/]`,
    message: numberMessage,
  },
  {
    selector: `${jsxChild} + JSXText[value=/^\\s*%\\s*$/]`,
    message: numberMessage,
  },
  {
    selector: ':matches(CallExpression, NewExpression)[callee.object.name="Intl"]' +
      '[callee.property.name=/^(NumberFormat|DateTimeFormat)$/]',
    message: numberMessage,
  },
];

// One subject, one component (5.17): a literal JSX element outside the product's adapter of the language component.
const noRawElement = (element) => ({
  meta: {
    schema: [{ type: 'string' }],
    messages: { useComponent: 'Energy + dots 5.17: use {{component}}.' },
  },
  create(context) {
    const [component] = context.options;
    return {
      [`JSXOpeningElement[name.name="${element}"]`](node) {
        context.report({ node, messageId: 'useComponent', data: { component } });
      },
    };
  },
});
const noRawSelect = noRawElement('select');
const noRawButton = noRawElement('button');

function literalValue(node) {
  if (node?.type === 'Literal' && ['number', 'string'].includes(typeof node.value)) return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node?.type === 'UnaryExpression' && /^[+-]$/.test(node.operator) && typeof node.argument.value === 'number') {
    return node.operator === '-' ? -node.argument.value : node.argument.value;
  }
  if (node?.type === 'TSAsExpression' || node?.type === 'TSSatisfiesExpression') return literalValue(node.expression);
}

const tailwindRestrictions = tailwindcss.rules['no-restricted-classes'];
function valueRule(listeners, extraSchema = []) {
  return {
    meta: { ...tailwindRestrictions.meta, fixable: undefined, schema: [...tailwindRestrictions.meta.schema, ...extraSchema] },
    create(context) {
      return {
        ...(context.options[0]?.restrict?.length && tailwindRestrictions.create(context)),
        ...listeners(context),
      };
    },
  };
}

function styleValueRule(message, violates, property = '') {
  return valueRule(context => ({
    [inlineStyle + property](node) {
      const value = literalValue(node.value);
      if (value !== undefined && violates(value)) context.report({ node: node.value, message: `Energy + dots ${message}` });
    },
  }));
}

function selectorListeners(context, selectors) {
  return Object.fromEntries(selectors.map(({ selector, message }) => [selector, node => context.report({ node, message })]));
}

function jsxName(node) {
  return node.type === 'JSXMemberExpression' ? `${jsxName(node.object)}.${node.property.name}` : node.name;
}

const stringList = { type: 'array', items: { type: 'string' } };
const headingWrap = {
  meta: { schema: [stringList] },
  create(context) {
    const headings = new Set(context.options[0]);
    const prettyClass = new RegExp(`${utility}text-pretty!?$`);
    return {
      'JSXAttribute[name.name="className"] :matches(Literal, TemplateElement)'(node) {
        const ancestors = context.sourceCode.getAncestors(node);
        const attribute = ancestors.findLast(parent => parent.type === 'JSXAttribute');
        const name = jsxName(attribute.parent.name);
        if (attribute.name.name !== 'className' || !(/^h[1-6]$/.test(name) || headings.has(name))) return;
        if (ancestors.some(parent => parent.type === 'ConditionalExpression' && parent.test.range[1] >= node.range[1] ||
          parent.type === 'BinaryExpression' && parent.operator !== '+')) return;

        const text = node.type === 'TemplateElement' ? node.value.cooked : node.value;
        if (typeof text !== 'string') return;
        const classes = text.split(/\s+/);
        if (node.type === 'TemplateElement') {
          // Interpolated portions can be part of the same class.
          if (node.parent.quasis[0] !== node) classes.shift();
          if (!node.tail) classes.pop();
        }
        for (const candidate of classes) {
          if (prettyClass.test(candidate)) context.report({ node, message: `${headingMessage} Found "${candidate}".` });
        }
      },
    };
  },
};

const motionPackage = /^(?:framer-motion|motion(?:\/react(?:-mini|-m)?)?)$/;
const motionProp = /^(?:transition|animate|variants|initial|exit|whileHover|whileTap|whileFocus|whileDrag|whileInView|dragTransition)$/;
const timeProperty = /^(?:duration|delay)$/;
function motionListeners(context) {
  const { components = [], presets = [] } = context.options[1] ?? {};
  const factories = new Set(['motion', 'm']);
  const motionComponents = new Set(['MotionConfig', ...components]);
  const animateFunctions = new Set();

  function checkOptions(node, timing) {
    if (node?.type === 'ConditionalExpression') {
      checkOptions(node.consequent, timing);
      checkOptions(node.alternate, timing);
    } else if (node?.type === 'TSAsExpression' || node?.type === 'TSSatisfiesExpression') {
      checkOptions(node.expression, timing);
    } else if (node?.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (property.type !== 'Property') continue;
        const key = property.computed ? property.key.value : property.key.name ?? property.key.value;
        const value = literalValue(property.value);
        if (timing && timeProperty.test(key) && typeof value === 'number') {
          const usePresets = presets.length ? ` Use an imported preset (${presets.join(', ')}).` : '';
          context.report({ node: property.value, message: `${motionMessage} Found "${key}: ${value}".${usePresets}` });
        }
        checkOptions(property.value, timing || key === 'transition');
      }
    }
  }

  return {
    ...selectorListeners(context, [motionSelector]),
    Program(node) {
      for (const statement of node.body) {
        if (statement.type !== 'ImportDeclaration' || !motionPackage.test(statement.source.value)) continue;
        for (const specifier of statement.specifiers) {
          const imported = specifier.imported?.name ?? specifier.imported?.value;
          if (imported === 'motion' || imported === 'm') factories.add(specifier.local.name);
          if (imported === 'MotionConfig') motionComponents.add(specifier.local.name);
          if (imported === 'animate') animateFunctions.add(specifier.local.name);
        }
      }
    },
    'JSXAttribute > JSXExpressionContainer'(node) {
      const prop = node.parent.name.name;
      if (!motionProp.test(prop)) return;
      const name = node.parent.parent.name;
      if (motionComponents.has(jsxName(name)) || (name.type === 'JSXMemberExpression' && factories.has(jsxName(name.object)))) {
        checkOptions(node.expression, prop === 'transition' || prop === 'dragTransition');
      }
    },
    'CallExpression[callee.type="Identifier"]'(node) {
      if (!animateFunctions.has(node.callee.name)) return;
      checkOptions(node.arguments[2] ?? (node.arguments[0]?.type === 'ArrayExpression' ? node.arguments[1] : undefined), true);
    },
  };
}

const strokeToken = /^var\(\s*--(?:icon|chart)-stroke\s*\)$/;
const strokeRule = {
  meta: { schema: [], messages: { useStroke: `Energy + dots ${strokeMessage}` } },
  create(context) {
    return {
      'JSXAttribute[name.name="strokeWidth"]'(node) {
        const value = literalValue(node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value);
        if (typeof value === 'number' || typeof value === 'string' && !strokeToken.test(value.trim())) {
          context.report({ node, messageId: 'useStroke' });
        }
      },
    };
  },
};
const plugin = { rules: {
  'no-raw-select': noRawSelect,
  'no-raw-button': noRawButton,
  'viewport-unit': styleValueRule(viewportMessage, value => typeof value === 'string' && hasViewportHeight(value)),
  opacity: styleValueRule(opacityMessage, value => !isAllowedOpacity(value),
    ':matches([computed=false][key.name="opacity"], [key.value="opacity"])'),
  line: strokeRule,
  color: valueRule(context => selectorListeners(context, colorSelectors)),
  space: valueRule(context => selectorListeners(context, [spaceSelector])),
  'type-size': valueRule(context => selectorListeners(context, [sizeSelector])),
  motion: valueRule(motionListeners, [{
    type: 'object', properties: { components: stringList, presets: stringList }, additionalProperties: false,
  }]),
  'heading-wrap': headingWrap,
} };

const a11yRuleNames = [
  'alt-text', 'anchor-is-valid', 'no-autofocus', 'label-has-associated-control', 'role-supports-aria-props',
  'role-has-required-aria-props', 'aria-props', 'aria-role', 'no-redundant-roles', 'heading-has-content',
  'html-has-lang', 'iframe-has-title', 'img-redundant-alt', 'no-access-key', 'tabindex-no-positive',
];
const a11yRules = Object.fromEntries(a11yRuleNames.map(name => [`jsx-a11y/${name}`, 'error']));

export const sharedEslintRules = new Set([
  'no-restricted-syntax', 'no-restricted-imports', 'better-tailwindcss/enforce-logical-properties',
  'better-tailwindcss/no-restricted-classes', 'energy-dots/no-raw-button', 'energy-dots/viewport-unit',
  'energy-dots/opacity', 'energy-dots/line', 'energy-dots/color', 'energy-dots/motion', 'energy-dots/space',
  'energy-dots/type-size', 'energy-dots/heading-wrap', ...Object.keys(a11yRules),
]);

const importPaths = paths => ['error', { paths }];
const doorPath = ({ from, importNames, use }, canon = '5.17') => ({
  name: from,
  ...(importNames && { importNames }),
  message: `Energy + dots ${canon}: use ${use}.`,
});

/** A consumer names its adapters and opts into the checks that depend on its stack. */
export function eslintRules({
  tabs, doors = [], select = {}, button, headingComponents = [], motionComponents = [], motionPresetNames = [],
  formatFiles = [], tailwind, tailwindColorNames = [], tailwindScale = false, tailwindSpacingSteps = spacingSteps,
  tailwindTypeNames = [], strokeAdapters = [], logical = false, a11y = false,
} = {}) {
  const componentSelectors = tabs ? [{
    selector: 'JSXAttribute[name.name="role"] > Literal[value=/^(tab|tablist|tabpanel)$/]',
    message: `Energy + dots 8.5: use ${tabs.component}.`,
  }] : [];
  const doorPaths = doors.map(door => doorPath(door));
  const spaceClasses = [arbitrarySpace, ...(tailwindScale ? [spacingScaleClass(tailwindSpacingSteps)] : [])];
  const sizeClasses = [arbitrarySize, ...(tailwindScale ? [typeScaleClass(tailwindTypeNames)] : [])];
  const config = [
    {
      files: sourceFiles,
      languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      linterOptions: { reportUnusedDisableDirectives: 'off' },
    },
    {
      files: jsxFiles,
      rules: { 'no-restricted-syntax': ['error', ...tokenSelectors] },
    },
    {
      files: tailwind ? sourceFiles : jsxFiles,
      plugins: { 'energy-dots': plugin },
      ...(tailwind && { settings: { 'better-tailwindcss': tailwind } }),
      rules: {
        'energy-dots/viewport-unit': tailwind ? ['error', { restrict: viewportClasses }] : 'error',
        'energy-dots/opacity': tailwind ? ['error', { restrict: opacityClasses(tailwindColorNames) }] : 'error',
      },
    },
    {
      files: sourceFiles,
      plugins: { 'energy-dots': plugin },
      rules: {
        'energy-dots/color': tailwind ? ['error', { restrict: colorClasses(tailwindColorNames) }] : 'error',
        'energy-dots/space': tailwind ? ['error', { restrict: spaceClasses }] : 'error',
        'energy-dots/type-size': tailwind ? ['error', { restrict: sizeClasses }] : 'error',
        'energy-dots/motion': ['error', tailwind ? { restrict: [arbitraryMotion] } : {}, {
          components: motionComponents, presets: motionPresetNames,
        }],
        'energy-dots/heading-wrap': ['error', headingComponents],
      },
    },
    {
      files: jsxFiles,
      ignores: strokeAdapters,
      plugins: { 'energy-dots': plugin },
      rules: { 'energy-dots/line': 'error' },
    },
    {
      files: jsxFiles,
      ignores: select.adapters ?? [],
      plugins: { 'energy-dots': plugin },
      rules: { 'energy-dots/no-raw-select': ['error', select.component ?? 'the design language select component'] },
    },
    ...(button ? [{
      files: jsxFiles,
      // The select adapter's <button><selectedcontent> is the customizable select's own part.
      ignores: [...(button.adapters ?? []), ...(select.adapters ?? [])],
      plugins: { 'energy-dots': plugin },
      rules: { 'energy-dots/no-raw-button': ['error', button.component ?? 'the design language button <ed-button>'] },
    }] : []),
    {
      files: jsxFiles,
      ignores: formatFiles,
      rules: { 'no-restricted-syntax': ['error', ...tokenSelectors, ...numberSelectors] },
    },
  ];
  if (doorPaths.length) config.push({ files: sourceFiles, rules: { 'no-restricted-imports': importPaths(doorPaths) } });
  if (tabs) {
    config.push({
      files: jsxFiles,
      ignores: [...(tabs.adapters ?? []), ...formatFiles],
      rules: { 'no-restricted-syntax': ['error', ...tokenSelectors, ...numberSelectors, ...componentSelectors] },
    }, {
      files: sourceFiles,
      ignores: tabs.adapters,
      rules: {
        // Flat config replaces options. Keep the other doors when applying the tabs door.
        'no-restricted-imports': importPaths([
          ...doorPaths, doorPath({ from: tabs.upstream, importNames: tabs.importNames, use: tabs.component }, '8.5'),
        ]),
      },
    });
  }
  if (a11y) config.push({ files: sourceFiles, plugins: { 'jsx-a11y': jsxA11y }, rules: a11yRules });
  if (tailwind) {
    config.push({
      files: jsxFiles,
      plugins: { 'better-tailwindcss': tailwindcss },
      settings: { 'better-tailwindcss': tailwind },
      rules: { 'better-tailwindcss/no-restricted-classes': ['error', { restrict: otherArbitraryClasses }] },
    });
  }
  if (logical && tailwind) {
    config.push({
      files: jsxFiles,
      plugins: { 'better-tailwindcss': tailwindcss },
      settings: { 'better-tailwindcss': tailwind },
      rules: {
        'better-tailwindcss/enforce-logical-properties': ['error', {
          // MULTILINGUAL §2 governs inline direction. Sizes and the block axis have their own layout contracts.
          ignore: ['(?:^|:)(?:ltr|rtl):', '(?:^|:)-?(?:(?:scroll-)?[mp][tb]-|top-|bottom-|border-[tb](?:-|$)|(?:min-|max-)?[hw]-|size-)'],
        }],
      },
    });
  }
  return config;
}
