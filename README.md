# Enclave Browser

**A Firefox ESR fork for Enclave virtual desktops and AI agents.**

Enclave Browser combines the Firefox engine with the lightweight desktop settings
used in KVM Box Native, Enclave policy defaults, and a source port of Playwright's
Firefox automation backend. Its purpose is to give people and agents a useful
browser inside an Enclave VM while keeping the browser compatible with the
platform's memory protections.

## What makes it different

### Policy-aware execution

The bundled configuration locks
`javascript.options.content_process_write_protect_code` on. Firefox's content
JIT must switch code pages between writable and executable states instead of
requesting writable executable pages. JIT remains enabled for modern websites.
The VM's enforcement is a separate layer; this preference does not itself turn a
browser into an enclave or prove that every executable mapping meets the policy.

Site isolation stays enabled, including cross-site iframe isolation. Safe Browsing,
certificate validation, extension blocklists, and local-file origin restrictions
are retained. The automation port does not replace the normal enterprise-policy
provider or globally disable Remote Settings. Requests to ignore TLS errors or
bypass Content Security Policy are explicitly rejected by the Juggler backend.

### A lighter virtual desktop

The default profile carries forward KVM Box Native's tuning: two general web
content processes, no process prelaunch, reduced tab previews and animations,
a 30 fps rendering target, bounded history and disk cache, and less background
prefetching and telemetry. Firefox may still create additional processes for site
isolation and other services; two is not a total process limit.

The optional desktop launcher preserves the X11 input settings and software
rendering fallback used by the VM. These are VM defaults, not a claim that software
rendering is faster on every machine. Media codecs, audio, display transport, and
YouTube performance also depend on the VM image and host configuration.

### Automation in the browser engine

This tree includes Playwright's Juggler implementation and its native Gecko
patches, rather than only installing a Selenium or Playwright package beside a
stock browser. The initial client version is pinned to **Playwright 1.62.1**.

Juggler activates only when both `--juggler-pipe` and
`ENCLAVE_BROWSER_AUTOMATION=1` are supplied. It communicates over inherited local
file descriptors, with no Juggler TCP listener. Use an isolated automation profile;
do not attach automation to a personal profile containing signed-in sessions.
The environment flag is an opt-in switch, not a security boundary against another
program running as the same OS user.

Normal desktop launches do not register the Juggler frame actors or enable its
input-testing preferences. Both modes load the same locked Enclave policy.
Playwright's broad test-only preference bundle is intentionally not installed.
Standard Firefox WebDriver components remain in the source tree.

### A maintainable ESR fork

The initial base is **Firefox ESR 153.5.1**, tag
`FIREFOX_153_5_1esr_RELEASE`. The Playwright import is pinned to commit
`26a9e470a7b3c7822084b09fb7f13902c5f37b51` and is separate from the Enclave changes.
[`enclave/upstream.json`](enclave/upstream.json) records upstream revisions and
source hashes so future ESR security updates and automation changes can be
reviewed independently.

The original native VM used Debian's Firefox ESR package with custom launcher and
profile settings. This repository is the new engine fork; it does not claim a
previous custom x86 engine patch set was recovered. Historical RISC-V Firefox
builds are not the source baseline for this fork.

## Current status

This is a **development fork, not a qualified browser release**. The native
Playwright patch applies cleanly to the exact ESR base. Policy, branding,
packaging, and validation code are in the tree. The native engine compiled and
packaged successfully in run 40529984912. Page interaction, context cookies,
network interception, downloads, TLS rejection and CSP rejection passed. The
cross-site iframe test failed, so this remains unqualified for replacement.

Full Playwright compatibility is not established. In particular, upstream Juggler
assumes cross-process iframes are disabled; Enclave keeps them enabled. Cross-origin
frame automation is a required qualification test and may need further porting.
File upload, screencasting, permission emulation, context isolation, and client
versions other than 1.62.1 also require validation. An expected failure in these
areas must not be hidden by weakening the desktop policy.

This fork does **not** implement a masked GPU driver or confidential graphics.
Those are VM/platform capabilities with their own qualification requirements.
It does not make GPU access secure merely by running this browser.

## Build on Linux x86-64

Use a full checkout and Mozilla's native build toolchain; artifact builds cannot
supply our modified C++ components. See Mozilla's
[Linux build instructions](https://firefox-source-docs.mozilla.org/setup/linux_build.html).

```sh
git clone --branch enclave-esr153 https://github.com/EnclaveHost/enclave-browser.git
cd enclave-browser
export MOZCONFIG="$PWD/enclave/mozconfig"
./mach --no-interactive bootstrap --application-choice=browser
./mach build
./mach package
```

The provided configuration uses two build jobs and disables debug symbols to
limit build resource use. Keep sufficient disk and memory available. On a sparse
checkout, run `git sparse-checkout disable` before bootstrapping.

The **Enclave Linux build** GitHub Actions workflow can be started manually. It
builds from source, packages the result, and runs the pinned Playwright smoke test.
A package from a failed smoke run is an investigation artifact, not a release.
The updater is disabled in this build configuration: updates must come from
maintained Enclave image/package releases. ESR security updates are ongoing work,
not automatically inherited merely because this repository is a fork.

## Use with Playwright

After building, install the pinned client and run the test against our executable:

```sh
cd enclave/tests
npm ci
ENCLAVE_BROWSER_EXECUTABLE=../../obj-enclave/dist/bin/firefox npm run smoke
```

For agent applications:

```js
import { firefox } from 'playwright-core';

const browser = await firefox.launch({
  executablePath: '/opt/enclave-browser/firefox',
  headless: true,
  env: { ...process.env, ENCLAVE_BROWSER_AUTOMATION: '1' },
});
try {
  const page = await browser.newPage();
  await page.goto('https://example.org');
  console.log(await page.title());
} finally {
  await browser.close();
}
```

Playwright supplies `--juggler-pipe` and a temporary profile. Do not set
`ignoreHTTPSErrors: true` or `bypassCSP: true`; Enclave rejects those options.
The locked JIT and site-isolation preferences cannot be disabled through
`firefoxUserPrefs`. Automation is still privileged access to pages and data in its
profile; grant it only to agents you intend to authorize.

## Source layout and validation

- `enclave/`: policy, build configuration, desktop launcher/profile, provenance,
  and validation tools.
- `juggler/`: imported Firefox automation backend with Enclave adaptations.
- `browser/branding/enclave/`: Enclave Browser name and Linux artwork.
- Native Gecko changes: the import commit shows the complete engine patch.

`node --experimental-vm-modules enclave/tests/policy.mjs` exercises the actual
Juggler activation code with mocked platform services and checks policy defaults.
The runtime smoke test covers normal page interaction, independent contexts,
cross-origin frames, network interception, screenshots, downloads, and explicit
policy rejection. VM release qualification additionally needs executable-map
inspection, browser sandbox checks, YouTube playback, and Moonlight input/audio
regressions on the target image. Source checks alone do not prove these properties.

## License and attribution

Firefox and most of the imported backend carry MPL-2.0 notices. Keep the existing
per-file licenses and [Mozilla license information](LICENSE).
[Third-party notices](enclave/THIRD-PARTY-NOTICES) and the upstream
[Playwright repository license](enclave/PLAYWRIGHT-LICENSE) are included.
Firefox and Mozilla are Mozilla trademarks. Enclave Browser is an independent
fork and is not an official Mozilla product.

## Alpine / Enclave OS packaging

`enclave/alpine/APKBUILD` builds the same fork against musl, with Enclave branding,
locked policy and Juggler retained. The manual `Enclave Alpine browser` workflow
archives its exact Git commit, verifies pinned Alpine portability patches, builds
and signs an APK in a disposable container, then installs it and runs the browser
qualification suite. Signing keys are temporary CI keys, not a production feed.
The package provides `enclave-firefox`; the OS owns the desktop launcher.

The initial musl build targets x86-64. The recipe declares the intended RV64 target,
but an RV64 build and both platform runtime checks remain release gates. No stock
Firefox binary is repackaged as Enclave Browser. Accessibility is enabled by default.
