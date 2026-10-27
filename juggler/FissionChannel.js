/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export class FissionChannel {
  constructor(Channel, name, uid) {
    this._Channel = Channel;
    this._name = name;
    this._uid = uid;
    this._handlers = new Map();
    this._frames = new Map();
    this._contexts = new Map();
    this._workers = new Map();
    this._children = new Map();
    this._main = this._create('main', true);
  }

  _create(id, main) {
    const endpoint = { channel: new this._Channel(this._name, `${this._uid}/${id}`), main, actor: undefined };
    for (const [namespace, handler] of this._handlers)
      this._register(endpoint, namespace, handler);
    return endpoint;
  }

  _register(endpoint, namespace, handler) {
    endpoint.channel.register(namespace, new Proxy({}, {
      get: (_, method) => (...args) => {
        const event = args[0];
        if (namespace === 'page') {
          if (method === 'runtimeExecutionContextsCleared') {
            for (const [id, owner] of this._contexts) {
              if (owner !== endpoint) continue;
              this._contexts.delete(id);
              handler.runtimeExecutionContextDestroyed?.({ executionContextId: id });
            }
            return;
          }
          if (method === 'pageReady' && !endpoint.main) return;
          if (method === 'pageFrameAttached') {
            const known = this._frames.has(event.frameId);
            this._frames.set(event.frameId, endpoint);
            if (known) return;
          }
          if (method === 'pageFrameDetached') this._frames.delete(event.frameId);
          if (method === 'runtimeExecutionContextCreated') {
            this._contexts.set(event.executionContextId, endpoint);
            if (event.auxData?.frameId) this._frames.set(event.auxData.frameId, endpoint);
          }
          if (method === 'runtimeExecutionContextDestroyed') this._contexts.delete(event.executionContextId);
          if (method === 'pageWorkerCreated') this._workers.set(event.workerId, endpoint);
          if (method === 'pageWorkerDestroyed') this._workers.delete(event.workerId);
        }
        return handler[method]?.(...args);
      },
    }));
  }

  bindToActor(actor) {
    let endpoint = this._main;
    if (actor.browsingContext.parent) {
      const id = actor.browsingContext.id;
      endpoint = this._children.get(id);
      if (!endpoint) {
        endpoint = this._create(id, false);
        this._children.set(id, endpoint);
      }
    }
    endpoint.actor = actor;
    endpoint.channel.bindToActor(actor);
  }

  removeActor(actor) {
    const endpoint = actor.browsingContext.parent ? this._children.get(actor.browsingContext.id) : this._main;
    if (endpoint?.actor !== actor) return;
    endpoint.actor = undefined;
    endpoint.channel.resetTransport();
    for (const [id, owner] of this._contexts) {
      if (owner !== endpoint) continue;
      this._contexts.delete(id);
      this._handlers.get('page')?.runtimeExecutionContextDestroyed?.({ executionContextId: id });
    }
    if (actor.browsingContext.isDiscarded && !endpoint.main) {
      for (const [id, owner] of this._frames) {
        if (owner !== endpoint) continue;
        this._frames.delete(id);
        this._handlers.get('page')?.pageFrameDetached?.({ frameId: id });
      }
      endpoint.channel.dispose();
      this._children.delete(actor.browsingContext.id);
    }
  }

  register(namespace, handler) {
    if (this._handlers.has(namespace)) throw new Error(`Duplicate namespace ${namespace}`);
    this._handlers.set(namespace, handler);
    for (const endpoint of [this._main, ...this._children.values()]) this._register(endpoint, namespace, handler);
    return () => {
      this._handlers.delete(namespace);
      for (const endpoint of [this._main, ...this._children.values()]) endpoint.channel.unregister(namespace);
    };
  }

  connect(namespace) {
    const connectors = new Map();
    const connector = endpoint => {
      if (!connectors.has(endpoint)) connectors.set(endpoint, endpoint.channel.connect(namespace));
      return connectors.get(endpoint);
    };
    const send = async (method, ...args) => {
      if (namespace === '' && method !== 'awaitViewportDimensions') {
        await Promise.all([this._main, ...this._children.values()].filter(e => e === this._main || e.actor).map(e => connector(e).send(method, ...args)));
        return;
      }
      const options = args[0] || {};
      let endpoint = this._main;
      if (namespace === 'page') {
        if (options.executionContextId) endpoint = this._contexts.get(options.executionContextId);
        else if (options.frameId) endpoint = this._frames.get(options.frameId);
        else if (method === 'insertText' || method === 'dispatchKeyEvent') {
          let focused = Services.focus.focusedContentBrowsingContext;
          if (focused?.top === this._main.actor?.browsingContext) {
            while (focused.parent && !this._children.get(focused.id)?.actor) focused = focused.parent;
            endpoint = this._children.get(focused.id) || this._main;
          }
        }
      } else if (namespace) endpoint = this._workers.get(namespace);
      if (!endpoint) throw new Error('Execution context or frame was destroyed');
      const result = await connector(endpoint).send(method, ...args);
      if (method === 'getContentQuads' && !endpoint.main) {
        const origin = await this._main.channel.connect('page').send('getScreenOrigin');
        for (const quad of result.quads) {
          for (const point of Object.values(quad)) {
            point.x += result.screenOrigin.x - origin.x;
            point.y += result.screenOrigin.y - origin.y;
          }
        }
      }
      if (method === 'getContentQuads') delete result.screenOrigin;
      return result;
    };
    return { send, emit: (...args) => void send(...args).catch(() => {}), dispose: () => { for (const c of connectors.values()) c.dispose(); } };
  }

  dispose() {
    for (const endpoint of [this._main, ...this._children.values()]) endpoint.channel.dispose();
    this._handlers.clear();
    this._frames.clear();
    this._contexts.clear();
    this._workers.clear();
    this._children.clear();
  }
}
