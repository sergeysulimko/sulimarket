// SuliMarket core: shared by the Tampermonkey script and the browser extension.
// The build wraps it in a function and passes `store` - a synchronous key-value store of the host.
const VERSION = '__VERSION__';
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
// The address command of SuliMarket itself (see runAddressCommand); it does not make a new listing.
const COMMAND_PARAM = 'sulimarket';

function parseCount(text) {
    return parseInt(String(text).replace(/[^\d]/g, ''), 10) || 0;
}

// Our shop lines inside the site's cards carry counts of their own and are left out.
function leafTexts(root) {
    const texts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => (node.parentElement?.closest('[data-ssm-shop]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
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

// Narrow Ozon tiles (a seller badge in the rating row) print the count bare: "4.7", "2 099", "Ozon".
function readCountAfterRating(texts) {
    const at = texts.findIndex(text => /^[1-5][.,]\d{1,2}$/.test(text));
    const next = at < 0 ? '' : texts[at + 1] || '';
    return /^\d[\d\s ]*$/.test(next) ? parseCount(next) : 0;
}

function compareItems(a, b) {
    if (!a.count !== !b.count) {
        return a.count ? -1 : 1;
    }
    return (b.count - a.count) || (b.rating - a.rating) || (a.seen - b.seen);
}

const PRODUCT_LINKS = 'a[href*="/product/"], a[href*="/detail.aspx"]';
const PRICE = /^\d[\d\s\u2009\u00a0]*\s?₽$/;

// Title, address and price of a card for the machine-readable result. The title is the longest wordy text
// inside the product links: the counts and the price there carry no three letters in a row or are shorter.
function describeCard(node) {
    const link = node.querySelector(PRODUCT_LINKS);
    const url = link ? new URL(link.getAttribute('href'), location.origin) : null;
    const texts = leafTexts(node);
    const price = texts.find(text => PRICE.test(text));
    const linkTexts = Array.from(node.querySelectorAll(PRODUCT_LINKS)).flatMap(leafTexts);
    const title = (linkTexts.length ? linkTexts : texts)
        .filter(text => /[a-zа-яё]{3}/i.test(text) && !PRICE.test(text))
        .sort((a, b) => b.length - a.length)[0] || '';
    return {
        title: title.replace(/^\/\s*/, ''),
        url: url ? url.origin + url.pathname : '',
        price: price ? parseCount(price) : null
    };
}

function listingKey() {
    const params = new URLSearchParams(location.search);
    [...PAGING_PARAMS, COMMAND_PARAM].forEach(name => params.delete(name));
    params.sort();
    return `${location.pathname}?${params}`;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatNumber(value) {
    return value.toLocaleString('ru-RU');
}

// forms: [1 товар, 2 товара, 5 товаров]
function plural(count, forms) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) {
        return forms[0];
    }
    return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
}

const GOODS = ['товар', 'товара', 'товаров'];

function counted(count, forms) {
    return `${formatNumber(count)} ${plural(count, forms)}`;
}

// A strip on the page itself (between sorted and fresh cards, or under the sorted list) with one action.
function createPageBanner() {
    const node = document.createElement('div');
    node.dataset.ssmBanner = '1';
    node.style.cssText = 'grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 14px;'
        + ' flex-wrap: wrap; margin: 12px 0 20px; padding: 12px 16px; border-radius: 14px;'
        + ' font: 600 14px/1.35 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif; color: #1b1d21;';
    node.innerHTML = '<span></span><button type="button" style="border: none; border-radius: 10px; height: 34px; padding: 0 14px;'
        + ' font: inherit; color: #fff; cursor: pointer;"></button>';
    let onClick = null;
    node.querySelector('button').addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return {
        node,
        set({ text, action, fresh, handler }) {
            onClick = handler;
            const [label, button] = node.children;
            if (label.textContent !== text) {
                label.textContent = text;
            }
            if (button.textContent !== action) {
                button.textContent = action;
            }
            const background = fresh ? '#fff6e0' : '#f5f6f8';
            if (node.style.background !== background) {
                node.style.background = background;
                node.style.boxShadow = fresh ? 'inset 0 0 0 1px #ffb020' : 'none';
            }
            button.style.background = site.accent;
        }
    };
}

// ---------------------------------------------------------------- Ozon
// The search page is a virtual paginator: pages far from the viewport are unmounted, so cards are
// snapshotted while visible and the sorted list is drawn from snapshots in a root of our own.
// Search and category pages use infiniteVirtualPaginator, collection pages ("подборки") use megaPaginator.
// The site's own list stays on the page under the sorted one with the sorted cards hidden: its "load more"
// trigger keeps working, so a plain scroll past the sorted list loads the next page as on the site.
function createOzon() {
    const PAGINATOR = '[data-widget="infiniteVirtualPaginator"], [data-widget="megaPaginator"]';
    const TILE_GRID = '[data-widget="tileGridDesktop"]';
    const PRODUCT_LINK = 'a[href*="/product/"]';
    const REVIEWS = 'отзыв';
    const ROOT_ID = 'sulimarket-ozon-sorted';
    const AWAY = 'ssmAway';

    const cache = new Map();
    const layout = { gridClass: '', tileClass: '' };
    // Keys of the cards in the sorted list; their live tiles in the site's list are hidden.
    const sortedKeys = new Set();
    let sortedPaginator = null;

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

    // The style is on the page while a list is sorted; a tile is marked by its key.
    function awayStyle(on) {
        let node = document.getElementById('sulimarket-away');
        if (on && !node) {
            node = document.createElement('style');
            node.id = 'sulimarket-away';
            node.textContent = '[data-ssm-away] { display: none !important; }';
            document.head.appendChild(node);
        } else if (!on && node) {
            node.remove();
        }
    }

    // Runs from the page observer before the browser paints, so a page the site mounts again does not
    // flash its sorted cards under the sorted list.
    function hideSorted() {
        if (!sortedKeys.size) {
            return;
        }
        resultGrids().forEach(grid => tilesOf(grid).forEach(tile => {
            if (!tile.dataset[AWAY] && sortedKeys.has(keyOf(tile))) {
                tile.dataset[AWAY] = '1';
            }
        }));
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
            const count = readCount(tile, REVIEWS) || readCountAfterRating(leafTexts(tile));
            cache.set(key, {
                key,
                look,
                count: Math.max(known?.count || 0, count),
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
        sortedPaginator = native;
        sortedKeys.clear();
        items.forEach(item => sortedKeys.add(item.key));
        awayStyle(true);
        hideSorted();
        return root;
    }

    function removeRoot() {
        document.getElementById(ROOT_ID)?.remove();
    }

    return {
        id: 'ozon',
        name: 'Ozon',
        countWord: 'отзывам',
        countForms: ['отзыв', 'отзыва', 'отзывов'],
        // The strip ends the sorted list; the site's own list with the fresh cards follows it.
        placeBanner(node) {
            const root = document.getElementById(ROOT_ID);
            if (root && node.parentElement !== root) {
                root.appendChild(node);
            }
        },
        accent: '#005bff',
        accentSoft: '#e6efff',
        isListing: () => Boolean(paginator()) && resultGrids().length > 0,
        isSorted: () => Boolean(document.getElementById(ROOT_ID)),
        capture,
        hideSorted,
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
            return {
                count: items.length,
                top: items[0].count,
                anchor: root,
                items: items.map(item => ({ node: item.snapshot, count: item.count, rating: item.rating }))
            };
        },
        restore() {
            removeRoot();
            sortedKeys.clear();
            sortedPaginator = null;
            awayStyle(false);
            document.querySelectorAll('[data-ssm-away]').forEach(tile => delete tile.dataset[AWAY]);
        },
        keySignature: () => resultGrids().flatMap(grid => tilesOf(grid).map(keyOf)).join(','),
        isOwnNode: node => Boolean(node.closest?.(`#${ROOT_ID}, [data-ssm-banner]`)),
        // Ozon may re-render the column under the sorted list: drop a sorted list that lost its place.
        heal() {
            if (!sortedPaginator) {
                return false;
            }
            const root = document.getElementById(ROOT_ID);
            if (root && sortedPaginator.isConnected && paginator() === sortedPaginator) {
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
    // The list element the sort was applied to; the site may replace it with a fresh unsorted one.
    let sortedList = null;

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
            if (!child.style.order && !child.dataset.ssmBanner) {
                child.style.order = String(isCard(child) ? TAIL_ORDER : TAIL_ORDER * 2);
            }
        });
    }

    return {
        id: 'wb',
        name: 'WB',
        countWord: 'оценкам',
        countForms: ['оценка', 'оценки', 'оценок'],
        // Colours of the site as of 19.10.2026 (buttons rgb(167, 58, 253)).
        accent: '#a73afd',
        accentSoft: '#f4e7ff',
        // The strip sits between the sorted cards and the ones loaded after the sort.
        placeBanner(node) {
            const root = list();
            if (!root) {
                return;
            }
            node.style.order = String(TAIL_ORDER - 1);
            if (node.parentElement !== root) {
                root.appendChild(node);
            }
        },
        isListing: () => cards().length > 0,
        isSorted: () => Boolean(list()?.dataset[SORTED_ATTR]),
        capture() {
            capture();
            placeTail();
        },
        // Wildberries keeps its own cards and reorders them, there is nothing to hide.
        hideSorted() {},
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
                if (!child.dataset.ssmBanner) {
                    child.style.order = '';
                }
            });
            items.forEach((item, index) => {
                item.card.style.order = String(index + 1);
            });
            root.dataset[SORTED_ATTR] = '1';
            sortedList = root;
            placeTail();
            return {
                count: items.length,
                top: items[0].count,
                anchor: root,
                items: items.map(item => ({ node: item.card, count: item.count, rating: item.rating }))
            };
        },
        restore() {
            sortedList = null;
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
        isOwnNode: node => Boolean(node.closest?.('[data-ssm-banner]')),
        // True when the site re-rendered the sorted list in place and the order is gone.
        heal() {
            if (!sortedList || (list() === sortedList && sortedList.dataset[SORTED_ATTR])) {
                return false;
            }
            sortedList = null;
            return true;
        }
    };
}

// ------------------------------------------------- Ozon: other sellers of one product
// The product page opens "Другие предложения от продавцов на Ozon" from "Есть дешевле" / "Есть быстрее". Each
// seller row gets the shop's own numbers (rating, reviews, orders, time on Ozon) from the same request the site
// makes for its "О магазине" window, and the rows can be put in order of reviews with CSS `order`.
// Some product pages (often reached from a brand page) have no such button though other sellers exist; the
// window also opens as a page of its own, so SuliMarket puts a link to it where the button would be.
function createOzonOffers() {
    const LIST = '[data-widget="webSellerList"]';
    const SWITCHER = '[data-widget="webSellersSortSwitcher"]';
    const SELLER_LINK = 'a[href^="/seller/"]';
    const TAIL_ORDER = 100000;
    const LOAD_ALL_MS = 15000;
    const LOAD_STEP_MS = 3000;
    const STATS_FOR_SORT = 40;
    const FEW_ORDERS = 100;
    // Ozon answers a shop in under 0.1 s; two at a time with a pause keeps it under ~8 requests a second.
    const FETCHES_AT_ONCE = 2;
    const FETCH_PAUSE_MS = 200;
    const PRICE_BOX = '[data-widget="webSale"]';
    const SELLERS_BUTTON = '[data-widget="webBestSeller"]';
    // The site draws its "Есть дешевле" a moment after the price.
    const BUTTON_GRACE_MS = 2500;

    const shops = new Map();
    const queue = [];
    let fetching = 0;
    let button = null;
    let sorted = false;
    let busy = null;
    let productSeen = { id: '', since: 0, asked: false };
    const rowsWatch = new MutationObserver(() => placeTail());
    // While "По отзывам" scrolls the window to load all sellers, rows only fly past and are not asked about.
    const visible = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting && !busy) {
            visible.unobserve(entry.target);
            shopOf(entry.target);
        }
    }), { rootMargin: '600px 0px' });

    function rowsBox() {
        return document.querySelector(LIST)?.firstElementChild?.firstElementChild || null;
    }

    function rows() {
        const box = rowsBox();
        return box ? Array.from(box.children).filter(row => row.querySelector(SELLER_LINK)) : [];
    }

    function sellerId(row) {
        return row.querySelector(SELLER_LINK).getAttribute('href').match(/(\d+)\/?(?:[?#]|$)/)[1];
    }

    // Short numbers come as "4 240", "44,3 K", "107 K", "1,8 M".
    const SHORT_UNITS = { K: [1e3, 'тыс.'], M: [1e6, 'млн'] };

    function shortUnit(text) {
        return SHORT_UNITS[(text.match(/\d\s*([KM])/i)?.[1] || '').toUpperCase()] || null;
    }

    function readShort(text) {
        const number = parseFloat(text.replace(/[\s ]/g, '').replace(',', '.')) || 0;
        const unit = shortUnit(text);
        return unit ? Math.round(number * unit[0]) : number;
    }

    function shortText(text, forms) {
        const unit = shortUnit(text);
        if (unit) {
            return `${text.replace(/\s*[KM]\s*$/i, '').trim()} ${unit[1]} ${forms[2]}`;
        }
        return counted(readShort(text), forms);
    }

    async function loadShop(id) {
        const address = `/modal/shop-in-shop-info?seller_id=${id}`;
        const response = await fetch(`/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(address)}`, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(String(response.status));
        }
        const facts = {};
        Object.values((await response.json()).widgetStates || {}).forEach(state => {
            if (!state.includes('dsCell')) {
                return;
            }
            (JSON.parse(state).cells || []).forEach(cell => {
                const title = cell.dsCell?.centerBlock?.title?.text;
                const value = cell.dsCell?.rightBlock?.badge?.text;
                if (title && value) {
                    facts[title] = value;
                }
            });
        });
        return {
            rating: (facts['Средняя оценка товаров'] || '').replace(/\s*из.*$/, ''),
            reviews: facts['Количество отзывов'] || '',
            orders: facts['Заказов'] || '',
            age: facts['Работает с Ozon'] || ''
        };
    }

    // One request per shop, two at a time; the answer is kept for the tab's life.
    function shopOf(row) {
        const id = sellerId(row);
        if (!shops.has(id)) {
            const kept = sessionStorage.getItem(`sulimarket:shop:${id}`);
            shops.set(id, kept ? Promise.resolve(JSON.parse(kept)) : new Promise((resolve, reject) => {
                queue.push({ id, resolve, reject });
            }));
            pump();
        }
        const promise = shops.get(id);
        promise.then(shop => drawShop(row, shop), () => drawShop(row, null));
        return promise.catch(() => null);
    }

    function pump() {
        while (fetching < FETCHES_AT_ONCE && queue.length) {
            const job = queue.shift();
            fetching += 1;
            loadShop(job.id).then(shop => {
                sessionStorage.setItem(`sulimarket:shop:${job.id}`, JSON.stringify(shop));
                job.resolve(shop);
            }, job.reject).finally(() => wait(FETCH_PAUSE_MS).then(() => {
                fetching -= 1;
                pump();
            }));
        }
    }

    function infoColumn(row) {
        const name = Array.from(row.querySelectorAll(SELLER_LINK)).find(link => !link.querySelector('img'));
        return Array.from(row.firstElementChild.children).find(column => column.contains(name)) || row;
    }

    function shopLine(row) {
        let line = row.querySelector('[data-ssm-shop]');
        if (!line) {
            line = document.createElement('div');
            line.dataset.ssmShop = '1';
            line.style.cssText = 'margin-top: 6px; font-size: 13px; line-height: 1.35; color: #5f6670;';
            line.textContent = 'Магазин: загружаю';
            infoColumn(row).appendChild(line);
        }
        return line;
    }

    function drawShop(row, shop) {
        const line = shopLine(row);
        if (!shop) {
            line.textContent = 'Магазин: Ozon не ответил';
            return;
        }
        const parts = [];
        if (shop.rating) {
            parts.push(`★ ${shop.rating}`);
        }
        if (shop.reviews) {
            parts.push(shortText(shop.reviews, ['отзыв', 'отзыва', 'отзывов']));
        }
        parts.push(shop.orders ? shortText(shop.orders, ['заказ', 'заказа', 'заказов']) : 'нет заказов');
        if (shop.age) {
            parts.push(`${shop.age} на Ozon`);
        }
        const few = readShort(shop.orders) < FEW_ORDERS;
        line.textContent = `Магазин: ${parts.join(' · ')}${few ? ' - мало заказов' : ''}`;
        line.style.color = few ? '#b25e00' : '#5f6670';
        line.dataset.ssmReviews = String(readShort(shop.reviews));
    }

    function setLabel(text, active = sorted) {
        button.querySelector('span').textContent = text;
        button.style.background = active ? site.accent : '#fff';
        button.style.color = active ? '#fff' : '#1b1d21';
    }

    function makeButton(switcher) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.ssmOffersSort = '1';
        button.title = 'SuliMarket: продавцы с большим числом отзывов на этот товар - наверху';
        button.style.cssText = 'display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px;'
            + ' border: 1px solid #d6d9de; border-radius: 12px; font: inherit; font-weight: 600; cursor: pointer;';
        button.innerHTML = `${ICON_SORT}<span></span>`;
        button.querySelector('svg').setAttribute('width', '18');
        button.querySelector('svg').setAttribute('height', '18');
        setLabel('По отзывам');
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (busy) {
                busy.stop = true;
                return;
            }
            sortRows();
        });
        switcher.style.display = 'flex';
        switcher.style.alignItems = 'center';
        switcher.style.gap = '12px';
        switcher.appendChild(button);
        // A site tab ("Быстрее доставка", "Ниже цена") gives the order back to the site.
        switcher.addEventListener('click', event => {
            if (!button.contains(event.target)) {
                unsort();
            }
        }, true);
    }

    function scroller() {
        for (let node = rowsBox(); node; node = node.parentElement) {
            if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
                return node;
            }
        }
        return null;
    }

    // The site loads 20 sellers at a time while the window is scrolled; load them all, up to LOAD_ALL_MS.
    async function loadAll(run) {
        const box = scroller();
        const startedAt = Date.now();
        let count = rows().length;
        let grewAt = Date.now();
        while (box && !run.stop && Date.now() - startedAt < LOAD_ALL_MS && Date.now() - grewAt < LOAD_STEP_MS) {
            box.scrollTop = box.scrollHeight;
            await wait(250);
            const next = rows().length;
            if (next !== count) {
                count = next;
                grewAt = Date.now();
                setLabel(`Загружено ${count}`, true);
            }
        }
    }

    async function sortRows() {
        const run = { stop: false };
        busy = run;
        setLabel('Загружаю продавцов', true);
        await loadAll(run);
        const all = rows();
        setLabel('Смотрю магазины', true);
        await Promise.race([
            Promise.all(all.slice(0, STATS_FOR_SORT).map(shopOf)),
            new Promise(resolve => {
                const timer = setInterval(() => {
                    if (run.stop) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
            })
        ]);
        busy = null;
        const box = rowsBox();
        const items = all.map((row, index) => ({
            row,
            count: Number(row.dataset.ssmCount || 0),
            shop: Number(row.querySelector('[data-ssm-shop]')?.dataset.ssmReviews || 0),
            index
        })).sort((a, b) => (b.count - a.count) || (b.shop - a.shop) || (a.index - b.index));
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        items.forEach((item, index) => {
            item.row.style.order = String(index + 1);
            item.row.dataset.ssmPlaced = '1';
        });
        sorted = true;
        placeTail();
        rowsWatch.disconnect();
        rowsWatch.observe(box, { childList: true });
        setLabel(`По отзывам: ${all.length}`);
        const view = scroller();
        if (view) {
            view.scrollTop = 0;
        }
    }

    // Sellers loaded after the sort go under the sorted ones, the site's "load more" stays last.
    function placeTail() {
        const box = rowsBox();
        if (!sorted || !box) {
            return;
        }
        let fresh = 0;
        Array.from(box.children).forEach(child => {
            if (child.dataset.ssmPlaced) {
                return;
            }
            const isRow = Boolean(child.querySelector(SELLER_LINK));
            child.style.order = String(isRow ? TAIL_ORDER : TAIL_ORDER * 2);
            fresh += isRow ? 1 : 0;
        });
        if (fresh) {
            setLabel(`Досортировать +${fresh}`);
        }
    }

    function unsort() {
        rowsWatch.disconnect();
        const box = rowsBox();
        sorted = false;
        if (box) {
            box.style.display = '';
            box.style.flexDirection = '';
            Array.from(box.children).forEach(child => {
                child.style.order = '';
                delete child.dataset.ssmPlaced;
            });
        }
        if (button) {
            setLabel('По отзывам', false);
        }
    }

    function productId() {
        const match = location.pathname.match(/^\/product\/(?:[^/]*-)?(\d+)\/?$/);
        return match ? match[1] : '';
    }

    // One request per product page without the site's button: are there other sellers, and from what price.
    async function offerHiddenSellers(id, priceBox) {
        const address = `/modal/otherOffersFromSellers?product_id=${id}&sort=price`;
        const response = await fetch(`/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(address)}`, { credentials: 'include' });
        if (!response.ok) {
            return;
        }
        const states = Object.entries((await response.json()).widgetStates || {});
        const list = states.find(([key]) => key.startsWith('webSellerList'));
        const sellers = list ? JSON.parse(list[1]).sellers || [] : [];
        if (!sellers.length || productId() !== id || document.querySelector(SELLERS_BUTTON)) {
            return;
        }
        const price = sellers[0].price?.cardPrice?.price || sellers[0].price?.price || '';
        const link = document.createElement('a');
        link.dataset.ssmSellers = '1';
        link.href = address;
        link.target = '_blank';
        link.title = 'SuliMarket: Ozon не показал кнопку "Есть дешевле" на этой странице';
        link.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 12px 16px;'
            + ' border-radius: 16px; background: #f2f3f5; color: #1b1d21; text-decoration: none; font-size: 15px; line-height: 1.3;';
        link.innerHTML = `<span style="color: ${site.accent}; display: grid;">${ICON_SORT}</span><span><span style="color: #5f6670;">Другие продавцы - ${counted(sellers.length, ['предложение', 'предложения', 'предложений'])}</span><br><b></b></span>`;
        link.querySelector('b').textContent = price ? `от ${price}` : 'смотреть';
        priceBox.appendChild(link);
    }

    function checkProductPage() {
        const id = productId();
        if (id !== productSeen.id) {
            productSeen = { id, since: 0, asked: false };
        }
        const priceBox = id && !productSeen.asked && document.querySelector(PRICE_BOX);
        if (!priceBox) {
            return;
        }
        if (!productSeen.since) {
            productSeen.since = Date.now();
        }
        if (Date.now() - productSeen.since >= BUTTON_GRACE_MS && !document.querySelector(SELLERS_BUTTON)) {
            productSeen.asked = true;
            offerHiddenSellers(id, priceBox);
        }
    }

    return {
        // Called on a timer: the window opens and loads more sellers at the site's pace.
        check() {
            checkProductPage();
            const switcher = document.querySelector(SWITCHER);
            if (!switcher || !rowsBox()) {
                if (button && !button.isConnected) {
                    button = null;
                    sorted = false;
                    rowsWatch.disconnect();
                }
                return;
            }
            if (!button || !button.isConnected) {
                sorted = false;
                makeButton(switcher);
            }
            rows().forEach(row => {
                if (!row.dataset.ssmSeen) {
                    row.dataset.ssmSeen = '1';
                    // Reviews of this seller on this product, read before the shop line adds its own number.
                    row.dataset.ssmCount = String(readCount(row, 'отзыв'));
                    shopLine(row);
                    visible.observe(row);
                }
            });
        }
    };
}

// ------------------------------------------------- Wildberries: who sells
// Wildberries gives its seller facts to the site itself: a product's card file names the seller, and one request
// returns rating, ratings, sales and the start date of many sellers at once. SuliMarket shows them under each card
// of the results, under the seller on a product page and on each row of "Предложения продавцов" (the same product
// from other sellers), and puts those rows in order of ratings on request.
function createWbSellers() {
    const CARD = '.product-card-list article[data-nm-id]';
    const CARD_TITLE = 'h2';
    const OFFERS_PAGE = /^\/catalog\/\d+\/other-sellers/;
    const OFFER_ROW = 'li[data-testid="seller-item"]';
    const OFFER_TEXT = '[class*="description"]';
    const SELLER_LINK = 'a[href*="/seller/"]';
    const PRODUCT_SELLER = '[class*="sellerInfoWrap"]';
    const SITE_SORT = ['Популярности', 'Возрастанию цены'];
    const FACTS_URL = 'https://suppliers-shipment-2.wildberries.ru/api/v1/suppliers/find_by_ids';
    const NAME_URL = 'https://static-basket-01.wbbasket.ru/vol0/data/supplier-by-id/';
    const FEW_SALES = 100;
    const NAME_CHARS = 24;
    const FACTS_BATCH = 50;
    const FACTS_GATHER_MS = 600;
    const SORT_WAIT_MS = 6000;
    // Same pace as on Ozon: two requests at a time with a pause, under ~8 a second.
    const FETCHES_AT_ONCE = 2;
    const FETCH_PAUSE_MS = 200;
    const TAIL_ORDER = 100000;
    const MUTED = '#5f6670';
    const WARN = '#b25e00';

    const memo = new Map();
    const queue = [];
    const asked = new Map();
    let fetching = 0;
    let gatherTimer = 0;
    let button = null;
    let sorted = false;
    const rowsWatch = new MutationObserver(() => placeTail());
    const visible = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
            visible.unobserve(entry.target);
            tileShop(entry.target);
        }
    }), { rootMargin: '400px 0px' });

    function limited(task) {
        return new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            pump();
        });
    }

    function pump() {
        while (fetching < FETCHES_AT_ONCE && queue.length) {
            const job = queue.shift();
            fetching += 1;
            job.task().then(job.resolve, job.reject).finally(() => wait(FETCH_PAUSE_MS).then(() => {
                fetching -= 1;
                pump();
            }));
        }
    }

    async function getJson(url, options) {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(String(response.status));
        }
        return response.json();
    }

    // Each answer is asked once and kept for the tab's life.
    function remembered(key, load) {
        if (!memo.has(key)) {
            const kept = sessionStorage.getItem(`sulimarket:${key}`);
            memo.set(key, kept ? Promise.resolve(JSON.parse(kept)) : load().then(value => {
                sessionStorage.setItem(`sulimarket:${key}`, JSON.stringify(value));
                return value;
            }));
        }
        return memo.get(key);
    }

    // The card file sits next to the card's pictures on the same storage server.
    function sellerOfCard(card) {
        const picture = card.querySelector('img[src*="/images/"]')?.src || '';
        if (!picture.includes(`/${card.dataset.nmId}/images/`)) {
            return Promise.resolve(0);
        }
        const address = picture.replace(/\/images\/.*$/, '/info/ru/card.json');
        return remembered(`wb:seller-of:${card.dataset.nmId}`, () => limited(() => getJson(address))
            .then(info => info.selling?.supplier_id || 0));
    }

    function facts(id) {
        return remembered(`wb:shop:${id}`, () => new Promise((resolve, reject) => {
            asked.set(id, { resolve, reject });
            clearTimeout(gatherTimer);
            gatherTimer = setTimeout(askFacts, FACTS_GATHER_MS);
        }));
    }

    // Sellers wanted within a moment of each other go in one request, up to FACTS_BATCH at a time.
    function askFacts() {
        const jobs = Array.from(asked.entries());
        asked.clear();
        for (let start = 0; start < jobs.length; start += FACTS_BATCH) {
            const batch = jobs.slice(start, start + FACTS_BATCH);
            limited(() => getJson(FACTS_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-client-name': 'site' },
                body: JSON.stringify(batch.map(([id]) => Number(id)))
            })).then(answer => {
                const byId = new Map(answer.map(shop => [String(shop.id), shop]));
                batch.forEach(([id, job]) => {
                    const shop = byId.get(id);
                    job.resolve(shop ? {
                        rating: shop.valuation || '',
                        ratings: shop.feedbacksCount || 0,
                        sales: shop.saleItemQuantity || 0,
                        since: shop.registrationDate || ''
                    } : null);
                });
            }, error => batch.forEach(([, job]) => job.reject(error)));
        }
    }

    function shopName(id) {
        return remembered(`wb:name:${id}`, () => limited(() => getJson(`${NAME_URL}${id}.json`))
            .then(info => info.trademark || info.supplierName || ''));
    }

    // 2 600 000 -> "2,6 млн", 14 762 -> "15 тыс.", 984 -> "984".
    function big(count, forms) {
        if (count >= 1e6) {
            return `${String(Math.round(count / 1e5) / 10).replace('.', ',')} млн ${forms[2]}`;
        }
        if (count >= 1e4) {
            return `${Math.round(count / 1000)} тыс. ${forms[2]}`;
        }
        return counted(count, forms);
    }

    function age(since) {
        const months = Math.floor((Date.now() - Date.parse(since)) / (30.44 * 24 * 3600 * 1000));
        if (!(months >= 1)) {
            return 'меньше месяца';
        }
        return months < 12 ? counted(months, ['месяц', 'месяца', 'месяцев'])
            : counted(Math.floor(months / 12), ['год', 'года', 'лет']);
    }

    // parts: which facts the site does not show at this place already; "year" is the short start for narrow cards.
    function describe(shop, parts) {
        const out = [];
        if (parts.includes('rating') && shop.rating) {
            out.push(`★ ${String(shop.rating).replace('.', ',')}`);
        }
        if (parts.includes('ratings') && shop.ratings) {
            out.push(big(shop.ratings, ['оценка', 'оценки', 'оценок']));
        }
        out.push(shop.sales ? big(shop.sales, ['продажа', 'продажи', 'продаж']) : 'нет продаж');
        if (shop.since) {
            out.push(parts.includes('year') ? `с ${shop.since.slice(0, 4)}` : `${age(shop.since)} на WB`);
        }
        return out.join(' · ');
    }

    function makeLine(size) {
        const line = document.createElement('div');
        line.dataset.ssmShop = '1';
        line.style.cssText = `font-size: ${size}px; line-height: 1.35; color: ${MUTED}; white-space: normal;`;
        return line;
    }

    function fill(line, text, shop) {
        const few = shop.sales < FEW_SALES;
        line.textContent = `${text}${few ? ' - мало продаж' : ''}`;
        line.style.color = few ? WARN : MUTED;
    }

    // ---- results: a line under the title of each card that comes into view
    async function tileShop(card) {
        const nm = card.dataset.nmId;
        try {
            const id = await sellerOfCard(card);
            if (!id) {
                return;
            }
            const [shop, name] = await Promise.all([facts(String(id)), shopName(id).catch(() => '')]);
            const title = card.querySelector(CARD_TITLE);
            if (!shop || !title || card.dataset.nmId !== nm) {
                return;
            }
            const line = card.querySelector('[data-ssm-shop]') || makeLine(12);
            line.style.marginTop = '4px';
            const shortName = name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1).trim()}...` : name;
            fill(line, `${shortName || 'Продавец'} · ${describe(shop, ['rating', 'year'])}`, shop);
            line.title = `Продавец ${name}: ${describe(shop, ['rating', 'ratings'])}`;
            if (!line.isConnected) {
                title.after(line);
            }
            card.dataset.ssmShopDrawn = nm;
        } catch {
            // The card stays as the site drew it.
        }
    }

    function checkTiles() {
        document.querySelectorAll(CARD).forEach(card => {
            const nm = card.dataset.nmId;
            if (card.dataset.ssmWatch !== nm) {
                card.dataset.ssmWatch = nm;
                visible.observe(card);
            } else if (card.dataset.ssmShopDrawn === nm && !card.querySelector('[data-ssm-shop]')) {
                // The site re-drew the card's insides; the answer is kept, draw it again.
                tileShop(card);
            }
        });
    }

    // ---- product page: what the site leaves out about its seller
    function checkProductSeller() {
        const box = document.querySelector(PRODUCT_SELLER);
        const link = box?.querySelector(SELLER_LINK);
        const id = link?.getAttribute('href').match(/\/seller\/(\d+)/)?.[1];
        if (!id || box.dataset.ssmSeller === id) {
            return;
        }
        box.dataset.ssmSeller = id;
        // The seller's box sits in rows of flex; the line goes under the outermost row.
        let anchor = box;
        while (anchor.parentElement && /flex/.test(getComputedStyle(anchor.parentElement).display)
            && getComputedStyle(anchor.parentElement).flexDirection === 'row') {
            anchor = anchor.parentElement;
        }
        const old = anchor.nextElementSibling;
        if (old?.dataset.ssmShop) {
            old.remove();
        }
        facts(id).then(shop => {
            if (!shop || box.dataset.ssmSeller !== id) {
                return;
            }
            const line = makeLine(13);
            line.style.marginTop = '4px';
            fill(line, `Магазин: ${describe(shop, ['ratings'])}`, shop);
            anchor.after(line);
        }, () => {});
    }

    // ---- "Предложения продавцов": a line on each row and the order of ratings
    function rows() {
        return Array.from(document.querySelectorAll(OFFER_ROW));
    }

    function rowSeller(row) {
        return row.querySelector(SELLER_LINK)?.getAttribute('href').match(/\/seller\/(\d+)/)?.[1] || '';
    }

    function rowShop(row) {
        const id = rowSeller(row);
        if (!id) {
            return Promise.resolve(null);
        }
        return facts(id).then(shop => {
            if (shop) {
                row.dataset.ssmRatings = String(shop.ratings);
                // Under the seller's name and marks, inside the seller's own column.
                const link = row.querySelector(SELLER_LINK);
                const column = link.querySelector('[class*="wrapper"]') || link;
                const line = row.querySelector('[data-ssm-shop]') || makeLine(13);
                line.style.margin = '2px 0 0';
                fill(line, describe(shop, []), shop);
                if (!line.isConnected) {
                    column.appendChild(line);
                }
            }
            return shop;
        }, () => null);
    }

    function siteSortButtons() {
        return Array.from(document.querySelectorAll('button')).filter(node => SITE_SORT.includes(node.textContent.trim()));
    }

    // The site's sort choices are words; ours is a word in the site's accent while it holds the order.
    function setLabel(text, active = sorted) {
        button.querySelector('span').textContent = text;
        button.style.color = active ? site.accent : '';
        button.style.fontWeight = active ? '600' : '';
    }

    function makeButton(siteButton) {
        const item = siteButton.closest('li') || siteButton;
        const holder = item.cloneNode(false);
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.ssmOffersSort = '1';
        button.className = siteButton.className.split(/\s+/).filter(name => !name.startsWith('selected')).join(' ');
        button.innerHTML = '<span></span>';
        button.firstChild.className = siteButton.querySelector('span')?.className || '';
        button.title = 'SuliMarket: продавцы с большим числом оценок на этот товар - наверху';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            sortRows();
        });
        setLabel('По отзывам', false);
        if (holder === siteButton) {
            item.after(button);
        } else {
            holder.appendChild(button);
            item.parentElement.appendChild(holder);
        }
        // A site order ("Популярности", "Возрастанию цены") gives the order back to the site.
        item.parentElement.addEventListener('click', event => {
            if (!button.contains(event.target)) {
                unsort();
            }
        }, true);
    }

    async function sortRows() {
        const all = rows();
        if (!all.length) {
            return;
        }
        setLabel('Смотрю магазины', true);
        await Promise.race([Promise.all(all.map(rowShop)), wait(SORT_WAIT_MS)]);
        const box = all[0].parentElement;
        const items = all.map((row, index) => ({
            row,
            count: readCount(row.querySelector(OFFER_TEXT) || row, 'оцен'),
            shop: Number(row.dataset.ssmRatings || 0),
            index
        })).sort((a, b) => (b.count - a.count) || (b.shop - a.shop) || (a.index - b.index));
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        items.forEach((item, index) => {
            item.row.style.order = String(index + 1);
            item.row.dataset.ssmPlaced = '1';
        });
        sorted = true;
        placeTail();
        rowsWatch.disconnect();
        rowsWatch.observe(box, { childList: true });
        setLabel(`По отзывам: ${all.length}`);
    }

    // Rows loaded after the sort go under the sorted ones.
    function placeTail() {
        const box = rows()[0]?.parentElement;
        if (!sorted || !box) {
            return;
        }
        let fresh = 0;
        Array.from(box.children).forEach(child => {
            if (!child.dataset.ssmPlaced) {
                child.style.order = String(TAIL_ORDER);
                fresh += child.matches(OFFER_ROW) ? 1 : 0;
            }
        });
        if (fresh) {
            setLabel(`Досортировать +${fresh}`);
        }
    }

    function unsort() {
        rowsWatch.disconnect();
        const box = rows()[0]?.parentElement;
        sorted = false;
        if (box) {
            box.style.display = '';
            box.style.flexDirection = '';
            Array.from(box.children).forEach(child => {
                child.style.order = '';
                delete child.dataset.ssmPlaced;
            });
        }
        if (button) {
            setLabel('По отзывам', false);
        }
    }

    function checkOffersPage() {
        if (!OFFERS_PAGE.test(location.pathname)) {
            if (button) {
                button = null;
                sorted = false;
                rowsWatch.disconnect();
            }
            return;
        }
        const siteButton = siteSortButtons()[0];
        if (siteButton && (!button || !button.isConnected)) {
            sorted = false;
            makeButton(siteButton);
        }
        rows().forEach(row => {
            const id = rowSeller(row);
            if (row.dataset.ssmSeen !== id) {
                row.dataset.ssmSeen = id;
                rowShop(row);
            }
        });
    }

    return {
        // Called on a timer: the site draws cards and rows at its own pace.
        check() {
            checkTiles();
            checkProductSeller();
            checkOffersPage();
        }
    };
}

const site = location.hostname.endsWith('ozon.ru') ? createOzon()
    : location.hostname.endsWith('wildberries.ru') ? createWildberries()
        : null;
// The extension and the Tampermonkey script may both be installed: the first one on the page wins.
if (!site || document.documentElement.dataset.sulimarket) {
    return;
}
document.documentElement.dataset.sulimarket = VERSION;

// ------------------------------------------------------------------ UI
const ICON_SORT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h11M4 12h8M4 18h5"/><path d="M18 5v14M15 16l3 3 3-3"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const ICON_UNDO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>';
const FAB_SIZE = 40;
const EDGE_GAP = 12;
const PANEL_WIDTH = 256;
// Amber marks "new cards loaded below, not sorted yet": readable next to both site accents.
const FRESH = '#ffb020';
const FRESH_SOFT = '#fff6e0';
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
        box-shadow: 0 4px 14px rgba(0, 0, 0, .18); transition: transform .15s ease, box-shadow .15s ease;
    }
    .fab svg { width: 18px; height: 18px; }
    .fab:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(0, 0, 0, .22); }
    .fab:focus-visible { outline: 3px solid var(--accent-soft); outline-offset: 2px; }
    .fab.dragging { cursor: grabbing; transform: scale(1.06); transition: none; }
    .fab.fresh { box-shadow: 0 0 0 3px ${FRESH}, 0 4px 14px rgba(0, 0, 0, .18); }
    .fab .badge {
        position: absolute; top: -6px; right: -8px; min-width: 20px; height: 20px; padding: 0 5px;
        border-radius: 10px; background: #fff; color: #5f6670; font-size: 11px; font-weight: 700; white-space: nowrap;
        display: grid; place-items: center; box-shadow: 0 1px 4px rgba(0, 0, 0, .22);
    }
    .fab .badge:empty { display: none; }
    .fab.sorted .badge, .fab.busy .badge { color: var(--accent); }
    .fab.fresh .badge { background: ${FRESH}; color: #1b1d21; }
    .fab svg.ring { position: absolute; inset: -5px; width: ${FAB_SIZE + 10}px; height: ${FAB_SIZE + 10}px; transform: rotate(-90deg); display: none; }
    .fab.busy svg.ring { display: block; }
    .ring circle { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; opacity: .25; }
    .ring circle.progress { opacity: 1; transition: stroke-dashoffset .28s linear; }
    .panel {
        position: fixed; width: ${PANEL_WIDTH}px; padding: 12px; border-radius: 16px; background: #fff; color: #1b1d21;
        box-shadow: 0 14px 40px rgba(16, 24, 40, .16), 0 0 0 1px rgba(16, 24, 40, .06);
        display: none; flex-direction: column; gap: 10px; font-size: 13px; line-height: 1.35; overflow-y: auto;
    }
    .panel.open { display: flex; }
    .panel > * { flex-shrink: 0; }
    .caret { position: fixed; width: 10px; height: 10px; background: #fff; transform: rotate(45deg); display: none; }
    .caret.open { display: block; }
    .caret.above { box-shadow: 1px 1px 0 rgba(16, 24, 40, .06); }
    .caret.below { box-shadow: -1px -1px 0 rgba(16, 24, 40, .06); }
    .head { display: flex; align-items: center; gap: 6px; }
    .title { font-weight: 800; font-size: 14px; letter-spacing: -.01em; }
    .chip { padding: 2px 7px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 10px; font-weight: 700; }
    .ver { color: #9aa0a8; font-size: 11px; margin-left: auto; }
    .icon-btn { border: none; background: transparent; color: #5f6670; cursor: pointer; padding: 2px; border-radius: 6px; display: grid; }
    .icon-btn:hover { color: #1b1d21; background: #f2f3f5; }
    .status { padding: 8px 10px; border-radius: 10px; background: #f5f6f8; }
    .status.fresh { background: ${FRESH_SOFT}; box-shadow: inset 0 0 0 1px ${FRESH}; }
    .status-main { font-weight: 600; text-wrap: pretty; }
    .status-main b { font-weight: 800; }
    .status-sub { color: #5f6670; font-size: 12px; margin-top: 1px; text-wrap: pretty; }
    .primary {
        border: none; border-radius: 10px; height: 36px; padding: 0 12px; background: var(--accent); color: #fff;
        font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; white-space: nowrap;
    }
    .primary svg { width: 16px; height: 16px; }
    .primary:hover { filter: brightness(1.07); }
    .label { color: #5f6670; font-size: 12px; margin-bottom: 6px; }
    .row { display: flex; gap: 6px; align-items: center; }
    .seg { flex: 1; display: flex; height: 32px; padding: 2px; gap: 2px; border: 1px solid #e3e5e8; border-radius: 10px; background: #fff; }
    .preset, .custom {
        flex: 1; border: none; border-radius: 8px; background: transparent; color: #1b1d21;
        font-size: 12px; font-weight: 600; cursor: pointer; min-width: 0; white-space: nowrap;
    }
    .preset:hover { background: #f2f3f5; }
    .preset.active { background: var(--accent); color: #fff; }
    .custom { display: flex; align-items: center; justify-content: center; cursor: text; }
    .custom input { width: 100%; border: none; background: transparent; font: inherit; font-weight: 600; text-align: center; outline: none; color: inherit; -moz-appearance: textfield; }
    .custom input::-webkit-outer-spin-button, .custom input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .custom input::placeholder { color: #5f6670; }
    .custom:focus-within { box-shadow: inset 0 0 0 1.5px var(--accent); }
    .play { flex: none; width: 32px; height: 32px; border-radius: 50%; border: none; background: var(--accent-soft); color: var(--accent); cursor: pointer; display: grid; place-items: center; }
    .play svg { width: 14px; height: 14px; }
    .play:hover { background: var(--accent); color: #fff; }
    .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .undo {
        border: 1px solid #e3e5e8; border-radius: 8px; height: 28px; padding: 0 9px; background: #fff; color: #1b1d21;
        font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 5px; white-space: nowrap;
    }
    .undo svg { width: 14px; height: 14px; }
    .undo:hover:not(:disabled) { background: #f7f8fa; }
    .undo:disabled { color: #b7bcc3; cursor: default; }
    .toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; color: #1b1d21; font-size: 12px; white-space: nowrap; }
    .toggle input { display: none; }
    .switch { width: 30px; height: 18px; border-radius: 9px; background: #d5d8dd; position: relative; flex: none; transition: background .15s; }
    .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
    .toggle input:checked + .switch { background: var(--accent); }
    .toggle input:checked + .switch::after { transform: translateX(12px); }
    .busy-only { display: none; }
    .panel.busy .busy-only { display: flex; }
    .panel.busy .idle-only { display: none; }
    .toast {
        position: fixed; padding: 8px 12px; border-radius: 10px; background: #1b1d21; color: #fff; font-size: 12px;
        opacity: 0; pointer-events: none; transition: opacity .2s; max-width: ${PANEL_WIDTH}px;
    }
    .toast.show { opacity: .95; }
    .pill {
        position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: none; align-items: center; gap: 12px;
        padding: 6px 6px 6px 16px; border-radius: 999px; background: #fff; color: #1b1d21; font-size: 14px; font-weight: 600;
        white-space: nowrap; box-shadow: 0 0 0 2px ${FRESH}, 0 8px 24px rgba(0, 0, 0, .18);
    }
    .pill.show { display: flex; }
    .pill button {
        height: 32px; padding: 0 14px; border: none; border-radius: 999px; background: var(--accent); color: #fff;
        font-weight: 600; cursor: pointer;
    }
`;

function createUi() {
    const host = document.createElement('div');
    host.id = 'sulimarket-ui';
    host.style.cssText = 'position: fixed; z-index: 2147483000; top: 0; left: 0; width: 0; height: 0;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>${STYLE}</style>
        <button class="fab" type="button" aria-label="SuliMarket: сортировка" aria-expanded="false" title="SuliMarket - сортировка по ${site.countWord}. Кнопку можно перетащить">
            ${ICON_SORT}
            <svg class="ring" viewBox="0 0 54 54"><circle cx="27" cy="27" r="25"/><circle class="progress" cx="27" cy="27" r="25"/></svg>
            <span class="badge"></span>
        </button>
        <div class="panel" role="dialog" aria-label="SuliMarket">
            <div class="head">
                <span class="title">SuliMarket</span><span class="chip">${site.name}</span>
                <span class="ver">v${VERSION}</span>
                <button class="icon-btn close" type="button" aria-label="Закрыть">${ICON_CLOSE}</button>
            </div>
            <div class="status" role="status"><div class="status-main"></div><div class="status-sub"></div></div>
            <button class="primary idle-only sort" type="button">${ICON_SORT}<span class="sort-label"></span></button>
            <button class="primary busy-only stop" type="button">Хватит, сортировать</button>
            <div class="idle-only">
                <div class="label">Догрузить и отсортировать</div>
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
            <div class="foot idle-only">
                <button class="undo" type="button" title="Вернуть порядок сайта">${ICON_UNDO}<span>Как было</span></button>
                <label class="toggle" title="Сортировать снова после смены фильтра, категории, поиска и при возврате назад"><input type="checkbox" class="keep"><span class="switch"></span><span>Держать</span></label>
            </div>
        </div>
        <div class="caret"></div>
        <div class="toast" role="status"></div>
        <div class="pill" role="status"><span class="pill-text"></span><button type="button">Досортировать</button></div>
    `;
    host.style.setProperty('--accent', site.accent);
    host.style.setProperty('--accent-soft', site.accentSoft);
    document.body.appendChild(host);

    const $ = selector => shadow.querySelector(selector);
    const fab = $('.fab');
    const panel = $('.panel');
    const status = $('.status');
    const statusMain = $('.status-main');
    const statusSub = $('.status-sub');
    const sortLabel = $('.sort-label');
    const badge = $('.badge');
    const toastNode = $('.toast');
    const caret = $('.caret');
    const customInput = $('.custom input');
    const keepInput = $('.keep');
    const progress = $('.ring .progress');
    const pill = $('.pill');
    const pillText = $('.pill-text');
    const ringLength = 2 * Math.PI * 25;
    let busy = false;
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

    // Fresh cards are announced at the bottom of the window until the strip between the sorted and the fresh
    // cards is on screen: a user who scrolls fast must not take the sorted part for the whole listing.
    let freshCount = 0;
    let stripOnScreen = false;
    const stripWatch = new IntersectionObserver(entries => {
        stripOnScreen = entries[entries.length - 1].isIntersecting;
        pill.classList.toggle('show', freshCount > 0 && !stripOnScreen);
    });
    let watchedStrip = null;
    pill.querySelector('button').addEventListener('click', () => actions.sort());

    return {
        setVisible(visible) {
            host.style.display = visible ? '' : 'none';
            if (!visible) {
                setOpen(false);
            }
        },
        // One call draws the whole state: panel texts, the badge on the button and its colour.
        render({ main, sub = '', tone = 'idle', badgeText = '', sortText, sorted = false }) {
            statusMain.innerHTML = main;
            statusSub.innerHTML = sub;
            status.className = `status ${tone === 'fresh' ? 'fresh' : ''}`;
            sortLabel.textContent = sortText;
            $('.undo').disabled = !sorted;
            fab.classList.toggle('sorted', sorted);
            fab.classList.toggle('fresh', tone === 'fresh');
            if (!busy) {
                badge.textContent = badgeText;
            }
        },
        setBusy(remainingMs, totalMs) {
            busy = remainingMs !== null;
            fab.classList.toggle('busy', busy);
            panel.classList.toggle('busy', busy);
            if (busy) {
                badge.textContent = String(Math.ceil(remainingMs / 1000));
                progress.style.strokeDashoffset = String(ringLength * (remainingMs / totalMs));
            }
        },
        showFresh(count, strip = null) {
            freshCount = count;
            if (strip && strip !== watchedStrip) {
                stripWatch.disconnect();
                stripWatch.observe(strip);
                watchedStrip = strip;
            }
            pillText.textContent = `Ещё ${counted(count, GOODS)} без сортировки`;
            pill.classList.toggle('show', count > 0 && !stripOnScreen);
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
// Generation of the listing wait that shows "Сайт обновляет выдачу"; live refreshes must not overwrite it.
// Any newer action bumps listingGen and so lifts the block.
let settlingGen = -1;
let currentListing = listingKey();
let lastKeySignature = '';

// "Sorting is on" for this tab: set by a sort, cleared by "Как было". With "Держать" on, every next listing
// in the tab (filter, category, search, Back) is sorted too.
const sortingOn = {
    get: () => sessionStorage.getItem('sulimarket:on') === '1',
    set: on => (on ? sessionStorage.setItem('sulimarket:on', '1') : sessionStorage.removeItem('sulimarket:on'))
};
const banner = createPageBanner();

// Agents and scripts read the state from html[data-sulimarket-state] (idle, busy, sorted) and the sorted
// list from the JSON node #sulimarket-result, without parsing the page. Both sit outside <body>, so the
// observer of the site's cards does not see them change.
function publish(state, result = null) {
    document.documentElement.dataset.sulimarketState = state;
    let node = document.getElementById('sulimarket-result');
    if (!node) {
        node = document.createElement('script');
        node.type = 'application/json';
        node.id = 'sulimarket-result';
        document.documentElement.appendChild(node);
    }
    node.textContent = JSON.stringify({
        version: VERSION,
        site: site.id,
        countOf: site.id === 'ozon' ? 'reviews' : 'ratings',
        state,
        url: location.href,
        items: result ? result.items.map((item, index) => ({
            rank: index + 1,
            ...describeCard(item.node),
            count: item.count,
            rating: item.rating || null
        })) : []
    });
}

const actions = {
    refresh() {
        if (scrollRun || settlingGen === listingGen) {
            return;
        }
        const sortText = `Сортировать по ${site.countWord}`;
        if (site.isSorted() && lastResult) {
            const fresh = site.unsortedCount();
            if (fresh > 0) {
                ui.render({
                    main: `Ниже ещё <b>+${formatNumber(fresh)}</b> новых`,
                    sub: `Не отсортированы. Наверху ${counted(lastResult.count, GOODS)} по ${site.countWord}.`,
                    tone: 'fresh',
                    badgeText: `+${fresh}`,
                    sortText: `Досортировать +${formatNumber(fresh)}`,
                    sorted: true
                });
                banner.set({
                    text: `Ниже ещё ${counted(fresh, GOODS)}, они не отсортированы`,
                    action: 'Досортировать',
                    fresh: true,
                    handler: () => actions.sort()
                });
                site.placeBanner(banner.node);
                ui.showFresh(fresh, banner.node);
            } else {
                ui.render({
                    main: `Отсортировано <b>${counted(lastResult.count, GOODS)}</b>`,
                    sub: `Наверху ${counted(lastResult.top, site.countForms)}. Листайте дальше - сайт догрузит новые`,
                    badgeText: String(lastResult.count),
                    sortText,
                    sorted: true
                });
                banner.node.remove();
                ui.showFresh(0);
            }
            return;
        }
        banner.node.remove();
        ui.showFresh(0);
        site.capture();
        const loaded = site.visibleCount();
        ui.render({
            main: `Загружено <b>${counted(loaded, GOODS)}</b>`,
            sub: 'Сейчас порядок сайта',
            badgeText: loaded ? String(loaded) : '',
            sortText
        });
    },

    // Panel state while the script works on its own: scrolling, waiting for the site.
    showBusy(main, sub = '') {
        ui.render({ main, sub, tone: 'busy', sortText: '' });
    },

    // `auto` - started by the script, not a click; `late` - folding in cards that were already on their way,
    // which must not extend the folding window.
    sort({ scroll = true, auto = false, late = false } = {}) {
        if (!auto) {
            listingGen += 1;
        }
        const result = site.sort();
        if (!result) {
            publish('idle');
            if (!auto) {
                ui.toast('Карточки не найдены - это не страница выдачи');
            }
            return;
        }
        lastResult = result;
        if (!late) {
            lastSortAt = Date.now();
        }
        sortingOn.set(true);
        publish('sorted', result);
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
        sortingOn.set(false);
        lastResult = null;
        publish('idle');
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
        publish('busy');
        if (listingWait) {
            actions.showBusy('Жду новую выдачу', 'Сайт ещё загружает карточки');
            await listingWait;
        }
        listingGen += 1;
        site.restore();
        lastResult = null;
        const totalMs = seconds * 1000;
        const startedAt = Date.now();
        while (!run.stop && Date.now() - startedAt < totalMs) {
            // At the bottom a scroll does not move and fires no event, so the site never asks for the next
            // page: step back to make the following step a real scroll.
            const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
            window.scrollBy(0, atBottom ? -window.innerHeight : Math.max(400, window.innerHeight * 0.8));
            site.capture();
            const remaining = Math.max(0, totalMs - (Date.now() - startedAt));
            ui.setBusy(remaining, totalMs);
            actions.showBusy(`Листаю, ещё <b>${Math.ceil(remaining / 1000)} с</b>`, `Загружено ${counted(site.visibleCount(), GOODS)}`);
            await wait(280);
        }
        scrollRun = null;
        ui.setBusy(null);
        if (run.cancelled) {
            publish('idle');
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
        settlingGen = gen;
        const wasSorted = site.isSorted() || Boolean(scrollRun) || sortingOn.get();
        actions.cancelScroll();
        site.restore();
        lastResult = null;
        banner.node.remove();
        ui.showFresh(0);
        publish('busy');
        actions.showBusy('Сайт обновляет выдачу', wasSorted && ui.keepSorted() ? 'Отсортирую, когда загрузится' : '');
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
        settlingGen = -1;
        site.reset();
        site.capture();
        if (scrollRun) {
            return;
        }
        if (wasSorted && ui.keepSorted() && site.visibleCount() > 0) {
            actions.sort({ scroll: false, auto: true });
        } else {
            publish('idle');
            actions.refresh();
        }
    },

    // An address with ?sulimarket sorts what the site loaded, ?sulimarket=10 loads for 10 s and then sorts:
    // an agent or a bookmark gets a sorted listing without a click. Ozon redirects a search to a category and
    // keeps the query but drops the #fragment, so the fragment form (#sulimarket=10) serves an open page only.
    async runAddressCommand({ fromHash = false } = {}) {
        const query = new URLSearchParams(location.search).get(COMMAND_PARAM);
        const hash = location.hash.match(/^#sulimarket(?:=(\d+))?$/);
        const value = fromHash ? hash && (hash[1] || '') : query ?? (hash && (hash[1] || ''));
        if (value === null || !/^\d*$/.test(value)) {
            return false;
        }
        const seconds = Math.min(MAX_SCROLL_SECONDS, Number(value || 0));
        publish('busy');
        const deadline = Date.now() + RESULTS_WAIT_MS;
        let signature = '';
        let stableSince = Date.now();
        while (Date.now() < deadline) {
            await wait(250);
            const next = site.keySignature();
            if (next !== signature) {
                signature = next;
                stableSince = Date.now();
            } else if (next !== '' && Date.now() - stableSince >= RESULTS_QUIET_MS) {
                break;
            }
        }
        if (listingWait) {
            await listingWait;
        }
        if (seconds) {
            actions.scrollAndSort(seconds);
        } else {
            actions.sort({ scroll: false });
        }
        return true;
    }
};

const ui = createUi();

let captureTimer = 0;
new MutationObserver(records => {
    if (site.isSorted()) {
        site.hideSorted();
    }
    if (captureTimer || scrollRun || records.every(record => site.isOwnNode(record.target))) {
        return;
    }
    captureTimer = setTimeout(() => {
        captureTimer = 0;
        site.capture();
        if (site.isSorted() && site.unsortedCount() && Date.now() - lastSortAt < LATE_CARDS_MS) {
            actions.sort({ scroll: false, auto: true, late: true });
        } else {
            actions.refresh();
        }
    }, 300);
}).observe(document.body, { childList: true, subtree: true });

// SSMarket 2.x is the same product under its old name; Tampermonkey installs SuliMarket next to it instead of
// over it. Its button would sit on top of ours, so it is taken off the page and the user is told once.
function retireOldScript() {
    const old = document.getElementById('ssmarket-ui');
    if (!old) {
        return;
    }
    old.remove();
    if (!sessionStorage.getItem('sulimarket:old-told')) {
        sessionStorage.setItem('sulimarket:old-told', '1');
        ui.toast('Старый SSMarket ещё стоит в Tampermonkey - удалите его там');
    }
}

const offers = site.id === 'ozon' ? createOzonOffers() : createWbSellers();

// The site's own window (sign-in, all filters) is a fixed layer over the whole screen; the button would float
// above its shade, so it steps aside while the window is open.
function siteDialogOpen() {
    for (let node = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2); node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).position === 'fixed') {
            const box = node.getBoundingClientRect();
            return box.width >= window.innerWidth * 0.9 && box.height >= window.innerHeight * 0.9;
        }
    }
    return false;
}

setInterval(() => {
    retireOldScript();
    offers.check();
    // The site re-drew the sorted list without changing the listing: sort it again, the user asked for it.
    if (site.heal()) {
        lastResult = null;
        if (sortingOn.get()) {
            actions.sort({ scroll: false, auto: true });
        } else {
            actions.refresh();
        }
    }
    ui.setVisible((site.isListing() || site.isSorted() || Boolean(scrollRun)) && !siteDialogOpen());
    const next = listingKey();
    if (next !== currentListing) {
        currentListing = next;
        actions.onListingChange(lastKeySignature);
    }
    lastKeySignature = site.keySignature();
}, URL_POLL_MS);

ui.setVisible(site.isListing());
retireOldScript();
site.capture();
publish('idle');
actions.refresh();
window.addEventListener('hashchange', () => actions.runAddressCommand({ fromHash: true }));
actions.runAddressCommand().then(started => {
    if (!started && ui.keepSorted() && sortingOn.get()) {
        actions.onListingChange('');
    }
});
