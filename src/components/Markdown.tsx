import { Suspense, lazy } from 'react'

const Streamdown = lazy(() => import('streamdown').then(module => ({ default: module.Streamdown })))

export function Markdown({ children }: { children: string }) {
  return <Suspense fallback={<div className="markdown-fallback">{children}</div>}><Streamdown>{children}</Streamdown></Suspense>
}
