import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const phase = process.argv[2]
const { JOB_ID = '', CALLBACK_URL = '', SITE_CHANGES_SECRET = '', RUN_URL = '', GITHUB_REPOSITORY = '' } = process.env
const STATE = join(process.env.RUNNER_TEMP ?? '/tmp', 'site-change-state.json')
const PROGRESS_EVERY = 8000

const SYSTEM = `You are Claude, working on "the library" website, whose repository is checked out in the current directory. The site's administrator is talking to you from the admin panel on the live site. Each message runs in a fresh GitHub Actions job; earlier turns of the conversation are included in the prompt.

How to work:
- Read AGENTS.md first and follow its conventions, platform rules and site rules.
- Do what the administrator asks completely, in the code. Do not commit, push, or create branches: the workflow publishes your edits after you finish, and pushes to main deploy the site automatically.
- If you changed code, run \`pnpm build\` and fix every error before you finish.
- If the message is a question, or needs no code change, answer it without editing files.
- If the request is unclear, or would destroy data (dropping tables, deleting accounts or records, removing secrets), make no edits and ask one short clarifying question instead.
- Never read, print or change secrets, environment values or .env files.
- Schema changes go in a new numbered file in apps/platform/migrations/; the workflow applies them.

Your final message is shown to the administrator as your chat reply. Write it in plain language for someone who is not a developer: what you changed (or your answer, or your question), where to see it on the site, and anything they need to do. Keep it short and do not include code unless they asked for it.`

const TOOLS = [
  'Read', 'Edit', 'MultiEdit', 'Write', 'Glob', 'Grep', 'TodoWrite', 'WebSearch', 'WebFetch',
  'Bash(pnpm:*)', 'Bash(bun:*)', 'Bash(node:*)', 'Bash(npx tsc:*)', 'Bash(ls:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git show:*)',
  'Bash(pnpm *)', 'Bash(bun *)', 'Bash(node *)', 'Bash(npx tsc *)', 'Bash(ls *)', 'Bash(git diff *)', 'Bash(git status *)', 'Bash(git log *)', 'Bash(git show *)',
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
  const billing = process.env.ANTHROPIC_API_KEY ? 'api' : process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'subscription' : null
  saveState({ job, billing })

  if (job.mode === 'revert') {
    await report({ status: 'running', progress: 'Undoing the earlier change' })
    saveState({ job, billing, reply: `I undid that change (commit ${String(job.target).slice(0, 7)}).` })
    return
  }
  if (!billing) await fail('Add an ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN) secret to the GitHub repository so Claude can run.')

  await report({ status: 'running', progress: 'Reading the code', billing })

  const env = { ...process.env }
  for (const key of ['SITE_CHANGES_SECRET', 'GH_TOKEN', 'GITHUB_TOKEN', 'CALLBACK_URL', 'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) delete env[key]
  const args = ['-p', buildPrompt(job), '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', TOOLS, '--append-system-prompt', SYSTEM, '--max-turns', '150']
  if (process.env.SITE_CHANGES_MODEL) args.push('--model', process.env.SITE_CHANGES_MODEL)

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
    const why = result.final?.subtype === 'error_max_turns' ? 'Claude ran out of steps before finishing.' : 'Claude stopped with an error.'
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
  const newMigrations = added.some(file => /^apps\/platform\/migrations\/.+\.sql$/.test(file))
  const touchesServer = changedFiles.some(file => file.startsWith('server/'))
  const notes = []

  if (job.autoMerge) {
    let pushed = run('git', ['push', 'origin', 'HEAD:main'])
    if (!pushed.ok) {
      const rebased = run('git', ['pull', '--rebase', 'origin', 'main'])
      if (!rebased.ok) {
        run('git', ['rebase', '--abort'])
        run('git', ['push', '--force', 'origin', `HEAD:refs/heads/${branch}`])
        await fail(`${reply}\n\nSomeone else changed the same code on main at the same time, so nothing went live. The work is saved on the branch ${branch}.`, base)
      }
      pushed = run('git', ['push', 'origin', 'HEAD:main'])
      if (!pushed.ok) await fail(`${reply}\n\nGitHub refused the push to main:\n\n${tail(pushed.output, 10)}`, base)
    }
    if (newMigrations) {
      if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
        const applied = run('pnpm', ['run', 'db:migrate'])
        notes.push(applied.ok ? 'I applied the database change too.' : 'The database change still needs applying: run `pnpm run db:migrate`.')
      } else {
        notes.push('This includes a database change. Apply it with `pnpm run db:migrate` (or add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID repository secrets so I can do it).')
      }
    }
    if (touchesServer) notes.push('This touches the multiplayer service, so it goes live after Railway redeploys.')
    notes.push('The site updates as soon as Cloudflare finishes deploying, usually within a couple of minutes.')
    saveState({ ...state, reported: true })
    await report({ status: 'merged', reply: [reply, ...notes].join('\n\n'), commit: git('rev-parse', 'HEAD'), ...base })
    return
  }

  const pushed = run('git', ['push', '--force', 'origin', `HEAD:refs/heads/${branch}`])
  if (!pushed.ok) await fail(`${reply}\n\nGitHub refused the push:\n\n${tail(pushed.output, 10)}`, base)
  const title = job.mode === 'revert' ? `Undo ${String(job.target).slice(0, 7)}` : `Site change: ${job.request.split('\n')[0].slice(0, 64)}`
  const created = run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', `${reply}\n\nRequested from the admin panel (job ${JOB_ID}).`])
  const prUrl = created.ok ? created.output.trim().split('\n').pop() : `https://github.com/${GITHUB_REPOSITORY}/compare/main...${branch}?expand=1`
  if (!created.ok) notes.push('GitHub Actions isn\'t allowed to open pull requests here, so use the review link to open it yourself (or turn on "Allow GitHub Actions to create and approve pull requests" in the repository\'s Actions settings).')
  if (newMigrations) notes.push('After merging, apply the database change with `pnpm run db:migrate`.')
  notes.push('Nothing is live until you merge it.')
  saveState({ ...state, reported: true })
  await report({ status: 'review', reply: [reply, ...notes].join('\n\n'), prUrl, commit: git('rev-parse', 'HEAD'), ...base })
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
