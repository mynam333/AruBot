-- Preserve owners, tokens, settings and points. Only remove the legacy channel-ID
-- alias when this owner has exactly one compatible Google identity for the channel.
-- The table lock also excludes writes from an older server during deployment.
begin;
lock table public.platform_accounts in exclusive mode;

with pairs as (
  select legacy.id as legacy_id, canonical.id as canonical_id,
         legacy.channel_name, legacy.channel_handle, legacy.avatar_url, legacy.metadata,
         legacy.connected_at, legacy.last_login_at,
         substring(canonical.platform_user_id from 8) as google_subject_hash
    from public.platform_accounts legacy
    join public.platform_accounts canonical
      on canonical.provider = 'youtube'
     and canonical.user_id = legacy.user_id
     and canonical.channel_id = legacy.channel_id
     and canonical.platform_user_id ~ '^google:[a-f0-9]{64}$'
   where legacy.provider = 'youtube'
     and legacy.channel_id ~ '^UC[A-Za-z0-9_-]{22}$'
     and legacy.platform_user_id = legacy.channel_id
     and (coalesce(legacy.metadata->>'googleSubjectHash', '') = ''
       or legacy.metadata->>'googleSubjectHash' = substring(canonical.platform_user_id from 8))
     and not exists (
       select 1 from public.platform_accounts other
        where other.provider = 'youtube' and other.user_id = canonical.user_id
          and other.channel_id = canonical.channel_id and other.id <> canonical.id
          and other.platform_user_id ~ '^google:[a-f0-9]{64}$'
     )
), merged as (
  update public.platform_accounts canonical
     set channel_name = coalesce(nullif(canonical.channel_name, ''), pairs.channel_name),
         channel_handle = coalesce(nullif(canonical.channel_handle, ''), pairs.channel_handle),
         avatar_url = coalesce(nullif(canonical.avatar_url, ''), pairs.avatar_url),
         metadata = pairs.metadata || canonical.metadata || jsonb_build_object('googleSubjectHash', pairs.google_subject_hash),
         connected_at = least(canonical.connected_at, pairs.connected_at),
         last_login_at = greatest(canonical.last_login_at, pairs.last_login_at)
    from pairs
   where canonical.id = pairs.canonical_id
  returning pairs.legacy_id
)
delete from public.platform_accounts legacy
 using merged where legacy.id = merged.legacy_id;

commit;
