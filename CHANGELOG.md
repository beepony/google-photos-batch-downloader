# Changelog

## 0.2.2 — 2026-10-18

- Fix: when the Takeout tab was opened without `?rapt=` in its address (e.g. from the Takeout menu), the
  re-auth token was missing from download requests, so Google kept answering with a sign-in page. The token
  is now read from the part links on the page.
- Parts that Chrome finished earlier are counted as done even if the files were later moved to another folder.
- A token-free trace of the last HTML response is kept for troubleshooting.

## 0.2.1 — 2026-10-18

- Fix: the extension kept asking for re-verification even after the user had verified. The page's
  `/takeout/download` link only redirects back to the archive page, so Chrome got HTML instead of a zip.
  Parts are now requested via `/settings/takeout/download?...&download=true` (the URL Takeout's own button uses).
- Fix: the "View report" link was counted as an extra part (e.g. 167 of 166).
- Fix: parts already downloaded by clicking on the page (redirected to `takeout-download.usercontent.google.com`)
  are now recognised, so they are not downloaded twice.
- Sign-in requests focus the existing Takeout tab instead of opening a new tab each time; if Google still
  refuses right after verification, the job pauses with a clear message instead of looping.
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
