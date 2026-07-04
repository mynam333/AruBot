const fs = require('fs');
const path = require('path');

const serverIndex = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

describe('bot self echo regression', () => {
  test('outbound chat messages are remembered for self-echo suppression', () => {
    expect(serverIndex).toContain('function rememberOutboundMessage(entry, text)');
    expect(serverIndex).toContain('function hasRecentOutboundMessage(entry, text');
    expect(serverIndex).toContain('rememberOutboundMessage(sessionStore.get(sid), text.slice(0, 100))');
    expect(serverIndex).toContain('rememberOutboundMessage(cimeSessionStore.get(ownerUserId), text.slice(0, 100))');
    expect(serverIndex).toContain('rememberYoutubeOutbound(youtubeSessionStore.get(ownerUserId), messageText)');
  });

  test('CHZZK bot messages stop before attendance, points, and command processing', () => {
    const start = serverIndex.indexOf("socket.on('CHAT'");
    const end = serverIndex.indexOf('// Channel Points: when live', start);
    const body = serverIndex.slice(start, end);

    expect(body).toContain('isLikelyChzzkBotSelfEcho(entry, sid, msg, ev, resolvedUserId)');
    expect(body).toContain('if (isBotSelf) return');
  });

  test('YouTube bot channel messages are ignored before command processing', () => {
    const helperStart = serverIndex.indexOf('function isLikelyYoutubeSelfEcho');
    const helperEnd = serverIndex.indexOf('function isYoutubeAuthorPrivilegedForModeration', helperStart);
    const helperBody = serverIndex.slice(helperStart, helperEnd);
    const processStart = serverIndex.indexOf('async function processYoutubeChatAutomation');
    const processEnd = serverIndex.indexOf('async function processCimeChatAutomation', processStart);
    const processBody = serverIndex.slice(processStart, processEnd);

    expect(helperBody).toContain('authorId === String(entry.botChannelId)');
    expect(processBody).toContain('const isBotSelf = isLikelyYoutubeSelfEcho(entry, ev)');
    expect(processBody).toContain('if (isBotSelf || settings.botEnabled === false) return');
  });

  test('CIME self-echo messages are ignored before command processing', () => {
    const helperStart = serverIndex.indexOf('async function isLikelyCimeBotSelfEcho');
    const helperEnd = serverIndex.indexOf('async function sendCimeChat', helperStart);
    const helperBody = serverIndex.slice(helperStart, helperEnd);
    const processStart = serverIndex.indexOf('async function processCimeChatAutomation');
    const processEnd = serverIndex.indexOf('async function processCimeDonationAutomation', processStart);
    const processBody = serverIndex.slice(processStart, processEnd);

    expect(helperBody).toContain('hasRecentOutboundMessage(entry, text) && selfIds.has(userId)');
    expect(processBody).toContain('const isBotSelf = await isLikelyCimeBotSelfEcho(entry, ownerUserId, ev, resolvedUserId)');
    expect(processBody).toContain('if (isBotSelf) return');
  });
});
