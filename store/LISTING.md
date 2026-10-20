# Store listing / 商店页面文案

Name and summary are read from `extension/_locales/*/messages.json` (`extName`, `extDescription`; limits 75 / 132
characters). Everything else is pasted into the dashboard.

名称和简介来自 `extension/_locales/*/messages.json`（`extName`、`extDescription`，上限 75 / 132 字符），其余内容粘贴到后台。

| Field | Value |
|---|---|
| Category | Tools |
| Language | English (default), 简体中文 |
| Homepage | https://github.com/beepony/google-photos-batch-downloader |
| Support | https://github.com/beepony/google-photos-batch-downloader/issues |

---

## English

**Name:** Google Photos Batch Downloader

**Summary:** Bulk download all Google Photos from Google Takeout in one click: every zip part queued, auto-resumed and verified.

**Description:**

```text
Download all your Google Photos at once. Back up Google Photos to your computer or an external hard drive (or anything else in Google Takeout) without clicking hundreds of download buttons.

A big Takeout export is split into dozens or hundreds of 2 GB zip files, each with its own "Download" button. Doing it by hand means Chrome blocking "multiple downloads", Google asking you to sign in again, dropped connections, duplicate files like "…-009 (1).zip", and no idea which parts are still missing.

Google Photos Batch Downloader adds a "Download all" button to your Takeout download page and handles the rest:

★ One click, every part
Finds every part on the page and puts them all in a queue.

★ Auto resume and retry
Dropped connections continue where they stopped. Server errors retry with back-off. Stalled parts are re-queued.

★ No duplicates
Parts you already downloaded, are downloading, or clicked by hand are recognised and skipped.

★ Fewer sign-in prompts
Google asks you to re-verify about every 20 minutes before a new part can start. The extension starts several parts right after each check, reminds you with a notification and chime, and continues by itself once you verify.

★ Built for huge exports
• Download 1–6 parts at a time
• Data cap: stop after N GB per run (metered connections)
• Download window: e.g. only overnight
• Keep the computer awake while downloading
• Truncated files and error pages are detected and downloaded again
• Link-expiry reminder

★ Verify everything
Export a script that runs "unzip -t" on every part and reports anything missing or broken, plus a CSV manifest.

★ English and 简体中文

HOW TO USE
1. Create an export at takeout.google.com.
2. When it's ready, open Manage exports → your export's download page.
3. Click "Download all N parts" in the bottom-right panel. Follow progress from the toolbar icon.
Tip: to save to an external drive, change Chrome Settings → Downloads → Location first.

PRIVACY
No servers, no analytics, no tracking. The extension only reads takeout.google.com pages to find the download links; files go straight from Google to your disk through Chrome's own download manager. It never sees your password and never deletes anything from your Google account.

Open source (MIT): https://github.com/beepony/google-photos-batch-downloader

This is an independent project, not affiliated with or endorsed by Google. Google Photos and Google Takeout are trademarks of Google LLC.
```

---

## 简体中文

**名称：** Google Photos 批量下载

**简介：** 一键批量下载 Google Photos（Google 相册）的 Takeout 导出：所有 zip 分卷自动排队、断点续传、失败重试、完整校验，备份照片更省事。

**详细说明：**

```text
一键下载 Google 相册（Google Photos）里的全部照片和视频，备份到电脑或移动硬盘（Google Takeout 里的其他数据也适用），不用再一个个点几百次“下载”。

大的 Takeout 导出会被拆成几十上百个 2 GB 的压缩包，每个都有单独的“下载”按钮。手动下载时，Chrome 会拦截“多个下载”，Google 会反复要求重新登录，网络一断就要重来，还会出现“…-009 (1).zip”这样的重复文件，最后也搞不清楚还缺哪几个。

Google Photos 批量下载会在 Takeout 下载页面上加一个“一键下载全部”按钮，剩下的交给它：

★ 一键下载全部分卷
自动识别页面上的所有分卷，全部加入队列。

★ 断点续传、自动重试
断网后从断点继续；服务器出错自动重试；卡住的分卷会重新排队。

★ 不重复下载
已经下完、正在下载、或者手动点过的分卷都会被识别并跳过。

★ 减少重新验证
Google 约每 20 分钟要求验证一次才能开始新分卷。插件在每次验证后集中启动多个分卷，用通知和提示音提醒，验证完成后自动继续。

★ 为超大导出设计
• 同时下载 1–6 个
• 流量上限：每轮下载 N GB 后暂停，适合按流量计费的网络
• 定时下载：比如只在夜间下载
• 下载期间防止电脑休眠
• 自动识别下载不完整、或拿到的是网页而不是压缩包的情况，并重新下载
• 链接过期提醒

★ 逐个校验
导出校验脚本，用“unzip -t”检查每个分卷，缺失或损坏一目了然；也可以导出 CSV 清单。

★ 中英双语界面

使用方法
1. 在 takeout.google.com 创建导出。
2. 导出完成后，打开“管理导出”→ 该导出的下载页面。
3. 点击右下角面板里的“一键下载全部 N 个”，在工具栏图标里查看进度。
提示：想保存到移动硬盘，先在 Chrome 设置 → 下载内容 → 位置 里改成移动硬盘上的文件夹。

隐私
没有服务器，没有统计，没有追踪。插件只读取 takeout.google.com 页面来找到下载链接；文件通过 Chrome 自带的下载功能，直接从 Google 下载到你的硬盘。插件看不到你的密码，也不会删除你 Google 账号里的任何内容。

开源（MIT）：https://github.com/beepony/google-photos-batch-downloader

本项目为独立开发，与 Google 无关，也未获得 Google 认可。Google 相册和 Google Takeout 是 Google LLC 的商标。
```
