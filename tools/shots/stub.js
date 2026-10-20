// Stand-in for chrome.* used by tools/ui-shots.mjs. Demo data only: fake job id, no personal info.
import { summarize } from '../../extension/src/core.js';

const q = new URLSearchParams(new URL(import.meta.url).search || location.search);
const lang = q.get('lang') || new URLSearchParams(location.search).get('lang') || 'en';
const scene = q.get('scene') || new URLSearchParams(location.search).get('scene') || 'running';
const GB = 1024 ** 3;
const TOTAL = 166;
const now = Date.now();

function makeJob() {
  const parts = {};
  for (let n = 1; n <= TOTAL; n += 1) {
    const p = { part: n, sizeBytes: 2 * GB, status: 'pending', attempts: 0, bytes: 0 };
    if (scene === 'done' || n <= 97) Object.assign(p, { status: 'done', fileSize: 2 * GB - 1500 * n, bytes: 2 * GB });
    else if (scene === 'running' && n <= 101) Object.assign(p, { status: 'downloading', downloadId: n, bytes: [1.62, 1.1, 0.58, 0.21][n - 98] * GB });
    else if (scene === 'running' && n === 102) Object.assign(p, { status: 'retrying', attempts: 1 });
    parts[n] = p;
  }
  const job = {
    jobId: '0d5e7a11-c0de-4b2a-9e61-7a6e0a7c1234',
    totalParts: TOTAL,
    expiresAt: now + 5 * 86400000,
    createdAt: now - 6 * 3600000,
    status: { running: 'running', auth: 'needs_auth', done: 'done' }[scene],
    notice: '',
    parts,
  };
  const list = Object.values(parts).map((p) => ({ ...p, paused: false, totalBytesLive: p.status === 'downloading' ? 2 * GB : 0 }));
  return {
    ...job,
    parts: list,
    speed: scene === 'running' ? 41.6 * 1024 ** 2 : 0,
    summary: summarize(job),
    nextAuthAt: scene === 'running' ? now + 14 * 60000 : 0,
    bursting: false,
  };
}

const settings = {
  concurrency: 3,
  subfolder: 'Google Takeout',
  dataBudgetGB: 0,
  keepAwake: true,
  keepScreenOn: true,
  notify: true,
  maxAttempts: 3,
  windowEnabled: false,
  windowStart: '00:00',
  windowEnd: '08:00',
  language: lang,
  burstSize: 6,
  authSound: true,
};

const job = makeJob();
globalThis.chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: '0.5.1' }),
    getURL: (p) => `/extension/${p}`,
    sendMessage(msg, cb) {
      const data = msg.type === 'getState' ? { settings, jobs: [job] } : msg.type === 'scan' ? { jobId: job.jobId } : true;
      setTimeout(() => cb?.({ ok: true, data }), 0);
    },
    onMessage: { addListener() {} },
  },
  i18n: { getUILanguage: () => (lang === 'zh' ? 'zh-CN' : 'en-US') },
  tabs: { create() {} },
};
