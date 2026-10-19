// ==UserScript==
// @name         SSOzon
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Сортируй как хуй
// @author       Sulimko
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

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

    function createToggleButton() {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = 'Сортировка отзывов';
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
    const btnSort = createButton(BUTTON_TEXTS.sort);
    const btnTimedScrollSort = createButton(BUTTON_TEXTS.timedScrollSort);
    const btnCustomScrollSort = createButton(BUTTON_TEXTS.customScrollSort);

    panel.appendChild(btnSort);
    panel.appendChild(btnTimedScrollSort);
    panel.appendChild(btnCustomScrollSort);
    const toggleButton = createToggleButton();
    wrapper.appendChild(panel);
    wrapper.appendChild(toggleButton);
    document.body.appendChild(wrapper);

    let isCollapsed = true;

    function updatePanelVisibility() {
        if (isCollapsed) {
            panel.style.display = 'none';
            toggleButton.textContent = 'Сортировка отзывов';
        } else {
            panel.style.display = 'flex';
            toggleButton.textContent = 'Скрыть панель';
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

    function getReviewsCount(card) {
        const spans = card.querySelectorAll('span');
        for (const span of spans) {
            if (span.textContent.includes('отзыв')) {
                const numberText = span.textContent.replace(/[^\d]/g, '');
                return parseInt(numberText, 10) || 0;
            }
        }
        return 0;
    }

    function sortProductsByReviews() {
        const gridContainers = document.querySelectorAll('div[data-widget="tileGridDesktop"]');
        if (!gridContainers.length) {
            alert('Контейнеры с товарами не найдены.');
            return false;
        }

        const cards = [];
        gridContainers.forEach(container => {
            cards.push(...container.children);
        });

        if (!cards.length) {
            alert('Карточки товаров не найдены.');
            return false;
        }

        const sortedCards = cards
            .map(card => [card, getReviewsCount(card)])
            .sort((a, b) => {
                if (a[1] === 0 && b[1] === 0) return 0;
                if (a[1] === 0) return 1;
                if (b[1] === 0) return -1;
                return b[1] - a[1];
            });

        const firstContainer = gridContainers[0];
        sortedCards.forEach(([card]) => {
            firstContainer.appendChild(card);
        });

        console.log('[OzonSort] Карточки отсортированы по отзывам.');
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

    updatePanelVisibility();
})();
