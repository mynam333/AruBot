import { assertSafeTextPayload } from '../shared/text-safety.js';
import { isCommandSafetyError } from './command-execution-safety.js';

const TOKEN_RE = /\$\{\s*(?:pngtuber|짚톡)(?=::|\s*\})([^}]*)\}/gi;

export function getPngtuberActionTokenCounts(template) {
  const counts = new Map();
  for (const [token] of String(template || '').matchAll(TOKEN_RE)) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function invalid(code) {
  return Object.assign(new Error(code), { code });
}

export function parsePngtuberAction(token) {
  const match = /^\$\{\s*(?:pngtuber|짚톡)::([^{}]*)\}$/i.exec(String(token || ''));
  if (!match) throw invalid('pngtuber_invalid_token');
  const parts = match[1].split('::');
  if (parts.length > 2) throw invalid('pngtuber_invalid_token');
  const reactionId = parts[0].trim();
  // This is a local preset lookup only, never an asset URL or filesystem path.
  if (!reactionId || reactionId.length > 80 || /^[.]{1,2}$/.test(reactionId)
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029/\\:{}$<>|?*%]/.test(reactionId)) {
    throw invalid('pngtuber_invalid_reaction');
  }
  const payload = { reactionId };
  if (parts.length === 2) {
    const raw = parts[1].trim();
    const durationSec = Number(raw);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)
      || !Number.isFinite(durationSec) || durationSec < 0.1 || durationSec > 300) {
      throw invalid('pngtuber_invalid_duration');
    }
    payload.durationSec = durationSec;
  }
  return payload;
}

export async function executePngtuberActionTokens(text, context, {
  ownerUserId, commandExecution, queueJob, now = Date.now,
  authorizedTokens = getPngtuberActionTokenCounts(context.responseTemplate),
}) {
  assertSafeTextPayload([text, context]);
  const tokens = [];
  const stripped = String(text || '').replace(TOKEN_RE, token => { tokens.push(token); return ''; }).trim();
  const jobs = [];
  for (const token of tokens) {
    commandExecution.consume('actions');
    let payload;
    try {
      const remaining = authorizedTokens.get(token) || 0;
      if (!remaining) throw invalid('pngtuber_untrusted_token');
      authorizedTokens.set(token, remaining - 1);
      payload = parsePngtuberAction(token);
      if (!ownerUserId) throw invalid('pngtuber_owner_unavailable');
      const dryRun = context.dryRun === true || context.testMode === 'simulation'
        || (context.source === 'manual_test' && context.testMode !== 'connected');
      if (dryRun) {
        jobs.push({ kind: 'pngtuber', jobType: 'pngtuber.show', ...payload, ok: true, dryRun: true,
          delivery: { status: 'simulated', confirmed: false } });
        continue;
      }
      const timestamp = now();
      const job = await queueJob({
        connectionId: null,
        jobType: 'pngtuber.show',
        payload: {
          ...payload,
          expiresAt: timestamp + 60_000,
          source: context.source || 'action_variable',
          platform: context.platform || context.provider || context.chatPost?.provider || null,
          command: context.command || null,
          donation: context.donation || null,
          roulette: context.roulette || null,
          result: context.result || null,
          user: context.user || null,
          noPointCost: context.noPointCost === true,
          replayNoCost: context.replayNoCost === true,
          createdAt: new Date(timestamp).toISOString(),
        },
      });
      if (!job?.id) throw invalid('pngtuber_job_not_queued');
      jobs.push({ kind: 'pngtuber', jobType: 'pngtuber.show', ...payload, jobId: job.id, job, ok: true,
        delivery: { status: 'queued', confirmed: false } });
    } catch (error) {
      if (isCommandSafetyError(error)) throw error;
      jobs.push({ kind: 'pngtuber', jobType: 'pngtuber.show', ...payload, ok: false,
        error: error?.message || 'pngtuber_job_failed', errorCode: error?.code || 'pngtuber_job_failed',
        delivery: { status: 'not_sent', confirmed: false } });
    }
  }
  const failures = jobs.filter(job => job.ok === false);
  return {
    text: [stripped, ...failures.map(job => `PNGTuber: ${/^pngtuber_\w+$/.test(job.errorCode) ? job.errorCode : 'pngtuber_job_failed'}`)].filter(Boolean).join('\n'),
    used: tokens.length > 0,
    jobs,
  };
}
