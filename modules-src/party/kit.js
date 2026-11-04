import { avatar } from './characters.js';
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const between = (r, a, b) => a + (b - a) * r();
export const pickOne = (r, list) => list[Math.floor(r() * list.length)];
const dpr = () => Math.min(2, window.devicePixelRatio || 1);
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function makeBag() {
  const fns = [];
  let alive = true;
  return {
    get alive() { return alive; },
    add(fn) { fns.push(fn); },
    timeout(fn, ms) { const id = setTimeout(() => { if (alive) fn(); }, ms); fns.push(() => clearTimeout(id)); },
    listen(target, type, fn, options) { target.addEventListener(type, fn, options); fns.push(() => target.removeEventListener(type, fn, options)); },
    loop(fn) {
      let id = 0;
      const step = (now) => { if (!alive) return; if (fn(now) !== false) id = requestAnimationFrame(step); };
      id = requestAnimationFrame(step);
      fns.push(() => cancelAnimationFrame(id));
    },
    keys(fn) { this.listen(window, 'keydown', (event) => { if (event.ctrlKey || event.metaKey || event.altKey) return; fn(event); }); },
    end() { alive = false; while (fns.length) fns.pop()(); },
  };
}

export function canvas(stage, w, h) {
  const c = document.createElement('canvas');
  const ratio = dpr();
  c.width = w * ratio; c.height = h * ratio;
  c.className = 'c-canvas';
  c.style.aspectRatio = `${w} / ${h}`;
  stage.appendChild(c);
  const g = c.getContext('2d');
  g.scale(ratio, ratio);
  const point = (event) => { const box = c.getBoundingClientRect(); return { x: (event.clientX - box.left) / box.width * w, y: (event.clientY - box.top) / box.height * h }; };
  return { c, g, point };
}

export function timerBar(g, w, left, total) {
  g.fillStyle = css('--line') || '#26324c';
  g.fillRect(0, 0, w, 6);
  g.fillStyle = left / total < 0.25 ? '#ff5a7a' : css('--accent') || '#39d0ff';
  g.fillRect(0, 0, w * Math.max(0, left / total), 6);
}

export function keypad(stage, input, onEnter) {
  const pad = document.createElement('div');
  pad.className = 'c-keypad';
  pad.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '−', '0', '⌫'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('') + (onEnter ? '<button type="button" class="enter" data-k="ok">Enter</button>' : '');
  pad.addEventListener('pointerdown', (event) => {
    const k = event.target.closest('button')?.dataset.k;
    if (!k) return;
    event.preventDefault();
    if (k === '⌫') input.value = input.value.slice(0, -1);
    else if (k === '−') input.value = input.value.startsWith('-') ? input.value.slice(1) : '-' + input.value;
    else if (k === 'ok') { onEnter(); return; }
    else input.value += k;
    input.dispatchEvent(new Event('input'));
  });
  stage.appendChild(pad);
  return pad;
}

const avatarCache = new Map();
export function avatarImage(charId, mood = 'happy') {
  const key = `${charId}:${mood}`;
  if (!avatarCache.has(key)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatar(charId, 128, mood).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
    avatarCache.set(key, img);
  }
  return avatarCache.get(key);
}

let audioCtx = null;
export function blip(freq = 660, ms = 90, type = 'square', gain = 0.035) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator(), amp = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq; amp.gain.value = gain;
    amp.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    osc.connect(amp).connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + ms / 1000);
  } catch { /* audio unavailable */ }
}
