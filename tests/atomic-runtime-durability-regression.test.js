const fs = require('fs');
const path = require('path');

describe('atomic runtime durability regression', () => {
  const supabaseSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'supabase.js'), 'utf8');
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'migrations', '013_atomic_runtime_durability.sql'),
    'utf8'
  );

  test('conditionally deducts points under a transaction-scoped identity lock', () => {
    const start = supabaseSource.indexOf('async function deductChannelPointsIfEnoughWithClient');
    const end = supabaseSource.indexOf('export async function getChannelPoints', start);
    const body = supabaseSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('pg_advisory_xact_lock(hashtextextended($1, 0))');
    expect(body).toContain('for update');
    expect(body).toContain('if (balanceBefore < normalizedAmount)');
    expect(body).toContain('balanceAfter = balanceBefore - normalizedAmount');
    expect(body).toContain("await pg.query('begin')");
    expect(body).toContain("await pg.query('commit')");
    expect(body).toContain("await pg.query('rollback')");
    expect(body).toContain("supabase.rpc('arubot_deduct_channel_points_if_enough'");
  });

  test('protects existing and future point tables against negative balances', () => {
    expect(supabaseSource).toContain('points integer not null default 0');
    expect(supabaseSource).toContain('check (points >= 0)');
    expect(migration).toContain("table_name like 'channelpoint\\_%'");
    expect(migration).toContain('set points = 0 where points is null or points < 0');
    expect(migration).toContain('alter column points set not null');
    expect(migration).toContain('add constraint %I check (points >= 0)');
  });

  test('claims command cooldown with one conditional update', () => {
    const start = supabaseSource.indexOf('export async function claimBotRuleCooldown');
    const end = supabaseSource.indexOf('export async function deleteBotRule', start);
    const body = supabaseSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('update bot_rules as rule');
    expect(body).toContain('input.claimed_at - coalesce(rule.last_used, 0) >=');
    expect(body).toContain('returning rule.sid, rule.id as rule_id');
    expect(body).toContain("supabase.rpc('arubot_claim_bot_rule_cooldown'");
    expect(migration).toContain('create or replace function public.arubot_claim_bot_rule_cooldown');
  });

  test('stores paid requests durably and makes charge plus enqueue idempotent', () => {
    const start = supabaseSource.indexOf('export async function enqueuePaidDurableRuntimeJob');
    const end = supabaseSource.indexOf('export async function claimDurableRuntimeJobs', start);
    const body = supabaseSource.slice(start, end);

    expect(migration).toContain('create table if not exists public.durable_runtime_jobs');
    expect(migration).toContain('unique (sid, job_type, idempotency_key)');
    expect(migration).toContain('constraint durable_runtime_jobs_points_cost_ck check (points_cost >= 0)');
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("await pg.query('begin')");
    expect(body).toContain('durable-job:${row.sid}:${row.job_type}:${row.idempotency_key}');
    expect(body).toContain('deductChannelPointsIfEnoughWithClient');
    expect(body).toContain('insertDurableRuntimeJobWithClient');
    expect(body.indexOf('deductChannelPointsIfEnoughWithClient')).toBeLessThan(body.indexOf('insertDurableRuntimeJobWithClient'));
    expect(body).toContain("supabase.rpc('arubot_enqueue_paid_durable_runtime_job'");
  });

  test('claims jobs with leases and requires worker ownership to finish them', () => {
    expect(supabaseSource).toContain('for update skip locked');
    expect(supabaseSource).toContain("status = 'processing' and locked_at <");
    expect(supabaseSource).toContain("where id = $1 and status = 'processing' and locked_by = $2");
    expect(migration).toContain('create or replace function public.arubot_claim_durable_runtime_jobs');
    expect(migration).toContain('for update skip locked');
    expect(migration).toContain('create or replace function public.arubot_fail_durable_runtime_job');
  });
});
