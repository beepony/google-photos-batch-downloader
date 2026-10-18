# Changelog

## Unreleased

- Chrome Web Store submission kit in `store/`: bilingual listing text, privacy-practices answers, screenshots,
  promo tiles and a checklist. `tools/store-assets.mjs` regenerates the images.

## 0.2.0 — 2026-10-18

- Bilingual UI (English / 简体中文): popup, on-page panel, notifications, CSV manifest. Follows the browser
  language; switch with the 中 / EN buttons or in settings.
- Localised extension name and description (`_locales/en`, `_locales/zh_CN`).
- Full documentation in both languages: README, user guide, privacy; architecture notes.

## 0.1.0 — 2026-10-18

- First version: one-click batch download of all Takeout parts, concurrency limit, auto resume and retry,
  duplicate detection, sign-in pause/auto-continue, data cap, download window, keep-awake, size check, expiry
  display, verify script and CSV manifest, manual mark/redownload.
