# Chrome 应用商店上架材料

[English](README.md)

把 **Google Photos 批量下载** 发布到 Chrome 应用商店需要的所有东西。

| 文件 | 用途 |
|---|---|
| [`LISTING.md`](LISTING.md) | 商店页面文案：名称、简介、详细说明、类别（中英文） |
| [`PRIVACY_PRACTICES.md`](PRIVACY_PRACTICES.md) | **隐私权规范**页面要填的内容：单一用途、每个权限的理由、数据使用 |
| [`assets/en/`](assets/en)、[`assets/zh/`](assets/zh) | 1280×800 截图 5 张、440×280 小宣传图、1400×560 大幅宣传图 |
| [`../tools/ui-shots.mjs`](../tools/ui-shots.mjs) | 用演示数据截取真实的弹窗和页面面板 → `docs/images`、`assets/src` |
| [`../tools/store-assets.mjs`](../tools/store-assets.mjs) | 用这些截图生成商店图片（`node tools/store-assets.mjs`，需要 Chrome） |
| [`../tools/store-kit.sh`](../tools/store-kit.sh) | 把上传 zip、图标、截图、宣传图和文案汇总到 `dist/store-kit-<版本>/` |
| [`../tools/pack.sh`](../tools/pack.sh) | 打包上传用的 zip：`dist/google-photos-batch-downloader-<版本>.zip` |

## 上架步骤

### 一次性准备
- [ ] 在 [Chrome 应用商店开发者信息中心](https://chrome.google.com/webstore/devconsole) 注册，支付一次性 5 美元注册费。
- [ ] 给这个 Google 账号开启两步验证（发布必须）。
- [ ] **账号 → 联系邮箱**：填写并验证联系邮箱。

### 上传
- [ ] 界面有改动时先更新图片：`node tools/ui-shots.mjs && node tools/store-assets.mjs`。
- [ ] 运行 `bash tools/store-kit.sh`，要上传的东西都在 `dist/store-kit-<版本>/`。
- [ ] `node --test tests/*.test.mjs` 全部通过。
- [ ] 如果这个版本号上传过，先改 `extension/manifest.json` 里的 `version`，并更新 CHANGELOG。
- [ ] 运行 `bash tools/pack.sh`，上传 `dist/google-photos-batch-downloader-<版本>.zip`（**添加新内容**）。

### 商品详情
- [ ] 详细说明、类别、语言：从 [`LISTING.md`](LISTING.md) 复制。名称和简介会自动读取 zip 里的 `_locales`。
- [ ] 添加 **简体中文** 作为第二语言，粘贴中文说明。
- [ ] 128×128 图标：`extension/icons/icon128.png`。
- [ ] 截图：英文用 `assets/en/1…5`，中文用 `assets/zh/1…5`。
- [ ] 小宣传图：`assets/<语言>/promo-small-440x280.png`；大幅宣传图（可选）：`promo-marquee-1400x560.png`。
- [ ] 首页网址：`https://github.com/beepony/google-photos-batch-downloader`
- [ ] 支持网址：`https://github.com/beepony/google-photos-batch-downloader/issues`

### 隐私权规范
- [ ] 从 [`PRIVACY_PRACTICES.md`](PRIVACY_PRACTICES.md) 粘贴单一用途说明和每个权限的理由。
- [ ] 是否使用远程代码：**否**。
- [ ] 数据使用：只勾选 **网站内容**，再勾选下面三项承诺。
- [ ] 隐私权政策网址：`https://github.com/beepony/google-photos-batch-downloader/blob/main/docs/PRIVACY.md`

### 分发
- [ ] 免费、所有地区、**公开**（想先小范围试用可以选**不公开列出**）。

### 提交
- [ ] 点击**提交审核**。一般几天；因为要访问 Google 的网站，审核可能更久。
- [ ] 通过后：把商店链接加到两份 README 里，删掉“目前还没有上架”的说明。

## 审核注意

- 审核人员打不开你的 Takeout 导出。后台**测试说明**一栏可以这样写（英文）：
  > Requires a Google Takeout export ready to download (takeout.google.com → Manage exports). Open the
  > export's download page; a "Download all N parts" panel appears at the bottom right. Click it and watch
  > progress in the toolbar popup. The repo includes an end-to-end test with a local mock of the page:
  > https://github.com/beepony/google-photos-batch-downloader#development
- 说明要实事求是，不要让人误以为是 Google 官方出品；说明结尾的免责声明就是为此准备的。
