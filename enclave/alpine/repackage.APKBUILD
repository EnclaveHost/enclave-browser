pkgname=enclave-browser
pkgver=153.5.1
pkgrel=2
pkgdesc="Enclave Firefox ESR with protected JIT and opt-in pipe automation"
url="https://github.com/EnclaveHost/enclave-browser"
arch="x86_64 riscv64"
license="MPL-2.0 AND GPL-2.0-or-later AND LGPL-2.1-or-later"
depends="ffmpeg7-libavcodec"
ldpath="/usr/lib/enclave-browser"
sonameprefix="$pkgname:"
options="!check !strip"
source="browser-payload.tar"
builddir="$srcdir/payload"
package() {
    mkdir -p "$pkgdir/usr/lib" "$pkgdir/usr/share/enclave-browser"
    cp -a enclave-browser "$pkgdir/usr/lib/"
    install -m644 build-provenance.json repackage-provenance.json "$pkgdir/usr/share/enclave-browser/"
    install -Dm755 /dev/stdin "$pkgdir/usr/bin/enclave-firefox" <<'WRAPPER'
#!/bin/sh
exec /usr/lib/enclave-browser/enclave-browser "$@"
WRAPPER
    rm -f "$pkgdir/usr/lib/enclave-browser/firefox-bin" "$pkgdir/usr/lib/enclave-browser/enclave-browser-bin"
    ln -s enclave-browser "$pkgdir/usr/lib/enclave-browser/enclave-browser-bin"
    test -s "$pkgdir/usr/lib/enclave-browser/enclave.cfg"
    python3 - "$pkgdir/usr/lib/enclave-browser" <<'VERIFY'
import pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(root / 'omni.ja') as archive:
    loader = archive.read('defaults/pref/enclave.js').decode()
assert 'pref("general.config.filename", "enclave.cfg");' in loader
assert 'pref("general.config.obscure_value", 0);' in loader
VERIFY
}
sha512sums=""
