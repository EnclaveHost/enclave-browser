import hashlib, json, pathlib
root = pathlib.Path(__file__).resolve().parent
for entry in json.loads((root / 'upstream.json').read_text())['files']:
    assert hashlib.sha256((root / entry['path']).read_bytes()).hexdigest() == entry['sha256'], entry['path']
