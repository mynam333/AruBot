const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const GOOGLE_ID_RE = /^google:([a-f0-9]{64})$/;

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function subjectHash(account) {
  return GOOGLE_ID_RE.exec(String(account?.platform_user_id || ''))?.[1] || null;
}

export function mergeYoutubeAccountProfile(existing = {}, profile = {}) {
  existing ||= {};
  const platformUserId = existing.platform_user_id || profile.platformUserId || profile.channelId;
  const incomingChannelId = profile.channelId || (CHANNEL_ID_RE.test(platformUserId) ? platformUserId : null);
  const channelId = CHANNEL_ID_RE.test(incomingChannelId || '') ? incomingChannelId : null;
  const keepChannel = !!existing.channel_id && !channelId;
  const previousMetadata = object(existing.metadata);
  const metadata = { ...previousMetadata, ...object(profile.metadata) };
  if (keepChannel) {
    metadata.publicProfile = previousMetadata.publicProfile;
    metadata.identitySource = previousMetadata.identitySource || metadata.identitySource;
  }
  const hash = subjectHash({ platform_user_id: platformUserId }) || previousMetadata.googleSubjectHash;
  if (hash) metadata.googleSubjectHash = hash;

  return {
    ...existing,
    platform_user_id: platformUserId,
    channel_id: channelId || existing.channel_id || null,
    channel_name: (keepChannel ? existing.channel_name : profile.channelName || profile.displayName) || existing.channel_name || null,
    channel_handle: (keepChannel ? existing.channel_handle : profile.channelHandle) || existing.channel_handle || null,
    avatar_url: (keepChannel ? existing.avatar_url : profile.avatarUrl || profile.channelImageUrl) || existing.avatar_url || null,
    metadata,
  };
}

// A channel can be managed by different Google identities. Only merge its old
// channel-ID row when there is exactly one compatible Google row for this owner.
export function planYoutubeAccountRepairs(accounts) {
  const groups = new Map();
  for (const account of accounts) {
    if (account.provider !== 'youtube' || !account.user_id || !CHANNEL_ID_RE.test(account.channel_id || '')) continue;
    const key = JSON.stringify([account.user_id, account.channel_id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(account);
  }
  const repairs = [];
  for (const group of groups.values()) {
    const canonical = group.filter((account) => subjectHash(account));
    if (canonical.length !== 1) continue;
    const keep = canonical[0];
    const hash = subjectHash(keep);
    const remove = group.filter((account) => account.platform_user_id === account.channel_id
      && (account.metadata?.googleSubjectHash == null || account.metadata.googleSubjectHash === ''
        || account.metadata.googleSubjectHash === hash));
    if (!remove.length) continue;
    const legacy = remove[0];
    repairs.push({
      keep: {
        ...keep,
        channel_name: keep.channel_name || legacy.channel_name,
        channel_handle: keep.channel_handle || legacy.channel_handle,
        avatar_url: keep.avatar_url || legacy.avatar_url,
        metadata: { ...object(legacy.metadata), ...object(keep.metadata), googleSubjectHash: hash },
        connected_at: new Date(legacy.connected_at) < new Date(keep.connected_at) ? legacy.connected_at : keep.connected_at,
        last_login_at: new Date(legacy.last_login_at) > new Date(keep.last_login_at) ? legacy.last_login_at : keep.last_login_at,
      },
      remove,
    });
  }
  return repairs;
}

export function findYoutubeTokenAccount(accounts, platformUserId) {
  if (!platformUserId) return null;
  const youtube = accounts.filter((account) => account.provider === 'youtube');
  const exact = youtube.find((account) => account.platform_user_id === platformUserId);
  if (exact) return exact;
  if (!CHANNEL_ID_RE.test(platformUserId)) return null;
  const aliases = youtube.filter((account) => account.channel_id === platformUserId && subjectHash(account));
  return aliases.length === 1 ? aliases[0] : null;
}

async function transaction(pg, action) {
  await pg.query('begin');
  try {
    const result = await action();
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback').catch(() => {});
    throw error;
  }
}

async function lockOwner(pg, userId) {
  await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`youtube-accounts:owner:${userId}`]);
}

async function readAccounts(pg, userId) {
  const { rows } = await pg.query(
    `select * from platform_accounts where provider = 'youtube' and user_id = $1
     order by platform_user_id for update`,
    [userId],
  );
  return rows;
}

async function saveAccount(pg, account) {
  const { rows } = await pg.query(
    `update platform_accounts
     set channel_id = $3, channel_name = $4, channel_handle = $5, avatar_url = $6,
         metadata = $7::jsonb, connected_at = $8, last_login_at = $9
     where provider = 'youtube' and user_id = $1 and platform_user_id = $2 returning *`,
    [account.user_id, account.platform_user_id, account.channel_id, account.channel_name,
      account.channel_handle, account.avatar_url, JSON.stringify(account.metadata), account.connected_at, account.last_login_at],
  );
  return rows[0];
}

async function repairAccounts(pg, userId, accounts) {
  let removed = 0;
  for (const repair of planYoutubeAccountRepairs(accounts)) {
    const saved = await saveAccount(pg, repair.keep);
    if (!saved) throw new Error('YouTube account disappeared during repair');
    const { rowCount } = await pg.query(
      `delete from platform_accounts where provider = 'youtube' and user_id = $1 and id = any($2::uuid[])`,
      [userId, repair.remove.map((account) => account.id)],
    );
    removed += rowCount;
  }
  return removed;
}

export async function repairYoutubeAccountsWithClient(pg, userId) {
  return transaction(pg, async () => {
    await lockOwner(pg, userId);
    return repairAccounts(pg, userId, await readAccounts(pg, userId));
  });
}

export async function upsertYoutubeIdentityWithClient(pg, profile, preferredUserId) {
  const platformUserId = String(profile.platformUserId || profile.channelId).trim();
  return transaction(pg, async () => {
    await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`youtube-accounts:identity:${platformUserId}`]);
    const existing = await pg.query(
      `select user_id from platform_accounts where provider = 'youtube' and platform_user_id = $1`, [platformUserId],
    );
    const userId = existing.rows[0]?.user_id || preferredUserId || `youtube:${platformUserId}`;
    await lockOwner(pg, userId);
    const accounts = await readAccounts(pg, userId);
    const previous = findYoutubeTokenAccount(accounts, platformUserId);
    const account = mergeYoutubeAccountProfile(previous, { ...profile, platformUserId });
    await pg.query(
      `insert into app_users (id, primary_provider, primary_platform_user_id, display_name, avatar_url, metadata)
       values ($1, 'youtube', $2, $3, $4, $5::jsonb)
       on conflict (id) do update set display_name = coalesce(excluded.display_name, app_users.display_name),
         avatar_url = coalesce(excluded.avatar_url, app_users.avatar_url), updated_at = now()`,
      [userId, account.platform_user_id, account.channel_name, account.avatar_url, JSON.stringify(account.metadata)],
    );
    const upserted = await pg.query(
      `insert into platform_accounts
         (user_id, provider, platform_user_id, channel_id, channel_name, channel_handle, avatar_url, metadata, last_login_at)
       values ($1, 'youtube', $2, $3, $4, $5, $6, $7::jsonb, now())
       on conflict (provider, platform_user_id) do update set
         channel_id = excluded.channel_id, channel_name = excluded.channel_name,
         channel_handle = excluded.channel_handle, avatar_url = excluded.avatar_url,
         metadata = excluded.metadata, last_login_at = now()
       returning *`,
      [userId, account.platform_user_id, account.channel_id, account.channel_name,
        account.channel_handle, account.avatar_url, JSON.stringify(account.metadata)],
    );
    const current = await readAccounts(pg, userId);
    const removed = await repairAccounts(pg, userId, current);
    const result = removed ? findYoutubeTokenAccount(await readAccounts(pg, userId), account.platform_user_id) : upserted.rows[0];
    return { userId, account: result };
  });
}

export async function updateYoutubeProfileWithClient(pg, userId, platformUserId, profile) {
  return transaction(pg, async () => {
    await lockOwner(pg, userId);
    let accounts = await readAccounts(pg, userId);
    if (await repairAccounts(pg, userId, accounts)) accounts = await readAccounts(pg, userId);
    const previous = findYoutubeTokenAccount(accounts, platformUserId);
    if (!previous) return null;
    const updated = await saveAccount(pg, mergeYoutubeAccountProfile(previous, profile));
    await pg.query(
      `update app_users set display_name = coalesce($2, display_name),
       avatar_url = coalesce($3, avatar_url), updated_at = now() where id = $1`,
      [userId, updated.channel_name, updated.avatar_url],
    );
    const current = accounts.map((account) => account.id === updated.id ? updated : account);
    if (await repairAccounts(pg, userId, current)) {
      return findYoutubeTokenAccount(await readAccounts(pg, userId), updated.platform_user_id);
    }
    return updated;
  });
}
