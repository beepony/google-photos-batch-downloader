// Runs on takeout.google.com: finds archive part links and shows a one-click download bar.
(() => {
  if (window.__takeoutBatchLoaded) return;
  window.__takeoutBatchLoaded = true;

  const PART_RE = /takeout\/download\?/;
  let jobId = '';
  let lastKey = '';
  let bar = null;
  let i18n = null;
  let lang = 'en';
  const T = (k, p) => (i18n ? i18n.t(lang, k, p) : k);
  const ready = import(chrome.runtime.getURL('src/i18n.js')).then((m) => {
    i18n = m;
    lang = m.resolveLang('auto', navigator.language);
  });

  function collect() {
    const records = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.href;
      if (!PART_RE.test(href)) continue;
      let row = a.parentElement;
      for (let i = 0; row && i < 3 && !/\d\s*(?:GB|MB|KB|TB)/i.test(row.textContent || ''); i += 1) row = row.parentElement;
      records.push({
        href,
        label: a.getAttribute('aria-label') || a.textContent || '',
        text: (row?.textContent || '').slice(0, 300),
      });
    }
    return records;
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res?.ok ? res.data : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function scan() {
    const records = collect();
    if (!records.length) return;
    const key = records.map((r) => r.href).join('|');
    if (key === lastKey && jobId) return refresh();
    lastKey = key;
    const res = await send({
      type: 'scan',
      pageUrl: location.href,
      title: document.title,
      pageText: (document.body?.innerText || '').slice(0, 20000),
      records,
    });
    if (res?.jobId) {
      jobId = res.jobId;
      render();
    }
  }

  function fmt(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < 4) {
      bytes /= 1024;
      i += 1;
    }
    return `${bytes.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
  }

  function ensureBar() {
    if (bar) return bar;
    const host = document.createElement('div');
    host.id = 'takeout-batch-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 320px;
          font: 13px/1.45 "Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif; color: #1f2a24;
          background: linear-gradient(160deg, #fbf6ea 0%, #f1e6cf 100%); border: 1px solid #d9c9a3;
          border-radius: 14px; box-shadow: 0 18px 40px -18px rgba(40, 30, 10, .45); padding: 14px 16px;
          animation: rise .45s cubic-bezier(.2,.9,.3,1.2); }
        @keyframes rise { from { transform: translateY(24px); opacity: 0 } to { transform: none; opacity: 1 } }
        .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .title { font-weight: 700; letter-spacing: .02em; }
        .x { background: none; border: 0; font-size: 16px; cursor: pointer; color: #7a6a48; }
        .meta { color: #6b5d3e; margin: 6px 0 10px; }
        .track { height: 8px; border-radius: 99px; background: #e4d6b4; overflow: hidden; }
        .fill { height: 100%; width: 0; background: repeating-linear-gradient(-45deg, #0f766e 0 8px, #14917f 8px 16px);
          transition: width .6s ease; }
        .row { display: flex; gap: 8px; margin-top: 12px; }
        button.main { flex: 1; border: 0; border-radius: 10px; padding: 9px 12px; cursor: pointer; font: inherit;
          font-weight: 700; background: #0f766e; color: #fff8e8; }
        button.main.pause { background: #8a5a12; }
        button.ghost { border: 1px solid #c8b58a; background: transparent; border-radius: 10px; padding: 9px 10px;
          cursor: pointer; font: inherit; color: #5b4c2c; }
        .notice { margin-top: 8px; color: #b45309; font-weight: 600; }
      </style>
      <div class="bar" role="region">
        <div class="head"><span class="title"></span><button class="x">×</button></div>
        <div class="meta"></div>
        <div class="track"><div class="fill"></div></div>
        <div class="notice" hidden></div>
        <div class="row"><button class="main"></button><button class="ghost open"></button></div>
      </div>`;
    document.documentElement.appendChild(host);
    root.querySelector('.x').onclick = () => {
      host.remove();
      bar = null;
      clearInterval(timer);
    };
    root.querySelector('.main').onclick = async (e) => {
      const running = e.currentTarget.dataset.running === '1';
      await send({ type: running ? 'pause' : 'start', jobId });
      refresh();
    };
    root.querySelector('.open').onclick = () => send({ type: 'openPopup' });
    bar = root;
    return root;
  }

  async function refresh() {
    if (!jobId || !bar) return;
    const st = await send({ type: 'getState' });
    const job = st?.jobs.find((j) => j.jobId === jobId);
    if (!job) return;
    await ready;
    lang = i18n.resolveLang(st.settings.language, navigator.language);
    bar.querySelector('.bar').setAttribute('aria-label', T('appName'));
    bar.querySelector('.title').textContent = T('appName');
    bar.querySelector('.x').title = T('hide');
    bar.querySelector('.open').textContent = T('details');
    const s = job.summary;
    const pct = job.totalParts ? Math.round((s.done / job.totalParts) * 100) : 0;
    bar.querySelector('.meta').textContent =
      `${s.done}/${T('partsCount', { n: job.totalParts })} · ${fmt(s.doneBytes)} / ${fmt(s.totalBytes)}` + (job.speed ? ` · ${fmt(job.speed)}/s` : '');
    bar.querySelector('.fill').style.width = `${job.status === 'done' ? 100 : pct}%`;
    const btn = bar.querySelector('.main');
    const running = job.status === 'running';
    btn.dataset.running = running ? '1' : '0';
    btn.classList.toggle('pause', running);
    btn.textContent =
      job.status === 'done'
        ? T('btnAllDone')
        : running
          ? T('btnPause')
          : s.done
            ? T('btnContinue', { n: job.totalParts - s.done })
            : T('btnStartAll', { n: job.totalParts });
    btn.disabled = job.status === 'done';
    const notice = bar.querySelector('.notice');
    const text = job.status === 'needs_auth' ? T('barAuth') : i18n.tm(lang, job.notice);
    notice.hidden = !text;
    notice.textContent = text;
  }

  function render() {
    ensureBar();
    refresh();
  }

  // The service worker asks us to start a part: click Takeout's own download button so the request
  // carries the page's context (Google refuses archive requests that start outside its page).
  function findPartAnchor(part) {
    const re = new RegExp(`(?:第\\s*${part}\\s*(?:个)?部分|part\\s*${part}(?!\\d))`, 'i');
    for (const a of document.querySelectorAll('a[href]')) {
      if (!PART_RE.test(a.href)) continue;
      const label = a.getAttribute('aria-label') || a.textContent || '';
      if (re.test(label)) return a;
      try {
        const u = new URL(a.href);
        if (Number(u.searchParams.get('i')) === part - 1 && /第\s*\d+|part\s*\d+/i.test(label)) return a;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'clickPart') return false;
    const a = findPartAnchor(msg.part);
    if (!a || (msg.jobId && !a.href.includes(msg.jobId))) {
      sendResponse({ ok: false, reason: 'notfound' });
      return false;
    }
    a.click();
    sendResponse({ ok: true });
    return false;
  });

  const timer = setInterval(() => {
    if (bar) refresh();
  }, 2000);
  const mo = new MutationObserver(() => {
    clearTimeout(mo.t);
    mo.t = setTimeout(scan, 800);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
