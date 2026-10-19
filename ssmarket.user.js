// ==UserScript==
// @name         SSMarket
// @namespace    https://github.com/sergeysulimko/ssmarket
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
                cache.set(key, {
                    key,
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
            const live = findLiveTile(tile.dataset.ssmKey);
            const target = live && nodeAt(live, nodePath(tile, control));
            if (!target) {
                ui.toast('Сайт выгрузил эту карточку - откройте товар');
                return;
            }
            target.click();
            setTimeout(() => {
                const fresh = live.cloneNode(true);
                prepareTile(fresh, tile.dataset.ssmKey);
                tile.replaceWith(fresh);
                cache.get(tile.dataset.ssmKey).snapshot = live.cloneNode(true);
            }, 600);
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
            reset() {
                this.restore();
                cache.clear();
            },
            sort() {
                capture();
                const items = [...cache.values()].sort(compareItems);
                if (!items.length) {
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
            keySet: () => new Set(resultGrids().flatMap(grid => tilesOf(grid).map(keyOf))),
            observeRoot: () => document.body
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
            keySet: () => new Set(cards().map(keyOf)),
            observeRoot: () => document.body
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
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>';
    const FAB_SIZE = 44;
    const EDGE_GAP = 12;

    const STYLE = `
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; }
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
            position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 5px;
            border-radius: 10px; background: #fff; color: var(--accent); font-size: 11px; font-weight: 700;
            display: none; place-items: center; box-shadow: 0 1px 4px rgba(0, 0, 0, .2);
        }
        .fab.sorted .badge, .fab.busy .badge { display: grid; }
        .fab svg.ring { position: absolute; inset: -4px; width: ${FAB_SIZE + 8}px; height: ${FAB_SIZE + 8}px; transform: rotate(-90deg); display: none; }
        .fab.busy svg.ring { display: block; }
        .ring circle { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; opacity: .35; }
        .ring circle.progress { opacity: 1; }
        .panel {
            position: fixed; width: 280px; padding: 14px; border-radius: 16px; background: #fff; color: #1b1d21;
            box-shadow: 0 12px 40px rgba(0, 0, 0, .16), 0 0 0 1px rgba(0, 0, 0, .05);
            display: none; flex-direction: column; gap: 12px; font-size: 13px;
        }
        .panel.open { display: flex; }
        .head { display: flex; align-items: center; gap: 8px; }
        .title { font-weight: 700; font-size: 14px; }
        .chip { padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 700; }
        .ver { color: #9aa0a8; font-size: 11px; margin-left: auto; }
        .icon-btn { border: none; background: transparent; color: #9aa0a8; cursor: pointer; padding: 2px; border-radius: 6px; display: grid; }
        .icon-btn:hover { color: #1b1d21; background: #f2f3f5; }
        .status { color: #5f6670; line-height: 1.4; min-height: 18px; }
        .status b { color: #1b1d21; }
        .primary {
            border: none; border-radius: 12px; padding: 11px 14px; background: var(--accent); color: #fff;
            font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .primary:hover { filter: brightness(1.06); }
        .label { color: #5f6670; font-size: 12px; }
        .presets { display: flex; gap: 6px; }
        .preset, .custom {
            flex: 1; height: 34px; border-radius: 10px; border: 1px solid #e3e5e8; background: #f7f8fa;
            color: #1b1d21; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .preset:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
        .custom { display: flex; align-items: center; padding: 0 4px 0 8px; cursor: text; flex: 1.4; }
        .custom input { width: 100%; border: none; background: transparent; font-size: 13px; font-weight: 600; outline: none; color: inherit; }
        .custom button { border: none; background: var(--accent); color: #fff; width: 24px; height: 24px; border-radius: 7px; cursor: pointer; display: grid; place-items: center; flex: none; }
        .custom:focus-within { border-color: var(--accent); }
        .secondary {
            border: 1px solid #e3e5e8; border-radius: 12px; padding: 9px 14px; background: #fff; color: #1b1d21;
            font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .secondary:hover:not(:disabled) { background: #f7f8fa; }
        .secondary:disabled { color: #b7bcc3; cursor: default; }
        .toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; color: #1b1d21; }
        .toggle input { display: none; }
        .switch { width: 34px; height: 20px; border-radius: 10px; background: #d5d8dd; position: relative; flex: none; transition: background .15s; }
        .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
        .toggle input:checked + .switch { background: var(--accent); }
        .toggle input:checked + .switch::after { transform: translateX(14px); }
        .busy-only { display: none; }
        .panel.busy .busy-only { display: block; }
        .panel.busy .idle-only { display: none; }
        .hint { color: #9aa0a8; font-size: 11px; }
        .toast {
            position: fixed; padding: 9px 14px; border-radius: 10px; background: #1b1d21; color: #fff; font-size: 13px;
            opacity: 0; pointer-events: none; transition: opacity .2s; max-width: 280px;
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
            <button class="fab" type="button" aria-label="SSMarket: сортировка" aria-expanded="false" title="SSMarket - сортировка по ${site.countWord}">
                ${ICON_SORT}
                <svg class="ring" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><circle class="progress" cx="26" cy="26" r="24"/></svg>
                <span class="badge"></span>
            </button>
            <div class="panel" role="dialog" aria-label="SSMarket">
                <div class="head">
                    <span class="title">SSMarket</span><span class="chip">${site.name}</span>
                    <span class="ver">v${VERSION}</span>
                    <button class="icon-btn close" type="button" aria-label="Закрыть">${ICON_CLOSE}</button>
                </div>
                <div class="status"></div>
                <button class="primary idle-only sort" type="button">Сортировать по ${site.countWord}</button>
                <button class="primary busy-only stop" type="button">Хватит, сортировать</button>
                <div class="idle-only">
                    <div class="label">Подгрузить ещё и отсортировать</div>
                    <div class="presets" style="margin-top: 6px">
                        ${SCROLL_PRESETS.map(seconds => `<button class="preset" type="button" data-seconds="${seconds}">${seconds} с</button>`).join('')}
                        <label class="custom" title="Своё число секунд, Enter - старт">
                            <input type="number" min="1" max="${MAX_SCROLL_SECONDS}" placeholder="N с" aria-label="Секунд листать">
                            <button type="button" aria-label="Старт">${ICON_PLAY}</button>
                        </label>
                    </div>
                </div>
                <button class="secondary undo idle-only" type="button">Как было</button>
                <label class="toggle idle-only"><span>Держать сортировку при смене фильтров</span><input type="checkbox" class="keep"><span class="switch"></span></label>
                <div class="hint idle-only">Кнопку можно перетащить в любое место</div>
            </div>
            <div class="toast" role="status"></div>
        `;
        host.style.setProperty('--accent', site.accent);
        host.style.setProperty('--accent-soft', site.accentSoft);
        document.body.appendChild(host);

        const $ = selector => shadow.querySelector(selector);
        const fab = $('.fab');
        const panel = $('.panel');
        const status = $('.status');
        const badge = $('.badge');
        const toastNode = $('.toast');
        const customInput = $('.custom input');
        const keepInput = $('.keep');
        const progress = $('.ring .progress');
        const ringLength = 2 * Math.PI * 24;
        progress.style.strokeDasharray = String(ringLength);

        const positionKey = `position:${site.id}`;
        let position = store.get(positionKey, { fx: 1, fy: 1 });
        let toastTimer = 0;

        function fabBox() {
            const maxX = document.documentElement.clientWidth - FAB_SIZE - EDGE_GAP * 2;
            const maxY = window.innerHeight - FAB_SIZE - EDGE_GAP * 2;
            return { x: EDGE_GAP + position.fx * maxX, y: EDGE_GAP + position.fy * maxY };
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
            const width = 280;
            const left = position.fx > 0.5 ? x + FAB_SIZE - width : x;
            panel.style.left = `${Math.max(EDGE_GAP, Math.min(left, document.documentElement.clientWidth - width - EDGE_GAP))}px`;
            if (position.fy > 0.5) {
                panel.style.top = '';
                panel.style.bottom = `${window.innerHeight - y + 10}px`;
            } else {
                panel.style.bottom = '';
                panel.style.top = `${y + FAB_SIZE + 10}px`;
            }
            toastNode.style.left = panel.style.left;
            toastNode.style.top = position.fy > 0.5 ? `${y - 50}px` : `${y + FAB_SIZE + 10}px`;
        }

        function setOpen(open) {
            panel.classList.toggle('open', open);
            fab.setAttribute('aria-expanded', String(open));
            if (open) {
                placePanel();
                actions.refresh();
            }
        }

        let drag = null;
        fab.addEventListener('pointerdown', event => {
            drag = { startX: event.clientX, startY: event.clientY, origin: fabBox(), moved: false };
            fab.setPointerCapture(event.pointerId);
        });
        fab.addEventListener('pointermove', event => {
            if (!drag) {
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
        fab.addEventListener('pointerup', () => {
            const wasDrag = drag?.moved;
            drag = null;
            fab.classList.remove('dragging');
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
        shadow.querySelectorAll('.preset').forEach(button => {
            button.addEventListener('click', () => actions.scrollAndSort(Number(button.dataset.seconds)));
        });
        const startCustom = () => {
            const seconds = Number(customInput.value);
            if (!(seconds > 0)) {
                customInput.focus();
                return;
            }
            store.set('customSeconds', seconds);
            actions.scrollAndSort(Math.min(seconds, MAX_SCROLL_SECONDS));
        };
        customInput.value = store.get('customSeconds', '') || '';
        customInput.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter') {
                startCustom();
            }
        });
        $('.custom button').addEventListener('click', startCustom);
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
            setStatus(html) {
                status.innerHTML = html;
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
                toastNode.classList.add('show');
                clearTimeout(toastTimer);
                toastTimer = setTimeout(() => toastNode.classList.remove('show'), 2600);
            }
        };
    }

    // ------------------------------------------------------------- actions
    let scrollRun = null;
    let lastResult = null;

    const actions = {
        refresh() {
            if (scrollRun) {
                return;
            }
            if (site.isSorted() && lastResult) {
                ui.setStatus(`Отсортировано <b>${formatNumber(lastResult.count)}</b> ${goodsWord(lastResult.count)} по ${site.countWord}. Больше всего - <b>${formatNumber(lastResult.top)}</b>.`);
            } else {
                site.capture();
                ui.setStatus(`Загружено <b>${formatNumber(site.visibleCount())}</b> ${goodsWord(site.visibleCount())}. Порядок сайта.`);
            }
            ui.setSorted(site.isSorted() && lastResult ? lastResult.count : 0);
        },

        sort({ scroll = true } = {}) {
            const result = site.sort();
            if (!result) {
                ui.toast('Карточки не найдены - это не страница выдачи');
                return;
            }
            lastResult = result;
            actions.refresh();
            if (scroll) {
                const top = result.anchor.getBoundingClientRect().top + window.scrollY - 140;
                window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
            }
        },

        restore() {
            const anchorTop = lastResult?.anchor.isConnected
                ? lastResult.anchor.getBoundingClientRect().top + window.scrollY - 140
                : null;
            site.restore();
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
            site.restore();
            lastResult = null;
            const totalMs = seconds * 1000;
            const startedAt = Date.now();
            const run = { stop: false, cancelled: false };
            scrollRun = run;
            ui.setSorted(0);
            while (!run.stop && Date.now() - startedAt < totalMs) {
                // At the bottom a scroll does not move and fires no event, so the site never asks for the next
                // page: step back to make the following step a real scroll.
                const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
                window.scrollBy(0, atBottom ? -window.innerHeight : Math.max(400, window.innerHeight * 0.8));
                site.capture();
                const remaining = Math.max(0, totalMs - (Date.now() - startedAt));
                ui.setBusy(remaining, totalMs);
                ui.setStatus(`Листаю выдачу, ещё <b>${Math.ceil(remaining / 1000)} с</b>. Загружено <b>${formatNumber(site.visibleCount())}</b>.`);
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

        // A new listing (filter, sort, query) drops the old cards; with "keep" on, the new results are
        // sorted once they stop arriving.
        async onListingChange() {
            const wasSorted = site.isSorted();
            const before = site.keySet();
            actions.cancelScroll();
            site.reset();
            lastResult = null;
            actions.refresh();
            if (!wasSorted || !ui.keepSorted()) {
                return;
            }
            const deadline = Date.now() + RESULTS_WAIT_MS;
            let lastSignature = '';
            let stableSince = Date.now();
            while (Date.now() < deadline) {
                await wait(250);
                const keys = site.keySet();
                const signature = [...keys].join(',');
                const isNew = keys.size > 0 && [...keys].some(key => !before.has(key));
                if (signature !== lastSignature) {
                    lastSignature = signature;
                    stableSince = Date.now();
                } else if (isNew && Date.now() - stableSince >= RESULTS_QUIET_MS) {
                    // Cards captured while the old listing was being replaced do not belong to the new one.
                    site.reset();
                    actions.sort({ scroll: false });
                    return;
                }
            }
        }
    };

    const ui = createUi();

    let captureTimer = 0;
    new MutationObserver(() => {
        if (captureTimer || scrollRun) {
            return;
        }
        captureTimer = setTimeout(() => {
            captureTimer = 0;
            site.capture();
        }, 300);
    }).observe(site.observeRoot(), { childList: true, subtree: true });

    let currentListing = listingKey();
    setInterval(() => {
        ui.setVisible(site.isListing() || site.isSorted());
        const next = listingKey();
        if (next !== currentListing) {
            currentListing = next;
            actions.onListingChange();
        }
    }, URL_POLL_MS);

    ui.setVisible(site.isListing());
    site.capture();
    actions.refresh();
})();
