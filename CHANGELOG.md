# Changelog

## 0.5.1 — 2026-10-20

- Fix: a part that contains a single very large file (for example a long video) is served by Google as that file
  (`…-078.mp4`) instead of `takeout-…-078.zip`. The extension mistook it for a sign-in page, cancelled it and
  asked to verify again; each cancelled try used up one of Google's **5 downloads per part**. Such parts now
  download normally. Sign-in is detected only from a web page (`text/html`) or a redirect to `accounts.google.com`.
- When Google says a part reached its download limit, that part is marked failed with a clear message and is
  never retried ("Retry failed" skips it). Retries per part are capped at 3 to protect the quota.
- `verify-takeout.sh` checks non-zip parts by size and accepts extra folders:
  `bash verify-takeout.sh /path/to/moved/parts`.

## 0.5.0 — 2026-10-20

- Renamed to **Google Photos Batch Downloader** (中文：**Google Photos 批量下载**). The GitHub repository moved to
  `beepony/google-photos-batch-downloader` (old links redirect).
- README, store listing and docs rewritten for search: clearer "download all Google Photos" / Takeout bulk
  download wording, a FAQ section in both languages, descriptive image alt text.

## 0.4.2 — 2026-10-20

- Fix: "Keep computer awake" only blocked system sleep, so the display still turned off and the OS locked the
  screen. New sub-setting **Also keep the screen on** (default on) uses `chrome.power` level `display` while
  downloading (中文：同时保持屏幕常亮，防止自动锁屏).

## 0.4.1 — 2026-10-20

- **Fewer sign-in checks.** Google asks to re-verify about every 20 minutes before it lets a *new* part start
  (parts already downloading are not affected; this is enforced by Google and cannot be kept alive).
  New setting **Burst after verifying** (default 6): for ~17 minutes after each verification the extension
  starts up to that many parts back-to-back, then falls back to the normal parallel count. One verification now
  covers several times more parts (中文：验证后集中启动).
- Sign-in reminder: the notification now stays on screen until handled and clicking it focuses the Takeout tab;
  optional chime (new `offscreen` permission, setting **Play a sound when verification is needed**).
- The job card shows when the next verification is expected and a passkey tip while sign-in is needed.

## 0.4.0 — 2026-10-20

- Redesigned popup following Chrome / Edge extension conventions: system font, compact app bar with icon
  buttons, Material-style cards, chips, switches and list menus, 8px spacing grid, 32px+ hit targets,
  visible keyboard focus, light and dark themes, reduced-motion support.
- Settings moved to their own page (back button / Esc) and grouped into Downloads, Schedule & power, General;
  shortcut to Chrome's download-location settings; version shown at the bottom.
- Job card: large percentage, single progress bar, three stats, status chip, alert banner; the part grid and
  "More" actions are collapsible.
- On-page panel restyled to match Google's Material look.

## 0.3.1 — 2026-10-20

- Settings: new **Open download folder** button next to the save location (中文：打开下载目录).

## 0.3.0 — 2026-10-18

- Fix (root cause of the endless "verify your identity" prompt): Google only serves archives to requests that
  come from its own Takeout page. Downloads started by the extension via `chrome.downloads.download` were sent
  to `accounts.google.com/ServiceLogin` even with a valid, freshly verified session.
  Parts are now started by clicking Takeout's own download button inside the open Takeout tab (one click at a
  time; the next part starts as soon as the previous click turns into a download).
- Keep one Takeout export page open while downloading; the extension tells you if it is missing.
- If a click lands on Google's sign-in page, the job waits for verification on that same tab.

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
