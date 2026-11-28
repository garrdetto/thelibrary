import type { Hardpoints } from '../sim/hardpoints'
import type { Snapshot } from '../sim/lab'
import { clearHardpoints, deleteSetup, loadRemote, saveHardpoints, saveSetup } from '../ui/store'
import type { RailPage } from './page'

const key = (x: Snapshot) => JSON.stringify(x)

/**
 * Keeps the original page's saved setups and loaded hardpoints file in the account instead of the browser: signed in,
 * the list comes from `/api/railsetup` and every change the page writes is sent there; signed out, setups last until
 * the page closes. The page's own Save, Load, Delete, Import and Export work unchanged; only `writeSaved` and the
 * hardpoints file handling are replaced.
 */
export async function useAccount(p: RailPage, onSaved: () => void) {
  const where = document.getElementById('sv-where')
  p.saved = []
  p.fillLists()
  const synced = new Map<string, string>()
  let signedIn = false
  let remoteHp = false

  p.replaceWriteSaved(() => {
    onSaved()
    if (!signedIn) return
    void sync()
  })

  let running: Promise<void> | null = null
  let again = false
  async function sync() {
    if (running) { again = true; return running }
    running = (async () => {
      do {
        again = false
        const now = new Map(p.saved.map(x => [x.name, key(x)]))
        for (const [name, value] of now) {
          if (synced.get(name) === value) continue
          const r = await saveSetup(p.saved.find(x => x.name === name) as Snapshot)
          if ('error' in r) { alert(r.error); break }
          synced.set(name, value)
        }
        for (const name of [...synced.keys()]) {
          if (now.has(name)) continue
          const r = await deleteSetup(name)
          if ('error' in r) { alert(r.error); break }
          synced.delete(name)
        }
      } while (again)
    })()
    try { await running } finally { running = null }
  }

  const useHp = p.replaceUseHardpoints((j, name) => {
    useHp(j, name)
    if (!name && remoteHp && signedIn) { remoteHp = false; void clearHardpoints() }
  })
  const file = document.getElementById('hp-file') as HTMLInputElement | null
  if (file) file.onchange = async () => {
    const f = file.files?.[0]
    file.value = ''
    if (!f) return
    try {
      const j = JSON.parse(await f.text()) as Hardpoints
      p.useHardpoints(j, f.name)
      if (signedIn) {
        const r = await saveHardpoints(f.name, j)
        if ('error' in r) alert(r.error)
        else remoteHp = true
      }
    } catch (err) {
      alert('Could not use that file: ' + (err instanceof Error ? err.message : String(err)))
      p.useHardpoints(p.HP0)
    }
  }

  const remote = await loadRemote()
  signedIn = remote.signedIn
  if (where) where.textContent = signedIn ? 'Saved to your account.' : 'Not signed in: setups stay until you leave this page.'
  if (!signedIn) return
  const local = p.saved
  p.saved = [...remote.setups, ...local.filter(x => !remote.setups.some(r => r.name === x.name))]
  for (const x of remote.setups) synced.set(x.name, key(x))
  p.fillLists()
  onSaved()
  if (local.length) void sync()
  if (remote.hardpoints) {
    try {
      p.useHardpoints(remote.hardpoints.hardpoints, remote.hardpoints.name)
      remoteHp = true
    } catch {
      p.useHardpoints(p.HP0)
    }
  }
}
