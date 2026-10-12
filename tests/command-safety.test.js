const load = require('./helpers/load-source.cjs');
const { createCommandAdmission } = load('server/command-admission.js');
const { createCommandExecutionSafety, isCommandSafetyError } = load('server/command-execution-safety.js');
const { createCommandAdmissionStore } = load('server/command-admission-store.js');

describe('command admission', () => {
  let time, admission;
  const user = { sid: 'user:owner', provider: 'chzzk', userId: 'viewer' };
  beforeEach(() => { time = 1000000; admission = createCommandAdmission({ now: () => time }); });

  test('normal sequential use, independent viewers and channels stay available', async () => {
    for (let index = 0; index < 200; index += 1) {
      expect((await admission.admit(user)).allowed).toBe(true);
      time += 3000;
    }
    for (let index = 0; index < 8; index += 1) await admission.admit(user);
    expect((await admission.admit({ ...user, userId: 'another' })).allowed).toBe(true);
    expect((await admission.admit({ ...user, sid: 'user:other' })).allowed).toBe(true);
  });

  test('alternating aliases, parameters and command families cannot reset a user budget', async () => {
    for (let index = 0; index < 8; index += 1) {
      expect((await admission.admit({ ...user, command: `different-${index}` })).allowed).toBe(true);
    }
    expect((await admission.admit({ ...user, command: 'wheel' })).allowed).toBe(false);
  });

  test('parallel requests reserve before waiting on the database', async () => {
    const claim = jest.fn(async () => true);
    admission = createCommandAdmission({ now: () => time, claim });
    const results = await Promise.all(Array.from({ length: 100 }, () => admission.admit(user)));
    expect(results.filter((result) => result.allowed)).toHaveLength(8);
    expect(claim).toHaveBeenCalledTimes(8);
  });

  test.each(['actor', 'channel', 'global'])('%s tokens are not refilled twice after a clock rollback', async (scope) => {
    const limits = scope === 'actor' ? {}
      : scope === 'channel' ? { channelBurst: 1 } : { globalBurst: 1 };
    admission = createCommandAdmission({ now: () => time, limits });
    const count = scope === 'actor' ? 8 : 1;
    for (let index = 0; index < count; index += 1) await admission.admit(user);
    const next = scope === 'actor' ? user : { ...user, userId: 'another' };
    const reason = scope === 'actor' ? 'user_rate' : 'load';
    time -= 10000;
    expect((await admission.admit(next)).reason).toBe(reason);
    time += 10000;
    expect((await admission.admit(next)).reason).toBe(reason);
    time += 2000;
    expect((await admission.admit(next)).allowed).toBe(true);
  });

  test('workers and restarts use the same actor key while providers and channels stay independent', async () => {
    const remaining = new Map();
    const claim = jest.fn(async (key, capacity) => {
      const tokens = remaining.get(key) ?? capacity;
      if (!tokens) return false;
      remaining.set(key, tokens - 1);
      return true;
    });
    const first = createCommandAdmission({ now: () => time, claim });
    const second = createCommandAdmission({ now: () => time, claim });
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) =>
      (index % 2 ? first : second).admit(user)));
    expect(results.filter(({ allowed }) => allowed)).toHaveLength(8);
    const restarted = createCommandAdmission({ now: () => time, claim });
    expect((await restarted.admit(user)).reason).toBe('shared_rate');
    expect((await restarted.admit({ ...user, provider: 'youtube' })).allowed).toBe(true);
    expect((await restarted.admit({ ...user, sid: 'user:other' })).allowed).toBe(true);
  });

  test('sustained abuse escalates, does not extend while cooling down, and recovers', async () => {
    for (const duration of [5000, 15000, 60000]) {
      for (let index = 0; index < 8; index += 1) await admission.admit(user);
      let blocked;
      for (let index = 0; index < 3; index += 1) blocked = await admission.admit(user);
      expect(blocked.allowed).toBe(false);
      time += duration - 1;
      expect((await admission.admit(user)).allowed).toBe(false);
      time += 1;
      expect((await admission.admit(user)).allowed).toBe(true);
    }
    time += 600001;
    expect((await admission.admit(user)).allowed).toBe(true);
  });

  test('distributed rejection and storage outage fail closed, not as free execution', async () => {
    for (const claim of [async () => false, async () => { throw new Error('offline'); }]) {
      const guard = createCommandAdmission({ now: () => time, claim });
      expect((await guard.admit(user)).allowed).toBe(false);
    }
  });

  test('full bounded stores do not evict live restrictions to admit new identities', async () => {
    admission = createCommandAdmission({ now: () => time, limits: { maxEntries: 1 } });
    await admission.admit(user);
    expect((await admission.admit({ ...user, userId: 'new' })).reason).toBe('capacity');
    time += 600001;
    expect((await admission.admit({ ...user, userId: 'new' })).allowed).toBe(true);
  });

  test('channel and global protection does not escalate an innocent user cooldown', async () => {
    admission = createCommandAdmission({ now: () => time, limits: { channelBurst: 1 } });
    await admission.admit(user);
    for (let index = 0; index < 10; index += 1) {
      expect((await admission.admit({ ...user, userId: 'other' })).reason).toBe('load');
    }
    time += 1000;
    expect((await admission.admit({ ...user, userId: 'other' })).allowed).toBe(true);
  });

  test('block logs are aggregated without unbounded log spam or raw message data', async () => {
    const onBlocked = jest.fn();
    admission = createCommandAdmission({ now: () => time, onBlocked });
    for (let index = 0; index < 100; index += 1) await admission.admit(user);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked.mock.calls[0][0]).not.toHaveProperty('userId');
  });
});

describe('shared execution budgets and lineage', () => {
  let time, safety;
  beforeEach(() => { time = 1000000; safety = createCommandExecutionSafety({ now: () => time }); });
  const sid = 'user:owner';
  test('normal bounded loops and repeated sibling actions remain valid', async () => {
    await safety.run(sid, 'blueprint:a', async () => {
      for (let index = 0; index < 10; index += 1) {
        await safety.run(sid, 'blueprint:b', async () => safety.consume('nodes', 3));
      }
    });
  });
  test('direct and indirect cycles stop before executing their side effects', async () => {
    const effect = jest.fn();
    await expect(safety.run(sid, 'a', () => safety.run(sid, 'b', () => safety.run(sid, 'a', effect))))
      .rejects.toMatchObject({ code: 'command_safety_cycle' });
    expect(effect).not.toHaveBeenCalled();
  });
  test('parallel descendants share one budget and a stop signal', async () => {
    await expect(safety.run(sid, 'a', () => Promise.all(Array.from({ length: 6 }, (_, index) =>
      safety.run(sid, `branch:${index}`, async () => safety.consume('nodes', 100))))))
      .rejects.toMatchObject({ code: 'command_safety_nodes_limit' });
  });
  test.each([Infinity, NaN, -1, 101, 1e100])('rejects unbounded loop count %s including an empty loop body', async (value) => {
    await expect(safety.run(sid, 'a', async () => safety.count(value))).rejects.toMatchObject({ code: 'command_safety_loop_limit' });
  });
  test('zero loops really perform zero iterations', () => expect(safety.count(0)).toBe(0));
  test('waits and deadlines cannot pin an execution indefinitely', async () => {
    await expect(safety.run(sid, 'a', () => safety.wait(300001))).rejects.toMatchObject({ code: 'command_safety_waitMs_limit' });
    await expect(safety.run(sid, 'a', async () => { time += 600001; safety.consume('nodes'); }))
      .rejects.toMatchObject({ code: 'command_safety_deadline' });
  });
  test('queue serialization and a new worker preserve cycle detection', async () => {
    let saved;
    await safety.run(sid, 'roulette:a', async () => { saved = JSON.parse(JSON.stringify(safety.capture(sid))); });
    const restarted = createCommandExecutionSafety({ now: () => time });
    await expect(restarted.run(sid, 'roulette:a', jest.fn(), saved)).rejects.toMatchObject({ code: 'command_safety_cycle' });
    await restarted.run(sid, 'roulette:b', async () => {}, saved);
  });
  test('queued work never inherits a different job context from the worker loop', async () => {
    const saved = safety.capture(sid);
    await safety.run(sid, 'unrelated', () => safety.run(sid, 'unrelated', async () => {}, saved));
  });
  test('an overlay acknowledgement restores the originating roulette ancestry', async () => {
    let settled;
    await safety.run(sid, 'roulette:a', async () => { settled = safety.bind(() => safety.run(sid, 'roulette:a', jest.fn())); });
    await expect(settled()).rejects.toMatchObject({ code: 'command_safety_cycle' });
  });
  test('expired and cross-channel continuations fail closed', async () => {
    const saved = safety.capture(sid);
    await expect(safety.run('other', 'a', jest.fn(), saved)).rejects.toMatchObject({ code: 'command_safety_invalid_chain' });
    time += 86400000;
    await expect(safety.run(sid, 'a', jest.fn(), saved)).rejects.toMatchObject({ code: 'command_safety_expired_chain' });
  });
  test('concurrency slots release on failures and do not block other channels', async () => {
    safety = createCommandExecutionSafety({ limits: { channelConcurrent: 1, globalConcurrent: 2 } });
    let release;
    const running = safety.run(sid, 'a', () => new Promise((resolve) => { release = resolve; }));
    await expect(safety.run(sid, 'b', jest.fn())).rejects.toMatchObject({ code: 'command_safety_busy' });
    await safety.run('other', 'a', async () => {});
    release();
    await running;
    await expect(safety.run(sid, 'a', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await safety.run(sid, 'a', async () => {});
  });
  test('safety errors are distinct from ordinary operational failures', () => {
    expect(isCommandSafetyError(new Error('network'))).toBe(false);
  });
});

describe('database admission contracts', () => {
  test('uses conditional atomic upserts, server time, RLS and bounded cleanup', async () => {
    const queries = [];
    const query = jest.fn(async (sql, values) => { queries.push({ sql, values }); return { rows: /returning/.test(sql) ? [{}] : [] }; });
    const store = createCommandAdmissionStore({ withPgClient: async (fn) => fn({ query }) });
    expect(await store.claim('a'.repeat(64), 8, 0.5)).toBe(true);
    expect(await store.claimChainJob({ sid: 'user:x', rootId: '12345678-1234-1234-1234-123456789abc' })).toBe(true);
    const upsert = queries.find(({ sql }) => sql.includes('on conflict (bucket_key)'));
    expect(upsert.sql).toContain('clock_timestamp()');
    expect(upsert.sql).toContain('>= 1');
    expect(upsert.sql).toContain('updated_at = greatest(bucket.updated_at, clock_timestamp())');
    expect(upsert.values).toEqual(['a'.repeat(64), 8, 0.5]);
    expect(queries.some(({ sql }) => sql.includes('budget.jobs < 100'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('enable row level security'))).toBe(true);
    const cleanup = queries.filter(({ sql }) => sql.includes('delete from'));
    expect(cleanup).toHaveLength(2);
    for (const { sql } of cleanup) {
      expect(sql).toContain('limit 12000');
      expect(sql).toContain('for update skip locked');
      expect(sql).toContain('order by');
    }
  });
  test('no returned row means denied; storage errors are never treated as success', async () => {
    const pg = { query: jest.fn(async () => ({ rows: [] })) };
    const store = createCommandAdmissionStore({ withPgClient: async (fn) => fn(pg) });
    expect(await store.claim('a'.repeat(64), 8, 0.5)).toBe(false);
    pg.query.mockRejectedValueOnce(new Error('db offline'));
    await expect(store.claim('a'.repeat(64), 8, 0.5)).rejects.toThrow('db offline');
  });

  test('queue-only traffic cleans both tables once per minute, including an epoch-zero clock', async () => {
    let time = 0;
    const pg = { query: jest.fn(async () => ({ rows: [{}] })) };
    const store = createCommandAdmissionStore({ withPgClient: async (fn) => fn(pg), now: () => time });
    const chain = { sid: 'user:x', rootId: '12345678-1234-1234-1234-123456789abc' };
    await store.claimChainJob(chain);
    await store.claim('a'.repeat(64), 8, 0.5);
    const cleanups = () => pg.query.mock.calls.filter(([sql]) => sql.includes('delete from'));
    expect(cleanups()).toHaveLength(2);
    time += 59999;
    await store.claimChainJob(chain);
    expect(cleanups()).toHaveLength(2);
    time += 1;
    await store.claimChainJob(chain);
    expect(cleanups()).toHaveLength(4);
  });

  test('slow cleanup does not spawn overlapping sweeps or block other claims', async () => {
    let time = 1000000;
    let releaseCleanup;
    let cleanupStarted;
    let held = false;
    const started = new Promise((resolve) => { cleanupStarted = resolve; });
    const pending = new Promise((resolve) => { releaseCleanup = resolve; });
    const pg = { query: jest.fn(async (sql) => {
      if (sql.includes('delete from command_admission_buckets') && !held) {
        held = true;
        cleanupStarted();
        await pending;
      }
      return { rows: [{}] };
    }) };
    const store = createCommandAdmissionStore({ withPgClient: async (fn) => fn(pg), now: () => time });
    const first = store.claim('a'.repeat(64), 8, 0.5);
    await started;
    time += 60000;
    try {
      expect(await store.claim('b'.repeat(64), 8, 0.5)).toBe(true);
      expect(pg.query.mock.calls.filter(([sql]) => sql.includes('delete from command_admission_buckets'))).toHaveLength(1);
    } finally {
      releaseCleanup();
      await first;
    }
  });

  test('cleanup failures do not deny an already claimed token or prevent later sweeps', async () => {
    let time = 1000000;
    const pg = { query: jest.fn(async (sql) => {
      if (sql.includes('delete from')) throw new Error('cleanup offline');
      return { rows: [{}] };
    }) };
    const store = createCommandAdmissionStore({ withPgClient: async (fn) => fn(pg), now: () => time });
    expect(await store.claim('a'.repeat(64), 8, 0.5)).toBe(true);
    time += 60000;
    expect(await store.claim('b'.repeat(64), 8, 0.5)).toBe(true);
    expect(pg.query.mock.calls.filter(([sql]) => sql.includes('delete from'))).toHaveLength(4);
  });
});
