// Service worker: owns the download queue for every detected Takeout job.
import {
  ACTIVE,
  backoffMs,
  buildJobFromScan,
  buildManifestCsv,
  buildVerifyScript,
  classifyInterrupt,
  formatBytes,
  isArchiveName,
  isAuthResponse,
  isDownloadLimitText,
  isPartFile,
  parsePartLink,
  partFromFilename,
  planNext,
  sizeLooksRight,
  summarize,
} from './core.js';
import { resolveLang, t } from './i18n.js';

const DEFAULTS = {
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
  language: 'auto',
  burstSize: 6,
  authSound: true,
};
const TICK_ALARM = 'takeout-tick';
const STALL_MS = 5 * 60_000;
const ICON = 'icons/icon128.png';
// Google's re-verification for Takeout downloads lasts roughly 20 minutes (observed, not documented).
// Downloads that already started keep going after it lapses; only new part starts need it.
export const AUTH_TTL_MS = 20 * 60_000;
// Start extra parts only while the verification is surely still valid.
const BURST_MS = 17 * 60_000;

let state = null;
let chain = Promise.resolve();
const live = new Map(); // downloadId -> { bytes, at, speed }

function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch((e) => console.error('[takeout]', e));
  return run;
}

async function load() {
  if (state) return state;
  const raw = await chrome.storage.local.get(['settings', 'jobs', 'dl', 'aux']);
  state = {
    settings: { ...DEFAULTS, ...(raw.settings || {}) },
    jobs: raw.jobs || {},
    dl: raw.dl || {},
    aux: raw.aux || {},
  };
  // Google allows each part only ~5 download attempts, so never spend more than 3 on retries.
  state.settings.maxAttempts = Math.min(Number(state.settings.maxAttempts) || 3, 3);
  return state;
}

async function save() {
  await chrome.storage.local.set({ settings: state.settings, jobs: state.jobs, dl: state.dl, aux: state.aux });
}

function newPart(p) {
  return { part: p.part, url: p.url, sizeBytes: p.sizeBytes || 0, status: 'pending', attempts: 0, bytes: 0 };
}

const M = (k, p) => ({ k, p });
function lang() {
  return resolveLang(state?.settings.language, chrome.i18n?.getUILanguage?.() || '');
}

function notify(id, titleKey, bodyKey, params = {}, extra = {}) {
  const title = t(lang(), titleKey, params);
  const message = t(lang(), bodyKey, params);
  if (!state?.settings.notify || !chrome.notifications) return;
  chrome.notifications.create(id, { type: 'basic', iconUrl: ICON, title, message, priority: 1, ...extra }, () => void chrome.runtime.lastError);
}

// A service worker cannot play audio, so a tiny offscreen page plays a chime and closes itself.
async function chime() {
  if (!state?.settings.authSound || !chrome.offscreen?.createDocument) return;
  try {
    if (await chrome.offscreen.hasDocument?.()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen/chime.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play a short chime when Google asks the user to verify their identity',
    });
    const off = chrome.offscreen;
    setTimeout(() => off?.closeDocument?.()?.catch?.(() => {}), 3000);
  } catch (e) {
    console.warn('[takeout] chime', e);
  }
}

// Fresh verification: open a burst window and predict when Google will ask again.
function markVerified(job, now = Date.now()) {
  job.authAt = now;
  job.authNeededAt = 0;
  chrome.notifications?.clear?.(`auth-${job.jobId}`, () => void chrome.runtime.lastError);
}

// While a verification is fresh, start up to burstSize parts so each verification covers more parts.
export function effectiveConcurrency(job, settings, now = Date.now()) {
  const base = settings.concurrency || 3;
  const burst = Number(settings.burstSize) || 0;
  if (burst > base && job.authAt && now - job.authAt < BURST_MS) return burst;
  return base;
}

function baseName(path) {
  return String(path || '').split(/[\\/]/).pop();
}

const AUTH_LOOP_MS = 2 * 60_000;

function jobForUrl(url) {
  const info = parsePartLink(url || '');
  if (!info) return null;
  const job = state.jobs[info.jobId];
  return job ? { job, info } : { job: null, info };
}

// Page clicks start at the manage page and redirect to the usercontent host, so check every URL we know.
function jobForItem(item) {
  return jobForUrl(item.url) || jobForUrl(item.finalUrl);
}

function inWindow(settings, now = new Date()) {
  if (!settings.windowEnabled) return true;
  const toMin = (s) => {
    const [h, m] = String(s).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = toMin(settings.windowStart);
  const b = toMin(settings.windowEnd);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

// ---------- job lifecycle ----------

async function upsertFromScan(scan) {
  const parsed = buildJobFromScan(scan);
  if (!parsed) return null;
  let job = state.jobs[parsed.jobId];
  const raptBefore = job?.rapt || '';
  if (!job) {
    job = {
      jobId: parsed.jobId,
      user: parsed.user,
      pageUrl: parsed.pageUrl,
      title: parsed.title,
      totalParts: parsed.totalParts,
      expiresAt: parsed.expiresAt,
      createdAt: Date.now(),
      status: 'idle',
      sessionBytes: 0,
      parts: {},
    };
    state.jobs[job.jobId] = job;
  }
  job.pageUrl = parsed.pageUrl;
  if (parsed.rapt) job.rapt = parsed.rapt;
  job.totalParts = parsed.totalParts;
  // Drop stray entries from earlier versions (e.g. the "View report" link counted as an extra part).
  for (const [n, p] of Object.entries(job.parts)) {
    if (Number(n) > job.totalParts && !ACTIVE.has(p.status) && p.status !== 'done') delete job.parts[n];
  }
  if (parsed.expiresAt) job.expiresAt = parsed.expiresAt;
  for (const p of parsed.parts) {
    const cur = job.parts[p.part];
    if (!cur) job.parts[p.part] = newPart(p);
    else {
      // Fresh links carry a fresh re-auth token; keep them for parts that still need downloading.
      if (cur.status !== 'done') cur.url = p.url;
      if (p.sizeBytes) cur.sizeBytes = p.sizeBytes;
    }
  }
  await adoptHistory(job);
  // Google shows "this file can be downloaded at most 5 times" instead of starting the download.
  // Retrying cannot help, so stop that part with a clear message.
  if (isDownloadLimitText(scan.pageText)) {
    for (const p of Object.values(job.parts)) {
      if (p.status !== 'starting' || p.downloadId) continue;
      p.status = 'failed';
      p.error = M('e_limit', { n: p.part });
      notify(`limit-${job.jobId}-${p.part}`, 'nt_limitTitle', 'e_limit', { n: p.part });
    }
  }
  if (job.status === 'needs_auth') {
    job.status = 'running';
    job.notice = M('n_reauthDetected');
    job.resumedAt = Date.now();
    markVerified(job);
  } else if (job.status === 'running' && raptBefore && parsed.rapt && parsed.rapt !== raptBefore) {
    // The user verified again on their own (the page now carries a new token).
    markVerified(job);
  }
  return job;
}

// Mark parts already downloaded by this browser (by link or in-page clicks) so nothing is fetched twice.
async function adoptHistory(job) {
  let items = [];
  try {
    items = await chrome.downloads.search({ limit: 0 });
  } catch {
    items = [];
  }
  for (const item of items) {
    // Page clicks record the manage page as url and the usercontent host as finalUrl; both carry the job id.
    if (![item.url, item.finalUrl].some((u) => String(u || '').includes(job.jobId))) continue;
    const info = parsePartLink(item.url) || parsePartLink(item.finalUrl || '');
    const byName = partFromFilename(item.filename);
    const n = info?.part || byName?.part;
    if (!n) continue;
    const p = job.parts[n] || (job.parts[n] = newPart({ part: n, url: info?.url || '' }));
    if (p.status === 'done') continue;
    // Chrome's history proves the part finished even if the user later moved the file elsewhere
    // (exists === false); the verify script is the final check.
    if (item.state === 'complete' && isPartFile(item) && sizeLooksRight(item.fileSize || item.totalBytes, p.sizeBytes)) {
      markDone(job, p, item, false);
    } else if (item.state === 'in_progress' && !ACTIVE.has(p.status)) {
      p.status = 'downloading';
      p.downloadId = item.id;
      p.bytes = item.bytesReceived;
      p.lastProgressAt = Date.now();
      state.dl[item.id] = { jobId: job.jobId, part: n };
    }
  }
}

function markDone(job, p, item, countSession = true) {
  p.status = 'done';
  p.filename = item.filename;
  p.fileSize = item.fileSize || item.bytesReceived || item.totalBytes || 0;
  p.bytes = p.fileSize;
  p.finishedAt = Date.now();
  p.error = '';
  p.downloadId = item.id;
  const name = partFromFilename(item.filename);
  if (name) job.prefix = name.prefix;
  if (countSession) job.sessionBytes = (job.sessionBytes || 0) + p.fileSize;
}

const START_TIMEOUT_MS = 60_000;
const LEFT_PAGE_MS = 4_000;

// Google only serves archives to requests made by its own Takeout page; a download started by the
// extension (chrome.downloads.download) is bounced to ServiceLogin even with a valid session.
// So every part is started by clicking its download button inside an open Takeout tab.
async function takeoutTabs(job) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: 'https://takeout.google.com/*' });
  } catch {
    tabs = [];
  }
  const mine = tabs.filter((x) => String(x.url || '').includes(job.jobId));
  return mine.length ? mine : tabs.filter((x) => /\/manage\b/.test(String(x.url || '')));
}

async function clickOnPage(job, p) {
  const tabs = await takeoutTabs(job);
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'clickPart', jobId: job.jobId, part: p.part, url: p.url });
      if (res?.ok) {
        p.tabId = tab.id;
        return 'ok';
      }
    } catch {
      // No content script in this tab (opened before the extension was reloaded): reload it once.
      if (!job.reloadedTabAt || Date.now() - job.reloadedTabAt > 60_000) {
        job.reloadedTabAt = Date.now();
        chrome.tabs.reload(tab.id).catch(() => {});
      }
      return 'reloading';
    }
  }
  return tabs.length ? 'notfound' : 'nopage';
}

async function startPart(job, p) {
  p.status = 'starting';
  p.rush = false;
  p.attempts = (p.attempts || 0) + 1;
  p.error = '';
  p.downloadId = null;
  p.lastProgressAt = Date.now();
  await save();
  const r = await clickOnPage(job, p);
  if (r === 'ok') return true;
  // Not started: put it back without spending an attempt.
  p.status = 'pending';
  p.attempts = Math.max(0, p.attempts - 1);
  if (r === 'nopage' && (!job.openedPageAt || Date.now() - job.openedPageAt > 120_000)) {
    job.openedPageAt = Date.now();
    await chrome.tabs.create({ url: job.pageUrl, active: false }).catch(() => {});
  }
  job.notice = M(r === 'nopage' ? 'n_needPage' : 'n_pageLoading');
  return false;
}

function scheduleRetry(job, p, error, resumeId = null) {
  p.error = error;
  if ((p.attempts || 0) >= state.settings.maxAttempts) {
    p.status = 'failed';
    return;
  }
  p.status = 'retrying';
  p.retryAt = Date.now() + backoffMs(p.attempts || 1);
  p.resumeId = resumeId;
}

function requireAuth(job, reason) {
  if (job.status === 'needs_auth' || job.status === 'paused') return;
  for (const p of Object.values(job.parts)) {
    if (p.status === 'starting' || p.status === 'retrying') p.status = 'pending';
  }
  // Google rejected us again right after a fresh verification: stop instead of looping forever.
  if (job.resumedAt && Date.now() - job.resumedAt < AUTH_LOOP_MS) {
    job.status = 'paused';
    job.notice = M('n_authLoop');
    job.resumedAt = 0;
    notify(`auth-${job.jobId}`, 'nt_fatalTitle', 'n_authLoop');
    return;
  }
  job.status = 'needs_auth';
  job.notice = reason;
  job.authNeededAt = Date.now();
  job.authAt = 0;
  // Stays on screen until clicked/cleared, so it is not missed while the user is away.
  notify(`auth-${job.jobId}`, 'nt_authTitle', 'nt_authBody', {}, { requireInteraction: true, priority: 2 });
  void chime();
  void focusTakeoutTab(job, true);
}

// Reuse an open Takeout tab instead of opening a new one on every auth request.
async function focusTakeoutTab(job, allowCreate = false) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://takeout.google.com/*' });
    const tab = tabs.find((x) => String(x.url || '').includes(job.jobId)) || tabs[0];
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      if (chrome.windows?.update) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch {
    /* fall through */
  }
  await chrome.tabs.create({ url: job.pageUrl, active: true }).catch(() => {});
}

async function tick() {
  const { settings } = state;
  const now = Date.now();
  let anyRunning = false;
  const activeIds = Object.keys(state.dl).map(Number);
  const items = activeIds.length ? await chrome.downloads.search({ state: 'in_progress' }) : [];
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const job of Object.values(state.jobs)) {
    if (job.expiresAt && now > job.expiresAt && job.status === 'running') {
      job.status = 'paused';
      job.notice = M('n_expired');
    }
    for (const p of Object.values(job.parts)) {
      if (p.status === 'starting' && !p.downloadId) {
        const waited = now - (p.lastProgressAt || now);
        // The Takeout tab navigated away from Takeout (Google's sign-in page) instead of downloading.
        if (waited > LEFT_PAGE_MS && job.status === 'running') {
          const tabs = await takeoutTabs(job);
          if (!tabs.some((x) => x.id === p.tabId)) {
            p.status = 'pending';
            p.attempts = Math.max(0, (p.attempts || 1) - 1);
            requireAuth(job, M('n_auth'));
            continue;
          }
        }
        if (waited > START_TIMEOUT_MS) scheduleRetry(job, p, M('e_noStart'));
        continue;
      }
      if (!ACTIVE.has(p.status) || !p.downloadId) continue;
      const item = byId.get(p.downloadId);
      if (!item) continue;
      if (item.bytesReceived !== p.bytes) {
        p.bytes = item.bytesReceived;
        p.lastProgressAt = now;
      } else if (!item.paused && now - (p.lastProgressAt || now) > STALL_MS) {
        // Stalled transfer: cancel and requeue rather than wait forever.
        await chrome.downloads.cancel(item.id).catch(() => {});
        delete state.dl[item.id];
        scheduleRetry(job, p, M('e_stalled'));
      }
    }
    if (job.status !== 'running') continue;
    anyRunning = true;

    const s = summarize(job);
    if (s.done === job.totalParts && s.total >= job.totalParts) {
      job.status = 'done';
      job.finishedAt = now;
      notify(`done-${job.jobId}`, 'nt_doneTitle', 'nt_doneBody', { n: s.done, size: formatBytes(s.doneBytes) });
      continue;
    }
    if (!inWindow(settings)) {
      job.notice = M('n_window', { a: settings.windowStart, b: settings.windowEnd });
      continue;
    }
    // Resume interrupted-but-resumable downloads first.
    for (const p of Object.values(job.parts)) {
      if (p.status === 'retrying' && p.resumeId && (p.retryAt || 0) <= now) {
        try {
          await chrome.downloads.resume(p.resumeId);
          p.status = 'downloading';
          p.downloadId = p.resumeId;
          state.dl[p.resumeId] = { jobId: job.jobId, part: p.part };
          p.lastProgressAt = now;
        } catch {
          /* fall through to a fresh download */
        }
        p.resumeId = null;
      }
    }
    // Start parts one at a time: a new click is only made after the previous one became a download.
    const waiting = Object.values(job.parts).some((p) => p.status === 'starting' && !p.downloadId);
    const limit = effectiveConcurrency(job, settings, now);
    const next = waiting ? [] : planNext(job, { ...settings, concurrency: limit }, now).slice(0, 1);
    if (!next.length && !s.active && settings.dataBudgetGB && s.pending) {
      job.status = 'paused';
      job.notice = M('n_budget', { gb: settings.dataBudgetGB });
      notify(`budget-${job.jobId}`, 'nt_budgetTitle', 'nt_budgetBody', { size: formatBytes(job.sessionBytes) });
      continue;
    }
    if (!next.length && !s.active && !s.pending && s.failed) {
      job.status = 'paused';
      job.notice = M('n_failed', { n: s.failed });
      continue;
    }
    job.notice = '';
    for (const n of next) await startPart(job, job.parts[n]);
  }

  void anyRunning;
  await save();
  await updateChrome(Object.values(state.jobs).some((j) => j.status === 'running' || j.status === 'needs_auth'));
}

async function updateChrome(running) {
  if (chrome.power) {
    // 'system' only stops idle sleep; the display still turns off and macOS/Windows lock the screen.
    // 'display' keeps the screen on too, which also prevents the automatic lock.
    if (running && state.settings.keepAwake) chrome.power.requestKeepAwake(state.settings.keepScreenOn ? 'display' : 'system');
    else chrome.power.releaseKeepAwake();
  }
  const jobs = Object.values(state.jobs);
  const auth = jobs.some((j) => j.status === 'needs_auth');
  const active = jobs.filter((j) => j.status === 'running');
  let text = '';
  if (auth) text = '!';
  else if (active.length) {
    const s = summarize(active[0]);
    text = `${Math.floor((s.done / Math.max(1, active[0].totalParts)) * 100)}%`;
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: auth ? '#c2410c' : '#0f766e' });
  if (running) chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
  else chrome.alarms.clear(TICK_ALARM);
}

// ---------- downloads events ----------

const ignoredDownloads = new Set();
const pendingAuxNames = new Map(); // data: URL -> desired relative filename

// Must call suggest() synchronously-ish and never wait on the queue lock: chrome.downloads.download()
// may not resolve until filename determination finishes, which would deadlock.
function routeFilename(item, suggest) {
  const st = state;
  const auxName = pendingAuxNames.get(item.url);
  if (auxName) {
    pendingAuxNames.delete(item.url);
    suggest({ filename: auxName, conflictAction: 'overwrite' });
    return undefined;
  }
  if (!st || st.aux[item.id]) return suggest();
  const hit = jobForItem(item);
  if (!hit?.job) return suggest();
  // Only a web page means "sign in again". Parts are not always zips: a part holding one huge file
  // (e.g. a movie) is served as that file itself, and must not be cancelled - every cancelled try
  // uses up one of Google's 5 downloads for that part.
  if (isAuthResponse(item)) {
    suggest();
    // Google answered with a sign-in / re-verification page instead of the archive.
    ignoredDownloads.add(item.id);
    chrome.downloads.cancel(item.id).catch(() => {});
    chrome.downloads.erase({ id: item.id }).catch(() => {});
    locked(async () => {
      const job = state.jobs[hit.job.jobId];
      if (!job) return;
      delete state.dl[item.id];
      const p = job.parts[hit.info.part];
      if (p && p.status !== 'done') {
        p.status = 'pending';
        p.attempts = Math.max(0, (p.attempts || 1) - 1);
        p.downloadId = null;
      }
      // Keep a token-free trace of where Google sent us, for troubleshooting.
      const strip = (u) => String(u || '').replace(/([?&](?:rapt|user|j)=)[^&]*/g, '$1…');
      job.lastHtml = { at: Date.now(), part: hit.info.part, url: strip(item.url), finalUrl: strip(item.finalUrl), mime: item.mime || '' };
      requireAuth(job, M('n_auth'));
      await save();
      await updateChrome(true);
    });
    return undefined;
  }
  const folder = st.settings.subfolder.replace(/^[/\\]+|[/\\]+$/g, '').replace(/\.\./g, '');
  suggest({ filename: folder ? `${folder}/${baseName(item.filename)}` : baseName(item.filename), conflictAction: 'overwrite' });
  return undefined;
}

function bindStarting(item) {
  // Page clicks may surface as a download of the archive page URL; tie it to the part we just clicked.
  for (const job of Object.values(state.jobs)) {
    if (![item.url, item.finalUrl, item.referrer].some((u) => String(u || '').includes(job.jobId))) continue;
    const p = Object.values(job.parts).find((x) => x.status === 'starting' && !x.downloadId);
    if (p) return { job, info: { part: p.part } };
  }
  return null;
}

async function onCreated(item) {
  await load();
  if (ignoredDownloads.has(item.id) || state.dl[item.id] || state.aux[item.id]) return;
  const hit = jobForItem(item) || bindStarting(item);
  if (!hit?.job) return;
  // A part link clicked on the page: track it instead of downloading it again.
  const p = hit.job.parts[hit.info.part] || (hit.job.parts[hit.info.part] = newPart({ part: hit.info.part, url: item.url }));
  const wasStarting = p.status === 'starting';
  state.dl[item.id] = { jobId: hit.job.jobId, part: p.part };
  p.status = 'downloading';
  p.downloadId = item.id;
  p.lastProgressAt = Date.now();
  await save();
  // The previous click turned into a download: start the next part right away.
  if (wasStarting && hit.job.status === 'running') await tick();
}

async function onChanged(delta) {
  await load();
  if (ignoredDownloads.has(delta.id)) {
    if (delta.state?.current === 'interrupted' || delta.state?.current === 'complete') ignoredDownloads.delete(delta.id);
    delete state.dl[delta.id];
    return;
  }
  if (state.aux[delta.id]) {
    if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
      delete state.aux[delta.id];
      await save();
    }
    return;
  }
  let ref = state.dl[delta.id];
  if (!ref && (delta.finalUrl || delta.filename || delta.state)) {
    // Page-clicked parts only reveal their job once redirected to the usercontent host.
    const [item] = await chrome.downloads.search({ id: delta.id });
    const hit = item && (jobForItem(item) || bindStarting(item));
    const n = hit?.job && (hit.info.part || partFromFilename(item.filename)?.part);
    const p = n && (hit.job.parts[n] || (hit.job.parts[n] = newPart({ part: n, url: '' })));
    if (!p || p.status === 'done') return;
    ref = state.dl[delta.id] = { jobId: hit.job.jobId, part: n };
    p.status = 'downloading';
    p.downloadId = delta.id;
    p.lastProgressAt = Date.now();
  }
  if (!ref) return;
  const job = state.jobs[ref.jobId];
  const p = job?.parts[ref.part];
  if (!p) return;
  if (delta.filename?.current) p.filename = delta.filename.current;
  if (delta.state?.current === 'complete') {
    const [item] = await chrome.downloads.search({ id: delta.id });
    delete state.dl[delta.id];
    if (item && isPartFile(item) && sizeLooksRight(item.fileSize || item.bytesReceived, p.sizeBytes)) {
      markDone(job, p, item);
    } else {
      scheduleRetry(job, p, M('e_size', { got: formatBytes(item?.fileSize || 0), want: formatBytes(p.sizeBytes) }));
    }
    await tick();
  } else if (delta.state?.current === 'interrupted') {
    const [item] = await chrome.downloads.search({ id: delta.id });
    delete state.dl[delta.id];
    const reason = item?.error || delta.error?.current || '';
    const kind = classifyInterrupt(reason);
    if (kind === 'user') {
      p.status = 'failed';
      p.error = M('e_userCancel');
    } else if (kind === 'auth') {
      p.status = 'pending';
      requireAuth(job, M('n_authRejected', { r: reason }));
    } else if (kind === 'fatal') {
      p.status = 'failed';
      p.error = reason === 'FILE_NO_SPACE' ? M('e_noSpace') : M('e_write', { r: reason });
      job.status = 'paused';
      job.notice = p.error;
      notify(`fatal-${job.jobId}`, 'nt_fatalTitle', p.error.k, p.error.p);
    } else {
      scheduleRetry(job, p, M('e_interrupted', { r: reason || t(lang(), 'e_unknown') }), item?.canResume ? item.id : null);
      if (item?.canResume) state.dl[item.id] = ref;
    }
    await tick();
  } else {
    await save();
  }
}

// ---------- messaging ----------

async function snapshot() {
  const active = await chrome.downloads.search({ state: 'in_progress' });
  const now = Date.now();
  for (const item of active) {
    const prev = live.get(item.id);
    if (prev && now > prev.at) {
      const inst = ((item.bytesReceived - prev.bytes) * 1000) / (now - prev.at);
      prev.speed = prev.speed ? prev.speed * 0.7 + inst * 0.3 : inst;
      prev.bytes = item.bytesReceived;
      prev.at = now;
    } else live.set(item.id, { bytes: item.bytesReceived, at: now, speed: 0 });
  }
  const jobs = Object.values(state.jobs)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((job) => {
      let speed = 0;
      const parts = Object.values(job.parts).map((p) => {
        const item = p.downloadId && ACTIVE.has(p.status) ? active.find((i) => i.id === p.downloadId) : null;
        if (item) {
          p.bytes = item.bytesReceived;
          speed += live.get(item.id)?.speed || 0;
        }
        return { ...p, paused: Boolean(item?.paused), totalBytesLive: item?.totalBytes || 0 };
      });
      const nextAuthAt = job.status === 'running' && job.authAt ? job.authAt + AUTH_TTL_MS : 0;
      const bursting = job.status === 'running' && effectiveConcurrency(job, state.settings, now) > (state.settings.concurrency || 3);
      return { ...job, parts, speed, summary: summarize(job), nextAuthAt, bursting };
    });
  return { settings: state.settings, jobs };
}

function parseRanges(text) {
  const out = new Set();
  for (const chunk of String(text || '').split(/[,，\s]+/)) {
    const m = chunk.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] || m[1]);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) out.add(i);
  }
  return [...out];
}

async function downloadText(name, text, mime) {
  const folder = state.settings.subfolder.replace(/^[/\\]+|[/\\]+$/g, '');
  const url = `data:${mime};charset=utf-8;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  const filename = folder ? `${folder}/${name}` : name;
  pendingAuxNames.set(url, filename);
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
  state.aux[id] = true;
  await save();
  return id;
}

const handlers = {
  async scan(msg) {
    const job = await upsertFromScan(msg);
    await save();
    if (job?.status === 'running') await tick();
    return job ? { jobId: job.jobId, summary: summarize(job), status: job.status } : null;
  },
  async getState() {
    return snapshot();
  },
  async start({ jobId }) {
    const job = state.jobs[jobId];
    if (!job) return null;
    if (job.status !== 'running') job.sessionBytes = 0;
    job.status = 'running';
    job.notice = '';
    job.resumedAt = 0;
    // Starting usually follows opening/verifying the page, so treat it as a fresh verification.
    markVerified(job);
    for (const p of Object.values(job.parts)) {
      if (p.downloadId && ACTIVE.has(p.status)) await chrome.downloads.resume(p.downloadId).catch(() => {});
    }
    await tick();
    return true;
  },
  async pause({ jobId }) {
    const job = state.jobs[jobId];
    if (!job) return null;
    job.status = 'paused';
    job.notice = M('n_paused');
    for (const p of Object.values(job.parts)) {
      if (p.downloadId && ACTIVE.has(p.status)) await chrome.downloads.pause(p.downloadId).catch(() => {});
    }
    await save();
    await updateChrome(Object.values(state.jobs).some((j) => j.status === 'running'));
    return true;
  },
  async retryFailed({ jobId }) {
    const job = state.jobs[jobId];
    if (!job) return null;
    for (const p of Object.values(job.parts)) {
      // Parts that hit Google's download limit would only fail again (and nothing is left to spend).
      if (p.error?.k === 'e_limit') continue;
      if (p.status === 'failed' || p.status === 'retrying') {
        p.status = 'pending';
        p.attempts = 0;
        p.error = '';
        p.resumeId = null;
      }
    }
    if (job.status !== 'running') job.status = 'running';
    await tick();
    return true;
  },
  async markDone({ jobId, ranges }) {
    const job = state.jobs[jobId];
    if (!job) return null;
    for (const n of parseRanges(ranges)) {
      const p = job.parts[n];
      if (p && !ACTIVE.has(p.status)) {
        p.status = 'done';
        p.error = M('e_markedHave');
        p.fileSize = p.fileSize || p.sizeBytes;
      }
    }
    await save();
    return true;
  },
  async redownload({ jobId, ranges }) {
    const job = state.jobs[jobId];
    if (!job) return null;
    for (const n of parseRanges(ranges)) {
      const p = job.parts[n];
      if (p && !ACTIVE.has(p.status)) Object.assign(p, { status: 'pending', attempts: 0, error: '' });
    }
    await save();
    return true;
  },
  // Restart one part from the popup grid: drop whatever Chrome has for it and download it again next.
  async restartPart({ jobId, part }) {
    const job = state.jobs[jobId];
    const p = job?.parts[part];
    if (!p) return null;
    if (p.downloadId && ACTIVE.has(p.status)) {
      ignoredDownloads.add(p.downloadId);
      delete state.dl[p.downloadId];
      await chrome.downloads.cancel(p.downloadId).catch(() => {});
    }
    if (p.resumeId) {
      ignoredDownloads.add(p.resumeId);
      delete state.dl[p.resumeId];
      await chrome.downloads.cancel(p.resumeId).catch(() => {});
    }
    Object.assign(p, {
      status: 'pending',
      attempts: 0,
      error: '',
      bytes: 0,
      downloadId: null,
      resumeId: null,
      retryAt: 0,
      rush: true,
    });
    if (job.status === 'done' || job.status === 'paused') {
      job.status = 'running';
      job.notice = '';
    }
    await tick();
    return true;
  },
  async removeJob({ jobId }) {
    const job = state.jobs[jobId];
    if (!job) return null;
    for (const p of Object.values(job.parts)) {
      if (p.downloadId && ACTIVE.has(p.status)) await chrome.downloads.cancel(p.downloadId).catch(() => {});
    }
    for (const [id, ref] of Object.entries(state.dl)) if (ref.jobId === jobId) delete state.dl[id];
    delete state.jobs[jobId];
    await save();
    await updateChrome(Object.values(state.jobs).some((j) => j.status === 'running'));
    return true;
  },
  async settings({ settings }) {
    state.settings = { ...state.settings, ...settings };
    state.settings.concurrency = Math.min(8, Math.max(1, Number(state.settings.concurrency) || 3));
    state.settings.dataBudgetGB = Math.max(0, Number(state.settings.dataBudgetGB) || 0);
    state.settings.burstSize = Math.min(8, Math.max(0, Number(state.settings.burstSize) || 0));
    if (!['auto', 'zh', 'en'].includes(state.settings.language)) state.settings.language = 'auto';
    await save();
    await tick();
    return state.settings;
  },
  async exportVerify({ jobId }) {
    const job = state.jobs[jobId];
    return job ? downloadText('verify-takeout.sh', buildVerifyScript(job), 'text/x-shellscript') : null;
  },
  async exportManifest({ jobId }) {
    const job = state.jobs[jobId];
    return job ? downloadText(`takeout-${jobId.slice(0, 8)}-manifest.csv`, '\ufeff' + buildManifestCsv(job, lang()), 'text/csv') : null;
  },
  async showFolder({ jobId }) {
    const job = state.jobs[jobId];
    const p = job && Object.values(job.parts).find((x) => x.status === 'done' && x.downloadId);
    if (p) chrome.downloads.show(p.downloadId);
    else chrome.downloads.showDefaultFolder();
    return true;
  },
  // Chrome can only reveal a downloaded file or open its default download folder, so reveal the newest
  // file still present in our subfolder (which opens that folder) and fall back to the default folder.
  async openDownloadDir() {
    const folder = state.settings.subfolder.replace(/^[/\\]+|[/\\]+$/g, '');
    let items = [];
    try {
      items = await chrome.downloads.search({ exists: true, state: 'complete', orderBy: ['-endTime'], limit: 200 });
    } catch {
      items = [];
    }
    const inFolder = (f) => folder && String(f || '').split(/[\\/]/).slice(-2, -1)[0] === folder.split(/[\\/]/).pop();
    const hit = items.find((i) => inFolder(i.filename)) || items.find((i) => isArchiveName(i.filename));
    if (hit) chrome.downloads.show(hit.id);
    else chrome.downloads.showDefaultFolder();
    return Boolean(hit);
  },
  async openPopup() {
    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html?tab=1') });
    }
    return true;
  },
  async openPage({ jobId }) {
    const job = state.jobs[jobId];
    if (job) await chrome.tabs.create({ url: job.pageUrl });
    return true;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  locked(async () => {
    await load();
    return fn(msg);
  })
    .then((r) => sendResponse({ ok: true, data: r }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

chrome.downloads.onDeterminingFilename.addListener(routeFilename);
locked(load);
chrome.downloads.onCreated.addListener((item) => locked(() => onCreated(item)));
chrome.downloads.onChanged.addListener((delta) => locked(() => onChanged(delta)));
chrome.notifications?.onClicked?.addListener((id) => {
  if (!id.startsWith('auth-')) return;
  locked(async () => {
    await load();
    const job = state.jobs[id.slice(5)];
    if (job) await focusTakeoutTab(job, true);
  });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === TICK_ALARM) locked(async () => {
    await load();
    await tick();
  });
});
chrome.runtime.onStartup?.addListener(() => locked(async () => {
  await load();
  await tick();
}));
chrome.runtime.onInstalled?.addListener(() => locked(async () => {
  await load();
  await save();
}));

export const __test = { handlers, tick, load, getState: () => state, locked, reset: () => { state = null; } };
