const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

describe('action blueprint point condition runtime', () => {
  let result;

  beforeAll(() => {
    const root = path.join(__dirname, '..');
    const valuesUrl = pathToFileURL(path.join(root, 'server', 'action-blueprint-values.js')).href;
    const script = `
      import fs from 'node:fs';
      const values = await import(${JSON.stringify(valuesUrl)});

      const source = fs.readFileSync('./server/index.js', 'utf8');
      const runtimeStart = source.indexOf('async function executeActionBlueprint');
      const runtimeEnd = source.indexOf('const PVD_PROVIDER_KEYS', runtimeStart);
      if (runtimeStart < 0 || runtimeEnd < 0) throw new Error('executeActionBlueprint source was not found');
      const runtimeSource = source.slice(runtimeStart, runtimeEnd);

      const blueprint = {
        id: 'point-condition',
        slug: 'point-condition',
        enabled: true,
        version: {
          id: 'point-condition-v1',
          published: true,
          nodes: [
            { id: 'start', type: 'start', config: {} },
            { id: 'condition', type: 'condition', config: { left: '{user.points}', operator: 'gte', right: '1000' } },
            { id: 'true-log', type: 'log', config: { message: 'true branch' } },
            { id: 'false-log', type: 'log', config: { message: 'false branch' } },
            { id: 'true-end', type: 'end', config: { message: 'true done' } },
            { id: 'false-end', type: 'end', config: { message: 'false done' } },
          ],
          edges: [
            { source: 'start', sourcePort: 'out', target: 'condition', targetPort: 'in' },
            { source: 'condition', sourcePort: 'true', target: 'true-log', targetPort: 'in' },
            { source: 'condition', sourcePort: 'false', target: 'false-log', targetPort: 'in' },
            { source: 'true-log', sourcePort: 'out', target: 'true-end', targetPort: 'in' },
            { source: 'false-log', sourcePort: 'out', target: 'false-end', targetPort: 'in' },
          ],
        },
      };

      let storedPoints = 0;
      let pointCalls = 0;
      let runSequence = 0;
      let recordedSteps = [];
      const dependencies = {
        getRuntimeActionBlueprint: async () => blueprint,
        normalizeBlueprintEdges: (edges) => Array.isArray(edges) ? edges : [],
        blueprintOutputPorts: (node) => node.type === 'end' ? [] : (
          ['condition', 'pointsEnough', 'pointsExcluded', 'rouletteCompare', 'cooldown', 'loop'].includes(node.type)
            ? ['true', 'false']
            : ['out']
        ),
        validateBlueprintGraph: () => [],
        insertActionBlueprintRun: async (_ownerUserId, run) => ({ id: 'run-' + (++runSequence), ...run }),
        finishActionBlueprintRun: async (_ownerUserId, id, update) => ({ id, ...update }),
        insertActionBlueprintRunStep: async (_ownerUserId, step) => {
          JSON.stringify(step.input);
          JSON.stringify(step.output);
          recordedSteps.push({
            nodeId: step.nodeId,
            nodeType: step.nodeType,
            status: step.status,
            output: step.nodeType === 'condition' ? step.output : undefined,
          });
          return step;
        },
        createActionBlueprintVariableResolvers: () => ({
          loadUserPoints: async () => {
            pointCalls += 1;
            return storedPoints;
          },
        }),
        getKstDateString: () => '2026-08-13',
        ...values,
      };
      const executeActionBlueprint = Function(
        ...Object.keys(dependencies),
        runtimeSource + '\\nreturn executeActionBlueprint;'
      )(...Object.values(dependencies));

      const executeBoundary = async (points) => {
        storedPoints = points;
        pointCalls = 0;
        runSequence = 0;
        recordedSteps = [];
        const execution = await executeActionBlueprint('owner-1', blueprint.id, {
          source: 'chat-command',
          platform: 'chzzk',
          trigger: { platform: 'chzzk' },
          user: { userId: 'viewer-1', username: 'Viewer' },
          channelUid: 'live-channel-1',
        });
        return {
          ok: execution.ok,
          error: execution.error,
          executed: execution.executed,
          condition: execution.nodeOutputs?.condition,
          terminal: execution.result,
          pointCalls,
          recordedSteps,
        };
      };

      const resolverStart = source.indexOf('async function resolveBlueprintChannelUid');
      const resolverEnd = source.indexOf('const BLUEPRINT_VARIABLE_LOOKUP_TIMEOUT_MS', resolverStart);
      if (resolverStart < 0 || resolverEnd < 0) throw new Error('resolveBlueprintChannelUid source was not found');
      const resolverSource = source.slice(resolverStart, resolverEnd);
      const ownerLookups = [];
      const resolveBlueprintChannelUid = Function(
        'resolveStreamerUidForSid',
        resolverSource + '\\nreturn resolveBlueprintChannelUid;'
      )(async (sid, provider) => {
        ownerLookups.push({ sid, provider });
        return null;
      });
      const directFallback = await resolveBlueprintChannelUid('owner-1', {
        source: 'chat-command',
        platform: 'chzzk',
        trigger: { platform: 'chzzk' },
        channelUid: 'live-channel-1',
      });

      const cimePostStart = source.indexOf('function makeCimeChatPost');
      const cimePostEnd = source.indexOf('function rememberOutboundMessage', cimePostStart);
      const makeCimeChatPost = Function(
        'cimeSessionStore',
        source.slice(cimePostStart, cimePostEnd) + '\\nreturn makeCimeChatPost;'
      )(new Map([['owner-1', { channelId: 'cime-channel-1' }]]));
      const youtubePostStart = source.indexOf('function makeYoutubeChatPost');
      const youtubePostEnd = source.indexOf('function isYoutubeReauthRequired', youtubePostStart);
      const makeYoutubeChatPost = Function(
        'youtubeSessionStore',
        source.slice(youtubePostStart, youtubePostEnd) + '\\nreturn makeYoutubeChatPost;'
      )(new Map([['owner-1', { channelId: 'youtube-channel-1' }]]));

      console.log(JSON.stringify({
        below: await executeBoundary(999),
        boundary: await executeBoundary(1000),
        directFallback,
        ownerLookups,
        providerChatPosts: {
          cime: makeCimeChatPost('owner-1', 'Viewer'),
          youtube: makeYoutubeChatPost('owner-1', 'live-chat-1', 'Viewer'),
        },
      }));
    `;

    result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: root,
      encoding: 'utf8',
    }).trim());
  });

  test('routes a 999-point viewer through the false edge', () => {
    expect(result.below).toMatchObject({
      ok: true,
      executed: ['start', 'condition', 'false-log', 'false-end'],
      condition: { passed: false, left: 999, right: 1000 },
      terminal: { status: 'success', message: 'false done' },
      pointCalls: 1,
    });
    expect(result.below.recordedSteps.map((step) => step.nodeId)).toEqual([
      'start', 'condition', 'false-log', 'false-end',
    ]);
  });

  test('routes the exact 1000-point boundary through the true edge', () => {
    expect(result.boundary).toMatchObject({
      ok: true,
      executed: ['start', 'condition', 'true-log', 'true-end'],
      condition: { passed: true, left: 1000, right: 1000 },
      terminal: { status: 'success', message: 'true done' },
      pointCalls: 1,
    });
    expect(result.boundary.recordedSteps.map((step) => step.nodeId)).toEqual([
      'start', 'condition', 'true-log', 'true-end',
    ]);
  });

  test('uses the trusted runtime channel without waiting for platform metadata', () => {
    expect(result.ownerLookups).toEqual([]);
    expect(result.directFallback).toBe('live-channel-1');
  });

  test('carries the exact CIME and YouTube channel through roulette-result action contexts', () => {
    expect(result.providerChatPosts.cime).toMatchObject({ provider: 'cime', channelUid: 'cime-channel-1' });
    expect(result.providerChatPosts.youtube).toMatchObject({ provider: 'youtube', channelUid: 'youtube-channel-1' });
  });
});
