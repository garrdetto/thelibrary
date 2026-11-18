import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { ArrowLeft, LoaderCircle, Lock, Radar } from 'lucide-react'
import { RadarAccessContext } from '@/components/axiom-radar/access'
import '@/components/axiom-radar/axiom-radar.css'

const AxiomRadar = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('@/components/axiom-radar/AxiomRadar'))

export const Route = createFileRoute('/axiom-radar')({
  head: () => ({ meta: [{ title: 'Axiom Radar' }, { name: 'description', content: 'Live coin radar.' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: AxiomRadarPage,
})

type Viewer = { ready: boolean; username: string | null; isOwner: boolean; radar: boolean }

function RadarLoading({ label }: { label: string }) {
  return <div className="radar-gate" role="status"><LoaderCircle size={22} className="spin"/><p>{label}</p></div>
}

function AxiomRadarPage() {
  const [viewer, setViewer] = useState<Viewer>({ ready: false, username: null, isOwner: false, radar: false })

  useEffect(() => {
    let active = true
    fetch('/api/workspace-access', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await response.json() as { username?: string | null; isOwner?: boolean; radar?: boolean }
        if (active) setViewer(response.ok ? { ready: true, username: result.username ?? null, isOwner: Boolean(result.isOwner), radar: Boolean(result.radar) } : { ready: true, username: null, isOwner: false, radar: false })
      })
      .catch(() => { if (active) setViewer({ ready: true, username: null, isOwner: false, radar: false }) })
    return () => { active = false }
  }, [])

  const access = useMemo(() => ({ canEdit: viewer.isOwner }), [viewer.isOwner])

  return <div className="radar-page">
    <header className="radar-appbar">
      <h1 className="radar-brand"><span aria-hidden="true"><Radar size={18} strokeWidth={2}/></span>Axiom Radar<small>live coin intelligence</small></h1>
      <div className="radar-appbar-side">
        {viewer.radar && <span className="radar-user">{viewer.isOwner ? `Signed in as ${viewer.username ?? 'owner'}` : 'Viewing only'}</span>}
        <a className="radar-exit" href="/"><ArrowLeft size={13} aria-hidden="true"/>Back to the library</a>
      </div>
    </header>
    <main className="radar-main">
      {!viewer.ready ? <RadarLoading label="Checking access…"/>
        : viewer.radar ? <RadarAccessContext.Provider value={access}>
          <Suspense fallback={<RadarLoading label="Loading the radar…"/>}><AxiomRadar/></Suspense>
        </RadarAccessContext.Provider>
        : <div className="radar-gate" role="status"><Lock size={22}/><p>{viewer.username ? 'This page is private. Ask the owner for access.' : 'This page is private. Sign in on the library with an account that has access.'}</p><a className="radar-exit" href="/">Back to the library</a></div>}
    </main>
  </div>
}
