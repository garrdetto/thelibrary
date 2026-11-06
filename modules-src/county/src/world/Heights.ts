/**
 * Ground height grids for chunks, sampled by a small pool of workers so a
 * town chunk (a few hundred milliseconds of maths) never stalls a frame.
 * Requests are served nearest first; if workers can't start, the grid is
 * computed on the main thread a few rows per frame instead.
 */
import type { Terrain } from '../../shared/Terrain';

interface Job { id: number; x0: number; z0: number; n: number; step: number; priority: number; done: (h: Float32Array) => void }

export class Heights {
  private queue: Job[] = [];
  private idle: Worker[] = [];
  private busy = new Map<number, { w: Worker; job: Job }>();
  private nextId = 1;
  private fallback = false;

  constructor(private terrain: Terrain, workers = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))) {
    try {
      for (let i = 0; i < workers; i++) {
        const w = new Worker(new URL('./heights.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (ev: MessageEvent<{ id: number; h: Float32Array }>) => {
          const b = this.busy.get(ev.data.id);
          if (!b) return;
          this.busy.delete(ev.data.id);
          this.idle.push(w);
          b.job.done(ev.data.h);
          this.pump();
        };
        w.onerror = () => { this.fallback = true; };
        this.idle.push(w);
      }
    } catch {
      this.fallback = true;
    }
  }

  get pending() { return this.queue.length + this.busy.size; }

  /** Heights for an (n + 1)² grid starting at (x0, z0), `step` metres apart, row-major in z. */
  request(x0: number, z0: number, n: number, step: number, priority: number) {
    return new Promise<Float32Array>(done => {
      this.queue.push({ id: this.nextId++, x0, z0, n, step, priority, done });
      this.pump();
    });
  }

  /** Re-rank queued requests (lower runs first). */
  reprioritise(rank: (x0: number, z0: number, step: number) => number) {
    for (const j of this.queue) j.priority = rank(j.x0, j.z0, j.step);
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    while (!this.fallback && this.idle.length && this.queue.length) {
      const job = this.queue.shift()!, w = this.idle.pop()!;
      this.busy.set(job.id, { w, job });
      w.postMessage({ id: job.id, x0: job.x0, z0: job.z0, n: job.n, step: job.step });
    }
  }

  /** Main-thread fallback: works through the queue for up to `budgetMs` each frame. */
  tick(budgetMs = 6) {
    if (!this.fallback || !this.queue.length) return;
    const t0 = performance.now();
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const job = this.queue.shift()!, w = job.n + 1, h = new Float32Array(w * w);
      for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) h[j * w + i] = this.terrain.heightAt(job.x0 + i * job.step, job.z0 + j * job.step);
      job.done(h);
    }
  }
}
