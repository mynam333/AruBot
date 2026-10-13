alter table songbook_requests alter column viewer_user_id drop not null;
alter table songbook_requests add column if not exists chat_provider text;
alter table songbook_requests add column if not exists chat_user_id text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='songbook_requests_identity_check' and conrelid='songbook_requests'::regclass) then
    alter table songbook_requests add constraint songbook_requests_identity_check check (
      (viewer_user_id is not null and chat_provider is null and chat_user_id is null)
      or (chat_provider is not null and chat_provider in ('chzzk','cime','youtube') and chat_user_id is not null and length(chat_user_id) between 1 and 200)
    );
  end if;
end $$;
create unique index if not exists songbook_requests_chat_key on songbook_requests(owner_user_id,chat_provider,chat_user_id,request_key) where chat_provider is not null;
create unique index if not exists songbook_requests_chat_active on songbook_requests(owner_user_id,chat_provider,chat_user_id,song_id) where chat_provider is not null and status in ('pending','singing');
