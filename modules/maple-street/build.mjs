// Bundles the TypeScript sources into one self-contained module page:
//   modules/maple-street/public/maplestreet.html (served at /modules/maplestreet.html)
// three.js, Rapier, PeerJS and colyseus.js stay external and load from unpkg
// through the import map / script tags in index.html.
//
// Run with either:   bun modules/maple-street/build.mjs
//              or:   pnpm dlx esbuild --version && node modules/maple-street/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, 'src/main.ts');
const out = join(here, 'public/maplestreet.html');
const external = ['three', 'three/webgpu', 'three/tsl', 'three/addons/*', '@dimforge/rapier3d-compat'];

async function bundle() {
  if (typeof Bun !== 'undefined') {
    const r = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', external });
    if (!r.success) throw new AggregateError(r.logs, 'bundle failed');
    return await r.outputs[0].text();
  }
  const esbuild = await import('esbuild');
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external, write: false });
  return r.outputFiles[0].text;
}

const js = await bundle();
if (js.includes('</script')) throw new Error('bundle contains a closing script tag');
const html = readFileSync(join(here, 'index.html'), 'utf8');
if (!html.includes('/*__BUNDLE__*/')) throw new Error('index.html is missing the bundle marker');
const banner = '// Maple Street — generated from modules/maple-street by build.mjs. Edit the TypeScript sources, then rebuild.\n';
writeFileSync(out, html.replace('/*__BUNDLE__*/', () => banner + js));
console.log(`wrote ${out} (${(Buffer.byteLength(html) / 1024 + js.length / 1024).toFixed(0)} KB)`);
