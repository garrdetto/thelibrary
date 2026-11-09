import { ArrowRight, Image, MessageCircle, Music2 } from 'lucide-react'

export type StudioId = 'chat' | 'image' | 'lyrics'

const studios = [
  { id: 'chat', label: 'AI chat', icon: MessageCircle, detail: 'Talk ideas through with Claude.' },
  { id: 'image', label: 'Image studio', icon: Image, detail: 'Create and edit pictures from a description.' },
  { id: 'lyrics', label: 'Lyric studio', icon: Music2, detail: 'Write, fine-tune and revamp song lyrics.' },
] as const

export function AdminStudios({ onOpenStudio }: { onOpenStudio?: (id: StudioId) => void }) {
  return <div className="adm-stats">
    {studios.map(({ id, label, icon: Icon, detail }) => <article key={id} className="adm-stat">
      <header><span className="adm-stat-icon" aria-hidden><Icon size={16}/></span><h3>{label}</h3></header>
      <p className="adm-stat-detail">{detail}</p>
      <button type="button" className="adm-link" onClick={() => onOpenStudio?.(id)} disabled={!onOpenStudio}>Open {label} <ArrowRight size={14} aria-hidden/></button>
    </article>)}
  </div>
}
