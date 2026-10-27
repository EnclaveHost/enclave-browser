import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const locked = new Map();
const defaults = new Map();
vm.runInNewContext(read('enclave/enclave.cfg'), {
  defaultPref: (name, value) => defaults.set(name, value),
  lockPref: (name, value) => locked.set(name, value),
});
assert.equal(locked.get('javascript.options.content_process_write_protect_code'), true);
assert.equal(locked.get('fission.autostart'), true);
assert.equal(locked.get('fission.webContentIsolationStrategy'), 1);
for (const pref of ['browser.safebrowsing.malware.enabled', 'browser.safebrowsing.phishing.enabled', 'browser.safebrowsing.downloads.enabled', 'extensions.blocklist.enabled', 'security.fileuri.strict_origin_policy'])
  assert.equal(locked.get(pref), true, pref);
assert.equal(defaults.get('dom.ipc.processCount'), 2);
assert.equal(defaults.get('layout.frame_rate'), 30);
assert.equal(defaults.get('accessibility.force_disabled'), 0);

async function activation(flag, environment) {
  let actors = 0;
  const prefs = new Map();
  const context = vm.createContext({
    Services: {
      scriptloader: { loadSubScript() {} },
      env: { get: () => environment },
      obs: { addObserver() {}, removeObserver() {} },
      prefs: {
        setBoolPref: (key, value) => prefs.set(key, value),
        setIntPref: (key, value) => prefs.set(key, value),
      },
    },
    Components: { classes: {}, interfaces: {}, ID: id => id },
    ChromeUtils: {
      importESModule: () => ({
        Helper: class {},
        ActorManagerParent: { addJSWindowActors: () => ++actors },
      }),
      generateQI() {},
    },
  });
  const module = new vm.SourceTextModule(read('juggler/components/Juggler.js'), { context });
  await module.link(() => { throw new Error('Unexpected ES module dependency'); });
  await module.evaluate();
  assert.equal(actors, 0, 'Desktop startup must not install automation actors');
  const instance = new module.namespace.JugglerFactory();
  let error;
  try {
    await instance.observe({ handleFlag: () => flag, findFlag: () => -1 }, 'command-line-startup');
  } catch (e) {
    error = e;
  }
  return { actors, prefs, error };
}
for (const env of ['', '1']) {
  const result = await activation(false, env);
  assert.equal(result.actors, 0);
  assert.equal(result.prefs.size, 0);
  assert.equal(result.error, undefined);
}
const refused = await activation(true, '');
assert.match(refused.error.message, /requires ENCLAVE_BROWSER_AUTOMATION=1/);
assert.equal(refused.actors, 0);
assert.equal(refused.prefs.size, 0);
const enabled = await activation(true, '1');
assert.equal(enabled.error, undefined);
assert.equal(enabled.actors, 1);
assert.equal(enabled.prefs.get('permissions.isolateBy.userContext'), true);
assert.equal(enabled.prefs.has('fission.webContentIsolationStrategy'), false);

function actualMethod(file, start, end, params) {
  const source = read(file);
  const body = source.slice(source.indexOf(start) + start.length, source.indexOf(end, source.indexOf(start)));
  return new Function(params, body.slice(0, body.lastIndexOf('}')));
}
const tls = actualMethod('juggler/TargetRegistry.js', '  setIgnoreHTTPSErrors(ignoreHTTPSErrors) {', '\n  setDefaultUserAgent', 'ignoreHTTPSErrors');
assert.throws(() => tls.call({}, true), /forbids ignoring TLS/);
const state = {};
tls.call(state, false);
assert.equal(state.ignoreHTTPSErrors, false);
assert.doesNotMatch(read('security/manager/ssl/nsCertOverrideService.cpp'), /if \(1 == 1\)/);
assert.doesNotMatch(read('toolkit/components/enterprisepolicies/EnterprisePoliciesParent.sys.mjs'), /new PlaywrightPoliciesProvider/);
assert.doesNotMatch(read('services/settings/Utils.sys.mjs'), /return true \|\|/);
assert.match(read('juggler/protocol/BrowserHandler.js'), /if \(bypassCSP\)\s+throw new Error\('Enclave Browser policy forbids/);
console.log('PASS: desktop activation isolation, explicit automation opt-in, locked policy, TLS rejection, and upstream policy providers');
