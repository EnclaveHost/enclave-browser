#!/bin/sh
set -eux
apk add --no-cache alpine-sdk sudo python3
apk update
adduser -D builder
addgroup builder abuild
printf 'builder ALL=(ALL) NOPASSWD: ALL\n' >/etc/sudoers.d/builder
mkdir -p /home/builder/aports/enclave/enclave-browser /out
cp /src/enclave/alpine/APKBUILD /home/builder/aports/enclave/enclave-browser/
cp /src/enclave-browser-source.tar /home/builder/aports/enclave/enclave-browser/
chown -R builder:builder /home/builder
su builder -c 'abuild-keygen -a -n'
cp /home/builder/.abuild/*.pub /etc/apk/keys/
su builder -c 'cd /home/builder/aports/enclave/enclave-browser && abuild checksum && abuild -r' > /out/build.log 2>&1
cp -a /home/builder/packages/enclave /out/repository
cp /home/builder/.abuild/*.pub /out/
printf '\n/home/builder/packages/enclave\n' >>/etc/apk/repositories
apk add --no-cache enclave-browser nodejs npm
/usr/bin/enclave-firefox --version > /out/version.txt
cp -a /src/enclave/tests /home/builder/tests
chown -R builder:builder /home/builder/tests /out
su builder -c 'cd /home/builder/tests && npm ci --ignore-scripts --no-audit --no-fund && ENCLAVE_BROWSER_EXECUTABLE=/usr/bin/enclave-firefox ENCLAVE_TEST_ARTIFACTS=/out/smoke timeout 180 node smoke.mjs' > /out/smoke.log 2>&1
