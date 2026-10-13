-- OBS follows membership independently of optional paid viewer routing.
-- Backfill once; re-running startup migrations must not undo an explicit choice.
do $$ begin
  if not exists(select 1 from information_schema.columns
    where table_schema=current_schema() and table_name='marble_participation' and column_name='obs_owner_user_id') then
    alter table marble_participation
      add column obs_owner_user_id text check (obs_owner_user_id is null or obs_owner_user_id <> source_user_id),
      add column obs_revision bigint not null default 0 check (obs_revision >= 0),
      add column connected_invitation_id uuid;
    -- A new invitation must not revive paid routing from a revoked membership.
    update marble_participation p set connected_invitation_id=i.id from marble_invites i
      where p.connected_owner_user_id=i.owner_user_id and p.source_user_id=i.member_user_id and i.status='accepted';
    insert into marble_participation(source_user_id,settings,obs_owner_user_id,obs_revision)
      select distinct on (i.member_user_id) i.member_user_id,
        '{"points":{"enabled":false,"command":"!\uC8FC\uB8E8\uB9C8\uBE14","cost":100},"donation":{"enabled":false,"minimum":1000}}'::jsonb,
        i.owner_user_id,1
      from marble_invites i join marble_rooms r on r.owner_user_id=i.owner_user_id
      left join marble_participation p on p.source_user_id=i.member_user_id
      where i.status='accepted' and i.member_user_id<>i.owner_user_id
        and exists(select 1 from jsonb_array_elements(r.state->'players') player where player->>'userId'=i.member_user_id)
      order by i.member_user_id,(i.owner_user_id=p.connected_owner_user_id) desc nulls last,i.updated_at desc,i.id desc
      on conflict(source_user_id) do update set obs_owner_user_id=excluded.obs_owner_user_id,obs_revision=1;
  end if;
end $$;
