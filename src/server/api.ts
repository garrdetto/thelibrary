import { z } from 'zod'
import type { Env } from './env'
import { HttpError, json } from './http'
import { accountSettings, poolAccount, workspaceAccess, workspaceAdmin } from './routes/account'
import { poolCueOverlay, poolPractice, poolPreferences } from './routes/pool'
import { racing } from './routes/racing'
import { fairway } from './routes/fairway'
import { angler } from './routes/angler'
import { anglerLake } from './routes/angler-lake'
import { park } from './routes/park'
import { parkRides } from './routes/park-rides'
import { maplestreet } from './routes/maplestreet'
import { maplestreetItems } from './routes/maplestreet-items'
import { maplestreetVehicles } from './routes/maplestreet-vehicles'
import { shorttrackCars } from './routes/shorttrack-cars'
import { maplestreetSuggest } from './routes/maplestreet-suggest'
import { meshy } from './routes/meshy'
import { groupChat } from './routes/chat'
import { moduleScores } from './routes/scores'
import { moduleLayout } from './routes/module-layout'
import { siteChanges } from './routes/site-changes'
import { songmaker } from './routes/songmaker'
import { asset, learning, library, lyricPresets, studio } from './routes/studio'

const routes: Record<string, (request: Request, env: Env) => Promise<Response>> = {
  '/api/pool-account': poolAccount,
  '/api/workspace-access': workspaceAccess,
  '/api/workspace-admin': workspaceAdmin,
  '/api/site-changes': siteChanges,
  '/api/account-settings': accountSettings,
  '/api/pool-practice': poolPractice,
  '/api/pool-preferences': poolPreferences,
  '/api/pool-cue-overlay': poolCueOverlay,
  '/api/racing': racing,
  '/api/fairway': fairway,
  '/api/angler': angler,
  '/api/angler-lake': anglerLake,
  '/api/park': park,
  '/api/park-rides': parkRides,
  '/api/maplestreet': maplestreet,
  '/api/maplestreet-items': maplestreetItems,
  '/api/maplestreet-vehicles': maplestreetVehicles,
  '/api/shorttrack-cars': shorttrackCars,
  '/api/maplestreet-suggest': maplestreetSuggest,
  '/api/meshy': meshy,
  '/api/group-chat': groupChat,
  '/api/module-scores': moduleScores,
  '/api/module-layout': moduleLayout,
  '/api/studio': studio,
  '/api/library': library,
  '/api/asset': asset,
  '/api/learning': learning,
  '/api/lyric-presets': lyricPresets,
  '/api/songmaker': songmaker,
}

export async function handleApi(request: Request, env: Env) {
  const route = routes[new URL(request.url).pathname]
  if (!route) return json({ error: 'Not found.' }, 404)
  try {
    return await route(request, env)
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: 'Please check your input and try again.' }, 400)
    const status = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0
    if (status === 429) return json({ error: 'The service is receiving too many requests. Please wait a moment and retry.' }, 429)
    console.error('API failure', new URL(request.url).pathname, error)
    return json({ error: 'The service is unavailable right now. Please try again shortly.' }, 503)
  }
}
