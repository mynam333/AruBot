const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

describe('CHZZK Socket.IO 2.x parser security guard', () => {
  test('2.0.3 체인은 유지하면서 비정상 attachment 수를 거부하고 정상 binary packet은 보존한다', () => {
    const guardUrl = new URL(
      '../server/chzzk-socket-io2-guard.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      const { installChzzkSocketIo2ParserGuard } = await import(${JSON.stringify(guardUrl)});
      const parserModule = await import('socket.io-parser');
      const parser = parserModule.default || parserModule;
      const firstInstall = installChzzkSocketIo2ParserGuard(parser);
      const secondInstall = installChzzkSocketIo2ParserGuard(parser);

      const invalidPackets = [
        '5-["event"]',
        '6-["ack"]',
        '50-["event"]',
        '600-["ack"]',
        '5  -["event"]',
        '5+0-["event"]',
        '50x0-["event"]',
        '50e5-["event"]',
        '5.0-["event"]',
        '5-1-["event"]',
        '51.5-["event"]',
        '5Infinity-["event"]',
        '511-["event"]',
        '611-["ack"]',
      ];
      const invalidErrors = invalidPackets.map((packet) => {
        const decoder = new parser.Decoder();
        try {
          decoder.add(packet);
          return null;
        } catch (error) {
          return error?.message || String(error);
        }
      });

      const validDecoder = new parser.Decoder();
      let decoded = null;
      validDecoder.on('decoded', (packet) => { decoded = packet; });
      validDecoder.add('2["event",{"ok":true}]');

      const binaryEventDecoder = new parser.Decoder();
      let binaryEvent = null;
      binaryEventDecoder.on('decoded', (packet) => { binaryEvent = packet; });
      binaryEventDecoder.add('51-["event",{"_placeholder":true,"num":0}]');
      binaryEventDecoder.add(Buffer.from([1, 2, 3]));

      const binaryAckDecoder = new parser.Decoder();
      let binaryAck = null;
      binaryAckDecoder.on('decoded', (packet) => { binaryAck = packet; });
      binaryAckDecoder.add('61-7[{"_placeholder":true,"num":0}]');
      binaryAckDecoder.add(Buffer.from([4, 5]));

      const tenAttachmentDecoder = new parser.Decoder();
      let tenAttachmentPacket = null;
      tenAttachmentDecoder.on('decoded', (packet) => { tenAttachmentPacket = packet; });
      tenAttachmentDecoder.add('510-["event",' + Array.from({ length: 10 }, (_, index) => JSON.stringify({ _placeholder: true, num: index })).join(',') + ']');
      for (let index = 0; index < 10; index += 1) tenAttachmentDecoder.add(Buffer.from([index]));

      console.log(JSON.stringify({
        parserVersion: (await import('socket.io-parser/package.json', { with: { type: 'json' } })).default.version,
        firstInstall,
        secondInstall,
        invalidErrors,
        decoded,
        binaryEvent,
        binaryEventReconstructorReleased: binaryEventDecoder.reconstructor === null,
        binaryAck,
        binaryAckReconstructorReleased: binaryAckDecoder.reconstructor === null,
        tenAttachmentPacket,
        tenAttachmentReconstructorReleased: tenAttachmentDecoder.reconstructor === null,
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
    }).trim());

    expect(result).toMatchObject({
      parserVersion: '3.1.3',
      firstInstall: true,
      secondInstall: false,
      invalidErrors: Array(14).fill('Illegal attachments'),
      decoded: {
        type: 2,
        nsp: '/',
        data: ['event', { ok: true }],
      },
      binaryEvent: {
        type: 5,
        nsp: '/',
        data: ['event', { type: 'Buffer', data: [1, 2, 3] }],
      },
      binaryEventReconstructorReleased: true,
      binaryAck: {
        type: 6,
        nsp: '/',
        id: 7,
        data: [{ type: 'Buffer', data: [4, 5] }],
      },
      binaryAckReconstructorReleased: true,
      tenAttachmentReconstructorReleased: true,
    });
    expect(result.tenAttachmentPacket?.data?.slice(1)).toHaveLength(10);
  });

  test('CHZZK client loader installs the guard before importing socket.io-client', () => {
    const source = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
    const loaderStart = source.indexOf('async function getIoClient()');
    const loaderEnd = source.indexOf('// Utility: get KST date', loaderStart);
    const loader = source.slice(loaderStart, loaderEnd);
    expect(loader).toContain("await import('socket.io-parser')");
    expect(loader).toContain('installChzzkSocketIo2ParserGuard(parserModule)');
    expect(loader.indexOf("await import('socket.io-parser')")).toBeLessThan(loader.indexOf("await import('socket.io-client')"));
  });
});
