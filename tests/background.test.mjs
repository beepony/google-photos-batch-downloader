// Drives the real service worker against a fake chrome.* runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPartUrl } from '../extension/src/core.js';

const JOB = '0d5e7a11-c0de-4b2a-9e61-7a6e0a7c1234';
const GB2 = 2 * 1024 ** 3;

function makeChrome() {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => (listeners[name] = fn) });
  const store = {};
  const items = new Map();
  let nextId = 100;
  const fake = {
    items,
    listeners,
    store,
    behavior: () => ({ mime: 'application/zip', ok: true }),
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
        set: async (obj) => Object.assign(store, structuredClone(obj)),
      },
    },
    alarms: { create() {}, clear() {}, onAlarm: on('alarm') },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, openPopup: async () => {} },
    power: { requestKeepAwake() { fake.awake = true; }, releaseKeepAwake() { fake.awake = false; } },
    notifications: { create: (id, opts) => (fake.lastNotice = opts) },
    // One open Takeout tab whose content script "clicks" the part button, which starts a download.
    tabsList: [{ id: 1, windowId: 1, url: `https://takeout.google.com/manage/archive/${JOB}` }],
    tabs: {
      reload: async () => {},
      sendMessage: async (_id, msg) => {
        if (msg.type !== 'clickPart') return { ok: false };
        fake.clicks = (fake.clicks || 0) + 1;
        setTimeout(() => fake.downloads.download({ url: msg.url }), 0);
        return { ok: true };
      },
      create: async (o) => { fake.openedTab = o.url; fake.tabsCreated = (fake.tabsCreated || 0) + 1; },
      query: async () => fake.tabsList,
      update: async (id) => (fake.focusedTab = id),
    },
    i18n: { getUILanguage: () => fake.uiLang || 'en-US' },
    runtime: { onMessage: on('message'), onStartup: on('startup'), onInstalled: on('installed'), lastError: null, getURL: (p) => p },
    downloads: {
      onDeterminingFilename: on('determine'),
      onCreated: on('created'),
      onChanged: on('changed'),
      async download({ url }) {
        const id = nextId++;
        const b = fake.behavior(url);
        const part = Number(new URL(url).searchParams.get('i')) + 1;
        const item = {
          id,
          url,
          finalUrl: url,
          mime: b.mime,
          filename: b.mime === 'text/html' ? '/dl/download.html' : `/dl/takeout-20261018T062654Z-1-${String(part).padStart(3, '0')}.zip`,
          state: 'in_progress',
          bytesReceived: 0,
          totalBytes: GB2,
          fileSize: 0,
          exists: true,
          canResume: false,
          paused: false,
        };
        items.set(id, item);
        listeners.created?.(item);
        listeners.determine?.(item, (s) => {
          if (s?.filename) item.filename = '/dl/' + s.filename;
        });
        return id;
      },
      async search(q) {
        let list = [...items.values()];
        if (q.id !== undefined) list = list.filter((i) => i.id === q.id);
        if (q.state) list = list.filter((i) => i.state === q.state);
        if (q.urlRegex) list = list.filter((i) => new RegExp(q.urlRegex).test(i.url));
        if (q.filenameRegex) list = list.filter((i) => new RegExp(q.filenameRegex).test(i.filename));
        return list.map((i) => ({ ...i }));
      },
      async cancel(id) { const i = items.get(id); if (i) { i.state = 'interrupted'; i.error = 'USER_CANCELED'; } },
      async erase({ id }) { items.delete(id); },
      async pause(id) { items.get(id).paused = true; },
      async resume(id) { const i = items.get(id); i.paused = false; i.state = 'in_progress'; },
      show() {},
      showDefaultFolder() {},
    },
  };
  return fake;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

async function boot() {
  const fake = makeChrome();
  globalThis.chrome = fake;
  globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
  const mod = await import(`../extension/src/background.js?x=${Math.random()}`);
  const send = (msg) =>
    new Promise((resolve) => {
      fake.listeners.message(msg, {}, (r) => resolve(r));
    });
  return { fake, send, mod };
}

function scanMsg(n, opts = {}) {
  const records = [];
  for (let p = 1; p <= n; p += 1) {
    records.push({
      href: buildPartUrl({ jobId: JOB, part: p, user: '110', rapt: opts.rapt || 'R1' }),
      label: `下载第 ${p} 部分（共 ${n} 部分）`,
      text: `第 ${p} 部分 2GB`,
    });
  }
  return {
    type: 'scan',
    pageUrl: `https://takeout.google.com/manage/archive/${JOB}?user=110&rapt=${opts.rapt || 'R1'}`,
    pageText: '将于 2026年10月25日 14:50 过期',
    records,
  };
}

async function finish(fake, id, size = GB2 - 1000) {
  const i = fake.items.get(id);
  i.state = 'complete';
  i.bytesReceived = size;
  i.fileSize = size;
  await fake.listeners.changed({ id, state: { current: 'complete' } });
  await settle();
}

test('queues parts with concurrency, completes, and finishes job', async () => {
  const { fake, send } = await boot();
  let r = await send(scanMsg(5));
  assert.equal(r.data.summary.total, 5);
  await send({ type: 'settings', settings: { concurrency: 2, subfolder: 'Google Takeout' } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  let active = [...fake.items.values()].filter((i) => i.state === 'in_progress');
  assert.equal(active.length, 2);
  assert.match(active[0].filename, /\/dl\/Google Takeout\/takeout-.*-001\.zip/);
  assert.equal(fake.awake, true);

  // finish everything one by one
  for (let guard = 0; guard < 10; guard += 1) {
    active = [...fake.items.values()].filter((i) => i.state === 'in_progress');
    if (!active.length) break;
    await finish(fake, active[0].id);
  }
  const st = (await send({ type: 'getState' })).data;
  const job = st.jobs[0];
  assert.equal(job.summary.done, 5);
  assert.equal(job.status, 'done');
  assert.equal(fake.items.size, 5, 'no duplicate downloads');
  assert.equal(fake.awake, false);
  assert.match(fake.lastNotice.title, /complete/i, 'English UI by default for non-zh browser');
});

test('network interruption resumes the same download', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(2));
  await send({ type: 'settings', settings: { concurrency: 1 } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  const [first] = [...fake.items.values()];
  first.state = 'interrupted';
  first.error = 'NETWORK_FAILED';
  first.canResume = true;
  first.bytesReceived = 1000;
  await fake.listeners.changed({ id: first.id, state: { current: 'interrupted' } });
  await settle();
  const job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.parts.find((p) => p.part === 1).status, 'retrying');
  // Emulate the back-off elapsing, then let the periodic alarm fire.
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  await fake.listeners.alarm({ name: 'takeout-tick' });
  await settle();
  Date.now = realNow;
  assert.equal(fake.items.get(first.id).state, 'in_progress', 'resumed via chrome.downloads.resume');
  const part1 = [...fake.items.values()].filter((i) => /[?&]i=0(&|$)/.test(i.url));
  assert.equal(part1.length, 1, 'did not start a duplicate download of part 1');
});

test('HTML re-auth response pauses job and resumes after new rapt', async () => {
  const { fake, send } = await boot();
  fake.behavior = () => ({ mime: 'text/html' });
  await send(scanMsg(3));
  await send({ type: 'settings', settings: { concurrency: 2 } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  let job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.status, 'needs_auth');
  assert.equal(fake.focusedTab, 1, 'focuses the open Takeout tab');
  assert.equal(job.parts.filter((p) => p.status === 'done').length, 0);

  fake.behavior = () => ({ mime: 'application/zip' });
  await send(scanMsg(3, { rapt: 'R2' }));
  await settle();
  job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.status, 'running');
  const zips = [...fake.items.values()].filter((i) => i.state === 'in_progress' && /\.zip$/.test(i.filename));
  assert.ok(zips.length >= 1);
  assert.match(zips[0].url, /rapt=R2/);
});

test('data budget pauses after the configured amount', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(6));
  await send({ type: 'settings', settings: { concurrency: 3, dataBudgetGB: 4 } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  let active = [...fake.items.values()].filter((i) => i.state === 'in_progress');
  assert.equal(active.length, 2, 'only 2 x 2GB fit in 4GB');
  for (const a of active) await finish(fake, a.id);
  const job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.status, 'paused');
  assert.equal(job.notice.k, 'n_budget');
  assert.equal(job.summary.done, 2);
});

test('parts clicked manually on the page are adopted, not duplicated', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(3));
  // user clicks part 2 on the page before pressing start
  const url = buildPartUrl({ jobId: JOB, part: 2, user: '110', rapt: 'R1' });
  const id = await fake.downloads.download({ url });
  await settle();
  await send({ type: 'settings', settings: { concurrency: 3 } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  const urls = [...fake.items.values()].map((i) => Number(new URL(i.url).searchParams.get('i')) + 1).sort();
  assert.deepEqual(urls, [1, 2, 3]);
  await finish(fake, id);
  const job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.parts.find((p) => p.part === 2).status, 'done');
});

test('truncated file is retried', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(1));
  await send({ type: 'start', jobId: JOB });
  await settle();
  const [it] = [...fake.items.values()];
  await finish(fake, it.id, 5000);
  const job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.parts[0].status, 'retrying');
  assert.equal(job.parts[0].error.k, 'e_size');
});

test('notifications follow the chosen language', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(1));
  await send({ type: 'settings', settings: { language: 'zh' } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  const [it] = [...fake.items.values()];
  await finish(fake, it.id);
  assert.match(fake.lastNotice.title, /完成/);
});

const usercontent = (p) =>
  `https://takeout-download.usercontent.google.com/download/takeout-20261018T062654Z-1-${String(p).padStart(3, '0')}.zip?j=${JOB}&i=${p - 1}&user=999&authuser=0`;
const pageUrl = `https://takeout.google.com/manage/archive/${JOB}?user=110&rapt=R1`;

test('downloads use the settings/takeout/download URL, not the anchor href', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(2));
  await send({ type: 'start', jobId: JOB });
  await settle();
  const urls = [...fake.items.values()].map((i) => i.url);
  assert.ok(urls.length > 0);
  for (const u of urls) assert.match(u, /^https:\/\/takeout\.google\.com\/settings\/takeout\/download\?i=\d+&j=.*&download=true&rapt=R1$/);
});

test('"View report" link does not become an extra part', async () => {
  const { send } = await boot();
  const msg = scanMsg(3);
  msg.records.push({ href: `https://takeout.google.com/takeout/download?j=${JOB}&i=3&user=110&rapt=R1`, label: '查看报告', text: '' });
  const r = await send(msg);
  assert.equal(r.data.summary.total, 3);
  const job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.totalParts, 3);
});

test('files already downloaded by clicking on the page are adopted via finalUrl', async () => {
  const { fake, send } = await boot();
  for (const p of [1, 3]) {
    fake.items.set(p, {
      id: p, url: pageUrl, finalUrl: usercontent(p), mime: 'application/zip', state: 'complete', exists: true,
      filename: `/Volumes/S/takeout-20261018T062654Z-1-${String(p).padStart(3, '0')}.zip`, fileSize: GB2, bytesReceived: GB2,
    });
  }
  const r = await send(scanMsg(4));
  assert.equal(r.data.summary.done, 2);
  await send({ type: 'settings', settings: { concurrency: 4 } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  const started = [...fake.items.values()].filter((i) => i.state === 'in_progress').map((i) => Number(new URL(i.url).searchParams.get('i')) + 1).sort();
  assert.deepEqual(started, [2, 4]);
});

test('a page click is tracked once it redirects to the usercontent host', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(2));
  const item = { id: 7, url: pageUrl, finalUrl: pageUrl, mime: '', state: 'in_progress', exists: true, filename: '', bytesReceived: 0 };
  fake.items.set(7, item);
  await fake.listeners.created({ ...item });
  item.finalUrl = usercontent(2);
  item.filename = '/dl/takeout-20261018T062654Z-1-002.zip';
  await fake.listeners.changed({ id: 7, filename: { current: item.filename } });
  await settle();
  let job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.parts.find((p) => p.part === 2).status, 'downloading');
  await finish(fake, 7);
  job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.parts.find((p) => p.part === 2).status, 'done');
});

test('auth reuses the open Takeout tab and stops looping after re-verification', async () => {
  const { fake, send } = await boot();
  fake.tabsList = [{ id: 42, windowId: 1, url: pageUrl }];
  fake.behavior = () => ({ mime: 'text/html' });
  await send(scanMsg(2));
  await send({ type: 'start', jobId: JOB });
  await settle();
  let job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.status, 'needs_auth');
  assert.equal(fake.focusedTab, 42);
  assert.equal(fake.tabsCreated || 0, 0, 'no new tab');

  // "Verified" (new rapt) but Google still answers with HTML -> pause, no loop.
  await send(scanMsg(2, { rapt: 'R2' }));
  await settle();
  job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.status, 'paused');
  assert.equal(job.notice.k, 'n_authLoop');
  const before = fake.items.size;
  await send(scanMsg(2, { rapt: 'R3' }));
  await settle();
  assert.equal(fake.items.size, before, 'paused job does not retry on its own');
});

test('rapt is taken from the part links when the tab URL has none', async () => {
  const { fake, send } = await boot();
  const msg = scanMsg(2, { rapt: 'FROMLINK' });
  msg.pageUrl = `https://takeout.google.com/manage/archive/${JOB}`;
  await send(msg);
  await send({ type: 'start', jobId: JOB });
  await settle();
  const urls = [...fake.items.values()].map((i) => i.url);
  assert.ok(urls.length > 0);
  for (const u of urls) assert.match(u, /rapt=FROMLINK$/);
});

test('parts finished earlier and then moved to another folder still count as done', async () => {
  const { fake, send } = await boot();
  fake.items.set(1, {
    id: 1, url: pageUrl, finalUrl: usercontent(1), mime: 'application/zip', state: 'complete', exists: false,
    filename: '/Volumes/S/takeout-20261018T062654Z-1-001.zip', fileSize: GB2, totalBytes: GB2, bytesReceived: GB2,
  });
  const r = await send(scanMsg(2));
  assert.equal(r.data.summary.done, 1);
});

test('parts are started by clicking on the Takeout page, one at a time', async () => {
  const { fake, send } = await boot();
  await send(scanMsg(3));
  await send({ type: 'settings', settings: { concurrency: 3 } });
  await send({ type: 'start', jobId: JOB });
  await settle();
  assert.equal(fake.clicks, 3, 'each started part is a page click');
  assert.equal(fake.downloads.direct || 0, 0);
});

test('no Takeout tab open: asks for the page instead of downloading directly', async () => {
  const { fake, send } = await boot();
  fake.tabsList = [];
  await send(scanMsg(2));
  await send({ type: 'start', jobId: JOB });
  await settle();
  assert.equal(fake.items.size, 0);
  const job = (await send({ type: 'getState' })).data.jobs[0];
  assert.equal(job.notice.k, 'n_needPage');
  assert.match(fake.openedTab, /manage\/archive/);
});

test('open download folder reveals a file in the save subfolder', async () => {
  const { fake, send } = await boot();
  fake.items.set(5, { id: 5, url: 'x', state: 'complete', exists: true, filename: '/dl/Google Takeout/takeout-20261018T062654Z-1-005.zip', endTime: '2026-10-20' });
  fake.downloads.show = (id) => (fake.shown = id);
  fake.downloads.showDefaultFolder = () => (fake.shown = 'default');
  await send({ type: 'openDownloadDir' });
  assert.equal(fake.shown, 5);
  fake.items.clear();
  await send({ type: 'openDownloadDir' });
  assert.equal(fake.shown, 'default');
});
