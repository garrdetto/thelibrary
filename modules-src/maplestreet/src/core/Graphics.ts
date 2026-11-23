/** The Graphics setting: low (the default) draws one pixel per CSS pixel with no shadows or ambient occlusion; high is the full picture. */
export type Graphics = 'low' | 'high';

const KEY = 'maplestreet/graphics';

export function loadGraphics(): Graphics {
  const asked = new URLSearchParams(location.search).get('quality');
  if (asked === 'low' || asked === 'high') return asked;
  try {
    return localStorage.getItem(KEY) === 'high' ? 'high' : 'low';
  } catch {
    return 'low';
  }
}

/** Shows the current setting on the button; a click switches it, saves it and reloads so the scene is rebuilt. */
export function wireGraphicsButton(button: HTMLButtonElement | null, current: Graphics) {
  if (!button) return;
  button.textContent = `Graphics: ${current === 'high' ? 'High' : 'Low'}`;
  button.onclick = () => {
    try {
      localStorage.setItem(KEY, current === 'high' ? 'low' : 'high');
    } catch {
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('quality');
    location.replace(url.toString());
  };
}
