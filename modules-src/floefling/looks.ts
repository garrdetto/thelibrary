export type LookId = 'original' | 'wics'

export type Look = {
  skyTop: string
  skyHorizon: string
  fog: string
  snow: string
  snowShade: string
  cliff: string
  cliffDark: string
  cliffTop: string
  lane: string
  ice: string
  water: string
  marker: string
  flag: string
  scarf: string
  scarfStripe: string
  bear: string
  sun: string
}

export const LOOKS: Record<LookId, Look> = {
  original: {
    skyTop: '#3f7fcf', skyHorizon: '#cfe6f8', fog: '#dcecf8', snow: '#f4f9fd', snowShade: '#cfe0ee', cliff: '#9fd2ee', cliffDark: '#5d9ec6', cliffTop: '#b4dbf3',
    lane: '#e2eef8', ice: '#a9dcf6', water: '#123850', marker: '#2a4d6e', flag: '#ff7a3d', scarf: '#e0452c', scarfStripe: '#ffd25a', bear: '#f6f1e4', sun: '#fff1c9',
  },
  wics: {
    skyTop: '#6f83b5', skyHorizon: '#eef2ff', fog: '#eef2f8', snow: '#f8f9fc', snowShade: '#d7dce8', cliff: '#c4d4f0', cliffDark: '#6f83b5', cliffTop: '#cbd8f0',
    lane: '#eef2f8', ice: '#b9dcf0', water: '#13203a', marker: '#1e3a6e', flag: '#0594d0', scarf: '#1e3a6e', scarfStripe: '#0594d0', bear: '#f7f4ea', sun: '#ffffff',
  },
}

export function siteLook(): LookId | null {
  try {
    return window.parent && window.parent !== window && window.parent.document.documentElement.dataset.theme === 'wics' ? 'wics' : null
  } catch {
    return null
  }
}
