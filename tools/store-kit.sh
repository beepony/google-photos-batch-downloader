#!/bin/bash
# Collect everything for a Chrome Web Store submission into dist/store-kit-<version>/.
# Run after: node tools/ui-shots.mjs && node tools/store-assets.mjs
set -e
cd "$(dirname "$0")/.."
VER=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
bash tools/pack.sh >/dev/null
OUT="dist/store-kit-$VER"
rm -rf "$OUT"
mkdir -p "$OUT/screenshots-en" "$OUT/screenshots-zh" "$OUT/promo"
cp "dist/google-photos-batch-downloader-$VER.zip" "$OUT/upload.zip"
cp extension/icons/icon128.png "$OUT/icon-128.png"
for l in en zh; do
  cp store/assets/$l/[1-5]-*.png "$OUT/screenshots-$l/"
  cp store/assets/$l/promo-small-440x280.png "$OUT/promo/small-440x280-$l.png"
  cp store/assets/$l/promo-marquee-1400x560.png "$OUT/promo/marquee-1400x560-$l.png"
done
cp store/LISTING.md store/PRIVACY_PRACTICES.md store/README.md store/README.zh-CN.md "$OUT/"
echo "$OUT"
