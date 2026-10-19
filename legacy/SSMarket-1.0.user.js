// ==UserScript==
// @name         SSMarket
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Сортировка карточек Ozon и Wildberries по отзывам и оценкам
// @author       Sulimko
// @match        https://www.ozon.ru/*
// @match        https://www.wildberries.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '1.0';
    const BUTTON_TEXTS = {
        sort: 'Сортировать',
        timedScrollSort: 'Листать 10 секунд и сортировать',
        customScrollSort: 'Листать N секунд и сортировать'
    };

    const SCROLL_SETTINGS = {
        gapFromBottomPx: 120,
        minStepPx: 400,
        viewportStepRatio: 0.55
    };

    function parseInteger(value) {
        return parseInt(String(value || '').replace(/[^\d]/g, ''), 10) || 0;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function scrollForDuration(durationMs, onTick) {
        return new Promise(resolve => {
            const start = Date.now();
            const tickInterval = 280;

            onTick?.(0, durationMs);

            const interval = setInterval(() => {
                const doc = document.documentElement;
                const viewportHeight = window.innerHeight || doc.clientHeight || 800;
                const currentScrollTop = window.pageYOffset || doc.scrollTop || 0;
                const maxScrollTop = Math.max(0, doc.scrollHeight - viewportHeight - SCROLL_SETTINGS.gapFromBottomPx);
                const step = Math.max(SCROLL_SETTINGS.minStepPx, viewportHeight * SCROLL_SETTINGS.viewportStepRatio);
                const targetScrollTop = Math.min(currentScrollTop + step, maxScrollTop);

                window.scrollTo(0, targetScrollTop);

                const elapsed = Date.now() - start;
                const remaining = Math.max(0, durationMs - elapsed);
                onTick?.(elapsed, remaining);

                if (elapsed >= durationMs) {
                    clearInterval(interval);
                    resolve();
                }
            }, tickInterval);
        });
    }

    function createOzonSite() {
        const PRODUCT_LINK_SELECTOR = 'a[href*="/product/"]';
        const REVIEW_COUNT_PATTERN = /(\d[\d\s\u00a0]*)\s*отзыв(?:а|ов)?\b/gi;
        const REVIEW_COUNT_EXACT_PATTERN = /^(\d[\d\s\u00a0]*)\s*отзыв(?:а|ов)?$/i;
        const SORTED_ROOT_ID = 'ssmarket-ozon-sorted-root';

        let lastSortedItemsSignature = '';
        const cachedProducts = new Map();
        let captureFrameId = 0;
        let captureObserver = null;

        function getReviewTextSources(card) {
            const sources = [card.textContent || ''];
            card.querySelectorAll('[aria-label]').forEach(node => {
                const value = node.getAttribute('aria-label');
                if (value) {
                    sources.push(value);
                }
            });
            return sources;
        }

        function getReviewsCount(card) {
            const matches = [];

            getReviewTextSources(card).forEach(source => {
                for (const match of source.matchAll(REVIEW_COUNT_PATTERN)) {
                    matches.push(parseInteger(match[1]));
                }
            });

            return matches.length ? Math.max(...matches) : 0;
        }

        function getDirectReviewCount(card) {
            let maxCount = 0;
            card.querySelectorAll('span, div, a').forEach(node => {
                const text = normalizeText(node.textContent);
                const match = text.match(REVIEW_COUNT_EXACT_PATTERN);
                if (match) {
                    maxCount = Math.max(maxCount, parseInteger(match[1]));
                }
            });
            return maxCount;
        }

        function getProductLinks(node) {
            return Array.from(node.querySelectorAll(PRODUCT_LINK_SELECTOR))
                .map(link => link.href)
                .filter(Boolean);
        }

        function getUniqueProductLinks(node) {
            return [...new Set(getProductLinks(node))];
        }

        function getItemKey(node) {
            return getUniqueProductLinks(node)[0] || normalizeText(node.textContent).slice(0, 120);
        }

        function getNativeGridContainers() {
            return Array.from(document.querySelectorAll('div[data-widget="tileGridDesktop"]'))
                .filter(container => !container.closest(`#${SORTED_ROOT_ID}`));
        }

        function getVisibleNativeGridContainers() {
            return getNativeGridContainers().filter(container => getComputedStyle(container).display !== 'none');
        }

        function getGridWrappers(gridContainers) {
            return gridContainers
                .map(container => Array.from(container.children).find(child => (
                    child instanceof HTMLElement &&
                    Array.from(child.children).some(grandChild => (
                        grandChild instanceof HTMLElement &&
                        grandChild.querySelector(PRODUCT_LINK_SELECTOR) &&
                        grandChild.querySelector('img')
                    ))
                )))
                .filter(Boolean);
        }

        function collectGridItems(gridWrappers) {
            const items = [];
            const seenItems = new Set();

            gridWrappers.forEach(wrapper => {
                Array.from(wrapper.children).forEach(child => {
                    if (!(child instanceof HTMLElement) || seenItems.has(child)) {
                        return;
                    }

                    if (!(child.querySelector(PRODUCT_LINK_SELECTOR) && child.querySelector('img'))) {
                        return;
                    }

                    seenItems.add(child);
                    items.push({
                        card: child,
                        key: getItemKey(child),
                        reviewsCount: getDirectReviewCount(child) || getReviewsCount(child),
                        originalIndex: items.length
                    });
                });
            });

            return items;
        }

        function captureVisibleProducts() {
            const gridWrappers = getGridWrappers(getVisibleNativeGridContainers());
            const liveItems = collectGridItems(gridWrappers);

            liveItems.forEach(item => {
                const existing = cachedProducts.get(item.key);
                const firstSeenIndex = existing?.firstSeenIndex ?? cachedProducts.size;
                const nextReviewsCount = Math.max(existing?.reviewsCount || 0, item.reviewsCount || 0);

                cachedProducts.set(item.key, {
                    key: item.key,
                    reviewsCount: nextReviewsCount,
                    firstSeenIndex,
                    cardSnapshot: item.card.cloneNode(true)
                });
            });

            return liveItems;
        }

        function scheduleVisibleProductsCapture() {
            if (captureFrameId) {
                return;
            }

            captureFrameId = requestAnimationFrame(() => {
                captureFrameId = 0;
                captureVisibleProducts();
            });
        }

        function ensureCaptureObserverStarted() {
            if (captureObserver) {
                return;
            }

            captureObserver = new MutationObserver(() => {
                scheduleVisibleProductsCapture();
            });

            captureObserver.observe(document.body, {
                childList: true,
                subtree: true
            });

            window.addEventListener('scroll', scheduleVisibleProductsCapture, { passive: true });
            window.addEventListener('resize', scheduleVisibleProductsCapture, { passive: true });
            scheduleVisibleProductsCapture();
            setTimeout(scheduleVisibleProductsCapture, 1200);
        }

        function getItemsSignature(items) {
            return items
                .map(item => item.key)
                .filter(Boolean)
                .sort()
                .join('|||');
        }

        function getSortedRoot() {
            return document.getElementById(SORTED_ROOT_ID);
        }

        function removeSortedRoot() {
            const sortedRoot = getSortedRoot();
            if (sortedRoot) {
                sortedRoot.remove();
            }
        }

        function restoreNativeGridContainers() {
            removeSortedRoot();
            getNativeGridContainers().forEach(container => {
                if (container.dataset.ssmarketOriginalDisplay !== undefined) {
                    container.style.display = container.dataset.ssmarketOriginalDisplay;
                    delete container.dataset.ssmarketOriginalDisplay;
                } else {
                    container.style.display = '';
                }
            });
        }

        function hideNativeGridContainers() {
            getNativeGridContainers().forEach(container => {
                if (container.dataset.ssmarketOriginalDisplay === undefined) {
                    container.dataset.ssmarketOriginalDisplay = container.style.display || '';
                }
                container.style.display = 'none';
            });
        }

        function buildRenderedCard(snapshot) {
            const card = snapshot.cloneNode(true);
            card.style.width = '';
            card.style.maxWidth = '';
            card.style.breakInside = '';
            return card;
        }

        function renderSortedProducts(sortedItems, gridContainers, gridWrappers) {
            const referenceContainer = gridContainers[0];
            const referenceWrapper = gridWrappers[0];
            if (!referenceContainer || !referenceWrapper || !referenceContainer.parentElement) {
                return false;
            }

            removeSortedRoot();

            const sortedRoot = document.createElement('div');
            sortedRoot.id = SORTED_ROOT_ID;

            const chunkSize = Math.max(1, Array.from(referenceWrapper.children).filter(child => (
                child instanceof HTMLElement &&
                child.querySelector(PRODUCT_LINK_SELECTOR) &&
                child.querySelector('img')
            )).length || 12);

            for (let start = 0; start < sortedItems.length; start += chunkSize) {
                const containerClone = referenceContainer.cloneNode(false);
                const wrapperClone = referenceWrapper.cloneNode(false);
                const chunk = sortedItems.slice(start, start + chunkSize);

                containerClone.style.display = '';
                chunk.forEach(item => {
                    wrapperClone.appendChild(buildRenderedCard(item.cardSnapshot));
                });
                containerClone.appendChild(wrapperClone);
                sortedRoot.appendChild(containerClone);
            }

            referenceContainer.parentElement.insertBefore(sortedRoot, referenceContainer);
            hideNativeGridContainers();
            return true;
        }

        function sort() {
            captureVisibleProducts();

            const gridContainers = getNativeGridContainers();
            if (!gridContainers.length) {
                alert('Контейнеры Ozon с товарами не найдены.');
                return false;
            }

            const gridWrappers = getGridWrappers(gridContainers);
            const cachedItems = Array.from(cachedProducts.values()).filter(item => item.cardSnapshot);
            if (!cachedItems.length) {
                alert('Карточки Ozon не найдены.');
                return false;
            }

            const currentItemsSignature = getItemsSignature(cachedItems);
            if (currentItemsSignature && currentItemsSignature === lastSortedItemsSignature && getSortedRoot()) {
                console.log(`[SSMarket Ozon v${SCRIPT_VERSION}] Повторный клик без новых карточек. Сортировку пропускаю.`);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return true;
            }

            const sortedItems = [...cachedItems].sort((a, b) => {
                if (a.reviewsCount === 0 && b.reviewsCount === 0) {
                    return a.firstSeenIndex - b.firstSeenIndex;
                }

                if (a.reviewsCount === 0) {
                    return 1;
                }

                if (b.reviewsCount === 0) {
                    return -1;
                }

                const diff = b.reviewsCount - a.reviewsCount;
                if (diff !== 0) {
                    return diff;
                }

                return a.firstSeenIndex - b.firstSeenIndex;
            });

            if (!renderSortedProducts(sortedItems, gridContainers, gridWrappers)) {
                alert('Не удалось построить отсортированный список Ozon.');
                return false;
            }

            lastSortedItemsSignature = currentItemsSignature;

            console.log(`[SSMarket Ozon v${SCRIPT_VERSION}] Карточки отсортированы по отзывам.`, {
                count: sortedItems.length,
                topReviews: sortedItems.slice(0, 12).map(item => item.reviewsCount)
            });

            window.scrollTo({ top: 0, behavior: 'smooth' });
            return true;
        }

        return {
            id: 'ozon',
            badgeLabel: 'SSMarket Ozon',
            collapsedLabel: 'Сортировка Ozon',
            expandedLabel: 'Скрыть панель',
            accent: '#0f58ff',
            accentShadow: 'rgba(15, 88, 255, 0.28)',
            panelShadow: 'rgba(15, 88, 255, 0.18)',
            panelBorder: 'rgba(15, 88, 255, 0.12)',
            buttonBackground: '#f3f6ff',
            buttonHoverBackground: '#e5ecff',
            buttonTextColor: '#1a2a4a',
            init() {
                ensureCaptureObserverStarted();
                captureVisibleProducts();
            },
            beforeScrollSort() {
                restoreNativeGridContainers();
            },
            sort
        };
    }

    function createWildberriesSite() {
        const CARD_SELECTOR = '.product-card.j-card-item';
        const LIST_SELECTOR = '.product-card-list';
        const PRODUCT_LINK_SELECTOR = 'a.product-card__link[href*="/catalog/"][href*="/detail.aspx"]';
        const RATING_COUNT_SELECTOR = '.product-card__count';

        let lastSortedItemsSignature = '';

        function getRatingCount(card) {
            const exactNode = card.querySelector(RATING_COUNT_SELECTOR);
            if (!exactNode) {
                return 0;
            }

            const exactText = normalizeText(exactNode.textContent);
            return exactText ? parseInteger(exactText) : 0;
        }

        function getItemKey(card) {
            const link = card.querySelector(PRODUCT_LINK_SELECTOR);
            return link?.href || card.id || normalizeText(card.innerText).slice(0, 120);
        }

        function getProductList() {
            return document.querySelector(LIST_SELECTOR);
        }

        function getCards() {
            const list = getProductList();
            if (!list) {
                return [];
            }

            return Array.from(list.children).filter(card => (
                card instanceof HTMLElement &&
                card.matches(CARD_SELECTOR) &&
                card.querySelector(PRODUCT_LINK_SELECTOR)
            ));
        }

        function getItemsSignature(items) {
            return items
                .map(item => item.key)
                .filter(Boolean)
                .sort()
                .join('|||');
        }

        function sort() {
            const list = getProductList();
            if (!list) {
                alert('Список товаров Wildberries не найден.');
                return false;
            }

            const items = getCards().map((card, index) => ({
                card,
                key: getItemKey(card),
                ratingsCount: getRatingCount(card),
                originalIndex: index
            }));

            if (!items.length) {
                alert('Карточки Wildberries не найдены.');
                return false;
            }

            const currentItemsSignature = getItemsSignature(items);
            if (currentItemsSignature && currentItemsSignature === lastSortedItemsSignature) {
                console.log(`[SSMarket WB v${SCRIPT_VERSION}] Повторный клик без новых карточек. Сортировку пропускаю.`);
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return true;
            }

            const sortedItems = [...items].sort((leftItem, rightItem) => {
                if (leftItem.ratingsCount === 0 && rightItem.ratingsCount === 0) {
                    return leftItem.originalIndex - rightItem.originalIndex;
                }

                if (leftItem.ratingsCount === 0) {
                    return 1;
                }

                if (rightItem.ratingsCount === 0) {
                    return -1;
                }

                const diff = rightItem.ratingsCount - leftItem.ratingsCount;
                if (diff !== 0) {
                    return diff;
                }

                return leftItem.originalIndex - rightItem.originalIndex;
            });

            const fragment = document.createDocumentFragment();
            sortedItems.forEach(item => {
                fragment.appendChild(item.card);
            });
            list.appendChild(fragment);

            lastSortedItemsSignature = currentItemsSignature;

            console.log(`[SSMarket WB v${SCRIPT_VERSION}] Карточки отсортированы по количеству оценок.`, {
                count: sortedItems.length,
                topRatings: sortedItems.slice(0, 12).map(item => item.ratingsCount)
            });

            window.scrollTo({ top: 0, behavior: 'smooth' });
            return true;
        }

        return {
            id: 'wb',
            badgeLabel: 'SSMarket WB',
            collapsedLabel: 'Сортировка WB',
            expandedLabel: 'Скрыть панель',
            accent: '#8d2de2',
            accentShadow: 'rgba(141, 45, 226, 0.3)',
            panelShadow: 'rgba(167, 58, 253, 0.22)',
            panelBorder: 'rgba(167, 58, 253, 0.16)',
            buttonBackground: '#fbf5ff',
            buttonHoverBackground: '#f4e8ff',
            buttonTextColor: '#2d1b43',
            init() {},
            beforeScrollSort() {},
            sort
        };
    }

    function getActiveSite() {
        if (location.hostname.includes('ozon.ru')) {
            return createOzonSite();
        }

        if (location.hostname.includes('wildberries.ru')) {
            return createWildberriesSite();
        }

        return null;
    }

    const site = getActiveSite();
    if (!site) {
        return;
    }

    let isCollapsed = true;

    function getCollapsedToggleText() {
        return `${site.collapsedLabel} v${SCRIPT_VERSION}`;
    }

    function getExpandedToggleText() {
        return `${site.expandedLabel} v${SCRIPT_VERSION}`;
    }

    function createWrapper() {
        const wrapper = document.createElement('div');
        wrapper.style.position = 'fixed';
        wrapper.style.bottom = '24px';
        wrapper.style.right = '88px';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.alignItems = 'flex-end';
        wrapper.style.gap = '10px';
        wrapper.style.zIndex = '999999';
        wrapper.style.fontFamily = '"Inter", "Segoe UI", sans-serif';
        return wrapper;
    }

    function createPanel() {
        const panel = document.createElement('div');
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.gap = '8px';
        panel.style.padding = '12px';
        panel.style.minWidth = '220px';
        panel.style.background = 'rgba(255, 255, 255, 0.98)';
        panel.style.borderRadius = '14px';
        panel.style.boxShadow = `0 8px 24px ${site.panelShadow}`;
        panel.style.border = `1px solid ${site.panelBorder}`;
        panel.style.backdropFilter = 'blur(6px)';
        return panel;
    }

    function createVersionBadge() {
        const badge = document.createElement('div');
        badge.textContent = `${site.badgeLabel} v${SCRIPT_VERSION}`;
        badge.style.alignSelf = 'flex-start';
        badge.style.padding = '4px 10px';
        badge.style.background = `${site.panelBorder}`;
        badge.style.color = site.accent;
        badge.style.borderRadius = '999px';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = '700';
        badge.style.letterSpacing = '0.02em';
        return badge;
    }

    function createToggleButton() {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = getCollapsedToggleText();
        toggle.style.padding = '8px 18px';
        toggle.style.background = site.accent;
        toggle.style.color = '#ffffff';
        toggle.style.fontSize = '13px';
        toggle.style.fontWeight = '600';
        toggle.style.border = 'none';
        toggle.style.borderRadius = '999px';
        toggle.style.cursor = 'pointer';
        toggle.style.boxShadow = `0 8px 16px ${site.accentShadow}`;
        toggle.style.transition = 'transform 0.16s ease, box-shadow 0.16s ease, opacity 0.2s ease';

        toggle.addEventListener('mouseenter', () => {
            if (toggle.disabled) {
                return;
            }
            toggle.style.transform = 'translateY(-1px)';
            toggle.style.boxShadow = `0 12px 20px ${site.accentShadow}`;
        });

        toggle.addEventListener('mouseleave', () => {
            toggle.style.transform = 'translateY(0)';
            toggle.style.boxShadow = `0 8px 16px ${site.accentShadow}`;
        });

        return toggle;
    }

    function createButton(text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.style.padding = '9px 16px';
        btn.style.minWidth = '210px';
        btn.style.background = site.buttonBackground;
        btn.style.color = site.buttonTextColor;
        btn.style.border = `1px solid ${site.panelBorder}`;
        btn.style.borderRadius = '10px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '13px';
        btn.style.fontWeight = '600';
        btn.style.boxShadow = `0 4px 12px ${site.panelBorder}`;
        btn.style.userSelect = 'none';
        btn.style.transition = 'transform 0.16s ease, box-shadow 0.16s ease, opacity 0.2s ease, background 0.2s ease';

        btn.addEventListener('mouseenter', () => {
            if (btn.disabled) {
                return;
            }
            btn.style.transform = 'translateY(-1px)';
            btn.style.boxShadow = `0 8px 16px ${site.panelShadow}`;
            btn.style.background = site.buttonHoverBackground;
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = `0 4px 12px ${site.panelBorder}`;
            btn.style.background = site.buttonBackground;
        });

        return btn;
    }

    function updatePanelVisibility(panel, toggleButton) {
        if (isCollapsed) {
            panel.style.display = 'none';
            toggleButton.textContent = getCollapsedToggleText();
        } else {
            panel.style.display = 'flex';
            toggleButton.textContent = getExpandedToggleText();
        }
        toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    }

    function setButtonsEnabled(buttons, toggleButton, isEnabled) {
        const pointerState = isEnabled ? 'pointer' : 'not-allowed';
        const opacity = isEnabled ? '1' : '0.65';

        buttons.forEach(btn => {
            btn.disabled = !isEnabled;
            btn.style.cursor = pointerState;
            btn.style.opacity = opacity;
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = `0 4px 12px ${site.panelBorder}`;
            btn.style.background = site.buttonBackground;
        });

        toggleButton.disabled = !isEnabled;
        toggleButton.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
        toggleButton.style.opacity = opacity;
        toggleButton.style.transform = 'translateY(0)';
    }

    async function customScrollAndSort(buttons, toggleButton, button) {
        const input = prompt('Сколько секунд листать перед сортировкой?', '20');
        if (input === null) {
            return;
        }

        const normalized = input.replace(',', '.').trim();
        const secondsValue = Number(normalized);
        if (!Number.isFinite(secondsValue) || secondsValue <= 0) {
            alert('Введите положительное число секунд.');
            return;
        }

        const durationMs = Math.round(Math.max(1, Math.min(secondsValue, 180)) * 1000);

        site.beforeScrollSort();
        setButtonsEnabled(buttons, toggleButton, false);

        try {
            await scrollForDuration(durationMs, (_, remaining) => {
                const secondsLeft = Math.ceil(remaining / 1000);
                button.textContent = secondsLeft > 0 ? `Листаю ещё ${secondsLeft} сек...` : 'Готовлю сортировку...';
            });

            button.textContent = 'Сортирую...';
            site.sort();
        } finally {
            button.textContent = BUTTON_TEXTS.customScrollSort;
            setButtonsEnabled(buttons, toggleButton, true);
        }
    }

    async function limitedScrollAndSort(buttons, toggleButton, button) {
        site.beforeScrollSort();
        setButtonsEnabled(buttons, toggleButton, false);

        try {
            await scrollForDuration(10000, (_, remaining) => {
                const secondsLeft = Math.ceil(remaining / 1000);
                button.textContent = secondsLeft > 0 ? `Листаю ещё ${secondsLeft} сек...` : 'Готовлю сортировку...';
            });

            button.textContent = 'Сортирую...';
            site.sort();
        } finally {
            button.textContent = BUTTON_TEXTS.timedScrollSort;
            setButtonsEnabled(buttons, toggleButton, true);
        }
    }

    const wrapper = createWrapper();
    const panel = createPanel();
    const versionBadge = createVersionBadge();
    const btnSort = createButton(BUTTON_TEXTS.sort);
    const btnTimedScrollSort = createButton(BUTTON_TEXTS.timedScrollSort);
    const btnCustomScrollSort = createButton(BUTTON_TEXTS.customScrollSort);
    const buttons = [btnSort, btnTimedScrollSort, btnCustomScrollSort];
    const toggleButton = createToggleButton();

    panel.appendChild(versionBadge);
    panel.appendChild(btnSort);
    panel.appendChild(btnTimedScrollSort);
    panel.appendChild(btnCustomScrollSort);

    wrapper.appendChild(panel);
    wrapper.appendChild(toggleButton);
    document.body.appendChild(wrapper);

    btnSort.addEventListener('click', () => {
        setButtonsEnabled(buttons, toggleButton, false);
        const originalText = btnSort.textContent;
        btnSort.textContent = 'Сортирую...';

        try {
            site.sort();
        } finally {
            btnSort.textContent = originalText;
            setButtonsEnabled(buttons, toggleButton, true);
        }
    });

    btnTimedScrollSort.addEventListener('click', () => {
        limitedScrollAndSort(buttons, toggleButton, btnTimedScrollSort);
    });

    btnCustomScrollSort.addEventListener('click', () => {
        customScrollAndSort(buttons, toggleButton, btnCustomScrollSort);
    });

    toggleButton.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        updatePanelVisibility(panel, toggleButton);
    });

    site.init();
    updatePanelVisibility(panel, toggleButton);
})();
