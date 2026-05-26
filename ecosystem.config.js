const path = require('node:path');

const projectRoot = __dirname;
const serverDir = path.join(projectRoot, 'server');
const logDir = path.join(projectRoot, 'logs');

module.exports = {
  apps: [
    {
      name: 'ruobai-server',
      cwd: serverDir,
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000'
      },
      error_file: path.join(logDir, 'ruobai-error.log'),
      out_file: path.join(logDir, 'ruobai-out.log'),
      log_file: path.join(logDir, 'ruobai-combined.log'),
      merge_logs: true,
      time: true
    }
  ]
};
