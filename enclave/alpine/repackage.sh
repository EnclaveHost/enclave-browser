#!/bin/sh
set -eux
srcdir=/build
. /src/enclave/alpine/APKBUILD
apk add --no-cache alpine-sdk sudo python3 $makedepends
mkdir -p /build/payload
if [ "$ENCLAVE_PLATFORM" = riscv64 ]; then
    cp -a /candidate/root/usr/lib/enclave-browser /build/payload/
    cp /candidate/build-provenance.json /build/payload/
else
    cp /candidate/*.pub /etc/apk/keys/
    set -- /candidate/repository/x86_64/enclave-browser-[0-9]*.apk
    [ "$#" = 1 ]
    apk verify "$1"
    apk --root /build/original --initdb --keys-dir /etc/apk/keys --repositories-file /etc/apk/repositories add "$1"
    cp -a /build/original/usr/lib/enclave-browser /build/payload/
    cp /build/original/usr/share/enclave-browser/build-provenance.json /build/payload/
fi
python3 - <<'PY'
import hashlib,json,pathlib,os
root=pathlib.Path('/build/payload')
build=json.loads((root/'build-provenance.json').read_text())
source=json.loads(pathlib.Path('/candidate/source-run.json').read_text())
assert build['repository']=='EnclaveHost/enclave-browser'
assert build['commit']==source['headSha'] and str(build['run_id'])==str(source['databaseId'])
files={str(p.relative_to(root)):hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
       for p in sorted((root/'enclave-browser').rglob('*')) if p.is_file()}
(root/'repackage-provenance.json').write_text(json.dumps({'sourceRun':source,
    'packagingCommit':os.environ['ENCLAVE_PACKAGING_COMMIT'],'compiledFiles':files,
    'change':'branded executable launcher and duplicate-bin symlink only'},indent=2)+'\n')
PY
readelf -h /build/payload/enclave-browser/enclave-browser >/out/elf-header.txt
case "$ENCLAVE_PLATFORM" in
    amd64) grep -q 'Advanced Micro Devices X86-64' /out/elf-header.txt ;;
    riscv64) grep -q 'RISC-V' /out/elf-header.txt ;;
    *) exit 1 ;;
esac
adduser -D builder
addgroup builder abuild
printf 'builder ALL=(ALL) NOPASSWD: ALL\n' >/etc/sudoers.d/builder
mkdir -p /home/builder/aports/enclave/enclave-browser
cp /src/enclave/alpine/repackage.APKBUILD /home/builder/aports/enclave/enclave-browser/APKBUILD
tar -cf /home/builder/aports/enclave/enclave-browser/browser-payload.tar -C /build payload
chown -R builder:builder /home/builder
su builder -c 'abuild-keygen -a -n'
cp /home/builder/.abuild/*.pub /etc/apk/keys/
apk update
su builder -c 'cd /home/builder/aports/enclave/enclave-browser && abuild checksum && abuild -r' >/out/package.log 2>&1
cp -a /home/builder/packages/enclave /out/repository
cp /home/builder/.abuild/*.pub /out/
printf '\n/home/builder/packages/enclave\n' >>/etc/apk/repositories
apk add --no-cache enclave-browser
/usr/bin/enclave-firefox --version >/out/version.txt
if [ "$ENCLAVE_PLATFORM" = amd64 ]; then
    apk add --no-cache nodejs npm ffmpeg
    cp -a /src/enclave/tests /home/builder/tests
    chown -R builder:builder /home/builder/tests /out
    su builder -c 'cd /home/builder/tests && node media-fixture.mjs && npm ci --ignore-scripts --no-audit --no-fund && ENCLAVE_BROWSER_EXECUTABLE=/usr/bin/enclave-firefox ENCLAVE_TEST_ARTIFACTS=/out/smoke timeout 180 node smoke.mjs' >/out/smoke.log 2>&1
fi
