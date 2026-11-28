// Shared by the marketplace UI, its extension bridge, and the Chrome popup.
const SCROLL_PRESETS = [3, 5, 10];
const MAX_SCROLL_SECONDS = 180;
const GOODS = ['товар', 'товара', 'товаров'];
const REVIEWS = ['отзыв', 'отзыва', 'отзывов'];
const RATINGS = ['оценка', 'оценки', 'оценок'];
const EMPTY_LISTING = 'Откройте поиск или категорию товаров в этом магазине.';
const SECONDS_ERROR = 'Укажите целое число от 1 до 180 секунд.';
const number = new Intl.NumberFormat('ru-RU');
const plurals = new Intl.PluralRules('ru-RU');
const formsIndex = { one: 0, few: 1, many: 2, other: 2 };

function formatNumber(value) {
    return number.format(value);
}

function counted(value, forms) {
    return `${formatNumber(value)}\u00a0${forms[formsIndex[plurals.select(value)]]}`;
}

function compactCount(value, forms) {
    if (value >= 1e6) return `${formatNumber(Math.round(value / 1e5) / 10)}\u00a0млн\u00a0${forms[2]}`;
    if (value >= 1e4) return `${formatNumber(Math.round(value / 1000))}\u00a0тыс.\u00a0${forms[2]}`;
    return counted(value, forms);
}

function validSeconds(value) {
    return Number.isInteger(value) && value >= 1 && value <= MAX_SCROLL_SECONDS;
}

function lastDuration(store) {
    const duration = store.get('duration', null);
    if (duration) return duration;
    const seconds = store.get('lastSeconds', 0);
    return { seconds, custom: !SCROLL_PRESETS.includes(seconds), customSeconds: store.get('customSeconds', '') };
}

function rememberDuration(store, seconds, custom) {
    const customSeconds = custom ? seconds : lastDuration(store).customSeconds;
    store.set('duration', { seconds, custom, customSeconds });
}

function markDuration(presets, input, { seconds, custom }) {
    for (const button of presets) {
        button.setAttribute('aria-pressed', String(!custom && Number(button.dataset.seconds) === seconds));
    }
    input.toggleAttribute('data-ssm-selected', Boolean(custom && seconds));
}

function wireCustomTime(input, button, error, submit) {
    function validate(required) {
        const invalid = input.validity.badInput || ((required || input.value !== '') && !validSeconds(input.valueAsNumber));
        input.setAttribute('aria-invalid', String(invalid));
        error.textContent = invalid ? SECONDS_ERROR : '';
        error.hidden = !invalid;
        return !invalid;
    }
    const run = () => {
        if (validate(true)) submit(input.valueAsNumber);
        else input.focus();
    };
    input.addEventListener('blur', () => validate(false));
    input.addEventListener('input', () => {
        if (!error.hidden) validate(false);
    });
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        run();
    });
    button.addEventListener('click', run);
}

function listingCopy({ site, count, sorted, fresh = 0, top, progress }) {
    const metric = site === 'ozon' ? 'отзывам' : 'оценкам';
    const sort = fresh ? 'Досортировать' : `Сортировать по ${metric}`;
    if (progress) return { sort, ...progress };
    if (fresh) return { sort, main: `Ещё ${counted(fresh, GOODS)} без сортировки`, sub: '' };
    if (sorted) return { sort, main: `Отсортировано ${counted(count, GOODS)}`, sub: `Наверху ${counted(top, site === 'ozon' ? REVIEWS : RATINGS)}` };
    return { sort, main: count ? `Загружено ${counted(count, GOODS)}` : EMPTY_LISTING, sub: count ? 'Сейчас порядок сайта' : '' };
}
