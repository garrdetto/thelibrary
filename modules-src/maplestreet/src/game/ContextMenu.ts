/**
 * The right-click menu in live mode: a small panel at the pointer with a
 * title and a few actions ("Drive", "Open doors"…). Closes on Escape, on a
 * click anywhere else, or after an action runs. Nothing takes focus on open
 * (so Space still jumps); arrow keys move focus between actions.
 */
export interface MenuItem { label: string; run?: () => void; disabled?: boolean }

export class ContextMenu {
  private el: HTMLDivElement;
  private arm = 0;
  private onDoc = (e: PointerEvent) => { if (this.open && !this.el.contains(e.target as Node)) this.close(); };
  private onKey = (e: KeyboardEvent) => {
    if (!this.open) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (!this.el.contains(document.activeElement)) return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...this.el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'ctxMenu';
    this.el.className = 'ui panel';
    this.el.setAttribute('role', 'menu');
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get open() { return !this.el.hidden; }

  show(x: number, y: number, title: string, items: MenuItem[]) {
    this.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ctx-title';
    head.textContent = title;
    this.el.appendChild(head);
    for (const item of items) {
      const b = document.createElement('button');
      b.className = 'ctx-item';
      b.setAttribute('role', 'menuitem');
      b.textContent = item.label;
      b.disabled = !!item.disabled || !item.run;
      b.onclick = () => { this.close(); item.run?.(); };
      this.el.appendChild(b);
    }
    this.el.hidden = false;
    const r = this.el.getBoundingClientRect();
    this.el.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    this.el.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
    this.detach();
    this.arm = window.setTimeout(() => {
      this.arm = 0;
      addEventListener('pointerdown', this.onDoc, true);
      addEventListener('keydown', this.onKey, true);
    });
  }

  private detach() {
    clearTimeout(this.arm);
    this.arm = 0;
    removeEventListener('pointerdown', this.onDoc, true);
    removeEventListener('keydown', this.onKey, true);
  }

  close() {
    this.detach();
    if (this.el.hidden) return;
    this.el.hidden = true;
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }
}
