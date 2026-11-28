// SuliMarket core: shared by the Tampermonkey script and the browser extension.
// The build wraps it in a function and passes `store` - a synchronous key-value store of the host.
const VERSION = '__VERSION__';
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
// ?sulimarket-min=200: after the seconds, keep loading until this many cards (up to MAX_SCROLL_SECONDS).
const MIN_PARAM = 'sulimarket-min';
const MAX_MIN_CARDS = 5000;
// No new card for this long while the page keeps reaching its bottom: the listing has ended.
const END_QUIET_MS = 10000;
const BOTTOM_RECENT_MS = 2000;

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

const MONTHS = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря';
// The delivery line of a card: "Завтра", "Послезавтра", "4 декабря", "Через 3 дня".
const DELIVERY = new RegExp(`^(сегодня|завтра|послезавтра|через \\d+ (?:дн|час)\\S*|\\d{1,2} (?:${MONTHS})(?: \\d{4})?)$`, 'i');
// Wildberries prints the wallet price first and says so in a line of its own.
const PRICE_NOTE = /^с (?:WB Кошельком|Ozon Картой)$/i;

// Title, address, prices and delivery of a card for the machine-readable result. The title is the longest wordy
// text inside the product links: the counts and the price there carry no three letters in a row or are shorter.
// The site prints the current price first and the price before the discount after it.
function describeCard(node) {
    const link = node.querySelector(PRODUCT_LINKS);
    const url = link ? new URL(link.getAttribute('href'), location.origin) : null;
    const texts = leafTexts(node);
    const prices = texts.filter(text => PRICE.test(text)).map(parseCount);
    const price = prices.length ? prices[0] : null;
    const oldPrice = Math.max(0, ...prices.slice(1));
    const linkTexts = Array.from(node.querySelectorAll(PRODUCT_LINKS)).flatMap(leafTexts);
    const title = (linkTexts.length ? linkTexts : texts)
        .filter(text => /[a-zа-яё]{3}/i.test(text) && !PRICE.test(text))
        .sort((a, b) => b.length - a.length)[0] || '';
    const id = url?.pathname.match(/\/catalog\/(\d+)\//)?.[1] || url?.pathname.match(/(\d+)\/?$/)?.[1] || null;
    // Wildberries: "ZETTER", "/", "Швабра ..." - the brand stands before the slash.
    const slash = texts.indexOf('/');
    const shop = node.querySelector('[data-ssm-shop][data-ssm-seller]')?.dataset;
    const card = {
        id,
        title: title.replace(/^\/\s*/, ''),
        url: url ? url.origin + url.pathname : '',
        price,
        oldPrice: price && oldPrice > price ? oldPrice : null,
        priceNote: texts.find(text => PRICE_NOTE.test(text)) || null,
        delivery: texts.find(text => DELIVERY.test(text)) || null,
        brand: slash > 0 ? texts[slash - 1] : null
    };
    if (shop) {
        card.seller = {
            name: shop.ssmSeller,
            rating: Number(shop.ssmRating) || null,
            sales: shop.ssmSales === '' ? null : Number(shop.ssmSales),
            since: shop.ssmSince || null
        };
    }
    return card;
}

function listingKey() {
    const params = new URLSearchParams(location.search);
    [...PAGING_PARAMS, COMMAND_PARAM, MIN_PARAM].forEach(name => params.delete(name));
    params.sort();
    return `${location.pathname}?${params}`;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeButton(label, { variant, size, shape, icon, className = '' } = {}) {
    return `<ed-button ${variant ? `variant="${variant}"` : ''} ${size ? `size="${size}"` : ''} ${shape ? `shape="${shape}"` : ''}><button type="button" class="${className}">${icon || ''}${label}</button></ed-button>`;
}

const resortButton = () => makeButton('Досортировать', { variant: 'brand' });

// A strip on the page itself (between sorted and fresh cards, or under the sorted list) with one action.
function createPageBanner() {
    const node = document.createElement('div');
    node.dataset.ssmBanner = '1';
    node.dataset.ssmUi = '';
    node.innerHTML = `<span></span>${resortButton()}`;
    const label = node.firstElementChild;
    const button = node.querySelector('button');
    let onClick;
    button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return {
        node,
        set({ text, action, fresh, handler }) {
            onClick = handler;
            if (label.textContent !== text) label.textContent = text;
            if (button.textContent !== action) button.textContent = action;
            node.toggleAttribute('data-fresh', fresh);
        }
    };
}

const SELLER_EMPTY = 'Нет данных о магазине';
const SELLER_ERROR = 'Не удалось загрузить сведения. Обновите страницу.';
const SELLER_LOADING = 'Магазин: загружаю данные';

function makeShopLine(compact = false) {
    const line = document.createElement('div');
    line.dataset.ssmShop = '1';
    line.toggleAttribute('data-compact', compact);
    return line;
}

function shopSummary(line, { facts = [], warning = '', text }) {
    const summary = text ? `Магазин: ${text}` : `Магазин: ${facts.join(' · ')}${warning ? ` · ${warning}` : ''}`;
    line.dataset.tone = text === SELLER_ERROR ? 'error' : warning ? 'warning' : '';
    if (line.textContent !== summary) line.textContent = summary;
}

let tooltipId = 0;
let lastTooltip = -Infinity;
function addTooltip(control, message) {
    const tip = document.createElement('span');
    tip.id = `sulimarket-tip-${++tooltipId}`;
    tip.className = 'ssm-tooltip';
    tip.dataset.ssmUi = '';
    tip.popover = 'manual';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = message;
    control.setAttribute('aria-describedby', tip.id);
    control.after(tip);
    let pending;
    function close() {
        clearTimeout(pending);
        if (tip.matches(':popover-open')) {
            tip.hidePopover();
            lastTooltip = performance.now();
        }
        document.removeEventListener('scroll', close, true);
        document.removeEventListener('keydown', escape, true);
    }
    function escape(event) {
        if (event.key === 'Escape') close();
    }
    function enter(event) {
        if (event.pointerType === 'touch') return;
        clearTimeout(pending);
        if (tip.matches(':popover-open')) return;
        document.addEventListener('scroll', close, { capture: true, passive: true });
        document.addEventListener('keydown', escape, true);
        pending = setTimeout(() => {
            if (tip.isConnected) tip.showPopover({ source: control });
            else close();
        }, performance.now() - lastTooltip < 300 ? 0 : 700);
    }
    function leave(event) {
        if (event.relatedTarget !== tip && event.relatedTarget !== control) close();
    }
    control.addEventListener('pointerenter', enter);
    control.addEventListener('pointerleave', leave);
    control.addEventListener('focus', enter);
    control.addEventListener('blur', close);
    control.addEventListener('click', close);
    tip.addEventListener('pointerleave', leave);
    tip.addEventListener('pointerenter', () => clearTimeout(pending));
}

function sellerSortControl(metric, sort) {
    const holder = document.createElement('span');
    holder.dataset.ssmUi = '';
    holder.dataset.ssmOffers = '';
    const title = `По ${metric}`;
    holder.innerHTML = `${makeButton(`${ICON_SORT}<span>${title}</span>`, { size: 'main' })}<span data-ssm-offers-progress role="status"></span>`;
    const button = holder.querySelector('button');
    button.dataset.ssmOffersSort = '1';
    let run = null;
    function render(selected, count, progress, fresh = false) {
        button.firstElementChild.setAttribute('aria-hidden', 'true');
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-busy', String(Boolean(progress)));
        if (selected) button.parentElement.setAttribute('variant', 'brand');
        else button.parentElement.removeAttribute('variant');
        button.lastElementChild.textContent = progress ? 'Остановить' : fresh ? `Досортировать +${formatNumber(count)}` : count ? `${title}: ${formatNumber(count)}` : title;
        holder.lastElementChild.textContent = progress || '';
    }
    button.addEventListener('click', async event => {
        event.preventDefault();
        event.stopPropagation();
        if (run) {
            run.stop();
            return;
        }
        let stop;
        const stopped = new Promise(resolve => { stop = resolve; });
        const current = { stopped, stop, cancelled: false };
        run = current;
        try {
            await sort(current);
        } finally {
            run = null;
            if (current.cancelled || button.getAttribute('aria-busy') === 'true') render(false);
        }
    });
    render(false);
    addTooltip(button, `SuliMarket: сначала продавцы с большим числом ${metric === 'отзывам' ? 'отзывов' : 'оценок'}`);
    return {
        holder,
        render,
        working: () => Boolean(run),
        cancel() {
            if (run) {
                run.cancelled = true;
                run.stop();
            }
            render(false);
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
        countForms: REVIEWS,
        // The strip ends the sorted list; the site's own list with the fresh cards follows it.
        placeBanner(node) {
            const root = document.getElementById(ROOT_ID);
            if (root && node.parentElement !== root) {
                root.appendChild(node);
            }
        },
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
        countForms: RATINGS,
        // Colours of the site as of 19.10.2026 (buttons rgb(167, 58, 253)).
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
    let control = null;
    let sorted = false;
    let productSeen = { id: '', since: 0, asked: false };
    const rowsWatch = new MutationObserver(() => placeTail());
    // While "По отзывам" scrolls the window to load all sellers, rows only fly past and are not asked about.
    const visible = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting && !control?.working()) {
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
            line = makeShopLine();
            line.textContent = SELLER_LOADING;
            infoColumn(row).appendChild(line);
        }
        return line;
    }

    function drawShop(row, shop) {
        const line = shopLine(row);
        if (!shop) {
            shopSummary(line, { text: SELLER_ERROR });
            return;
        }
        const parts = [];
        if (shop.rating) parts.push(`Оценка ${shop.rating.replace('.', ',')}`);
        if (shop.reviews) parts.push(compactCount(readShort(shop.reviews), REVIEWS));
        if (shop.orders) parts.push(compactCount(readShort(shop.orders), ['заказ', 'заказа', 'заказов']));
        if (shop.age) parts.push(`${shop.age} на Ozon`);
        const warning = shop.orders && readShort(shop.orders) < FEW_ORDERS ? 'мало заказов' : '';
        shopSummary(line, { facts: parts, warning, text: parts.length ? '' : SELLER_EMPTY });
        line.dataset.ssmReviews = String(readShort(shop.reviews));
    }

    function makeButton(switcher) {
        control = sellerSortControl('отзывам', sortRows);
        const { holder } = control;
        switcher.appendChild(holder);
        // A site tab ("Быстрее доставка", "Ниже цена") gives the order back to the site.
        switcher.addEventListener('click', event => {
            if (holder.isConnected && !holder.contains(event.target)) unsort();
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
    async function loadAll(run, source) {
        const box = scroller();
        const startedAt = Date.now();
        let count = rows().length;
        let grewAt = Date.now();
        while (box?.isConnected && !run.cancelled && !run.stopping && Date.now() - startedAt < LOAD_ALL_MS && Date.now() - grewAt < LOAD_STEP_MS) {
            box.scrollTop = box.scrollHeight;
            await Promise.race([wait(250), run.stopped]);
            const next = rows().length;
            if (next !== count) {
                count = next;
                grewAt = Date.now();
                if (run.cancelled || run.stopping) return;
                source.render(sorted, 0, `Загружено ${counted(count, ['продавец', 'продавца', 'продавцов'])}`);
            }
        }
    }

    async function sortRows(run) {
        const source = control;
        const box = rowsBox();
        run.stopped.then(() => { run.stopping = true; });
        source.render(sorted, 0, 'Загружаю продавцов');
        await loadAll(run, source);
        if (run.cancelled || !box?.isConnected || box !== rowsBox() || source !== control) return;
        const all = rows();
        source.render(sorted, 0, 'Смотрю магазины');
        await Promise.race([Promise.all(all.slice(0, STATS_FOR_SORT).map(shopOf)), run.stopped]);
        if (run.cancelled || !box.isConnected || box !== rowsBox() || source !== control) return;
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
        source.render(true, all.length);
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
            control.render(true, fresh, '', true);
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
        control?.cancel();
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
        link.dataset.ssmUi = '';
        link.href = address;
        link.target = '_blank';
        link.rel = 'noopener';
        link.innerHTML = `<span class="ssm-seller-icon">${ICON_SORT}</span><span><span class="ssm-seller-caption">Другие продавцы - ${counted(sellers.length, ['предложение', 'предложения', 'предложений'])}</span><br><b></b></span>`;
        link.querySelector('b').textContent = price ? `от ${price}` : 'смотреть';
        priceBox.appendChild(link);
        addTooltip(link, 'Ozon не показал кнопку "Есть дешевле" на этой странице');
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
                if (control && !control.holder.isConnected) {
                    control.cancel();
                    control = null;
                    sorted = false;
                    rowsWatch.disconnect();
                }
                return;
            }
            if (!control || !control.holder.isConnected) {
                control?.cancel();
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
    const FACTS_BATCH = 50;
    const FACTS_GATHER_MS = 600;
    const SORT_WAIT_MS = 6000;
    // Same pace as on Ozon: two requests at a time with a pause, under ~8 a second.
    const FETCHES_AT_ONCE = 2;
    const FETCH_PAUSE_MS = 200;
    const TAIL_ORDER = 100000;

    const memo = new Map();
    const queue = [];
    const asked = new Map();
    let fetching = 0;
    let gatherTimer = 0;
    let control = null;
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
                        sales: typeof shop.saleItemQuantity === 'number' ? shop.saleItemQuantity : null,
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

    function age(since) {
        const months = Math.floor((Date.now() - Date.parse(since)) / (30.44 * 24 * 3600 * 1000));
        if (!(months >= 1)) {
            return 'меньше месяца';
        }
        return months < 12 ? counted(months, ['месяц', 'месяца', 'месяцев'])
            : counted(Math.floor(months / 12), ['год', 'года', 'лет']);
    }

    const SALES = ['продажа', 'продажи', 'продаж'];

    function shopFacts(shop, { rating = false, ratings = false, year = false } = {}) {
        const out = [];
        if (rating && shop.rating) out.push(`Оценка ${String(shop.rating).replace('.', ',')}`);
        if (ratings && shop.ratings) out.push(compactCount(shop.ratings, RATINGS));
        if (shop.sales != null) out.push(compactCount(shop.sales, SALES));
        if (shop.since) out.push(year ? `На WB с ${shop.since.slice(0, 4)} года` : `${age(shop.since)} на WB`);
        return out;
    }

    function warning(shop) {
        return shop.sales != null && shop.sales < FEW_SALES ? 'мало продаж' : '';
    }

    function fill(line, shop, options) {
        if (!shop) {
            shopSummary(line, { text: SELLER_EMPTY });
            return;
        }
        const facts = shopFacts(shop, options);
        shopSummary(line, { facts, warning: warning(shop), text: facts.length ? '' : SELLER_EMPTY });
    }

    // Results use a native disclosure: the full name and every available fact can be read with a keyboard or touch.
    function showTileShop(line, shop, name) {
        fill(line, shop, { rating: true, year: true });
        if (!shop || !name) return;
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = `${name} · ${shopFacts(shop, { rating: true, year: true }).join(' · ')}`.replace(/ · $/, '');
        const list = document.createElement('ul');
        const facts = shopFacts(shop, { rating: true, ratings: true });
        if (warning(shop)) facts.push(warning(shop));
        for (const fact of facts) {
            const item = document.createElement('li');
            item.textContent = fact;
            list.appendChild(item);
        }
        if (!facts.length) {
            const item = document.createElement('li');
            item.textContent = SELLER_EMPTY;
            list.appendChild(item);
        }
        details.append(summary, list);
        line.replaceChildren(details);
    }

    async function tileShop(card) {
        const nm = card.dataset.nmId;
        const title = card.querySelector(CARD_TITLE);
        if (!title) return;
        card.dataset.ssmShopDrawn = nm;
        const line = card.querySelector('[data-ssm-shop]') || makeShopLine(true);
        line.textContent = SELLER_LOADING;
        line.dataset.tone = '';
        for (const key of ['ssmSeller', 'ssmRating', 'ssmSales', 'ssmSince']) delete line.dataset[key];
        const titleLink = title.closest('a');
        const anchor = titleLink && card.contains(titleLink) ? titleLink : title;
        if (!line.isConnected) anchor.after(line);
        try {
            const id = await sellerOfCard(card);
            const [shop, name] = id ? await Promise.all([facts(String(id)), shopName(id).catch(() => '')]) : [null, ''];
            if (card.dataset.nmId !== nm) return;
            showTileShop(line, shop, name);
            if (!shop) return;
            Object.assign(line.dataset, {
                ssmSeller: name || String(id),
                ssmRating: String(shop.rating || ''),
                ssmSales: shop.sales == null ? '' : String(shop.sales),
                ssmSince: shop.since || ''
            });
        } catch {
            if (card.dataset.nmId === nm) shopSummary(line, { text: SELLER_ERROR });
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
        const line = makeShopLine();
        line.textContent = SELLER_LOADING;
        anchor.after(line);
        facts(id).then(shop => {
            if (box.dataset.ssmSeller === id) fill(line, shop, { ratings: true });
        }, () => {
            if (box.dataset.ssmSeller === id) shopSummary(line, { text: SELLER_ERROR });
        });
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
        if (!id) return Promise.resolve(null);
        const link = row.querySelector(SELLER_LINK);
        const column = link.querySelector('[class*="wrapper"]') || link;
        const old = row.querySelector('[data-ssm-shop]');
        const line = old || makeShopLine();
        if (!old) {
            line.textContent = SELLER_LOADING;
            column.appendChild(line);
        }
        return facts(id).then(shop => {
            if (rowSeller(row) === id) {
                row.dataset.ssmRatings = String(shop?.ratings ?? 0);
                fill(line, shop);
            }
            return shop;
        }, () => {
            if (rowSeller(row) === id) shopSummary(line, { text: SELLER_ERROR });
            return null;
        });
    }

    function siteSortButtons() {
        return Array.from(document.querySelectorAll('button')).filter(node => SITE_SORT.includes(node.textContent.trim()));
    }

    function makeButton(siteButton) {
        const item = siteButton.closest('li') || siteButton;
        const list = item.parentElement;
        control = sellerSortControl('оценкам', sortRows);
        const { holder } = control;
        if (item === siteButton) {
            item.after(holder);
        } else {
            const entry = document.createElement('li');
            entry.dataset.ssmOffersItem = '';
            entry.append(holder);
            list.append(entry);
        }
        list.addEventListener('click', event => {
            if (holder.isConnected && !holder.contains(event.target)) unsort();
        }, true);
    }

    async function sortRows(run) {
        const all = rows();
        if (!all.length) return;
        const source = control;
        const box = all[0].parentElement;
        source.render(sorted, 0, 'Смотрю магазины');
        await Promise.race([Promise.all(all.map(rowShop)), wait(SORT_WAIT_MS), run.stopped]);
        if (run.cancelled || !box.isConnected || source !== control) return;
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
        source.render(true, all.length);
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
            control.render(true, fresh, '', true);
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
        control?.cancel();
    }

    function checkOffersPage() {
        if (!OFFERS_PAGE.test(location.pathname)) {
            if (control) {
                control.cancel();
                control.holder.closest('[data-ssm-offers-item]')?.remove();
                control.holder.remove();
                control = null;
                sorted = false;
                rowsWatch.disconnect();
            }
            return;
        }
        const siteButton = siteSortButtons()[0];
        if (siteButton && (!control || !control.holder.isConnected)) {
            control?.cancel();
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

const themeStyle = document.createElement('style');
themeStyle.id = 'sulimarket-theme';
themeStyle.textContent = marketCss.page;
document.documentElement.appendChild(themeStyle);

// ------------------------------------------------------------------ UI
const ICON_SORT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h11M4 12h8M4 18h5"/><path d="M18 5v14M15 16l3 3 3-3"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_PLAY = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M5 2.5v13L15 9Z" fill="currentColor"/></svg>';
const ICON_UNDO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/></svg>';
const DEFAULT_OFFSET = { right: 24, bottom: 68 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function createUi() {
    const host = document.createElement('div');
    host.id = 'sulimarket-ui';
    host.style.cssText = 'position: fixed; z-index: 2147483000; top: 0; left: 0; width: 0; height: 0;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>${marketCss.shadow}</style>
        <div class="edge-probe" hidden></div>
        <button class="fab" type="button" aria-label="SuliMarket: сортировка" aria-expanded="false" aria-controls="sulimarket-panel">
            ${ICON_SORT}
            <svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="25"/><circle class="progress" cx="27" cy="27" r="25"/></svg>
            <span class="badge" aria-hidden="true"></span>
        </button>
        <div id="sulimarket-panel" class="panel" role="dialog" aria-label="SuliMarket" inert>
            <div class="head">
                <span class="title">SuliMarket</span><span class="chip">${site.name}</span>
                <span class="close-host">${makeButton(ICON_CLOSE, { variant: 'ghost', size: 'icon', className: 'close' })}</span>
            </div>
            <div class="status" role="status"><div class="status-main"></div><div class="status-sub"></div></div>
            ${makeButton(`${ICON_SORT}<span class="sort-label"></span>`, { variant: 'brand', size: 'main', className: 'sort' })}
            ${makeButton('Хватит, сортировать', { variant: 'brand', size: 'main', className: 'stop' })}
            <fieldset class="load-settings">
                <legend>Догрузить и отсортировать</legend>
                <div class="load-controls">
                    <div class="seg ed-segment" role="group" aria-label="Время догрузки" data-accent="brand">
                        ${SCROLL_PRESETS.map(seconds => `<button class="preset ed-segment-option" type="button" data-seconds="${seconds}" aria-pressed="false">${seconds} с</button>`).join('')}
                    </div>
                    <label class="custom"><span class="time-label">Секунды</span>
                        <input class="ed-field" type="number" min="1" max="${MAX_SCROLL_SECONDS}" step="1" aria-describedby="sulimarket-seconds-error" inputmode="numeric">
                    </label>
                    <span class="play-host">${makeButton(ICON_PLAY, { variant: 'brand', size: 'icon', shape: 'round', className: 'play' })}</span>
                </div>
                <p id="sulimarket-seconds-error" class="field-error" role="alert" hidden></p>
            </fieldset>
            <div class="foot">
                ${makeButton(`${ICON_UNDO}<span>Как было</span>`, { className: 'undo' })}
                <label class="toggle ed-check"><input type="checkbox" class="keep ed-switch" role="switch" aria-label="Держать сортировку" aria-describedby="sulimarket-setting-note"><span>Держать</span></label>
            </div>
            <div id="sulimarket-setting-note" class="setting-note">Применяется сразу</div>
            <details class="panel-info"><summary>О расширении</summary><span class="ver">v${VERSION}</span></details>
        </div>
        <div class="caret" aria-hidden="true"></div>
        <div class="bottom-fade" hidden></div>
        <div class="toast" inert><span class="toast-text"></span>
            ${makeButton(ICON_CLOSE, { variant: 'ghost', size: 'icon', className: 'toast-close' })}
        </div>
        <div class="pill" inert><span class="pill-text" role="status"></span>${resortButton()}</div>
    `;
    const spacer = document.createElement('div');
    spacer.dataset.ssmBottomSpacer = '';
    spacer.setAttribute('aria-hidden', 'true');
    document.body.append(host, spacer);
    const $ = selector => shadow.querySelector(selector);
    const fab = $('.fab');
    const panel = $('.panel');
    const sort = $('.sort');
    const stop = $('.stop');
    const undo = $('.undo');
    const close = $('.close');
    const toastNode = $('.toast');
    const toastText = $('.toast-text');
    const toastClose = $('.toast-close');
    const caret = $('.caret');
    const customInput = $('.custom input');
    const play = $('.play');
    const keepInput = $('.keep');
    const settings = $('.load-settings');
    const progress = $('.ring .progress');
    const pill = $('.pill');
    const ringLength = 2 * Math.PI * 25;
    let busy = false;
    let badgeText = '';
    let currentLabel = '';
    let freshCount = 0;
    let stripOnScreen = false;
    let strip;
    let toastTimer;
    stop.hidden = true;
    close.setAttribute('aria-label', 'Закрыть');
    play.setAttribute('aria-label', 'Догрузить заданное число секунд и отсортировать');
    toastClose.setAttribute('aria-label', 'Закрыть сообщение');
    addTooltip(fab, `Сортировка по ${site.countWord}. Кнопку можно перетащить`);
    progress.style.strokeDasharray = String(ringLength);

    const positionKey = `position:${site.id}`;
    let position = store.get(positionKey, null);

    function bounds() {
        const style = getComputedStyle($('.edge-probe'));
        const size = fab.offsetWidth || (matchMedia('(pointer: coarse)').matches ? 44 : 40);
        const left = parseFloat(style.paddingLeft);
        const top = parseFloat(style.paddingTop);
        const right = parseFloat(style.paddingRight);
        const bottom = parseFloat(style.paddingBottom);
        const width = document.documentElement.clientWidth;
        const height = window.innerHeight;
        return { left, top, right, bottom, size, width, height,
            maxX: Math.max(0, width - left - right - size), maxY: Math.max(0, height - top - bottom - size) };
    }

    function fabBox(windowBox = bounds()) {
        const { left, top, maxX, maxY } = windowBox;
        const x = position ? position.fx * maxX : maxX - DEFAULT_OFFSET.right;
        const y = position ? position.fy * maxY : maxY - DEFAULT_OFFSET.bottom;
        return { x: left + Math.max(0, x), y: top + Math.max(0, y) };
    }

    function placePanel(windowBox = bounds()) {
        if (!panel.classList.contains('open')) return;
        const { left, top, right, bottom, size, width, height } = windowBox;
        const { x, y } = fabBox(windowBox);
        const panelWidth = panel.offsetWidth;
        const wanted = x > width / 2 ? x + size - panelWidth : x;
        panel.style.left = `${Math.max(left, Math.min(wanted, width - panelWidth - right))}px`;
        const gap = 6;
        const above = y - gap - top;
        const below = height - y - size - gap - bottom;
        caret.classList.toggle('above', above >= below);
        caret.classList.toggle('below', below > above);
        caret.style.left = `${x + size / 2 - 4}px`;
        caret.style.top = `${above >= below ? y - gap - 4 : y + size + gap - 4}px`;
        panel.style.maxHeight = `${Math.max(above, below)}px`;
        panel.style.bottom = above >= below ? `${height - y + gap}px` : '';
        panel.style.top = above >= below ? '' : `${y + size + gap}px`;
    }

    function placeFab() {
        const { x, y } = fabBox();
        fab.style.left = `${x}px`;
        fab.style.top = `${y}px`;
        placePanel();
    }

    function syncBottom() {
        const open = panel.classList.contains('open');
        if (strip) {
            if (open && document.activeElement === strip.querySelector('button')) close.focus({ preventScroll: true });
            strip.toggleAttribute('inert', open);
            strip.style.visibility = open ? 'hidden' : '';
        }
        const hasToast = toastNode.classList.contains('show');
        const showPill = freshCount > 0 && !open && !stripOnScreen;
        pill.classList.toggle('show', showPill);
        pill.inert = !showPill;
        $('.bottom-fade').hidden = !showPill;
        const pillClearance = showPill ? pill.offsetHeight + 8 : 0;
        toastNode.style.setProperty('--ssm-pill-clearance', `${pillClearance}px`);
        const reservedHeight = (hasToast ? toastNode.offsetHeight : 0) + pillClearance;
        spacer.style.height = reservedHeight ? `${Math.ceil(reservedHeight + bounds().bottom)}px` : '0';
    }

    function setOpen(open, restore = false) {
        if (panel.classList.contains('open') === open) return;
        panel.classList.toggle('open', open);
        panel.inert = !open;
        caret.classList.toggle('open', open);
        fab.setAttribute('aria-expanded', String(open));
        if (open) {
            placePanel();
            actions.refresh();
            close.focus({ preventScroll: true });
        } else if (restore) {
            fab.focus({ preventScroll: true });
        }
        updateBadge();
        syncBottom();
    }

    let drag;
    let ignoreClick = false;
    fab.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        ignoreClick = false;
        drag = { startX: event.clientX, startY: event.clientY, origin: fabBox(), moved: false };
        fab.setPointerCapture(event.pointerId);
    });
    function endDrag() {
        if (drag?.moved) store.set(positionKey, position);
        drag = null;
        fab.classList.remove('dragging');
    }
    fab.addEventListener('pointercancel', endDrag);
    fab.addEventListener('lostpointercapture', endDrag);
    fab.addEventListener('pointermove', event => {
        if (!drag || !event.buttons) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;
        fab.classList.add('dragging');
        const { left, top, maxX, maxY } = bounds();
        position = {
            fx: maxX ? Math.min(1, Math.max(0, (drag.origin.x + dx - left) / maxX)) : 0,
            fy: maxY ? Math.min(1, Math.max(0, (drag.origin.y + dy - top) / maxY)) : 0
        };
        placeFab();
    });
    fab.addEventListener('pointerup', () => {
        ignoreClick = Boolean(drag?.moved);
        endDrag();
    });
    fab.addEventListener('click', event => {
        if (event.detail && ignoreClick) {
            ignoreClick = false;
            return;
        }
        setOpen(!panel.classList.contains('open'), true);
    });

    close.addEventListener('click', () => setOpen(false, true));
    sort.addEventListener('click', () => actions.sort());
    stop.addEventListener('click', () => actions.stopScroll());
    undo.addEventListener('click', () => actions.restore());
    const presets = shadow.querySelectorAll('.preset');
    const updateDuration = () => markDuration(presets, customInput, lastDuration(store));
    function load(seconds, custom) {
        if (busy) return;
        rememberDuration(store, seconds, custom);
        updateDuration();
        actions.scrollAndSort(seconds);
    }
    presets.forEach(button => button.addEventListener('click', () => load(Number(button.dataset.seconds), false)));
    customInput.value = lastDuration(store).customSeconds || '';
    updateDuration();
    wireCustomTime(customInput, play, $('.field-error'), seconds => load(seconds, true));
    keepInput.checked = store.get('keepSorted', true);
    keepInput.addEventListener('change', () => store.set('keepSorted', keepInput.checked));

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && panel.classList.contains('open')) {
            event.preventDefault();
            setOpen(false, true);
        }
    });
    document.addEventListener('pointerdown', event => {
        if (!event.composedPath().includes(host)) setOpen(false);
    });
    window.addEventListener('resize', () => {
        placeFab();
        syncBottom();
    }, { passive: true });
    placeFab();

    const stripWatch = new IntersectionObserver(entries => {
        if (entries.at(-1).target !== strip) return;
        stripOnScreen = entries.at(-1).isIntersecting;
        syncBottom();
    });
    pill.querySelector('button').addEventListener('click', () => {
        actions.sort();
        if (pill.inert) fab.focus({ preventScroll: true });
    });

    function updateBadge() {
        const open = panel.classList.contains('open');
        const badge = $('.badge');
        const text = open || freshCount ? '' : badgeText;
        if (badge.textContent !== text) badge.textContent = text;
        fab.setAttribute('aria-label', currentLabel ? `SuliMarket: ${currentLabel}` : 'SuliMarket: сортировка');
    }
    function dismissToast(restore = false) {
        clearTimeout(toastTimer);
        toastNode.classList.remove('show');
        toastNode.inert = true;
        if (restore) fab.focus({ preventScroll: true });
        syncBottom();
    }
    toastClose.addEventListener('click', () => dismissToast(true));
    toastNode.addEventListener('focusin', () => clearTimeout(toastTimer));

    return {
        setVisible(visible) {
            // Settings hide the launcher and panel. The page strip can still announce unsorted cards.
            const show = visible && store.get('showButton', true);
            fab.hidden = !show;
            if (!show) setOpen(false);
        },
        render({ main, sub = '', sort: label, sorted = false, fresh = 0, count = 0, loading = false, stoppable = false, badge = '' }) {
            const focused = shadow.activeElement;
            busy = loading;
            const statusMain = $('.status-main');
            const statusSub = $('.status-sub');
            if (statusMain.textContent !== main) statusMain.textContent = main;
            if (statusSub.textContent !== sub) statusSub.textContent = sub;
            $('.status').classList.toggle('fresh', Boolean(fresh));
            const sortLabel = $('.sort-label');
            if (sortLabel.textContent !== label) sortLabel.textContent = label;
            sort.hidden = stoppable;
            stop.hidden = !stoppable;
            sort.disabled = loading || !count;
            settings.disabled = loading || !count;
            undo.disabled = !sorted || loading;
            if (panel.classList.contains('open')) {
                if (stoppable && (focused === sort || focused === play || focused === customInput || focused?.matches('.preset'))) stop.focus({ preventScroll: true });
                if (!stoppable && focused === stop) (sort.disabled ? close : sort).focus({ preventScroll: true });
            }
            if (!loading) badgeText = badge;
            currentLabel = [main, sub].filter(Boolean).join('. ');
            updateBadge();
            updateDuration();
        },
        setBusy(remainingMs, totalMs, cards = false) {
            fab.classList.toggle('busy', remainingMs !== null);
            if (remainingMs !== null) {
                const remaining = formatNumber(Math.ceil(remainingMs / 1000));
                badgeText = cards ? `ещё ${counted(Math.ceil(remainingMs / 1000), GOODS)}` : `${remaining} с`;
                progress.style.strokeDashoffset = String(ringLength * (remainingMs / totalMs));
            }
        },
        showFresh(count, currentStrip = null) {
            freshCount = count;
            if (currentStrip !== strip) {
                stripWatch.disconnect();
                strip = currentStrip;
                stripOnScreen = Boolean(strip && strip.getBoundingClientRect().top < window.innerHeight && strip.getBoundingClientRect().bottom > 0);
                if (strip) stripWatch.observe(strip);
            }
            const text = count ? `Ещё ${counted(count, GOODS)} без сортировки` : '';
            const pillText = $('.pill-text');
            if (pillText.textContent !== text) pillText.textContent = text;
            updateBadge();
            syncBottom();
        },
        keepSorted: () => keepInput.checked,
        setKeepSorted(value) { keepInput.checked = value; },
        toast(text, tone = 'info') {
            clearTimeout(toastTimer);
            toastNode.dataset.tone = tone;
            toastText.setAttribute('role', tone === 'error' ? 'alert' : 'status');
            toastNode.classList.add('show');
            toastNode.inert = false;
            toastText.textContent = text;
            syncBottom();
            if (tone === 'info') toastTimer = setTimeout(dismissToast, 5000);
        },
        clearSortError() {
            if (toastNode.dataset.tone === 'error') dismissToast();
        }
    };
}
// ------------------------------------------------------------- actions
let scrollRun = null;
let lastRun = null;
let lastResult = null;
let listingProgress = null;
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
        // How the last timed load went: seconds, min, loaded, end (the listing ran out), stop - why it stopped:
        // "time" (the seconds passed), "min" (enough cards), "end", "limit" (MAX_SCROLL_SECONDS), "user".
        run: result ? lastRun : null,
        items: result ? result.items.map((item, index) => ({
            rank: index + 1,
            ...describeCard(item.node),
            count: item.count,
            rating: item.rating || null
        })) : []
    });
}

function listingState() {
    const sorted = site.isSorted();
    return {
        site: site.id,
        sorted,
        count: sorted && lastResult ? lastResult.count : site.visibleCount(),
        top: sorted && lastResult ? lastResult.top : 0,
        fresh: sorted ? site.unsortedCount() : 0,
        progress: listingProgress,
        stoppable: Boolean(scrollRun && !scrollRun.cancelled)
    };
}

const actions = {
    refresh() {
        if (scrollRun || settlingGen === listingGen) return;
        listingProgress = null;
        site.capture();
        const state = listingState();
        ui.render({ ...state, ...listingCopy(state), badge: state.count ? formatNumber(state.count) : '' });
        if (state.fresh) {
            banner.set({
                text: `Ещё ${counted(state.fresh, GOODS)} без сортировки`,
                action: 'Досортировать',
                fresh: true,
                handler: () => actions.sort()
            });
            site.placeBanner(banner.node);
            ui.showFresh(state.fresh, banner.node);
        } else {
            banner.node.remove();
            ui.showFresh(0);
        }
    },

    showBusy(main, sub = '') {
        listingProgress = { main, sub };
        const state = listingState();
        ui.render({ ...state, ...listingCopy(state), loading: true });
    },

    // `auto` - started by the script, not a click; `late` - folding in cards that were already on their way,
    // which must not extend the folding window.
    // `run` - how the timed load before this sort went, for #sulimarket-result; folding in late cards keeps it.
    sort({ scroll = true, auto = false, late = false, run = null } = {}) {
        if (!auto) {
            listingGen += 1;
        }
        if (!late) {
            lastRun = run;
        }
        const result = site.sort();
        if (!result) {
            publish('idle');
            actions.refresh();
            if (!auto) {
                ui.toast(`Карточки не найдены. ${EMPTY_LISTING}`, 'error');
            }
            return;
        }
        listingProgress = null;
        if (!auto && !late) ui.clearSortError();
        lastResult = result;
        if (!late) {
            lastSortAt = Date.now();
        }
        sortingOn.set(true);
        publish('sorted', result);
        if (!auto && !late) {
            // Only the popup reads this (extension build): it asks for a store rating once, after a few sorts.
            store.set('sortCount', store.get('sortCount', 0) + 1);
        }
        actions.refresh();
        if (scroll) {
            const top = result.anchor.getBoundingClientRect().top + window.scrollY - 140;
            window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion.matches ? 'instant' : 'smooth' });
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
            window.scrollTo({ top: Math.max(0, anchorTop), behavior: reduceMotion.matches ? 'instant' : 'smooth' });
        }
    },

    // Scrolls for `seconds`, then, with `min`, on until `min` cards are loaded; a listing that ran out ends it early,
    // MAX_SCROLL_SECONDS ends it in any case.
    async scrollAndSort(seconds, { min = 0 } = {}) {
        if (scrollRun) {
            return;
        }
        const run = { stop: false, cancelled: false };
        scrollRun = run;
        publish('busy');
        actions.showBusy('Готовлю догрузку');
        if (listingWait) {
            actions.showBusy('Жду новую выдачу', 'Сайт ещё загружает карточки');
            await listingWait;
        }
        listingGen += 1;
        site.restore();
        lastResult = null;
        banner.node.remove();
        ui.showFresh(0);
        const totalMs = seconds * 1000;
        const limitMs = MAX_SCROLL_SECONDS * 1000;
        const startedAt = Date.now();
        let loaded = site.visibleCount();
        let grewAt = startedAt;
        let bottomAt = 0;
        let stop = 'user';
        while (!run.stop) {
            const elapsed = Date.now() - startedAt;
            if (elapsed >= limitMs) {
                stop = 'limit';
                break;
            }
            if (elapsed >= totalMs && !(min && loaded < min)) {
                stop = min && loaded >= min ? 'min' : 'time';
                break;
            }
            if (Date.now() - grewAt >= END_QUIET_MS && Date.now() - bottomAt < BOTTOM_RECENT_MS) {
                stop = 'end';
                break;
            }
            // At the bottom a scroll does not move and fires no event, so the site never asks for the next
            // page: step back to make the following step a real scroll.
            const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
            if (atBottom) {
                bottomAt = Date.now();
            }
            window.scrollBy(0, atBottom ? -window.innerHeight : Math.max(400, window.innerHeight * 0.8));
            site.capture();
            const next = site.visibleCount();
            if (next > loaded) {
                loaded = next;
                grewAt = Date.now();
            }
            if (elapsed < totalMs) {
                const remaining = totalMs - elapsed;
                ui.setBusy(remaining, totalMs);
                actions.showBusy(`Догружаю товары, ещё ${formatNumber(Math.ceil(remaining / 1000))}\u00a0с`, `Загружено ${counted(loaded, GOODS)}`);
            } else {
                // The badge counts down the cards still missing instead of seconds.
                ui.setBusy(Math.max(0, min - loaded) * 1000, min * 1000, true);
                actions.showBusy(`Догружаю ещё ${counted(Math.max(0, min - loaded), GOODS)}`, `Загружено ${counted(loaded, GOODS)}`);
            }
            await wait(280);
        }
        scrollRun = null;
        ui.setBusy(null);
        if (run.cancelled) {
            if (settlingGen !== listingGen) publish('idle');
            actions.refresh();
            return;
        }
        site.capture();
        actions.sort({
            run: {
                seconds: Math.round((Date.now() - startedAt) / 1000),
                min: min || null,
                loaded: site.visibleCount(),
                end: stop === 'end',
                stop
            }
        });
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
        const minValue = fromHash ? null : new URLSearchParams(location.search).get(MIN_PARAM);
        const min = /^\d+$/.test(minValue || '') ? Math.min(MAX_MIN_CARDS, Number(minValue)) : 0;
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
        if (seconds || min) {
            actions.scrollAndSort(seconds, { min });
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
    if (captureTimer || scrollRun || records.every(({ target }) => site.isOwnNode(target) || target.closest?.('[data-ssm-ui], [data-ssm-shop], #sulimarket-ui'))) {
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
        ui.toast('Откройте Tampermonkey и удалите старый скрипт SSMarket.', 'warning');
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
