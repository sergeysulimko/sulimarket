# ROADMAP

Идеи Сергея 19.10.2026 и решения 20.10.2026.

## Выпуск 3.0.0 (готовится)

- [x] Имя SuliMarket, репо `sergeysulimko/sulimarket`.
- [x] Расширение MV3 и скрипт Tampermonkey из одного кода (`npm run build`).
- [x] Тексты: README, PRIVACY, CHANGELOG, llms.txt, карточка магазина (`store/`), страница для sulimko.com (`site/`).
- [ ] Открыть репо - решение Сергея.
- [ ] Chrome Web Store: регистрация разработчика (5 долларов, рука Сергея), загрузка пакета и карточки.
- [ ] Edge Add-ons, Opera Add-ons - бесплатно, тот же пакет.
- [ ] Страница `sulimko.com/sulimarket` и `/sulimarket/privacy` - в проекте sulimko-com.
- [ ] Профиль GitHub `sergeysulimko`: README со ссылкой на sulimko.com, закрепить SuliMarket.

## Для агентов

- [ ] CLI: "дай топ-N товаров по запросу X с Ozon/WB, по числу отзывов" - без браузера человека. Ozon отдаёт выдачу
  через `/api/entrypoint-api.bx/page/json/v2?url=/search/...`; WB - свой поисковый API. Антибот Ozon режет
  безоконный браузер - нужен ru-выход и обход проверки.
- [ ] MCP-сервер поверх CLI, чтобы агенты искали и сортировали товары сами.

## Функции

- [ ] Firefox (addons.mozilla.org): своя сборка с `browser_specific_settings.gecko` и декларацией сбора данных.
- [ ] Другие маркетплейсы: Яндекс Маркет, AliExpress, Avito, Мегамаркет.
- [ ] Выбор ключа сортировки: отзывы, рейтинг при пороге отзывов, цена за отзыв.
- [ ] Горячая клавиша сортировки.
- [ ] Мобильная вёрстка Ozon и WB (сейчас только версия для компьютера).
