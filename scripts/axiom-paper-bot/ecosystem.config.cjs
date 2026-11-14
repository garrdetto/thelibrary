const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const run = path.join(__dirname, 'run.py')
const shared = { cwd: root, script: run, interpreter: 'python', autorestart: true, exp_backoff_restart_delay: 2000, max_restarts: 50, kill_timeout: 5000, time: true }
const env = process.env.AXIOM_BOT_ENV ? ['--env', process.env.AXIOM_BOT_ENV] : []

module.exports = {
  apps: [
    { ...shared, name: 'axiom-paper-bot', args: ['--no-dashboard', ...env] },
    { ...shared, name: 'axiom-bot-console', args: ['console', '--no-open'] },
  ],
}
