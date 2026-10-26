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
  late cards, the button position after reload, the address command `?sulimarket=10` and `#sulimarket-result`, a plain scroll after the sort on Ozon (the site loads
  more, "Ещё N товаров без сортировки" shows at the bottom), the Ozon sellers window ("Есть дешевле": shop lines,
  "По отзывам"), WB shop lines on result cards, under the seller on a product page and on "Предложения продавцов"
  (`/catalog/<id>/other-sellers`, "По отзывам").
- Release: bump `package.json`, add a `CHANGELOG.md` entry, `node build.mjs` (it stamps the version into README and
  the site page and fails without a CHANGELOG entry; `scripts/merge-gate.sh` stops /main if the stamp is not
  committed), /main, then `gh release create vX.Y.Z` from main with `dist/sulimarket.user.js`,
  `dist/ssmarket-bridge.user.js` and the zip. Userscripts update from `releases/latest`.
- Chrome store after a release: the API uploads the new zip and submits it (key and calls - `STORES.md` in
  sulimko-com, `docs/products/sulimarket/`); a review in progress is cancelled first. Description and screenshots
  change only in the developer console: keep them equal to `store/chrome-web-store.md` and `store/screenshots/`.

## Rules

- No network requests to us or third parties, no analytics, no remote code: the privacy policy (`PRIVACY.md`) and the
  store listing promise it. Allowed are the sites' own seller facts: Ozon `/modal/shop-in-shop-info` and
  `/modal/otherOffersFromSellers` through `entrypoint-api.bx`; Wildberries `card.json` on the picture server,
  `suppliers-shipment-2.wildberries.ru/api/v1/suppliers/find_by_ids`, `static-basket-01.wbbasket.ru/vol0/data/supplier-by-id/`.
  All go through one queue, at most ~8 a second, and are kept in `sessionStorage`. Any new request changes
  `PRIVACY.md` first. WB's `/__internal/*` APIs answer 403/498 to a replayed request - do not use them.
- Do not touch the site's own nodes beyond what is needed: Ozon gets a sorted copy of the grid, Wildberries cards get
  CSS `order`. Our nodes carry `data-ssm-*` or ids starting with `sulimarket`.
- Texts follow the owner's typography: short dash `-`, straight quotes `"..."`, no em dash, no guillemets.
- Store texts live in `store/chrome-web-store.md`, the sulimko.com page text in `site/sulimko-com-page.md`; keep the
  FAQ wording identical in README, store and site.
- This repo is public. The owner's product journal (his words about the product), the internal roadmap and the design
  boards live in the private product home `sulimko-com/docs/products/sulimarket/`, never here. Before a push the
  global `public-repo-guard` hook checks secrets and private marks; do not pass it with `--no-verify` unread.
