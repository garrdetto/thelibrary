/**
 * The clipart material kit: a handful of vertex-colored finishes (matte,
 * satin, plastic, clear-coated paint, glass, metal, foliage, ground) so a
 * whole district draws in one call per finish, plus glow materials whose
 * brightness follows the night (window lights, lamp bulbs, nav lights).
 *
 * Colors live on the vertices (sRGB); the finish decides how light sits on
 * them. No noise textures: detail comes from modelled geometry.
 */
import * as pc from 'playcanvas';
import { FINISH } from '../../config';
import type { RGB } from '../../../foxplains2/src/core/Geo';

export type Finish = keyof typeof FINISH;

function vertexColored(m: pc.StandardMaterial) {
  m.diffuse.set(1, 1, 1);
  m.diffuseVertexColor = true;
  m.diffuseVertexColorChannel = 'rgb';
  (m as unknown as { vertexColorGamma: boolean }).vertexColorGamma = true;
}

export class Kit {
  readonly finish: Record<Finish, pc.StandardMaterial>;
  private glows: { m: pc.StandardMaterial; day: number; night: number }[] = [];

  constructor() {
    const make = (name: Finish) => {
      const f = FINISH[name] as { gloss: number; metal: number; clearCoat?: number; clearCoatGloss?: number };
      const m = new pc.StandardMaterial();
      m.name = `county-${name}`;
      vertexColored(m);
      m.useMetalness = true;
      m.metalness = f.metal;
      m.gloss = f.gloss;
      if (f.clearCoat) { m.clearCoat = f.clearCoat; m.clearCoatGloss = f.clearCoatGloss ?? 0.9; }
      if (name === 'glass') m.specularityFactor = 1;
      if (name === 'foliage') m.cull = pc.CULLFACE_NONE;
      m.update();
      return m;
    };
    this.finish = {
      matte: make('matte'), satin: make('satin'), plastic: make('plastic'), paint: make('paint'),
      glass: make('glass'), metal: make('metal'), foliage: make('foliage'), ground: make('ground'),
    };
  }

  /** An emissive material that brightens toward `night` intensity after dark. */
  glow(name: string, color: RGB, day: number, night: number) {
    const m = new pc.StandardMaterial();
    m.name = `county-glow-${name}`;
    vertexColored(m);
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = 0.6;
    m.emissive.set(color[0], color[1], color[2]);
    m.emissiveIntensity = day;
    m.update();
    this.glows.push({ m, day, night });
    return m;
  }

  setNight(night: number) {
    for (const g of this.glows) {
      const v = g.day + (g.night - g.day) * night;
      if (Math.abs(g.m.emissiveIntensity - v) > 0.01) { g.m.emissiveIntensity = v; g.m.update(); }
    }
  }
}
