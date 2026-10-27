"use strict";

const { Helper } = ChromeUtils.importESModule('chrome://juggler/content/Helper.js');
const { initialize } = ChromeUtils.importESModule('chrome://juggler/content/content/main.js');

const Ci = Components.interfaces;
const helper = new Helper();

let sameProcessInstanceNumber = 0;

const localRootToAgents = new Map();

export class JugglerFrameChild extends JSWindowActorChild {
  constructor() {
    super();

    this._eventListeners = [];
  }

  handleEvent(aEvent) {
    const agents = this._agents();
    if (!agents)
      return;
    if (aEvent.type === 'DOMWillOpenModalDialog') {
      agents.channel.pause();
      return;
    }
    if (aEvent.type === 'DOMModalDialogClosed') {
      agents.channel.resumeSoon();
      return;
    }
    if (aEvent.target === this.document) {
      agents.pageAgent.onWindowEvent(aEvent);
      agents.frameTree.onWindowEvent(aEvent);
    }
  }

  _agents() {
    let root = this.browsingContext;
    while (root.parent?.docShell) root = root.parent;
    return localRootToAgents.get(root);
  }

  actorCreated() {
    this._isProcessRoot = this.manager.isProcessRoot;
    if (Services.env.get("ENCLAVE_JUGGLER_TRACE")) dump(`FISSION child ${this.browsingContext.id} root=${this._isProcessRoot} parent=${this.browsingContext.parent?.id}\n`);
    this.actorName = `content::${this.browsingContext.browserId}/${this.browsingContext.id}/${++sameProcessInstanceNumber}`;

    this._eventListeners.push(helper.addEventListener(this.contentWindow, 'load', event => {
      this._agents()?.pageAgent.onWindowEvent(event);
    }));

    if (this.document.documentURI.startsWith('moz-extension://'))
      return;

    // Same-process children share their process-root agents.
    if (!this._isProcessRoot)
      return;

    let agents = localRootToAgents.get(this.browsingContext);
    if (!agents) {
      agents = initialize(this.browsingContext, this.docShell);
      localRootToAgents.set(this.browsingContext, agents);
    }
    agents.channel.bindToActor(this);
    agents.actor = this;
  }

  didDestroy() {
    helper.removeListeners(this._eventListeners);

    if (!this._isProcessRoot)
      return;

    const agents = localRootToAgents.get(this.browsingContext);
    // The agents are already re-bound to a new actor.
    if (agents?.actor !== this)
      return;

    localRootToAgents.delete(this.browsingContext);

    agents.channel.resetTransport();
    agents.pageAgent.dispose();
    agents.frameTree.dispose();
  }

  receiveMessage() { }
}

