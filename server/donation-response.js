import { randomUUID } from 'node:crypto';
import { assertSafeTextPayload } from '../shared/text-safety.js';
import { isCommandSafetyError } from './command-execution-safety.js';
import { prepareCounterVariablePlan } from './counter-variables.js';
import { prepareMemoVariablePlan, resolveMemoVariablePlan } from './memo-variables.js';

const SPECIAL_TOKEN_RE = /\$\{\s*(?:(roulette|action|automation|blueprint)::([^{}]+)|(pngtuber|짚톡)(?=::|\s*\})[^}]*)\s*\}/gi;
const DONOR_TOKEN_RE = /\$\{\s*(username|amount|message)\s*\}|\{donation\.(username|amount|message)\}|\{user\.(name|username|nickname|id)\}/g;

export function dispatchDonationRuleDesktop(rule, context, { broadcastToDesktop, onError = () => {} }) {
  const name = String(rule.name || '').trim();
  if (!name) return { desktopSent: 0, repeatCount: 0 };
  const perAmount = Number(rule.repeatPerAmount);
  const repeatCount = rule.repeatEnabled && Number.isFinite(perAmount) && perAmount > 0 && context.amount >= perAmount
    ? Math.min(100, Math.floor(context.amount / perAmount)) : 1;
  const delay = Math.max(50, Math.min(30000, Number(rule.repeatCooldown) || 0));
  const send = (index) => broadcastToDesktop(context.sid, {
    type: 'command', cmd: name, args: [],
    from: { userId: context.userId || '', username: context.username },
    amount: context.amount, currency: 'KRW',
    ...(repeatCount > 1 ? { repeatIndex: index + 1, repeatTotal: repeatCount } : {}),
    at: Date.now(), source: context.source,
  });
  let desktopSent = 0;
  try { desktopSent = Number(send(0)) || 0; } catch (error) { onError(error); }
  if (repeatCount > 1) {
    void (async () => {
      for (let index = 1; index < repeatCount; index++) {
        await new Promise(resolve => setTimeout(resolve, delay));
        try { send(index); } catch (error) { onError(error); }
      }
    })();
  }
  return { desktopSent, repeatCount };
}

export async function renderDonationResponse(template, context, dependencies) {
  const {
    commandExecution,
    substituteAllPlaceholders,
    executeAndStripActionVariableTokens,
    enqueueRouletteSpin,
    resolveCommandCounterVariables,
    readMemos,
    resolveSongbookPublicUrl,
  } = dependencies;
  const { sid, provider, userId, username, amount, message, chatPost, channelUid, source, ruleId, ruleName } = context;

  return commandExecution.run(sid, `donation:${provider}:${ruleId || ruleName || 'response'}`, async () => {
    assertSafeTextPayload([template, context]);
    const actionTokens = [];
    let hasPngtuber = false;
    let rouletteName = null;
    // Only the saved template can authorize execution, never rendered donor data.
    const plannedText = String(template || '').trim().replace(SPECIAL_TOKEN_RE, (token, type, target, pngtuber) => {
      if (pngtuber) {
        hasPngtuber = true;
        actionTokens.push(token);
      } else if (type.toLowerCase() === 'roulette') {
        if (rouletteName === null) rouletteName = target.trim();
      } else if (target.trim()) {
        actionTokens.push(token);
      }
      return '';
    });

    const counterPlan = prepareCounterVariablePlan(plannedText);
    // Donation messages can read named memos, never overwrite command memos.
    const memoPlan = prepareMemoVariablePlan(counterPlan.text);
    const donation = { amount, message, username, currency: 'KRW' };
    const values = [];
    const prefix = `__donation_${randomUUID()}_`;
    // Restore data once, after read-only global rendering, including literal $ and braces.
    const songbookToken = `${prefix}songbook__`;
    const withSongbook = memoPlan.text.replace(/\$\{\s*songbook_url\s*\}/gi, songbookToken);
    const protectedText = withSongbook.replace(DONOR_TOKEN_RE, (_token, legacyKey, donationKey, userKey) => {
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
    commandExecution.check();
    if (counterPlan.used) {
      try {
        rendered = await resolveCommandCounterVariables(counterPlan, rendered, { sid, provider, userId });
        features.push('counter');
      } catch (error) {
        recordError('counter', error);
        for (const entry of counterPlan.entries) rendered = String(rendered).split(entry.sentinel).join('확인 불가');
      }
    }
    if (String(rendered).includes(songbookToken)) {
      let url = '노래책 링크를 확인할 수 없습니다.';
      try { url = await resolveSongbookPublicUrl(sid, provider) || url; }
      catch (error) { recordError('songbook_url', error); }
      rendered = String(rendered).split(songbookToken).join(url);
    }
    if (memoPlan.entries.length) {
      rendered = await resolveMemoVariablePlan(memoPlan, rendered, { readMemos: (keys) => readMemos(sid, keys) });
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
          ...(hasPngtuber ? { responseTemplate: actionTokens.join('\n') } : {}),
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
