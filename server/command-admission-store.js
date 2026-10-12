// Atomic shared token buckets survive restarts and concurrent bot workers.
export function createCommandAdmissionStore({ withPgClient, now = Date.now }) {
  let ready;
  let cleanupAt = -Infinity;
  let cleaning = false;
  async function ensureSchema() {
    if (!ready) ready = withPgClient(async (pg) => {
      await pg.query('begin');
      try {
        await pg.query("select pg_advisory_xact_lock(hashtext('command-admission-schema'))");
        await pg.query(`create table if not exists command_admission_buckets (
          bucket_key text primary key,
          tokens double precision not null,
          updated_at timestamptz not null default clock_timestamp()
        )`);
        await pg.query('create index if not exists command_admission_expiry on command_admission_buckets(updated_at)');
        await pg.query('alter table command_admission_buckets enable row level security');
        await pg.query(`create table if not exists command_execution_budgets (
          root_id text primary key, sid text not null, jobs integer not null,
          created_at timestamptz not null default clock_timestamp()
        )`);
        await pg.query('create index if not exists command_execution_budgets_expiry on command_execution_budgets(created_at)');
        await pg.query('alter table command_execution_budgets enable row level security');
        await pg.query('commit');
      } catch (error) { await pg.query('rollback').catch(() => {}); throw error; }
    }, 0).catch((error) => { ready = null; throw error; });
    return ready;
  }
  async function cleanup(pg) {
    const time = now();
    if (cleaning || time - cleanupAt < 60000) return;
    cleanupAt = time;
    cleaning = true;
    try {
      // Outpace 6,000 new actors/minute plus bursts; lock before selecting for deletion.
      await pg.query(`delete from command_admission_buckets where bucket_key in (
        select bucket_key from command_admission_buckets
        where updated_at < clock_timestamp() - interval '1 hour'
        order by updated_at limit 12000 for update skip locked
      )`).catch(() => {});
      await pg.query(`delete from command_execution_budgets where root_id in (
        select root_id from command_execution_budgets
        where created_at < clock_timestamp() - interval '7 days'
        order by created_at limit 12000 for update skip locked
      )`).catch(() => {});
    } finally { cleaning = false; }
  }
  async function claim(key, capacity, refillPerSecond) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Number.isFinite(capacity) || capacity < 1 || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0) throw new Error('invalid_command_bucket');
    await ensureSchema();
    return withPgClient(async (pg) => {
      const result = await pg.query(`
        insert into command_admission_buckets as bucket(bucket_key, tokens, updated_at)
        values ($1, $2::double precision - 1, clock_timestamp())
        on conflict (bucket_key) do update
          set tokens = least($2::double precision, bucket.tokens + greatest(0, extract(epoch from (clock_timestamp() - bucket.updated_at))) * $3::double precision) - 1,
              updated_at = greatest(bucket.updated_at, clock_timestamp())
          where least($2::double precision, bucket.tokens + greatest(0, extract(epoch from (clock_timestamp() - bucket.updated_at))) * $3::double precision) >= 1
        returning bucket_key`, [key, capacity, refillPerSecond]);
      await cleanup(pg);
      return result.rows.length === 1;
    }, 0);
  }
  async function claimChainJob({ rootId, sid }) {
    if (!sid || !/^[a-f0-9-]{36}$/i.test(rootId || '')) throw new Error('invalid_command_chain');
    await ensureSchema();
    return withPgClient(async (pg) => {
      const result = await pg.query(`insert into command_execution_budgets as budget(root_id,sid,jobs)
        values ($1,$2,1)
        on conflict(root_id) do update set jobs = budget.jobs + 1
          where budget.sid = excluded.sid and budget.jobs < 100
            and budget.created_at > clock_timestamp() - interval '1 day'
        returning root_id`, [rootId, sid]);
      await cleanup(pg);
      return result.rows.length === 1;
    }, 0);
  }
  return { claim, claimChainJob, ensureSchema };
}
