# AGENTS.md - SuliMarket

Rules for coding agents working in this repo. `CLAUDE.md` imports this file.

## What it is

SuliMarket sorts Ozon results by the number of reviews and Wildberries results by the number of ratings. One source,
`src/core.js`, is built into a Tampermonkey userscript and a Manifest V3 extension. UI and docs are in Russian; code,
comments and commits are in English.

## Build and check

- `npm run build` writes `dist/`: `sulimarket.user.js`, `ssmarket-bridge.user.js`, `extension/`, the store zip. The
  version comes from `package.json`. Icons are rendered from `assets/icon-512.png` with ImageMagick.
- There are no unit tests: the sites change their markup, so every change is checked on live ozon.ru and
  wildberries.ru in a real Chrome with the built extension or the userscript (`test/inject.sh` injects the built
  script into an open tab over CDP). Check: sort, "Как было", a filter change, a category change, the "+N" badge for
  late cards, the button position after reload, the address command `?sulimarket=10` and `#sulimarket-result`.
- Release: bump `package.json`, add a `CHANGELOG.md` entry, build, `gh release create vX.Y.Z` with
  `dist/sulimarket.user.js`, `dist/ssmarket-bridge.user.js` and the zip. Userscripts update from `releases/latest`.

## Rules

- No network requests, no analytics, no remote code: the privacy policy (`PRIVACY.md`) and the store listing promise it.
- Do not touch the site's own nodes beyond what is needed: Ozon gets a sorted copy of the grid, Wildberries cards get
  CSS `order`. Our nodes carry `data-ssm-*` or ids starting with `sulimarket`.
- Texts follow the owner's typography: short dash `-`, straight quotes `"..."`, no em dash, no guillemets.
- Store texts live in `store/chrome-web-store.md`, the sulimko.com page text in `site/sulimko-com-page.md`; keep the
  FAQ wording identical in README, store and site.
