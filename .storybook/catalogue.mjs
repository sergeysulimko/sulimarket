// This catalogue carries public source identities only. States select real UI paths in scene.js.
const popupSource = 'src/popup.html';
const coreSource = 'src/core.js';

const story = (source, name, family, slug, scene, target, setup, states = {}, sheet = false) => ({
    source, name, family, slug, scene, target, states: { default: setup, ...states }, sheet
});
const popup = (name, family, slug, setup = 'idle', states = {}, target = name) =>
    story(popupSource, name, family, `popup-${slug}`, 'popup', target, setup, states);
const core = (name, family, slug, target = name, setup = 'panel', states = {}, scene = 'ozon') =>
    story(coreSource, name, family, slug, scene, target, setup, states);
const asset = (file, name, family, slug, target = name) =>
    story(`assets/${file}.html`, name, family, `${file}-${slug}`, file, target, 'default');
const sheet = (...args) => story(...args, true);

export const sceneSizes = {
    popup: [360, 600], promo: [440, 280], social: [1280, 640], icon: [160, 160],
    ozon: [920, 680], wb: [920, 680]
};

export const catalogue = [
    popup('.brand-icon', 'brand', 'brand'),
    popup('#site', 'status', 'site', 'idle', { selected: 'wb' }),
    popup('#status', 'data-state', 'status', 'idle', {
        selected: 'sorted', loading: 'busy', empty: 'empty', error: 'error'
    }),
    popup('#sort', 'button', 'sort', 'idle', { disabled: 'empty', focus: 'idle' }),
    popup('#stop', 'button', 'stop', 'busy'),
    ...[3, 5, 10].map(seconds => popup(`[data-seconds="${seconds}"]`, 'selection',
        `preset-${seconds}`, 'idle', { selected: `preset-${seconds}`, disabled: 'busy', focus: 'idle' })),
    popup('#seconds', 'field', 'seconds', 'idle', { focus: 'custom', disabled: 'busy' }),
    popup('#play', 'button', 'play', 'custom', { focus: 'custom', disabled: 'busy' }),
    popup('#restore', 'button', 'restore', 'sorted', { disabled: 'idle', focus: 'sorted' }),
    popup('#keep', 'selection', 'keep', 'unchecked', { selected: 'idle', focus: 'idle' }, 'label:has(#keep)'),
    popup('#show', 'selection', 'show', 'unchecked', { selected: 'idle', focus: 'idle' }, 'label:has(#show)'),
    popup('#other a[href="https://www.ozon.ru/"]', 'button', 'open-ozon', 'other', { focus: 'other' }),
    popup('#other a[href="https://www.wildberries.ru/"]', 'button', 'open-wb', 'other', { focus: 'other' }),
    popup('#other ol', 'table', 'steps', 'other'),
    popup('#rate-go', 'button', 'rate-go', 'rate', { focus: 'rate' }),
    popup('#rate-skip', 'button', 'rate-skip', 'rate', { focus: 'rate' }),
    popup('#error', 'data-state', 'error', 'error'),
    popup('#review', 'navigation', 'review-link', 'other', { focus: 'other' }),
    popup('footer a[href*="github.com"]', 'navigation', 'source-link', 'other', { focus: 'other' }),
    popup('footer a[href$="/privacy"]', 'navigation', 'privacy-link', 'other', { focus: 'other' }),
    popup('#version', 'type', 'version', 'other'),
    story('src/popup.js', 'strong', 'number', 'popup-result-strong', 'popup', '#status:has(strong)', 'sorted'),

    core('createPageBanner button', 'button', 'banner-action', '[data-ssm-banner] button', 'fresh'),
    core('createOzon.render [data-ssm-key]', 'card', 'ozon-sorted-tile', '[data-ssm-key]:first-child', 'sorted'),
    core('createOzonOffers.shopLine', 'seller-line', 'ozon-shop-line', '[data-ssm-shop]', 'offers',
        { loading: 'offers-loading', error: 'offers-error' }),
    core('createOzonOffers.makeButton', 'selection', 'ozon-seller-sort', '[data-ssm-offers-sort]', 'offers',
        { loading: 'offers-sort-loading', selected: 'offers-sorted' }),
    core('createWbSellers.makeLine', 'seller-line', 'wb-shop-line', '[data-ssm-shop]', 'offers', {}, 'wb'),
    core('createWbSellers.tileShop', 'seller-line', 'wb-tile-shop', '.tile:first-child [data-ssm-shop]', 'listing', {}, 'wb'),
    core('createWbSellers.checkProductSeller', 'seller-line', 'wb-product-shop', '[data-ssm-shop]', 'product', {}, 'wb'),
    core('createWbSellers.rowShop', 'seller-line', 'wb-offer-shop', '[data-ssm-shop]', 'offers', {}, 'wb'),
    core('createWbSellers.makeButton', 'selection', 'wb-seller-sort', '[data-ssm-offers-sort]', 'offers',
        { loading: 'offers-sort-loading', selected: 'offers-sorted' }, 'wb'),
    core('ICON_SORT', 'icon', 'icon-sort', '.fab svg:first-child', 'listing'),
    core('ICON_CLOSE', 'icon', 'icon-close', '.close svg'),
    core('ICON_PLAY', 'icon', 'icon-play', '.play svg'),
    core('ICON_UNDO', 'icon', 'icon-undo', '.undo svg', 'panel-sorted'),
    core('.fab', 'button', 'fab', '.fab', 'listing', { focus: 'listing', selected: 'panel', loading: 'busy' }),
    core('.fab .ring', 'data-state', 'countdown-ring', '.fab .ring', 'busy'),
    core('.fab .badge', 'status', 'fab-badge', '.fab .badge', 'listing',
        { selected: 'sorted', active: 'fresh', loading: 'busy' }),
    core('.panel .chip', 'status', 'panel-site'),
    core('.panel .ver', 'type', 'panel-version', '.panel .ver', 'panel-version'),
    core('.panel .close', 'button', 'panel-close', '.panel .close', 'panel', { focus: 'panel' }),
    core('.panel .status', 'data-state', 'panel-status', '.panel .status', 'panel',
        { loading: 'panel-busy', selected: 'panel-sorted', active: 'panel-fresh' }),
    core('.panel .sort', 'button', 'panel-sort', '.panel .sort', 'panel', { active: 'panel-fresh', focus: 'panel' }),
    core('.panel .stop', 'button', 'panel-stop', '.panel .stop', 'panel-busy'),
    core('.panel .preset', 'selection', 'panel-preset', '.panel .preset', 'panel',
        { selected: 'panel-preset', focus: 'panel' }),
    core('.panel .custom input', 'field', 'panel-seconds', '.panel .custom', 'panel', { focus: 'panel-custom' }),
    core('.panel .play', 'button', 'panel-play', '.panel .play', 'panel-custom', { focus: 'panel-custom' }),
    core('.panel .undo', 'button', 'panel-restore', '.panel .undo', 'panel-sorted',
        { disabled: 'panel', focus: 'panel-sorted' }),
    core('.panel .keep', 'selection', 'panel-keep', '.panel .toggle', 'panel-unchecked',
        { selected: 'panel', focus: 'panel' }),
    core('.caret', 'pin', 'panel-caret', '.caret', 'panel', { active: 'panel-below' }),
    core('.toast', 'notification', 'toast', '.toast', 'toast', { error: 'toast-error' }),
    core('.pill button', 'button', 'fresh-pill-action', '.pill button', 'pill'),

    story('assets/icon.svg', 'svg', 'brand', 'brand-icon', 'icon', 'svg', 'default'),
    asset('promo', '.brand', 'brand', 'brand', '.brand img, .brand h1'),
    asset('promo', 'mark', 'type', 'mark'),
    asset('social', '.brand', 'brand', 'brand'),
    asset('social', 'h1', 'type', 'headline'),
    asset('social', '.annotation', 'icon', 'annotation'),
    ...[2, 3, 4].map(row => asset('social', `.product:nth-of-type(${row})`, 'card', `product-${row - 1}`)),
    asset('social', '.photo', 'card', 'photos'),
    asset('social', '.bars', 'card', 'bars'),
    asset('social', '.count', 'number', 'count'),

    sheet(popupSource, 'header', 'page-header', 'popup-header', 'popup', 'header', 'idle', { selected: 'wb' }),
    sheet(popupSource, '.popup-surface', 'page-frame', 'popup-frame', 'popup', '.popup-surface',
        'idle', { empty: 'other', error: 'error' }),
    sheet('src/popup.css', ':focus-visible', 'focus', 'popup-focus', 'popup', '#sort', 'idle', {}),
    sheet(coreSource, '.panel', 'menu', 'anchored-menu', 'ozon', '.panel, .caret, .fab',
        'panel', { active: 'panel-below' }),
    sheet(coreSource, '.panel[role="dialog"]', 'dialog', 'anchored-dialog', 'ozon', '.panel',
        'panel', { loading: 'panel-busy' }),
    sheet(coreSource, '.fab[aria-expanded]', 'disclosure', 'fab-disclosure', 'ozon', '.fab, .panel',
        'listing', { selected: 'panel' }),
    sheet(coreSource, 'createUi', 'shell', 'market-widget', 'wb', '.panel, .caret, .fab',
        'panel', { loading: 'panel-busy' }),
    sheet(coreSource, 'themeRules token sheet', 'data-theme', 'market-theme', 'ozon', '[data-suite-tokens]',
        'tokens', {}),
    sheet(coreSource, 'STYLE .ring .progress', 'motion', 'countdown-motion', 'ozon', '[data-suite-tokens], .fab',
        'motion', {})
];
