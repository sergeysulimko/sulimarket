// ==UserScript==
// @name         SSMarket
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Сортировка выдачи Ozon и Wildberries по числу отзывов и оценок
// @author       Sulimko
// @match        https://www.ozon.ru/*
// @match        https://www.wildberries.ru/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '2.0.0';
    const SCROLL_PRESETS = [3, 5, 10];
    const MAX_SCROLL_SECONDS = 180;
    const URL_POLL_MS = 500;
    const RESULTS_WAIT_MS = 12000;
    const RESULTS_QUIET_MS = 900;
    // The site may swap the cards before it changes the address; then no change is ever seen, and the
    // listing counts as settled after this long.
    const RESULTS_UNCHANGED_MS = 2500;
    // Pages the site was already fetching when the sort ran are folded into the sort for this long.
    const LATE_CARDS_MS = 4000;
    // Query params the sites rewrite while scrolling; a change in them is not a new listing.
    const PAGING_PARAMS = ['page', 'layout_page_index', 'paginator_token', 'search_page_state', 'start_page_id'];

    // Tampermonkey storage when granted; localStorage when the script is injected by the test harness.
    const store = typeof GM_getValue === 'function'
        ? { get: (key, fallback) => GM_getValue(key, fallback), set: (key, value) => GM_setValue(key, value) }
        : {
            get: (key, fallback) => {
                const raw = localStorage.getItem(`ssmarket:${key}`);
                return raw === null ? fallback : JSON.parse(raw);
            },
            set: (key, value) => localStorage.setItem(`ssmarket:${key}`, JSON.stringify(value))
        };

    function parseCount(text) {
        return parseInt(String(text).replace(/[^\d]/g, ''), 10) || 0;
    }

    function leafTexts(root) {
        const texts = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const text = walker.currentNode.textContent.replace(/\s+/g, ' ').trim();
            if (text) {
                texts.push(text);
            }
        }
        return texts;
    }

    function readRating(texts) {
        const hit = texts.find(text => /^[1-5][.,]\d{1,2}$/.test(text));
        return hit ? parseFloat(hit.replace(',', '.')) : 0;
    }

    // Counts are read from separate text nodes: in the joined text the rating "4.6" glues onto
    // "1 101 отзыв" and reads as 61 101.
    function readCount(card, word) {
        const pattern = new RegExp(`^\\D{0,3}?(\\d[\\d\\s\\u00a0]*)\\s*${word}`, 'i');
        const sources = leafTexts(card);
        card.querySelectorAll('[aria-label]').forEach(node => sources.push(node.getAttribute('aria-label')));
        return sources.reduce((best, text) => {
            const match = text.match(pattern);
            return match ? Math.max(best, parseCount(match[1])) : best;
        }, 0);
    }

    function compareItems(a, b) {
        if (!a.count !== !b.count) {
            return a.count ? -1 : 1;
        }
        return (b.count - a.count) || (b.rating - a.rating) || (a.seen - b.seen);
    }

    function listingKey() {
        const params = new URLSearchParams(location.search);
        PAGING_PARAMS.forEach(name => params.delete(name));
        params.sort();
        return `${location.pathname}?${params}`;
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function formatNumber(value) {
        return value.toLocaleString('ru-RU');
    }

    function goodsWord(count) {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) {
            return 'товар';
        }
        return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'товара' : 'товаров';
    }

    // ---------------------------------------------------------------- Ozon
    // The search page is a virtual paginator: pages far from the viewport are unmounted, so cards are
    // snapshotted while visible and the sorted list is drawn from snapshots in a root of our own.
    function createOzon() {
        const PAGINATOR = '[data-widget="infiniteVirtualPaginator"]';
        const TILE_GRID = '[data-widget="tileGridDesktop"]';
        const PRODUCT_LINK = 'a[href*="/product/"]';
        const REVIEWS = 'отзыв';
        const ROOT_ID = 'ssmarket-ozon-sorted';

        const cache = new Map();
        const layout = { gridClass: '', tileClass: '' };
        let hiddenPaginator = null;

        function paginator() {
            return document.querySelector(PAGINATOR);
        }

        // Result pages are grids with nothing but tiles; "Вы смотрели" and other shelves carry a heading
        // and a flex row, and must stay out of the sort.
        function resultGrids() {
            const root = paginator();
            if (!root) {
                return [];
            }
            return Array.from(root.querySelectorAll(TILE_GRID)).filter(grid => (
                grid.children.length === 1 && getComputedStyle(grid.firstElementChild).display === 'grid'
            ));
        }

        function tilesOf(grid) {
            return Array.from(grid.firstElementChild.children).filter(tile => tile.querySelector(PRODUCT_LINK));
        }

        function keyOf(tile) {
            const href = tile.querySelector(PRODUCT_LINK).getAttribute('href');
            const match = href.match(/\/product\/[^/?]*?(\d+)\/?(?:[?#]|$)/);
            return match ? match[1] : href.split('?')[0];
        }

        function rememberLayout(grids) {
            const classCounts = new Map();
            grids.forEach(grid => tilesOf(grid).forEach(tile => {
                classCounts.set(tile.className, (classCounts.get(tile.className) || 0) + 1);
            }));
            if (classCounts.size) {
                layout.gridClass = grids[0].firstElementChild.className;
                layout.tileClass = [...classCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            }
        }

        function capture() {
            const grids = resultGrids();
            rememberLayout(grids);
            grids.forEach(grid => tilesOf(grid).forEach(tile => {
                const key = keyOf(tile);
                const known = cache.get(key);
                // Re-snapshot only when the card changed (images loaded, heart toggled, price updated).
                const look = `${tile.textContent.length}|${Array.from(tile.querySelectorAll('img'), img => img.currentSrc).join()}|${tile.innerHTML.length}`;
                if (known && known.look === look) {
                    return;
                }
                cache.set(key, {
                    key,
                    look,
                    count: Math.max(known?.count || 0, readCount(tile, REVIEWS)),
                    rating: readRating(leafTexts(tile)) || known?.rating || 0,
                    seen: known ? known.seen : cache.size,
                    snapshot: tile.cloneNode(true)
                });
            }));
        }

        function findLiveTile(key) {
            for (const grid of resultGrids()) {
                const tile = tilesOf(grid).find(candidate => keyOf(candidate) === key);
                if (tile) {
                    return tile;
                }
            }
            return null;
        }

        function nodePath(root, node) {
            const path = [];
            for (let current = node; current && current !== root; current = current.parentElement) {
                path.unshift(Array.prototype.indexOf.call(current.parentElement.children, current));
            }
            return path;
        }

        function nodeAt(root, path) {
            return path.reduce((node, index) => node && node.children[index], root);
        }

        // Buttons inside a snapshot (favourite, cart) are dead copies: replay the click on the live card.
        function proxyClick(event) {
            const control = event.target.closest('button, [role="button"]');
            const tile = event.target.closest('[data-ssm-key]');
            if (!control || !tile) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const key = tile.dataset.ssmKey;
            const live = findLiveTile(key);
            const target = live && nodeAt(live, nodePath(tile, control));
            // The live card may have changed shape since the snapshot (cart button became a -/+ stepper).
            const same = target && target.tagName === control.tagName
                && target.getAttribute('aria-label') === control.getAttribute('aria-label')
                && target.textContent.trim() === control.textContent.trim();
            if (!same) {
                ui.toast(live ? 'Карточка изменилась - нажмите ещё раз' : 'Сайт выгрузил эту карточку - откройте товар');
                if (live) {
                    syncTile(tile, live, key);
                }
                return;
            }
            target.click();
            // Follow the live card for a few seconds: the site answers at network speed.
            const observer = new MutationObserver(() => syncTile(tile.isConnected ? tile : null, live, key));
            observer.observe(live, { childList: true, subtree: true, attributes: true, characterData: true });
            setTimeout(() => observer.disconnect(), 3000);
        }

        function syncTile(tile, live, key) {
            const current = tile && tile.isConnected ? tile : document.querySelector(`#${ROOT_ID} [data-ssm-key="${key}"]`);
            if (!current) {
                return;
            }
            const fresh = live.cloneNode(true);
            prepareTile(fresh, key);
            current.replaceWith(fresh);
            const known = cache.get(key);
            if (known) {
                known.snapshot = live.cloneNode(true);
            }
        }

        function prepareTile(tile, key) {
            tile.className = layout.tileClass;
            tile.removeAttribute('style');
            tile.dataset.ssmKey = key;
        }

        function render(items) {
            const native = paginator();
            removeRoot();
            const root = document.createElement('div');
            root.id = ROOT_ID;
            root.style.width = '100%';
            const grid = document.createElement('div');
            grid.className = layout.gridClass;
            items.forEach(item => {
                const tile = item.snapshot.cloneNode(true);
                prepareTile(tile, item.key);
                grid.appendChild(tile);
            });
            root.appendChild(grid);
            root.addEventListener('click', proxyClick, true);
            native.parentElement.insertBefore(root, native);
            hiddenPaginator = native;
            native.style.display = 'none';
            return root;
        }

        function removeRoot() {
            document.getElementById(ROOT_ID)?.remove();
        }

        return {
            id: 'ozon',
            name: 'Ozon',
            countWord: 'отзывам',
            accent: '#005bff',
            accentSoft: '#e6efff',
            isListing: () => Boolean(paginator()) && resultGrids().length > 0,
            isSorted: () => Boolean(document.getElementById(ROOT_ID)),
            capture,
            visibleCount: () => cache.size,
            unsortedCount() {
                const root = document.getElementById(ROOT_ID);
                return root ? cache.size - root.firstElementChild.children.length : 0;
            },
            reset() {
                this.restore();
                cache.clear();
            },
            sort() {
                capture();
                const items = [...cache.values()].sort(compareItems);
                if (!items.length || !paginator()) {
                    return null;
                }
                const root = render(items);
                return { count: items.length, top: items[0].count, anchor: root };
            },
            restore() {
                removeRoot();
                if (hiddenPaginator) {
                    hiddenPaginator.style.display = '';
                    hiddenPaginator = null;
                }
            },
            keySignature: () => resultGrids().flatMap(grid => tilesOf(grid).map(keyOf)).join(','),
            isOwnNode: node => Boolean(node.closest?.(`#${ROOT_ID}`)) || node.id === ROOT_ID,
            // Ozon may re-render the column under the sorted list: drop a sorted list that lost its place.
            heal() {
                if (!hiddenPaginator) {
                    return false;
                }
                const root = document.getElementById(ROOT_ID);
                if (root && hiddenPaginator.isConnected && paginator() === hiddenPaginator) {
                    return false;
                }
                this.restore();
                return true;
            }
        };
    }

    // ---------------------------------------------------------- Wildberries
    // The catalog keeps every loaded card in one CSS grid, so the live cards are reordered with
    // `order` and the React tree is never touched.
    function createWildberries() {
        const LIST = '.product-card-list';
        const PRODUCT_LINK = 'a[href*="/detail.aspx"]';
        const RATINGS = 'оцен';
        const SORTED_ATTR = 'ssmSorted';
        const TAIL_ORDER = 100000;

        const seen = new Map();

        function list() {
            return document.querySelector(LIST);
        }

        function productId(link) {
            const href = link.getAttribute('href');
            const match = href.match(/\/catalog\/(\d+)\//);
            return match ? match[1] : href.split('?')[0];
        }

        // A product card links to one product; promo carousels inside the list link to many.
        function isCard(node) {
            const ids = new Set(Array.from(node.querySelectorAll(PRODUCT_LINK), productId));
            return ids.size === 1;
        }

        function cards() {
            const root = list();
            return root ? Array.from(root.children).filter(isCard) : [];
        }

        function keyOf(card) {
            return productId(card.querySelector(PRODUCT_LINK));
        }

        function capture() {
            cards().forEach(card => {
                const key = keyOf(card);
                if (!seen.has(key)) {
                    seen.set(key, seen.size);
                }
            });
        }

        // Cards loaded after the sort land after the sorted block, shelves and banners go last.
        function placeTail() {
            const root = list();
            if (!root || !root.dataset[SORTED_ATTR]) {
                return;
            }
            Array.from(root.children).forEach(child => {
                if (!child.style.order) {
                    child.style.order = String(isCard(child) ? TAIL_ORDER : TAIL_ORDER * 2);
                }
            });
        }

        return {
            id: 'wb',
            name: 'WB',
            countWord: 'оценкам',
            accent: '#a01ad9',
            accentSoft: '#f5e8fc',
            isListing: () => cards().length > 0,
            isSorted: () => Boolean(list()?.dataset[SORTED_ATTR]),
            capture() {
                capture();
                placeTail();
            },
            visibleCount: () => cards().length,
            unsortedCount: () => cards().filter(card => card.style.order === String(TAIL_ORDER)).length,
            reset() {
                this.restore();
                seen.clear();
            },
            sort() {
                capture();
                const root = list();
                const items = cards().map(card => ({
                    card,
                    count: readCount(card, RATINGS),
                    rating: readRating(leafTexts(card)),
                    seen: seen.get(keyOf(card))
                })).sort(compareItems);
                if (!items.length) {
                    return null;
                }
                Array.from(root.children).forEach(child => {
                    child.style.order = '';
                });
                items.forEach((item, index) => {
                    item.card.style.order = String(index + 1);
                });
                root.dataset[SORTED_ATTR] = '1';
                placeTail();
                return { count: items.length, top: items[0].count, anchor: root };
            },
            restore() {
                const root = list();
                if (!root) {
                    return;
                }
                Array.from(root.children).forEach(child => {
                    child.style.order = '';
                });
                delete root.dataset[SORTED_ATTR];
            },
            keySignature: () => cards().map(keyOf).join(','),
            isOwnNode: () => false,
            heal: () => false
        };
    }

    const site = location.hostname.endsWith('ozon.ru') ? createOzon()
        : location.hostname.endsWith('wildberries.ru') ? createWildberries()
            : null;
    if (!site) {
        return;
    }

    // ------------------------------------------------------------------ UI
    const ICON_SORT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h8M4 18h5"/><path d="M18 5v14M15 16l3 3 3-3"/></svg>';
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
    const ICON_UNDO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>';
    const ICON_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const ICON_INFO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 11v6M12 7.5v.01"/></svg>';
    const FAB_SIZE = 44;
    const EDGE_GAP = 12;
    const PANEL_WIDTH = 300;
    const DEFAULT_OFFSET = { right: 24, bottom: 68 };

    // Look: board design/boards/widget/2026-10-19/approved/01-pristine-popover.png.
    const STYLE = `
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; }
        button { font: inherit; }
        .fab {
            position: fixed; width: ${FAB_SIZE}px; height: ${FAB_SIZE}px; border-radius: 50%;
            border: none; padding: 0; cursor: grab; touch-action: none;
            display: grid; place-items: center; color: #fff; background: var(--accent);
            box-shadow: 0 6px 18px rgba(0, 0, 0, .18); transition: transform .15s ease, box-shadow .15s ease;
        }
        .fab:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(0, 0, 0, .22); }
        .fab:focus-visible { outline: 3px solid var(--accent-soft); outline-offset: 2px; }
        .fab.dragging { cursor: grabbing; transform: scale(1.06); transition: none; }
        .fab .badge {
            position: absolute; top: -5px; right: -5px; min-width: 22px; height: 22px; padding: 0 6px;
            border-radius: 11px; background: #fff; color: var(--accent); font-size: 11px; font-weight: 700;
            display: none; place-items: center; box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
        }
        .fab.sorted .badge, .fab.busy .badge { display: grid; }
        .fab svg.ring { position: absolute; inset: -5px; width: ${FAB_SIZE + 10}px; height: ${FAB_SIZE + 10}px; transform: rotate(-90deg); display: none; }
        .fab.busy svg.ring { display: block; }
        .ring circle { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; opacity: .25; }
        .ring circle.progress { opacity: 1; transition: stroke-dashoffset .28s linear; }
        .panel {
            position: fixed; width: ${PANEL_WIDTH}px; padding: 16px; border-radius: 18px; background: #fff; color: #1b1d21;
            box-shadow: 0 18px 48px rgba(16, 24, 40, .16), 0 0 0 1px rgba(16, 24, 40, .06);
            display: none; flex-direction: column; gap: 14px; font-size: 13px; overflow-y: auto;
        }
        .panel.open { display: flex; }
        .panel > * { flex-shrink: 0; }
        .caret { position: fixed; width: 12px; height: 12px; background: #fff; transform: rotate(45deg); display: none; }
        .caret.open { display: block; }
        .caret.above { box-shadow: 1px 1px 0 rgba(16, 24, 40, .06); }
        .caret.below { box-shadow: -1px -1px 0 rgba(16, 24, 40, .06); }
        .head { display: flex; align-items: center; gap: 8px; }
        .title { font-weight: 800; font-size: 16px; letter-spacing: -.01em; }
        .chip { padding: 3px 9px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; }
        .ver { color: #9aa0a8; font-size: 12px; margin-left: auto; }
        .icon-btn { border: none; background: transparent; color: #5f6670; cursor: pointer; padding: 3px; border-radius: 8px; display: grid; }
        .icon-btn:hover { color: #1b1d21; background: #f2f3f5; }
        .status { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: #f5f6f8; line-height: 1.4; color: #1b1d21; }
        .status-icon { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: #c4c8ce; margin-top: 1px; }
        .status.sorted .status-icon { background: var(--accent); }
        .status.busy .status-icon { background: none; border: 3px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
        .status.busy .status-icon svg { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .status-text b { font-weight: 700; }
        .primary {
            border: none; border-radius: 12px; height: 44px; padding: 0 14px; background: var(--accent); color: #fff;
            font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .primary:hover { filter: brightness(1.07); }
        .label { color: #3a3f47; font-size: 13px; margin-bottom: 8px; }
        .row { display: flex; gap: 8px; align-items: center; }
        .seg { flex: 1; display: flex; height: 40px; padding: 3px; gap: 2px; border: 1px solid #e3e5e8; border-radius: 12px; background: #fff; }
        .preset, .custom {
            flex: 1; border: none; border-radius: 9px; background: transparent; color: #1b1d21;
            font-size: 13px; font-weight: 600; cursor: pointer; min-width: 0;
        }
        .preset:hover { background: #f2f3f5; }
        .preset.active { background: var(--accent); color: #fff; }
        .custom { display: flex; align-items: center; justify-content: center; cursor: text; }
        .custom input { width: 100%; border: none; background: transparent; font: inherit; font-weight: 600; text-align: center; outline: none; color: inherit; -moz-appearance: textfield; }
        .custom input::-webkit-outer-spin-button, .custom input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .custom input::placeholder { color: #5f6670; }
        .custom:focus-within { box-shadow: inset 0 0 0 1.5px var(--accent); }
        .play { flex: none; width: 40px; height: 40px; border-radius: 50%; border: none; background: var(--accent-soft); color: var(--accent); cursor: pointer; display: grid; place-items: center; }
        .play:hover { background: var(--accent); color: #fff; }
        .secondary {
            border: 1px solid #e3e5e8; border-radius: 12px; height: 44px; padding: 0 14px; background: #fff; color: #1b1d21;
            font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .secondary:hover:not(:disabled) { background: #f7f8fa; }
        .secondary:disabled { color: #b7bcc3; cursor: default; }
        .toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; color: #1b1d21; line-height: 1.3; }
        .toggle input { display: none; }
        .switch { width: 38px; height: 22px; border-radius: 11px; background: #d5d8dd; position: relative; flex: none; transition: background .15s; }
        .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
        .toggle input:checked + .switch { background: var(--accent); }
        .toggle input:checked + .switch::after { transform: translateX(16px); }
        .busy-only { display: none; }
        .panel.busy .busy-only { display: flex; }
        .panel.busy .idle-only { display: none; }
        .toast {
            position: fixed; padding: 9px 14px; border-radius: 10px; background: #1b1d21; color: #fff; font-size: 13px;
            opacity: 0; pointer-events: none; transition: opacity .2s; max-width: ${PANEL_WIDTH}px;
        }
        .toast.show { opacity: .95; }
    `;

    function createUi() {
        const host = document.createElement('div');
        host.id = 'ssmarket-ui';
        host.style.cssText = 'position: fixed; z-index: 2147483000; top: 0; left: 0; width: 0; height: 0;';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>${STYLE}</style>
            <button class="fab" type="button" aria-label="SSMarket: сортировка" aria-expanded="false" title="SSMarket - сортировка по ${site.countWord}. Кнопку можно перетащить">
                ${ICON_SORT}
                <svg class="ring" viewBox="0 0 54 54"><circle cx="27" cy="27" r="25"/><circle class="progress" cx="27" cy="27" r="25"/></svg>
                <span class="badge"></span>
            </button>
            <div class="panel" role="dialog" aria-label="SSMarket">
                <div class="head">
                    <span class="title">SSMarket</span><span class="chip">${site.name}</span>
                    <span class="ver">v${VERSION}</span>
                    <button class="icon-btn close" type="button" aria-label="Закрыть">${ICON_CLOSE}</button>
                </div>
                <div class="status" role="status"><span class="status-icon"></span><span class="status-text"></span></div>
                <button class="primary idle-only sort" type="button">${ICON_SORT}<span>Сортировать по ${site.countWord}</span></button>
                <button class="primary busy-only stop" type="button">Хватит, сортировать</button>
                <div class="idle-only">
                    <div class="label">Подгрузить ещё и отсортировать</div>
                    <div class="row">
                        <div class="seg">
                            ${SCROLL_PRESETS.map(seconds => `<button class="preset" type="button" data-seconds="${seconds}">${seconds} с</button>`).join('')}
                            <label class="custom" title="Своё число секунд, Enter - старт">
                                <input type="number" min="1" max="${MAX_SCROLL_SECONDS}" placeholder="N с" aria-label="Секунд листать">
                            </label>
                        </div>
                        <button class="play" type="button" aria-label="Листать своё число секунд и сортировать">${ICON_PLAY}</button>
                    </div>
                </div>
                <button class="secondary undo idle-only" type="button">${ICON_UNDO}<span>Как было</span></button>
                <label class="toggle idle-only"><input type="checkbox" class="keep"><span class="switch"></span><span>Держать сортировку при смене фильтров</span></label>
            </div>
            <div class="caret"></div>
            <div class="toast" role="status"></div>
        `;
        host.style.setProperty('--accent', site.accent);
        host.style.setProperty('--accent-soft', site.accentSoft);
        document.body.appendChild(host);

        const $ = selector => shadow.querySelector(selector);
        const fab = $('.fab');
        const panel = $('.panel');
        const status = $('.status');
        const statusIcon = $('.status-icon');
        const statusText = $('.status-text');
        const badge = $('.badge');
        const toastNode = $('.toast');
        const caret = $('.caret');
        const customInput = $('.custom input');
        const keepInput = $('.keep');
        const progress = $('.ring .progress');
        const ringLength = 2 * Math.PI * 25;
        progress.style.strokeDasharray = String(ringLength);

        const positionKey = `position:${site.id}`;
        // Until the button is dragged it sits above the sites' own "to top" button in the bottom-right corner.
        let position = store.get(positionKey, null);
        let toastTimer = 0;

        function fabBox() {
            const maxX = document.documentElement.clientWidth - FAB_SIZE - EDGE_GAP * 2;
            const maxY = window.innerHeight - FAB_SIZE - EDGE_GAP * 2;
            if (!position) {
                return { x: EDGE_GAP + maxX - DEFAULT_OFFSET.right, y: EDGE_GAP + maxY - DEFAULT_OFFSET.bottom };
            }
            return { x: EDGE_GAP + position.fx * maxX, y: EDGE_GAP + position.fy * maxY };
        }

        function onRightHalf() {
            return fabBox().x + FAB_SIZE / 2 > document.documentElement.clientWidth / 2;
        }

        function placeFab() {
            const { x, y } = fabBox();
            fab.style.left = `${x}px`;
            fab.style.top = `${y}px`;
            placePanel();
        }

        // The panel opens towards the larger free side of the screen, wherever the button sits.
        function placePanel() {
            const { x, y } = fabBox();
            const wanted = onRightHalf() ? x + FAB_SIZE - PANEL_WIDTH : x;
            const left = Math.max(EDGE_GAP, Math.min(wanted, document.documentElement.clientWidth - PANEL_WIDTH - EDGE_GAP));
            panel.style.left = `${left}px`;
            // Open towards the larger measured space; a short screen scrolls the panel instead of cutting it.
            const spaceAbove = y - 10 - EDGE_GAP;
            const spaceBelow = window.innerHeight - (y + FAB_SIZE + 10) - EDGE_GAP;
            const above = spaceAbove >= spaceBelow;
            caret.classList.toggle('above', above);
            caret.classList.toggle('below', !above);
            caret.style.left = `${x + FAB_SIZE / 2 - 6}px`;
            caret.style.top = `${above ? y - 16 : y + FAB_SIZE + 4}px`;
            panel.style.maxHeight = `${Math.max(spaceAbove, spaceBelow)}px`;
            if (above) {
                panel.style.top = '';
                panel.style.bottom = `${window.innerHeight - y + 10}px`;
            } else {
                panel.style.bottom = '';
                panel.style.top = `${y + FAB_SIZE + 10}px`;
            }
            // The toast goes to the far edge of the open panel, or next to the button when it is closed.
            toastNode.style.left = `${left}px`;
            const open = panel.classList.contains('open');
            const panelHeight = open ? panel.offsetHeight : 0;
            const toastTop = above ? y - 10 - panelHeight - 48 : y + FAB_SIZE + 10 + panelHeight + 8;
            toastNode.style.top = `${Math.max(EDGE_GAP, Math.min(toastTop, window.innerHeight - 48))}px`;
        }

        function setOpen(open) {
            panel.classList.toggle('open', open);
            caret.classList.toggle('open', open);
            fab.setAttribute('aria-expanded', String(open));
            if (open) {
                placePanel();
                actions.refresh();
            }
        }

        let drag = null;
        fab.addEventListener('pointerdown', event => {
            if (event.button !== 0) {
                return;
            }
            drag = { startX: event.clientX, startY: event.clientY, origin: fabBox(), moved: false };
            fab.setPointerCapture(event.pointerId);
        });
        const endDrag = () => {
            drag = null;
            fab.classList.remove('dragging');
        };
        fab.addEventListener('pointercancel', endDrag);
        fab.addEventListener('lostpointercapture', () => {
            if (drag?.moved) {
                store.set(positionKey, position);
            }
            endDrag();
        });
        fab.addEventListener('pointermove', event => {
            if (!drag || !event.buttons) {
                return;
            }
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (!drag.moved && Math.hypot(dx, dy) < 5) {
                return;
            }
            drag.moved = true;
            fab.classList.add('dragging');
            const maxX = document.documentElement.clientWidth - FAB_SIZE - EDGE_GAP * 2;
            const maxY = window.innerHeight - FAB_SIZE - EDGE_GAP * 2;
            position = {
                fx: Math.min(1, Math.max(0, (drag.origin.x + dx - EDGE_GAP) / maxX)),
                fy: Math.min(1, Math.max(0, (drag.origin.y + dy - EDGE_GAP) / maxY))
            };
            placeFab();
        });
        fab.addEventListener('pointerup', event => {
            if (!drag || event.button !== 0) {
                return;
            }
            const wasDrag = drag.moved;
            endDrag();
            if (wasDrag) {
                store.set(positionKey, position);
                return;
            }
            setOpen(!panel.classList.contains('open'));
        });
        fab.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setOpen(!panel.classList.contains('open'));
            }
        });

        $('.close').addEventListener('click', () => setOpen(false));
        $('.sort').addEventListener('click', () => actions.sort());
        $('.stop').addEventListener('click', () => actions.stopScroll());
        $('.undo').addEventListener('click', () => actions.restore());
        const presets = shadow.querySelectorAll('.preset');
        const markPreset = seconds => presets.forEach(button => {
            button.classList.toggle('active', Number(button.dataset.seconds) === seconds);
        });
        markPreset(store.get('lastSeconds', 0));
        presets.forEach(button => {
            button.addEventListener('click', () => {
                const seconds = Number(button.dataset.seconds);
                store.set('lastSeconds', seconds);
                markPreset(seconds);
                actions.scrollAndSort(seconds);
            });
        });
        const startCustom = () => {
            const seconds = Number(customInput.value);
            if (!(seconds > 0)) {
                customInput.focus();
                return;
            }
            store.set('customSeconds', seconds);
            markPreset(0);
            actions.scrollAndSort(Math.min(seconds, MAX_SCROLL_SECONDS));
        };
        customInput.value = store.get('customSeconds', '') || '';
        customInput.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                startCustom();
            }
        });
        $('.play').addEventListener('click', startCustom);
        keepInput.checked = store.get('keepSorted', true);
        keepInput.addEventListener('change', () => store.set('keepSorted', keepInput.checked));

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        });
        document.addEventListener('pointerdown', event => {
            if (!event.composedPath().includes(host)) {
                setOpen(false);
            }
        });
        window.addEventListener('resize', placeFab, { passive: true });
        placeFab();

        return {
            setVisible(visible) {
                host.style.display = visible ? '' : 'none';
                if (!visible) {
                    setOpen(false);
                }
            },
            setStatus(html, kind = 'idle') {
                statusText.innerHTML = html;
                status.className = `status ${kind}`;
                statusIcon.innerHTML = kind === 'sorted' ? ICON_CHECK : ICON_INFO;
            },
            setSorted(count) {
                fab.classList.toggle('sorted', Boolean(count));
                badge.textContent = count ? String(count) : '';
                $('.undo').disabled = !count;
            },
            setBusy(remainingMs, totalMs) {
                const busy = remainingMs !== null;
                fab.classList.toggle('busy', busy);
                panel.classList.toggle('busy', busy);
                if (busy) {
                    badge.textContent = String(Math.ceil(remainingMs / 1000));
                    progress.style.strokeDashoffset = String(ringLength * (remainingMs / totalMs));
                }
            },
            keepSorted: () => keepInput.checked,
            toast(text) {
                toastNode.textContent = text;
                placePanel();
                toastNode.classList.add('show');
                clearTimeout(toastTimer);
                toastTimer = setTimeout(() => toastNode.classList.remove('show'), 2600);
            }
        };
    }

    // ------------------------------------------------------------- actions
    let scrollRun = null;
    let lastResult = null;
    let lastSortAt = 0;
    // Bumped by every listing change and every user action, so an older wait for results gives up.
    let listingGen = 0;
    // Set while the site replaces the listing; a scroll started meanwhile waits for it.
    let listingWait = null;
    let currentListing = listingKey();
    let lastKeySignature = '';

    // Listings sorted in this tab: coming back to one (product page, then Back) sorts it again.
    const sortedListings = {
        read: () => new Set(JSON.parse(sessionStorage.getItem('ssmarket:sorted') || '[]')),
        add(key) {
            sessionStorage.setItem('ssmarket:sorted', JSON.stringify([...this.read().add(key)]));
        },
        remove(key) {
            const keys = this.read();
            keys.delete(key);
            sessionStorage.setItem('ssmarket:sorted', JSON.stringify([...keys]));
        },
        has: key => sortedListings.read().has(key)
    };

    const actions = {
        refresh() {
            if (scrollRun) {
                return;
            }
            if (site.isSorted() && lastResult) {
                const fresh = site.unsortedCount();
                const freshNote = fresh > 0
                    ? ` Подгружено ещё <b>${formatNumber(fresh)}</b> - нажмите "Сортировать", чтобы добавить.`
                    : '';
                ui.setStatus(`Отсортировано <b>${formatNumber(lastResult.count)}</b> ${goodsWord(lastResult.count)} по ${site.countWord}. Больше всего - <b>${formatNumber(lastResult.top)}</b>.${freshNote}`, 'sorted');
            } else {
                site.capture();
                ui.setStatus(`Загружено <b>${formatNumber(site.visibleCount())}</b> ${goodsWord(site.visibleCount())}. Порядок сайта.`);
            }
            ui.setSorted(site.isSorted() && lastResult ? lastResult.count : 0);
        },

        // `auto` - started by the script, not a click; `late` - folding in cards that were already on their way,
        // which must not extend the folding window.
        sort({ scroll = true, auto = false, late = false } = {}) {
            if (!auto) {
                listingGen += 1;
            }
            const result = site.sort();
            if (!result) {
                if (!auto) {
                    ui.toast('Карточки не найдены - это не страница выдачи');
                }
                return;
            }
            lastResult = result;
            if (!late) {
                lastSortAt = Date.now();
            }
            sortedListings.add(currentListing);
            actions.refresh();
            if (scroll) {
                const top = result.anchor.getBoundingClientRect().top + window.scrollY - 140;
                window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            }
        },

        restore() {
            listingGen += 1;
            const anchorTop = lastResult?.anchor.isConnected
                ? lastResult.anchor.getBoundingClientRect().top + window.scrollY - 140
                : null;
            site.restore();
            sortedListings.remove(currentListing);
            lastResult = null;
            actions.refresh();
            if (anchorTop !== null) {
                window.scrollTo({ top: Math.max(0, anchorTop), behavior: 'smooth' });
            }
        },

        async scrollAndSort(seconds) {
            if (scrollRun) {
                return;
            }
            const run = { stop: false, cancelled: false };
            scrollRun = run;
            if (listingWait) {
                ui.setStatus('Жду, пока сайт обновит выдачу...', 'busy');
                await listingWait;
            }
            listingGen += 1;
            site.restore();
            lastResult = null;
            const totalMs = seconds * 1000;
            const startedAt = Date.now();
            ui.setSorted(0);
            while (!run.stop && Date.now() - startedAt < totalMs) {
                // At the bottom a scroll does not move and fires no event, so the site never asks for the next
                // page: step back to make the following step a real scroll.
                const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
                window.scrollBy(0, atBottom ? -window.innerHeight : Math.max(400, window.innerHeight * 0.8));
                site.capture();
                const remaining = Math.max(0, totalMs - (Date.now() - startedAt));
                ui.setBusy(remaining, totalMs);
                ui.setStatus(`Листаю выдачу, ещё <b>${Math.ceil(remaining / 1000)} с</b>. Загружено <b>${formatNumber(site.visibleCount())}</b>.`, 'busy');
                await wait(280);
            }
            scrollRun = null;
            ui.setBusy(null);
            if (run.cancelled) {
                actions.refresh();
                return;
            }
            site.capture();
            actions.sort();
        },

        stopScroll() {
            if (scrollRun) {
                scrollRun.stop = true;
            }
        },

        cancelScroll() {
            if (scrollRun) {
                scrollRun.stop = true;
                scrollRun.cancelled = true;
            }
        },

        // A new listing (filter, sort, query, Back) replaces the cards. The old ones stay on screen until the
        // site draws the new ones, so cards are collected afresh only once the result order changed and settled.
        onListingChange(previousSignature) {
            const wait = actions.settleListing(previousSignature);
            listingWait = wait;
            wait.finally(() => {
                if (listingWait === wait) {
                    listingWait = null;
                }
            });
        },

        async settleListing(previousSignature) {
            const gen = ++listingGen;
            const wasSorted = site.isSorted() || Boolean(scrollRun) || sortedListings.has(currentListing);
            actions.cancelScroll();
            site.restore();
            lastResult = null;
            ui.setSorted(0);
            ui.setStatus('Сайт обновляет выдачу...', 'busy');
            const startedAt = Date.now();
            const deadline = startedAt + RESULTS_WAIT_MS;
            let signature = previousSignature;
            let stableSince = Date.now();
            let changed = false;
            while (Date.now() < deadline) {
                await wait(250);
                if (gen !== listingGen) {
                    return;
                }
                const next = site.keySignature();
                if (next !== signature) {
                    signature = next;
                    stableSince = Date.now();
                    changed = changed || (next !== '' && next !== previousSignature);
                } else if ((changed || Date.now() - startedAt >= RESULTS_UNCHANGED_MS)
                    && next !== '' && Date.now() - stableSince >= RESULTS_QUIET_MS) {
                    break;
                }
            }
            if (gen !== listingGen) {
                return;
            }
            site.reset();
            site.capture();
            if (scrollRun) {
                return;
            }
            if (wasSorted && ui.keepSorted() && site.visibleCount() > 0) {
                actions.sort({ scroll: false, auto: true });
            } else {
                actions.refresh();
            }
        }
    };

    const ui = createUi();

    let captureTimer = 0;
    new MutationObserver(records => {
        if (captureTimer || scrollRun || records.every(record => site.isOwnNode(record.target))) {
            return;
        }
        captureTimer = setTimeout(() => {
            captureTimer = 0;
            site.capture();
            if (!site.isSorted() || !site.unsortedCount()) {
                return;
            }
            if (Date.now() - lastSortAt < LATE_CARDS_MS) {
                actions.sort({ scroll: false, auto: true, late: true });
            } else {
                actions.refresh();
            }
        }, 300);
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        if (site.heal()) {
            lastResult = null;
            actions.refresh();
        }
        ui.setVisible(site.isListing() || site.isSorted() || Boolean(scrollRun));
        const next = listingKey();
        if (next !== currentListing) {
            currentListing = next;
            actions.onListingChange(lastKeySignature);
        }
        lastKeySignature = site.keySignature();
    }, URL_POLL_MS);

    ui.setVisible(site.isListing());
    site.capture();
    actions.refresh();
    if (ui.keepSorted() && sortedListings.has(currentListing)) {
        actions.onListingChange('');
    }
})();
