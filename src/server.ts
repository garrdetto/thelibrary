import handler from '@tanstack/react-start/server-entry'
import { handleApi } from './server/api'
import type { Env } from './server/env'

export { MapleStreetWorld } from './server/maplestreet-world'
export { AnglerLake } from './server/angler-lake'
export { BushLeagueMatch } from './server/bushleague-match'
export { HoodLot } from './server/hood-lot'
export { DartsRoom } from './server/darts-room'

export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env)
    return handler.fetch(request)
  },
}
