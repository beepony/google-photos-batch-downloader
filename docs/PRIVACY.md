# Privacy

[中文](PRIVACY.zh-CN.md)

Takeout Batch Downloader runs entirely inside your browser.

- **No servers.** The extension has no backend and makes no network requests of its own. Downloads go directly
  from Google to your computer through Chrome's normal download manager.
- **No analytics, no tracking, no ads.**
- **What is stored locally** (`chrome.storage.local`, on your computer only): your settings, and for each export
  the job ID, the list of parts, their download links, status, file names and sizes. Remove a job from the popup
  (**More → Remove this job**) or uninstall the extension to delete it.
- **Your Google account.** The extension never sees your password or passkey and cannot sign in for you. It
  reads only the `takeout.google.com` pages you open, to find the download links.
- **Permissions:**
  - `downloads`: start, pause, resume and track the part downloads.
  - `storage`: remember settings and progress.
  - `alarms`: check the queue every 30 seconds while downloading.
  - `notifications`: tell you when downloading finishes or needs your attention.
  - `power`: keep the computer awake while downloading (optional, can be turned off).
  - Host access to `https://takeout.google.com/*`: find the part links on the Takeout page.
