(function () {
  var sent = {};
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
  function submit(module, value, options) {
    value = Math.round(Number(value));
    if (!isFinite(value) || value <= 0) return Promise.resolve(false);
    var key = module + ':' + (options && options.key ? options.key : runId());
    if (sent[key]) return Promise.resolve(false);
    sent[key] = true;
    var body = JSON.stringify({ action: 'score', module: module, value: value, run: runId() });
    return fetch('/api/module-scores', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: body })
      .then(function (response) { notify(module, response.ok); return response.ok; })
      .catch(function () { notify(module, false); return false; });
  }
  window.tlScores = { submit: submit };
})();
