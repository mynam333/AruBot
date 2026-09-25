const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyBackendArtifact } = require('../scripts/verify-backend-artifact.cjs');

describe('backend deployment artifact imports', () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'arubot-artifact-test-'));
    fs.mkdirSync(path.join(root, 'server'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('rejects the missing shared module that prevents the server from starting', () => {
    fs.writeFileSync(path.join(root, 'server/index.js'), "import { parseYouTubeMix } from '../shared/youtube-mix.js';");
    expect(() => verifyBackendArtifact(root)).toThrow('server/index.js -> ../shared/youtube-mix.js');
    fs.mkdirSync(path.join(root, 'shared'));
    fs.writeFileSync(path.join(root, 'shared/youtube-mix.js'), 'export function parseYouTubeMix() {}');
    expect(verifyBackendArtifact(root)).toEqual({ modules: 2 });
  });

  test.each([
    "export { value } from './missing.js';",
    "const lazy = () => import('./missing.js');",
    "const value = require('./missing.cjs');",
  ])('checks lazy and re-exported dependencies: %s', (source) => {
    fs.writeFileSync(path.join(root, 'server/index.js'), source);
    expect(() => verifyBackendArtifact(root)).toThrow('Missing backend runtime module');
  });

  test('rejects imports outside the archive and never evaluates the runtime', () => {
    fs.writeFileSync(path.join(root, 'server/index.js'), "throw new Error('must not execute'); import '../../outside.js';");
    expect(() => verifyBackendArtifact(root)).toThrow('Backend import escapes the artifact');
    fs.writeFileSync(path.join(root, 'server/index.js'), "throw new Error('must not execute'); import express from 'express';");
    expect(verifyBackendArtifact(root)).toEqual({ modules: 1 });
  });

  test('all local server imports in the repository resolve', () => {
    expect(verifyBackendArtifact(path.join(__dirname, '..')).modules).toBeGreaterThan(1);
  });
});
