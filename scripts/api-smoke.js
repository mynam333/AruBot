import dotenv from 'dotenv';

dotenv.config();

function parseArg(name, fallback = null) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function requestJson(baseUrl, path, { timeoutMs = 5000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return {
      path,
      status: response.status,
      ok: response.ok,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

function assertOk(result, predicate = null) {
  if (!result.ok) throw new Error(`${result.path} returned HTTP ${result.status}`);
  if (predicate && !predicate(result.body)) {
    throw new Error(`${result.path} returned unexpected body: ${JSON.stringify(result.body)}`);
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(
    parseArg('base') ||
    process.env.API_SMOKE_BASE_URL ||
    process.env.SERVER_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    `http://localhost:${process.env.SERVER_PORT || process.env.PORT || 3001}`
  );
  const expectedProvider = String(parseArg('expect-provider') || process.env.ARUBOT_DB_PROVIDER || '').trim().toLowerCase();
  const expectedRelease = String(parseArg('expect-release') || process.env.API_SMOKE_EXPECT_RELEASE || '').trim();
  const timeoutMs = Math.max(1000, Number(parseArg('timeout-ms') || process.env.API_SMOKE_TIMEOUT_MS || 5000));

  const checks = [];
  for (const path of ['/api/health', '/readyz', '/api/version', '/api/bot/settings']) {
    const result = await requestJson(baseUrl, path, { timeoutMs });
    checks.push(result);
  }

  assertOk(checks[0], (body) => body?.ok === true);
  assertOk(checks[1], (body) => body?.ok === true && body?.db && typeof body.db.max === 'number');
  assertOk(checks[2], (body) => body?.ok === true);
  assertOk(checks[3], (body) => body && typeof body === 'object' && 'settings' in body);

  if (expectedProvider) {
    const providerBodies = checks
      .map((check) => check.body?.dbProvider)
      .filter(Boolean);
    if (!providerBodies.includes(expectedProvider)) {
      throw new Error(`Expected dbProvider=${expectedProvider}, got ${providerBodies.join(', ') || 'none'}`);
    }
  }

  if (expectedRelease && checks[2].body?.releaseSha !== expectedRelease) {
    throw new Error(`Expected releaseSha=${expectedRelease}, got ${checks[2].body?.releaseSha || 'missing'}`);
  }

  const result = {
    ok: true,
    baseUrl,
    expectedProvider: expectedProvider || null,
    expectedRelease: expectedRelease || null,
    checkedAt: new Date().toISOString(),
    checks: checks.map((check) => ({
      path: check.path,
      status: check.status,
      ok: check.ok,
      dbProvider: check.body?.dbProvider || null,
    })),
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[api:smoke] Failed:', error?.message || error);
  process.exitCode = 1;
});
