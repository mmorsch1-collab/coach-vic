// PM2 process definition for the Bridge API (OAuth/data layer).
// Runs the TypeScript entrypoint via tsx, from THIS repo — so the running
// service and the source of truth are the same tree (previously it ran from
// C:\dev\exec-coach\bridge-api, which drifted from git). Deploy: pull, then
// `pm2 restart bridge-api`.
//
// Secrets (.env, tokens.json) live in this directory and are gitignored.
module.exports = {
  apps: [
    {
      name: 'bridge-api',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/index.ts',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      out_file: 'C:\\dev\\coach-data\\logs\\bridge-api.out.log',
      error_file: 'C:\\dev\\coach-data\\logs\\bridge-api.err.log',
      time: true,
    },
  ],
};
