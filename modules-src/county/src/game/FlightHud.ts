/**
 * The flight instruments while flying: airspeed (knots), altitude and height
 * above the ground (feet), climb rate (feet per minute), heading, power or
 * collective, rotor or engine speed, flaps, fuel, the assist mode, warnings,
 * and an attitude indicator drawn on a small canvas.
 */
import type { FlightReadout } from '../flight/Flyer';

const KT = 1.944, FT = 3.281;

export class FlightHud {
  private el = document.getElementById('flight')!;
  private att = document.getElementById('attitude') as HTMLCanvasElement;
  private cells = Object.fromEntries(['spd', 'alt', 'agl', 'vs', 'hdg', 'pwr', 'rpm', 'flp', 'fuel', 'mode', 'warn'].map(k => [k, document.getElementById(`f-${k}`)!]));

  show(r: FlightReadout | null) {
    this.el.hidden = !r;
    if (!r) return;
    const c = this.cells, set = (k: string, v: string) => { if (c[k].textContent !== v) c[k].textContent = v; };
    set('spd', `${Math.round(r.airspeed * KT)} kt`);
    set('alt', `${Math.round(r.altitude * FT).toLocaleString()} ft`);
    set('agl', `${Math.round(Math.max(0, r.height) * FT).toLocaleString()} ft above ground`);
    set('vs', `${r.climb >= 0 ? '+' : '−'}${Math.round(Math.abs(r.climb) * 196.85 / 10) * 10} ft/min`);
    set('hdg', `${String(Math.round((r.heading * 180) / Math.PI) % 360).padStart(3, '0')}°`);
    set('pwr', r.kind === 'heli' ? `Collective ${Math.round(r.power * 100)}%` : `Throttle ${Math.round(r.power * 100)}%`);
    set('rpm', r.kind === 'heli' ? `Rotor ${Math.round(r.rpm * 100)}%` : `Engine ${Math.round(r.rpm * 100)}%`);
    set('flp', r.kind === 'plane' ? `Flaps ${['up', '10°', '30°'][Math.round(r.flaps)]}` : '');
    set('fuel', `Fuel ${Math.round(r.fuel)} L`);
    set('mode', r.mode === 'easy' ? 'Easy assist' : 'Pro');
    set('warn', r.warnings.join(' · '));
    this.drawAttitude(r.pitch, r.bank);
  }

  private drawAttitude(pitch: number, bank: number) {
    const g = this.att.getContext('2d');
    if (!g) return;
    const w = this.att.width, h = this.att.height, r = w / 2;
    g.save();
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.clip();
    g.translate(r, r);
    g.rotate(-bank);
    const off = pitch * (180 / Math.PI) * (r / 30);
    g.fillStyle = '#3d8fd6'; g.fillRect(-w, -w * 2 + off, w * 2, w * 2);
    g.fillStyle = '#8a5a32'; g.fillRect(-w, off, w * 2, w * 2);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-w, off); g.lineTo(w, off); g.stroke();
    g.lineWidth = 1;
    for (const d of [-20, -10, 10, 20]) { const y = off - d * (r / 30), l = Math.abs(d) === 10 ? 10 : 16; g.beginPath(); g.moveTo(-l, y); g.lineTo(l, y); g.stroke(); }
    g.restore();
    g.strokeStyle = '#f6c445'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(r - 24, r); g.lineTo(r - 8, r); g.lineTo(r - 4, r + 5); g.moveTo(r + 24, r); g.lineTo(r + 8, r); g.lineTo(r + 4, r + 5); g.stroke();
  }
}
