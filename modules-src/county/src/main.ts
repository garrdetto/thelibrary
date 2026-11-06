/**
 * Kestrel County: starts the renderer, the clipart kit and the sky, then the
 * streamed county (`WorldMain.ts`), or the Phase 0 look-development scene
 * with `?lookdev=1` (`LookDevMain.ts`).
 */
import { Renderer } from './core/Renderer';
import { Kit } from './style/Kit';
import { Sky } from './world/Sky';
import { bootLookDev } from './LookDevMain';
import { bootWorld } from './WorldMain';

const params = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;

async function boot() {
  const status = $('status');
  const lookdev = params.get('lookdev') === '1';
  document.body.classList.add(lookdev ? 'lookdev' : 'world');
  if (params.get('ui') === '0') document.body.classList.add('clean');
  let r: Renderer;
  try {
    r = await Renderer.create($('app'));
  } catch {
    status.textContent = 'This browser could not start WebGL2.';
    return;
  }
  const kit = new Kit();
  const sky = new Sky(r);
  try {
    if (lookdev) bootLookDev(r, kit, sky);
    else await bootWorld(r, kit, sky, s => { status.textContent = s; });
  } catch (err) {
    console.error(err);
    status.textContent = 'The county could not load. Reload the page to try again.';
    return;
  }
  status.textContent = '';
  document.body.classList.add('ready');
}

void boot();