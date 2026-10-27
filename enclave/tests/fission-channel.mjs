import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.Services = { env: { get: () => '' }, focus: {} };
const source = fs.readFileSync(new URL('../../juggler/FissionChannel.js', import.meta.url), 'utf8');
const { FissionChannel } = await import('data:text/javascript,' + encodeURIComponent(source));
const channels = [];
class Channel {
  constructor(name, uid) { this.uid = uid; this.handlers = new Map(); this.requests = []; channels.push(this); }
  bindToActor(actor) { this.actor = actor; }
  resetTransport() { this.actor = undefined; }
  register(namespace, handler) { this.handlers.set(namespace, handler); }
  unregister(namespace) { this.handlers.delete(namespace); }
  connect(namespace) { return { send: async (method, ...args) => { this.requests.push({ namespace, method, args }); return this.uid; }, dispose() {} }; }
  dispose() { this.disposed = true; }
}
const mux = new FissionChannel(Channel, 'test', 'page');
const top = { browsingContext: { id: 1, parent: null } };
const child = { browsingContext: { id: 2, parent: top.browsingContext } };
top.browsingContext.top = top.browsingContext;
child.browsingContext.top = top.browsingContext;
mux.bindToActor(top); mux.bindToActor(child);
const events = [];
mux.register('page', new Proxy({}, { get: (_, name) => value => events.push({ name, value }) }));
const [main, remote] = channels;
const mainEvents = main.handlers.get('page'), childEvents = remote.handlers.get('page');
mainEvents.pageFrameAttached({ frameId: 'main' });
childEvents.pageFrameAttached({ frameId: 'child', parentFrameId: 'main' });
mainEvents.runtimeExecutionContextCreated({ executionContextId: 'p1-id1' });
childEvents.runtimeExecutionContextCreated({ executionContextId: 'p2-id1' });
const page = mux.connect('page');
assert.equal(await page.send('evaluate', { executionContextId: 'p1-id1' }), 'page/main');
assert.equal(await page.send('evaluate', { executionContextId: 'p2-id1' }), 'page/2');
assert.equal(await page.send('describeNode', { frameId: 'child' }), 'page/2');
Services.focus.focusedContentBrowsingContext = child.browsingContext;
assert.equal(await page.send('insertText', { text: 'remote' }), 'page/2');
assert.equal(await page.send('dispatchKeyEvent', { type: 'keydown' }), 'page/2');
Services.focus.focusedContentBrowsingContext = { id: 3, top: top.browsingContext, parent: child.browsingContext };
assert.equal(await page.send('insertText', { text: 'nested same-process' }), 'page/2');
Services.focus.focusedContentBrowsingContext = { id: 9, top: {} };
assert.equal(await page.send('insertText', { text: 'other tab cannot receive input' }), 'page/main');
Services.focus.focusedContentBrowsingContext = null;
childEvents.runtimeExecutionContextsCleared({});
assert.deepEqual(events.filter(e => e.name === 'runtimeExecutionContextDestroyed').map(e => e.value.executionContextId), ['p2-id1']);
assert.equal(events.filter(e => e.name === 'runtimeExecutionContextsCleared').length, 0);
assert.equal(await page.send('evaluate', { executionContextId: 'p1-id1' }), 'page/main');
await assert.rejects(page.send('evaluate', { executionContextId: 'p2-id1' }), /destroyed/);
childEvents.pageReady({});
assert.equal(events.filter(e => e.name === 'pageReady').length, 0);
await mux.connect('').send('setInitScripts', ['fixture']);
assert.equal(main.requests.at(-1).method, 'setInitScripts');
assert.equal(remote.requests.at(-1).method, 'setInitScripts');
const replacement = { browsingContext: child.browsingContext };
mux.bindToActor(replacement);
mux.removeActor(child);
assert.equal(remote.actor, replacement);
childEvents.runtimeExecutionContextCreated({ executionContextId: 'replacement' });
assert.equal(await page.send('evaluate', { executionContextId: 'replacement' }), 'page/2');
replacement.browsingContext.isDiscarded = true;
mux.removeActor(replacement);
await assert.rejects(page.send('evaluate', { executionContextId: 'replacement' }), /destroyed/);
assert.equal(remote.disposed, true);
assert.equal(events.filter(e => e.name === 'pageFrameDetached').length, 1);
mainEvents.runtimeExecutionContextCreated({ executionContextId: 'returned', auxData: { frameId: 'child' } });
assert.equal(await page.send('describeNode', { frameId: 'child' }), 'page/main');
mux.dispose();
assert.equal(main.disposed, true);
console.log('PASS: isolated frame routing, context lifecycle, setting broadcasts, stale actor rejection and cleanup');
