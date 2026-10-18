# Architecture

A Manifest V3 extension with no build step and no runtime dependencies.

```
extension/
  manifest.json          MV3 manifest, permissions, i18n names (__MSG_*__)
  _locales/{en,zh_CN}/   Store-facing name and description
  src/core.js            Pure logic: parsing, queue planning, verify script, CSV (unit tested)
  src/i18n.js            zh / en message catalog shared by every context
  src/background.js      Service worker: the download queue and state machine
  src/content.js         Runs on takeout.google.com: scans part links, floating "Download all" panel
  popup/                 Toolbar popup: progress grid, settings, actions
tests/                   node:test suites (no dependencies)
harness/                 Mock Takeout server + real-Chrome end-to-end test
tools/pack.sh            Builds the Web Store zip
tools/store-assets.mjs   Renders Web Store screenshots and promo tiles into store/assets/
store/                   Web Store listing text, privacy answers, submission checklist
```

## Flow

```
Takeout page ──content.js──▶ scan {pageUrl, records[]} ──▶ background.js
                                                            │ buildJobFromScan()  → job + parts
                                                            │ adoptHistory()      → skip parts Chrome already has
user clicks "Download all" ───────────────────────────────▶ │ status = running
                                                            ▼
                         tick() every 30 s and on every download event
                           planNext() → chrome.downloads.download(partUrl)
                           onDeterminingFilename → put zip in <subfolder>/, or detect HTML (= sign-in) and cancel
                           onChanged complete    → size check → done / retry
                           onChanged interrupted → classifyInterrupt() → resume / retry / auth / fatal
```

### Part detection

Takeout part links have the form
`https://takeout.google.com/takeout/download?j=<jobId>&i=<zeroBasedIndex>&user=…&rapt=…`.
`content.js` collects every such anchor with its `aria-label` (which carries "of N" / "共 N 部分") and the row
text (part size). Rows whose link was replaced by a generic "Download again" button are still recognised by
their "Part N" text, and the URL is rebuilt from the job ID. A `MutationObserver` rescans when the page changes.

### State

Everything lives in `chrome.storage.local` so the service worker can be stopped at any time:

- `settings`: concurrency, subfolder, data cap, time window, keep-awake, notifications, language.
- `jobs[jobId]`: page URL (with the latest `rapt` re-auth token), expiry, `parts[n]` with status
  `pending | starting | downloading | retrying | failed | done`, attempts, bytes, file name, error.
- `dl[downloadId]`: maps Chrome download IDs back to `{ jobId, part }`.

All mutations go through a single promise chain (`locked()`), so events never interleave mid-update.
`onDeterminingFilename` is the exception: it must answer immediately, so it reads state without the lock.

### Sign-in (re-auth)

When the session needs re-verification, Google answers the part URL with an HTML page instead of a zip. The
filename hook sees a non-zip name or `text/html`, cancels and erases that download, returns the part to
`pending`, sets the job to `needs_auth`, opens the Takeout tab and notifies. When the user verifies, Takeout
reloads with a new `rapt` token; the next scan refreshes the part URLs and resumes the job automatically.

### Resume and retry

- `NETWORK_*`, `SERVER_FAILED`, `CRASH` and similar are resumable: `chrome.downloads.resume()` continues with an
  HTTP Range request after an exponential back-off (5 s → 10 min).
- `SERVER_UNAUTHORIZED` / `FORBIDDEN` → sign-in flow.
- `FILE_NO_SPACE` / `FILE_ACCESS_DENIED` → pause the job; user action needed.
- `USER_CANCELED` → the part is marked failed and left alone.
- No progress for 5 minutes → cancel and re-queue.
- Completed file far smaller than the size shown on the page → re-download.
- After `maxAttempts` (6) a part becomes `failed`; **Retry failed** resets it.

### i18n

All UI text is in `src/i18n.js`. The service worker stores notices and errors as `{ k, p }` (key + params)
rather than strings, and every view renders them with `tm(lang, msg)`. Switching language therefore updates
existing notices too. `_locales/` only holds the strings Chrome itself shows (extension name, description).

## Testing

- `tests/core.test.mjs`: parsing, planning, back-off, verify script (actually runs it with macOS bash 3.2).
- `tests/background.test.mjs`: imports the real service worker with a fake `chrome.*` and drives full
  scenarios: queueing, resume, sign-in, data cap, adopting manual clicks, truncated files, notification language.
- `tests/i18n.test.mjs`: zh/en catalogs have the same keys and placeholders; every key used in code exists.
- `harness/e2e.mjs`: launches real Chrome with a temporary profile, loads the extension via CDP
  `Extensions.loadUnpacked`, routes `takeout.google.com` through a local CONNECT proxy to a mock HTTPS server,
  clicks the on-page button and checks the results on disk.

Chrome 137+ ignores `--load-extension` for branded builds, which is why the harness uses
`--enable-unsafe-extension-debugging` + `Extensions.loadUnpacked`.
