#!/usr/bin/env bash
# Builds store-ready packages into dist/:
#   dist/mphony-chrome-<version>.zip   manifest.json as-is (MV3 service worker)
#   dist/mphony-firefox-<version>.zip  manifest patched for Firefox: background
#                                      "scripts" instead of "service_worker"
# Also leaves unpacked copies in dist/chrome/ and dist/firefox/ for loading.
set -euo pipefail
cd "$(dirname "$0")/.."
FILES=(manifest.json background.js content.js docs-main.js avro-lib.js dict-bn.js next-bn.js popup.html popup.js icons README.md)
VER=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
rm -rf dist && mkdir -p dist/chrome dist/firefox
cp -r "${FILES[@]}" dist/chrome/
cp -r "${FILES[@]}" dist/firefox/
python3 - dist/firefox/manifest.json <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p))
m["background"] = {"scripts": [m["background"]["service_worker"]]}
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False); open(p, "a").write("\n")
PY
(cd dist/chrome && zip -qr "../mphony-chrome-$VER.zip" .)
(cd dist/firefox && zip -qr "../mphony-firefox-$VER.zip" .)
ls -l dist/*.zip
