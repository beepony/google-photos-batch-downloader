# User guide

[中文版](USER_GUIDE.zh-CN.md)

## 1. Before you start

- **Disk space.** You need at least the export size free (Takeout shows it, e.g. "330.68 GB"), plus room to unzip
  if you plan to extract everything.
- **Download location.** Chrome Settings → Downloads → Location. Choose your external drive if that's where the
  backup should live. The extension never asks Chrome for a "Save as" dialog.
- **Network.** A 300 GB export is 300 GB of traffic. On a metered connection, set a **data cap** (see below).
- **Expiry.** Takeout links usually expire after about a week. The popup shows the date.

## 2. Create the export

1. Go to [takeout.google.com](https://takeout.google.com) → **Deselect all** → tick **Google Photos**.
2. **Next step** → *Transfer to: Send download link via email*, *Frequency: Export once*,
   *File type: .zip*, *File size*: any. Bigger parts mean fewer files; 2 GB parts are the most robust on slow
   networks, 10–50 GB parts are fine on fast, stable ones.
3. **Create export** and wait for the email (minutes to days).

## 3. Download everything

1. Open the link in the email, or **Manage exports** on Takeout. Google may ask you to sign in.
2. A panel appears in the bottom-right corner: **Download all N parts**. Click it.
3. Progress is shown in the panel, the toolbar icon (percentage badge) and the popup.

In the popup, every square is one part:

| Colour | Meaning |
|---|---|
| Teal | Done |
| Orange (filling up) | Downloading |
| Striped | Waiting to retry |
| Red | Failed after several attempts |
| Beige | Queued |

Hover over a square to see its file name or error.

## 4. When Google asks you to sign in again

Takeout often asks you to verify your identity again during long downloads. When that happens:

- The queue pauses (parts already downloading keep going).
- The Takeout tab opens and you get a notification. The toolbar icon shows **!**.
- Verify with your password or passkey.
- As soon as the Takeout page reloads with the fresh verification, downloading continues on its own.
  If it doesn't, press **I've verified — continue** in the popup.

## 5. Settings (⚙ in the popup)

| Setting | What it does |
|---|---|
| **Download N at a time** | Parallel downloads. 3 is a good default; use 1–2 on slow connections. |
| **Save to Downloads/…** | Subfolder inside Chrome's download location. Empty = directly in it. |
| **Data cap per run** | Pause after this many GB. Press **Resume** to start the next round. 0 = no limit. |
| **Only download between** | A daily time window, e.g. 00:00–08:00. Windows across midnight work. |
| **Keep the computer awake** | Uses Chrome's power API so the machine doesn't sleep. The screen may still lock. |
| **Notify me** | System notifications when everything finishes, a cap is reached or sign-in is needed. |
| **Language** | Browser default, 中文 or English. Also switchable with the 中 / EN buttons. |

## 6. Verify the downloads

**More → Export verify script** saves `verify-takeout.sh` next to the zip files. Run it in a terminal:

```bash
cd "/Volumes/MyDrive/Google Takeout"
bash verify-takeout.sh
```

It tests each part with `unzip -t` and prints one line per part (`OK`, `BAD` or `MISSING`), then a summary, and
saves `verify-report-<timestamp>.txt`. Exit code 0 means everything is fine.

For any `BAD` or `MISSING` part, type its number in **More → Parts** (e.g. `7, 12-14`) and press
**Download again**.

On Windows, run the script in Git Bash or WSL, or open each zip in Explorer.

**Export CSV manifest** writes a spreadsheet of every part: status, file name, size, attempts and errors.

## 7. You already downloaded some parts by hand

- **Same browser:** nothing to do. Parts finished or in progress in Chrome's download history are detected.
- **Another browser or computer:** copy the files into the download folder, then type their numbers in
  **More → Parts** and press **Mark as downloaded**. The verify script still checks them.

## 8. Troubleshooting

| Problem | What to try |
|---|---|
| No panel on the Takeout page | Make sure you're on the *Manage exports* page that lists the parts, then reload. Check that the extension is enabled. |
| "Chrome blocked multiple downloads" | Normally not needed, but if you see it: click the icon in the address bar and choose *Always allow takeout.google.com*. |
| Keeps asking to sign in | Normal for Google. Verify each time; the extension continues automatically. Using fewer, larger parts reduces how often it happens. |
| A part keeps failing | Check free disk space. Then **Retry failed**. If it still fails, download that part again in a few hours. |
| "Disk is full" | Free space or change the download location, then **Resume**. |
| Links expired | Create a new export. Use **Mark as downloaded** for the parts you already have only if the new export has the same parts — usually it doesn't, so it's safer to start fresh. |
| Paused, says "data cap reached" | Intended. Press **Resume** for another round, or set the cap to 0. |

## 9. After the backup

When the verify script says `ALL GOOD`, keep the zip files (or extract them) somewhere safe before you delete
anything from Google Photos. Consider a second copy on another drive. If you're going to delete photos from your
account, turn off backup/sync on your phone first, so it doesn't upload them again.

The extension never deletes anything from Google.
