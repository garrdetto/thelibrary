// The Garage's AI paint designer: the driver describes a paint scheme in words and /api/shorttrack-paint
// (Claude Opus, car paint requests only) returns a scheme the livery painters draw (shared/PaintScheme.ts).
// `opts`: { $, signedIn(), enabled(), apply(scheme) }.
import { SCHEME_LIMITS, sanitizeScheme } from './shared/PaintScheme';

export function initPaintDesigner(opts) {
  const { $ } = opts, input = $('gAiPrompt'), go = $('gAiGo'), note = $('gAiNote');
  let busy = false;
  input.maxLength = SCHEME_LIMITS.prompt;
  const say = (text, bad) => { note.textContent = text; note.classList.toggle('bad', !!bad); };

  function refresh() {
    const ok = opts.signedIn(), on = opts.enabled();
    input.disabled = busy || !ok || !on;
    go.disabled = busy || !ok || !on;
    if (busy) return;
    if (!ok) say('Sign in to use the AI paint designer.');
    else if (!on) say('This car keeps its own paint scheme.');
    else if (!note.textContent || note.dataset.idle === '1') { say('Describe any paint scheme and it paints your car.'); note.dataset.idle = '1'; }
  }

  async function generate() {
    const prompt = input.value.trim();
    if (busy || !prompt || !opts.signedIn() || !opts.enabled()) return;
    busy = true; note.dataset.idle = '0'; refresh(); say('Painting…'); go.textContent = 'Painting…';
    try {
      const r = await fetch('/api/shorttrack-paint', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) say(data.error || 'The paint designer could not finish that. Try again.', true);
      else if (data.refused) say(data.message || 'The paint designer only designs car paint schemes.', true);
      else {
        const scheme = sanitizeScheme(data.scheme);
        if (!scheme) say('That design came back empty. Try describing it another way.', true);
        else { opts.apply(scheme); say(data.message || `Painted: ${scheme.name}.`); }
      }
    } catch { say('The paint designer could not be reached. Check your connection and try again.', true); }
    busy = false; go.textContent = 'Paint it'; refresh();
  }

  go.addEventListener('click', generate);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); generate(); } });
  return { refresh };
}
