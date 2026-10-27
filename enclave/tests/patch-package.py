"""Apply JavaScript-only candidates to the pinned native qualification package."""
import argparse, hashlib, pathlib, shutil, subprocess, tarfile, zipfile
root = pathlib.Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('archive', type=pathlib.Path)
p.add_argument('output', type=pathlib.Path)
a = p.parse_args()
with a.archive.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == 'a387e30e407a6e8dd70233398628d2770e08ededadf84bcbf608e823ce113b64'
changed = subprocess.check_output(['git', 'diff', '--name-only', 'aef56cda0b64a556e6e1a76d08bd1b523e211e26', 'HEAD', '--', '*.cpp', '*.cc', '*.c', '*.h', '*.idl', '*.webidl', ':(exclude)enclave/alpine/**'], cwd=root, text=True)
assert not changed, 'Native sources changed: rebuild the engine instead of reusing this package: ' + changed
assert not a.output.exists(), 'Output must be a fresh test directory'
a.output.mkdir(parents=True)
with tarfile.open(a.archive) as archive:
    archive.extractall(a.output, filter='data')
patches = {str(f.relative_to(root/'juggler')): f.read_bytes() for f in (root/'juggler').rglob('*') if f.suffix in ('.js', '.jsm')}
found = False
for jar in (a.output/'firefox').rglob('omni.ja'):
    with zipfile.ZipFile(jar) as src:
        names = src.namelist()
        candidates = [n for n in names if n.endswith('/TargetRegistry.js') and 'juggler' in n]
        if not candidates: continue
        prefix = candidates[0].removesuffix('TargetRegistry.js')
        new = jar.with_suffix('.new')
        with zipfile.ZipFile(new, 'w', zipfile.ZIP_DEFLATED) as dst:
            for entry in src.infolist():
                relative = entry.filename[len(prefix):] if entry.filename.startswith(prefix) else None
                dst.writestr(entry, patches[relative] if relative in patches else src.read(entry.filename))
            for name, data in patches.items():
                if prefix+name not in names: dst.writestr(prefix+name, data)
        found = True
    new.replace(jar)
assert found, 'Juggler package missing'
shutil.copyfile(root/'enclave/enclave.cfg', a.output/'firefox/enclave.cfg')
