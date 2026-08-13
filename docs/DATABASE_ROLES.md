# Production database roles

Production supports separate PostgreSQL credentials for service traffic and schema changes.

- `POSTGRES_RUNTIME_URL`: application runtime role. Grant only the table, sequence, and function privileges needed by AruBot.
- `POSTGRES_MIGRATION_URL`: migration owner role. This role may create and alter schema objects and is used only by `npm run db:migrate` during deployment.
- `POSTGRES_URL`: compatibility fallback when the two-role rollout has not yet been completed.

The runtime role must be able to `SELECT`, `INSERT`, `UPDATE`, and `DELETE` rows in
`public.bot_counter_values` and `public.public_short_links`. Migrations
`022_bot_counter_values.sql` and `023_public_short_links.sql` create these tables but do
not broaden database access for `public`; deployments with a separate runtime role must
grant those four table privileges through their normal role-provisioning policy. Run
`npm run db:provider-smoke` with the runtime credential after migrations; it verifies
both tables' effective write permissions inside rolled-back transactions.

The deployment workflow runs migrations before switching the active release. A migration failure leaves the previous release active. Both runtime and migration clients require verified TLS for remote production databases; set `POSTGRES_SSL=verify-full` and provide `POSTGRES_SSL_CA` or `POSTGRES_SSL_CA_FILE` when the host certificate is not rooted in the system trust store.

Rotate from the compatibility URL in two stages: create and validate the migration role, then create the runtime role and set both dedicated URLs. Keep the migration credential out of the long-running PM2 environment when deployment secret injection can provide it only to the migration command.
