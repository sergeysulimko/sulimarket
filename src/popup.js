const $ = selector => document.querySelector(selector);
const number = value => value.toLocaleString('ru-RU');
const plurals = new Intl.PluralRules('ru');
function word(value, forms) { return forms[plurals.select(value)] || forms.many; }
function counted(value, forms) { return `${number(value)} ${word(value, forms)}`; }
function strong(value) {
    const node = document.createElement('strong');
    node.textContent = number(value);
    return node;
}
// Ask for a store rating once, after the third sort the user asked for; "asked" is saved the moment the ask shows.
const RATE_AFTER_SORTS = 3;
let rateShown = false;
let tabId;
let pendingCount = 0;
let queue = Promise.resolve();

function render(state) {
    $('footer').hidden = true;
    $('#controls').hidden = false;
    $('#other').hidden = true;
    $('#site').hidden = false;
    $('#site').textContent = state.site === 'ozon' ? 'Ozon' : 'Wildberries';
    const countWord = state.site === 'ozon' ? 'отзывам' : 'оценкам';
    $('#sort').textContent = `Сортировать по ${countWord}`;
    $('#status').textContent = state.busy
        ? 'Догружаю товары. Затем отсортирую.'
        : state.sorted
            ? `Отсортировано ${counted(state.count, {one:'товар',few:'товара',many:'товаров'})}. Наверху ${counted(state.top, state.site === 'ozon' ? {one:'отзыв',few:'отзыва',many:'отзывов'} : {one:'оценка',few:'оценки',many:'оценок'})}.`
            : state.count ? `Загружено ${counted(state.count, {one:'товар',few:'товара',many:'товаров'})}. Сейчас порядок сайта.`
                : 'Откройте поиск или категорию товаров в этом магазине.';
    if (state.sorted && !state.busy) {
        $('#status').replaceChildren(
            'Отсортировано ', strong(state.count), ` ${word(state.count, {one:'товар',few:'товара',many:'товаров'})}.`,
            document.createElement('br'), 'Наверху ', strong(state.top),
            ` ${word(state.top, state.site === 'ozon' ? {one:'отзыв',few:'отзыва',many:'отзывов'} : {one:'оценка',few:'оценки',many:'оценок'})}.`
        );
    }
    $('#sort').hidden = state.busy;
    $('#sort').disabled = !state.count;
    $('#stop').hidden = !state.busy;
    $('#loading').disabled = state.busy;
    $('#restore').disabled = !state.sorted || state.busy;
    if (!rateShown && state.sorted && !state.busy && state.sortCount >= RATE_AFTER_SORTS && !state.rateAsked) {
        rateShown = true;
        send('rated');
    }
    $('#rate').hidden = !rateShown;
    $('#keep').checked = state.keepSorted;
    $('#show').checked = state.showButton;
    if (document.activeElement !== $('#seconds')) $('#seconds').value = state.customSeconds || '';
    document.querySelectorAll('[data-seconds]').forEach(button => {
        button.setAttribute('aria-pressed', String(Number(button.dataset.seconds) === state.lastSeconds));
    });
}

function send(command, extra = {}) {
    if (command === 'status' && pendingCount) return Promise.resolve();
    pendingCount += 1;
    queue = queue.then(async () => {
        try {
            const state = await chrome.tabs.sendMessage(tabId, { channel: 'sulimarket:popup', command, ...extra });
            if (state.error) throw new Error(state.error);
            $('#error').hidden = true;
            render(state);
        } catch (error) {
            $('#error').textContent = command === 'status'
                ? 'Обновите страницу магазина, чтобы подключить SuliMarket.' : `Не удалось выполнить действие: ${error.message}`;
            $('#error').hidden = false;
            if (command === 'status' && $('#controls').hidden) $('#status').textContent = 'SuliMarket пока не подключён к этой странице.';
        } finally {
            pendingCount -= 1;
        }
    });
    return queue;
}

$('#rate-go').addEventListener('click', () => { $('#rate').hidden = true; rateShown = false; });
$('#rate-skip').addEventListener('click', () => { $('#rate').hidden = true; rateShown = false; });
$('#sort').addEventListener('click', () => send('sort'));
$('#stop').addEventListener('click', () => send('stop'));
$('#restore').addEventListener('click', () => send('restore'));
$('#keep').addEventListener('change', () => send('keep', { value: $('#keep').checked }));
$('#show').addEventListener('change', () => send('show', { value: $('#show').checked }));
document.querySelectorAll('[data-seconds]').forEach(button => {
    button.addEventListener('click', () => send('load', { seconds: Number(button.dataset.seconds) }));
});
function loadCustom() {
    const input = $('#seconds');
    if (!input.value) { input.focus(); input.reportValidity(); return; }
    if (input.reportValidity()) send('load', { seconds: Number(input.value), custom: true });
}
$('#play').addEventListener('click', loadCustom);
$('#seconds').addEventListener('keydown', event => { if (event.key === 'Enter') loadCustom(); });

async function start() {
    $('#version').textContent = `v${chrome.runtime.getManifest().version}`;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (!tab?.url || !/^https:\/\/www\.(ozon|wildberries)\.ru\//.test(tab.url)) {
        $('#status').textContent = 'SuliMarket работает на Ozon и Wildberries';
        $('#other').hidden = false;
        return;
    }
    await send('status');
    // Popup lifetime owns this timer; loading continues in the content script after it closes.
    setInterval(() => send('status'), 700);
}
start().catch(() => {
    $('#status').textContent = 'Не удалось подключиться к вкладке. Откройте окно расширения ещё раз.';
});
