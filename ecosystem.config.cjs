const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(process.env.ARUBOT_APP_CWD || '/home/ubuntu/AruBot/current');
try {
  require('dotenv').config({ path: path.join(rootDir, '.env') });
} catch {
  // The server also loads dotenv; this keeps local PM2 config usable before npm install.
}

const logsDir = path.join(rootDir, 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const port = process.env.PORT || process.env.SERVER_PORT || '3001';
const maxOldSpaceSize = process.env.ARUBOT_NODE_MAX_OLD_SPACE_SIZE || '768';
const maxMemoryRestart = process.env.ARUBOT_PM2_MAX_MEMORY_RESTART || '900M';
const readPositiveInteger = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};
const maxRestarts = readPositiveInteger('ARUBOT_PM2_MAX_RESTARTS', 100);
const expBackoffRestartDelay = readPositiveInteger('ARUBOT_PM2_EXP_BACKOFF_RESTART_DELAY_MS', 1000);
const killTimeout = readPositiveInteger('ARUBOT_PM2_KILL_TIMEOUT_MS', 25000);
const listenTimeout = readPositiveInteger('ARUBOT_PM2_LISTEN_TIMEOUT_MS', 120000);
const releaseSha = process.env.ARUBOT_RELEASE_SHA || process.env.RELEASE_SHA || 'local';
const deploymentMode = process.env.ARUBOT_PM2_MODE || 'legacy';
const runtimeId = String(process.env.ARUBOT_RUNTIME_ID || '');
const runtimeName = process.env.ARUBOT_RUNTIME_NAME || 'arubot-runtime-blue';
const ingressSecret = process.env.ARUBOT_CHAT_INGRESS_SECRET || '';
if (!['legacy', 'ingress', 'runtime'].includes(deploymentMode)) {
  throw new Error('Unknown ARUBOT_PM2_MODE');
}
if (deploymentMode === 'legacy' && process.env.ARUBOT_ENABLE_CHAT_INGRESS === 'true') {
  throw new Error('Use scripts/deploy-chat-runtime.mjs for an ingress installation, not a legacy PM2 reload');
}
if (deploymentMode !== 'legacy' && (ingressSecret.length < 32 || ingressSecret.length > 4096 || /[\r\n]/.test(ingressSecret))) {
  throw new Error('ARUBOT_CHAT_INGRESS_SECRET must contain at least 32 characters');
}
if (deploymentMode === 'runtime' && (!runtimeId || !['arubot-runtime-blue', 'arubot-runtime-green'].includes(runtimeName))) {
  throw new Error('A unique ARUBOT_RUNTIME_ID and a blue/green runtime name are required');
}
if (deploymentMode === 'runtime' && String(port) !== (runtimeName === 'arubot-runtime-blue' ? '3002' : '3003')) {
  throw new Error('Blue/green runtime ports must be 3002/3003');
}
if (deploymentMode === 'ingress' && (!path.isAbsolute(process.env.ARUBOT_CHAT_INGRESS_DATA_DIR || '')
    || path.relative(rootDir, process.env.ARUBOT_CHAT_INGRESS_DATA_DIR).split(path.sep)[0] !== '..')) {
  throw new Error('Ingress data must use an absolute shared directory outside the release cwd');
}

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
      min_uptime: '30s',
      max_restarts: maxRestarts,
      exp_backoff_restart_delay: expBackoffRestartDelay,
      kill_timeout: killTimeout,
      wait_ready: true,
      listen_timeout: listenTimeout,
      node_args: [`--max-old-space-size=${maxOldSpaceSize}`],
      out_file: path.join(logsDir, 'api.out.log'),
      error_file: path.join(logsDir, 'api.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PORT: port,
        SERVER_PORT: port,
        ARUBOT_PROCESS_ROLE: 'api-runtime',
        ARUBOT_RELEASE_SHA: releaseSha,
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};

if (deploymentMode !== 'legacy') {
  const api = module.exports.apps[0];
  const ingress = deploymentMode === 'ingress';
  module.exports.apps = [{
    ...api,
    name: ingress ? 'arubot-ingress' : runtimeName,
    script: ingress ? 'server/chat-ingress-service.mjs' : 'server/index.js',
    out_file: path.join(logsDir, `${ingress ? 'ingress' : runtimeName}.out.log`),
    error_file: path.join(logsDir, `${ingress ? 'ingress' : runtimeName}.err.log`),
    env: {
      ...api.env,
      ARUBOT_PROCESS_ROLE: ingress ? 'chat-ingress' : 'api-runtime',
      ARUBOT_ENABLE_CHAT_INGRESS: 'true',
      ARUBOT_CHAT_INGRESS_SECRET: ingressSecret,
      ARUBOT_CHAT_INGRESS_URL: process.env.ARUBOT_CHAT_INGRESS_URL || 'http://127.0.0.1:3701',
      ARUBOT_CHAT_INGRESS_HOST: '127.0.0.1',
      ARUBOT_CHAT_INGRESS_PORT: process.env.ARUBOT_CHAT_INGRESS_PORT || '3701',
      ARUBOT_CHAT_INGRESS_DATA_DIR: process.env.ARUBOT_CHAT_INGRESS_DATA_DIR,
      ARUBOT_RUNTIME_ID: ingress ? '' : runtimeId,
      SERVER_HOST: '127.0.0.1',
    },
  }];
}
