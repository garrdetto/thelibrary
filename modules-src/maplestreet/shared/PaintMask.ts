/**
 * Recolors every texel within `tolerance` (0–1, RGB distance) of the key
 * color, keeping its shading: new = paint × (texel luminance ÷ key luminance).
 * Used by the game and by the admin editor's preview, so both agree.
 * `px` is RGBA bytes; `key` is "#rrggbb"; `paint` is sRGB 0–255.
 */
export function recolorPixels(px: Uint8ClampedArray, key: string, tolerance: number, paint: [number, number, number]) {
  const k = [1, 3, 5].map(i => parseInt(key.slice(i, i + 2), 16));
  const keyLum = Math.max(8, 0.299 * k[0] + 0.587 * k[1] + 0.114 * k[2]);
  const limit = (tolerance * 441.7) ** 2;
  for (let i = 0; i < px.length; i += 4) {
    const dr = px[i] - k[0], dg = px[i + 1] - k[1], db = px[i + 2] - k[2];
    const d = dr * dr + dg * dg + db * db;
    if (d > limit) continue;
    const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / keyLum;
    const edge = Math.min(1, (1 - d / limit) * 3);
    for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * (1 - edge) + Math.min(255, paint[c] * lum) * edge;
  }
}
