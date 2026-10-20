# Страница SuliMarket на sulimko.com

Текст для двух страниц сайта sulimko.com. Выкладка - задача проекта `sulimko-com`; здесь только содержание и
разметка для поиска. Ссылки на магазины вставляются после публикации (Chrome Web Store даёт адрес карточки после
первой загрузки).

## Страница продукта - `/sulimarket`

| Поле | Значение |
| --- | --- |
| URL | `https://sulimko.com/sulimarket` |
| `<title>` | SuliMarket - сортировка Ozon и Wildberries по количеству отзывов |
| `meta description` | Бесплатное расширение для Chrome и Яндекс Браузера: сортирует выдачу Ozon по количеству отзывов и Wildberries по количеству оценок. Без сбора данных. |
| `og:image` | `store/promo-440x280.png` или скриншот `store/screenshots/1-ozon-sorted.png` |
| Язык | `ru` |

### H1

SuliMarket - сортировка Ozon и Wildberries по количеству отзывов

### Первый экран

Ozon и Wildberries не умеют сортировать товары по количеству отзывов. SuliMarket умеет: один клик - и наверху товары,
которые купили и оценили тысячи людей.

Кнопки: **Установить в Chrome** (Chrome Web Store) · **Для Edge** (Edge Add-ons) · **Скрипт для Tampermonkey**
(`https://github.com/sergeysulimko/sulimarket/releases/latest/download/sulimarket.user.js`).

Под кнопками мелко: Бесплатно. Без рекламы. Ничего не собирает. Код открыт на GitHub.

Картинка: `store/screenshots/1-ozon-sorted.png`.

### Блок "Почему не рейтинг"

Рейтинг не говорит, сколько людей его поставили. Товар с оценкой 5,0 от трёх покупателей стоит выше товара с 4,8 от
40 000 покупателей. SuliMarket ставит наверх товары с большим количеством отзывов, а рейтинг учитывает при равенстве.

Цифры с источником (цитата + число повышают цитирование AI-ответами, `corp/.../geo-ai-search`):
83% покупателей изучают отзывы перед покупкой в интернете, 55% считают, что фейковых отзывов примерно столько же,
сколько настоящих, или больше (НАФИ, 2023, https://nafi.ru/polls/kak-izmenilos-otnoshenie-rossiyan-k-otzyvam-o-tovarakh-v-internete/).
Только на рейтинг смотрят 4% покупателей (Роскачество, 2025, https://rskrf.ru/news/43-rossiyan-obrashchayut-vnimanie-na-otzyvy-i-reytingi-pri-pokupke-onlayn/).

Таблица "Что умеют сайты" - из README: сортировки Ozon и Wildberries и строка "Сайт с SuliMarket".

### Блок "Что умеет" - шесть карточек

1. **Только основная выдача.** Полки "Вы смотрели" и реклама не попадают в сортировку.
2. **Вёрстка сайта цела.** Работают "В избранное", корзина и переход к товару.
3. **Догружает сам.** 3, 5, 10 секунд прокрутки - и сортировка всего загруженного.
4. **Не теряет новые товары.** Жёлтая кнопка с `+N` и "Досортировать" на странице.
5. **Держит сортировку.** Смена фильтра, категории или поиска - новая выдача сортируется сама.
6. **"Как было".** Порядок сайта возвращается одним нажатием.

Картинка: `store/screenshots/3-wb-new-cards.png`.

### Блок "Как пользоваться"

1. Поставьте расширение.
2. Откройте поиск или категорию на Ozon или Wildberries.
3. Нажмите круглую кнопку SuliMarket - "Сортировать по отзывам".

### Блок "Частые вопросы"

Вопросы - в том же виде, что в README (раздел "Частые вопросы"): тексты совпадают дословно, чтобы поиск и
AI-ответы видели один ответ на один вопрос.

- Как отсортировать Ozon по количеству отзывов?
- Есть ли на Ozon сортировка по количеству отзывов?
- Как на Wildberries отсортировать товары по количеству оценок?
- Почему отсортировано не всё, что есть по запросу?
- Сайт догрузил товары после сортировки. Что делать?
- Работает ли "В избранное" и корзина в отсортированной выдаче?
- Работает ли SuliMarket в Яндекс Браузере?
- Защищает ли SuliMarket от накрученных отзывов?
- Чем SuliMarket отличается от других скриптов для Ozon?
- Работает ли на телефоне?
- Это бесплатно?

### Блок "Для AI-агентов"

Текст - раздел README "Как SuliMarket работает с AI-агентами?": адрес с `?sulimarket=10`, ожидание
`html[data-sulimarket-state="sorted"]`, JSON `#sulimarket-result`, пример Playwright.

### Индексация

Яндекс - главный индекс для AI-ответов в России (Алиса AI в Поиске строит ответ на страницах Яндекса), ChatGPT -
индекс Bing. При выходе сайта в прод: sulimko.com в Яндекс Вебмастер и Bing Webmaster Tools, robots.txt пускает
YandexBot, Bingbot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot. Исследование -
`sulimko-com/docs/products/sulimarket/RESEARCH.md`.

### Подвал страницы

Политика конфиденциальности (`/sulimarket/privacy`) · Исходный код на GitHub · Сообщить об ошибке (GitHub issues) ·
Автор - Сергей Сулимко.

### Разметка schema.org (JSON-LD)

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "SuliMarket",
  "applicationCategory": "BrowserApplication",
  "operatingSystem": "Chrome, Яндекс Браузер, Microsoft Edge, Opera",
  "description": "Расширение браузера: сортирует выдачу Ozon по количеству отзывов и Wildberries по количеству оценок.",
  "inLanguage": "ru",
  "softwareVersion": "3.0.0",
  "license": "https://opensource.org/licenses/MIT",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "RUB" },
  "author": { "@type": "Person", "name": "Сергей Сулимко", "url": "https://sulimko.com" },
  "codeRepository": "https://github.com/sergeysulimko/sulimarket",
  "screenshot": "https://sulimko.com/sulimarket/1-ozon-sorted.png"
}
```

Плюс `FAQPage` с вопросами и ответами блока "Частые вопросы" (тексты ответов - из README).

## Политика конфиденциальности - `/sulimarket/privacy`

| Поле | Значение |
| --- | --- |
| URL | `https://sulimko.com/sulimarket/privacy` (в карточке магазина сначала стоит `PRIVACY.md` на GitHub; когда эта страница заработает, адрес в карточке можно сменить) |
| `<title>` | Политика конфиденциальности SuliMarket |
| Текст | `PRIVACY.md` из репо дословно |

Магазин проверяет, что ссылка на политику открывается. Пока страницы нет, в карточке стоит `PRIVACY.md` с GitHub.
