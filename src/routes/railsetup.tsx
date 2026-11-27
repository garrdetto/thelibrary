import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

export const Route = createFileRoute('/railsetup')({
  head: () => ({ meta: [{ title: 'Straight Rail Setup Lab · the library' }, { name: 'description', content: 'Chassis setup and suspension geometry: springs, bars, scales, ride heights and a track test.' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: RailSetupPage,
})

function RailSetupPage() {
  return <div className="standalone-module">
    <iframe src="/modules/railsetup.html?page=1" title="Straight Rail Setup Lab" allow="autoplay; fullscreen" allowFullScreen/>
    <a className="standalone-home-tab" href="/"><ArrowLeft size={13} aria-hidden="true"/>Return to Homepage</a>
  </div>
}
