// The pinned styles are shipped inside both builds. Limit their selectors to our UI roots on the host page.
export function marketStyles(tokens, primitives, brand, market, font) {
    const roots = '[data-ssm-ui], [data-ssm-shop]';
    const language = [tokens, primitives, brand].join('\n');
    const fontFace = `@font-face { font-family: "SuliMarket Inter"; src: url("${font}") format("woff2"); font-weight: 100 900; font-display: swap; }`;
    return {
        page: `${fontFace}
@scope (${roots}) {
${language.replaceAll(':root', ':scope').replace(/:scope\[(?:data-theme)="(?:light|dark)"\]/g, ':scope:not(*)').replace(':scope:not([data-theme="light"])', ':scope')}
${market}
}`,
        shadow: `${language.replaceAll(':root', ':host').replace(/:host\[(?:data-theme)="(?:light|dark)"\]/g, ':host(:not(*))').replace(':host:not([data-theme="light"])', ':host')}
${market}`
    };
}
