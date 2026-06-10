// PM2 process definition for the Coach Vic service.
// Build first (`npm run build`), then: `pm2 start ecosystem.config.cjs && pm2 save`.
module.exports = {
  apps: [
    {
      name: 'coach-vic',
      script: 'dist/index.js',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      // Keep memory bounded; restart if it leaks.
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'C:\\dev\\coach-data\\logs\\coach-vic.out.log',
      error_file: 'C:\\dev\\coach-data\\logs\\coach-vic.err.log',
      time: true,
    },
  ],
};
