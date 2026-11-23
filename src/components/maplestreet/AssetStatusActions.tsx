import type { AssetStatus } from '../../../modules-src/maplestreet/shared/Assets'

const LABEL: Record<AssetStatus, string> = { draft: 'Draft', published: 'Live', retired: 'Retired' }

export function statusOf(record: { status?: AssetStatus; active: boolean }): AssetStatus {
  return record.status ?? (record.active ? 'published' : 'retired')
}

export function submitStatus(event: { nativeEvent: Event }): 'draft' | 'published' {
  const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
  return submitter?.value === 'draft' ? 'draft' : 'published'
}

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return <span className={`ms-items-state is-${status}`}>{LABEL[status]}</span>
}

export function AssetStatusActions({ status, onChange }: { status: AssetStatus; onChange: (next: AssetStatus) => void }) {
  if (status === 'draft') return <button type="button" onClick={() => onChange('published')}>Publish</button>
  if (status === 'published') return <button type="button" onClick={() => onChange('retired')}>Retire</button>
  return <button type="button" onClick={() => onChange('published')}>Restore</button>
}

export function DraftsNote() {
  return <p className="ms-items-note">Drafts are visible only to you, here in the editor. Publish one to put it in Life Sim.</p>
}
