import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { ArrowLeft, LoaderCircle, Radar } from 'lucide-react'
import { RadarAccessContext } from '@/components/axiom-radar/access'
import '@/components/axiom-radar/axiom-radar.css'

const AxiomRadar = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('@/components/axiom-radar/AxiomRadar'))

export const Route = createFileRoute('/axiom-radar')({
  head: () => ({ meta: [{ title: 'Axiom Radar' }, { name: 'description', content: 'Live coin radar.' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: AxiomRadarPage,
})

type Viewer = { username: string | null; isAdmin: boolean }

function RadarLoading({ label }: { label: string }) {
  return <div className="radar-gate" role="status"><LoaderCircle size={22} className="spin"/><p>{label}</p></div>
}

function AxiomRadarPage() {
  const [viewer, setViewer] = useState<Viewer>({ username: null, isAdmin: false })

  useEffect(() => {
    let active = true
    fetch('/api/workspace-access', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await response.json() as { username?: string | null; isAdmin?: boolean }
        if (active && response.ok) setViewer({ username: result.username ?? null, isAdmin: Boolean(result.isAdmin) })
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  const access = useMemo(() => ({ canEdit: viewer.isAdmin }), [viewer.isAdmin])

  return <div className="radar-page">
    <header className="radar-appbar">
      <h1 className="radar-brand"><span aria-hidden="true"><Radar size={18} strokeWidth={2}/></span>Axiom Radar<small>live coin intelligence</small></h1>
      <div className="radar-appbar-side">
        <span className="radar-user">{viewer.isAdmin ? `Signed in as ${viewer.username ?? 'admin'}` : 'Viewing only'}</span>
        <a className="radar-exit" href="/"><ArrowLeft size={13} aria-hidden="true"/>Back to the library</a>
      </div>
    </header>
    <main className="radar-main">
      <RadarAccessContext.Provider value={access}>
        <Suspense fallback={<RadarLoading label="Loading the radar…"/>}><AxiomRadar/></Suspense>
      </RadarAccessContext.Provider>
    </main>
  </div>
}
