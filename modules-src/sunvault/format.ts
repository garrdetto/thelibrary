export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const value = Math.abs(cents) / 100
  return `${sign}$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatShort(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${trim((dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1))}M`
  if (dollars >= 10_000) return `$${trim((dollars / 1000).toFixed(dollars >= 100_000 ? 0 : 1))}K`
  if (dollars >= 100) return `$${Math.round(dollars).toLocaleString('en-US')}`
  if (Number.isInteger(dollars)) return `$${dollars}`
  return `$${dollars.toFixed(2)}`
}

function trim(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text
}
