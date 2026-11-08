// This file is appended inside the extension wrapper, sharing the existing core actions.
function popupState() {
    site.capture();
    return {
        site: site.id,
        sorted: site.isSorted(),
        busy: Boolean(scrollRun),
        count: lastResult?.count ?? site.visibleCount(),
        top: lastResult?.top ?? 0,
        keepSorted: ui.keepSorted(),
        showButton: store.get('showButton', true),
        lastSeconds: store.get('lastSeconds', 0),
        customSeconds: store.get('customSeconds', ''),
        sortCount: store.get('sortCount', 0),
        rateAsked: store.get('rateAsked', false)
    };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.channel !== 'sulimarket:popup') return;
    switch (message.command) {
        case 'status': break;
        case 'rated': store.set('rateAsked', true); break;
        case 'sort': if (!scrollRun) actions.sort(); break;
        case 'stop': actions.stopScroll(); break;
        case 'restore': if (!scrollRun) actions.restore(); break;
        case 'keep':
            if (typeof message.value !== 'boolean') return;
            store.set('keepSorted', message.value);
            ui.setKeepSorted(message.value);
            break;
        case 'show':
            if (typeof message.value !== 'boolean') return;
            store.set('showButton', message.value);
            ui.setVisible(site.isListing() || site.isSorted() || Boolean(scrollRun));
            break;
        case 'load':
            if (!Number.isInteger(message.seconds) || message.seconds < 1 || message.seconds > MAX_SCROLL_SECONDS) {
                respond({ error: 'Укажите от 1 до 180 секунд.' });
                return;
            }
            if (!scrollRun) {
                store.set('lastSeconds', message.seconds);
                if (message.custom) store.set('customSeconds', message.seconds);
                actions.scrollAndSort(message.seconds);
            }
            break;
        default: return;
    }
    respond(popupState());
});
