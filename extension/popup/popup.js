import { formatBytes, formatDuration } from '../src/core.js';
import { resolveLang, t, tm } from '../src/i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
if (new URLSearchParams(location.search).has('tab')) document.body.classList.add('tab');

function send(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (res) => {
      void chrome.runtime.lastError;
      resolve(res?.ok ? res.data : null);
    });
  });
}

const cards = new Map();
let settingsLoaded = false;
let lang = resolveLang('auto', chrome.i18n?.getUILanguage?.());
let appliedLang = '';
const T = (k, p) => t(lang, k, p);

function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = T(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = T(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = T(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', T(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('.verify-hint')) {
    const [a, b] = T('verifyHint').split('{cmd}');
    el.replaceChildren(a ?? '', Object.assign(document.createElement('code'), { textContent: 'bash verify-takeout.sh' }), b ?? '');
  }
}

function setLang(next) {
  lang = next;
  if (appliedLang === lang) return;
  appliedLang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = T('appName');
  applyStatic(document);
  for (const card of cards.values()) applyStatic(card);
  for (const b of document.querySelectorAll('.lang-switch button')) b.classList.toggle('on', b.dataset.lang === lang);
}

function bindSettings(s) {
  if (settingsLoaded) return;
  settingsLoaded = true;
  $('#s-concurrency').value = String(s.concurrency);
  $('#s-subfolder').value = s.subfolder;
  $('#s-budget').value = s.dataBudgetGB;
  $('#s-window').checked = s.windowEnabled;
  $('#s-wstart').value = s.windowStart;
  $('#s-wend').value = s.windowEnd;
  $('#s-awake').checked = s.keepAwake;
  $('#s-notify').checked = s.notify;
  $('#s-language').value = s.language || 'auto';
  const push = () =>
    send('settings', {
      settings: {
        concurrency: Number($('#s-concurrency').value),
        subfolder: $('#s-subfolder').value.trim(),
        dataBudgetGB: Number($('#s-budget').value),
        windowEnabled: $('#s-window').checked,
        windowStart: $('#s-wstart').value || '00:00',
        windowEnd: $('#s-wend').value || '08:00',
        keepAwake: $('#s-awake').checked,
        notify: $('#s-notify').checked,
        language: $('#s-language').value,
      },
    });
  for (const el of $('#settings').querySelectorAll('input, select')) el.addEventListener('change', push);
}

function makeCard(jobId) {
  const node = $('#job-tpl').content.firstElementChild.cloneNode(true);
  applyStatic(node);
  const act = (sel, type, extra) =>
    $(sel, node).addEventListener('click', async () => {
      await send(type, { jobId, ...(extra ? extra() : {}) });
      refresh();
    });
  $('.act-main', node).addEventListener('click', async (e) => {
    await send(e.currentTarget.dataset.action, { jobId });
    refresh();
  });
  act('.act-retry', 'retryFailed');
  act('.act-verify', 'exportVerify');
  act('.act-manifest', 'exportManifest');
  act('.act-folder', 'showFolder');
  act('.act-page', 'openPage');
  act('.act-mark', 'markDone', () => ({ ranges: $('.range-input', node).value }));
  act('.act-redo', 'redownload', () => ({ ranges: $('.range-input', node).value }));
  $('.act-remove', node).addEventListener('click', async () => {
    if (!confirm(T('removeConfirm'))) return;
    await send('removeJob', { jobId });
    cards.get(jobId)?.remove();
    cards.delete(jobId);
    refresh();
  });
  $('#jobs').appendChild(node);
  cards.set(jobId, node);
  return node;
}

function renderJob(job) {
  const node = cards.get(job.jobId) || makeCard(job.jobId);
  const s = job.summary;
  const pct = job.totalParts ? Math.floor((s.done / job.totalParts) * 100) : 0;
  $('.job-title', node).textContent = T('exportLabel', { id: job.jobId.slice(0, 8) });
  const expires = job.expiresAt ? new Date(job.expiresAt) : null;
  const daysLeft = expires ? Math.ceil((job.expiresAt - Date.now()) / 86400000) : null;
  const size = formatBytes(s.sizesKnown ? s.totalBytes : (s.totalBytes / Math.max(1, s.done)) * job.totalParts);
  $('.job-sub', node).textContent =
    `${T('partsCount', { n: job.totalParts })} · ${s.sizesKnown ? '' : T('approx')}${size}` +
    (expires
      ? ` · ${T('expires', { date: expires.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US') })}` +
        (daysLeft <= 2 ? T('expiresSoon', { d: Math.max(0, daysLeft) }) : '')
      : '');
  const pill = $('.pill', node);
  pill.className = `pill ${job.status}`;
  pill.textContent = T(`status_${job.status}`);
  $('.pct', node).textContent = pct;
  $('.st-parts', node).textContent = `${s.done}/${job.totalParts}` + (s.active ? ` (+${s.active})` : '');
  $('.st-bytes', node).textContent = formatBytes(s.doneBytes);
  $('.st-speed', node).textContent = job.speed ? `${formatBytes(job.speed)}/s` : '--';
  $('.st-eta', node).textContent = job.speed && s.sizesKnown ? formatDuration((s.totalBytes - s.doneBytes) / job.speed, lang) : '--';
  const byBytes = s.sizesKnown ? s.doneBytes / Math.max(1, s.totalBytes) : 0;
  const byParts = s.done / Math.max(1, job.totalParts);
  $('.fill', node).style.width = `${job.status === 'done' ? 100 : Math.min(100, Math.max(byBytes, byParts) * 100)}%`;

  const notice = $('.notice', node);
  const text = job.status === 'needs_auth' ? T('authBanner') : tm(lang, job.notice);
  notice.hidden = !text;
  notice.textContent = text;

  const grid = $('.grid', node);
  const parts = [...job.parts].sort((a, b) => a.part - b.part);
  while (grid.children.length < parts.length) {
    const c = document.createElement('div');
    c.setAttribute('role', 'listitem');
    grid.appendChild(c);
  }
  parts.forEach((p, i) => {
    const c = grid.children[i];
    c.className = `cell ${p.status}`;
    const total = p.totalBytesLive || p.sizeBytes;
    if (p.status === 'downloading') c.style.setProperty('--p', total ? Math.min(1, p.bytes / total).toFixed(3) : '.1');
    c.title =
      `${T('partTitle', { n: p.part })} · ${T(`status_${p.status}`)}` +
      (p.error ? ` · ${tm(lang, p.error)}` : '') +
      (p.filename ? `\n${p.filename}` : '');
  });

  const main = $('.act-main', node);
  const running = job.status === 'running';
  main.dataset.action = running ? 'pause' : 'start';
  main.classList.toggle('pause', running);
  main.disabled = job.status === 'done';
  main.textContent =
    job.status === 'done'
      ? T('btnAllDone')
      : running
        ? T('btnPause')
        : job.status === 'needs_auth'
          ? T('btnAuthContinue')
          : s.done
            ? T('btnContinue', { n: job.totalParts - s.done })
            : T('btnStartAll', { n: job.totalParts });
  $('.act-retry', node).hidden = !s.failed;
}

async function refresh() {
  const st = await send('getState');
  if (!st) return;
  setLang(resolveLang(st.settings.language, chrome.i18n?.getUILanguage?.()));
  bindSettings(st.settings);
  $('#empty').hidden = st.jobs.length > 0;
  for (const job of st.jobs) renderJob(job);
}

$('#gear').addEventListener('click', () => {
  $('#settings').hidden = !$('#settings').hidden;
});
for (const b of document.querySelectorAll('.lang-switch button')) {
  b.addEventListener('click', async () => {
    $('#s-language').value = b.dataset.lang;
    setLang(b.dataset.lang);
    await send('settings', { settings: { language: b.dataset.lang } });
    refresh();
  });
}
setLang(lang);
refresh();
setInterval(refresh, 1500);
