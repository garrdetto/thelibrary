# Verse & Vision

A calm, cloud-powered creative workspace with AI chat, image generation, and a dedicated lyric studio. AI requests stay on the server through Netlify AI Gateway rather than directing visitors to a provider’s website.

## Features

- Conversational chat with markdown responses and recent conversation context.
- Square, landscape, and portrait image generation with actual PNG, JPG, and WebP download conversion.
- Lyrics guided by topic, genre, vibe, mood, vocal range, writing style, instrumentation, and structure.
- Bracketed sections and separate chronological production cues, with instrumental-only intros checked on the server.
- Separate revision and brand-new-song actions. New songs use the previous song as an avoidance reference; repeated titles and substantial repeated lines trigger a retry.
- Automatically saved, browser-private cloud library with type filters and reopening of past creations.

## Technologies

TanStack Start, React 19, TypeScript, Vite, CSS, Lucide icons, and Streamdown provide the interface. Modern Netlify Functions call the Google GenAI SDK through Netlify AI Gateway. Netlify Database with Drizzle ORM stores creation records; Netlify Blobs stores generated image files.

## Local development

Use Node.js 22 or newer and pnpm. Link the repository to a Netlify project with AI Gateway enabled, then run:

```sh
pnpm install
netlify dev --port 8889
```

The Netlify Vite integration supplies local platform services. AI Gateway needs an initial production deployment and available Netlify credits. Credentials belong exclusively in the server runtime; never add keys to browser code. No personal provider key is needed with Netlify’s injected gateway configuration.

## Database and deployment

The schema lives in `db/schema.ts`. Generate migrations after schema changes:

```sh
pnpm exec drizzle-kit generate --name describe_the_change
```

Migration files are written to `netlify/database/migrations` and applied automatically by Netlify during deployment. Do not manually push or apply schema changes. The deployment pipeline runs the configured build and publishes `dist/client`.

## Boundaries and privacy

Cloud-powered means server-side AI inference, not live web search or retrieval from personal cloud documents. Responses rely on model knowledge. Vocal pitch is a songwriting instruction; this app does not synthesize vocals or music.

Natural writing, logical storytelling, and fresh cadence are guided through detailed instructions and a self-review prompt, but AI quality and originality cannot be guaranteed. Mechanical validation checks section formatting, intro restrictions, repeated titles, and exact substantial repeated lines; it cannot prove that metaphors or cadence are original.

An opaque, HTTP-only, same-site cookie scopes creations to the current browser. Ownership is checked on every record and image request, and the cookie identifier is never included in API response data. This is not a login system: clearing cookies removes access, there is no cross-device sync, and people using the same browser profile share the workspace. The library shows the latest 60 saved snapshots; older records remain stored. Chat sends the latest eight exchanges as model context while retaining the full conversation in saved snapshots.

Generation consumes the site’s Netlify credits. The function includes platform IP/domain rate rules; monitor usage and add account-based quotas or authentication before opening a high-traffic public service. Functions report friendly failures without exposing credentials or internal error details. Image generation may require a retry if it exceeds the function timeout.
