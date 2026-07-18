const fs = require('fs');
const path = require('path');

describe('CHZZK live chat auto-connect regression', () => {
  const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

  test('live status refresh ensures a CHZZK chat session when broadcast is open', () => {
    const refreshStart = serverIndex.indexOf('async function refreshChzzkLiveStatusForSid');
    const refreshEnd = serverIndex.indexOf('async function isLiveAllowedForSid', refreshStart);
    const refreshBody = serverIndex.slice(refreshStart, refreshEnd);

    expect(refreshBody).toContain('isChzzkLiveDetailOpen(content)');
    expect(refreshBody).toContain('content?.startedAt || content?.started_at || content?.openDate');
    expect(refreshBody).toContain('parseChzzkLiveTimestamp(candidate, null)');
    expect(refreshBody).toContain('updateSessionState(sid, anyLive');
    expect(refreshBody).toContain('ensureChzzkChatSessionForLiveSid(sid, liveChannelId)');
    expect(refreshBody).toContain('closeChzzkChatSessionForOfflineSid(sid');
  });

  test('live placeholders parse CHZZK string start times instead of treating the stream as offline', () => {
    const detailStart = serverIndex.indexOf('async function fetchLiveDetail');
    const detailEnd = serverIndex.indexOf('// (moved) getPartitionIdByApiKey', detailStart);
    const detailBody = serverIndex.slice(detailStart, detailEnd);

    expect(detailBody).toContain('isChzzkLiveDetailOpen(content)');
    expect(detailBody).toContain('content?.startedAt || content?.started_at || content?.openDate');
    expect(detailBody).toContain('parseChzzkLiveTimestamp(openCandidate, null)');
    expect(detailBody).not.toContain('!Number.isNaN(Number(openCandidate)) ? Number(openCandidate) : null');
  });

  test('live gate refreshes actual status even when onlyWhenLive is disabled', () => {
    const gateStart = serverIndex.indexOf('async function isLiveAllowedForSid');
    const gateEnd = serverIndex.indexOf('// Optional Redis', gateStart);
    const gateBody = serverIndex.slice(gateStart, gateEnd);

    expect(gateBody).not.toContain('if (!onlyWhenLive) return true');
    expect(gateBody).toContain('refreshChzzkLiveStatusForSid(sid, { settings, channelUids })');
    expect(gateBody).toContain('return !onlyWhenLive || !!state.live');
  });

  test('bootstrap keeps token-backed CHZZK sessions in the live watcher set', () => {
    const bootstrapStart = serverIndex.indexOf('async function bootstrapEnsureSessions');
    const bootstrapEnd = serverIndex.indexOf('async function bootstrapEnsureCimeSessions', bootstrapStart);
    const bootstrapBody = serverIndex.slice(bootstrapStart, bootstrapEnd);

    expect(bootstrapBody).toContain('activeSids.set(sid, Date.now())');
    expect(bootstrapBody).toContain('refreshChzzkLiveStatusForSid(sid');
    expect(bootstrapBody).not.toContain('await ensureSession(sid, String(channelId))');
  });

  test('events polling does not recreate CHZZK sessions while offline', () => {
    const eventsStart = serverIndex.indexOf("app.get('/api/chzzk/events'");
    const eventsEnd = serverIndex.indexOf("app.get('/api/cime/events'", eventsStart);
    const eventsBody = serverIndex.slice(eventsStart, eventsEnd);

    expect(eventsBody).toContain('refreshChzzkLiveStatusForSid(sid, { channelUids: [String(channelId)] })');
    expect(eventsBody).toContain('return res.json({ events: [], connected: false, live: false');
    expect(eventsBody.indexOf('if (!liveState.live)')).toBeLessThan(eventsBody.indexOf('await ensureSession(sid, String(channelId))'));
  });

  test('chat and donation processing are gated by actual live status', () => {
    const chatStart = serverIndex.indexOf("socket.on('CHAT'");
    const donationStart = serverIndex.indexOf("socket.on('DONATION'", chatStart);
    const chatBody = serverIndex.slice(chatStart, donationStart);
    const donationEnd = serverIndex.indexOf("socket.on('SUBSCRIPTION'", donationStart);
    const donationBody = serverIndex.slice(donationStart, donationEnd);

    expect(chatBody).toContain('const liveState = await refreshChzzkLiveStatusForSid(sid, { ttlMs: 5000 })');
    expect(chatBody).toContain('if (!liveState.live) return');
    expect(donationBody).toContain('const liveState = await refreshChzzkLiveStatusForSid(sid, { ttlMs: 5000 })');
    expect(donationBody).toContain('if (!liveState.live) return');
  });
});
