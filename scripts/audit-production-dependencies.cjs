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
const EXPECTED_SOCKET_IO_FIX = Object.freeze({
  name: 'socket.io-client',
  version: '4.8.3',
  isSemVerMajor: true,
});

const EXPECTED_ADVISORY_METADATA = Object.freeze({
  1089711: { name: 'socket.io-parser', severity: 'high', range: '<3.3.2' },
  1097134: { name: 'socket.io-parser', severity: 'critical', range: '<3.3.3' },
  1100540: { name: 'socket.io-parser', severity: 'moderate', range: '<3.3.4' },
  1107224: { name: 'parseuri', severity: 'moderate', range: '<2.0.0' },
  1115156: { name: 'socket.io-parser', severity: 'high', range: '<3.3.5' },
  1118731: { name: 'ws', severity: 'high', range: '>=2.1.0 <5.2.4' },
  1123262: { name: 'ws', severity: 'high', range: '>=1.1.0 <5.2.5' },
  1130711: { name: 'socket.io-parser', severity: 'high', range: '<3.3.6' },
  1095088: { name: 'xmlhttprequest-ssl', severity: 'critical', range: '<1.6.2' },
  1095090: { name: 'xmlhttprequest-ssl', severity: 'critical', range: '<1.6.1' },
});

const KNOWN_EXCEPTION = Object.freeze({
  'socket.io-client': {
    severity: 'high',
    range: '1.0.0-pre - 4.4.1',
    fixAvailable: EXPECTED_SOCKET_IO_FIX,
    advisories: [],
    causes: ['engine.io-client', 'parseuri', 'socket.io-parser'],
    effects: [],
    nodes: ['node_modules/socket.io-client'],
  },
  'engine.io-client': {
    severity: 'critical',
    range: '0.7.0 || 0.7.8 - 0.7.9 || 1.0.2 - 6.1.1',
    fixAvailable: EXPECTED_SOCKET_IO_FIX,
    advisories: [],
    causes: ['parseuri', 'ws', 'xmlhttprequest-ssl'],
    effects: ['socket.io-client'],
    nodes: ['node_modules/engine.io-client'],
  },
  parseuri: {
    severity: 'moderate',
    range: '<2.0.0',
    fixAvailable: EXPECTED_SOCKET_IO_FIX,
    advisories: [1107224],
    causes: [],
    effects: ['engine.io-client', 'socket.io-client'],
    nodes: ['node_modules/parseuri'],
  },
  'socket.io-parser': {
    severity: 'critical',
    range: '<=3.3.5',
    fixAvailable: EXPECTED_SOCKET_IO_FIX,
    advisories: [1089711, 1097134, 1100540, 1115156, 1130711],
    causes: [],
    effects: ['socket.io-client'],
    nodes: ['node_modules/socket.io-parser'],
  },
  ws: {
    severity: 'high',
    range: '1.1.0 - 5.2.4',
    fixAvailable: EXPECTED_SOCKET_IO_FIX,
    advisories: [1118731, 1123262],
    causes: [],
    effects: ['engine.io-client'],
    nodes: ['node_modules/engine.io-client/node_modules/ws'],
  },
  'xmlhttprequest-ssl': {
    severity: 'critical',
    range: '<=1.6.1',
    fixAvailable: EXPECTED_SOCKET_IO_FIX,
    advisories: [1095088, 1095090],
    causes: [],
    effects: ['engine.io-client'],
    nodes: ['node_modules/xmlhttprequest-ssl'],
  },
});

const EXPECTED_LOCKED_CHAIN = Object.freeze({
  'node_modules/socket.io-client': '2.0.3',
  'node_modules/engine.io-client': '3.1.6',
  'node_modules/parseuri': '0.0.5',
  'node_modules/socket.io-parser': '3.1.3',
  'node_modules/xmlhttprequest-ssl': '1.5.5',
  'node_modules/engine.io-client/node_modules/ws': '3.3.3',
});

const EXPECTED_LOCKED_PROVENANCE = Object.freeze({
  'node_modules/socket.io-client': {
    resolved: 'https://registry.npmjs.org/socket.io-client/-/socket.io-client-2.0.3.tgz',
    integrity: 'sha512-Lx7dCP7xCLKNXB5IB5AH37YoIjxAHLxQxXPFx0uTj9juQAayWUIwS6VS9Qn3I3eESIoQzjvsatAW1w4qb3ek9A==',
  },
  'node_modules/engine.io-client': {
    resolved: 'https://registry.npmjs.org/engine.io-client/-/engine.io-client-3.1.6.tgz',
    integrity: 'sha512-hnuHsFluXnsKOndS4Hv6SvUrgdYx1pk2NqfaDMW+GWdgfU3+/V25Cj7I8a0x92idSpa5PIhJRKxPvp9mnoLsfg==',
  },
  'node_modules/parseuri': {
    resolved: 'https://registry.npmjs.org/parseuri/-/parseuri-0.0.5.tgz',
    integrity: 'sha512-ijhdxJu6l5Ru12jF0JvzXVPvsC+VibqeaExlNoMhWN6VQ79PGjkmc7oA4W1lp00sFkNyj0fx6ivPLdV51/UMog==',
  },
  'node_modules/socket.io-parser': {
    resolved: 'https://registry.npmjs.org/socket.io-parser/-/socket.io-parser-3.1.3.tgz',
    integrity: 'sha512-g0a2HPqLguqAczs3dMECuA1RgoGFPyvDqcbaDEdCWY9g59kdUAz3YRmaJBNKXflrHNwB7Q12Gkf/0CZXfdHR7g==',
  },
  'node_modules/xmlhttprequest-ssl': {
    resolved: 'https://registry.npmjs.org/xmlhttprequest-ssl/-/xmlhttprequest-ssl-1.5.5.tgz',
    integrity: 'sha512-/bFPLUgJrfGUL10AIv4Y7/CUt6so9CLtB/oFxQSHseSDNNCdC6vwwKEqwLN6wNPBg9YWXAiMu8jkf6RPRS/75Q==',
  },
  'node_modules/engine.io-client/node_modules/ws': {
    resolved: 'https://registry.npmjs.org/ws/-/ws-3.3.3.tgz',
    integrity: 'sha512-nnWLa/NwZSt4KQJu51MYlCcSQ5g7INpOrOMt4XV8j4dqTXdmlUmSHQ8/oLC069ckre0fRsgfvsKwbTdtKLCDkA==',
  },
});

const LOCK_DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
]);

const EXPECTED_LOCKED_EDGES = Object.freeze([
  {
    parent: '',
    section: 'dependencies',
    dependency: 'socket.io-client',
    spec: '2.0.3',
    child: 'node_modules/socket.io-client',
  },
  {
    parent: 'node_modules/socket.io-client',
    section: 'dependencies',
    dependency: 'engine.io-client',
    spec: '~3.1.0',
    child: 'node_modules/engine.io-client',
  },
  {
    parent: 'node_modules/socket.io-client',
    section: 'dependencies',
    dependency: 'parseuri',
    spec: '0.0.5',
    child: 'node_modules/parseuri',
  },
  {
    parent: 'node_modules/socket.io-client',
    section: 'dependencies',
    dependency: 'socket.io-parser',
    spec: '~3.1.1',
    child: 'node_modules/socket.io-parser',
  },
  {
    parent: 'node_modules/engine.io-client',
    section: 'dependencies',
    dependency: 'parseuri',
    spec: '0.0.5',
    child: 'node_modules/parseuri',
  },
  {
    parent: 'node_modules/engine.io-client',
    section: 'dependencies',
    dependency: 'ws',
    spec: '~3.3.1',
    child: 'node_modules/engine.io-client/node_modules/ws',
  },
  {
    parent: 'node_modules/engine.io-client',
    section: 'dependencies',
    dependency: 'xmlhttprequest-ssl',
    spec: '~1.5.4',
    child: 'node_modules/xmlhttprequest-ssl',
  },
]);

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

function resolveLockedDependencyPath(lockPackages, parentPath, dependencyName) {
  let currentPath = String(parentPath || '');
  while (true) {
    const candidate = currentPath
      ? `${currentPath}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (Object.hasOwn(lockPackages, candidate)) return candidate;
    if (!currentPath) return null;

    const ancestorMarker = currentPath.lastIndexOf('/node_modules/');
    currentPath = ancestorMarker >= 0 ? currentPath.slice(0, ancestorMarker) : '';
  }
}

function lockEdgeSignature({ parent, section, dependency, spec, child }) {
  return `${parent || '<root>'}\u0000${section}\u0000${dependency}\u0000${spec}\u0000${child}`;
}

function exactArrayMatch(actual, expected, normalize = (value) => String(value)) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const normalizedActual = actual.map(normalize);
  if (normalizedActual.some((value) => value === null)) return false;
  const actualSet = new Set(normalizedActual);
  if (actualSet.size !== normalizedActual.length) return false;
  const sortedActual = [...actualSet].sort();
  const sortedExpected = expected.map(normalize).sort();
  return sortedActual.every((value, index) => value === sortedExpected[index]);
}

function exactRecordMatch(actual, expected) {
  if (!isRecord(actual) || !isRecord(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return exactArrayMatch(actualKeys, expectedKeys)
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function verifyPinnedSocketIoException(packageJson, packageLock) {
  const declared = packageJson?.dependencies?.['socket.io-client'];
  if (declared !== PINNED_SOCKET_IO_CLIENT_VERSION) {
    throw new Error(`socket.io-client must remain exactly pinned to ${PINNED_SOCKET_IO_CLIENT_VERSION}; found ${declared || 'missing'}`);
  }

  const lockPackages = packageLock?.packages;
  if (!isRecord(lockPackages)) {
    throw new Error('package-lock.json does not contain a supported packages index');
  }
  const rootDeclared = lockPackages['']?.dependencies?.['socket.io-client'];
  if (rootDeclared !== PINNED_SOCKET_IO_CLIENT_VERSION) {
    throw new Error(`package-lock root must pin socket.io-client to ${PINNED_SOCKET_IO_CLIENT_VERSION}; found ${rootDeclared || 'missing'}`);
  }

  for (const [packagePath, expectedVersion] of Object.entries(EXPECTED_LOCKED_CHAIN)) {
    const packageEntry = lockPackages[packagePath];
    const actualVersion = packageEntry?.version;
    if (actualVersion !== expectedVersion) {
      throw new Error(`Known CHZZK exception chain changed at ${packagePath}: expected ${expectedVersion}, found ${actualVersion || 'missing'}`);
    }
    if (packageEntry.dev === true || packageEntry.optional === true || packageEntry.link === true) {
      throw new Error(`Known CHZZK exception chain changed install scope at ${packagePath}`);
    }
    const expectedProvenance = EXPECTED_LOCKED_PROVENANCE[packagePath];
    if (
      !expectedProvenance
      || packageEntry.resolved !== expectedProvenance.resolved
      || packageEntry.integrity !== expectedProvenance.integrity
    ) {
      throw new Error(`Known CHZZK exception package provenance changed at ${packagePath}`);
    }
  }

  for (const edge of EXPECTED_LOCKED_EDGES) {
    const parentEntry = lockPackages[edge.parent];
    const actualSpec = parentEntry?.[edge.section]?.[edge.dependency];
    if (actualSpec !== edge.spec) {
      throw new Error(`Known CHZZK exception edge changed at ${edge.parent || '<root>'} -> ${edge.dependency}: expected ${edge.spec}, found ${actualSpec || 'missing'}`);
    }
    const actualChild = resolveLockedDependencyPath(lockPackages, edge.parent, edge.dependency);
    if (actualChild !== edge.child) {
      throw new Error(`Known CHZZK exception edge resolved unexpectedly at ${edge.parent || '<root>'} -> ${edge.dependency}: expected ${edge.child}, found ${actualChild || 'missing'}`);
    }
  }

  const protectedNodes = new Set(Object.keys(EXPECTED_LOCKED_CHAIN));
  const actualReverseEdges = [];
  for (const [parent, packageEntry] of Object.entries(lockPackages)) {
    if (!isRecord(packageEntry)) continue;
    for (const section of LOCK_DEPENDENCY_SECTIONS) {
      const dependencies = packageEntry[section];
      if (!isRecord(dependencies)) continue;
      for (const [dependency, spec] of Object.entries(dependencies)) {
        const child = resolveLockedDependencyPath(lockPackages, parent, dependency);
        if (!child || !protectedNodes.has(child)) continue;
        actualReverseEdges.push(lockEdgeSignature({
          parent,
          section,
          dependency,
          spec: String(spec),
          child,
        }));
      }
    }
  }

  const expectedReverseEdges = EXPECTED_LOCKED_EDGES.map(lockEdgeSignature);
  if (!exactArrayMatch(actualReverseEdges, expectedReverseEdges)) {
    const expected = [...expectedReverseEdges].sort().join(', ');
    const actual = [...actualReverseEdges].sort().join(', ');
    throw new Error(`Known CHZZK exception reverse dependency graph changed: expected [${expected}], found [${actual}]`);
  }
}

function isKnownExceptionEntry(name, vulnerability) {
  const exception = KNOWN_EXCEPTION[name];
  if (!exception || !isRecord(vulnerability)) return false;
  if (vulnerability.name !== name || vulnerability.severity !== exception.severity) return false;
  if (vulnerability.range !== exception.range) return false;
  if (!exactRecordMatch(vulnerability.fixAvailable, exception.fixAvailable)) return false;
  if (!Array.isArray(vulnerability.via)) return false;

  const advisories = [];
  const causes = [];
  for (const cause of vulnerability.via) {
    if (typeof cause === 'string') {
      causes.push(cause);
      continue;
    }
    if (!isRecord(cause)) return false;
    const source = cause.source;
    if (!Number.isSafeInteger(source) || source <= 0) return false;
    if (cause.name !== name || cause.dependency !== name) return false;
    const expectedAdvisory = EXPECTED_ADVISORY_METADATA[source];
    if (
      !expectedAdvisory
      || expectedAdvisory.name !== name
      || cause.severity !== expectedAdvisory.severity
      || cause.range !== expectedAdvisory.range
    ) {
      return false;
    }
    advisories.push(source);
  }

  return exactArrayMatch(advisories, exception.advisories, (value) => {
    const source = value;
    return Number.isSafeInteger(source) && source > 0 ? source : null;
  })
    && exactArrayMatch(causes, exception.causes)
    && exactArrayMatch(vulnerability.effects, exception.effects)
    && exactArrayMatch(vulnerability.nodes, exception.nodes);
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
  for (const [name, exception] of Object.entries(KNOWN_EXCEPTION)) {
    if (Object.hasOwn(report.vulnerabilities, name)) continue;
    blocking.push({ name, severity: `missing-${exception.severity}`, nodes: [] });
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

function productionLockEntries(packageLock) {
  const entries = [];
  for (const [node, packageEntry] of Object.entries(packageLock.packages || {})) {
    if (!node || !isRecord(packageEntry) || packageEntry.dev === true || packageEntry.link === true) continue;
    const name = packageNameFromLockPath(node, packageEntry);
    if (!name) throw new Error(`Cannot determine package name for production lock node ${node}`);
    entries.push({ name, node, packageEntry });
  }
  return entries;
}

function resolvedProductionEdges(packageLock, entries) {
  const lockPackages = packageLock.packages;
  const productionNodes = new Set(entries.map(({ node }) => node));
  const edges = [];
  for (const { name: parentName, node: parentNode, packageEntry } of entries) {
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = packageEntry[section];
      if (!isRecord(dependencies)) continue;
      for (const dependency of Object.keys(dependencies)) {
        const childNode = resolveLockedDependencyPath(lockPackages, parentNode, dependency);
        if (!childNode || !productionNodes.has(childNode)) continue;
        edges.push({ parentName, parentNode, childNode });
      }
    }
  }
  return edges;
}

function addBulkAuditDependencyGraph(vulnerabilities, packageLock) {
  const entries = productionLockEntries(packageLock);
  const edges = resolvedProductionEdges(packageLock, entries);
  const nodeToVulnerability = new Map();
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    for (const node of vulnerability.nodes) nodeToVulnerability.set(node, name);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const { parentName, parentNode, childNode } of edges) {
      const causeName = nodeToVulnerability.get(childNode);
      if (!causeName || causeName === parentName) continue;

      let parentVulnerability = vulnerabilities[parentName];
      if (!parentVulnerability) {
        parentVulnerability = {
          effects: [],
          fixAvailable: false,
          isDirect: false,
          name: parentName,
          nodes: [],
          range: '*',
          severity: KNOWN_EXCEPTION[parentName]?.severity || vulnerabilities[causeName]?.severity || 'unknown',
          via: [],
        };
        vulnerabilities[parentName] = parentVulnerability;
      }

      if (!parentVulnerability.nodes.includes(parentNode)) {
        parentVulnerability.nodes.push(parentNode);
        nodeToVulnerability.set(parentNode, parentName);
        changed = true;
      }
      if (!parentVulnerability.via.includes(causeName)) {
        parentVulnerability.via.push(causeName);
        changed = true;
      }
      if (!KNOWN_EXCEPTION[parentName]) {
        parentVulnerability.severity = higherSeverity(
          parentVulnerability.severity,
          vulnerabilities[causeName]?.severity,
        );
      }
    }
  }

  for (const vulnerability of Object.values(vulnerabilities)) vulnerability.effects = [];
  for (const { parentName, parentNode, childNode } of edges) {
    const causeName = nodeToVulnerability.get(childNode);
    if (!causeName || nodeToVulnerability.get(parentNode) !== parentName || causeName === parentName) continue;
    const effects = vulnerabilities[causeName].effects;
    if (!effects.includes(parentName)) effects.push(parentName);
  }

  const rootDependencies = packageLock.packages?.['']?.dependencies || {};
  for (const vulnerability of Object.values(vulnerabilities)) {
    vulnerability.effects.sort();
    vulnerability.nodes.sort();
    const advisoryCauses = vulnerability.via.filter((cause) => typeof cause !== 'string');
    const packageCauses = vulnerability.via.filter((cause) => typeof cause === 'string').sort();
    vulnerability.via = [...advisoryCauses, ...packageCauses];
    vulnerability.isDirect = Object.hasOwn(rootDependencies, vulnerability.name)
      && vulnerability.nodes.some((node) => resolveLockedDependencyPath(
        packageLock.packages,
        '',
        vulnerability.name,
      ) === node);
  }
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
      if (seenAdvisories.has(advisory.source)) {
        throw new Error(`npm bulk audit returned duplicate advisory ${advisory.source} for ${name}`);
      }
      seenAdvisories.add(advisory.source);
      const matchingNodes = packageIndex.get(name).filter(({ version }) => semver.satisfies(version, advisory.range, {
        includePrerelease: true,
      }));
      if (matchingNodes.length === 0) continue;
      for (const { node } of matchingNodes) nodes.add(node);
      via.push(advisory);
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

  addBulkAuditDependencyGraph(vulnerabilities, packageLock);
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const exception = KNOWN_EXCEPTION[name];
    if (!exception) continue;
    vulnerability.range = exception.range;
    vulnerability.fixAvailable = { ...exception.fixAvailable };
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
