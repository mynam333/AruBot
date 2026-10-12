import { normalizeMemoName, validateMemoValue, MAX_MEMOS_PER_RESPONSE } from './memo-variables.js';

function memoKeys(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length > MAX_MEMOS_PER_RESPONSE) throw new Error('invalid_memo_keys');
  return [...new Set(keys.map((key) => {
    if (typeof key !== 'string' || !(key.startsWith('name:') && normalizeMemoName(key.slice(5)) === key.slice(5))
      && !/^rule:[\w-]{1,128}$/.test(key)) throw new Error('invalid_memo_key');
    return key;
  }))];
}

function ownerSid(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || /[\u0000-\u001f]/.test(value)) throw new Error('invalid_memo_sid');
  return value.trim();
}

export function createMemoVariableStore({ withPgClient }) {
  return {
    async migrate(oldSids, sid) {
      const owner = ownerSid(sid);
      const sources = [...new Set(oldSids.map(ownerSid))].filter((value) => value !== owner);
      if (!sources.length) return;
      await withPgClient((pg) => pg.query(`with moved as (
          delete from public.bot_memo_values where sid = any($1::text[])
          returning memo_key, value, created_at, updated_at
        )
        insert into public.bot_memo_values as target (sid, memo_key, value, created_at, updated_at)
        select distinct on (memo_key) $2, memo_key, value, created_at, updated_at
          from moved order by memo_key, updated_at desc, value
        on conflict (sid, memo_key) do update set value = excluded.value,
          updated_at = excluded.updated_at
        where target.updated_at < excluded.updated_at`, [sources, owner]), 0);
    },
    async read(sid, keys) {
      const owner = ownerSid(sid);
      const names = memoKeys(keys);
      return withPgClient(async (pg) => {
        const result = await pg.query('select memo_key, value from public.bot_memo_values where sid = $1 and memo_key = any($2::text[])', [owner, names]);
        return new Map(result.rows.map((row) => [row.memo_key, row.value]));
      });
    },
    async write(sid, keys, value) {
      const owner = ownerSid(sid);
      const names = memoKeys(keys);
      validateMemoValue(value);
      return withPgClient(async (pg) => {
        const result = await pg.query(`insert into public.bot_memo_values (sid, memo_key, value)
          select $1, memo_key, $3 from unnest($2::text[]) as keys(memo_key)
          on conflict (sid, memo_key) do update set value = excluded.value, updated_at = now()
          returning memo_key, value`, [owner, names, value]);
        if (result.rows.length !== names.length) throw new Error('memo_write_incomplete');
        return new Map(result.rows.map((row) => [row.memo_key, row.value]));
      }, 0);
    },
  };
}
