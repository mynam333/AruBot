import { randomUUID } from 'node:crypto';
import { assertSafeTextPayload } from '../shared/text-safety.js';
import { isCommandSafetyError } from './command-execution-safety.js';
import { prepareCounterVariablePlan } from './counter-variables.js';
import { prepareMemoVariablePlan } from './memo-variables.js';

const EFFECT_RE = /\$\{\s*(?:(roulette|action|automation|blueprint)::([^{}]+)|(video_donation|bgm_request|songbook_request|songbook_url|live\.title_change|live\.game_change))\s*\}/gi;
const INPUT_EFFECTS = new Set(['video_donation', 'bgm_request', 'songbook_request', 'live.title_change', 'live.game_change']);

export async function renderRouletteResultTemplate(template, context, dependencies) {
  const { commandExecution, substituteAllPlaceholders, resolveCommandCounterVariables,
    resolveCommandMemoVariables, enqueueRouletteSpin, executeAndStripActionVariableTokens,
    executeMediaRequest, executeSongbookRequest, executeLiveChange } = dependencies;
  const { sid, provider, userId, username } = context;
  return commandExecution.scope(sid, async () => {
    assertSafeTextPayload([template, context]);
    const prefix = `__roulette_${randomUUID()}_`;
    const operations = [];
    const source = String(template || '');
    // Plan executable tokens before any viewer names, memo values or other data is rendered.
    const plannedText = source.replace(EFFECT_RE, (token, kind, target, plainKind) => {
      const slot = `${prefix}effect_${operations.length}__`;
      operations.push({ kind: String(kind || plainKind).toLowerCase(), target: target?.trim(), token, slot });
      return slot;
    });
    if (operations.length > 16) commandExecution.reject('actions_limit');
    const commandTemplate = source.replace(EFFECT_RE, '').trim();
    const inputMode = context.argsText === undefined && operations.some(op => INPUT_EFFECTS.has(op.kind));
    const memoPlan = prepareMemoVariablePlan(plannedText, { ruleId: context.command?.ruleId });
    const counterPlan = prepareCounterVariablePlan(memoPlan.text);
    const values = [];
    const protectedText = counterPlan.text.replace(/\{user\.(name|username|nickname|id)\}|\{roulette\.(name|result\.label|result\.value)\}/g,
      (_token, userKey, resultKey) => {
        const value = userKey ? (userKey === 'id' ? userId : username)
          : resultKey === 'name' ? context.roulette?.name
            : resultKey === 'result.label' ? context.result?.label : context.result?.value;
        values.push(String(value ?? ''));
        return `${prefix}value_${values.length - 1}__`;
      });
    let rendered = await substituteAllPlaceholders(protectedText, sid, userId, username, { provider });
    commandExecution.check();
    rendered = await resolveCommandCounterVariables(counterPlan, rendered, { sid, provider, userId: context.chatPost?.counterUserId ?? userId });
    commandExecution.check();
    // Roulette is not an interactive manager memo edit, even when the winner is a manager.
    rendered = await resolveCommandMemoVariables(memoPlan, rendered, { sid, canWrite: false });
    rendered = String(rendered || '').replace(new RegExp(`${prefix}value_(\\d+)__`, 'g'), (token, index) => values[Number(index)] ?? token);
    assertSafeTextPayload(rendered);
    const argsText = context.argsText !== undefined ? String(context.argsText || '')
      : operations.reduce((text, op) => text.split(op.slot).join(''), rendered).trim();
    let text = inputMode ? operations.map(op => op.slot).join(' ') : rendered;
    const features = [...(counterPlan.used ? ['counter'] : []), ...(memoPlan.entries.length ? ['memo'] : [])];
    const actionJobs = [];
    const errors = [];
    for (const op of operations) {
      commandExecution.check();
      let output = '';
      try {
        commandExecution.consume('actions');
        if (op.kind === 'roulette') {
          await enqueueRouletteSpin(sid, { name: op.target, userId, username, chatPost: context.chatPost,
            instant: false, eventContext: { source: 'roulette-result', triggerName: context.roulette?.name || context.command?.keyword || null, pointDelta: 0 } });
        } else if (['action', 'automation', 'blueprint'].includes(op.kind)) {
          const result = await executeAndStripActionVariableTokens(sid, op.token, context);
          actionJobs.push(...(result.jobs || []));
          for (const job of result.jobs || []) {
            if (job?.ok === false || job?.result?.ok === false) {
              const error = Object.assign(new Error(job.error || job.result?.error || 'action_execution_failed'), { code: job.errorCode || job.result?.errorCode });
              if (isCommandSafetyError(error)) throw error;
              errors.push({ phase: op.kind, error });
            }
          }
        } else if (op.kind === 'video_donation' || op.kind === 'bgm_request') {
          output = await executeMediaRequest(op.token, argsText, context);
        } else if (op.kind === 'songbook_request' || op.kind === 'songbook_url') {
          output = await executeSongbookRequest(op.token, argsText, context);
        } else {
          const result = await executeLiveChange(op.token, argsText, context);
          output = result.text || '';
          errors.push(...(result.errors || []).map(failure => ({ phase: op.kind, error: failure.error })));
        }
        features.push(op.kind);
      } catch (error) {
        if (isCommandSafetyError(error)) throw error;
        errors.push({ phase: op.kind, error });
      }
      text = text.split(op.slot).join(String(output || ''));
    }
    commandExecution.check();
    assertSafeTextPayload(text);
    return { text: text.trim(), commandTemplate: inputMode ? '' : commandTemplate,
      used: operations.length > 0 || counterPlan.used || memoPlan.entries.length > 0 || rendered !== source,
      features, actionJobs, errors };
  });
}
