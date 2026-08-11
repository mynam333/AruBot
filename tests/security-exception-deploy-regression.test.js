const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { gzipSync } = require('zlib');

const root = path.join(__dirname, '..');

const advisoryRanges = {
  1089711: '<3.3.2',
  1097134: '<3.3.3',
  1100540: '<3.3.4',
  1107224: '<2.0.0',
  1115156: '<3.3.5',
  1118731: '>=2.1.0 <5.2.4',
  1123262: '>=1.1.0 <5.2.5',
  1130711: '<3.3.6',
  1095088: '<1.6.2',
  1095090: '<1.6.1',
};

const advisorySeverities = {
  1097134: 'critical',
  1100540: 'moderate',
  1107224: 'moderate',
  1095088: 'critical',
  1095090: 'critical',
};

const expectedFix = {
  name: 'socket.io-client',
  version: '4.8.3',
  isSemVerMajor: true,
};

function advisory(source, name, severity = advisorySeverities[source] || 'high') {
  return {
    source,
    name,
    dependency: name,
    severity,
    range: advisoryRanges[source],
    title: `advisory-${source}`,
  };
}

function knownAuditReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'socket.io-client': {
        name: 'socket.io-client',
        severity: 'high',
        range: '1.0.0-pre - 4.4.1',
        fixAvailable: { ...expectedFix },
        via: ['engine.io-client', 'parseuri', 'socket.io-parser'],
        effects: [],
        nodes: ['node_modules/socket.io-client'],
      },
      'engine.io-client': {
        name: 'engine.io-client',
        severity: 'critical',
        range: '0.7.0 || 0.7.8 - 0.7.9 || 1.0.2 - 6.1.1',
        fixAvailable: { ...expectedFix },
        via: ['parseuri', 'ws', 'xmlhttprequest-ssl'],
        effects: ['socket.io-client'],
        nodes: ['node_modules/engine.io-client'],
      },
      parseuri: {
        name: 'parseuri',
        severity: 'moderate',
        range: '<2.0.0',
        fixAvailable: { ...expectedFix },
        via: [advisory(1107224, 'parseuri', 'moderate')],
        effects: ['engine.io-client', 'socket.io-client'],
        nodes: ['node_modules/parseuri'],
      },
      'socket.io-parser': {
        name: 'socket.io-parser',
        severity: 'critical',
        range: '<=3.3.5',
        fixAvailable: { ...expectedFix },
        via: [1089711, 1097134, 1100540, 1115156, 1130711]
          .map((source) => advisory(source, 'socket.io-parser')),
        effects: ['socket.io-client'],
        nodes: ['node_modules/socket.io-parser'],
      },
      ws: {
        name: 'ws',
        severity: 'high',
        range: '1.1.0 - 5.2.4',
        fixAvailable: { ...expectedFix },
        via: [1118731, 1123262].map((source) => advisory(source, 'ws')),
        effects: ['engine.io-client'],
        nodes: ['node_modules/engine.io-client/node_modules/ws'],
      },
      'xmlhttprequest-ssl': {
        name: 'xmlhttprequest-ssl',
        severity: 'critical',
        range: '<=1.6.1',
        fixAvailable: { ...expectedFix },
        via: [1095088, 1095090].map((source) => advisory(source, 'xmlhttprequest-ssl', 'critical')),
        effects: ['engine.io-client'],
        nodes: ['node_modules/xmlhttprequest-ssl'],
      },
    },
  };
}

function fallbackLock() {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { 'socket.io-client': '2.0.3', ws: '8.21.1' } },
      'node_modules/axios': { version: '1.7.7' },
      'node_modules/dev-only-package': { version: '1.0.0', dev: true },
      'node_modules/engine.io-client': {
        version: '3.1.6',
        dependencies: {
          parseuri: '0.0.5',
          ws: '~3.3.1',
          'xmlhttprequest-ssl': '~1.5.4',
        },
      },
      'node_modules/engine.io-client/node_modules/ws': { version: '3.3.3' },
      'node_modules/parseuri': { version: '0.0.5' },
      'node_modules/socket.io-client': {
        version: '2.0.3',
        dependencies: {
          'engine.io-client': '~3.1.0',
          parseuri: '0.0.5',
          'socket.io-parser': '~3.1.1',
        },
      },
      'node_modules/socket.io-parser': { version: '3.1.3' },
      'node_modules/ws': { version: '8.21.1' },
      'node_modules/xmlhttprequest-ssl': { version: '1.5.5' },
    },
  };
}

function knownBulkResponse() {
  return {
    parseuri: [{
      id: 1107224,
      severity: 'moderate',
      title: 'reviewed parseuri advisory',
      vulnerable_versions: '<2.0.0',
    }],
    'socket.io-parser': [
      [1089711, 'high', '<3.3.2'],
      [1097134, 'critical', '<3.3.3'],
      [1100540, 'moderate', '<3.3.4'],
      [1115156, 'high', '<3.3.5'],
      [1130711, 'high', '<3.3.6'],
    ].map(([id, severity, vulnerableVersions]) => ({
      id,
      severity,
      title: `reviewed socket.io-parser advisory ${id}`,
      vulnerable_versions: vulnerableVersions,
    })),
    ws: [
      [1118731, '>=2.1.0 <5.2.4'],
      [1123262, '>=1.1.0 <5.2.5'],
    ].map(([id, vulnerableVersions]) => ({
      id,
      severity: 'high',
      title: `reviewed ws advisory ${id}`,
      vulnerable_versions: vulnerableVersions,
    })),
    'xmlhttprequest-ssl': [
      [1095088, '<1.6.2'],
      [1095090, '<1.6.1'],
    ].map(([id, vulnerableVersions]) => ({
      id,
      severity: 'critical',
      title: `reviewed xmlhttprequest-ssl advisory ${id}`,
      vulnerable_versions: vulnerableVersions,
    })),
  };
}

describe('production security exception and deployment gates', () => {
  const audit = require('../scripts/audit-production-dependencies.cjs');

  test('Socket.IO stays exactly pinned to the reviewed CHZZK dependency chain', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

    expect(packageJson.dependencies['socket.io-client']).toBe('2.0.3');
    expect(() => audit.verifyPinnedSocketIoException(packageJson, packageLock)).not.toThrow();
  });

  test('unrelated fixes stay within their existing patch-compatible dependency ranges', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const jsYamlVersion = packageLock.packages['node_modules/js-yaml'].version;
    const nanoidVersion = packageLock.packages['node_modules/nanoid'].version;

    expect(packageJson.dependencies['js-yaml']).toBeUndefined();
    expect(packageJson.dependencies.nanoid).toBeUndefined();
    expect(semver.satisfies(jsYamlVersion, '>=4.3.1 <4.4.0')).toBe(true);
    expect(semver.satisfies(nanoidVersion, '>=3.3.17 <3.4.0')).toBe(true);
  });

  test('Socket.IO exception rejects changed edge specs and unreviewed reverse parents', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

    const changedSpec = structuredClone(packageLock);
    changedSpec.packages['node_modules/socket.io-client'].dependencies['socket.io-parser'] = '3.1.3';
    expect(() => audit.verifyPinnedSocketIoException(packageJson, changedSpec))
      .toThrow('Known CHZZK exception edge changed');

    const extraParent = structuredClone(packageLock);
    extraParent.packages[''].dependencies['unreviewed-parser-consumer'] = '1.0.0';
    extraParent.packages['node_modules/unreviewed-parser-consumer'] = {
      version: '1.0.0',
      dependencies: { 'socket.io-parser': '3.1.3' },
    };
    expect(() => audit.verifyPinnedSocketIoException(packageJson, extraParent))
      .toThrow('Known CHZZK exception reverse dependency graph changed');

    const changedProvenance = structuredClone(packageLock);
    changedProvenance.packages['node_modules/socket.io-parser'].integrity = 'sha512-unreviewed';
    expect(() => audit.verifyPinnedSocketIoException(packageJson, changedProvenance))
      .toThrow('Known CHZZK exception package provenance changed');
  });

  test('only the complete exact reviewed advisory set is allowed', () => {
    const result = audit.inspectAuditReport(knownAuditReport());
    expect(result.allowed).toHaveLength(6);
    expect(result.blocking).toHaveLength(0);

    const changed = knownAuditReport();
    changed.vulnerabilities['socket.io-parser'].via.push(advisory(9999999, 'socket.io-parser'));
    const changedResult = audit.inspectAuditReport(changed);
    expect(changedResult.blocking.map((item) => item.name)).toContain('socket.io-parser');

    const missing = knownAuditReport();
    missing.vulnerabilities['socket.io-parser'].via.pop();
    expect(audit.inspectAuditReport(missing).blocking.map((item) => item.name))
      .toContain('socket.io-parser');

    const duplicate = knownAuditReport();
    duplicate.vulnerabilities['socket.io-parser'].via.push(
      advisory(1130711, 'socket.io-parser'),
    );
    expect(audit.inspectAuditReport(duplicate).blocking.map((item) => item.name))
      .toContain('socket.io-parser');

    const staleWsAdvisory = knownAuditReport();
    staleWsAdvisory.vulnerabilities.ws.via[1] = advisory(1122894, 'ws');
    const staleWsResult = audit.inspectAuditReport(staleWsAdvisory);
    expect(staleWsResult.blocking.map((item) => item.name)).toContain('ws');

    const missingEntry = knownAuditReport();
    delete missingEntry.vulnerabilities.ws;
    expect(audit.inspectAuditReport(missingEntry).blocking).toContainEqual({
      name: 'ws',
      severity: 'missing-high',
      nodes: [],
    });
  });

  test('exception entries require exact causes, effects, nodes, and advisory identity', () => {
    const mutations = [
      (report) => report.vulnerabilities['socket.io-client'].via.pop(),
      (report) => report.vulnerabilities['socket.io-client'].via.push('xmlhttprequest-ssl'),
      (report) => report.vulnerabilities.parseuri.effects.pop(),
      (report) => report.vulnerabilities.parseuri.effects.push('unreviewed-consumer'),
      (report) => report.vulnerabilities.ws.nodes.pop(),
      (report) => report.vulnerabilities.ws.nodes.push('node_modules/ws'),
      (report) => { report.vulnerabilities.parseuri.via[0].dependency = 'other-package'; },
      (report) => { report.vulnerabilities.parseuri.via[0].source = '1107224'; },
      (report) => { report.vulnerabilities['socket.io-parser'].via[4].severity = 'critical'; },
      (report) => { report.vulnerabilities['socket.io-parser'].via[4].range = '<3.3.7'; },
      (report) => { report.vulnerabilities['socket.io-parser'].fixAvailable.version = '4.9.0'; },
      (report) => { report.vulnerabilities['socket.io-parser'].range = '<3.3.6'; },
    ];

    for (const mutate of mutations) {
      const report = knownAuditReport();
      mutate(report);
      expect(audit.inspectAuditReport(report).blocking.length).toBeGreaterThan(0);
    }
  });

  test('an unrelated production vulnerability fails the allowlist', () => {
    const changed = knownAuditReport();
    changed.vulnerabilities.axios = {
      name: 'axios',
      severity: 'high',
      via: [advisory(1234567, 'axios')],
      effects: [],
      nodes: ['node_modules/axios'],
    };
    const result = audit.inspectAuditReport(changed);
    expect(result.blocking.map((item) => item.name)).toContain('axios');
  });

  test('npm audit error envelopes retain the registry failure detail', async () => {
    const envelope = {
      message: '400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick',
      body: {
        message: 'Invalid package tree, run npm install to rebuild your package-lock.json',
      },
      error: { summary: '', detail: '' },
    };
    expect(audit.describeNpmAuditFailure(envelope)).toContain('Invalid package tree');

    const fallbackReport = { auditReportVersion: 2, vulnerabilities: {} };
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bulkAuditRunner = jest.fn(async () => fallbackReport);
    await expect(audit.resolveAuditReportWithFallback({
      packageLock: fallbackLock(),
      npmAuditRunner: async () => envelope,
      bulkAuditRunner,
    })).resolves.toBe(fallbackReport);
    expect(bulkAuditRunner).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Invalid package tree'));
    warning.mockRestore();
  });

  test('both compressed-without-header and plain bulk JSON responses decode', () => {
    const json = Buffer.from(JSON.stringify({ ws: [] }));
    expect(audit.decodeAuditResponseBody(gzipSync(json), {}).toString('utf8')).toBe(json.toString('utf8'));
    expect(audit.decodeAuditResponseBody(json, {}).toString('utf8')).toBe(json.toString('utf8'));
  });

  test('bulk payload omits dev-only nodes but retains production versions', () => {
    const { packageIndex, payload } = audit.buildBulkAuditPayload(fallbackLock());
    expect(payload['dev-only-package']).toBeUndefined();
    expect(payload.axios).toEqual(['1.7.7']);
    expect(payload.ws).toEqual(['3.3.3', '8.21.1']);
    expect(packageIndex.get('ws')).toEqual(expect.arrayContaining([
      { node: 'node_modules/ws', version: '8.21.1' },
      { node: 'node_modules/engine.io-client/node_modules/ws', version: '3.3.3' },
    ]));
  });

  test('bulk advisories rebuild the exact reviewed dependency causes and effects', () => {
    const report = audit.convertBulkAdvisoriesToAuditReport(
      knownBulkResponse(),
      fallbackLock(),
    );

    expect(report.vulnerabilities['socket.io-client'].via).toEqual([
      'engine.io-client',
      'parseuri',
      'socket.io-parser',
    ]);
    expect(report.vulnerabilities.parseuri.effects).toEqual([
      'engine.io-client',
      'socket.io-client',
    ]);
    expect(report.vulnerabilities.ws.nodes).toEqual([
      'node_modules/engine.io-client/node_modules/ws',
    ]);
    expect(audit.inspectAuditReport(report)).toEqual({
      allowed: expect.arrayContaining([
        expect.objectContaining({ name: 'socket.io-client' }),
        expect.objectContaining({ name: 'engine.io-client' }),
        expect.objectContaining({ name: 'parseuri' }),
        expect.objectContaining({ name: 'socket.io-parser' }),
        expect.objectContaining({ name: 'ws' }),
        expect.objectContaining({ name: 'xmlhttprequest-ssl' }),
      ]),
      blocking: [],
    });
  });

  test('partial bulk fixtures retain precise nodes but fail the complete exception gate', () => {
    const report = audit.convertBulkAdvisoriesToAuditReport({
      ws: [
        {
          id: 1118731,
          severity: 'high',
          title: 'reviewed ws advisory one',
          vulnerable_versions: '>=2.1.0 <5.2.4',
        },
        {
          id: 1123262,
          severity: 'high',
          title: 'reviewed ws advisory two',
          vulnerable_versions: '>=1.1.0 <5.2.5',
        },
      ],
    }, fallbackLock());

    expect(report.vulnerabilities.ws.nodes).toEqual(['node_modules/engine.io-client/node_modules/ws']);
    expect(report.vulnerabilities.ws.via.map(({ source }) => source)).toEqual([1118731, 1123262]);
    expect(report.vulnerabilities.ws.effects).toEqual(['engine.io-client']);
    expect(audit.inspectAuditReport(report).blocking.length).toBeGreaterThan(0);
  });

  test('bulk fallback blocks new production advisories and ignores non-matching ranges', () => {
    const vulnerable = audit.convertBulkAdvisoriesToAuditReport({
      axios: [{
        id: 1234567,
        severity: 'high',
        title: 'new axios advisory',
        vulnerable_versions: '<2.0.0',
      }],
    }, fallbackLock());
    expect(audit.inspectAuditReport(vulnerable).blocking.map(({ name }) => name)).toContain('axios');

    const unaffected = audit.convertBulkAdvisoriesToAuditReport({
      axios: [{
        id: 1234567,
        severity: 'high',
        title: 'future axios advisory',
        vulnerable_versions: '>=2.0.0',
      }],
    }, fallbackLock());
    expect(audit.inspectAuditReport(unaffected).allowed).toEqual([]);
    expect(audit.inspectAuditReport(unaffected).blocking).toHaveLength(6);
  });

  test('bulk fallback rejects duplicate advisory identities instead of silently deduplicating them', () => {
    const duplicate = knownBulkResponse();
    duplicate['socket.io-parser'].push({ ...duplicate['socket.io-parser'][4] });
    expect(() => audit.convertBulkAdvisoriesToAuditReport(duplicate, fallbackLock()))
      .toThrow('duplicate advisory 1130711');
  });

  test('bulk fallback remains fail-closed when both audit transports fail', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(audit.resolveAuditReportWithFallback({
      packageLock: fallbackLock(),
      npmAuditRunner: async () => {
        throw new Error('quick endpoint failed');
      },
      bulkAuditRunner: async () => {
        throw new Error('bulk endpoint failed');
      },
    })).rejects.toThrow('bulk audit fallback also failed (bulk endpoint failed)');
    warning.mockRestore();
  });

  test('deployment runs verification, release-aware smoke checks, and rollback', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-backend.yml'), 'utf8');
    expect(workflow).toContain("BACKEND_RELEASES_TO_KEEP: ${{ vars.BACKEND_RELEASES_TO_KEEP || '2' }}");
    expect(workflow).toContain('npm run audit:production');
    expect(workflow).toContain('npm test -- --runInBand');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('BACKEND_APP_DIR: /home/ubuntu/AruBot');
    expect(workflow).toContain('local stable_cwd="/home/ubuntu/AruBot/current"');
    expect(workflow).toContain('export ARUBOT_APP_CWD="$stable_cwd"');
    expect(workflow).toContain('pm2 delete arubot-api');
    expect(workflow).toContain('pm2 start ecosystem.config.cjs');
    expect(workflow).toContain('npm run api:smoke -- --expect-release="$release_sha"');
    expect(workflow).toContain('rollback_release');
    expect(workflow).toContain('point_current_to "$PREVIOUS_CURRENT_REAL"');
    expect(workflow).toContain('> "$RELEASE_DIR/.release-sha"');
    expect(workflow).toContain('if [ "$RELEASES_TO_KEEP" -lt 2 ]');

    const ecosystem = fs.readFileSync(path.join(root, 'ecosystem.config.cjs'), 'utf8');
    expect(ecosystem).toContain("process.env.ARUBOT_APP_CWD || '/home/ubuntu/AruBot/current'");
    expect(ecosystem).toContain('cwd: rootDir');
    expect(ecosystem).toContain('env_production');
  });

  test('the security exception documents the upgrade prohibition and controls', () => {
    const document = fs.readFileSync(path.join(root, 'docs', 'SECURITY_EXCEPTIONS.md'), 'utf8');
    expect(document).toContain('socket.io-client@2.0.3');
    expect(document).toContain('GHSA-2m8v-j782-fhvr');
    expect(document).toContain('npm source `1130711`');
    expect(document).toContain('application-level decoder guard');
    expect(document).toContain('Do not upgrade, override, deduplicate, or replace');
    expect(document).toContain('Compensating controls');
    expect(document).toContain('No future advisory is implicitly approved');
  });
});
