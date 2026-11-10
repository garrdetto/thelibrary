import { spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.argv[2]
const { JOB_ID = '', CALLBACK_URL = '', SITE_CHANGES_SECRET = '', RUN_URL = '', GITHUB_REPOSITORY = '' } = process.env
const STATE = join(process.env.RUNNER_TEMP ?? '/tmp', 'site-change-state.json')
const PROGRESS_EVERY = 8000
const DEFAULT_MODEL = 'claude-opus-5-5'

const SYSTEM = `You are Claude, working on "the library" website, whose repository is checked out in the current directory. The site's administrator is talking to you from the admin panel on the live site. Each message runs in a fresh GitHub Actions job; earlier turns of the conversation are included in the prompt.

How to work:
- Read AGENTS.md first and follow its conventions, platform rules and site rules.
- Do what the administrator asks completely, in the code. Do not commit, push, or create branches: the workflow opens a pull request with your edits after you finish, the "modules" check builds it, and merges to main deploy the site automatically.
- If you changed code, run \`pnpm build\` and fix every error before you finish.
- If the message is a question, or needs no code change, answer it without editing files.
- If the request is unclear, or would destroy data (dropping tables, deleting accounts or records, removing secrets), make no edits and ask one short clarifying question instead.
- Never read, print or change secrets, environment values or .env files.
- Schema changes go in a new numbered file in migrations/; the workflow applies them.
- Blender is available on the administrator's laptop runner (not on GitHub's machines): build or clean up models with \`blender -b -P <script.py> -- <args>\` (the modules' tools/build-*.py scripts work this way), write exports to assets-src/models/, then run \`pnpm assets\`. If \`blender\` is not found, say so in your reply instead of skipping the model.

3D models (Meshy):
- When the administrator asks for a 3D object, character or animation the site doesn't have, generate it with Meshy. Each model costs Meshy credits, so only generate what the request needs. There are two ways in:
  - When MESHY_API_KEY is set in your environment, use \`node scripts/meshy-generate.mjs\` (run it with --help for every option; docs/MESHY-PIPELINE.md explains the pipeline). It runs preview, refine, rig and animate in one command and then cleans the model up in Blender when Blender is installed. Example: \`node scripts/meshy-generate.mjs --prompt "a weathered red barn, game asset" --name barn --out assets-src/models/maplestreet/town --target furniture --size 12\`. Run the command with --dry-run first to see the credit estimate. A real run takes several minutes; give it a 20-minute timeout. If it is interrupted, run the identical command again and it resumes without paying twice. Meshy rigs and animates only two-legged humanoid characters (\`--target character --rig --height <m> --animate idle,walk,…\`; \`--list-animations\` shows the clips).
  - Otherwise use the site's own Meshy connection: \`node .github/site-changes/meshy.mjs generate "<prompt>" --out assets-src/models/<module>/<name>.glb\` (add \`--preview\` for an untextured draft, \`--polycount N\` to change detail). For a character use \`--target character\`, then animate it: \`meshy.mjs animations "walk"\` lists ready-made clips with their ids, \`meshy.mjs rig <jobId> --out <file>.glb\` rigs the finished model (each command prints the \`job <id>\` the next one takes), and \`meshy.mjs animate <rigJobId> --action <id> --label "Walk" --out <file>.glb\` makes one clip per call. Everything also appears in the admin Meshy panel; \`node .github/site-changes/meshy.mjs balance\` shows the credits left. When Blender is installed, clean the download up with \`blender -b --factory-startup -P scripts/blender/meshy-cleanup.py -- --input <downloaded.glb> --out assets-src/models/<module> --name <name> [--size <m> | --height <m>] [--max-tris N]\` (keep the raw download outside assets-src/models/, e.g. in .meshy-cache/).
- Write original prompts: describe shape, materials and colours, add "game asset", and leave out brands, logos, real people, and characters from films or games.
- Animate everything that isn't a humanoid character (vehicles, rides, props, animals, spinning or bobbing objects) in the module's code.
- Afterwards run \`pnpm assets\`, load the file from public/models/ the way that module already loads models (docs/ENGINE-MAP.md), set its scale, position and collision, and play clips by their names. Keep the new .glb (and its .meshy.json record when meshy-generate.mjs made one) and the public/models/ output in the change.
- If Blender wasn't available, size and place the model in code. Don't fake a model with primitive shapes unless the administrator asks.
- In your reply, say what was generated, where to see it on the site, and how many Meshy credits it used.

Your final message is shown to the administrator as your chat reply. Write it in plain language for someone who is not a developer: what you changed (or your answer, or your question), where to see it on the site, and anything they need to do. Keep it short and do not include code unless they asked for it.`

const TOOLS = [
  'Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep', 'TodoWrite', 'WebSearch', 'WebFetch',
  'Bash(pnpm:*)', 'Bash(bun:*)', 'Bash(node:*)', 'Bash(blender:*)', 'Bash(npx tsc:*)', 'Bash(ls:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(pnpm *)', 'Bash(bun *)', 'Bash(node *)', 'Bash(blender *)', 'Bash(npx tsc *)', 'Bash(ls *)', 'Bash(git diff *)', 'Bash(git status *)', 'Bash(git log *)', 'Bash(git show *)',
].join(',')

function loadState() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
}

function saveState(state) {
  writeFileSync(STATE, JSON.stringify(state))
}

function redact(text) {
  let clean = text
  for (const key of ['GH_TOKEN', 'SITE_CHANGES_SECRET', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLOUDFLARE_API_TOKEN']) {
    const value = process.env[key]
    if (value && value.length > 8) clean = clean.split(value).join('[hidden]')
  }
  return clean.replace(/x-access-token:[^@\s"]+@/g, '')
}

async function report(body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(CALLBACK_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SITE_CHANGES_SECRET}`, 'Content-Type': 'application/json' },
        body: redact(JSON.stringify({ action: 'report', id: JOB_ID, runUrl: RUN_URL, ...body })),
      })
      if (response.ok) return true
      console.log(`Status report returned ${response.status}`)
      if (response.status < 500) return false
    } catch (error) {
      console.log(`Status report failed: ${error.message}`)
    }
    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)))
  }
  return false
}

async function fail(message, extra = {}) {
  const state = loadState()
  saveState({ ...state, reported: true })
  await report({ status: 'failed', reply: message, ...extra })
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function git(...args) {
  const result = run('git', args)
  if (!result.ok) throw new Error(`git ${args[0]} failed:\n${result.output.slice(-2000)}`)
  return result.output.trim()
}

function tail(text, lines = 25) {
  return text.trim().split('\n').slice(-lines).join('\n').slice(-3000)
}

function describeTool(name, input = {}) {
  const file = String(input.file_path ?? input.path ?? input.notebook_path ?? '').replace(`${process.cwd()}/`, '')
  if (['Edit', 'MultiEdit', 'Write'].includes(name)) return `Editing ${file || 'files'}`
  if (name === 'Read') return `Reading ${file || 'files'}`
  if (name === 'Grep' || name === 'Glob') return 'Searching the code'
  if (name === 'Bash') {
    const command = String(input.command ?? '')
    if (/\bpnpm (run )?build\b/.test(command)) return 'Building the site to check for errors'
    if (/meshy-generate\.mjs/.test(command)) return /--dry-run|--list-animations|--help/.test(command) ? 'Planning a 3D model' : 'Generating a 3D model with Meshy (this takes a few minutes)'
    if (/\bpnpm (run )?assets\b/.test(command)) return 'Optimising 3D models'
    if (/^blender\b/.test(command)) return 'Working on a model in Blender'
    return `Running ${command.split('\n')[0].slice(0, 90)}`
  }
  if (name === 'WebSearch' || name === 'WebFetch') return 'Looking something up'
  if (name === 'TodoWrite') return 'Planning the steps'
  return `Using ${name}`
}

function outcomeLabel(turn) {
  if (turn.status === 'merged') return `went live${turn.commit ? ` in commit ${turn.commit.slice(0, 7)}` : ''}`
  if (turn.status === 'reverted') return 'went live, then was undone'
  if (turn.status === 'review') return 'opened as a pull request for review'
  if (turn.status === 'answered') return 'no files changed'
  return turn.status
}

function buildPrompt(job) {
  const history = job.history.map(turn => turn.mode === 'revert'
    ? `Administrator asked to undo commit ${turn.commit ?? ''}. Outcome: ${outcomeLabel(turn)}.`
    : `Administrator: ${turn.request}\n\nYou replied: ${turn.reply || '(no reply)'}\n(Outcome: ${outcomeLabel(turn)}.)`)
  return [
    history.length ? `[Earlier in this conversation]\n\n${history.join('\n\n---\n\n')}` : '',
    `[New message from the administrator]\n\n${job.request}`,
  ].filter(Boolean).join('\n\n')
}

async function askClaude() {
  if (!/^[0-9a-f-]{36}$/.test(JOB_ID)) throw new Error('Invalid job id.')
  if (!/^https:\/\/[^/]+\/api\/site-changes$/.test(CALLBACK_URL)) throw new Error('The callback URL must be the site\'s https /api/site-changes endpoint.')
  if (!SITE_CHANGES_SECRET) throw new Error('The SITE_CHANGES_SECRET repository secret is missing.')

  const response = await fetch(`${CALLBACK_URL}?job=${JOB_ID}`, { headers: { Authorization: `Bearer ${SITE_CHANGES_SECRET}` } })
  if (!response.ok) throw new Error(`The site returned ${response.status} for this job. Check that SITE_CHANGES_SECRET matches on GitHub and Cloudflare.`)
  const job = await response.json()
  const localLogin = process.env.SITE_CHANGES_LOCAL_LOGIN === '1'
  const billing = process.env.ANTHROPIC_API_KEY ? 'api' : process.env.CLAUDE_CODE_OAUTH_TOKEN || localLogin ? 'subscription' : null
  saveState({ job, billing })

  if (job.mode === 'revert') {
    await report({ status: 'running', progress: 'Undoing the earlier change' })
    saveState({ job, billing, reply: `I undid that change (commit ${String(job.target).slice(0, 7)}).` })
    return
  }
  if (!billing) await fail('Add an ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) secret to the GitHub repository so Claude can run.')

  await report({ status: 'running', progress: 'Reading the code', billing })

  const env = { ...process.env }
  if (SITE_CHANGES_SECRET && CALLBACK_URL && JOB_ID) {
    env.SITE_URL = new URL(CALLBACK_URL).origin
    env.SITE_MESHY_TOKEN = `sc.${JOB_ID}.${createHmac('sha256', SITE_CHANGES_SECRET).update(`meshy:${JOB_ID}`).digest('hex')}`
  }
  for (const key of ['SITE_CHANGES_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN', 'CALLBACK_URL', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) delete env[key]
  env.BASH_DEFAULT_TIMEOUT_MS ??= String(10 * 60 * 1000)
  env.BASH_MAX_TIMEOUT_MS ??= String(30 * 60 * 1000)
  const args = ['-p', buildPrompt(job), '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS, '--append-system-prompt', SYSTEM, '--max-turns', '150']
  args.push('--model', process.env.SITE_CHANGES_MODEL?.trim() || DEFAULT_MODEL)

  const result = await new Promise((resolve, reject) => {
    const child = spawn('claude', args, { env, stdio: ['ignore', 'pipe', 'inherit'] })
    let buffer = ''
    let lastText = ''
    let progress = 'Reading the code'
    let lastSent = Date.now()
    let final = null
    const flush = () => {
      if (Date.now() - lastSent < PROGRESS_EVERY) return
      lastSent = Date.now()
      void report({ status: 'running', progress, billing })
    }
    child.stdout.on('data', chunk => {
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let event
        try { event = JSON.parse(line) } catch { continue }
        if (event.type === 'assistant') {
          for (const part of event.message?.content ?? []) {
            if (part.type === 'text' && part.text.trim()) lastText = part.text.trim()
            if (part.type === 'tool_use') {
              progress = describeTool(part.name, part.input)
              console.log(`• ${progress}`)
            }
          }
          flush()
        }
        if (event.type === 'result') final = event
      }
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code, final, lastText }))
  })

  const reply = (result.final?.result ?? result.lastText ?? '').trim()
  const costUsd = typeof result.final?.total_cost_usd === 'number' ? result.final.total_cost_usd : undefined
  saveState({ job, billing, reply, costUsd })
  if (!result.final || result.final.is_error || result.code !== 0) {
    const why = result.final?.subtype === 'error_max_turns' ? 'Claude ran out of steps before finishing.'
      : localLogin && !result.final ? 'Claude couldn\'t start on your laptop. Open Ubuntu, run `claude`, sign in with /login, then try again.'
      : 'Claude stopped with an error.'
    await fail(`${why} Nothing was published.${reply ? `\n\n${reply}` : ''}`, { costUsd, billing })
  }
  await report({ status: 'running', progress: 'Checking the build', costUsd, billing })
}

async function publish() {
  const state = loadState()
  const { job, billing, costUsd } = state
  let reply = state.reply || 'Done.'
  const base = { costUsd, billing }
  git('config', 'user.name', 'Claude (site changes)')
  git('config', 'user.email', '41898283+github-actions[bot]@users.noreply.github.com')

  if (job.mode === 'revert') {
    const reverted = run('git', ['revert', '--no-edit', job.target])
    if (!reverted.ok) await fail(`I couldn't undo commit ${String(job.target).slice(0, 7)} automatically because later changes touch the same code. Ask me in a new message to undo it by hand.`, base)
  } else {
    const changed = git('status', '--porcelain').split('\n').filter(line => line && !line.endsWith('pnpm-lock.yaml'))
    if (!changed.length) {
      run('git', ['checkout', '--', '.'])
      saveState({ ...state, reported: true })
      await report({ status: 'answered', reply, ...base })
      return
    }
  }

  await report({ status: 'running', progress: 'Building the site for publishing', ...base })
  const build = run('pnpm', ['build'])
  const branch = `site-change/${JOB_ID.slice(0, 8)}`
  if (process.env.GH_TOKEN) git('remote', 'set-url', 'origin', `https://x-access-token:${process.env.GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`)

  if (job.mode !== 'revert') {
    git('add', '-A')
    const title = `Site change: ${job.request.split('\n')[0].slice(0, 64)}`
    git('commit', '-m', title, '-m', `${reply.slice(0, 3000)}\n\nRequested from the admin panel (job ${JOB_ID}).\n\nCo-Authored-By: Claude <noreply@anthropic.com>`)
  }

  if (!build.ok) {
    run('git', ['push', '--force', 'origin', `HEAD:refs/heads/${branch}`])
    await fail(`${reply}\n\nThe site didn't build after these edits, so nothing went live. The work is saved on the branch ${branch}. Build output:\n\n${tail(build.output)}`, base)
  }

  const added = run('git', ['diff', '--name-only', '--diff-filter=A', 'HEAD~1', 'HEAD']).output.split('\n')
  const changedFiles = run('git', ['diff', '--name-only', 'HEAD~1', 'HEAD']).output.split('\n')
  const newMigrations = added.some(file => /^migrations\/.+\.sql$/.test(file))
  const touchesServer = changedFiles.some(file => file.startsWith('server/'))
  const notes = []

  const pushed = run('git', ['push', '--force', 'origin', `HEAD:refs/heads/${branch}`])
  if (!pushed.ok) await fail(`${reply}\n\nGitHub refused the push:\n\n${tail(pushed.output, 10)}`, base)
  const title = job.mode === 'revert' ? `Undo ${String(job.target).slice(0, 7)}` : `Site change: ${job.request.split('\n')[0].slice(0, 64)}`
  const created = run('gh', ['pr', 'create', '--repo', GITHUB_REPOSITORY, '--base', 'main', '--head', branch, '--title', title, '--body', `${reply}\n\nRequested from the admin panel (job ${JOB_ID}).`])
  const prUrl = created.ok ? created.output.trim().split('\n').pop() : `https://github.com/${GITHUB_REPOSITORY}/compare/main...${branch}?expand=1`
  if (!created.ok) notes.push('GitHub Actions isn\'t allowed to open pull requests here, so use the review link to open it yourself (or turn on "Allow GitHub Actions to create and approve pull requests" in the repository\'s Actions settings).')
  if (newMigrations) notes.push('After this merges, apply the database change with `pnpm exec wrangler d1 migrations apply thelibrary-db --remote`.')
  if (touchesServer) notes.push('This touches the multiplayer service, so it goes live after Railway redeploys.')

  if (job.autoMerge && created.ok) {
    await report({ status: 'running', progress: 'Waiting for the modules check, then merging', prUrl, ...base })
    const outcome = await mergeWhenGreen(prUrl)
    if (outcome.merged) {
      if (newMigrations && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
        const applied = run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'thelibrary-db', '--remote'])
        notes.push(applied.ok ? 'I applied the database change too.' : 'The database change still needs applying: run `pnpm exec wrangler d1 migrations apply thelibrary-db --remote`.')
      }
      notes.push('The site updates as soon as Cloudflare finishes deploying, usually within a couple of minutes.')
      saveState({ ...state, reported: true })
      await report({ status: 'merged', reply: [reply, ...notes].join('\n\n'), prUrl, commit: outcome.commit, ...base })
      return
    }
    notes.push(outcome.note)
  } else {
    notes.push('Nothing is live until you merge it.')
  }
  saveState({ ...state, reported: true })
  await report({ status: 'review', reply: [reply, ...notes].join('\n\n'), prUrl, commit: git('rev-parse', 'HEAD'), ...base })
}

// Merges the pull request (squash) once the `modules` check passes. GitHub's
// auto-merge waits for the check when a branch rule on main requires it;
// without such a rule GitHub refuses auto-merge, so this run watches the check
// and merges itself. The mutation is called directly because `gh pr merge
// --auto` merges at once, before any check has run, when nothing blocks it.
// Returns { merged: true, commit } or { merged: false, note } saying why not.
const MERGE_WAIT_MS = Number(process.env.SITE_CHANGES_MERGE_WAIT_MS ?? 20 * 60 * 1000)
const ENABLE_AUTO_MERGE = 'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { clientMutationId } }'

function pullRequest(prUrl) {
  const view = run('gh', ['pr', 'view', prUrl, '--json', 'id,state,mergeCommit,headRefOid'])
  if (!view.ok) return null
  try {
    return JSON.parse(view.output)
  } catch {
    return null
  }
}

function modulesCheck(sha) {
  const checks = run('gh', ['api', `repos/${GITHUB_REPOSITORY}/commits/${sha}/check-runs?check_name=modules`])
  if (!checks.ok) return 'pending'
  try {
    const runs = JSON.parse(checks.output).check_runs ?? []
    if (!runs.length || runs.some(check => check.status !== 'completed')) return 'pending'
    return runs.every(check => check.conclusion === 'success') ? 'passed' : 'failed'
  } catch {
    return 'pending'
  }
}

async function mergeWhenGreen(prUrl) {
  const opened = pullRequest(prUrl)
  const auto = opened
    ? run('gh', ['api', 'graphql', '-f', `query=${ENABLE_AUTO_MERGE}`, '-f', `id=${opened.id}`])
    : { ok: false, output: 'The pull request could not be read.' }
  if (!auto.ok) console.log(`Auto-merge is unavailable, so this run merges once the modules check passes: ${tail(auto.output, 5)}`)
  const deadline = Date.now() + MERGE_WAIT_MS
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 20000))
    const info = pullRequest(prUrl)
    if (info?.state === 'MERGED') return { merged: true, commit: info.mergeCommit?.oid ?? null }
    if (info?.state === 'CLOSED') return { merged: false, note: 'The pull request was closed before it merged, so nothing went live.' }
    if (Date.now() >= deadline) break
    if (!info || auto.ok) continue
    const check = modulesCheck(info.headRefOid)
    if (check === 'failed') return { merged: false, note: 'The `modules` check failed, so nothing went live. The pull request shows why.' }
    if (check !== 'passed') continue
    const merged = run('gh', ['pr', 'merge', prUrl, '--squash'])
    if (!merged.ok) return { merged: false, note: `The \`modules\` check passed, but GitHub wouldn't merge the pull request:\n\n${tail(merged.output, 5)}` }
  }
  if (auto.ok) return { merged: false, note: 'Automatic merge is switched on: the pull request merges itself as soon as the `modules` check passes. If the check fails, nothing goes live and the pull request shows why.' }
  return { merged: false, note: `The \`modules\` check hadn't finished after ${Math.round(MERGE_WAIT_MS / 60000)} minutes, so the pull request is still open. Nothing is live until it's merged.` }
}

async function reportFailure() {
  const state = loadState()
  if (state.reported) return
  await report({ status: 'failed', reply: 'Something went wrong while running this request, and nothing was published. The run log on GitHub has the details.', costUsd: state.costUsd, billing: state.billing })
}

try {
  if (phase === 'claude') await askClaude()
  else if (phase === 'publish') await publish()
  else if (phase === 'failed') await reportFailure()
  else throw new Error(`Unknown phase ${phase}`)
} catch (error) {
  console.error(error)
  if (phase !== 'failed') await fail(`Something went wrong and nothing was published: ${error.message}`.slice(0, 3000), { costUsd: loadState().costUsd, billing: loadState().billing })
  process.exit(1)
}
