/**
 * Browser-safe Meshy types, credit estimates and prompt helpers shared by the
 * admin panel and the /api/meshy route. Credit costs follow Meshy's API
 * pricing page (docs.meshy.ai/en/api/pricing).
 */

export const MESHY_AI_MODELS = ['latest', 'meshy-6', 'meshy-6-lite'] as const
export type MeshyAiModel = (typeof MESHY_AI_MODELS)[number]
export const MESHY_TARGETS = ['furniture', 'vehicle', 'character', 'ride', 'racecar'] as const
export type MeshyTarget = (typeof MESHY_TARGETS)[number]
export const MESHY_JOB_KINDS = ['preview', 'refine', 'image', 'remesh', 'retexture'] as const
export type MeshyJobKind = (typeof MESHY_JOB_KINDS)[number]
export type MeshyJobStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED'

export interface MeshyJob {
  id: string
  kind: MeshyJobKind
  target: MeshyTarget
  parentId: string | null
  prompt: string
  status: MeshyJobStatus
  progress: number
  credits: number
  thumbnailUrl: string | null
  /** Set once the finished .glb is stored and can be opened in an editor. */
  modelReady: boolean
  modelBytes: number | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface MeshyStatus {
  connected: boolean
  balance: number | null
  costs: typeof MESHY_COSTS
}

export const MESHY_COSTS = {
  preview: { latest: 20, 'meshy-6': 20, 'meshy-6-lite': 5 } as Record<MeshyAiModel, number>,
  refine: 10,
  image: { latest: 30, 'meshy-6': 30, 'meshy-6-lite': 15 } as Record<MeshyAiModel, number>,
  imageMeshOnly: { latest: 20, 'meshy-6': 20, 'meshy-6-lite': 5 } as Record<MeshyAiModel, number>,
  remesh: 5,
  retexture: 10,
  rigging: 5,
}

export const POLYCOUNT_DEFAULTS: Record<MeshyTarget, number> = { furniture: 8000, vehicle: 20000, character: 15000, ride: 12000, racecar: 20000 }
export const POLYCOUNT_RANGE = { min: 500, max: 100000 }
export const PREVIEW_COUNT_MAX = 4

export function estimateCredits(action: { kind: 'preview'; model: MeshyAiModel; count: number } | { kind: 'image'; model: MeshyAiModel; texture: boolean } | { kind: 'refine' | 'remesh' | 'retexture' }) {
  switch (action.kind) {
    case 'preview': return MESHY_COSTS.preview[action.model] * action.count
    case 'image': return (action.texture ? MESHY_COSTS.image : MESHY_COSTS.imageMeshOnly)[action.model]
    case 'refine': return MESHY_COSTS.refine
    case 'remesh': return MESHY_COSTS.remesh
    case 'retexture': return MESHY_COSTS.retexture
  }
}

/** Phrases the panel can append to a prompt with one click. */
export const PROMPT_HELPERS: Record<MeshyTarget, string[]> = {
  vehicle: ['no wheels', 'wheel wells empty', 'side view', 'game asset', 'low poly', 'original design, no logos or badges', 'clean single body'],
  furniture: ['game asset', 'low poly', 'single object', 'no floor or background', 'realistic proportions'],
  character: ['game asset', 'A-pose', 'full body', 'plain clothing, no logos'],
  ride: ['amusement park ride', 'game asset', 'stylized', 'bright paint', 'on a round platform', 'single object, centered', 'original design, no logos or text'],
  racecar: ['short-track stock car', 'no wheels', 'wheel wells empty', 'plain white body', 'side view', 'game asset', 'original design, no logos, numbers or decals'],
}

export const NEGATIVE_DEFAULTS: Record<MeshyTarget, string> = {
  vehicle: 'wheels, tires, logos, badges, brand names, license plate text, ground plane',
  furniture: 'floor, background, text, logos',
  character: 'logos, text, weapons',
  ride: 'people, riders, ground plane, background, scenery, text, logos, brand names, characters from films or games',
  racecar: 'wheels, tires, driver, logos, badges, brand names, sponsor decals, race numbers, text, ground plane',
}
