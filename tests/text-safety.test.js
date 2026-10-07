const fs = require('fs');
const path = require('path');
const loadSource = require('./helpers/load-source.cjs');
const loadServerFunctions = require('./helpers/load-server-functions.cjs');
const safety = loadSource('shared/text-safety.js');
const matcher = loadSource('server/command-keyword.js', { '../shared/text-safety.js': safety });
const { hasZalgoText, inspectTextPayload, createSafeJsonReplacer } = safety;
const zalgo = 'a\u0301\u0300\u0302\u0303';

test.each([
  'English 123', '\ud55c\uae00 \ucd9c\uc11d', '\u1112\u1161\u11ab\u1100\u1173\u11af',
  'caf\u00e9', 'cafe\u0301', 'Vi\u1ec7t Nam', 'Vi\u0065\u0323\u0302t Nam',
  '\u0645\u064f\u062d\u064e\u0645\u064e\u0651\u062f', '\u0e19\u0e35\u0e48',
  '\ud83d\udc69\u200d\ud83d\udcbb', '\u2764\ufe0f', '\u0031\ufe0f\u20e3',
])('preserves legitimate Unicode: %s', (value) => {
  expect(hasZalgoText(value)).toBe(false);
  expect(JSON.parse(JSON.stringify({ value }, createSafeJsonReplacer())).value).toBe(value);
});

test.each([
  zalgo, 'a\u0301\u0301', '\u00e1\u0300\u0302\u0303',
  'a\u0301\u200d\u0300\ufe0f\u0302\u0303',
  'a' + '\u{1d185}'.repeat(4), 'a' + '\u200d'.repeat(17),
])('rejects stacked/repeated marks, including alternate encodings', (value) => {
  expect(hasZalgoText(value)).toBe(true);
  expect(inspectTextPayload({ nested: [{ message: value }] })).toBe('zalgo_text_not_allowed');
});

test('checks decoded JSON values and property names', () => {
  expect(inspectTextPayload(JSON.parse('{"message":"a\\u0301\\u0300\\u0302\\u0303"}'))).toBe('zalgo_text_not_allowed');
  expect(inspectTextPayload({ [zalgo]: 1 })).toBe('zalgo_text_not_allowed');
});

test('rejects nested serialized OBS settings, including double encoding', () => {
  const inputSettingsJson = '{"text":"a\\u0301\\u0301\\u0301\\u0301"}';
  expect(hasZalgoText(inputSettingsJson)).toBe(false);
  expect(inspectTextPayload({ inputSettingsJson })).toBe('zalgo_text_not_allowed');
  expect(inspectTextPayload({ inputSettingsJson: JSON.stringify(inputSettingsJson) })).toBe('zalgo_text_not_allowed');
  expect(inspectTextPayload({ inputSettingsJson: '{"text":"cafe\\u0301"}' })).toBeNull();
  expect(inspectTextPayload({ text: '${points} {viewer}', message: '"quoted text"' })).toBeNull();
});

test('never queues or delivers unsafe legacy automation jobs to the local OBS client', async () => {
  const bad = { id: 'bad', payload: { inputSettingsJson: '{"text":"a\\u0301\\u0301\\u0301\\u0301"}' } };
  const good = { id: 'good', payload: { text: 'hello' } };
  const enqueueAutomationJob = jest.fn();
  const { queueAutomationJob } = loadServerFunctions(['queueAutomationJob'], { enqueueAutomationJob });
  await expect(queueAutomationJob('owner', bad)).rejects.toMatchObject({ code: 'zalgo_text_not_allowed' });
  expect(enqueueAutomationJob).not.toHaveBeenCalled();
  const completeAutomationJobForAgent = jest.fn(async () => null);
  const route = loadServerFunctions.route('/api/automations/local-agent/jobs/claim', {
    touchAutomationLocalAgent: async () => {}, claimAutomationJobsForAgent: async () => [bad, good], completeAutomationJobForAgent,
  }, 'post');
  const agent = { id: 'agent', ownerUserId: 'owner' };
  const res = { json: jest.fn() };
  await route({ automationLocalAgent: agent, body: {} }, res);
  expect(res.json).toHaveBeenCalledWith({ jobs: [good] });
  expect(completeAutomationJobForAgent).toHaveBeenCalledWith(agent, 'bad', { status: 'failed', errorMessage: 'zalgo_text_not_allowed' });
});

test('bounds nesting and work without traversing binary uploads', () => {
  let nested = {};
  for (let i = 0; i < 50; i += 1) nested = { nested };
  expect(inspectTextPayload(nested)).toBe('payload_too_complex');
  expect(inspectTextPayload([1, 2, 3], { maxNodes: 2 })).toBe('payload_too_complex');
  expect(inspectTextPayload(Buffer.alloc(16 * 1024 * 1024))).toBeNull();
  const drawing = { document: { strokes: Array.from({ length: 20000 }, () => [1, 2, 3, 4, 5]) } };
  expect(inspectTextPayload(drawing)).toBeNull();
});

test('sanitizes legacy display text without changing signed drawing data', () => {
  const value = { nickname: zalgo, canvas: { document: { layers: [{ name: zalgo }], strokes: [[1, 2, 3]] } } };
  const result = JSON.parse(JSON.stringify(value, createSafeJsonReplacer()));
  expect(result.nickname).toBe('a');
  expect(result.canvas.document).toEqual(value.canvas.document);
  expect(inspectTextPayload(value)).toBe('zalgo_text_not_allowed');
});

test('rejects command arguments and legacy rules rather than executing sanitized input', () => {
  expect(matcher.findCommandKeywordMatch(`!go ${zalgo}`, ['!go'])).toBeNull();
  expect(matcher.getCommandRuleMatches('!go', [{ keywords: ['!go'], response: zalgo }])).toEqual([]);
  expect(matcher.findCommandKeywordMatch('!go cafe\u0301', ['!go']).argsText).toBe('cafe\u0301');
});

test('rejects YouTube events before dedupe, points or command processing', () => {
  const processYoutubeChatAutomation = jest.fn(async () => {});
  const { handleYoutubeParsedLiveChatEvent } = loadServerFunctions(['handleYoutubeParsedLiveChatEvent', 'pushEvent'], {
    MAX_QUEUE: 20, processYoutubeChatAutomation, processYoutubeDonationAutomation: jest.fn(async () => {}),
  });
  const entry = { processedIds: new Set(), queue: [] };
  expect(handleYoutubeParsedLiveChatEvent(entry, 'CHAT', { id: 'bad', message: zalgo })).toBe(false);
  expect(entry.processedIds.size).toBe(0);
  expect(entry.queue).toEqual([]);
  expect(processYoutubeChatAutomation).not.toHaveBeenCalled();
  expect(handleYoutubeParsedLiveChatEvent(entry, 'CHAT', { id: 'ok', message: '!go' })).toBe(true);
  expect(processYoutubeChatAutomation).toHaveBeenCalledTimes(1);
});

test('blocks legacy blueprint and local-program actions before side effects', async () => {
  const insertActionBlueprintRun = jest.fn();
  const { executeActionBlueprint, executeActionVariableTokens, broadcastToDesktop, enqueueWarudoEvent } = loadServerFunctions([
    'executeActionBlueprint', 'executeActionVariableTokens', 'broadcastToDesktop', 'enqueueWarudoEvent',
  ], { getRuntimeActionBlueprint: async () => ({ enabled: true, version: { nodes: [{ text: zalgo }] } }), insertActionBlueprintRun });
  expect(await executeActionBlueprint('owner', 'action')).toEqual({ ok: false, error: 'zalgo_text_not_allowed' });
  expect(insertActionBlueprintRun).not.toHaveBeenCalled();
  await expect(executeActionVariableTokens('user:owner', zalgo)).rejects.toMatchObject({ code: 'zalgo_text_not_allowed' });
  expect(broadcastToDesktop('owner', { text: zalgo })).toBe(0);
  expect(enqueueWarudoEvent('owner', { text: zalgo })).toBe(false);
});

test('guards CHZZK and CIME ingress and all chat send helpers', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server/index.js'), 'utf8');
  for (const event of ['CHAT', 'DONATION', 'SUBSCRIPTION']) {
    const start = source.indexOf(`socket.on('${event}', (raw)`);
    expect(source.slice(start, start + 350)).toContain('if (inspectTextPayload(msg)) return;');
  }
  expect(source).toContain('const { eventName, ev } = parsed;\n        if (inspectTextPayload(ev)) return;');
  const senders = loadServerFunctions(['sendChatByPost', 'sendCimeChat', 'sendYoutubeChat']);
  await expect(senders.sendChatByPost('sid', {}, zalgo)).rejects.toMatchObject({ code: 'zalgo_text_not_allowed' });
  await expect(senders.sendCimeChat('owner', zalgo)).rejects.toMatchObject({ code: 'zalgo_text_not_allowed' });
  await expect(senders.sendYoutubeChat('owner', 'chat', zalgo)).rejects.toMatchObject({ code: 'zalgo_text_not_allowed' });
});

test('rejects percent-encoded Zalgo filenames before writing sound assets', async () => {
  const writeFileSync = jest.fn();
  const route = loadServerFunctions.route('/api/automations/assets/sounds', {
    Buffer, getCurrentSessionUserId: async () => 'owner',
    AUTOMATION_SOUND_MAX_FILE_BYTES: 5000, AUTOMATION_SOUND_QUOTA_BYTES: 10000,
    listAutomationSoundFiles: () => ({ usedBytes: 0 }), fs: { writeFileSync },
  }, 'post');
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await route({ body: Buffer.from('test audio'), query: {}, get: () => encodeURIComponent(`${zalgo}.mp3`) }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(writeFileSync).not.toHaveBeenCalled();
});
