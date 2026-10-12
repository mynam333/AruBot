import { randomUUID } from 'node:crypto';
import { assertSafeTextPayload } from '../shared/text-safety.js';
import { isCommandSafetyError } from './command-execution-safety.js';

const SPECIAL_TOKEN_RE = /\$\{\s*(roulette|action|automation|blueprint)::([^{}]+)\s*\}/gi;
const DONOR_TOKEN_RE = /\$\{\s*(username|amount|message)\s*\}|\{donation\.(username|amount|message)\}|\{user\.(name|username|nickname|id)\}/g;

export async function renderDonationResponse(template, context, dependencies) {
  const {
    commandExecution,
    substituteAllPlaceholders,
    executeAndStripActionVariableTokens,
    enqueueRouletteSpin,
  } = dependencies;
  const { sid, provider, userId, username, amount, message, chatPost, channelUid, source, ruleId, ruleName } = context;

  return commandExecution.run(sid, `donation:${provider}:${ruleId || ruleName || 'response'}`, async () => {
    assertSafeTextPayload([template, context]);
    const actionTokens = [];
    let rouletteName = null;
    // Only the saved template can authorize execution, never rendered donor data.
    const plannedText = String(template || '').trim().replace(SPECIAL_TOKEN_RE, (token, type, target) => {
      if (type.toLowerCase() === 'roulette') {
        if (rouletteName === null) rouletteName = target.trim();
      } else if (target.trim()) {
        actionTokens.push(token);
      }
      return '';
    });

    const donation = { amount, message, username, currency: 'KRW' };
    const values = [];
    const prefix = `__donation_${randomUUID()}_`;
    // Restore data once, after read-only global rendering, including literal $ and braces.
    const protectedText = plannedText.replace(DONOR_TOKEN_RE, (_token, legacyKey, donationKey, userKey) => {
      const value = userKey ? (userKey === 'id' ? userId : username) : donation[legacyKey || donationKey];
      values.push(String(value ?? ''));
      return `${prefix}${values.length - 1}__`;
    });
    const errors = [];
    const features = [];
    let actionJobs = [];
    const recordError = (phase, error) => {
      if (isCommandSafetyError(error)) throw error;
      errors.push({ phase, error });
    };
    let rendered = protectedText;
    try {
      rendered = await substituteAllPlaceholders(protectedText, sid, userId, username, { provider });
    } catch (error) {
      recordError('placeholders', error);
    }
    const text = String(rendered ?? '').replace(new RegExp(`${prefix}(\\d+)__`, 'g'), (token, index) => values[Number(index)] ?? token).trim();
    assertSafeTextPayload(text);
    commandExecution.check();

    if (rouletteName) {
      try {
        await enqueueRouletteSpin(sid, {
          name: rouletteName,
          userId,
          username,
          chatPost,
          instant: false,
          eventContext: { source, triggerName: ruleName || null },
        });
        features.push('roulette');
      } catch (error) {
        recordError('roulette', error);
      }
    }
    if (actionTokens.length) {
      commandExecution.check();
      features.push('action');
      try {
        const result = await executeAndStripActionVariableTokens(sid, actionTokens.join('\n'), {
          source,
          platform: provider,
          requirePublishedBlueprint: true,
          trigger: { message, keyword: ruleName || '', platform: provider },
          donation,
          user: { userId, username },
          chatPost,
          channelUid: channelUid || null,
          channel: { channelUid: channelUid || null },
        });
        actionJobs = result.jobs || [];
        for (const job of actionJobs) {
          if (job?.ok !== false && job?.result?.ok !== false) continue;
          const reason = job.error || job.result?.error || 'action_execution_failed';
          const error = Object.assign(new Error(`${job.actionId || 'action'}: ${reason}`), {
            code: job.errorCode || job.result?.errorCode || reason,
          });
          recordError('action', error);
        }
      } catch (error) {
        recordError('action', error);
      }
    }
    commandExecution.check();
    return { text, features, actionJobs, errors };
  });
}
