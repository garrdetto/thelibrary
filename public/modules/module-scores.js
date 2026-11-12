(function () {
  var STORE = 'tl-score-outbox';
  var CHECKPOINT_MS = 15000;
  var LOCAL_MS = 1000;
  var MAX_AGE = 14 * 86400000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var runs = {};
  var current = {};
  var localAt = 0, localTimer = 0, flushing = false;

  function runId() {
    try { return crypto.randomUUID(); } catch (e) {
      var hex = '0123456789abcdef', out = '';
      for (var i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
      return out.slice(0, 8) + '-' + out.slice(8, 12) + '-4' + out.slice(13, 16) + '-a' + out.slice(17, 20) + '-' + out.slice(20);
    }
  }
  function notify(module, saved) {
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'tl-score-saved', module: module, saved: saved }, window.location.origin); } catch (e) {}
  }
  function readOutbox() {
    try { var data = JSON.parse(localStorage.getItem(STORE) || '{}'); return data && typeof data === 'object' ? data : {}; } catch (e) { return {}; }
  }
  function writeOutbox() {
    localAt = Date.now();
    clearTimeout(localTimer); localTimer = 0;
    try {
      var data = readOutbox(), now = Date.now();
      for (var id in data) if (!data[id] || now - data[id].at > MAX_AGE) delete data[id];
      for (var key in runs) {
        var r = runs[key];
        if (r.value > r.saved) data[r.run] = { module: r.module, value: r.value, detail: r.detail, at: now };
        else delete data[r.run];
      }
      if (Object.keys(data).length) localStorage.setItem(STORE, JSON.stringify(data)); else localStorage.removeItem(STORE);
    } catch (e) {}
  }
  function forget(run) {
    try { var data = readOutbox(); if (data[run]) { delete data[run]; if (Object.keys(data).length) localStorage.setItem(STORE, JSON.stringify(data)); else localStorage.removeItem(STORE); } } catch (e) {}
  }
  function scheduleLocal() {
    if (Date.now() - localAt >= LOCAL_MS) writeOutbox();
    else if (!localTimer) localTimer = setTimeout(writeOutbox, LOCAL_MS);
  }
  function post(module, value, run, detail) {
    var payload = { action: 'score', module: module, value: value, run: run };
    if (typeof detail === 'string' && /^[a-z]{1,16}$/.test(detail)) payload.detail = detail;
    var body = JSON.stringify(payload);
    return fetch('/api/module-scores', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (response) { return { ok: response.ok, retry: response.status >= 500 || response.status === 429 }; })
      .catch(function () { return { ok: false, retry: true }; });
  }
  function send(r) {
    var value = r.value;
    r.sentAt = Date.now();
    return post(r.module, value, r.run, r.detail).then(function (result) {
      if (result.ok || !result.retry) { r.saved = Math.max(r.saved, value); if (r.value <= r.saved) forget(r.run); }
      notify(r.module, result.ok);
      return result.ok;
    });
  }
  function track(module, options) {
    var tag = options && options.key ? String(options.key) : (current[module] || (current[module] = runId()));
    var key = module + ':' + tag;
    var r = runs[key];
    if (!r) {
      r = runs[key] = { module: module, run: UUID.test(tag) ? tag.toLowerCase() : runId(), value: 0, saved: 0, sentAt: 0, timer: 0 };
    }
    if (options && typeof options.detail === 'string') r.detail = options.detail.toLowerCase();
    return { key: key, run: r, keyed: !!(options && options.key) };
  }
  function clean(value) {
    value = Math.round(Number(value));
    return isFinite(value) && value > 0 ? value : 0;
  }
  function progress(module, value, options) {
    value = clean(value);
    if (!value) return;
    var r = track(module, options).run;
    if (value <= r.value) return;
    r.value = value;
    scheduleLocal();
    if (r.timer) return;
    var wait = Math.max(0, CHECKPOINT_MS - (Date.now() - r.sentAt));
    r.timer = setTimeout(function () { r.timer = 0; if (r.value > r.saved) send(r); }, r.sentAt ? wait : CHECKPOINT_MS);
  }
  function submit(module, value, options) {
    value = clean(value);
    var t = track(module, options), r = t.run;
    if (!t.keyed) { delete runs[t.key]; delete current[module]; }
    if (r.timer) { clearTimeout(r.timer); r.timer = 0; }
    if (!value) { forget(r.run); return Promise.resolve(false); }
    r.value = Math.max(r.value, value);
    if (r.value <= r.saved) return Promise.resolve(false);
    if (!t.keyed) runs['done:' + r.run] = r;
    writeOutbox();
    return send(r).then(function (ok) { if (!t.keyed && r.value <= r.saved) delete runs['done:' + r.run]; return ok; });
  }
  function flushLive() {
    writeOutbox();
    for (var key in runs) {
      var r = runs[key];
      if (r.value > r.saved) { if (r.timer) { clearTimeout(r.timer); r.timer = 0; } send(r); }
    }
  }
  function flushOutbox() {
    if (flushing) return;
    var data = readOutbox(), live = {}, jobs = [];
    for (var key in runs) live[runs[key].run] = true;
    for (var run in data) {
      var item = data[run];
      if (live[run] || !item || !UUID.test(run) || Date.now() - item.at > MAX_AGE) continue;
      (function (run, item) {
        jobs.push(post(item.module, clean(item.value), run, item.detail).then(function (result) {
          if (result.ok || !result.retry) forget(run);
          if (result.ok) notify(item.module, true);
        }));
      })(run, item);
    }
    if (!jobs.length) return;
    flushing = true;
    Promise.all(jobs).then(function () { flushing = false; }, function () { flushing = false; });
  }
  window.addEventListener('pagehide', flushLive);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushLive(); });
  window.addEventListener('online', function () { flushLive(); flushOutbox(); });
  setTimeout(flushOutbox, 1500);
  window.tlScores = { submit: submit, progress: progress };
})();
