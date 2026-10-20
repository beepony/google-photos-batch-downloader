// Screenshot the real popup and on-page panel with demo data (no Google account, no real export).
// Usage: node tools/ui-shots.mjs   -> docs/images/*.png and store/assets/src/*.png
// The extension's HTML/CSS/JS is served unchanged; only chrome.* is replaced by tools/shots/stub.js.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8765;
const DEBUG = 9344;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === '/extension/popup/popup.html') {
    // Load the stub before popup.js (module scripts run in document order).
    const html = readFileSync(file, 'utf8').replace(
      '<script type="module" src="popup.js"></script>',
      `<script type="module" src="/tools/shots/stub.js${url.search}"></script>\n  <script type="module" src="popup.js"></script>`,
    );
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(html);
  }
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = mkdtempSync(join(tmpdir(), 'gpbd-shots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let wsUrl;
for (let i = 0; i < 80 && !wsUrl; i += 1) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    const p = pending.get(d.id);
    pending.delete(d.id);
    if (d.error) p.rej(new Error(JSON.stringify(d.error)));
    else p.res(d.result);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function shoot(url, out, { width, height, selector, before, clip }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, sessionId);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await sleep(1800);
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  if (before) {
    await evaluate(before);
    await sleep(600);
  }
  const rect = clip || await evaluate(`(() => { const r = (${selector}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  if (!rect) throw new Error(`nothing to capture for ${out}`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, captureBeyondViewport: true }, sessionId);
  writeFileSync(join(ROOT, out), Buffer.from(shot.data, 'base64'));
  await send('Target.closeTarget', { targetId });
  console.log(out);
}

const popup = (lang, scene) => `http://127.0.0.1:${PORT}/extension/popup/popup.html?tab=1&lang=${lang}&scene=${scene}`;
const BODY = 'document.body';
const openParts = `document.querySelectorAll('details.parts').forEach((d) => (d.open = true))`;

try {
  for (const lang of ['zh', 'en']) {
    await shoot(popup(lang, 'running'), `docs/images/popup-${lang}.png`, { width: 560, height: 1400, selector: BODY, before: openParts });
    await shoot(popup(lang, 'auth'), `docs/images/popup-auth-${lang}.png`, { width: 560, height: 1400, selector: BODY });
    await shoot(popup(lang, 'done'), `store/assets/src/popup-done-${lang}.png`, { width: 560, height: 1400, selector: BODY });
    await shoot(popup(lang, 'running'), `docs/images/settings-${lang}.png`, { width: 560, height: 1800, selector: BODY, before: `document.getElementById('gear').click()` });
    const page = `http://127.0.0.1:${PORT}/tools/shots/takeout.html?lang=${lang}&scene=running`;
    const bar = `document.getElementById('takeout-batch-host').shadowRoot.querySelector('.bar')`;
    await shoot(page, `store/assets/src/panel-${lang}.png`, { width: 1100, height: 720, selector: bar });
    // Right half of the page: the last download rows with the panel in the corner.
    await shoot(page, `docs/images/page-button-${lang}.png`, { width: 1100, height: 720, clip: { x: 470, y: 330, width: 630, height: 390 } });
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
