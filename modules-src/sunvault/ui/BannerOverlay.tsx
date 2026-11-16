import type { Banner, BannerTone } from '../play/director'
import { formatMoney } from '../format'
import { useRollingNumber } from './useRollingNumber'

const TONES: Record<BannerTone, { ring: string; text: string; glow: string }> = {
  gold: { ring: 'ring-gold-400/70', text: 'from-[#fffbe6] via-[#ffd35a] to-[#c27a10]', glow: 'shadow-[0_0_60px_rgba(255,190,70,0.45)]' },
  violet: { ring: 'ring-[#c78bff]/70', text: 'from-[#ffffff] via-[#e5c2ff] to-[#9a4dff]', glow: 'shadow-[0_0_60px_rgba(190,120,255,0.45)]' },
  jade: { ring: 'ring-[#5af0a0]/70', text: 'from-[#ffffff] via-[#c8ffd8] to-[#2fbf6a]', glow: 'shadow-[0_0_60px_rgba(90,240,160,0.4)]' },
  ember: { ring: 'ring-[#ff8a3a]/80', text: 'from-[#fff6dc] via-[#ffb347] to-[#ff3d1f]', glow: 'shadow-[0_0_70px_rgba(255,120,40,0.55)]' },
}

export function BannerOverlay({ banner, onSkip }: { banner: Banner | null; onSkip: () => void }) {
  if (!banner) return null
  return <BannerCard key={banner.id} banner={banner} onSkip={onSkip} />
}

function BannerCard({ banner, onSkip }: { banner: Banner; onSkip: () => void }) {
  const tone = TONES[banner.tone]
  const amount = useRollingNumber(banner.amount ?? 0, 1.2)
  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-4">
      <button
        type="button"
        onClick={onSkip}
        aria-live="assertive"
        className={`pointer-events-auto animate-banner-in max-w-md rounded-3xl bg-night-900/85 px-6 py-5 text-center ring-2 backdrop-blur-sm sm:px-10 sm:py-7 ${tone.ring} ${tone.glow} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-200`}
      >
        <span className="block text-[11px] font-bold uppercase tracking-[0.3em] text-sand-300">{banner.kicker}</span>
        <span className={`mt-1 block font-display text-4xl font-black leading-tight tracking-wide text-transparent bg-clip-text bg-gradient-to-b ${tone.text} drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] sm:text-6xl`}>
          {banner.title}
        </span>
        {banner.amount !== undefined && (
          <span className="mt-2 block font-display text-3xl font-black tabular-nums text-gold-100 drop-shadow-[0_0_12px_rgba(255,210,110,0.7)] sm:text-4xl">
            {formatMoney(amount)}
          </span>
        )}
        {banner.subtitle && <span className="mt-3 block text-sm leading-snug text-sand-200/90">{banner.subtitle}</span>}
        <span className="mt-3 block text-[10px] uppercase tracking-[0.25em] text-sand-300/50">Tap or press Space to continue</span>
      </button>
    </div>
  )
}
