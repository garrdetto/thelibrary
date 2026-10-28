/** Keyboard + pointer state with per-frame edge detection. */
export class Input {
  private down = new Set<string>();
  private pressedThisFrame = new Set<string>();
  readonly pointer = { x: 0, y: 0, ndcX: 0, ndcY: 0, dx: 0, dy: 0, buttons: 0, wheel: 0 };
  private clicked = new Set<number>();
  private released = new Set<number>();

  constructor(private el: HTMLElement) {
    addEventListener('keydown', e => {
      if (this.isTyping(e)) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedThisFrame.add(e.code);
      this.down.add(e.code);
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());

    el.addEventListener('pointermove', e => {
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      this.pointer.ndcX = (e.clientX / innerWidth) * 2 - 1;
      this.pointer.ndcY = -(e.clientY / innerHeight) * 2 + 1;
      this.pointer.dx += e.movementX; this.pointer.dy += e.movementY;
    });
    el.addEventListener('pointerdown', e => { this.pointer.buttons = e.buttons; this.clicked.add(e.button); });
    addEventListener('pointerup', e => { this.pointer.buttons = e.buttons; this.released.add(e.button); });
    el.addEventListener('wheel', e => { this.pointer.wheel += Math.sign(e.deltaY); }, { passive: true });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  private isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressedThisFrame.has(code); }
  mouseClicked(button = 0) { return this.clicked.has(button); }
  mouseReleased(button = 0) { return this.released.has(button); }
  mouseHeld(button = 0) { return (this.pointer.buttons & (1 << (button === 1 ? 2 : button === 2 ? 1 : 0))) !== 0; }
  axis(neg: string[], pos: string[]) {
    return (pos.some(k => this.down.has(k)) ? 1 : 0) - (neg.some(k => this.down.has(k)) ? 1 : 0);
  }

  /** Call once at the end of every rendered frame. */
  endFrame() {
    this.pressedThisFrame.clear();
    this.clicked.clear();
    this.released.clear();
    this.pointer.dx = 0; this.pointer.dy = 0; this.pointer.wheel = 0;
  }

  get canvas() { return this.el; }
}
