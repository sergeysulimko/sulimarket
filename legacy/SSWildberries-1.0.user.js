// ==UserScript==
// @name         SSWildberries
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Сортировка карточек Wildberries по количеству оценок
// @author       Sulimko
// @match        https://www.wildberries.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '1.1';
    const CARD_SELECTOR = '.product-card.j-card-item';
    const LIST_SELECTOR = '.product-card-list';
    const PRODUCT_LINK_SELECTOR = 'a.product-card__link[href*="/catalog/"][href*="/detail.aspx"]';
    const RATING_COUNT_SELECTOR = '.product-card__count';

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

    let isCollapsed = true;
    let lastSortedItemsSignature = '';

    function getCollapsedToggleText() {
        return `Сортировка WB v${SCRIPT_VERSION}`;
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
        panel.style.minWidth = '220px';
        panel.style.background = 'rgba(255, 255, 255, 0.98)';
        panel.style.borderRadius = '14px';
        panel.style.boxShadow = '0 10px 26px rgba(167, 58, 253, 0.22)';
        panel.style.border = '1px solid rgba(167, 58, 253, 0.16)';
        panel.style.backdropFilter = 'blur(6px)';
        return panel;
    }

    function createVersionBadge() {
        const badge = document.createElement('div');
        badge.textContent = `SSWildberries v${SCRIPT_VERSION}`;
        badge.style.alignSelf = 'flex-start';
        badge.style.padding = '4px 10px';
        badge.style.background = 'rgba(167, 58, 253, 0.08)';
        badge.style.color = '#8d2de2';
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
        toggle.style.background = '#8d2de2';
        toggle.style.color = '#ffffff';
        toggle.style.fontSize = '13px';
        toggle.style.fontWeight = '600';
        toggle.style.border = 'none';
        toggle.style.borderRadius = '999px';
        toggle.style.cursor = 'pointer';
        toggle.style.boxShadow = '0 8px 18px rgba(141, 45, 226, 0.3)';
        toggle.style.transition = 'transform 0.16s ease, box-shadow 0.16s ease, opacity 0.2s ease';

        toggle.addEventListener('mouseenter', () => {
            if (toggle.disabled) {
                return;
            }
            toggle.style.transform = 'translateY(-1px)';
            toggle.style.boxShadow = '0 12px 22px rgba(141, 45, 226, 0.36)';
        });

        toggle.addEventListener('mouseleave', () => {
            toggle.style.transform = 'translateY(0)';
            toggle.style.boxShadow = '0 8px 18px rgba(141, 45, 226, 0.3)';
        });

        return toggle;
    }

    function createButton(text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.style.padding = '9px 16px';
        btn.style.minWidth = '210px';
        btn.style.background = '#fbf5ff';
        btn.style.color = '#2d1b43';
        btn.style.border = '1px solid rgba(167, 58, 253, 0.16)';
        btn.style.borderRadius = '10px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '13px';
        btn.style.fontWeight = '600';
        btn.style.boxShadow = '0 4px 12px rgba(167, 58, 253, 0.12)';
        btn.style.userSelect = 'none';
        btn.style.transition = 'transform 0.16s ease, box-shadow 0.16s ease, opacity 0.2s ease, background 0.2s ease';

        btn.addEventListener('mouseenter', () => {
            if (btn.disabled) {
                return;
            }
            btn.style.transform = 'translateY(-1px)';
            btn.style.boxShadow = '0 8px 16px rgba(167, 58, 253, 0.18)';
            btn.style.background = '#f4e8ff';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0)';
            btn.style.boxShadow = '0 4px 12px rgba(167, 58, 253, 0.12)';
            btn.style.background = '#fbf5ff';
        });

        return btn;
    }

    function parseInteger(value) {
        return parseInt(String(value || '').replace(/[^\d]/g, ''), 10) || 0;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getRatingCount(card) {
        const exactNode = card.querySelector(RATING_COUNT_SELECTOR);
        if (exactNode) {
            const exactText = normalizeText(exactNode.textContent);
            if (exactText) {
                return parseInteger(exactText);
            }
        }

        return 0;
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
            btn.style.boxShadow = '0 4px 12px rgba(167, 58, 253, 0.12)';
            btn.style.background = '#fbf5ff';
        });

        toggleButton.disabled = !isEnabled;
        toggleButton.style.cursor = isEnabled ? 'pointer' : 'not-allowed';
        toggleButton.style.opacity = opacity;
        toggleButton.style.transform = 'translateY(0)';
    }

    function sortProductsByRatings() {
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
            alert('Карточки товаров Wildberries не найдены.');
            return false;
        }

        const currentItemsSignature = getItemsSignature(items);
        if (currentItemsSignature && currentItemsSignature === lastSortedItemsSignature) {
            console.log(`[SSWildberries v${SCRIPT_VERSION}] Повторный клик без новых карточек. Сортировку пропускаю.`);
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

        console.log(`[SSWildberries v${SCRIPT_VERSION}] Карточки отсортированы по количеству оценок.`, {
            count: sortedItems.length,
            topRatings: sortedItems.slice(0, 12).map(item => item.ratingsCount)
        });

        window.scrollTo({ top: 0, behavior: 'smooth' });
        return true;
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

        setButtonsEnabled(buttons, toggleButton, false);

        try {
            await scrollForDuration(durationMs, (_, remaining) => {
                const secondsLeft = Math.ceil(remaining / 1000);
                button.textContent = secondsLeft > 0 ? `Листаю ещё ${secondsLeft} сек...` : 'Готовлю сортировку...';
            });

            button.textContent = 'Сортирую...';
            sortProductsByRatings();
        } finally {
            button.textContent = BUTTON_TEXTS.customScrollSort;
            setButtonsEnabled(buttons, toggleButton, true);
        }
    }

    async function limitedScrollAndSort(buttons, toggleButton, button) {
        setButtonsEnabled(buttons, toggleButton, false);

        try {
            await scrollForDuration(10000, (_, remaining) => {
                const secondsLeft = Math.ceil(remaining / 1000);
                button.textContent = secondsLeft > 0 ? `Листаю ещё ${secondsLeft} сек...` : 'Готовлю сортировку...';
            });

            button.textContent = 'Сортирую...';
            sortProductsByRatings();
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
            sortProductsByRatings();
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

    updatePanelVisibility(panel, toggleButton);
})();
