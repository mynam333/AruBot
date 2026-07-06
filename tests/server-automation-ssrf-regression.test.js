const fs = require('fs');
const path = require('path');

describe('server-side automation SSRF regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('server automation websocket clients validate endpoints before connecting', () => {
    const titsStart = serverIndex.indexOf('async function sendTitsRequest');
    const titsEnd = serverIndex.indexOf('function normalizeTitsItems', titsStart);
    const titsBody = serverIndex.slice(titsStart, titsEnd);
    expect(titsBody).toContain('assertSafeServerAutomationWebSocketUrl');
    expect(titsBody).toContain('new WebSocket(safeEndpoint)');

    const vtubeStart = serverIndex.indexOf('async function sendVtubeRequest');
    const vtubeEnd = serverIndex.indexOf('function normalizeVtubeDiscovery', vtubeStart);
    const vtubeBody = serverIndex.slice(vtubeStart, vtubeEnd);
    expect(vtubeBody).toContain('assertSafeServerAutomationWebSocketUrl');
    expect(vtubeBody).toContain('new WebSocket(safeEndpoint)');
  });

  test('server automation endpoint validation blocks private-network defaults unless explicitly enabled', () => {
    const start = serverIndex.indexOf('async function assertSafeServerAutomationWebSocketUrl');
    const end = serverIndex.indexOf('async function sendTitsRequest', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('ARUBOT_ALLOW_SERVER_PRIVATE_AUTOMATION');
    expect(body).toContain("lowerHost === 'localhost'");
    expect(body).toContain('isPrivateIpAddress(hostname)');
    expect(body).toContain('dns.promises.lookup');
    expect(body).toContain('isCloudMetadataAddress(hostname)');
    expect(body).toContain('isCloudMetadataAddress(record.address)');
    expect(serverIndex).toContain("const OCI_METADATA_IPV4 = '169.254.169.254'");
    expect(body).toContain('Server-side automation endpoints must use WSS in production');
  });
});
