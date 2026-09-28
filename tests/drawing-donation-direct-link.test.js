const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const loadSource = require('./helpers/load-source.cjs');
const routing = loadSource('server/public-channel-routing.js');

function harness() {
  const identity = { ownerUserId: 'streamer-owner', provider: 'chzzk', channelUid: 'public-channel' };
  const bindings = {
    ...routing,
    listPlatformAccounts: jest.fn(async (owner) => owner === 'streamer-owner'
      ? [{ provider: 'chzzk', channel_id: 'public-channel', channel_name: 'Streamer' }]
      : [{ provider: 'chzzk', channel_id: 'viewer-channel' }]),
    collectViewerPointIdentityKeys: jest.fn().mockReturnValue(['viewer-owner', 'viewer-channel']),
    listViewerPointBalancesForUserIds: jest.fn().mockResolvedValue([]),
    getBotSettings: jest.fn().mockResolvedValue({ drawingDonation: { enabled: true, costPoints: 100 } }),
    findBlockedBotUser: jest.fn().mockReturnValue(null),
    collectDrawingLiveSurfacesForSid: jest.fn().mockResolvedValue([]),
  };
  const functions = loadServerFunctions([
    'collectViewerDrawingDonationStreamers', 'resolveDrawingDonationSettingsForBalance',
    'normalizeDrawingDonationSettings', 'getDefaultDrawingDonationSettings', 'applyDrawingPointCost',
  ], bindings);
  const routeBindings = {
    ...bindings, ...functions,
    getCurrentSessionUserId: jest.fn().mockResolvedValue('viewer-owner'),
    resolveVerifiedPublicChannelIdentity: jest.fn().mockResolvedValue(identity),
  };
  return {
    ...bindings, ...functions, ...routeBindings, identity,
    route: loadServerFunctions.route('/api/viewer/drawing-donation/streamers/:channelUid', routeBindings),
  };
}

function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('drawing donation direct links', () => {
  test('a signed-in first-time viewer can open an enabled streamer with no point history', async () => {
    const h = harness();
    const res = response();
    await h.route({ params: { channelUid: 'chzzk:public-channel' } }, res);

    expect(res.status).not.toHaveBeenCalled();
    const { streamer } = res.json.mock.calls[0][0];
    expect(streamer).toMatchObject({
      publicUid: 'chzzk:public-channel', channelName: 'Streamer',
      canonicalChannelUid: 'streamer-owner', points: 0, identities: [],
      drawingDonation: { enabled: true, costPoints: 100 },
    });
    expect(streamer.pointSettingsSid).toBe('user:streamer-owner');
    expect(JSON.parse(JSON.stringify(streamer))).not.toHaveProperty('pointSettingsSid');
    expect(h.getBotSettings).toHaveBeenCalledWith('user:streamer-owner');
  });

  test('preserves actual point balances instead of adding a duplicate zero-point streamer', async () => {
    const h = harness();
    h.listViewerPointBalancesForUserIds.mockResolvedValue([{
      channelUid: 'public-channel', canonicalChannelUid: 'streamer-owner', provider: 'chzzk',
      pointSettingsSid: 'user:streamer-owner', points: 250,
      identities: [{ userId: 'viewer-channel', points: 250 }],
    }]);
    const data = await h.collectViewerDrawingDonationStreamers('viewer-owner', { channelIdentity: h.identity });
    expect(data.streamers).toHaveLength(1);
    expect(data.streamers[0].points).toBe(250);
  });

  test('disabled drawing donations and unknown channel identities still return not available', async () => {
    const h = harness();
    h.getBotSettings.mockResolvedValue({ drawingDonation: { enabled: false } });
    const disabled = response();
    await h.route({ params: { channelUid: 'chzzk:public-channel' } }, disabled);
    expect(disabled.status).toHaveBeenCalledWith(404);

    h.resolveVerifiedPublicChannelIdentity.mockResolvedValue(null);
    h.getBotSettings.mockClear();
    const unknown = response();
    await h.route({ params: { channelUid: 'chzzk:unknown' } }, unknown);
    expect(unknown.status).toHaveBeenCalledWith(404);
    expect(h.getBotSettings).not.toHaveBeenCalled();
  });

  test('still requires login before resolving channel settings', async () => {
    const h = harness();
    h.getCurrentSessionUserId.mockResolvedValue(null);
    const res = response();
    await h.route({ params: { channelUid: 'chzzk:public-channel' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(h.resolveVerifiedPublicChannelIdentity).not.toHaveBeenCalled();
  });

  test('direct links retain blocked-user checks and cannot spend nonexistent points', async () => {
    const h = harness();
    h.findBlockedBotUser.mockReturnValue({ reason: 'blocked' });
    const data = await h.collectViewerDrawingDonationStreamers('viewer-owner', {
      channelIdentity: h.identity, includeLiveSurfaces: false,
    });
    const streamer = routing.findViewerDrawingStreamer(data.streamers, 'chzzk:public-channel', h.identity);
    expect(streamer.drawingDonation).toMatchObject({ blocked: true, blockReason: 'blocked' });
    expect(h.applyDrawingPointCost(streamer, 100)).toMatchObject({ ok: false, remaining: 100 });
    expect(h.collectDrawingLiveSurfacesForSid).not.toHaveBeenCalled();
  });
});
