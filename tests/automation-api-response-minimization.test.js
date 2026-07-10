const fs = require('fs');
const path = require('path');

const root = process.cwd();

describe('automation API response minimization', () => {
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const automationsPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'automations-page.tsx'), 'utf8');
  const blueprintPage = fs.readFileSync(path.join(root, 'src', 'features', 'admin', 'action-blueprint-page.tsx'), 'utf8');

  test('overview response uses public DTOs instead of raw settings, connections, or agents', () => {
    const start = serverIndex.indexOf("app.get('/api/automations/overview'");
    const end = serverIndex.indexOf("app.get('/api/action-blueprints'", start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('settings: publicAutomationSettings(settings)');
    expect(body).toContain('connections: connections.map(publicAutomationConnection).filter(Boolean)');
    expect(body).toContain('localAgents: localAgents.map(publicAutomationAgent).filter(Boolean)');
    expect(body).not.toContain('queueBackend');
    expect(body).not.toContain('secretPolicy');
    expect(body).not.toContain('...settings');
  });

  test('public automation DTOs remove raw internal fields and use generic mode names', () => {
    const dtoStart = serverIndex.indexOf('function publicExecutionMode');
    const dtoEnd = serverIndex.indexOf('function normalizeFxLengthUnit', dtoStart);
    expect(dtoStart).toBeGreaterThanOrEqual(0);
    expect(dtoEnd).toBeGreaterThan(dtoStart);
    const body = serverIndex.slice(dtoStart, dtoEnd);

    expect(body).toContain("'local' : 'web'");
    expect(body).toContain("'local' : 'managed'");
    expect(body).toContain('publicAutomationDiscovery');
    expect(body).not.toContain('ownerUserId:');
    expect(body).not.toContain('config:');
    expect(body).not.toContain('capabilities:');
    expect(body).not.toContain('createdAt:');
    expect(body).not.toContain('updatedAt:');
  });

  test('browser-facing automation responses do not return job internals', () => {
    const runStart = serverIndex.indexOf("app.post('/api/automations/run'");
    const runEnd = serverIndex.indexOf("app.get('/api/automations/local-agent/assets", runStart);
    const runBody = serverIndex.slice(runStart, runEnd);
    expect(runBody).toContain('return res.json({ queued: true })');
    expect(runBody).not.toContain('jobType })');
    expect(runBody).not.toContain('jobId');

    const controlStart = serverIndex.indexOf("app.all('/api/automations/inbound/control/:token'");
    const controlEnd = serverIndex.indexOf("app.get('/api/automations/assets/sounds'", controlStart);
    const controlBody = serverIndex.slice(controlStart, controlEnd);
    expect(controlBody).toContain('return res.json({ ok: result.ok !== false })');
    expect(controlBody).toContain('return res.json({ ok: true, queued: true })');
    expect(controlBody).not.toContain('actionId, result');
    expect(controlBody).not.toContain('jobId');
  });

  test('admin frontend uses generic public mode values', () => {
    expect(automationsPage).not.toContain('oracle_direct');
    expect(automationsPage).not.toContain('server_hosted');
    expect(automationsPage).not.toContain("'local_program'");
    expect(blueprintPage).not.toContain('oracle_direct');
    expect(blueprintPage).not.toContain("'local_program'");
  });
});
