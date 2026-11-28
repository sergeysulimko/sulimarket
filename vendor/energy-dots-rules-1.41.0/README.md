# Energy + dots code rules

The design center's exact source checks. See the [coverage map](../canon/rule-coverage.json) for canon IDs and limits.
The consumer supplies its adapters and file scope. The shared presets use the vendor rule engines.

| Canon | Tool | Checked syntax | Fixture |
| --- | --- | --- | --- |
| 1.1 | ESLint | Color literals in JSX style and SVG paint, stock Tailwind palette, arbitrary paint, color custom properties and hex in `color-mix()` in class values (`energy-dots/color`) | `rules.test.mjs` |
| 1.1 | stylelint | CSS paint literals in uses and shared variables in paint declarations | `rules.test.mjs` |
| 1.1 | SwiftLint | Numeric SwiftUI, AppKit and UIKit color constructors | `swiftlint.test.mjs` |
| 1.4 | stylelint, ESLint | Shadows: `box-shadow`, `text-shadow`, JSX style, Tailwind `shadow-[...]` (`energy-dots/shadow`) | `rules.test.mjs` |
| 1.19 | stylelint, ESLint | Static opacity in CSS and JSX style, plus Tailwind opacity utilities and numeric paint modifiers (`energy-dots/opacity`) | `rules.test.mjs` |
| 2.1, 2.2 | stylelint, ESLint | Durations, delays and curves in transition and animation, JSX style, Tailwind `duration-`/`delay-`/`ease-[...]`, numeric times in Motion options (`energy-dots/motion`) | `rules.test.mjs` |
| 4.4 | stylelint, ESLint | `z-index` from the layer ladder, JSX style, Tailwind `z-[...]` (`energy-dots/layer`) | `rules.test.mjs` |
| 5.7 | stylelint, ESLint | Radius and corner radii, JSX style, Tailwind `rounded-[...]` (`energy-dots/radius`) | `rules.test.mjs` |
| 5.9 | stylelint, ESLint | Line widths, also inside `border`/`outline` shorthands, JSX style and Tailwind `border-[length]`. Literal JSX `strokeWidth` uses `energy-dots/line` | `rules.test.mjs` |
| 5.12 | stylelint, ESLint | Margin, padding, gap, JSX style, Tailwind `p-`/`m-`/`gap-`/`space-[...]` and optional numeric steps from the token scale (`energy-dots/space`) | `rules.test.mjs` |
| 5.17 | ESLint | Literal JSX `<select>` outside the product’s select adapter | `rules.test.mjs` |
| 5.17 | ESLint | Configured whole-package or named imports use the product door (`no-restricted-imports`) | `rules.test.mjs` |
| 8.5 | ESLint | App tabs entry point instead of direct Radix imports or raw tab roles | `rules.test.mjs` |
| 9.4 | ESLint | JSX font size literals, Tailwind `text-[size]` and optional stock type sizes (`energy-dots/type-size`) | `rules.test.mjs` |
| 9.4 | stylelint | Type scale sizes in CSS `font-size` and `font`, including token-only `clamp()` | `rules.test.mjs` |
| 9.4 | SwiftLint | Numeric SwiftUI and AppKit font sizes | `swiftlint.test.mjs` |
| 9.4 | stylelint, ESLint | Line height, weight and tracking in their properties and the `font` shorthand, JSX style, Tailwind `leading-`/`font-`/`tracking-[...]` (`energy-dots/line-height`, `font-weight`, `letter-spacing`) | `rules.test.mjs` |
| 9.5 | stylelint, ESLint | Font family in `font-family`, the `font` shorthand and JSX style (`energy-dots/font-family`) | `rules.test.mjs` |
| 9.6 | ESLint | Direct display rounding, percent suffixes and Intl formatters in JSX files | `rules.test.mjs` |
| 9.13 | ESLint | `text-pretty` overrides on native headings or named heading components (`energy-dots/heading-wrap`) | `rules.test.mjs` |
| 10.1 | stylelint | Media `width` at the language breakpoints, including ranges (`media-feature-name-value-allowed-list`) | `rules.test.mjs` |
| 10.4 | stylelint, ESLint | Icon sizes in `svg`/`icon` rules and numeric JSX `size` props (`energy-dots/icon-size`) | `rules.test.mjs` |
| 10.18 | stylelint, ESLint | Legacy `vh` in CSS values, JSX style and Tailwind arbitrary values. Tailwind screen-height utilities use the explicit viewport scale (`energy-dots/viewport-unit`) | `rules.test.mjs` |
| JSX.A11Y | ESLint | Opt-in vendor rules for alternative text, links, labels, roles and ARIA, headings, language, iframe titles and keyboard attributes | `rules.test.mjs` |
| MULTILINGUAL §2 | ESLint | With `logical: true`, physical inline Tailwind utilities with a logical replacement (autofix available) | `rules.test.mjs` |
| MULTILINGUAL §2 | stylelint | With `logical: true`, physical inline edges and `left`/`right` in `text-align`, `float` and `clear` | `rules.test.mjs` |

## Adoption

Copy `design-language/rules` from a reviewed sulimko.com commit into the same vendor location as the token
bundle. Record that commit and the rules version with the token pin. The [consumer map](../consumers.json)
tracks adoption. Install the vendored package and run checks from the consuming project:

```sh
pnpm add -D 'file:./vendor/energy-dots-rules'
pnpm exec energy-dots-check
```

[pnpm 10's `file:` protocol](https://pnpm.io/10.x/cli/link#whats-the-difference-between-pnpm-link-and-using-the-file-protocol)
installs the package's dependencies. A bare directory path creates a link and leaves those dependencies
uninstalled. Add `-w` when the consumer is the workspace root. On update, replace the vendored files, run
`pnpm install --no-frozen-lockfile`, and commit the updated lockfile and pin with the vendor copy.

Create `energy-dots.config.mjs` at the project root:

```js
import { eslintRules } from '@energy-dots/rules/eslint';
import { stylelintRules } from '@energy-dots/rules/stylelint';

const logical = false;

export default {
  baseline: 'energy-dots-baseline.json',
  eslint: {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    config: eslintRules({
      tabs: { upstream: '@radix-ui/react-tabs', component: './ui/tabs', adapters: ['src/ui/tabs.tsx'] },
      doors: [{ from: 'sonner', importNames: ['toast'], use: './ui/toast' }],
      select: { component: 'NativeSelect from ./ui/native-select', adapters: ['src/ui/native-select.tsx'] },
      formatFiles: ['src/ui/format.tsx'],
      tailwind: { entryPoint: 'src/styles.css' },
      tailwindColorNames: ['ink', 'surface'],
      tailwindScale: true,
      headingComponents: ['PageTitle'],
      a11y: true,
      logical,
    }),
  },
  stylelint: {
    files: ['src/**/*.css'],
    config: stylelintRules({ tokenFiles: ['vendor/energy-dots.css'], logical }),
  },
};
```

The direction checks default to off. Set the shared `logical` option to `true` in a product with planned
right-to-left writing (currently Maps Agent, corp rule 10.15 and MULTILINGUAL §2). ESLint also needs the
product's Tailwind entry point.

Pass the shared language stylesheet in `tokenFiles` relative to the project root. Stylelint takes the known names
and breakpoint values from it. The optional `tokenNames` and `fontSizeTokenNames` options cover approved external
properties and explicit size scales. Use `kindTokenNames` to set an explicit allow-list for a specific scale.
Put generated files outside the source globs.
In `font-size` and `font`, use a direct size token or a `clamp()` with three direct size tokens.
Raw sizes and size token fallbacks report a violation.
The shared CLI runs the design rules. Product lint rules and React Hooks diagnostics belong to the
product's own ESLint run. A project that already runs ESLint or Stylelint can also load the exported
presets in its existing config. Add the shared command alongside the project's own checks. To fix a direct
Tailwind replacement, use `eslint --fix` with the exported flat config in the consuming project.

For Swift, copy `swiftlint.yml` beside the token pin and make it the parent of the project's design config.
Keep product-specific rules and exclusions in the child config. Use SwiftLint 0.65.1 or later. Swift fixtures run
with `pnpm --filter @energy-dots/rules test:swift`. On Linux, run the fixtures with a SwiftLint build that has SourceKit, such as the official container.

## Updating to 1.31.0

- Supply the generated language CSS in `tokenFiles`. The CSS Tools plugin also recognizes properties defined in the
  linted stylesheet and its imports. A local definition alone cannot add a name to a shared scale.
- Use a spacing token for one step, `calc(var(--sp-1) + var(--sp-2))` for a sum and
  `calc(-1 * var(--sp-2))` for a negative margin. The 2 px and 6 px steps are `--sp-0-5` and `--sp-1-5`.
- See the [rule mapping](../canon/1.31.0-measurement.md#css-rule-ids) when reviewing CSS disable directives and baseline
  entries. A baseline key contains the rule ID and message, so rules that changed either appear as new until reviewed.
  Keep the old baseline for comparison when recording the reviewed findings under their current rule IDs.

## Updating to 1.29.0

- `energy-dots/color` checks class values when `tailwind` is configured. Pass registered `--color-*` suffixes
  in `tailwindColorNames` to retain explicit product aliases and identify paint modifiers for the opacity rule.
  Semantic token references and fragment URLs pass the color check.
- `energy-dots/motion` reports numeric `duration` and `delay` in inline Motion transition objects and in options
  passed to an imported `animate()`. Token and preset references pass. Add wrappers in `motionComponents` and
  approved names in `motionPresetNames` to show them in diagnostics.
- `energy-dots/heading-wrap` catches `text-pretty` on `h1` through `h6` and `headingComponents`. Headings can
  inherit balance from the base stylesheet. It still applies when the product has no Tailwind entry point.
- A `doors` entry takes `from` (the exact module), optional `importNames` and `use` (the product import path).
  Without `importNames` the whole module is restricted. Scope an ESLint override to the adapter file when it
  needs the upstream import. The `tabs` option already scopes its adapter and composes with `doors`.
  If a later flat-config block sets its own `no-restricted-imports` options, carry forward the applicable paths
  in that block. [ESLint rule options](https://eslint.org/docs/latest/rules/no-restricted-imports).
- With `tailwindScale: true`, `energy-dots/space` accepts spacing steps `0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16`
  and `energy-dots/type-size` reports the stock `text-xs` through `text-9xl` utilities. The steps come from the
  bundled language tokens. A product can supply `tailwindSpacingSteps` from its own tokens or list deliberately
  reused stock names in `tailwindTypeNames`.
- With `a11y: true`, the preset enables these 15 rules at error: `alt-text`, `anchor-is-valid`, `no-autofocus`,
  `label-has-associated-control`, `role-supports-aria-props`, `role-has-required-aria-props`, `aria-props`,
  `aria-role`, `no-redundant-roles`, `heading-has-content`, `html-has-lang`, `iframe-has-title`,
  `img-redundant-alt`, `no-access-key` and `tabindex-no-positive`. The fixtures exercise all of them on ESLint
  10.14.0. The vendor's published peer range stops at ESLint 9. [jsx-a11y package](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/v6.10.2/package.json).

The CLI honors existing baseline entries for JSX color, motion, spacing and type checks under their previous
rule IDs. Measure each new check before adopting it. [Adoption measurements](../canon/1.29.0-measurement.md).

## Updating to 1.27.0

- `energy-dots/viewport-unit` reports `vh` and Tailwind screen-height utilities. Choose `svh`, `dvh` or `lvh`
  for the specific surface. There is no automatic replacement.
- `energy-dots/opacity` accepts `0`, `1`, `var()` and CSS keyframes. A transition can go from zero to one.
  Pass the custom Tailwind paint names (the `--color-*` suffixes) as `tailwindColorNames`. The check also knows
  the stock palette and explicit arbitrary paints. This distinguishes `text-ink/40` from a type size such as
  `text-copy-13/6`, where the slash sets line height.
- The ESLint form of `energy-dots/line` reports literal `strokeWidth` on JSX elements and components. Use
  `var(--icon-stroke)` or `var(--chart-stroke)` in SVG, or pass the value from the product's icon adapter.
  Products with a dedicated adapter can name its source file under `strokeAdapters`.

Run the new checks over current source before adding the existing findings to a consumer baseline.
See the [adoption measurements](../canon/1.27.0-measurement.md).

## Updating to 1.26.0

The language has its button element `<ed-button>` (README "Button"). One subject, one component (5.17): a consumer
that connected it names its adapter, and the check highlights every raw `<button>` beside it.

- JSX: `eslintRules({ button: { component: 'Button from ./button', adapters: ['src/components/ui/button.tsx'] } })`
  turns on `energy-dots/no-raw-button`. The select adapters are ignored too: their `<button><selectedcontent>` is
  the select's part. Without the option the rule is off.
- HTML text (Python strings, JS templates): `markup: { files: ['*.py', 'js/*.js'], exclude: ['test_*.py'] }` in
  `energy-dots.config.mjs`. A `<button>` right after `<ed-button …>`, the select's own button and a button with a
  language class (`ed-table-control`) pass.

The language CSS sits in cascade layers `ed.base, ed.theme, ed.brand, ed.components`. A config that read token
names from `energy-dots.css` by a two-space indent (`/^  (--text-…):/`) reads nothing now: use `/^\s+(--text-…):/`.
Record the raw buttons as legacy the same way as the 1.25.0 hand values.

## Updating to 1.25.0

Every kind of value with a token in the language now has a rule: spacing, radius, line width, shadow, motion,
layer, icon size, line height, weight, tracking, family and breakpoints, beside color and size. Each kind is its own
Stylelint rule (`energy-dots/<kind>`), so the check prints hand values by kind and an exception names its kind.
A kind accepts `var()` of `tokenNames`; `kindTokenNames: { space, radius, lineHeight, fontWeight, fontFamily,
letterSpacing, line, shadow, motion, layer, icon }` narrows a kind to its own tokens. Math (`calc()`, `min()`,
`max()`, `clamp()`) passes when it holds only tokens and unitless factors, so in-element steps 2, 3, 5 and 6 are
`calc(var(--spacing) * 0.5)` and so on. Pass `breakpoints` (the `--breakpoint-*` values) to check media widths.
ESLint adds JSX style keys for the same kinds, numeric icon `size` props and, with `tailwind` set, Tailwind
arbitrary values such as `p-[13px]`, `rounded-[6px]`, `leading-[1.3]` (`better-tailwindcss/no-restricted-classes`).
The `font` shorthand now needs token weight, line height and family.

Update the vendor copy and pin, then record the existing hand values as legacy in one adoption step: move the
baseline aside, run `pnpm exec energy-dots-check --write-baseline`, and check that every old entry kept its count.
The check prints the legacy count on every run; a new hand value fails.

## Updating to 1.17.5

The JSX select check is on by default. Set `select.component` to the entry point named in diagnostics
and `select.adapters` to the files that render the shared native select. Only those files may use
raw JSX `<select>`. A CSS class on a raw JSX element does not exempt it. Use the
[shared component](../README.md#select) at call sites.

## Updating to 1.17.3

Update the vendor copy and pin. Maps Agent sets `logical: true` for both presets. Other products leave
the default off and run `pnpm exec energy-dots-check --write-baseline` to remove old direction findings.

## Updating from 1.17.1

Update the vendored copy and pin, set `fontSizeTokenNames` to your type scale tokens and size aliases,
and run `pnpm exec energy-dots-check`. Review any newly reported sizes before updating the baseline.

## Updating from 1.17.0

Remove token-definition disables. For documented paint exceptions in regular declarations, rename
`color-no-hex` and `function-disallowed-list` in Stylelint directives to
`energy-dots/color-no-hex` and `energy-dots/function-disallowed-list`.
The check accepts the previous rule IDs in the baseline. Run
`pnpm exec energy-dots-check --write-baseline` to drop obsolete findings and update the remaining IDs.

Stylelint's [hex rule](https://stylelint.io/user-guide/rules/color-no-hex/) and
[function rule](https://stylelint.io/user-guide/rules/function-disallowed-list/) lack a declaration
property filter. The scoped plugins reuse the original checks via
[Stylelint's plugin API](https://stylelint.io/developer-guide/plugins/#stylelintutilscheckagainstrule)
and skip custom property declarations. Use the built-ins directly once they can ignore those declarations.

Run the pnpm 10 clean install fixture with `pnpm --filter @energy-dots/rules test:install`.

## Existing code and exceptions

A greenfield project can omit the baseline. On first adoption, seed it once with
`pnpm exec energy-dots-check --write-baseline` and commit the result. Subsequent writes can only remove
entries or lower counts. Counts are compared per file, tool rule and diagnostic. A new diagnostic in a
different file or with a different message cannot spend existing allowance. The baseline is version-controlled;
review any manual increase as a new adoption decision. The check prints the current legacy count on every run.

List exceptions next to the code with the native directive, rule name and a reason after `--`. For example,
`/* stylelint-disable-next-line property-disallowed-list -- chart coordinates use a fixed LTR axis */`.
The command prints file, line, rules and reason for every directive in the checked source. A directive that
affects the shared rules needs a reason. Changes to data or to a design role require a human choice, so only
direct logical Tailwind replacements use autofix.

The command combines vendor lint results for a single baseline and exception report. ESLint offers
[bulk suppressions](https://eslint.org/docs/latest/use/suppressions); Stylelint's
[options](https://stylelint.io/user-guide/options/) provide directive diagnostics but no equivalent baseline.
Remove the combined baseline code when both engines can use the same diagnostic-count policy natively.
