import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MESSAGES, resolveLang, t, tm } from '../extension/src/i18n.js';

test('zh and en catalogs have identical keys', () => {
  const zh = Object.keys(MESSAGES.zh).sort();
  const en = Object.keys(MESSAGES.en).sort();
  assert.deepEqual(zh.filter((k) => !en.includes(k)), []);
  assert.deepEqual(en.filter((k) => !zh.includes(k)), []);
});

test('placeholders match between languages', () => {
  for (const k of Object.keys(MESSAGES.zh)) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(MESSAGES.zh[k]), ph(MESSAGES.en[k]), k);
  }
});

test('every data-i18n key used in the popup exists', () => {
  const html = readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8');
  const js = ['popup/popup.js', 'src/content.js', 'src/background.js']
    .map((f) => readFileSync(new URL(`../extension/${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const keys = new Set([
    ...[...html.matchAll(/data-i18n(?:-\w+)?="(\w+)"/g)].map((m) => m[1]),
    ...[...js.matchAll(/\b(?:T|M)\('(\w+)'/g)].map((m) => m[1]),
    ...[...js.matchAll(/notify\([^,]+,\s*'(\w+)',\s*'(\w+)'/g)].flatMap((m) => [m[1], m[2]]),
  ]);
  for (const k of keys) assert.ok(k in MESSAGES.en, `missing key ${k}`);
  for (const s of ['idle', 'running', 'paused', 'needs_auth', 'done', 'pending', 'starting', 'downloading', 'retrying', 'failed']) {
    assert.ok(`status_${s}` in MESSAGES.en);
  }
});

test('resolveLang and interpolation', () => {
  assert.equal(resolveLang('auto', 'zh-TW'), 'zh');
  assert.equal(resolveLang('auto', 'en-GB'), 'en');
  assert.equal(resolveLang('en', 'zh-CN'), 'en');
  assert.equal(t('en', 'btnStartAll', { n: 166 }), 'Download all 166 parts');
  assert.equal(t('zh', 'btnStartAll', { n: 166 }), '一键下载全部 166 个');
  assert.equal(tm('en', { k: 'n_budget', p: { gb: 10 } }), 'Reached this run’s data cap of 10 GB');
  assert.equal(tm('zh', 'legacy text'), 'legacy text');
});

test('chrome _locales are consistent', () => {
  const dir = new URL('../extension/_locales/', import.meta.url);
  const locales = readdirSync(dir);
  const keys = locales.map((l) => Object.keys(JSON.parse(readFileSync(new URL(`${l}/messages.json`, dir), 'utf8'))).sort().join());
  assert.ok(locales.includes('en') && locales.includes('zh_CN'));
  assert.equal(new Set(keys).size, 1);
});
