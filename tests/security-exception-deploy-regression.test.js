const fs = require('fs');
const path = require('path');

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
        via: [1118731, 1122894].map(advisory),
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

  test('deployment runs verification, release-aware smoke checks, and rollback', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-backend.yml'), 'utf8');
    expect(workflow).toContain("BACKEND_RELEASES_TO_KEEP: ${{ vars.BACKEND_RELEASES_TO_KEEP || '2' }}");
    expect(workflow).toContain('npm run audit:production');
    expect(workflow).toContain('npm test -- --runInBand');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('pm2 startOrReload ecosystem.config.cjs');
    expect(workflow).toContain('npm run api:smoke -- --expect-release="$release_sha"');
    expect(workflow).toContain('rollback_release');
    expect(workflow).toContain('point_current_to "$PREVIOUS_CURRENT_REAL"');
    expect(workflow).toContain('> "$RELEASE_DIR/.release-sha"');
    expect(workflow).toContain('if [ "$RELEASES_TO_KEEP" -lt 2 ]');
  });

  test('the security exception documents the upgrade prohibition and controls', () => {
    const document = fs.readFileSync(path.join(root, 'docs', 'SECURITY_EXCEPTIONS.md'), 'utf8');
    expect(document).toContain('socket.io-client@2.0.3');
    expect(document).toContain('Do not upgrade, override, deduplicate, or replace');
    expect(document).toContain('Compensating controls');
    expect(document).toContain('No future advisory is implicitly approved');
  });
});
