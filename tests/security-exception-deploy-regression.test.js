const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');

const root = path.join(__dirname, '..');

function advisory(source) {
  return { source, severity: 'high', title: `advisory-${source}` };
}

function knownAuditReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      'socket.io-client': {
        severity: 'high',
        via: ['engine.io-client', 'parseuri', 'socket.io-parser'],
        effects: [],
        nodes: ['node_modules/socket.io-client'],
      },
      'engine.io-client': {
        severity: 'critical',
        via: ['parseuri', 'ws', 'xmlhttprequest-ssl'],
        effects: ['socket.io-client'],
        nodes: ['node_modules/engine.io-client'],
      },
      parseuri: {
        severity: 'moderate',
        via: [advisory(1107224)],
        effects: ['engine.io-client', 'socket.io-client'],
        nodes: ['node_modules/parseuri'],
      },
      'socket.io-parser': {
        severity: 'critical',
        via: [1089711, 1097134, 1100540, 1115156].map(advisory),
        effects: ['socket.io-client'],
        nodes: ['node_modules/socket.io-parser'],
      },
      ws: {
        severity: 'high',
        via: [1118731, 1123262].map(advisory),
        effects: ['engine.io-client'],
        nodes: ['node_modules/engine.io-client/node_modules/ws'],
      },
      'xmlhttprequest-ssl': {
        severity: 'critical',
        via: [1095088, 1095090].map(advisory),
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
      '': { dependencies: { ws: '8.21.1' } },
      'node_modules/axios': { version: '1.7.7' },
      'node_modules/dev-only-package': { version: '1.0.0', dev: true },
      'node_modules/engine.io-client/node_modules/ws': { version: '3.3.3' },
      'node_modules/ws': { version: '8.21.1' },
    },
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

  test('only the exact reviewed advisory set is allowed', () => {
    const result = audit.inspectAuditReport(knownAuditReport());
    expect(result.allowed).toHaveLength(6);
    expect(result.blocking).toHaveLength(0);

    const changed = knownAuditReport();
    changed.vulnerabilities['socket.io-parser'].via.push(advisory(9999999));
    const changedResult = audit.inspectAuditReport(changed);
    expect(changedResult.blocking.map((item) => item.name)).toContain('socket.io-parser');

    const staleWsAdvisory = knownAuditReport();
    staleWsAdvisory.vulnerabilities.ws.via[1] = advisory(1122894);
    const staleWsResult = audit.inspectAuditReport(staleWsAdvisory);
    expect(staleWsResult.blocking.map((item) => item.name)).toContain('ws');
  });

  test('an unrelated production vulnerability fails the allowlist', () => {
    const changed = knownAuditReport();
    changed.vulnerabilities.axios = {
      severity: 'high',
      via: [advisory(1234567)],
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

  test('bulk advisories use semver ranges to preserve the exact nested ws exception node', () => {
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
    expect(audit.inspectAuditReport(report)).toEqual({
      allowed: [{
        name: 'ws',
        severity: 'high',
        nodes: ['node_modules/engine.io-client/node_modules/ws'],
      }],
      blocking: [],
    });
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
    expect(audit.inspectAuditReport(vulnerable).blocking.map(({ name }) => name)).toEqual(['axios']);

    const unaffected = audit.convertBulkAdvisoriesToAuditReport({
      axios: [{
        id: 1234567,
        severity: 'high',
        title: 'future axios advisory',
        vulnerable_versions: '>=2.0.0',
      }],
    }, fallbackLock());
    expect(audit.inspectAuditReport(unaffected)).toEqual({ allowed: [], blocking: [] });
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
    expect(document).toContain('Do not upgrade, override, deduplicate, or replace');
    expect(document).toContain('Compensating controls');
    expect(document).toContain('No future advisory is implicitly approved');
  });
});
