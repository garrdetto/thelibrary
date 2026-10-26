export const siteThemes = [
  { id: 'gray', label: 'Gray' },
  { id: 'sage', label: 'Sage' },
  { id: 'clay', label: 'Clay' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'forest', label: 'Forest' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'rose', label: 'Rose' },
  { id: 'sand', label: 'Sand' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'charcoal', label: 'Charcoal' },
] as const

export type SiteTheme = typeof siteThemes[number]['id']

export function isSiteTheme(value: unknown): value is SiteTheme {
  return siteThemes.some(theme => theme.id === value)
}

export const initializeSiteTheme = `try{var saved=document.cookie.match(/(?:^|; )vv_theme=([^;]*)(?:;|$)/);var theme=saved?saved[1]:'gray';document.documentElement.dataset.theme=${JSON.stringify(siteThemes.map(theme => theme.id))}.includes(theme)?theme:'gray'}catch{document.documentElement.dataset.theme='gray'}`
