import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { LoaderCircle, LogOut, Radar, ShieldAlert } from 'lucide-react'
import '@/components/axiom-radar/axiom-radar.css'

const AxiomRadar = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('@/components/axiom-radar/AxiomRadar'))

export const Route = createFileRoute('/admin/axiom-radar')({
  head: () => ({ meta: [{ title: 'Axiom Radar' }, { name: 'description', content: 'Private live coin radar.' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: AxiomRadarPage,
})

type AccessState = { status: 'loading' } | { status: 'denied'; signedIn: boolean } | { status: 'admin'; username: string } | { status: 'error'; message: string }

function RadarLoading({ label }: { label: string }) {
  return <div className="radar-gate" role="status"><LoaderCircle size={22} className="spin"/><p>{label}</p></div>
}

function AxiomRadarPage() {
  const [access, setAccess] = useState<AccessState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setAccess({ status: 'loading' })
    fetch('/api/workspace-access', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await response.json() as { username?: string | null; isAdmin?: boolean; error?: string }
        if (!response.ok) throw new Error(result.error ?? 'Account access is unavailable.')
        if (!active) return
        setAccess(result.isAdmin ? { status: 'admin', username: result.username ?? 'admin' } : { status: 'denied', signedIn: Boolean(result.username) })
      })
      .catch(failure => { if (active) setAccess({ status: 'error', message: failure instanceof Error ? failure.message : 'Account access is unavailable.' }) })
    return () => { active = false }
  }, [attempt])

  return <div className="radar-page">
    <header className="radar-appbar">
      <h1 className="radar-brand"><span aria-hidden="true"><Radar size={18} strokeWidth={2}/></span>Axiom Radar<small>live coin intelligence</small></h1>
      <div className="radar-appbar-side">
        {access.status === 'admin' && <span className="radar-user">Signed in as {access.username}</span>}
        <a className="radar-exit" href="/#admin"><LogOut size={13} aria-hidden="true"/>Exit to admin</a>
      </div>
    </header>
    <main className="radar-main">
      {access.status === 'loading' && <RadarLoading label="Checking administrator access…"/>}
      {access.status === 'error' && <div className="radar-gate" role="alert"><ShieldAlert size={26}/><p>{access.message}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
      {access.status === 'denied' && <div className="radar-gate">
        <ShieldAlert size={26}/>
        <h2>Administrator access required</h2>
        <p>{access.signedIn ? 'This account cannot open the Axiom Radar.' : 'Sign in with the workspace administrator account to open the Axiom Radar.'}</p>
        <a className="secondary-button" href="/">{access.signedIn ? 'Back to the workspace' : 'Go to sign in'}</a>
      </div>}
      {access.status === 'admin' && <Suspense fallback={<RadarLoading label="Loading the radar…"/>}><AxiomRadar/></Suspense>}
    </main>
  </div>
}
