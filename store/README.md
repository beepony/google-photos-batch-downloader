# Chrome Web Store submission kit

[中文](README.zh-CN.md)

Everything needed to publish **Google Photos Batch Downloader** on the Chrome Web Store.

| File | What it's for |
|---|---|
| [`LISTING.md`](LISTING.md) | Store listing text: name, summary, description, category (English + 简体中文) |
| [`PRIVACY_PRACTICES.md`](PRIVACY_PRACTICES.md) | Answers for the **Privacy practices** tab: single purpose, permission justifications, data use |
| [`assets/en/`](assets/en), [`assets/zh/`](assets/zh) | Screenshots 1280×800 (×5), small promo tile 440×280, marquee 1400×560 |
| [`../tools/store-assets.mjs`](../tools/store-assets.mjs) | Regenerates the images (`node tools/store-assets.mjs`, needs Chrome) |
| [`../tools/pack.sh`](../tools/pack.sh) | Builds the upload zip `dist/google-photos-batch-downloader-<version>.zip` |

## Checklist

### One-time setup
- [ ] Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
      and pay the one-time US$5 fee.
- [ ] Turn on 2-Step Verification for the Google account (required to publish).
- [ ] **Account → Contact email**: set and verify a contact email.

### Upload
- [ ] `node --test tests/*.test.mjs` passes.
- [ ] Bump `version` in `extension/manifest.json` if this version was uploaded before, and add a CHANGELOG entry.
- [ ] `bash tools/pack.sh` → upload `dist/google-photos-batch-downloader-<version>.zip` (**Add new item**).

### Store listing tab
- [ ] Description, category, language: copy from [`LISTING.md`](LISTING.md).
      Name and summary come from `_locales` in the zip.
- [ ] Add **简体中文** as a second language and paste the Chinese description.
- [ ] Icon 128×128: `extension/icons/icon128.png`.
- [ ] Screenshots: `assets/en/1…5` (English), `assets/zh/1…5` (Chinese).
- [ ] Small promo tile: `assets/<lang>/promo-small-440x280.png`. Marquee (optional): `promo-marquee-1400x560.png`.
- [ ] Homepage URL: `https://github.com/beepony/google-photos-batch-downloader`
- [ ] Support URL: `https://github.com/beepony/google-photos-batch-downloader/issues`

### Privacy practices tab
- [ ] Paste the single purpose and each permission justification from [`PRIVACY_PRACTICES.md`](PRIVACY_PRACTICES.md).
- [ ] Remote code: **No**.
- [ ] Data usage: tick **Website content** only, then tick all three certifications.
- [ ] Privacy policy URL: `https://github.com/beepony/google-photos-batch-downloader/blob/main/docs/PRIVACY.md`

### Distribution tab
- [ ] Free, all regions, **Public** (or **Unlisted** for a soft launch).

### Submit
- [ ] **Submit for review**. Expect a few days; host access to a Google domain can mean a longer review.
- [ ] After approval: add the store link to both READMEs and remove the "not on the Chrome Web Store yet" note.

## Review tips

- Reviewers can't open your Takeout export. Suggested text for the **Test instructions** field:
  > Requires a Google Takeout export ready to download (takeout.google.com → Manage exports). Open the
  > export's download page; a "Download all N parts" panel appears at the bottom right. Click it and watch
  > progress in the toolbar popup. The repo includes an end-to-end test with a local mock of the page:
  > https://github.com/beepony/google-photos-batch-downloader#development
- Keep the description factual and don't imply the extension is made by Google; the disclaimer at the end of the
  description covers this.
