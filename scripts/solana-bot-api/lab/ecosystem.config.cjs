// Runs the ruleset search around the clock under PM2, from this folder:
//   pip install numpy websockets
//   pm2 start ecosystem.config.cjs && pm2 save
// recorder.py records every pump.fun launch and trade, processor.py scores finished coins,
// loop.py freezes a ruleset every 20 minutes and forward-tests every earlier freeze (loop.log, freezes/).
const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const common = { cwd: __dirname, interpreter: 'none', autorestart: true, max_restarts: 50, restart_delay: 5000 }
module.exports = {
  apps: [
    { ...common, name: 'axiom-lab-recorder', script: py, args: '-u recorder.py pump.db' },
    { ...common, name: 'axiom-lab-processor', script: py, args: '-u processor.py' },
    { ...common, name: 'axiom-lab-loop', script: py, args: '-u loop.py --every 1200' },
  ],
}
