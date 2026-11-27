import { z } from 'zod'
import type { Env } from '../env'
import { HttpError, json, parseStored, readJson, requireSameOrigin } from '../http'
import { currentUser, safeEqual } from '../auth'

const DEFAULT_REPO = 'garrdetto/thelibrary'
const WORKFLOW = 'site-change.yml'
const ACTIVE = ['queued', 'running']
const HISTORY_TURNS = 12
const ORG_SPEND_TTL = 5 * 60 * 1000
const DEFAULT_LAPTOP_LABEL = 'msi-laptop'
const RUNNER_STATUS_TTL = 30 * 1000

type Runner = 'github' | 'laptop'
type LaptopStatus = 'online' | 'busy' | 'offline' | 'missing' | 'unknown'

type Row = {
  id: string
  thread_id: string
  mode: string
  request: string
  target: string | null
  auto_merge: number
  status: string
  progress: string | null
  reply: string | null
  cost_usd: number | null
  billing: string | null
  commit_sha: string | null
  pr_url: string | null
  run_url: string | null
  runner: string | null
  created_at: number
  updated_at: number
}

const shape = (row: Row) => ({
  id: row.id,
  threadId: row.thread_id,
  mode: row.mode,
  request: row.request,
  target: row.target,
  autoMerge: row.auto_merge === 1,
  status: row.status,
  progress: row.progress,
  reply: row.reply,
  costUsd: row.cost_usd,
  billing: row.billing,
  commit: row.commit_sha,
  prUrl: row.pr_url,
  runUrl: row.run_url,
  runner: row.runner === 'laptop' ? 'laptop' : 'github',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const adminInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), thread: z.string().uuid().optional(), text: z.string().trim().min(1).max(8000), autoMerge: z.boolean(), runner: z.enum(['github', 'laptop']).optional() }).strict(),
  z.object({ action: z.literal('revert'), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('retry'), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('stop'), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('set-runner'), runner: z.enum(['github', 'laptop']) }).strict(),
  z.object({ action: z.literal('set-balance'), dollars: z.number().min(0).max(1000000) }).strict(),
  z.object({ action: z.literal('delete-thread'), thread: z.string().uuid() }).strict(),
])

// Runner reports are trimmed and nulls tolerated rather than rejected: a rejected
// final report used to leave a job "running" forever even after its change went live.
const clipped = (max: number) => z.string().transform(value => value.slice(0, max))
const reportInput = z.object({
  action: z.literal('report'),
  id: z.string().uuid(),
  status: z.enum(['running', 'merged', 'review', 'answered', 'failed']),
  progress: clipped(400).nullish(),
  reply: clipped(20000).nullish(),
  costUsd: z.number().min(0).max(10000).nullish(),
  billing: z.enum(['api', 'subscription']).nullish(),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/).nullish().catch(null),
  prUrl: z.string().url().max(300).nullish().catch(null),
  runUrl: z.string().url().max(300).nullish().catch(null),
})

let tablesReady = false
async function ensureTables(env: Env) {
  if (tablesReady) return
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS site_changes (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'change', request TEXT NOT NULL, target TEXT,
      auto_merge INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, progress TEXT, reply TEXT, cost_usd REAL, billing TEXT, commit_sha TEXT, pr_url TEXT, run_url TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS site_changes_thread_idx ON site_changes (thread_id, created_at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS site_changes_created_idx ON site_changes (created_at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS site_change_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
  ])
  const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('site_changes')").all<{ name: string }>()
  if (!columns.results.some(column => column.name === 'runner')) {
    try { await env.DB.prepare('ALTER TABLE site_changes ADD COLUMN runner TEXT').run() }
    catch (error) { if (!String(error).includes('duplicate column')) throw error }
  }
  tablesReady = true
}

async function getSetting(env: Env, key: string) {
  const row = await env.DB.prepare('SELECT value FROM site_change_settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare('INSERT INTO site_change_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, Date.now()).run()
}

function bearerMatches(request: Request, env: Env) {
  const secret = env.SITE_CHANGES_SECRET
  const supplied = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/)?.[1]
  return Boolean(secret && supplied && safeEqual(supplied, secret))
}

function monthStart(now = new Date()) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
}

async function organizationMonthSpend(env: Env) {
  const key = env.ANTHROPIC_ADMIN_KEY
  if (!key) return null
  const start = monthStart()
  const cached = await getSetting(env, 'org_month_spend')
  const previous = parseStored<{ cents: number; at: number; month: number } | null>(cached, null)
  if (previous && previous.month === start && Date.now() - previous.at < ORG_SPEND_TTL) return previous
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000)
  end.setUTCHours(0, 0, 0, 0)
  let cents = 0
  let page: string | null = null
  for (let guard = 0; guard < 6; guard++) {
    const url = new URL('https://api.anthropic.com/v1/organizations/cost_report')
    url.searchParams.set('starting_at', new Date(start).toISOString().replace(/\.\d{3}Z$/, 'Z'))
    url.searchParams.set('ending_at', end.toISOString().replace(/\.\d{3}Z$/, 'Z'))
    url.searchParams.set('bucket_width', '1d')
    url.searchParams.set('limit', '31')
    if (page) url.searchParams.set('page', page)
    const response = await fetch(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'thelibrary-site-changes/1.0' } })
    if (!response.ok) {
      console.error('Cost report failed', response.status)
      return null
    }
    const body = await response.json() as { data?: { results?: { amount?: string | number }[] }[]; has_more?: boolean; next_page?: string | null }
    for (const bucket of body.data ?? []) for (const result of bucket.results ?? []) cents += Number(result.amount ?? 0) || 0
    if (!body.has_more || !body.next_page) break
    page = body.next_page
  }
  const value = { cents: Math.round(cents), at: Date.now(), month: start }
  await setSetting(env, 'org_month_spend', JSON.stringify(value))
  return value
}

async function credits(env: Env) {
  const balance = await getSetting(env, 'balance')
  const parsed = parseStored<{ cents: number; at: number } | null>(balance, null)
  const since = parsed?.at ?? 0
  const spent = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(cost_usd) AS runs FROM site_changes WHERE created_at >= ? AND COALESCE(billing, 'api') != 'subscription'")
    .bind(since).first<{ total: number; runs: number }>()
  const month = await env.DB.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM site_changes WHERE created_at >= ?').bind(monthStart()).first<{ total: number }>()
  const latest = await env.DB.prepare('SELECT billing FROM site_changes WHERE billing IS NOT NULL ORDER BY updated_at DESC LIMIT 1').first<{ billing: string }>()
  let organization: { cents: number; at: number } | null = null
  try { organization = await organizationMonthSpend(env) } catch (error) { console.error('Cost report failed', error) }
  const spentCents = Math.round((spent?.total ?? 0) * 100)
  return {
    balanceCents: parsed?.cents ?? null,
    balanceSetAt: parsed?.at ?? null,
    spentCents,
    runs: spent?.runs ?? 0,
    remainingCents: parsed ? parsed.cents - spentCents : null,
    monthCents: Math.round((month?.total ?? 0) * 100),
    billing: latest?.billing ?? null,
    organizationMonthCents: organization?.cents ?? null,
    organizationCheckedAt: organization?.at ?? null,
  }
}

function configuration(env: Env) {
  return {
    github: Boolean(env.SITE_CHANGES_GITHUB_TOKEN),
    secret: Boolean(env.SITE_CHANGES_SECRET),
    adminKey: Boolean(env.ANTHROPIC_ADMIN_KEY),
    repo: env.SITE_CHANGES_REPO ?? DEFAULT_REPO,
  }
}

const laptopLabel = (env: Env) => env.SITE_CHANGES_RUNNER_LABEL?.trim() || DEFAULT_LAPTOP_LABEL

async function savedRunner(env: Env): Promise<Runner> {
  return (await getSetting(env, 'runner')) === 'laptop' ? 'laptop' : 'github'
}

// Whether the self-hosted runner on the administrator's laptop is connected to
// GitHub. Listing runners needs "Administration: Read" on the token; without it
// the answer is 'unknown' and laptop runs are dispatched without the check.
let laptopCache: { status: LaptopStatus; at: number } | null = null
async function laptopStatus(env: Env): Promise<LaptopStatus> {
  if (!env.SITE_CHANGES_GITHUB_TOKEN) return 'unknown'
  if (laptopCache && Date.now() - laptopCache.at < RUNNER_STATUS_TTL) return laptopCache.status
  const repo = env.SITE_CHANGES_REPO ?? DEFAULT_REPO
  let status: LaptopStatus = 'unknown'
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/runners?per_page=100`, {
      headers: {
        Authorization: `Bearer ${env.SITE_CHANGES_GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thelibrary-site-changes',
      },
    })
    if (response.ok) {
      const body = await response.json() as { runners?: { status?: string; busy?: boolean; labels?: { name?: string }[] }[] }
      const label = laptopLabel(env).toLowerCase()
      const matches = (body.runners ?? []).filter(runner => runner.labels?.some(item => item.name?.toLowerCase() === label))
      const online = matches.filter(runner => runner.status === 'online')
      status = !matches.length ? 'missing' : !online.length ? 'offline' : online.some(runner => !runner.busy) ? 'online' : 'busy'
    } else if (response.status !== 403) {
      console.error('Runner list failed', response.status)
    }
  } catch (error) {
    console.error('Runner list failed', error)
  }
  laptopCache = { status, at: Date.now() }
  return status
}

// Picks where a job runs. A laptop that GitHub reports offline (or that was
// never set up) falls back to GitHub's own machines so the request still runs.
async function chooseRunner(env: Env, wanted: Runner) {
  if (wanted === 'github') return { runner: 'github' as Runner, notice: null }
  const status = await laptopStatus(env)
  if (status === 'offline') return { runner: 'github' as Runner, notice: 'Your laptop is offline, so this request is running on GitHub instead.' }
  if (status === 'missing') return { runner: 'github' as Runner, notice: `No laptop runner labelled "${laptopLabel(env)}" is set up yet, so this request is running on GitHub instead.` }
  return { runner: 'laptop' as Runner, notice: null }
}

async function dispatch(request: Request, env: Env, id: string, runner: Runner) {
  if (!env.SITE_CHANGES_GITHUB_TOKEN || !env.SITE_CHANGES_SECRET) return 'Site changes are not set up yet. Add the SITE_CHANGES_GITHUB_TOKEN and SITE_CHANGES_SECRET secrets.'
  const repo = env.SITE_CHANGES_REPO ?? DEFAULT_REPO
  const callback = `${new URL(request.url).origin}/api/site-changes`
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SITE_CHANGES_GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thelibrary-site-changes',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { job_id: id, callback_url: callback, runner } }),
    })
    if (response.ok) return null
    console.error('Workflow dispatch failed', response.status)
    if (response.status === 401) return 'GitHub rejected the SITE_CHANGES_GITHUB_TOKEN. It may have expired.'
    if (response.status === 403) return 'The GitHub token needs "Actions: Read and write" permission on the repository.'
    if (response.status === 404) return `GitHub couldn't find .github/workflows/${WORKFLOW} on main in ${repo}.`
    if (response.status === 422) return 'GitHub refused to start the workflow. Check that it is enabled in the Actions tab.'
    return 'GitHub is unavailable right now. Try again in a moment.'
  } catch (error) {
    console.error('Workflow dispatch failed', error)
    return 'GitHub is unavailable right now. Try again in a moment.'
  }
}

async function queue(request: Request, env: Env, row: Pick<Row, 'thread_id' | 'mode' | 'request' | 'target' | 'auto_merge'>, wanted?: Runner) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const { runner, notice } = await chooseRunner(env, wanted ?? await savedRunner(env))
  await env.DB.prepare('INSERT INTO site_changes (id, thread_id, mode, request, target, auto_merge, status, runner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, row.thread_id, row.mode, row.request, row.target, row.auto_merge, 'queued', runner, now, now).run()
  const problem = await dispatch(request, env, id, runner)
  if (problem) await env.DB.prepare('UPDATE site_changes SET status = ?, reply = ?, updated_at = ? WHERE id = ?').bind('failed', problem, Date.now(), id).run()
  const saved = await env.DB.prepare('SELECT * FROM site_changes WHERE id = ?').bind(id).first<Row>()
  return { message: saved ? shape(saved) : null, notice: problem ? null : notice }
}

async function runnerOverview(env: Env) {
  const choice = await savedRunner(env)
  return { choice, laptop: await laptopStatus(env), label: laptopLabel(env) }
}

// Jobs whose workflow run ended without a final report (a rejected report, a run
// GitHub cancelled while it was still pending, a laptop that went to sleep) would
// otherwise stay queued/running forever and block the conversation. Each active job
// is checked against GitHub at most once a minute and closed out to match reality.
const RECONCILE_EVERY = 60 * 1000
const QUIET_BEFORE_CHECK = 3 * 60 * 1000
const NEVER_STARTED = 30 * 60 * 1000
const NEVER_STARTED_LAPTOP = 6 * 60 * 60 * 1000
const NO_UPDATE_LIMIT = 3 * 60 * 60 * 1000
const lastChecked = new Map<string, number>()

async function github<T>(env: Env, path: string): Promise<T | null> {
  if (!env.SITE_CHANGES_GITHUB_TOKEN) return null
  try {
    const response = await fetch(`https://api.github.com/repos/${env.SITE_CHANGES_REPO ?? DEFAULT_REPO}${path}`, {
      headers: {
        Authorization: `Bearer ${env.SITE_CHANGES_GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thelibrary-site-changes',
      },
    })
    return response.ok ? await response.json() as T : null
  } catch {
    return null
  }
}

type WorkflowRun = { id: number; status: string; conclusion: string | null; html_url: string; display_title?: string }

async function findRun(env: Env, row: Row): Promise<WorkflowRun | null> {
  const fromUrl = row.run_url?.match(/\/actions\/runs\/(\d+)/)?.[1]
  if (fromUrl) return github<WorkflowRun>(env, `/actions/runs/${fromUrl}`)
  const since = new Date(row.created_at - 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const list = await github<{ workflow_runs?: WorkflowRun[] }>(env, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=50&created=${encodeURIComponent(`>=${since}`)}`)
  return list?.workflow_runs?.find(run => run.display_title === `Site change ${row.id}`) ?? null
}

async function settle(env: Env, row: Row, status: string, reply: string, extra: { commit?: string | null; runUrl?: string | null } = {}) {
  const text = [row.reply?.trim(), reply].filter(Boolean).join('\n\n').slice(0, 20000)
  await env.DB.prepare(`UPDATE site_changes SET status = ?, progress = NULL, reply = ?, commit_sha = COALESCE(?, commit_sha), run_url = COALESCE(?, run_url), updated_at = ? WHERE id = ? AND status IN (${ACTIVE.map(() => '?').join(',')})`)
    .bind(status, text, extra.commit ?? null, extra.runUrl ?? null, Date.now(), row.id, ...ACTIVE).run()
}

async function reconcileRow(env: Env, row: Row) {
  const now = Date.now()
  if (now - row.updated_at < QUIET_BEFORE_CHECK) return
  if (now - (lastChecked.get(row.id) ?? 0) < RECONCILE_EVERY) return
  lastChecked.set(row.id, now)

  const prNumber = row.pr_url?.match(/\/pull\/(\d+)/)?.[1]
  if (prNumber) {
    const pr = await github<{ merged?: boolean; merge_commit_sha?: string | null; state?: string }>(env, `/pulls/${prNumber}`)
    if (pr?.merged) {
      await settle(env, row, 'merged', 'The pull request merged, so this change is live. (The run finished without reporting back, so this was confirmed from GitHub.)', { commit: pr.merge_commit_sha })
      if (row.mode === 'revert' && row.target) {
        await env.DB.prepare("UPDATE site_changes SET status = 'reverted', updated_at = ? WHERE commit_sha = ? AND mode = 'change'").bind(Date.now(), row.target).run()
      }
      return
    }
  }

  const run = await findRun(env, row)
  if (run && run.status === 'completed') {
    if (prNumber) {
      const pr = await github<{ state?: string }>(env, `/pulls/${prNumber}`)
      if (pr?.state === 'open') {
        await settle(env, row, 'review', 'The run finished and the pull request is still open. Nothing is live until it merges.', { runUrl: run.html_url })
        return
      }
      if (!pr) {
        // The token can't read pull requests, so don't guess: point at the pull request.
        await settle(env, row, 'review', 'The run finished without reporting back. Open the pull request to see whether it merged.', { runUrl: run.html_url })
        return
      }
    }
    const why = run.conclusion === 'cancelled'
      ? 'GitHub cancelled this run (usually because another request was queued behind it), so nothing was published. Press Try again to run it.'
      : 'The run finished without reporting back, and nothing was published. The run log on GitHub has the details.'
    await settle(env, row, 'failed', why, { runUrl: run.html_url })
    return
  }
  if (!run) {
    const limit = row.runner === 'laptop' ? NEVER_STARTED_LAPTOP : NEVER_STARTED
    if (row.status === 'queued' && now - row.created_at > limit) {
      await settle(env, row, 'failed', 'GitHub never started a run for this request, so nothing was published. Press Try again to run it.')
      return
    }
  }
  if (now - row.updated_at > NO_UPDATE_LIMIT) {
    await settle(env, row, 'failed', 'No progress was reported for three hours, so this stopped waiting. If a run is still going, cancel it from the Actions tab on GitHub.')
  }
}

async function reconcile(env: Env, threadId?: string) {
  const query = threadId
    ? env.DB.prepare(`SELECT * FROM site_changes WHERE thread_id = ? AND status IN (${ACTIVE.map(() => '?').join(',')})`).bind(threadId, ...ACTIVE)
    : env.DB.prepare(`SELECT * FROM site_changes WHERE status IN (${ACTIVE.map(() => '?').join(',')}) LIMIT 20`).bind(...ACTIVE)
  const rows = (await query.all<Row>()).results
  await Promise.all(rows.map(row => reconcileRow(env, row).catch(error => console.error('Site change reconcile failed', row.id, error))))
}

async function threadBusy(env: Env, threadId: string) {
  await reconcile(env, threadId)
  const active = await env.DB.prepare(`SELECT id FROM site_changes WHERE thread_id = ? AND status IN (${ACTIVE.map(() => '?').join(',')}) LIMIT 1`).bind(threadId, ...ACTIVE).first()
  return Boolean(active)
}

async function jobDetails(env: Env, id: string) {
  const row = await env.DB.prepare('SELECT * FROM site_changes WHERE id = ?').bind(id).first<Row>()
  if (!row) return json({ error: 'Job not found.' }, 404)
  const earlier = await env.DB.prepare("SELECT * FROM site_changes WHERE thread_id = ? AND created_at < ? AND status != 'failed' ORDER BY created_at DESC LIMIT ?")
    .bind(row.thread_id, row.created_at, HISTORY_TURNS).all<Row>()
  return json({
    id: row.id,
    mode: row.mode,
    request: row.request,
    target: row.target,
    autoMerge: row.auto_merge === 1,
    history: earlier.results.reverse().map(turn => ({ mode: turn.mode, request: turn.request, reply: (turn.reply ?? '').slice(0, 4000), status: turn.status, commit: turn.commit_sha })),
  })
}

async function report(env: Env, body: unknown) {
  const input = reportInput.parse(body)
  const row = await env.DB.prepare('SELECT * FROM site_changes WHERE id = ?').bind(input.id).first<Row>()
  if (!row) return json({ error: 'Job not found.' }, 404)
  const fields: [string, unknown][] = [['status', input.status]]
  if (input.progress != null) fields.push(['progress', input.progress])
  if (input.reply != null) fields.push(['reply', input.reply])
  if (input.costUsd != null) fields.push(['cost_usd', input.costUsd])
  if (input.billing != null) fields.push(['billing', input.billing])
  if (input.commit != null) fields.push(['commit_sha', input.commit])
  if (input.prUrl != null) fields.push(['pr_url', input.prUrl])
  if (input.runUrl != null) fields.push(['run_url', input.runUrl])
  if (input.status !== 'running') fields.push(['progress', null])
  fields.push(['updated_at', Date.now()])
  const unique = new Map(fields)
  await env.DB.prepare(`UPDATE site_changes SET ${[...unique.keys()].map(key => `${key} = ?`).join(', ')} WHERE id = ?`).bind(...unique.values(), row.id).run()
  if (row.mode === 'revert' && input.status === 'merged' && row.target) {
    await env.DB.prepare("UPDATE site_changes SET status = 'reverted', updated_at = ? WHERE commit_sha = ? AND mode = 'change'").bind(Date.now(), row.target).run()
  }
  return json({ ok: true })
}

async function threads(env: Env) {
  const rows = await env.DB.prepare(`SELECT s.thread_id AS id, MAX(s.updated_at) AS updated, COUNT(*) AS turns,
      (SELECT request FROM site_changes f WHERE f.thread_id = s.thread_id ORDER BY f.created_at LIMIT 1) AS title,
      (SELECT status FROM site_changes l WHERE l.thread_id = s.thread_id ORDER BY l.created_at DESC LIMIT 1) AS status
    FROM site_changes s GROUP BY s.thread_id ORDER BY updated DESC LIMIT 60`).all<{ id: string; updated: number; turns: number; title: string; status: string }>()
  return rows.results.map(row => ({ id: row.id, title: row.title.slice(0, 120), updatedAt: row.updated, turns: row.turns, status: row.status }))
}

export async function siteChanges(request: Request, env: Env) {
  await ensureTables(env)
  const url = new URL(request.url)

  if (bearerMatches(request, env)) {
    if (request.method === 'GET') {
      const job = url.searchParams.get('job')
      if (!job || !z.string().uuid().safeParse(job).success) return json({ error: 'Job not found.' }, 404)
      return jobDetails(env, job)
    }
    if (request.method === 'POST') return report(env, await readJson(request, 32768))
    return json({ error: 'Method not allowed.' }, 405)
  }

  const actor = await currentUser(request, env)
  if (!actor?.isAdmin) return json({ error: 'Administrator access required.' }, 403)

  if (request.method === 'GET') {
    const thread = url.searchParams.get('thread')
    if (thread) {
      if (!z.string().uuid().safeParse(thread).success) return json({ error: 'Conversation not found.' }, 404)
      await reconcile(env, thread)
      const rows = await env.DB.prepare('SELECT * FROM site_changes WHERE thread_id = ? ORDER BY created_at').bind(thread).all<Row>()
      return json({ messages: rows.results.map(shape) })
    }
    await reconcile(env)
    return json({ configured: configuration(env), threads: await threads(env), credits: await credits(env), runner: await runnerOverview(env) })
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  requireSameOrigin(request)
  const input = adminInput.parse(await readJson(request, 16384))

  if (input.action === 'send') {
    const threadId = input.thread ?? crypto.randomUUID()
    if (input.runner) await setSetting(env, 'runner', input.runner)
    const queued = await queue(request, env, { thread_id: threadId, mode: 'change', request: input.text, target: null, auto_merge: input.autoMerge ? 1 : 0 }, input.runner)
    return json({ thread: threadId, ...queued })
  }
  if (input.action === 'set-runner') {
    await setSetting(env, 'runner', input.runner)
    return json({ runner: await runnerOverview(env) })
  }
  if (input.action === 'set-balance') {
    await setSetting(env, 'balance', JSON.stringify({ cents: Math.round(input.dollars * 100), at: Date.now() }))
    return json({ credits: await credits(env) })
  }
  if (input.action === 'delete-thread') {
    if (await threadBusy(env, input.thread)) throw new HttpError(409, 'Wait for Claude to finish before deleting this conversation.')
    await env.DB.prepare('DELETE FROM site_changes WHERE thread_id = ?').bind(input.thread).run()
    return json({ ok: true })
  }

  const row = await env.DB.prepare('SELECT * FROM site_changes WHERE id = ?').bind(input.id).first<Row>()
  if (!row) throw new HttpError(404, 'Message not found.')

  if (input.action === 'stop') {
    if (!ACTIVE.includes(row.status)) throw new HttpError(400, 'That message has already finished.')
    await env.DB.prepare("UPDATE site_changes SET status = 'failed', progress = NULL, reply = ?, updated_at = ? WHERE id = ?")
      .bind(row.runner === 'laptop'
        ? 'Stopped waiting. If your laptop is still working on it, cancel the run from the Actions tab on GitHub.'
        : 'Stopped waiting. If a workflow run is still going, cancel it from the Actions tab on GitHub.', Date.now(), row.id).run()
    return json({ ok: true })
  }
  if (input.action === 'retry') {
    if (row.status !== 'failed') throw new HttpError(400, 'Only failed messages can be retried.')
    return json(await queue(request, env, { thread_id: row.thread_id, mode: row.mode, request: row.request, target: row.target, auto_merge: row.auto_merge }))
  }
  if (row.status !== 'merged' || !row.commit_sha) throw new HttpError(400, 'Only changes that went live can be undone.')
  const firstLine = row.request.split('\n')[0].slice(0, 160)
  return json(await queue(request, env, { thread_id: row.thread_id, mode: 'revert', request: `Undo the change for: ${firstLine}`, target: row.commit_sha, auto_merge: 1 }))
}
