import handler from '@tanstack/react-start/server-entry'
import { handleApi } from './server/api'
import type { Env } from './server/env'

export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env)
    return handler.fetch(request)
  },
}
