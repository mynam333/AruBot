// Call inside the deletion transaction. The parent row lock also blocks new
// platform-account foreign keys until eligibility and deletion have committed.
export async function lockUnlinkedAccount(pg, owner, before = null) {
  const user = (await pg.query('select id,created_at from app_users where id=$1 for update', [owner])).rows[0];
  if (!user) return 'account_missing';
  if (before && new Date(user.created_at).getTime() >= new Date(before).getTime()) return 'recent_account';
  if ((await pg.query('select 1 from platform_accounts where user_id=$1 limit 1', [owner])).rows.length) return 'platform_connected';
  // Older installations can have working connections outside platform_accounts.
  const alternatives = [
    ['platform_tokens', 'user_id=$1 and access_token is not null', owner],
    ['tokens', 'sid=any($1::text[]) and access_token is not null', [owner, `user:${owner}`]],
    ['youtube_streamer_channels', 'owner_user_id=$1', owner],
  ];
  for (const [table, where, value] of alternatives) {
    const exists = (await pg.query('select to_regclass($1) as table_name', [`public.${table}`])).rows[0]?.table_name;
    if (exists && (await pg.query(`select 1 from ${table} where ${where} limit 1`, [value])).rows.length) return 'legacy_connection';
  }
  return null;
}

export async function cleanupUnlinkedAccountBatch({ withPgClient, deleteAccountData }, options = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be between 1 and 200');
  const before = options.before ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  if (!Number.isFinite(new Date(before).getTime())) throw new Error('Invalid cleanup cutoff');
  const candidates = await withPgClient(async pg => (await pg.query(`select u.id from app_users u
    where u.id > $1 and u.created_at < $2::timestamptz
      and not exists(select 1 from platform_accounts a where a.user_id=u.id)
    order by u.id limit $3`, [String(options.after || ''), before, limit])).rows);
  const result = { dryRun: options.dryRun !== false, scanned: candidates.length, deleted: 0, eligible: 0,
    skipped: {}, failed: [], after: candidates.at(-1)?.id ?? null, hasMore: candidates.length === limit };
  for (const { id } of candidates) {
    try {
      const deleted = await deleteAccountData(id, { reason: 'unlinked_account_cleanup', requireNoPlatforms: true,
        unlinkedBefore: before, dryRun: result.dryRun });
      if (!deleted.ok) throw new Error('Account cleanup unavailable');
      if (deleted.skipReason) result.skipped[deleted.skipReason] = (result.skipped[deleted.skipReason] || 0) + 1;
      else result.eligible++;
      if (deleted.accountDeleted) {
        result.deleted++;
        await options.onDeleted?.(id, deleted);
      }
    } catch (error) { result.failed.push({ id, code: error.code || 'cleanup_failed' }); }
  }
  return result;
}
