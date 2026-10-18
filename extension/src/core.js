import { t, tm } from './i18n.js';

// Pure helpers shared by the service worker and tests. No chrome.* access here.

const UNIT = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

export function parseSize(text) {
  const m = String(text || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB|B)(?![A-Za-z])/i);
  return m ? Math.round(parseFloat(m[1]) * UNIT[m[2].toUpperCase()]) : 0;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function formatDuration(seconds, lang = 'zh') {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return t(lang, 'dur_h', { h, m });
  if (m > 0) return t(lang, 'dur_m', { m, s: s % 60 });
  return t(lang, 'dur_s', { s });
}

// Takeout part links: /takeout/download?j=<jobId>&i=<zeroBasedIndex>&user=...&rapt=...
export function parsePartLink(href, base = 'https://takeout.google.com/') {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (!/takeout\.google\.com$/.test(url.hostname) || !/\/takeout\/download$/.test(url.pathname)) return null;
  const jobId = url.searchParams.get('j');
  const raw = url.searchParams.get('i');
  const index = Number(raw);
  if (!jobId || raw === null || raw === '' || !Number.isInteger(index) || index < 0) return null;
  return { jobId, index, part: index + 1, user: url.searchParams.get('user') || '', url: url.toString() };
}

export function jobIdFromPageUrl(pageUrl) {
  try {
    const url = new URL(pageUrl);
    const m = url.pathname.match(/\/manage\/archive\/([0-9a-f-]{16,})/i);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

export function buildPartUrl({ jobId, part, user = '', rapt = '' }) {
  const url = new URL('https://takeout.google.com/takeout/download');
  url.searchParams.set('j', jobId);
  url.searchParams.set('i', String(part - 1));
  if (user) url.searchParams.set('user', user);
  if (rapt) url.searchParams.set('rapt', rapt);
  return url.toString();
}

// Matches takeout-20261018T062654Z-1-001.zip and Chrome duplicates such as "... (1).zip".
export function partFromFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  const m = base.match(/^(takeout-.+?-)(\d{3,})(?: \((\d+)\))?\.(zip|tgz|tar\.gz)$/i);
  if (!m) return null;
  return { prefix: m[1], part: Number(m[2]), duplicate: Boolean(m[3]), ext: m[4].toLowerCase(), name: base };
}

export function isArchiveName(name) {
  return Boolean(partFromFilename(name));
}

export function totalFromLabel(label) {
  const m = String(label || '').match(/共\s*(\d+)\s*(?:个)?部分|of\s+(\d+)/i);
  return m ? Number(m[1] || m[2]) : 0;
}

export function parseExpiry(text, now = Date.now()) {
  const src = String(text || '');
  const zh =
    src.match(/(?:过期|到期|失效|有效期至)[^。\n]{0,24}?(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:(\d{1,2}):(\d{2}))?/) ||
    src.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:(\d{1,2}):(\d{2}))?[^。\n]{0,16}?(?:过期|到期|失效)/);
  if (zh) {
    const t = new Date(+zh[1], +zh[2] - 1, +zh[3], +(zh[4] || 23), +(zh[5] || 59)).getTime();
    if (t > now - 86400000 * 365) return t;
  }
  const en = src.match(/expire[sd]?\s+(?:on\s+)?([A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}(?:,? (?:at )?\d{1,2}:\d{2}\s*[AP]M)?)/);
  if (en) {
    const t = Date.parse(en[1].replace(' at ', ' ').replace(/,/g, ''));
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

// records: [{ href, label, text }] extracted by the content script for each part link/row.
export function buildJobFromScan({ pageUrl, pageText = '', title = '', records = [] }) {
  const parts = new Map();
  let jobId = '';
  let user = '';
  let totalParts = 0;
  for (const r of records) {
    const info = r.href ? parsePartLink(r.href, pageUrl) : null;
    let part = info?.part;
    if (info) {
      if (!jobId) {
        jobId = info.jobId;
        user = info.user;
      }
      if (info.jobId !== jobId) continue;
    } else {
      const m = String(r.text || r.label || '').match(/第\s*(\d+)\s*部分|Part\s+(\d+)/i);
      if (!m) continue;
      part = Number(m[1] || m[2]);
    }
    totalParts = Math.max(totalParts, totalFromLabel(r.label), totalFromLabel(r.text));
    const sizeBytes = parseSize(String(r.text || '').replace(/共\s*\d+\s*部分/, ''));
    const prev = parts.get(part);
    parts.set(part, {
      part,
      url: info?.url || prev?.url || '',
      sizeBytes: sizeBytes || prev?.sizeBytes || 0,
    });
  }
  if (!jobId) jobId = jobIdFromPageUrl(pageUrl);
  if (!jobId) return null;
  if (!user) {
    try {
      user = new URL(pageUrl).searchParams.get('user') || '';
    } catch {
      /* ignore */
    }
  }
  let rapt = '';
  try {
    rapt = new URL(pageUrl).searchParams.get('rapt') || '';
  } catch {
    /* ignore */
  }
  for (const p of parts.values()) {
    if (!p.url) p.url = buildPartUrl({ jobId, part: p.part, user, rapt });
  }
  const list = [...parts.values()].sort((a, b) => a.part - b.part);
  if (!list.length) return null;
  totalParts = Math.max(totalParts, list[list.length - 1].part);
  return {
    jobId,
    user,
    pageUrl,
    title: title || 'Google Takeout',
    totalParts,
    expiresAt: parseExpiry(pageText),
    parts: list,
    totalBytes: list.reduce((s, p) => s + p.sizeBytes, 0),
  };
}

// How Chrome download interruptions should be handled.
export function classifyInterrupt(reason) {
  const r = String(reason || '');
  if (r === 'USER_CANCELED' || r === 'USER_SHUTDOWN') return r === 'USER_SHUTDOWN' ? 'resume' : 'user';
  if (r === 'FILE_NO_SPACE' || r === 'FILE_ACCESS_DENIED' || r === 'FILE_NAME_TOO_LONG' || r === 'FILE_TOO_LARGE') return 'fatal';
  if (r === 'SERVER_UNAUTHORIZED' || r === 'SERVER_FORBIDDEN' || r === 'SERVER_CERT_PROBLEM') return 'auth';
  if (r.startsWith('NETWORK_') || r === 'CRASH' || r === 'SERVER_FAILED' || r === 'SERVER_NO_RANGE' || r === 'FILE_TRANSIENT_ERROR') return 'resume';
  return 'retry';
}

export function backoffMs(attempt) {
  return Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

// Expected size from the page is rounded ("2GB"), so allow a small tolerance.
export function sizeLooksRight(actual, expected) {
  if (!expected || !actual) return true;
  return Math.abs(actual - expected) <= Math.max(expected * 0.03, 20 * 1024 ** 2);
}

export const ACTIVE = new Set(['starting', 'downloading']);

// Choose which parts to start next. Pure so it can be tested.
export function planNext(job, settings, now = Date.now()) {
  if (!job || job.status !== 'running') return [];
  const parts = Object.values(job.parts).sort((a, b) => a.part - b.part);
  const active = parts.filter((p) => ACTIVE.has(p.status));
  let slots = Math.max(0, (settings.concurrency || 3) - active.length);
  if (!slots) return [];
  const budget = (settings.dataBudgetGB || 0) * 1024 ** 3;
  let committed = (job.sessionBytes || 0) + active.reduce((s, p) => s + Math.max(0, (p.sizeBytes || 0) - (p.bytes || 0)), 0);
  const out = [];
  for (const p of parts) {
    if (!slots) break;
    const eligible = p.status === 'pending' || (p.status === 'retrying' && (p.retryAt || 0) <= now);
    if (!eligible) continue;
    if (budget && committed + (p.sizeBytes || 0) > budget) break;
    committed += p.sizeBytes || 0;
    out.push(p.part);
    slots -= 1;
  }
  return out;
}

export function summarize(job) {
  const parts = Object.values(job?.parts || {});
  const count = (s) => parts.filter((p) => p.status === s).length;
  const doneBytes = parts.reduce((s, p) => s + (p.status === 'done' ? p.fileSize || p.sizeBytes : p.bytes || 0), 0);
  return {
    total: parts.length,
    done: count('done'),
    active: parts.filter((p) => ACTIVE.has(p.status)).length,
    failed: count('failed'),
    pending: count('pending') + count('retrying'),
    totalBytes: parts.reduce((s, p) => s + (p.sizeBytes || p.fileSize || 0), 0),
    sizesKnown: parts.every((p) => p.sizeBytes || p.fileSize),
    doneBytes,
  };
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// A self-contained bash script that checks every part exists and passes `unzip -t`.
// Absolute paths recorded by Chrome are used first; otherwise the script looks next to itself.
export function buildVerifyScript(job) {
  const parts = Object.values(job.parts).sort((a, b) => a.part - b.part);
  const prefix = parts.map((p) => partFromFilename(p.filename)).find(Boolean)?.prefix || 'takeout-';
  const entries = parts.map((p) => `  [${p.part}]=${shQuote(p.filename || '')}`);
  return `#!/bin/bash
# Takeout Batch Downloader - verify script for job ${job.jobId}
# Run: bash verify-takeout.sh
cd "$(dirname "$0")" || exit 1
TOTAL=${job.totalParts}
PREFIX=${shQuote(prefix)}
declare -a KNOWN=(
${entries.join('\n')}
)
ok=0; bad=0; missing=0
report="verify-report-$(date +%Y%m%d-%H%M%S).txt"
: > "$report"
for n in $(seq 1 "$TOTAL"); do
  f="\${KNOWN[$n]}"
  if [ -z "$f" ] || [ ! -f "$f" ]; then
    num=$(printf '%03d' "$n")
    f=$(ls -1 "\${PREFIX}\${num}.zip" takeout-*-"\${num}".zip 2>/dev/null | head -1)
  fi
  if [ -z "$f" ] || [ ! -f "$f" ]; then
    echo "MISSING part $n" | tee -a "$report"; missing=$((missing+1)); continue
  fi
  if unzip -tq "$f" >/dev/null 2>&1; then
    echo "OK      part $n  $f" | tee -a "$report"; ok=$((ok+1))
  else
    echo "BAD     part $n  $f" | tee -a "$report"; bad=$((bad+1))
  fi
done
echo "----" | tee -a "$report"
echo "total=$TOTAL ok=$ok bad=$bad missing=$missing" | tee -a "$report"
if [ "$ok" -eq "$TOTAL" ]; then echo "ALL GOOD" | tee -a "$report"; else exit 2; fi
`;
}

export function buildManifestCsv(job, lang = 'en') {
  const rows = [['part', 'status', 'filename', 'expected_bytes', 'file_bytes', 'attempts', 'finished_at', 'error']];
  for (const p of Object.values(job.parts).sort((a, b) => a.part - b.part)) {
    rows.push([
      p.part,
      p.status,
      p.filename || '',
      p.sizeBytes || '',
      p.fileSize || '',
      p.attempts || 0,
      p.finishedAt ? new Date(p.finishedAt).toISOString() : '',
      tm(lang, p.error),
    ]);
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
