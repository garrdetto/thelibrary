// Mobile full screen for modules shown in the library's play frame (src/lib/use-mobile-full-play.ts).
// On phones and tablets the site stretches the frame over the whole screen and posts {type:'tl-full', on}.
// This marks <html class="tl-full"> while it is on (so `.tl-full-only` controls appear), answers with
// 'tl-full-ack' (the site then hides its own fallback close button), and any `[data-tl-exit-full]` button
// asks the site to drop back to the normal page with 'tl-exit-full'.
const STYLE = 'html:not(.tl-full) .tl-full-only{display:none!important}'

export function initEmbedFull() {
  if (typeof window === 'undefined' || window.parent === window) return
  const css = document.createElement('style')
  css.textContent = STYLE
  document.head.append(css)
  const post = (type) => { try { window.parent.postMessage({ type }, location.origin) } catch { /* the page is not the site's frame */ } }
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'tl-full') return
    document.documentElement.classList.toggle('tl-full', !!event.data.on)
    post('tl-full-ack')
  })
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-tl-exit-full]') : null
    if (!button) return
    event.preventDefault()
    post('tl-exit-full')
  })
  post('tl-full-hello')
}
