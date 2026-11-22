import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import { initializeSiteTheme } from '@/lib/site-themes'
import { SiteRibbon } from '@/components/ribbon/SiteRibbon'

import '../styles.css'

const siteName = 'the library — Learning Modules'
const siteDescription = 'Hands-on learning modules in strategy, physics, math and precision, with live head-to-head sessions and saved progress.'

export const Route = createRootRoute({
  head: () => ({
    // Fonts load from the document head, in parallel with the stylesheet. An @import inside
    // styles.css made the browser wait for the whole stylesheet before it even asked for them.
    // DM Sans and Manrope are variable fonts, so one weight range covers every weight used.
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..800&family=Manrope:wght@400..800&family=Rajdhani:wght@600;700&display=swap' },
    ],
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      {
        title: siteName,
      },
      {
        name: 'description',
        content: siteDescription,
      },
      {
        property: 'og:title',
        content: siteName,
      },
      {
        property: 'og:description',
        content: siteDescription,
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script src="/fox-dollar.js" />
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: initializeSiteTheme }} />
      </head>
      <body>
        {children}
        <SiteRibbon />
        <Scripts />
      </body>
    </html>
  )
}
