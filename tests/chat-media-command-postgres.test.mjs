import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import load from './helpers/load-source.cjs';
import loadFunctions from './helpers/load-server-functions.cjs';

test('zero ordinary funds: chat rule fee and per-second media purchase share only the eligible allowance', {
  skip: !process.env.ARUBOT_TEST_POSTGRES_URL, timeout: 45000,
}, async () => {
  const url = new URL(process.env.ARUBOT_TEST_POSTGRES_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname));
  const admin = new pg.Client({ connectionString: url.href });
  await admin.connect();
  const db = 'chat_media_test_' + crypto.randomBytes(8).toString('hex');
  let api, pool, created = false;
  try {
    await admin.query('create database ' + db);
    created = true;
    url.pathname = '/' + db;
    Object.assign(process.env, { ARUBOT_DB_PROVIDER: 'postgres', POSTGRES_RUNTIME_URL: url.href, POSTGRES_SSL: 'false' });
    api = await import('../server/supabase.js');
    pool = new pg.Pool({ connectionString: url.href });
    await pool.query(await readFile(new URL('../server/migrations/038_broadcast_bonus_points.sql', import.meta.url), 'utf8'));
    const sid = 'user:owner';
    await pool.query(`create table platform_accounts(user_id text, provider text, platform_user_id text, channel_id text,
      channel_name text, channel_handle text, avatar_url text, metadata jsonb);
      insert into platform_accounts(user_id,provider,platform_user_id,channel_id) values ('owner','youtube','channel','channel');
      insert into live_sessions(sid,live,last_update) values ('user:owner',true,1)`);
    for (const [kind, fee, rate] of [['video', 20, 2], ['video', 0, 2], ['bgm', 20, 3]]) {
      const viewer = kind + fee, duration = 6, usageFee = rate * duration;
      const categories = fee ? ['command', kind] : [kind];
      await pool.query('update live_sessions set bonus_amount=$2,bonus_categories=$3 where sid=$1', [sid, fee + usageFee, categories]);
      const sent = [], paid = [], jobs = [];
      const bindings = {
        ...load('server/command-keyword.js', { '../shared/text-safety.js': load('shared/text-safety.js'), './rule-pattern.js': load('server/rule-pattern.js') }),
        ...load('server/counter-variables.js'), ...load('shared/songbook-commands.js'),
        ...load('server/pvd-bgm.js'), ...load('server/video-donation-timing.js'), ...load('server/video-donation-queue.js'), crypto,
        getBotSettings: async () => ({ onlyWhenLive: true, channelPointsPerChat: 0, videoDonationAcceptEnabled: true, videoDonationPointsPerSecond: 2,
          bgmEnabled: true, bgmAcceptEnabled: true, bgmPointsPerSecond: 3 }),
        refreshYoutubeLiveStatus: async () => ({ live: true }), isLikelyYoutubeSelfEcho: () => false,
        shouldRecordAttendanceAutomatically: () => false, normalizePointAward: value => value,
        marbleRuntime: { chat: async () => ({ handled: false }) }, participationWheelRuntime: { chat: async () => ({ handled: false }) },
        handlePredictionBetCommand: async () => null, claimBotRuleCooldown: async () => ({ claimed: true }),
        getRuntimeBotRulesWithDefaults: async () => [{ id: 'r', keywords: ['!media'], enabled: true, pointsCost: fee,
          responses: [kind === 'bgm' ? '${bgm_request}' : '${video_donation}'] }],
        deductChannelPointsIfEnough: async (...args) => {
          const result = await api.deductChannelPointsIfEnough(...args);
          paid.push([args[4], result]); return result;
        },
        enqueuePaidDurableRuntimeJob: async input => {
          const result = await api.enqueuePaidDurableRuntimeJob(input);
          jobs.push(result); return result;
        },
        resolvePvdMedia: async () => ({ provider: 'youtube', mediaId: 'video000001', title: 'Test', durationSec: duration }),
        shouldAwaitPvdDurationSync: () => false, findBlockedBotUser: () => false, providerFromLogContext: () => 'youtube',
        getVideoDonationReceiptQueueSize: async () => 1, runDurableRuntimeWorker: async () => {}, recordBotEventLogSafe: async () => {},
        executeCommandLiveChangeTokens: async (_sid, text) => ({ text, executed: [] }), substituteAllPlaceholders: async text => text,
        executeAndStripActionVariableTokens: async () => ({ used: false }), makeYoutubeChatPost: () => ({}), makeCommandReplyKey: () => viewer,
        resolveCommandCounterVariables: async (_plan, text) => text, executeSongbookCommand: async text => text,
        sendYoutubeChat: async (_owner, _chat, text) => sent.push(text), recordCommandExecutionLog: async () => {},
        broadcastToDesktop() {}, emitWarudoEvent() {},
      };
      const { processYoutubeChatAutomation } = loadFunctions(['processYoutubeChatAutomation', 'spendChatCommandPoints', 'enqueueVideoDonationFromArgs'], bindings);
      assert.equal(await api.getChannelPoints('channel', viewer), 0);
      await processYoutubeChatAutomation({ primarySid: sid, ownerUserId: 'owner', channelId: 'channel', remoteIngress: true, sentReplies: new Set() },
        { id: viewer, userId: viewer, user: 'Viewer', message: '!media https://youtu.be/video000001' });
      assert.deepEqual(paid.map(([context, receipt]) => [context, receipt.bonusSpent, receipt.ordinarySpent]),
        fee ? [[{ sid, category: 'command' }, fee, 0]] : []);
      assert.equal(jobs.length, 1);
      const saved = await api.getDurableRuntimeJob(jobs[0].job.id);
      assert.equal(saved.payload.item.kind, kind);
      assert.equal(saved.payload.pointReceipt.bonusSpent, usageFee);
      assert.equal(saved.payload.pointReceipt.ordinarySpent, 0);
      assert.equal(await api.getChannelPoints('channel', viewer), 0);
      assert.equal(Number((await pool.query('select spent from broadcast_bonus_usage where sid=$1 and user_id=$2', [sid, viewer])).rows[0].spent), fee + usageFee);
      assert.match(sent[0], /요청을 접수했습니다/);
    }
  } finally {
    await api?.closeDatabaseConnections();
    await pool?.end();
    if (created) await admin.query('drop database ' + db);
    await admin.end();
  }
});
