const cwd = import.meta.dirname
const tunnelName = process.env.AXIOM_TUNNEL_NAME || 'axiom-radar'

export const apps = [
  {
    name: 'axiom-worker',
    cwd,
    script: 'node_modules/tsx/dist/cli.mjs',
    args: 'scripts/axiom-tracker/index.ts',
    interpreter: 'node',
    autorestart: true,
    exp_backoff_restart_delay: 2000,
    max_restarts: 50,
    kill_timeout: 10000,
    max_memory_restart: '1500M',
    time: true,
    env: { NODE_ENV: 'production' },
  },
  {
    name: 'axiom-tunnel',
    cwd,
    script: 'cloudflared',
    args: `tunnel --no-autoupdate run ${tunnelName}`,
    interpreter: 'none',
    autorestart: true,
    restart_delay: 5000,
    time: true,
  },
]

export default { apps }
