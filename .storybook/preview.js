export default {
    parameters: { layout: 'fullscreen' },
    globalTypes: {
        theme: {
            description: 'Тема SuliMarket',
            toolbar: {
                icon: 'circlehollow',
                items: [{ value: 'light', title: 'Светлая' }, { value: 'dark', title: 'Тёмная' }],
                dynamicTitle: true
            }
        }
    },
    initialGlobals: { theme: 'light' }
};
