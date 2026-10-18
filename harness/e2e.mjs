// End-to-end: real Chrome + the unpacked extension + mock takeout server.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startMock, JOB } from './mock-takeout.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const EXT = resolve(new URL('../extension', import.meta.url).pathname);
const PARTS = Number(process.env.PARTS || 8);
const LANG = process.env.UI_LANG || 'zh';
const SHOT = (n) => join(process.cwd(), 'harness', `shot-${n}-${LANG}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

process.on('uncaughtException', (e) => { if (e.code !== 'ECONNRESET') throw e; });
const mock = await startMock({ parts: PARTS, partBytes: Number(process.env.PART_BYTES || 3 * 1024 * 1024) });
mock.state.dropOnce.add(3); // network drop mid-transfer on part 3
const profile = mkdtempSync(join(tmpdir(), 'tk-chrome-'));
const downloads = mkdtempSync(join(tmpdir(), 'tk-dl-'));
mkdirPrefs(profile, downloads);

const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=9333',
  '--enable-unsafe-extension-debugging',
  '--no-first-run', '--no-default-browser-check', '--disable-sync',
  `--proxy-server=http://127.0.0.1:${mock.proxyPort}`,
  '--disable-quic', '--disable-features=DnsOverHttps',
  '--ignore-certificate-errors',
  '--window-size=1200,900',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.on('data', () => {});

function mkdirPrefs(dir, dl) {
  execFileSync('mkdir', ['-p', join(dir, 'Default')]);
  writeFileSync(join(dir, 'Default', 'Preferences'), JSON.stringify({
    download: { default_directory: dl, prompt_for_download: false, directory_upgrade: true },
    profile: { default_content_setting_values: { automatic_downloads: 1 } },
  }));
}

async function cdpBrowser() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const v = await (await fetch('http://127.0.0.1:9333/json/version')).json();
      return v.webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  throw new Error('chrome did not start');
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.events = [];
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { const p = this.pending.get(d.id); this.pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
      else this.events.push(d);
    };
  }
  open() { return new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; }); }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

let ok = false;
try {
  const cdp = new Cdp(await cdpBrowser());
  await cdp.open();
  const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
  log('extension loaded', extId);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true }).catch(() => {});
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' }).catch(() => {});

  const { targetId } = await cdp.send('Target.createTarget', { url: `https://takeout.google.com/manage/archive/${JOB}?user=110&rapt=R1` });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Runtime.enable', {}, sessionId);
  await sleep(2500);

  const evalPage = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  const barText = () => evalPage(`(() => { const h = document.getElementById('takeout-batch-host'); return h ? h.shadowRoot.querySelector('.bar').innerText : null; })()`);
  log('bar:', JSON.stringify(await barText()));
  log('page:', JSON.stringify(await evalPage(`[location.href, document.title, document.querySelectorAll('a[href*="takeout/download"]').length, !!window.__takeoutBatchLoaded]`)));
  const tg = (await cdp.send('Target.getTargets')).targetInfos.map((t) => t.type + ' ' + t.url);
  log('targets:', tg.join(' | '));
  if (process.env.DEBUG_ONLY) throw new Error('debug stop');
  await cdp.send('Page.enable', {}, sessionId);
  const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(SHOT('page'), Buffer.from(shot1.data, 'base64'));

  // Configure via the popup page, then click the one-click button on the page.
  const popup = await cdp.send('Target.createTarget', { url: `chrome-extension://${extId}/popup/popup.html?tab=1` });
  const ps = (await cdp.send('Target.attachToTarget', { targetId: popup.targetId, flatten: true })).sessionId;
  await cdp.send('Runtime.enable', {}, ps);
  await sleep(800);
  const evalPopup = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, ps)).result.value;
  await evalPopup(`new Promise(r => chrome.runtime.sendMessage({type:'settings', settings:{concurrency:3, subfolder:'Google Takeout', language:'${LANG}'}}, r))`);

  await cdp.send('Target.activateTarget', { targetId });
  await sleep(2500);
  const shotBar = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(SHOT('page'), Buffer.from(shotBar.data, 'base64'));
  await evalPage(`document.getElementById('takeout-batch-host').shadowRoot.querySelector('.main').click()`);
  log('clicked one-click download');

  // Midway: simulate Google asking for re-auth for part 6 (HTML response).
  mock.state.requireAuthFor.add(6);
  let authSeen = false;
  const t0 = Date.now();
  let st;
  while (Date.now() - t0 < 300_000) {
    await sleep(1000);
    st = await evalPopup(`new Promise(r => chrome.runtime.sendMessage({type:'getState'}, x => r(x.data)))`);
    const job = st.jobs[0];
    const s = job.summary;
    const active = job.parts.filter((p) => ['starting', 'downloading'].includes(p.status)).length;
    log(`status=${job.status} done=${s.done}/${job.totalParts} active=${active} notice=${job.notice || ''}`);
    if (active > 3) throw new Error('concurrency exceeded');
    if (job.status === 'needs_auth' && !authSeen) {
      authSeen = true;
      await cdp.send('Target.activateTarget', { targetId: popup.targetId });
      await sleep(1800);
      const shotAuth = await cdp.send('Page.captureScreenshot', { format: 'png' }, ps);
      writeFileSync(SHOT('popup-auth'), Buffer.from(shotAuth.data, 'base64'));
      log('auth requested -> user "verifies" (new rapt R2)');
      mock.state.requireAuthFor.clear();
      mock.state.raptOk = 'R2';
      // Re-verification lands the user back on the manage page with a new rapt.
      const tabs = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && t.url.includes('/manage/archive/'));
      for (const t of tabs) {
        const s2 = (await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
        await cdp.send('Page.navigate', { url: `https://takeout.google.com/manage/archive/${JOB}?user=110&rapt=R2` }, s2);
      }
    }
    if (authSeen && job.status === 'running' && active > 0 && s.done >= 10 && !globalThis.__midShot) {
      globalThis.__midShot = true;
      await cdp.send('Target.activateTarget', { targetId: popup.targetId });
      await cdp.send('Runtime.evaluate', { expression: "document.getElementById('settings').hidden = true" }, ps);
      await sleep(2000);
      const m = await cdp.send('Page.captureScreenshot', { format: 'png' }, ps);
      await cdp.send('Target.activateTarget', { targetId });
      writeFileSync(SHOT('popup-mid'), Buffer.from(m.data, 'base64'));
    }
    if (job.status === 'done') break;
  }
  await cdp.send('Target.activateTarget', { targetId: popup.targetId });
  await sleep(1800);
  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' }, ps);
  writeFileSync(SHOT('popup-done'), Buffer.from(shot2.data, 'base64'));

  // Export the verify script and run it.
  log('exportVerify ->', JSON.stringify(await evalPopup(`new Promise(r => chrome.runtime.sendMessage({type:'exportVerify', jobId:'${JOB}'}, r))`)));
  log('dl dir:', JSON.stringify(readdirSync(downloads)));
  await sleep(1500);
  const folder = join(downloads, 'Google Takeout');
  const files = existsSync(folder) ? readdirSync(folder).sort() : readdirSync(downloads);
  log('files:', files.join(', '));
  let verifyOut = '';
  try { verifyOut = execFileSync('/bin/bash', [join(folder, 'verify-takeout.sh')], { encoding: 'utf8' }); }
  catch (e) { verifyOut = e.stdout + e.stderr; }
  log('verify:', verifyOut.trim().split('\n').slice(-2).join(' | '));
  const zips = files.filter((f) => /^takeout-.*\.zip$/.test(f));
  const dupes = zips.filter((f) => / \(\d+\)\.zip$/.test(f));
  const job = st.jobs[0];
  log(`authSeen=${authSeen} rangeResumes=${mock.state.rangeHits} zips=${zips.length} dupes=${dupes.length} hitsPerPart=${JSON.stringify(mock.state.hits.reduce((a, h) => ((a[h.part] = (a[h.part] || 0) + 1), a), {}))}`);
  ok = job.status === 'done' && zips.length === PARTS && dupes.length === 0 && /ALL GOOD/.test(verifyOut) && authSeen;
  log(ok ? 'E2E PASS' : 'E2E FAIL');
} catch (e) {
  console.error(e);
} finally {
  chrome.kill('SIGTERM');
  mock.server.close();
  mock.proxy.close();
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}
