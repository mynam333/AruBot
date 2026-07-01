const path = require('path');

const rootDir = __dirname;
try {
  require('dotenv').config({ path: path.join(rootDir, '.env') });
} catch {
  // The server also loads dotenv; this keeps local PM2 config usable before npm install.
}

const logsDir = process.env.ARUBOT_LOG_DIR || path.join(rootDir, 'logs');
const port = process.env.PORT || process.env.SERVER_PORT || '3001';
const maxOldSpaceSize = process.env.ARUBOT_NODE_MAX_OLD_SPACE_SIZE || '768';
const maxMemoryRestart = process.env.ARUBOT_PM2_MAX_MEMORY_RESTART || '900M';
const releaseSha = process.env.ARUBOT_RELEASE_SHA || process.env.RELEASE_SHA || 'local';

module.exports = {
  apps: [
    {
      name: 'arubot-api',
      cwd: rootDir,
      script: 'server/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: maxMemoryRestart,
      min_uptime: '20s',
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 15000,
      listen_timeout: 10000,
      node_args: [`--max-old-space-size=${maxOldSpaceSize}`],
      out_file: path.join(logsDir, 'api.out.log'),
      error_file: path.join(logsDir, 'api.err.log'),
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: port,
        SERVER_PORT: port,
        ARUBOT_PROCESS_ROLE: 'api-runtime',
        ARUBOT_RELEASE_SHA: releaseSha,
      },
    },
  ],
};
