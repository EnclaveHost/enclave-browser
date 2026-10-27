import hashlib, json, pathlib, sys
root = pathlib.Path(__file__).resolve().parent
for entry in json.loads((root / 'upstream.json').read_text())['files']:
    assert hashlib.sha256((root / entry['path']).read_bytes()).hexdigest() == entry['sha256'], entry['path']

if len(sys.argv) > 1:
    for entry in json.loads((root / "upstream.json").read_text())["build_tools"]:
        assert hashlib.sha256((pathlib.Path(sys.argv[1]) / entry["path"]).read_bytes()).hexdigest() == entry["sha256"], entry["path"]
