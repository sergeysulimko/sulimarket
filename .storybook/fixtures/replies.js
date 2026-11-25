// A complete in-memory transport for the source's seller calls. No request leaves the fixture.
export function mockSellerFetch(setup) {
    const json = data => new Response(JSON.stringify(data));
    return async (url, options) => {
        const request = new URL(url, 'https://fixture.invalid');
        const shop = request.searchParams.get('url');
        if (shop?.startsWith('/modal/shop-in-shop-info?')) {
            if (setup === 'offers-loading' || setup === 'offers-sort-loading') {
                return new Promise(() => {});
            }
            if (setup === 'offers-error') return new Response(null, { status: 503 });
            const few = shop.endsWith('472');
            const cells = [
                ['Средняя оценка товаров', few ? '4,7 из 5' : '4,9 из 5'],
                ['Количество отзывов', few ? '82' : '4 240'],
                ['Заказов', few ? '24' : '44,3 K'],
                ['Работает с Ozon', few ? '3 месяца' : '2 года']
            ].map(([title, value]) => ({
                dsCell: { centerBlock: { title: { text: title } }, rightBlock: { badge: { text: value } } }
            }));
            return json({ widgetStates: { shop: JSON.stringify({ cells }) } });
        }
        if (request.searchParams.get('card')?.endsWith('/info/ru/card.json')) {
            return json({ selling: { supplier_id: request.searchParams.get('card').startsWith('/202/') ? 472 : 471 } });
        }
        if (request.pathname.endsWith('/suppliers/find_by_ids')) {
            if (setup === 'offers-sort-loading') return new Promise(() => {});
            return json(JSON.parse(options.body).map(id => ({
                id, valuation: id === 471 ? 4.9 : 4.7, feedbacksCount: id === 471 ? 4240 : 82,
                saleItemQuantity: id === 471 ? 44300 : 24, registrationDate: '2024-04-15'
            })));
        }
        const name = request.pathname.match(/\/supplier-by-id\/(\d+)\.json$/);
        if (name) return json({ trademark: name[1] === '471' ? 'Аудиомаркет' : 'Технолавка' });
        window.fixtureError = `Unhandled fixture request: ${url}`;
        throw new Error(window.fixtureError);
    };
}

export function mockChrome(setup, version) {
    const state = {
        site: setup === 'wb' ? 'wb' : 'ozon',
        busy: setup === 'busy',
        sorted: setup === 'sorted' || setup === 'rate',
        count: setup === 'empty' ? 0 : 48,
        top: 2842,
        sortCount: setup === 'rate' ? 3 : 0,
        keepSorted: setup !== 'unchecked',
        showButton: setup !== 'unchecked',
        customSeconds: setup === 'custom' ? 7 : 0,
        lastSeconds: setup.startsWith('preset-') ? Number(setup.slice(7)) : 0
    };
    window.chrome = {
        runtime: { getManifest: () => ({ version }) },
        tabs: {
            query: async () => [{
                id: 1, url: setup === 'other' ? 'https://fixture.invalid/' :
                    state.site === 'ozon' ? 'https://www.ozon.ru/search/' : 'https://www.wildberries.ru/catalog/'
            }],
            sendMessage: async (_id, { command, value, seconds }) => {
                if (setup === 'error') throw new Error('Fixture connection closed');
                if (command === 'keep') state.keepSorted = value;
                if (command === 'show') state.showButton = value;
                if (command === 'load') Object.assign(state, { busy: true, lastSeconds: seconds });
                if (command === 'sort' || command === 'stop') {
                    Object.assign(state, { busy: false, sorted: true, sortCount: state.sortCount + 1 });
                }
                if (command === 'restore') state.sorted = false;
                if (command === 'rated') state.rateAsked = true;
                return { ...state };
            }
        }
    };
}
