const $ = selector => document.querySelector(selector);
function countMarkup(count, forms) {
    const formatted = formatNumber(count);
    const node = document.createElement('strong');
    node.textContent = formatted;
    return [node, counted(count, forms).slice(formatted.length)];
}
// Ask for a store rating once, after the third sort the user asked for; "asked" is saved the moment the ask shows.
const RATE_AFTER_SORTS = 3;
let rateShown = false;
let tabId;
let pendingCount = 0;
let queue = Promise.resolve();
let storedCustom;
const secondsInput = $('#seconds');
const presets = document.querySelectorAll('[data-seconds]');

function render(state) {
    $('footer').hidden = true;
    $('#controls').hidden = false;
    $('#other').hidden = true;
    $('#site').hidden = false;
    $('#site').textContent = state.site === 'ozon' ? 'Ozon' : 'Wildberries';
    const focused = document.activeElement;
    const progress = state.progress ?? (state.busy ? { main: 'Догружаю товары. Затем отсортирую.', sub: '' } : null);
    const stoppable = state.stoppable ?? (state.busy && !state.progress);
    const copy = listingCopy({ ...state, progress });
    const sort = $('#sort');
    const stop = $('#stop');
    if (sort.textContent !== copy.sort) sort.textContent = copy.sort;
    const status = $('#status');
    const summary = copy.sub ? `${copy.main}. ${copy.sub}.` : copy.main;
    if (status.dataset.summary !== summary) {
        status.dataset.summary = summary;
        if (state.sorted && !state.busy && !state.fresh) {
            status.replaceChildren('Отсортировано ', ...countMarkup(state.count, GOODS), '.', document.createElement('br'),
                'Наверху ', ...countMarkup(state.top, state.site === 'ozon' ? REVIEWS : RATINGS), '.');
        } else {
            status.textContent = summary;
        }
    }
    sort.hidden = stoppable;
    sort.disabled = state.busy || !state.count;
    stop.hidden = !stoppable;
    $('#loading').disabled = state.busy;
    $('#loading').inert = !state.count && !state.busy;
    $('#restore').disabled = !state.sorted || state.busy;
    if (stoppable && (focused === sort || $('#loading').contains(focused))) stop.focus();
    if (!stoppable && focused === stop) (sort.disabled ? $('#keep') : sort).focus();
    if (!rateShown && state.sorted && !state.busy && state.sortCount >= RATE_AFTER_SORTS && !state.rateAsked) {
        rateShown = true;
        send('rated');
    }
    $('#rate').hidden = !rateShown;
    $('#keep').checked = state.keepSorted;
    $('#show').checked = state.showButton;
    const duration = state.duration ?? { seconds: state.lastSeconds, custom: false, customSeconds: state.customSeconds };
    if (storedCustom !== duration.customSeconds) {
        storedCustom = duration.customSeconds;
        if (document.activeElement !== secondsInput) secondsInput.value = storedCustom || '';
    }
    markDuration(presets, secondsInput, duration);
}

function send(command, extra = {}) {
    if (command === 'status' && pendingCount) return Promise.resolve();
    pendingCount += 1;
    queue = queue.then(async () => {
        try {
            const state = await chrome.tabs.sendMessage(tabId, { channel: 'sulimarket:popup', command, ...extra });
            if (state.error) throw new Error(state.error);
            if (command !== 'status' || $('#error').dataset.source === 'status') $('#error').hidden = true;
            render(state);
        } catch {
            $('#error').dataset.source = command;
            $('#error').textContent = command === 'status'
                ? 'Обновите страницу магазина, чтобы подключить SuliMarket.' : 'Не удалось выполнить действие. Обновите страницу магазина и попробуйте снова.';
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
presets.forEach(button => {
    button.addEventListener('click', () => send('load', { seconds: Number(button.dataset.seconds) }));
});
wireCustomTime(secondsInput, $('#play'), $('#seconds-error'), seconds => send('load', { seconds, custom: true }));

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
