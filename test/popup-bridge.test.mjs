import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/popup-bridge.js', import.meta.url), 'utf8');
function setup() {
    const calls = [];
    const values = {};
    let listener;
    const scope = {
        site: { id: 'ozon', capture() {}, isSorted: () => false, visibleCount: () => 20, isListing: () => true },
        lastResult: null, scrollRun: null, MAX_SCROLL_SECONDS: 180,
        store: { get: (key, fallback) => values[key] ?? fallback, set: (key, value) => { values[key] = value; } },
        ui: { keepSorted: () => true, setKeepSorted: value => calls.push(['keep', value]), setVisible: value => calls.push(['show', value]) },
        actions: Object.fromEntries(['sort', 'stopScroll', 'restore', 'scrollAndSort'].map(name => [name, (...args) => calls.push([name, ...args])])),
        chrome: { runtime: { id: 'our-extension', onMessage: { addListener(fn) { listener = fn; } } } }
    };
    vm.runInNewContext(source, scope);
    return {
        calls, scope, values,
        send(command, extra = {}, id = 'our-extension') {
            let response;
            listener({ channel: 'sulimarket:popup', command, ...extra }, { id }, value => { response = value; });
            return response;
        }
    };
}

test('messages from another extension and another channel have no effect', () => {
    const bridge = setup();
    assert.equal(bridge.send('sort', {}, 'another-extension'), undefined);
    assert.equal(bridge.send('sort', { channel: 'other' }), undefined);
    assert.deepEqual(bridge.calls, []);
});

test('timed loading accepts whole seconds within the core limit only', () => {
    const bridge = setup();
    for (const seconds of [0, -1, 181, 1.5, '5', null, Infinity]) {
        assert.ok(bridge.send('load', { seconds }).error);
    }
    assert.deepEqual(bridge.calls, []);
    bridge.send('load', { seconds: 8, custom: true });
    assert.deepEqual(bridge.calls, [['scrollAndSort', 8]]);
    assert.equal(bridge.values.customSeconds, 8);
});

test('busy work cannot be replaced by sort, restore or a second load', () => {
    const bridge = setup();
    bridge.scope.scrollRun = { stop: false };
    bridge.send('sort'); bridge.send('restore'); bridge.send('load', { seconds: 3 });
    assert.deepEqual(bridge.calls, []);
    bridge.send('stop');
    assert.deepEqual(bridge.calls, [['stopScroll']]);
});

test('preference values must be booleans and persist through the existing store', () => {
    const bridge = setup();
    bridge.send('keep', { value: 'false' }); bridge.send('show', { value: null });
    assert.deepEqual(bridge.calls, []);
    bridge.send('keep', { value: false }); bridge.send('show', { value: false });
    assert.equal(bridge.values.keepSorted, false);
    assert.equal(bridge.values.showButton, false);
    assert.deepEqual(bridge.calls, [['keep', false], ['show', true]]);
});

test('popup status uses the current core result, without fabricated values', () => {
    const bridge = setup();
    bridge.scope.lastResult = { count: 72, top: 87019 };
    const state = bridge.send('status');
    assert.equal(state.count, 72); assert.equal(state.top, 87019);
    bridge.scope.lastResult = null;
    assert.equal(bridge.send('status').count, 20);
    assert.equal(bridge.send('unknown'), undefined);
});
