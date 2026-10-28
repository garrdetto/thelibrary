/**
 * localStorage that never throws: sandboxed iframes, private windows and
 * preview panes can deny storage entirely, and the module must still run.
 */
export const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
  json<T>(key: string): T | null {
    const raw = store.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  },
};

export function randomId(len = 12): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, len);
  } catch { /* insecure context */ }
  let s = '';
  while (s.length < len) s += Math.random().toString(36).slice(2);
  return s.slice(0, len);
}
