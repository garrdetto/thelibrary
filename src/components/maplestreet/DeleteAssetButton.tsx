import { LoaderCircle, Trash2 } from 'lucide-react'

type Props = {
  /** What the confirmation names, such as “the item Walnut sideboard”. */
  label: string
  /** Extra sentence for the confirmation, before “This can’t be undone.” */
  detail?: string
  busy: boolean
  disabled?: boolean
  onDelete: () => void
}

export function DeleteAssetButton({ label, detail, busy, disabled, onDelete }: Props) {
  function confirmDelete() {
    if (window.confirm(`Delete ${label}? ${detail ? `${detail} ` : ''}This can’t be undone.`)) onDelete()
  }
  return <button type="button" onClick={confirmDelete} disabled={busy || disabled} aria-label={`Delete ${label}`}>
    {busy ? <LoaderCircle className="spin" size={12} aria-hidden/> : <Trash2 size={12} aria-hidden/>} {busy ? 'Deleting…' : 'Delete'}
  </button>
}
