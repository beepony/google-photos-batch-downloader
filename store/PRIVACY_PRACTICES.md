# Privacy practices tab / 隐私权规范

Paste these into **Developer Dashboard → your item → Privacy practices**. The dashboard is in English, so the
answers are in English; a Chinese translation follows each one for reference.

以下内容粘贴到**开发者信息中心 → 你的插件 → 隐私权规范**。后台是英文的，所以答案用英文，每条后面附中文对照。

## Single purpose / 单一用途

```text
Download all parts of a Google Takeout export in one go: queue the part downloads from the Takeout download page, resume and retry them, and help the user verify the downloaded files.
```

一次性下载 Google Takeout 导出的所有分卷：从 Takeout 下载页面把分卷加入队列，断点续传、失败重试，并帮助用户校验下载的文件。

## Permission justifications / 权限理由

**downloads**
```text
Core function. Starts each Takeout part download through Chrome's download manager, tracks progress, pauses/resumes/retries interrupted downloads, detects parts the user already downloaded to avoid duplicates, and saves the optional verify script and CSV manifest.
```
核心功能：通过 Chrome 下载管理器下载每个分卷，跟踪进度，暂停、恢复、重试，识别已下载的分卷避免重复，保存校验脚本和 CSV 清单。

**storage**
```text
Saves the user's settings and the download queue (part list, links, status, sizes) locally so progress survives browser restarts. Nothing is synced or sent anywhere.
```
在本地保存设置和下载队列，浏览器重启后进度不丢失。不同步、不上传。

**alarms**
```text
Wakes the service worker every 30 seconds while a download queue is active, to start the next part, retry failed parts and respect the user's download time window.
```
下载进行中每 30 秒唤醒一次后台，用来启动下一个分卷、重试失败的分卷、遵守用户设置的下载时段。

**notifications**
```text
Tells the user when all parts have finished, when the data cap is reached, or when Google requires them to sign in again before downloads can continue. Can be turned off in settings.
```
在全部下载完成、达到流量上限、或需要重新登录时通知用户。可在设置中关闭。

**power**
```text
Keeps the computer from going to sleep while a long download queue is running (exports are often hundreds of GB). Released as soon as downloads stop. Can be turned off in settings.
```
下载期间防止电脑休眠（导出经常有几百 GB），停止下载后立即释放。可在设置中关闭。

**Host permission: `https://takeout.google.com/*`**
```text
Reads the Takeout download page the user opens to find the download link for each part, and shows the "Download all" panel on that page. No other site is accessed.
```
读取用户打开的 Takeout 下载页面，找到每个分卷的下载链接，并在页面上显示“一键下载全部”面板。不访问其他网站。

## Remote code / 远程代码

**No, I am not using remote code.** All JavaScript is packaged in the extension.

否。所有代码都打包在插件里。

## Data usage / 数据使用

Tick **Website content** only (the extension reads download links from takeout.google.com pages). Leave all other
categories unticked.

只勾选 **网站内容**（插件会读取 takeout.google.com 页面上的下载链接），其他都不勾。

Tick all three certifications / 三项承诺全部勾选:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL / 隐私权政策网址

```text
https://github.com/beepony/takeout-batch-downloader/blob/main/docs/PRIVACY.md
```
