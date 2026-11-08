alter table songbook_settings add column if not exists completed_cleanup_after timestamptz;
create index if not exists songbook_completed_cleanup_due
  on songbook_settings(completed_cleanup_after)
  where completed_cleanup_after is not null and requests_enabled=false;
