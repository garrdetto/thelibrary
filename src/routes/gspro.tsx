import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { ArrowLeft, LoaderCircle, Target } from 'lucide-react'
import '@/components/gspro/gspro.css'

const GsproApp = lazy<ComponentType>(() => import.meta.env.SSR ? Promise.resolve({ default: () => null }) : import('@/components/gspro/GsproApp'))

export const Route = createFileRoute('/gspro')({
  head: () => ({ meta: [{ title: 'GSPro Analyzer' }, { name: 'description', content: 'Live GSPro shot data, club averages, dispersion, gapping and tips.' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: GsproPage,
})

type Viewer = { state: 'loading' } | { state: 'ready'; username: string | null; isAdmin: boolean } | { state: 'error' }

function Gate({ children }: { children: React.ReactNode }) {
  return <div className="gs-gate" role="status">{children}</div>
}

function GsproPage() {
  const [viewer, setViewer] = useState<Viewer>({ state: 'loading' })

  useEffect(() => {
    let active = true
    fetch('/api/workspace-access', { headers: { Accept: 'application/json' } })
      .then(async response => {
        const result = await response.json() as { username?: string | null; isAdmin?: boolean }
        if (active) setViewer(response.ok ? { state: 'ready', username: result.username ?? null, isAdmin: Boolean(result.isAdmin) } : { state: 'error' })
      })
      .catch(() => { if (active) setViewer({ state: 'error' }) })
    return () => { active = false }
  }, [])

  return <div className="gs-page">
    <header className="gs-appbar">
      <h1 className="gs-brand"><span aria-hidden="true"><Target size={18} strokeWidth={2}/></span>GSPro Analyzer<small>shot data and tips</small></h1>
      <div className="gs-appbar-side">
        {viewer.state === 'ready' && viewer.username && <span className="gs-user">{viewer.username}</span>}
        <a className="gs-exit" href="/#admin/gspro"><ArrowLeft size={13} aria-hidden="true"/>Admin console</a>
      </div>
    </header>
    <main className="gs-main">
      {viewer.state === 'loading' && <Gate><LoaderCircle size={22} className="spin" aria-hidden/><p>Checking your account…</p></Gate>}
      {viewer.state === 'error' && <Gate><h2>Could not check your account</h2><p>Reload the page to try again.</p></Gate>}
      {viewer.state === 'ready' && !viewer.isAdmin && <Gate><h2>Administrator only</h2><p>{viewer.username ? 'This page is only open to the site administrator.' : 'Sign in as the administrator on the library, then come back to this page.'}</p><a className="gs-button" href="/">Go to the library</a></Gate>}
      {viewer.state === 'ready' && viewer.isAdmin && <Suspense fallback={<Gate><LoaderCircle size={22} className="spin" aria-hidden/><p>Loading the analyzer…</p></Gate>}><GsproApp/></Suspense>}
    </main>
  </div>
}
