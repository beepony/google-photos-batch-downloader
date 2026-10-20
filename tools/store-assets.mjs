// Render Chrome Web Store images (screenshots + promo tiles) from HTML with headless Chrome.
// Usage: node tools/store-assets.mjs   -> store/assets/{en,zh}/*.png
// Inputs: docs/images/*.png and store/assets/src/*.png (cropped from harness/shot-*.png of the e2e run).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const img = (p) => 'file://' + join(ROOT, p);

const T = {
  en: {
    name: 'Google Photos Batch Downloader',
    tag: 'Every Google Takeout part. One click.',
    s1: ['One click, every part', 'A “Download all” button appears on your Takeout page. No more clicking every link by hand.'],
    s2: ['Live progress for every part', 'Queue, concurrency, speed and time left at a glance. Close the tab — it keeps going.'],
    s3: ['Sign-in prompts? Handled', 'When Google asks you to verify, the queue pauses and resumes the moment you’re done.'],
    s4: ['Done, and verified', 'Export a verify script that tests every zip with unzip -t. Know nothing is missing.'],
    s5: ['Built for huge exports', ''],
    page: ['Download your files', 'Your export has 40 parts. Links expire on Oct 25, 2026.', (n) => `Part ${n} of 40`, 'Download'],
    feats: [['↻', 'Auto resume', 'Dropped connections continue where they stopped'], ['⧉', 'No duplicates', 'Skips parts you already have'], ['◔', 'Data cap', 'Stop after N GB per run'], ['☾', 'Night window', 'Download only during set hours'], ['☀', 'Keep awake', 'Your computer won’t sleep mid-download'], ['✓', 'Integrity check', 'unzip -t every part + CSV manifest']],
    privacy: 'No servers · No tracking · Runs entirely in your browser',
    small: 'Download every Takeout part in one click',
  },
  zh: {
    name: 'Google Photos 批量下载',
    tag: 'Google Takeout 所有分卷，一键下载。',
    s1: ['一键下载全部分卷', 'Takeout 页面右下角出现“一键下载全部”按钮，不用再一个个点 166 次。'],
    s2: ['进度一目了然', '排队、并发、速度、剩余时间实时显示。关掉页面也会继续下载。'],
    s3: ['验证登录？自动接续', '需要重新登录时自动暂停，验证完成后立即继续。'],
    s4: ['完成后逐个校验', '导出校验脚本，用 unzip -t 检查每个压缩包，确保一个不少。'],
    s5: ['为超大导出而设计', ''],
    page: ['下载您的文件', '导出数据共 166 个部分，链接将于 2026年10月25日 过期。', (n) => `第 ${n} 部分（共 166 部分）`, '下载'],
    feats: [['↻', '断点续传', '网络中断后从断点继续'], ['⧉', '不重复下载', '自动跳过已有分卷'], ['◔', '流量上限', '每轮下载 N GB 后暂停'], ['☾', '定时下载', '只在指定时段下载，比如夜间'], ['☀', '防止休眠', '下载期间电脑不会睡眠'], ['✓', '完整性校验', '逐个 unzip -t + CSV 清单']],
    privacy: '无服务器 · 无追踪 · 完全在浏览器内运行',
    small: '一键下载 Takeout 全部分卷',
  },
};

const CSS = `
*{box-sizing:border-box;margin:0}
:root{--paper:#f7f0e1;--paper2:#efe3c8;--ink:#1d2a23;--muted:#6d6047;--line:#d8c7a0;--teal:#0f766e;--amber:#b7791f}
body{width:var(--w);height:var(--h);overflow:hidden;color:var(--ink);
 font-family:"Avenir Next","PingFang SC","Hiragino Sans GB",sans-serif;
 background:radial-gradient(circle at 92% 8%,rgba(15,118,110,.22),transparent 42%),
 radial-gradient(circle at 0% 100%,rgba(183,121,31,.16),transparent 45%),
 repeating-linear-gradient(0deg,rgba(120,95,40,.06) 0 1px,transparent 1px 28px),
 linear-gradient(180deg,var(--paper),var(--paper2))}
h1,h2{font-family:"Avenir Next Condensed","Avenir Next","PingFang SC",sans-serif;font-weight:700;letter-spacing:.01em}
.brand{display:flex;align-items:center;gap:14px}
.brand img{width:56px;height:56px}
.brand b{font:700 26px "Avenir Next Condensed","Avenir Next","PingFang SC",sans-serif}
.shot{border-radius:22px;box-shadow:0 30px 70px -20px rgba(60,45,15,.45),0 0 0 1px var(--line)}
.kicker{color:var(--teal);font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:16px}
`;

function shotPage(t, title, sub, src) {
  return `<div style="display:grid;grid-template-columns:470px 1fr;height:100%;padding:64px 56px 56px 72px;gap:40px;align-items:center">
  <div>
    <div class="brand"><img src="${img('extension/icons/icon128.png')}"><b>${t.name}</b></div>
    <h2 style="font-size:54px;line-height:1.08;margin:56px 0 22px">${title}</h2>
    <p style="font-size:23px;line-height:1.55;color:var(--muted)">${sub}</p>
  </div>
  <div style="display:flex;justify-content:center;align-items:center;height:100%">
    ${src.startsWith('<') ? src : `<img class="shot" src="${src}" style="max-width:100%;max-height:640px">`}
  </div></div>`;
}

// A simplified stand-in for the Takeout "Manage exports" page, with the real panel screenshot on top.
function takeoutMock(t, l) {
  const [h, sub, part, dl] = t.page;
  const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid #eceff1">
    <span style="font-size:15px;color:#3c4043">${part(n)}</span>
    <span style="font-size:14px;color:#1a73e8;border:1px solid #dadce0;border-radius:4px;padding:5px 14px">${dl}</span></div>`).join('');
  return `<div class="shot" style="width:640px;height:560px;background:#fff;position:relative;overflow:hidden;font-family:Arial,'PingFang SC',sans-serif">
    <div style="height:46px;border-bottom:1px solid #eceff1;display:flex;align-items:center;padding:0 22px;gap:8px;color:#5f6368;font-size:17px">
      <b style="color:#4285f4">G</b> Takeout</div>
    <div style="padding:20px 26px"><div style="font-size:22px;color:#202124">${h}</div>
    <div style="font-size:13.5px;color:#5f6368;margin:6px 0 10px">${sub}</div>${rows}</div>
    <img src="${img(`store/assets/src/panel-${l}.png`)}" style="position:absolute;right:16px;bottom:16px;width:400px;border-radius:14px;box-shadow:0 18px 40px -12px rgba(60,45,15,.5)"></div>`;
}

function featPage(t) {
  return `<div style="padding:62px 72px">
   <div class="brand"><img src="${img('extension/icons/icon128.png')}"><b>${t.name}</b></div>
   <h2 style="font-size:56px;margin:34px 0 36px">${t.s5[0]}</h2>
   <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:22px">
   ${t.feats.map(([i, a, b]) => `<div style="background:rgba(255,251,240,.8);border:1px solid var(--line);border-radius:20px;padding:26px 26px 24px">
     <div style="width:52px;height:52px;border-radius:14px;background:var(--teal);color:#fff8e8;display:grid;place-items:center;font-size:28px">${i}</div>
     <div style="font-size:27px;font-weight:700;margin:16px 0 6px">${a}</div>
     <div style="font-size:19px;color:var(--muted);line-height:1.4">${b}</div></div>`).join('')}
   </div>
   <p style="margin-top:34px;text-align:center;font-size:20px;color:var(--teal);font-weight:600;letter-spacing:.06em">${t.privacy}</p></div>`;
}

function smallTile(t) {
  return `<div style="height:100%;padding:34px 34px;display:flex;flex-direction:column;justify-content:space-between">
   <img src="${img('extension/icons/icon128.png')}" style="width:76px;height:76px">
   <div><h1 style="font-size:31px;line-height:1.1">${t.name}</h1>
   <p style="font-size:18px;color:var(--muted);margin-top:8px;line-height:1.35">${t.small}</p></div></div>`;
}

function marquee(t, l) {
  return `<div style="display:grid;grid-template-columns:600px 1fr;height:100%;padding:0 70px;align-items:center;gap:40px">
   <div><div class="brand"><img src="${img('extension/icons/icon128.png')}" style="width:84px;height:84px"></div>
   <h1 style="font-size:58px;line-height:1.05;margin:26px 0 14px">${t.name}</h1>
   <p style="font-size:26px;color:var(--muted)">${t.tag}</p></div>
   <div style="display:flex;justify-content:center"><img class="shot" src="${img(`store/assets/src/popup-done-${l}.png`)}" style="height:440px"></div></div>`;
}

function render(html, w, h, out) {
  const dir = mkdtempSync(join(tmpdir(), 'tbd-store-'));
  const f = join(dir, 'p.html');
  writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body style="--w:${w}px;--h:${h}px">${html}</body>`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', `--user-data-dir=${join(dir, 'prof')}`,
    `--window-size=${w},${h}`, `--screenshot=${out}`, 'file://' + f], { stdio: 'ignore' });
  console.log(out);
}

for (const l of ['en', 'zh']) {
  const t = T[l];
  const out = join(ROOT, 'store/assets', l);
  mkdirSync(out, { recursive: true });
  render(shotPage(t, ...t.s1, takeoutMock(t, l)), 1280, 800, join(out, '1-download-all.png'));
  render(shotPage(t, ...t.s2, img(`docs/images/popup-${l}.png`)), 1280, 800, join(out, '2-progress.png'));
  render(shotPage(t, ...t.s3, img(`docs/images/popup-auth-${l}.png`)), 1280, 800, join(out, '3-sign-in.png'));
  render(shotPage(t, ...t.s4, img(`store/assets/src/popup-done-${l}.png`)), 1280, 800, join(out, '4-done.png'));
  render(featPage(t), 1280, 800, join(out, '5-features.png'));
  render(smallTile(t), 440, 280, join(out, 'promo-small-440x280.png'));
  render(marquee(t, l), 1400, 560, join(out, 'promo-marquee-1400x560.png'));
}
