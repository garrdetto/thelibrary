import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

import { initializeSiteTheme } from '@/lib/site-themes'

import '@shared/styles/styles.css'

const siteName = 'the library — Learning Modules'
const siteDescription = 'Hands-on learning modules in strategy, physics, math and precision, with live head-to-head sessions and saved progress.'

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
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
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: initializeSiteTheme }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
