export const cuePresets = [
  { id: 'plain', label: 'Classic solid' }, { id: 'custom', label: 'Custom artwork' },
  { id: 'money', label: 'Money signs' }, { id: 'brewers', label: 'Milwaukee Brewers' },
  { id: 'badgers', label: 'Wisconsin Badgers W' }, { id: 'bucks', label: 'Milwaukee Bucks' },
  { id: 'cubs', label: 'Chicago Cubs' }, { id: 'stars', label: 'Golden stars' },
  { id: 'diamonds', label: 'Diamond inlays' }, { id: 'checker', label: 'Checkered flag' },
  { id: 'stripes', label: 'Racing stripes' }, { id: 'circuit', label: 'Circuit board' },
  { id: 'hearts', label: 'Hearts' }, { id: 'lightning', label: 'Lightning bolts' },
] as const
export type CuePreset = typeof cuePresets[number]['id']
export type CueDesign = { shaftColor: string; buttColor: string; preset: CuePreset; overlay: string | null }
export const defaultCueDesign: CueDesign = { shaftColor: '#d9b67a', buttColor: '#493224', preset: 'plain', overlay: null }
