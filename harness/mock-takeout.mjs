// Local stand-in for takeout.google.com used by the e2e harness.
// Serves a manage page with N part links and real small zip files; can simulate
// re-auth (HTML response) and a mid-transfer network drop.
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const JOB = '0d5e7a11-c0de-4b2a-9e61-7a6e0a7c1234';

export async function startMock({ parts = 8, port = 8443, partBytes = 3 * 1024 * 1024 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mock-takeout-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=takeout.google.com', '-addext', 'subjectAltName=DNS:takeout.google.com,DNS:takeout-download.usercontent.google.com',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  const zips = [];
  for (let i = 1; i <= parts; i += 1) {
    const f = join(dir, `photo-${i}.bin`);
    const buf = Buffer.alloc(partBytes);
    for (let j = 0; j < buf.length; j += 4096) buf.writeUInt32LE((i * 2654435761 + j) >>> 0, j);
    writeFileSync(f, buf);
    const z = join(dir, `p${i}.zip`);
    execFileSync('zip', ['-q', '-0', z, `photo-${i}.bin`], { cwd: dir });
    zips.push(readFileSync(z));
  }
  const state = { requireAuthFor: new Set(), dropOnce: new Set(), raptOk: 'R1', hits: [], rangeHits: 0, legacyHits: 0, strictCookie: true, noCookie: 0, authHits: 0 };
  const stamp = '20261018T062654Z';
  const page = (rapt) => `<!doctype html><html><head><meta charset="utf-8"><title>Google 导出</title></head><body>
<h2>备份数据并提供下载链接</h2><p>您请求导出的数据总大小为 ${(parts * partBytes / 1024 ** 2).toFixed(0)}MB。这些文件将于 2026年10月25日 14:50 过期。</p>
<div id="list">${Array.from({ length: parts }, (_, k) => `<div class="row"><div>第 ${k + 1} 部分 ${(partBytes / 1024 ** 2).toFixed(2)}MB</div>
<div><a jsname="hSRGPd" aria-label="下载第 ${k + 1} 部分（共 ${parts} 部分）" href="/takeout/download?j=${JOB}&i=${k}&user=110&rapt=${rapt}">下载</a></div></div>`).join('\n')}</div>
<div><a aria-label="查看报告" href="/takeout/download?j=${JOB}&i=${parts}&user=110&rapt=${rapt}">查看报告</a></div>
<script>
// Like Takeout's own JS: a click on a part button navigates to the settings download URL.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[jsname="hSRGPd"]');
  if (!a) return;
  e.preventDefault();
  const u = new URL(a.href);
  location.href = '/settings/takeout/download?i=' + u.searchParams.get('i') + '&j=' + u.searchParams.get('j') + '&download=true&rapt=' + u.searchParams.get('rapt');
});
</script>
</body></html>`;
  const server = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    const url = new URL(req.url, 'https://takeout.google.com');
    if (url.pathname.startsWith('/manage/archive/')) {
      // Like Google's strict session cookies: only sent on same-site requests, not on extension-initiated ones.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'SSID=ok; Path=/; Secure; SameSite=Strict' });
      return res.end(page(url.searchParams.get('rapt') || state.raptOk));
    }
    // Like the real site: the anchor href only bounces back to the manage page.
    if (url.pathname === '/takeout/download') {
      state.legacyHits += 1;
      res.writeHead(302, { location: `/manage/archive/${JOB}?user=110&rapt=${url.searchParams.get('rapt') || ''}` });
      return res.end();
    }
    if (url.pathname === '/settings/takeout/download') {
      const i = Number(url.searchParams.get('i'));
      const rapt = url.searchParams.get('rapt');
      // Real Takeout sends requests that do not come from its own page (e.g. chrome.downloads from an
      // extension, Sec-Fetch-Site: none / cross-site) to ServiceLogin, even with a valid session.
      const site = req.headers['sec-fetch-site'] || 'none';
      if (state.strictCookie && !/^same-(origin|site)$/.test(site)) {
        state.noCookie += 1;
        res.writeHead(302, { location: 'https://takeout.google.com/ServiceLogin?passive=1' });
        return res.end();
      }
      if (rapt !== state.raptOk || state.requireAuthFor.has(i + 1) || url.searchParams.get('download') !== 'true') {
        state.hits.push({ part: i + 1, rapt, range: '', auth: true });
        state.authHits += 1;
        // Real Takeout bounces to accounts.google.com/ServiceLogin; the mock keeps it on this host.
        res.writeHead(302, { location: '/ServiceLogin?passive=1209600' });
        return res.end();
      }
      const name = `takeout-${stamp}-1-${String(i + 1).padStart(3, '0')}.zip`;
      res.writeHead(302, { location: `https://takeout-download.usercontent.google.com/download/${name}?j=${JOB}&i=${i}&user=999&authuser=0` });
      return res.end();
    }
    if (url.pathname.startsWith('/download/takeout-')) {
      const i = Number(url.searchParams.get('i'));
      state.hits.push({ part: i + 1, range: req.headers.range || '' });
      const body = zips[i];
      const name = `takeout-${stamp}-1-${String(i + 1).padStart(3, '0')}.zip`;
      const headers = { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${name}"`, 'accept-ranges': 'bytes', etag: `"p${i}"`, 'last-modified': 'Sat, 18 Oct 2026 06:26:54 GMT' };
      const m = (req.headers.range || '').match(/bytes=(\d+)-/);
      if (m) {
        state.rangeHits += 1;
        const start = Number(m[1]);
        res.writeHead(206, { ...headers, 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` });
        return res.end(body.subarray(start));
      }
      res.writeHead(200, { ...headers, 'content-length': body.length });
      if (state.dropOnce.has(i + 1)) {
        state.dropOnce.delete(i + 1);
        res.write(body.subarray(0, Math.floor(body.length / 3)));
        return setTimeout(() => req.socket.destroy(), 300);
      }
      // Trickle so concurrency is observable.
      let off = 0;
      const step = () => {
        if (off >= body.length) return res.end();
        res.write(body.subarray(off, off + 256 * 1024));
        off += 256 * 1024;
        setTimeout(step, Number(process.env.MOCK_DELAY || 40));
      };
      return step();
    }
    if (url.pathname === '/ServiceLogin') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<html><body>sign in</body></html>');
    }
    res.writeHead(404);
    res.end();
  });
  server.on('clientError', () => {});
  server.on('connection', (c) => c.on('error', () => {}));
  // CONNECT proxy: takeout.google.com -> mock, everything else refused (keeps the test offline).
  const proxy = http.createServer((req, res) => { res.writeHead(403); res.end(); });
  proxy.on('connect', (req, sock, head) => {
    if (!/^(takeout\.google\.com|takeout-download\.usercontent\.google\.com):443$/.test(req.url)) { sock.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const up = net.connect(port, '127.0.0.1', () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  await new Promise((r) => proxy.listen(port + 1, '127.0.0.1', r));
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, proxy, proxyPort: port + 1, state, dir, parts, stamp })));
}
