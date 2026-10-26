export type StudioMode = 'chat' | 'lyrics' | 'image'
export type Message = { role: 'user' | 'assistant'; content: string }
export type SongSettings = {
  genre: string
  customGenre?: string
  artist?: string
  explicit?: boolean
  vibe: string
  mood: string
  pitch: string
  style: string
  instruments: string
  structure: string
}
export type LyricCorrection = { id: string; original: string; replacement: string }
export type Creation = {
  id: string
  kind: StudioMode
  title: string
  prompt: string
  content: string
  messages: Message[]
  settings: SongSettings | null
  imageMime: string | null
  parentId: string | null
  tuning: string[]
  stylePrompt: string | null
  createdAt: string
}
