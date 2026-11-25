# Истории SuliMarket

`npm ci`, затем `npx playwright install chromium --only-shell`. Команда `npm run design-live` собирает статический
Storybook, снимает состояния в двух темах и пишет манифест. По умолчанию папка вывода - `design-live-output/`.
Для публикации задай `DESIGN_LIVE_OUTPUT` (папка проекта в центре) и `DESIGN_MAP` (путь к JSON карты) в окружении
или в локальном файле `.storybook/design-live.local.env`. `npm run design-live:coverage` сверяет файлы, обе темы
и сборки с картой. Если карта читается из коммита или ветки Git, задай `DESIGN_MAP_REF` вместе с `DESIGN_MAP`.
Проверить другой файл карты можно через `npm run design-live:coverage -- <карта> [папка вывода]`.

`.storybook/catalogue.mjs` связывает пару "путь и имя в коде" с историей, состоянием и видимым узлом. Из каталога
генерируются истории CSF. `scene.js` исполняет исходный HTML, CSS и JS окна и ядра в отдельных iframe.
Фикстуры магазинов содержат тестовые товары, продавцов и ту разметку, к которой привязано расширение.
Транспорт продавцов и Chrome API локальные. Истории блокируют переходы по ссылкам и внешние ресурсы,
а браузер снимков разрешает только локальный сервер. Тестовые данные могут отличаться от живой выдачи.

Темы снимков идут через `prefers-color-scheme`. В интерактивном просмотре переключатель Storybook подставляет
нужные ветки исходных CSS-медиазапросов, если тема браузера отличается. Снимки обретают версию по коммиту
файла из карты. Побайтно равный PNG переиспользуется. Новые файлы публикуются атомарно перед манифестом.
Сборка расширения по-прежнему идёт отдельно через `node build.mjs`.

Документация: [HTML и Vite](https://storybook.js.org/docs/configure/integration/frameworks),
[CSF](https://storybook.js.org/docs/api/csf), [выбор темы](https://storybook.js.org/docs/essentials/toolbars-and-globals),
[Chromium для Playwright](https://playwright.dev/docs/browsers).
