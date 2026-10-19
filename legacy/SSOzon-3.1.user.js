// ==UserScript==
// @name         SSOzon
// @namespace    http://tampermonkey.net/
// @version      3.13
// @description  Сортируй как хуй
// @author       Sulimko
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '3.13';

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

    const REVIEW_COUNT_PATTERN = /(\d[\d\s\u00a0]*)\s*отзыв(?:а|ов)?\b/gi;
    const REVIEW_COUNT_EXACT_PATTERN = /^(\d[\d\s\u00a0]*)\s*отзыв(?:а|ов)?$/i;
    const PRODUCT_LINK_SELECTOR = 'a[href*="/product/"]';
    const SORTED_ROOT_ID = 'ssozon-sorted-root';

    function getCollapsedToggleText() {
        return `Сортировка отзывов v${SCRIPT_VERSION}`;
    }

    function getExpandedToggleText() {
        return `Скрыть панель v${SCRIPT_VERSION}`;
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
        panel.style.minWidth = '210px';
        panel.style.background = 'rgba(255, 255, 255, 0.98)';
        panel.style.borderRadius = '14px';
        panel.style.boxShadow = '0 8px 24px rgba(15, 88, 255, 0.18)';
        panel.style.border = '1px solid rgba(15, 88, 255, 0.12)';
        panel.style.backdropFilter = 'blur(6px)';
        return panel;
    }

    function createVersionBadge() {
        const badge = document.createElement('div');
        badge.textContent = `SSOzon v${SCRIPT_VERSION}`;
        badge.style.alignSelf = 'flex-start';
        badge.style.padding = '4px 10px';
        badge.style.background = 'rgba(15, 88, 255, 0.08)';
        badge.style.color = '#0f58ff';
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
        toggle.style.background = '#0f58ff';
        toggle.style.color = '#ffffff';
        toggle.style.fontSize = '13px';
        toggle.style.fontWeight = '600';
        toggle.style.border = 'none';
        toggle.style.borderRadius = '999px';
        toggle.style.cursor = 'pointer';
        toggle.style.boxShadow = '0 8px 16px rgba(15, 88, 255, 0.28)';
        toggle.style.transition = 'transform 0.16s ease, box-shadow 0.16s ease, opacity 0.2s ease';

        toggle.addEventListener('mouseenter', () => {
            if (toggle.disabled) {
                return;
            }
            toggle.style.transform = 'translateY(-1px)';
            toggle.style.boxShadow = '0 12px 20px rgba(15, 88, 255, 0.32)';
        });

        toggle.addEventListener('mouseleave', () => {
            toggle.style.transform = 'translateY(0)';
            toggle.style.boxShadow = '0 8px 16px rgba(15, 88, 255, 0.28)';
        });

        return toggle;
    }

    function createButton(text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.style.padding = '9px 16px';
        btn.style.minWidth = '200px';
        btn.style.background = '#f3f6ff';
        btn.style.color = '#1a2a4a';
        btn.style.border = '1px solid rgba(15, 88, 255, 0.18)';
        btn.style.borderRadius = '10px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '13px';
        btn.style.fontWeight = '600';
        btn.style.boxShadow = '0 4px 12px rgba(15, 88, 255, 0.12)';
        btn.style.userSelect = 'none';
        btn.style.transition = 'transform 0.16s ease, box-shadow 0.16s ease, opacity 0.2s ease, background 0.2s ease';

        btn.addEventListener('mouseenter', () => {
            if (btn.disabled) {
                return;
            }
            btn.style.transform = 'translateY(-1px)';
            btn.style.boxShadow = '0 8px 16px rgba(15, 88, 255, 0.18)';
            btn.style.background = '#e5ecff';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 4px 12px rgba(15, 88, 255, 0.12)';
            btn.style.background = '#f3f6ff';
        });

        return btn;
    }

    const wrapper = createWrapper();
    const panel = createPanel();
    const versionBadge = createVersionBadge();
    const btnSort = createButton(BUTTON_TEXTS.sort);
    const btnTimedScrollSort = createButton(BUTTON_TEXTS.timedScrollSort);
    const btnCustomScrollSort = createButton(BUTTON_TEXTS.customScrollSort);

    panel.appendChild(versionBadge);
    panel.appendChild(btnSort);
    panel.appendChild(btnTimedScrollSort);
    panel.appendChild(btnCustomScrollSort);
    const toggleButton = createToggleButton();
    wrapper.appendChild(panel);
    wrapper.appendChild(toggleButton);
    document.body.appendChild(wrapper);

    let isCollapsed = true;
    let lastSortedItemsSignature = '';
    const cachedProducts = new Map();
    let captureFrameId = 0;
    let captureObserver = null;

    function updatePanelVisibility() {
        if (isCollapsed) {
            panel.style.display = 'none';
            toggleButton.textContent = getCollapsedToggleText();
        } else {
            panel.style.display = 'flex';
            toggleButton.textContent = getExpandedToggleText();
        }
        toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    }

    function setButtonsEnabled(isEnabled) {
        const pointerState = isEnabled ? 'pointer' : 'not-allowed';
        const opacity = isEnabled ? '1' : '0.65';
        [btnSort, btnTimedScrollSort, btnCustomScrollSort].forEach(btn => {
            btn.disabled = !isEnabled;
            btn.style.cursor = pointerState;
            btn.style.opacity = opacity;
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 4px 12px rgba(15, 88, 255, 0.12)';
            btn.style.background = '#f3f6ff';
        });
        toggleButton.disabled = !isEnabled;
        toggleButton.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
        toggleButton.style.opacity = opacity;
        toggleButton.style.transform = 'translateY(0)';
    }

    function parseInteger(value) {
        return parseInt(String(value).replace(/[^\d]/g, ''), 10) || 0;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getReviewTextSources(card) {
        const sources = [card.textContent || ''];
        card.querySelectorAll('[aria-label]').forEach(node => {
            const ariaLabel = node.getAttribute('aria-label');
            if (ariaLabel) {
                sources.push(ariaLabel);
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
        const textNodes = card.querySelectorAll('span, div, a');

        textNodes.forEach(node => {
            const text = normalizeText(node.textContent);
            const match = text.match(REVIEW_COUNT_EXACT_PATTERN);
            if (match) {
                maxCount = Math.max(maxCount, parseInteger(match[1]));
            }
        });

        return maxCount;
    }

    function compareItemsByOriginalOrder(leftItem, rightItem) {
        return leftItem.originalIndex - rightItem.originalIndex;
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

    function looksLikeProductCard(node) {
        if (!(node instanceof HTMLElement)) {
            return false;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width < 140 || rect.height < 220) {
            return false;
        }

        if (!node.querySelector('img')) {
            return false;
        }

        return getUniqueProductLinks(node).length >= 1;
    }

    function findCardRootFromReviewNode(reviewNode) {
        let current = reviewNode;

        for (let depth = 0; current && current !== document.body && depth < 14; depth += 1, current = current.parentElement) {
            if (looksLikeProductCard(current)) {
                return current;
            }
        }

        return null;
    }

    function getReviewNodes() {
        return Array.from(document.querySelectorAll('span, div, a')).filter(node => {
            const text = normalizeText(node.textContent);
            return REVIEW_COUNT_EXACT_PATTERN.test(text);
        });
    }

    function getCardSignature(card) {
        return `${card.tagName}|||${card.className}`;
    }

    function collectSeedCardsFromReviewNodes() {
        const seeds = [];
        const seenCards = new Set();

        getReviewNodes().forEach(node => {
            const card = findCardRootFromReviewNode(node);
            if (!card || seenCards.has(card)) {
                return;
            }

            seenCards.add(card);
            seeds.push(card);
        });

        return seeds;
    }

    function expandCardsFromSeedContainers(seedCards) {
        const cards = [];
        const seenCards = new Set();
        const signaturesByContainer = new Map();

        seedCards.forEach(card => {
            const container = card.parentElement;
            if (!container) {
                return;
            }

            if (!signaturesByContainer.has(container)) {
                signaturesByContainer.set(container, new Set());
            }

            signaturesByContainer.get(container).add(getCardSignature(card));
        });

        signaturesByContainer.forEach((signatures, container) => {
            Array.from(container.children).forEach(child => {
                if (!(child instanceof HTMLElement)) {
                    return;
                }

                if (!signatures.has(getCardSignature(child))) {
                    return;
                }

                if (!looksLikeProductCard(child) || seenCards.has(child)) {
                    return;
                }

                seenCards.add(child);
                cards.push(child);
            });
        });

        return cards.length ? cards : seedCards;
    }

    function getDominantCardSignature(seedCards) {
        if (!seedCards.length) {
            return '';
        }

        const signatureCounts = new Map();
        seedCards.forEach(card => {
            const signature = getCardSignature(card);
            signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
        });

        return [...signatureCounts.entries()]
            .sort((left, right) => right[1] - left[1])[0]?.[0] || '';
    }

    function collectCardsFromGridContainers(gridContainers, signature) {
        if (!signature) {
            return [];
        }

        const cards = [];
        const seenCards = new Set();

        gridContainers.forEach(container => {
            Array.from(container.children).forEach(child => {
                if (!(child instanceof HTMLElement)) {
                    return;
                }

                if (getCardSignature(child) !== signature) {
                    return;
                }

                if (!looksLikeProductCard(child) || seenCards.has(child)) {
                    return;
                }

                seenCards.add(child);
                cards.push(child);
            });
        });

        return cards;
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

                const hasProductContent = child.querySelector(PRODUCT_LINK_SELECTOR) && child.querySelector('img');
                if (!hasProductContent) {
                    return;
                }

                seenItems.add(child);
                items.push({
                    card: child,
                    container: wrapper,
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
            if (container.dataset.ssozonOriginalDisplay !== undefined) {
                container.style.display = container.dataset.ssozonOriginalDisplay;
                delete container.dataset.ssozonOriginalDisplay;
            } else {
                container.style.display = '';
            }
        });
    }

    function hideNativeGridContainers() {
        getNativeGridContainers().forEach(container => {
            if (container.dataset.ssozonOriginalDisplay === undefined) {
                container.dataset.ssozonOriginalDisplay = container.style.display || '';
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

    function sortProductsByReviews() {
        captureVisibleProducts();

        const gridContainers = getNativeGridContainers();
        if (!gridContainers.length) {
            alert('Контейнеры с товарами не найдены.');
            return false;
        }

        const gridWrappers = getGridWrappers(gridContainers);
        const cachedItems = Array.from(cachedProducts.values()).filter(item => item.cardSnapshot);
        if (!cachedItems.length) {
            alert('Карточки товаров не найдены.');
            return false;
        }

        const currentItemsSignature = getItemsSignature(cachedItems);
        if (currentItemsSignature && currentItemsSignature === lastSortedItemsSignature && getSortedRoot()) {
            console.log(`[OzonSort v${SCRIPT_VERSION}] Повторный клик без новых карточек. Сортировку пропускаю.`);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return true;
        }

        const desiredVisualOrder = [...cachedItems].sort((a, b) => {
            if (a.reviewsCount === 0 && b.reviewsCount === 0) {
                return a.firstSeenIndex - b.firstSeenIndex;
            }

            if (a.reviewsCount === 0) {
                return 1;
            }

            if (b.reviewsCount === 0) {
                return -1;
            }

            const reviewsDiff = b.reviewsCount - a.reviewsCount;
            if (reviewsDiff !== 0) {
                return reviewsDiff;
            }

            return a.firstSeenIndex - b.firstSeenIndex;
        });

        const rendered = renderSortedProducts(desiredVisualOrder, gridContainers, gridWrappers);
        if (!rendered) {
            alert('Не удалось построить отсортированный список.');
            return false;
        }

        lastSortedItemsSignature = currentItemsSignature;

        console.log(`[OzonSort v${SCRIPT_VERSION}] Карточки отсортированы по отзывам.`, {
            cached: desiredVisualOrder.length,
            topReviews: desiredVisualOrder.slice(0, 12).map(item => item.reviewsCount)
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return true;
    }

    async function customScrollAndSort() {
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

        const clampedSeconds = Math.max(1, Math.min(secondsValue, 180));
        const durationMs = Math.round(clampedSeconds * 1000);

        restoreNativeGridContainers();
        setButtonsEnabled(false);

        try {
            await scrollForDuration(durationMs, (_, remaining) => {
                const secondsLeft = Math.ceil(remaining / 1000);
                if (secondsLeft > 0) {
                    btnCustomScrollSort.textContent = `Листаю ещё ${secondsLeft} сек...`;
                } else {
                    btnCustomScrollSort.textContent = 'Готовлю сортировку...';
                }
            });

            btnCustomScrollSort.textContent = 'Сортирую...';

            sortProductsByReviews();
        } finally {
            btnCustomScrollSort.textContent = BUTTON_TEXTS.customScrollSort;
            setButtonsEnabled(true);
        }
    }

    function scrollForDuration(durationMs, onTick) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tickInterval = 280;
            onTick?.(0, durationMs);

            const interval = setInterval(() => {
                const doc = document.documentElement;
                const viewportHeight = window.innerHeight || doc.clientHeight || 800;
                const currentScrollTop = window.pageYOffset || doc.scrollTop || 0;
                const maxScrollTop = Math.max(0, doc.scrollHeight - viewportHeight - SCROLL_SETTINGS.gapFromBottomPx);
                const step = Math.max(SCROLL_SETTINGS.minStepPx, viewportHeight * SCROLL_SETTINGS.viewportStepRatio);
                const tentativeTarget = currentScrollTop + step;
                const targetScrollTop = Math.min(tentativeTarget, maxScrollTop);

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

    async function limitedScrollAndSort() {
        restoreNativeGridContainers();
        setButtonsEnabled(false);

        await scrollForDuration(10000, (_, remaining) => {
            const secondsLeft = Math.ceil(remaining / 1000);
            if (secondsLeft > 0) {
                btnTimedScrollSort.textContent = `Листаю ещё ${secondsLeft} сек...`;
            } else {
                btnTimedScrollSort.textContent = 'Готовлю сортировку...';
            }
        });

        btnTimedScrollSort.textContent = 'Сортирую...';

        sortProductsByReviews();

        btnTimedScrollSort.textContent = BUTTON_TEXTS.timedScrollSort;
        setButtonsEnabled(true);
    }

    btnSort.addEventListener('click', () => {
        setButtonsEnabled(false);
        const originalText = btnSort.textContent;
        btnSort.textContent = 'Сортирую...';
        sortProductsByReviews();
        btnSort.textContent = originalText;
        setButtonsEnabled(true);
    });

    btnTimedScrollSort.addEventListener('click', limitedScrollAndSort);
    btnCustomScrollSort.addEventListener('click', customScrollAndSort);
    toggleButton.addEventListener('click', () => {
        isCollapsed = !isCollapsed;
        updatePanelVisibility();
    });

    ensureCaptureObserverStarted();
    captureVisibleProducts();
    updatePanelVisibility();
})();
