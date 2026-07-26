const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
} = require('node:zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const PINNED_SOCKET_IO_CLIENT_VERSION = '2.0.3';
const BULK_AUDIT_PATH = '-/npm/v1/security/advisories/bulk';
const MAX_AUDIT_RESPONSE_BYTES = 32 * 1024 * 1024;

const KNOWN_EXCEPTION = Object.freeze({
  'socket.io-client': { advisories: [] },
  'engine.io-client': { advisories: [] },
  parseuri: { advisories: [1107224] },
  'socket.io-parser': { advisories: [1089711, 1097134, 1100540, 1115156] },
  ws: { advisories: [1118731, 1123262] },
  'xmlhttprequest-ssl': { advisories: [1095088, 1095090] },
});

const EXPECTED_LOCKED_CHAIN = Object.freeze({
  'node_modules/socket.io-client': '2.0.3',
  'node_modules/engine.io-client': '3.1.6',
  'node_modules/parseuri': '0.0.5',
  'node_modules/socket.io-parser': '3.1.3',
  'node_modules/xmlhttprequest-ssl': '1.5.5',
  'node_modules/engine.io-client/node_modules/ws': '3.3.3',
});

const EXPECTED_AUDIT_NODES = Object.freeze({
  'socket.io-client': new Set(['node_modules/socket.io-client']),
  'engine.io-client': new Set(['node_modules/engine.io-client']),
  parseuri: new Set(['node_modules/parseuri']),
  'socket.io-parser': new Set(['node_modules/socket.io-parser']),
  ws: new Set(['node_modules/engine.io-client/node_modules/ws']),
  'xmlhttprequest-ssl': new Set(['node_modules/xmlhttprequest-ssl']),
});

const SEVERITY_RANK = Object.freeze({
  unknown: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});

class NpmAuditUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'NpmAuditUnavailableError';
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function verifyPinnedSocketIoException(packageJson, packageLock) {
  const declared = packageJson?.dependencies?.['socket.io-client'];
  if (declared !== PINNED_SOCKET_IO_CLIENT_VERSION) {
    throw new Error(`socket.io-client must remain exactly pinned to ${PINNED_SOCKET_IO_CLIENT_VERSION}; found ${declared || 'missing'}`);
  }

  const lockPackages = packageLock?.packages || {};
  const rootDeclared = lockPackages['']?.dependencies?.['socket.io-client'];
  if (rootDeclared !== PINNED_SOCKET_IO_CLIENT_VERSION) {
    throw new Error(`package-lock root must pin socket.io-client to ${PINNED_SOCKET_IO_CLIENT_VERSION}; found ${rootDeclared || 'missing'}`);
  }

  for (const [packagePath, expectedVersion] of Object.entries(EXPECTED_LOCKED_CHAIN)) {
    const actualVersion = lockPackages[packagePath]?.version;
    if (actualVersion !== expectedVersion) {
      throw new Error(`Known CHZZK exception chain changed at ${packagePath}: expected ${expectedVersion}, found ${actualVersion || 'missing'}`);
    }
  }
}

function isKnownExceptionEntry(name, vulnerability) {
  const exception = KNOWN_EXCEPTION[name];
  if (!exception || !vulnerability || typeof vulnerability !== 'object') return false;

  const allowedAdvisories = new Set(exception.advisories);
  const via = Array.isArray(vulnerability.via) ? vulnerability.via : [];
  for (const cause of via) {
    if (typeof cause === 'string') {
      if (!Object.hasOwn(KNOWN_EXCEPTION, cause)) return false;
      continue;
    }
    if (!cause || !allowedAdvisories.has(Number(cause.source))) return false;
  }

  const effects = Array.isArray(vulnerability.effects) ? vulnerability.effects : [];
  if (effects.some((effect) => !Object.hasOwn(KNOWN_EXCEPTION, effect))) return false;

  const allowedNodes = EXPECTED_AUDIT_NODES[name];
  const nodes = Array.isArray(vulnerability.nodes) ? vulnerability.nodes : [];
  return nodes.length > 0 && nodes.every((node) => allowedNodes?.has(String(node)));
}

function isNpmAuditV2Report(report) {
  return isRecord(report)
    && Number(report.auditReportVersion) === 2
    && isRecord(report.vulnerabilities);
}

function inspectAuditReport(report) {
  if (!isNpmAuditV2Report(report)) {
    throw new Error('Unsupported or malformed npm audit JSON report');
  }

  const allowed = [];
  const blocking = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities || {})) {
    const item = {
      name,
      severity: String(vulnerability?.severity || 'unknown'),
      nodes: Array.isArray(vulnerability?.nodes) ? vulnerability.nodes.map(String) : [],
    };
    if (isKnownExceptionEntry(name, vulnerability)) allowed.push(item);
    else blocking.push(item);
  }
  return { allowed, blocking };
}

function parseAuditJson(output) {
  const text = String(output || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('npm audit did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function collectErrorDetails(value, output, seen = new Set()) {
  if (value == null || seen.has(value)) return;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return;
    try {
      collectErrorDetails(JSON.parse(text), output, seen);
    } catch {
      output.push(text);
    }
    return;
  }
  if (!isRecord(value)) return;
  seen.add(value);
  for (const key of ['message', 'summary', 'detail', 'body', 'error_description', 'error']) {
    if (Object.hasOwn(value, key)) collectErrorDetails(value[key], output, seen);
  }
}

function describeNpmAuditFailure(report) {
  if (!isRecord(report) || isNpmAuditV2Report(report)) return null;
  const details = [];
  collectErrorDetails(report, details);
  return [...new Set(details)].join(' | ') || null;
}

function normalizeDiagnostic(value, maxLength = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function runNpmAudit() {
  const npmExecPath = String(process.env.npm_execpath || '').trim();
  const command = npmExecPath ? process.execPath : 'npm';
  const args = npmExecPath
    ? [npmExecPath, 'audit', '--omit=dev', '--json']
    : ['audit', '--omit=dev', '--json'];
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: !npmExecPath && process.platform === 'win32',
  });
  if (result.error) {
    throw new NpmAuditUnavailableError(`npm audit could not start: ${result.error.message}`, { cause: result.error });
  }

  let report;
  try {
    report = parseAuditJson(result.stdout || result.stderr);
  } catch (error) {
    const diagnostic = normalizeDiagnostic(result.stderr || result.stdout);
    const suffix = diagnostic || `exit code ${result.status ?? 'unknown'}`;
    throw new NpmAuditUnavailableError(`npm audit returned no usable JSON: ${suffix}`, { cause: error });
  }

  if (!isNpmAuditV2Report(report)) {
    const diagnostic = describeNpmAuditFailure(report) || 'unsupported or malformed JSON response';
    throw new NpmAuditUnavailableError(`npm audit registry request failed: ${diagnostic}`);
  }
  return report;
}

function loadSemver() {
  try {
    return require('semver');
  } catch (error) {
    throw new Error('The production audit fallback requires the pinned semver dependency; run npm ci before auditing', { cause: error });
  }
}

function packageNameFromLockPath(packagePath, packageEntry) {
  if (typeof packageEntry?.name === 'string' && packageEntry.name.trim()) {
    return packageEntry.name.trim();
  }
  const marker = 'node_modules/';
  const markerIndex = String(packagePath).lastIndexOf(marker);
  if (markerIndex < 0) return '';
  return String(packagePath).slice(markerIndex + marker.length);
}

function buildProductionPackageIndex(packageLock, semver = loadSemver()) {
  if (!isRecord(packageLock?.packages)) {
    throw new Error('package-lock.json does not contain a supported packages index');
  }

  const packages = new Map();
  for (const [packagePath, packageEntry] of Object.entries(packageLock.packages)) {
    if (!packagePath || !isRecord(packageEntry) || packageEntry.dev === true || packageEntry.link === true) continue;

    const name = packageNameFromLockPath(packagePath, packageEntry);
    if (!name) {
      throw new Error(`Cannot determine package name for production lock node ${packagePath}`);
    }

    const version = String(packageEntry.version || '').trim();
    if (!semver.valid(version)) {
      throw new Error(`Production lock node ${packagePath} has a missing or non-semver version: ${version || 'missing'}`);
    }

    const entries = packages.get(name) || [];
    entries.push({ node: packagePath, version });
    packages.set(name, entries);
  }
  return packages;
}

function buildBulkAuditPayload(packageLock, semver) {
  const packageIndex = buildProductionPackageIndex(packageLock, semver);
  const payload = Object.create(null);
  for (const name of [...packageIndex.keys()].sort()) {
    payload[name] = [...new Set(packageIndex.get(name).map(({ version }) => version))].sort();
  }
  return { packageIndex, payload };
}

function decodeAuditResponseBody(body, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const contentEncoding = String(headers['content-encoding'] || headers['Content-Encoding'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const hasGzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;

  try {
    if (hasGzipMagic || contentEncoding === 'gzip' || contentEncoding === 'x-gzip') return gunzipSync(buffer);
    if (contentEncoding === 'deflate') return inflateSync(buffer);
    if (contentEncoding === 'br') return brotliDecompressSync(buffer);
    if (contentEncoding && contentEncoding !== 'identity') {
      throw new Error(`unsupported Content-Encoding: ${contentEncoding}`);
    }
    return buffer;
  } catch (error) {
    throw new Error(`Could not decode npm bulk audit response (${contentEncoding || (hasGzipMagic ? 'gzip magic bytes' : 'identity')}): ${error.message}`, { cause: error });
  }
}

function resolveBulkAuditUrl(registry = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org/') {
  let url;
  try {
    url = new URL(String(registry));
  } catch (error) {
    throw new Error(`Invalid npm registry URL: ${registry}`, { cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported npm registry protocol for audit: ${url.protocol}`);
  }
  url.pathname = `${url.pathname.replace(/\/*$/, '/')}${BULK_AUDIT_PATH}`;
  url.search = '';
  url.hash = '';
  return url;
}

function parseBulkResponseJson(buffer) {
  const text = Buffer.from(buffer || '').toString('utf8').trim();
  if (!text) throw new Error('npm bulk audit returned an empty response');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`npm bulk audit returned invalid JSON: ${normalizeDiagnostic(text, 300)}`, { cause: error });
  }
}

function requestBulkAdvisories(payload, {
  registry,
  timeoutMs = Number(process.env.NPM_AUDIT_TIMEOUT_MS) || 20_000,
} = {}) {
  const url = resolveBulkAuditUrl(registry);
  const body = Buffer.from(JSON.stringify(payload));
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const headers = {
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      'content-length': String(body.length),
      'content-type': 'application/json',
      'npm-command': 'audit',
      'npm-in-ci': String(Boolean(process.env.CI)),
      'user-agent': `arubot-production-audit node/${process.version}`,
    };
    if (process.env.NODE_AUTH_TOKEN) headers.authorization = `Bearer ${process.env.NODE_AUTH_TOKEN}`;

    const request = transport.request(url, {
      method: 'POST',
      headers,
    }, (response) => {
      const chunks = [];
      let receivedBytes = 0;

      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > MAX_AUDIT_RESPONSE_BYTES) {
          request.destroy(new Error(`npm bulk audit response exceeded ${MAX_AUDIT_RESPONSE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });

      response.on('end', () => {
        try {
          const decoded = decodeAuditResponseBody(Buffer.concat(chunks), response.headers);
          const parsed = parseBulkResponseJson(decoded);
          const diagnostic = describeNpmAuditFailure(parsed);
          if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
            throw new Error(`npm bulk audit request failed with HTTP ${response.statusCode || 'unknown'}${diagnostic ? `: ${diagnostic}` : ''}`);
          }
          if (diagnostic) throw new Error(`npm bulk audit returned an error: ${diagnostic}`);
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`npm bulk audit request timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function higherSeverity(current, candidate) {
  const currentName = String(current || 'unknown').toLowerCase();
  const candidateName = String(candidate || 'unknown').toLowerCase();
  return (SEVERITY_RANK[candidateName] || 0) > (SEVERITY_RANK[currentName] || 0)
    ? candidateName
    : currentName;
}

function normalizeBulkAdvisory(name, advisory, semver) {
  if (!isRecord(advisory)) throw new Error(`Malformed npm bulk advisory for ${name}`);
  const source = Number(advisory.id ?? advisory.source);
  if (!Number.isSafeInteger(source) || source <= 0) {
    throw new Error(`npm bulk advisory for ${name} has an invalid advisory id`);
  }
  const range = String(advisory.vulnerable_versions ?? advisory.range ?? '').trim();
  if (!range || semver.validRange(range) === null) {
    throw new Error(`npm bulk advisory ${source} for ${name} has an invalid vulnerable version range: ${range || 'missing'}`);
  }
  const severity = String(advisory.severity || '').trim().toLowerCase();
  if (!severity) throw new Error(`npm bulk advisory ${source} for ${name} has no severity`);
  return {
    dependency: name,
    name,
    range,
    severity,
    source,
    title: String(advisory.title || `npm advisory ${source}`),
    url: String(advisory.url || ''),
  };
}

function convertBulkAdvisoriesToAuditReport(bulkResponse, packageLock, semver = loadSemver()) {
  if (!isRecord(bulkResponse)) throw new Error('npm bulk audit returned an unsupported response');
  const diagnostic = describeNpmAuditFailure(bulkResponse);
  if (diagnostic) throw new Error(`npm bulk audit returned an error: ${diagnostic}`);

  const { packageIndex } = buildBulkAuditPayload(packageLock, semver);
  const vulnerabilities = Object.create(null);

  for (const [name, advisories] of Object.entries(bulkResponse)) {
    if (!packageIndex.has(name)) {
      throw new Error(`npm bulk audit returned an advisory for an unrequested package: ${name}`);
    }
    if (!Array.isArray(advisories)) {
      throw new Error(`npm bulk audit returned malformed advisories for ${name}`);
    }

    const nodes = new Set();
    const via = [];
    const seenAdvisories = new Set();
    let severity = 'unknown';
    for (const rawAdvisory of advisories) {
      const advisory = normalizeBulkAdvisory(name, rawAdvisory, semver);
      const matchingNodes = packageIndex.get(name).filter(({ version }) => semver.satisfies(version, advisory.range, {
        includePrerelease: true,
      }));
      if (matchingNodes.length === 0) continue;
      for (const { node } of matchingNodes) nodes.add(node);
      if (!seenAdvisories.has(advisory.source)) {
        via.push(advisory);
        seenAdvisories.add(advisory.source);
      }
      severity = higherSeverity(severity, advisory.severity);
    }

    if (via.length > 0) {
      vulnerabilities[name] = {
        effects: [],
        fixAvailable: false,
        isDirect: packageIndex.get(name).some(({ node }) => !node.slice('node_modules/'.length).includes('/node_modules/')),
        name,
        nodes: [...nodes].sort(),
        range: [...new Set(via.map(({ range }) => range))].join(' || '),
        severity,
        via,
      };
    }
  }

  return {
    auditReportVersion: 2,
    vulnerabilities,
  };
}

async function fetchBulkAuditReport(packageLock, options) {
  const semver = loadSemver();
  const { payload } = buildBulkAuditPayload(packageLock, semver);
  const bulkResponse = await requestBulkAdvisories(payload, options);
  return convertBulkAdvisoriesToAuditReport(bulkResponse, packageLock, semver);
}

async function resolveAuditReportWithFallback({
  packageLock,
  npmAuditRunner = runNpmAudit,
  bulkAuditRunner = fetchBulkAuditReport,
} = {}) {
  try {
    const report = await npmAuditRunner();
    if (!isNpmAuditV2Report(report)) {
      const diagnostic = describeNpmAuditFailure(report) || 'unsupported or malformed JSON response';
      throw new NpmAuditUnavailableError(`npm audit registry request failed: ${diagnostic}`);
    }
    return report;
  } catch (npmError) {
    const npmDiagnostic = normalizeDiagnostic(npmError?.message || npmError);
    console.warn(`[security audit] npm audit unavailable (${npmDiagnostic}); retrying with the registry bulk advisory endpoint`);
    try {
      return await bulkAuditRunner(packageLock);
    } catch (bulkError) {
      const bulkDiagnostic = normalizeDiagnostic(bulkError?.message || bulkError);
      throw new Error(`npm audit failed (${npmDiagnostic}); bulk audit fallback also failed (${bulkDiagnostic})`, { cause: bulkError });
    }
  }
}

async function runProductionAuditGate({
  report = null,
  packageJson: providedPackageJson = null,
  packageLock: providedPackageLock = null,
  npmAuditRunner = runNpmAudit,
  bulkAuditRunner = fetchBulkAuditReport,
} = {}) {
  const packageJson = providedPackageJson || readJson(path.join(ROOT_DIR, 'package.json'));
  const packageLock = providedPackageLock || readJson(path.join(ROOT_DIR, 'package-lock.json'));
  verifyPinnedSocketIoException(packageJson, packageLock);

  const auditReport = report || await resolveAuditReportWithFallback({ packageLock, npmAuditRunner, bulkAuditRunner });
  const result = inspectAuditReport(auditReport);
  for (const item of result.allowed) {
    console.warn(`[security exception] ${item.name} (${item.severity}) is allowed only through the pinned CHZZK socket.io-client@${PINNED_SOCKET_IO_CLIENT_VERSION} chain`);
  }
  if (result.blocking.length > 0) {
    for (const item of result.blocking) {
      console.error(`[security audit] blocking vulnerability: ${item.name} (${item.severity}) nodes=${item.nodes.join(',') || 'unknown'}`);
    }
    throw new Error(`${result.blocking.length} production vulnerability entry or changed exception was not approved`);
  }
  console.log(`[security audit] passed; ${result.allowed.length} documented CHZZK exception entries acknowledged, no new production vulnerabilities`);
  return result;
}

module.exports = {
  PINNED_SOCKET_IO_CLIENT_VERSION,
  buildBulkAuditPayload,
  buildProductionPackageIndex,
  convertBulkAdvisoriesToAuditReport,
  decodeAuditResponseBody,
  describeNpmAuditFailure,
  fetchBulkAuditReport,
  inspectAuditReport,
  parseAuditJson,
  requestBulkAdvisories,
  resolveAuditReportWithFallback,
  runNpmAudit,
  runProductionAuditGate,
  verifyPinnedSocketIoException,
};

if (require.main === module) {
  runProductionAuditGate().catch((error) => {
    console.error(`[security audit] failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
