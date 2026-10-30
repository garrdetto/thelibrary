export const siteThemes = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'slate', label: 'Gray' },
  { id: 'light', label: 'Light' },
] as const

export type SiteTheme = typeof siteThemes[number]['id']

const legacy: Record<string, SiteTheme> = { charcoal: 'slate', gray: 'light', sage: 'light', clay: 'light', ocean: 'light', forest: 'light', lavender: 'light', rose: 'light', sand: 'light' }

export function toSiteTheme(value: unknown): SiteTheme | null {
  if (typeof value !== 'string') return null
  if (siteThemes.some(theme => theme.id === value)) return value as SiteTheme
  return legacy[value] ?? null
}

export function isSiteTheme(value: unknown): value is SiteTheme {
  return siteThemes.some(theme => theme.id === value)
}

export const initializeSiteTheme = `try{var saved=document.cookie.match(/(?:^|; )vv_theme=([^;]*)(?:;|$)/);var theme=saved?saved[1]:'midnight';var legacy=${JSON.stringify(legacy)};if(legacy[theme])theme=legacy[theme];document.documentElement.dataset.theme=${JSON.stringify(siteThemes.map(theme => theme.id))}.includes(theme)?theme:'midnight'}catch{document.documentElement.dataset.theme='midnight'}`
