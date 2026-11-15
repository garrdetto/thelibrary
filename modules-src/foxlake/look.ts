/**
 * Fox Lake's picture, kept in one file so worlds built on the same engine (Tello) follow it without a copy.
 */

/**
 * A soft, even picture: a gentler sun with a stronger sky fill, so lit and shaded sides sit close together and nothing
 * falls into murk; very faint sun shadows (0.979: 30 % of the earlier 0.93's strength); a night about 32 % brighter
 * than Rack & Reel's (1.15 × 1.15); and matte characters in their own colours (plain materials, not the physically
 * based cloth, which washed people out to grey under the town's sky light).
 * The ground and roads get a share of their own colour back (`groundLift`), so the dark needle-and-moss floor under
 * the woods, slopes facing away from the sun and the ground at night never fall to a burnt-looking black.
 * People get no glow of their own by day and only a little at night (`characterLift`, `characterNightLift`): with the
 * brighter night exposure, Rack & Reel's own night glow made the hunter look lit by a spotlight of his own.
 * All of it is light levels, so it costs no draw calls, textures or shadow passes.
 */
export const FOX_LAKE_LOOK = { shadowDarkness: 0.979, key: 0.8, fill: 1.65, nightBrightness: 1.32, matteCharacters: true, characterDiffuse: 0.86, characterLift: 0, characterNightLift: 0.035, groundLift: { day: 0.22, night: 0.3 } }
/**
 * No sun or moon shadows in Fox Lake, for everyone (the owner's call): the town's shadows came and went as you moved
 * (casters handed to the shadow map by cell), cars' own shadows jumped on their bodies, and shaded asphalt read as
 * burnt. Off, there is no shadow pass, no shadow proxies and no Shadows switch, and the picture is lit by the sky fill.
 */
export const FOX_LAKE_SHADOWS = false
/** Half Rack & Reel's shadow map: the town has far more casters, and the soft blurred shadows hide the coarser texels. */
export const FOX_LAKE_SHADOW_MAP = 1024

/** A lighter needle-and-leaf-litter floor than the lake country's own, so the ground under the woods reads as forest floor, not scorched earth. */
export const FOX_LAKE_WOODS_FLOOR = { needles: [0.47, 0.4, 0.27], moss: [0.37, 0.44, 0.22] }
