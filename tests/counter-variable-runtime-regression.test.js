const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
const database = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'server', 'migrations', '022_bot_counter_values.sql'), 'utf8');
const providerSmoke = fs.readFileSync(path.join(root, 'scripts', 'db-provider-smoke.js'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-backend.yml'), 'utf8');

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('counter variable runtime integration', () => {
  test('publishes both increment-and-display variables only for command responses', () => {
    expect(serverIndex).toContain("key: '${counter::user::변수명}'");
    expect(serverIndex).toContain("key: '${counter::global::변수명}'");
    expect(serverIndex.match(/group: '카운트'/g)).toHaveLength(2);
    expect(serverIndex.match(/contexts: \['command'\], effect: 'increment'/g)).toHaveLength(2);
    expect(serverIndex).toContain('첫 호출은 1');
  });

  test('plans trusted templates before user placeholder substitution on every chat command path', () => {
    expect(serverIndex.match(/const counterPlan = prepareCounterVariablePlan\(response\);/g)).toHaveLength(4);
    const roulette = sourceBetween(serverIndex, 'async function executeRouletteResultCommand', 'async function substituteAllPlaceholders');
    const chzzk = sourceBetween(serverIndex, '// Prepare args for trigger handling', '// Send only one matching rule per message');
    const youtube = sourceBetween(serverIndex, 'async function processYoutubeChatAutomation', 'async function processCimeDonationAutomation');
    const cime = sourceBetween(serverIndex, 'async function processCimeChatAutomation', 'async function processCimeDonationAutomation');

    for (const section of [roulette, chzzk, youtube, cime]) {
      expect(section.indexOf('prepareCounterVariablePlan(response)')).toBeLessThan(section.indexOf('substituteAllPlaceholders('));
      expect(section).toContain('resolveCommandCounterVariables(counterPlan');
    }

    const placeholderRenderer = sourceBetween(serverIndex, 'async function substituteAllPlaceholders', 'async function resolveCommandCounterVariables');
    expect(placeholderRenderer).not.toContain('incrementBotCounter');
    expect(placeholderRenderer).not.toContain('counterPlan');
  });

  test('increments only after execution and duplicate-reply gates, while preserving failure replies', () => {
    const chzzk = sourceBetween(serverIndex, '// Ensure we have sessionKey and access token', '// Send only one matching rule per message');
    const youtube = sourceBetween(serverIndex, 'async function processYoutubeChatAutomation', 'async function processCimeDonationAutomation');
    const cime = sourceBetween(serverIndex, 'async function processCimeChatAutomation', 'async function processCimeDonationAutomation');

    expect(chzzk).toContain('!entry.sentReplies.has(replyKey) && !alreadyGlobal');
    expect(chzzk).toContain('entry.sentReplies.add(replyKey);');
    expect(chzzk).toContain('finalMsg = allowExecute');
    expect(chzzk).toContain(': stripUnplannedCounterVariables(finalMsg).trim()');

    for (const [section, provider] of [[youtube, 'youtube'], [cime, 'cime']]) {
      const claim = section.indexOf('entry.sentReplies.add(replyKey);');
      const increment = section.indexOf('resolveCommandCounterVariables(counterPlan', claim);
      expect(claim).toBeGreaterThanOrEqual(0);
      expect(increment).toBeGreaterThan(claim);
      expect(section).toContain('cleaned = allowExecute');
      expect(section).toContain(`provider: '${provider}'`);
      expect(section).toContain(': stripUnplannedCounterVariables(cleaned).trim()');
    }
    expect(chzzk).not.toContain("responseToSend = '';");
    expect(youtube).not.toContain("cleaned = '';");
    expect(cime).not.toContain("cleaned = '';");
    expect(serverIndex.match(/userId: counterUserId,/g)?.length || 0).toBeGreaterThanOrEqual(3);
    expect(serverIndex).toContain("const counterUserId = String(ev.userId || '').trim();");
    expect(serverIndex.match(/liveManageActorId: resolvedUserId, counterUserId/g)?.length || 0).toBeGreaterThanOrEqual(6);
    expect(serverIndex.match(/makeYoutubeChatPost\(ownerUserId, entry\.liveChatId, resolvedUsername, \{ counterUserId \}\)/g)?.length || 0).toBeGreaterThanOrEqual(3);
  });

  test('uses one atomic PostgreSQL upsert without retrying a non-idempotent increment', () => {
    const increment = sourceBetween(database, 'export async function incrementBotCounter', 'function isUndefinedDbFunctionError');
    expect(increment).toContain('insert into public.bot_counter_values as stored');
    expect(increment).toContain('on conflict (sid, counter_name, counter_scope, subject_key)');
    expect(increment).toContain('value = stored.value + 1');
    expect(increment).toContain('returning value::text as value');
    expect(increment).toContain('}, 0);');
    expect(increment).not.toMatch(/select\s+value/i);
  });

  test('ships an idempotent constrained schema and account lifecycle coverage', () => {
    expect(migration).toContain('create table if not exists public.bot_counter_values');
    expect(migration).toContain('primary key (sid, counter_name, counter_scope, subject_key)');
    expect(migration).toContain("check (counter_scope in ('user', 'global'))");
    expect(migration).toContain('char_length(counter_name) between 1 and 64');
    expect(database).toContain("'public.bot_counter_values',");
    expect(database).toContain("counter_scope = 'user' and subject_key = any($2::text[])");
    expect(database).toContain('async function mergeBotCountersToSid');
    expect(database).toContain('value = target.value + excluded.value');
    expect(database).toContain('pg_advisory_xact_lock(hashtextextended($1, 0))');
    expect(database).toContain('bot-counter-sid-migration:${newSid}');
    expect(database).toContain("error?.code === '40P01' || error?.code === '40001'");
    expect(database).toContain("console.error('[Counter Variable] SID counter migration failed:'");
    expect(database).toContain('await mergeBotCountersToSid(oldPidCandidates, newPid);');
    const attendanceRenderer = sourceBetween(serverIndex, 'async function renderAttendanceMessage', 'async function recordAttendanceFromCommand');
    expect(attendanceRenderer).toContain("return stripUnplannedCounterVariables(String(rendered || ''))");
  });

  test('verifies runtime counter write privileges before switching the deployed release', () => {
    expect(providerSmoke).toContain("'bot_counter_values'");
    expect(providerSmoke).toContain('counterWriteAccess');
    expect(providerSmoke).toContain('returning value');
    expect(providerSmoke).toContain("await client.query('rollback')");
    expect(deployWorkflow.indexOf('npm run db:migrate')).toBeLessThan(
      deployWorkflow.indexOf('npm run db:provider-smoke')
    );
  });
});
