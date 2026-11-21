const { execFileSync } = require('node:child_process');
const path = require('node:path');

(process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip)(
  'broadcast allowance: concurrency, shared identity, mixed refunds and session expiry in PostgreSQL',
  () => { execFileSync(process.execPath, [path.join(__dirname, 'helpers/broadcast-bonus-postgres.mjs')], { timeout: 50000 }); },
  55000,
);
