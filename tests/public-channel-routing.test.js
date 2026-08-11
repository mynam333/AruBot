const path = require('path');
const { execFileSync } = require('child_process');

describe('provider-qualified public channel routing', () => {
  test('keeps one verified owner from public entry through drawing submission', () => {
    const moduleUrl = new URL(
      '../server/public-channel-routing.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      const {
        attachInternalPointSettingsSid,
        createBoundedOperationRunner,
        findViewerDrawingStreamer,
        publicChannelUidForBalance,
      } = await import(${JSON.stringify(moduleUrl)});
      const streamers = [
        { channelUid: 'same', publicUid: 'chzzk:same', canonicalChannelUid: 'owner-a' },
        { channelUid: 'same', publicUid: 'youtube:same', canonicalChannelUid: 'owner-b' },
      ];
      const internalStreamer = attachInternalPointSettingsSid(
        { channelUid: 'drawing-channel' },
        'user:drawing-owner',
      );
      console.log(JSON.stringify({
        chzzkUid: publicChannelUidForBalance({ provider: 'chzzk', channelUid: 'same' }),
        youtubeUid: publicChannelUidForBalance({ provider: 'youtube', channelUid: 'same' }),
        prefixedStaysPrefixed: publicChannelUidForBalance({ provider: 'youtube', channelUid: 'youtube:same' }),
        verifiedCurrentOwner: findViewerDrawingStreamer(streamers, 'youtube:same', { ownerUserId: 'owner-b' }),
        reassignedAlias: findViewerDrawingStreamer(streamers, 'youtube:same', { ownerUserId: 'owner-a' }),
        unresolvedQualified: findViewerDrawingStreamer(streamers, 'youtube:same', null),
        ambiguousRaw: findViewerDrawingStreamer(streamers, 'same', null),
        uniqueLegacyRaw: findViewerDrawingStreamer([streamers[0]], 'same', null),
        internalSid: internalStreamer.pointSettingsSid,
        serializedInternalStreamer: JSON.stringify(internalStreamer),
      }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());

    expect(result).toMatchObject({
      chzzkUid: 'chzzk:same',
      youtubeUid: 'youtube:same',
      prefixedStaysPrefixed: 'youtube:same',
      verifiedCurrentOwner: { canonicalChannelUid: 'owner-b' },
      reassignedAlias: { canonicalChannelUid: 'owner-a' },
      unresolvedQualified: null,
      ambiguousRaw: null,
      uniqueLegacyRaw: { canonicalChannelUid: 'owner-a' },
      internalSid: 'user:drawing-owner',
      serializedInternalStreamer: '{"channelUid":"drawing-channel"}',
    });
  });

  test('rejects work before it starts when the operation cap is full', () => {
    const moduleUrl = new URL(
      '../server/public-channel-routing.js',
      `file://${__filename.replace(/\\/g, '/')}`,
    ).href;
    const script = `
      const { createBoundedOperationRunner } = await import(${JSON.stringify(moduleUrl)});
      const run = createBoundedOperationRunner({ maxInFlight: 2, timeoutMs: 30 });
      let started = 0;
      let release;
      const blocker = new Promise((resolve) => { release = resolve; });
      const first = run(async () => { started += 1; await blocker; return 1; });
      const second = run(async () => { started += 1; await blocker; return 2; });
      await Promise.resolve();
      let overload = null;
      try {
        await run(async () => { started += 1; return 3; });
      } catch (error) {
        overload = { code: error.code, status: error.status };
      }
      release();
      console.log(JSON.stringify({ started, overload, values: await Promise.all([first, second]) }));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    }).trim());

    expect(result).toEqual({
      started: 2,
      overload: { code: 'temporarily_unavailable', status: 503 },
      values: [1, 2],
    });
  });
});
