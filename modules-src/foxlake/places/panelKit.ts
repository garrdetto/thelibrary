export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

export const money = (n: number) => `$${Math.round(n).toLocaleString()}`

/** The few builders every place window shares (PlacePanel owns them). */
export interface PanelKit {
  section(title: string): HTMLElement
  button(key: string, text: string, label: string, enabled: boolean, onClick: () => void): HTMLButtonElement
}
