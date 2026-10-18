#!/bin/bash
# Build a zip suitable for the Chrome Web Store upload.
set -e
cd "$(dirname "$0")/.."
VER=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/takeout-batch-downloader-$VER.zip"
(cd extension && zip -qr "../dist/takeout-batch-downloader-$VER.zip" . -x '.*')
echo "dist/takeout-batch-downloader-$VER.zip"
