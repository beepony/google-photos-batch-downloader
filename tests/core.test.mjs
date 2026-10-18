import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildJobFromScan,
  buildManifestCsv,
  buildPartUrl,
  buildVerifyScript,
  classifyInterrupt,
  parseExpiry,
  parsePartLink,
  parseSize,
  partFromFilename,
  planNext,
  sizeLooksRight,
  summarize,
} from '../extension/src/core.js';

const JOB = '0d5e7a11-c0de-4b2a-9e61-7a6e0a7c1234';
const PAGE = `https://takeout.google.com/manage/archive/${JOB}?user=110&rapt=TOKEN`;

test('parseSize handles zh/en labels', () => {
  assert.equal(parseSize('第 1 部分 2GB'), 2 * 1024 ** 3);
  assert.equal(parseSize('Part 27 1.98 GB'), Math.round(1.98 * 1024 ** 3));
  assert.equal(parseSize('958.7MB'), Math.round(958.7 * 1024 ** 2));
  assert.equal(parseSize('nothing'), 0);
});

test('parsePartLink reads zero-based index', () => {
  const p = parsePartLink(`https://takeout.google.com/takeout/download?j=${JOB}&i=1&user=110&rapt=X`);
  assert.equal(p.part, 2);
  assert.equal(p.jobId, JOB);
  assert.equal(parsePartLink('https://evil.example/takeout/download?j=x&i=0'), null);
  assert.equal(parsePartLink('https://takeout.google.com/takeout/download?j=x'), null);
});

test('partFromFilename recognises duplicates', () => {
  assert.deepEqual(partFromFilename('/Volumes/S/takeout-20261018T062654Z-1-009 (1).zip').part, 9);
  assert.equal(partFromFilename('/x/takeout-20261018T062654Z-1-009 (1).zip').duplicate, true);
  assert.equal(partFromFilename('未确认 1234.crdownload'), null);
});

test('buildJobFromScan builds parts and fills missing links', () => {
  const records = [
    { href: buildPartUrl({ jobId: JOB, part: 1, user: '110', rapt: 'TOKEN' }), label: '重新下载第 1 部分（共 166 部分）', text: '第 1 部分 2GB 下载开始时间：…' },
    { href: buildPartUrl({ jobId: JOB, part: 2, user: '110', rapt: 'TOKEN' }), label: '下载第 2 部分（共 166 部分）', text: '第 2 部分 2GB' },
    { href: '', label: '重新下载', text: '第 3 部分 1.98GB' },
  ];
  const job = buildJobFromScan({ pageUrl: PAGE, pageText: '这些文件将于 2026年10月25日 14:50 过期', records });
  assert.equal(job.jobId, JOB);
  assert.equal(job.totalParts, 166);
  assert.equal(job.parts.length, 3);
  assert.match(job.parts[2].url, /i=2/);
  assert.match(job.parts[2].url, /rapt=TOKEN/);
  assert.equal(new Date(job.expiresAt).getDate(), 25);
});

test('parseExpiry english', () => {
  const t = parseExpiry('Your files will expire on Oct 25, 2026 2:50 PM');
  assert.equal(new Date(t).getMonth(), 9);
});

function mkJob(n, statuses = {}) {
  const parts = {};
  for (let i = 1; i <= n; i += 1) parts[i] = { part: i, status: statuses[i] || 'pending', sizeBytes: 2 * 1024 ** 3, bytes: 0 };
  return { jobId: JOB, status: 'running', totalParts: n, sessionBytes: 0, parts };
}

test('planNext respects concurrency and skips done/active', () => {
  const job = mkJob(10, { 1: 'done', 2: 'downloading', 3: 'failed' });
  assert.deepEqual(planNext(job, { concurrency: 3 }), [4, 5]);
  job.status = 'paused';
  assert.deepEqual(planNext(job, { concurrency: 3 }), []);
});

test('planNext respects retry delay and data budget', () => {
  const now = 1000;
  const job = mkJob(6, { 1: 'retrying', 2: 'retrying' });
  job.parts[1].retryAt = 500;
  job.parts[2].retryAt = 5000;
  assert.deepEqual(planNext(job, { concurrency: 2 }, now), [1, 3]);
  const budgetJob = mkJob(6);
  assert.deepEqual(planNext(budgetJob, { concurrency: 6, dataBudgetGB: 5 }, now), [1, 2]);
  budgetJob.sessionBytes = 4 * 1024 ** 3;
  assert.deepEqual(planNext(budgetJob, { concurrency: 6, dataBudgetGB: 5 }, now), []);
});

test('classifyInterrupt', () => {
  assert.equal(classifyInterrupt('NETWORK_FAILED'), 'resume');
  assert.equal(classifyInterrupt('SERVER_FORBIDDEN'), 'auth');
  assert.equal(classifyInterrupt('FILE_NO_SPACE'), 'fatal');
  assert.equal(classifyInterrupt('USER_CANCELED'), 'user');
});

test('sizeLooksRight tolerates rounded page sizes', () => {
  assert.ok(sizeLooksRight(2147655178, 2 * 1024 ** 3));
  assert.ok(!sizeLooksRight(1200, 2 * 1024 ** 3));
});

test('summarize and manifest', () => {
  const job = mkJob(3, { 1: 'done' });
  job.parts[1].fileSize = 100;
  job.parts[1].filename = '/d/takeout-X-1-001.zip';
  const s = summarize(job);
  assert.equal(s.done, 1);
  assert.equal(s.pending, 2);
  assert.match(buildManifestCsv(job), /takeout-X-1-001\.zip/);
});

test('verify script finds good, bad and missing parts with macOS bash 3.2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tk-'));
  const src = join(dir, 'a.txt');
  writeFileSync(src, 'hello');
  execFileSync('zip', ['-q', join(dir, 'takeout-20261018T062654Z-1-001.zip'), 'a.txt'], { cwd: dir });
  writeFileSync(join(dir, 'takeout-20261018T062654Z-1-002.zip'), 'not a zip');
  const job = mkJob(3, { 1: 'done', 2: 'done' });
  job.parts[1].filename = join(dir, 'takeout-20261018T062654Z-1-001.zip');
  job.parts[2].filename = '/elsewhere/takeout-20261018T062654Z-1-002.zip';
  job.totalParts = 3;
  writeFileSync(join(dir, 'verify-takeout.sh'), buildVerifyScript(job));
  let out = '';
  try {
    out = execFileSync('/bin/bash', [join(dir, 'verify-takeout.sh')], { encoding: 'utf8' });
  } catch (e) {
    out = e.stdout;
    assert.equal(e.status, 2);
  }
  assert.match(out, /OK +part 1/);
  assert.match(out, /BAD +part 2/);
  assert.match(out, /MISSING part 3/);
  assert.match(out, /total=3 ok=1 bad=1 missing=1/);
  assert.ok(readFileSync(join(dir, 'verify-takeout.sh'), 'utf8').startsWith('#!/bin/bash'));
});
