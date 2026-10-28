#!/bin/sh
set -eux
srcdir=/build
. /src/enclave/alpine/APKBUILD
apk add --no-cache alpine-sdk sudo curl $makedepends
mkdir -p /target/etc/apk/keys
cp -L /usr/share/apk/keys/riscv64/*.pub /target/etc/apk/keys/
cp /etc/apk/repositories /target/etc/apk/repositories
apk --root /target --arch riscv64 --initdb --no-scripts add \
    build-base linux-headers rust alsa-lib-dev aom-dev dav1d-dev dbus-dev gtk+3.0-dev \
    icu-dev libevent-dev libffi-dev libjpeg-turbo-dev libogg-dev libtheora-dev \
    libvorbis-dev libvpx-dev libwebp-dev libxcomposite-dev libxt-dev mesa-dev nspr-dev \
    pciutils pipewire-dev pulseaudio-dev wireless-tools-dev zlib-dev
cp -a /target/usr/lib/rustlib/riscv64-alpine-linux-musl /usr/lib/rustlib/
adduser -D builder
mkdir -p /build /out
cd /build
tar -xf /src/enclave-browser-source.tar
curl -fsSL https://static.crates.io/crates/cbindgen/cbindgen-0.29.4.crate -o cbindgen-0.29.4.tar.gz
python3 enclave-browser/enclave/alpine/verify.py /build
tar -xzf cbindgen-0.29.4.tar.gz
cd enclave-browser
for p in enclave/alpine/patches/*.patch; do patch --batch --fuzz=0 -p1 < "$p"; done
python3 enclave/alpine/build-memory.py
cp enclave/alpine/patches/stab.h toolkit/crashreporter/google-breakpad/src/
chown -R builder:builder /build /out
cat >/build/compile.sh <<'BUILD'
#!/bin/sh
set -eux
cd /build/enclave-browser
export MACH_BUILD_PYTHON_NATIVE_PACKAGE_SOURCE=system MOZBUILD_STATE_PATH=/build/mozbuild
export MOZCONFIG=/build/enclave-browser/enclave/alpine/mozconfig
export CBUILD=x86_64-alpine-linux-musl CHOST=riscv64-alpine-linux-musl
export ENCLAVE_CROSS_SYSROOT=/target
export HOST_CC=clang-22 HOST_CXX=clang++-22
export CC='clang-22 --gcc-toolchain=/target/usr' CXX='clang++-22 --gcc-toolchain=/target/usr'
export HOST_CFLAGS=-O2 HOST_CXXFLAGS=-O2
export LDFLAGS='-Wl,-rpath,/usr/lib/enclave-browser'
cargo install --locked --path /build/cbindgen-0.29.4 --root /build/toolchain -j2
export PATH="/build/toolchain/bin:$PATH"
./mach build
DESTDIR=/out/root ./mach install
cp enclave/alpine/build-provenance.json /out/
readelf -h /out/root/usr/lib/enclave-browser/firefox >/out/elf-header.txt
tar -C /out/root -czf /out/enclave-browser-riscv64-candidate.tar.gz .
rm -rf /out/root
BUILD
chmod 755 /build/compile.sh
su builder -c /build/compile.sh >/out/build.log 2>&1
