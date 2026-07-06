const fs = require('fs');
const path = require('path');

const root = process.cwd();

describe('local program network hardening', () => {
  const main = fs.readFileSync(path.join(root, 'local-program', 'main.cjs'), 'utf8');

  test('UDP automation validates target networks and packet size before sending', () => {
    const helperStart = main.indexOf('async function assertSafeUdpTarget');
    const helperEnd = main.indexOf('async function assertSafeExternalHttpUrl', helperStart);
    const helperBody = main.slice(helperStart, helperEnd);

    expect(helperBody).toContain('UDP 노드는 기본적으로 localhost 주소로만 전송할 수 있습니다.');
    expect(helperBody).toContain('UDP 노드는 localhost 또는 사설망 주소로만 전송할 수 있습니다.');
    expect(helperBody).toContain('assertNotCloudMetadataAddress(address');
    expect(main).toContain("const OCI_METADATA_IPV4 = '169.254.169.254'");
    expect(helperBody).toContain('multicast, broadcast, unspecified');
    expect(helperBody).toContain('dns.lookup(host, { all: true, verbatim: true })');

    const udpStart = main.indexOf("if (type === 'blueprint.udp')");
    const udpEnd = main.indexOf("if (type === 'control.trigger')", udpStart);
    const udpBody = main.slice(udpStart, udpEnd);

    expect(udpBody).toContain('await assertSafeUdpTarget(host');
    expect(udpBody).toContain('socket.send(buffer, port, safeHost');
    expect(udpBody).toContain('MAX_UDP_PACKET_BYTES');
    expect(udpBody.indexOf('await assertSafeUdpTarget(host')).toBeLessThan(udpBody.indexOf('dgram.createSocket'));
    expect(udpBody.indexOf('MAX_UDP_PACKET_BYTES')).toBeLessThan(udpBody.indexOf('socket.send'));
  });

  test('HTTP and WebSocket automation block OCI metadata even when private networks are allowed', () => {
    const start = main.indexOf('async function assertSafeExternalHttpUrl');
    const end = main.indexOf('function parseMaybeJsonObject', start);
    const body = main.slice(start, end);

    expect(body).toContain("assertNotCloudMetadataAddress(hostname, 'HTTP 노드')");
    expect(body).toContain('isCloudMetadataAddress(record.address)');
    expect(body.indexOf('isCloudMetadataAddress(record.address)')).toBeLessThan(body.indexOf('!options.allowPrivateNetwork'));
  });

  test('local agent websocket no longer places the token in the URL query', () => {
    const start = main.indexOf('function getAgentWebSocketUrl');
    const end = main.indexOf('function sendAgentSocketMessage', start);
    const body = main.slice(start, end);

    expect(body).toContain("base.pathname = '/api/automations/local-agent/ws'");
    expect(body).toContain("base.search = ''");
    expect(body).not.toContain("searchParams.set('token'");
  });
});
