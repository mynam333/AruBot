const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PINNED_SOCKET_IO_CLIENT_VERSION = '2.0.3';

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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
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

function inspectAuditReport(report) {
  if (!report || Number(report.auditReportVersion) !== 2 || typeof report.vulnerabilities !== 'object') {
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
  if (result.error) throw result.error;
  return parseAuditJson(result.stdout || result.stderr);
}

function runProductionAuditGate({ report = null } = {}) {
  const packageJson = readJson(path.join(ROOT_DIR, 'package.json'));
  const packageLock = readJson(path.join(ROOT_DIR, 'package-lock.json'));
  verifyPinnedSocketIoException(packageJson, packageLock);

  const auditReport = report || runNpmAudit();
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
  inspectAuditReport,
  runProductionAuditGate,
  verifyPinnedSocketIoException,
};

if (require.main === module) {
  try {
    runProductionAuditGate();
  } catch (error) {
    console.error(`[security audit] failed: ${error?.message || error}`);
    process.exitCode = 1;
  }
}
