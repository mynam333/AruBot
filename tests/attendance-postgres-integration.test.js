const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

const postgresTest = process.env.ARUBOT_TEST_POSTGRES_URL ? test : test.skip;

describe('PostgreSQL attendance migration and recording', () => {
  postgresTest('migrates legacy rows and records a cumulative user once per KST day', () => {
    const root = path.join(__dirname, '..');
    const dbUrl = process.env.ARUBOT_TEST_POSTGRES_URL;
    const supabaseUrl = pathToFileURL(path.join(root, 'server', 'supabase.js')).href;
    const migrationPath = path.join(root, 'server', 'migrations', '021_attendance_calendar_integrity.sql');
    const source = `
      import fs from 'node:fs';
      import pg from 'pg';

      const { Client } = pg;
      const dbUrl = process.env.ARUBOT_TEST_POSTGRES_URL;
      const parsedDbUrl = new URL(dbUrl);
      const isLocalTestDatabase = ['localhost', '127.0.0.1', '::1'].includes(parsedDbUrl.hostname)
        && /test/i.test(parsedDbUrl.pathname);
      if (!isLocalTestDatabase) throw new Error('Attendance integration test requires a local database whose name contains test');
      const client = new Client({
        connectionString: dbUrl,
        ssl: false,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        query_timeout: 10_000,
      });
      let legacyMigration = null;
      await client.connect();
      try {
        await client.query(\`
          drop table if exists public.attendance_integrity_archive cascade;
          drop table if exists public.attendance_state cascade;
          drop table if exists public.attendance cascade;
          drop table if exists public.live_days cascade;
          create table public.live_days (
            sid text not null,
            date text not null,
            primary key (sid, date)
          );
          create table public.attendance (
            sid text not null,
            userid text not null,
            date text not null,
            username text not null,
            primary key (sid, date, username)
          );
          create table public.attendance_state (
            sid text not null,
            userid text not null,
            lastdate text,
            streak integer default 0,
            total_days integer default 0
          );
          insert into public.live_days (sid, date) values
            ('channel-1', '2026-07-04'),
            ('channel-1', '2026-07-05');
          insert into public.attendance (sid, userid, date, username) values
            ('channel-1', 'viewer-1', '2026-07-04', 'Alice'),
            ('channel-1', 'viewer-1', '2026-07-05', 'Alice'),
            ('channel-1', 'viewer-1', '2026-07-05', 'Alice old');
          insert into public.attendance_state (sid, userid, lastdate, streak, total_days) values
            ('channel-1', 'viewer-1', '2026-07-04', 1, 1),
            ('channel-1', 'viewer-1', '2026-07-05', 2, 2);
        \`);
        await client.query(fs.readFileSync(${JSON.stringify(migrationPath)}, 'utf8'));
        await client.query(
          \`insert into public.attendance (sid, user_id, date, username) values
             ('channel-legacy', null, '2026-07-01', 'Bob'),
             ('channel-legacy', null, '2026-07-02', 'Bob')\`
        );
        const legacyBefore = await client.query(
          \`select sid, username, attendance_days, first_date, last_date
             from public.attendance_legacy_identity_review
            where sid = 'channel-legacy' and username = 'Bob'\`
        );
        const legacyRecovery = await client.query(
          \`select * from public.resolve_attendance_legacy_identity($1, $2, $3, $4)\`,
          ['channel-legacy', '2026-07-01', 'Bob', 'viewer-bob']
        );
        const legacyAfter = await client.query(
          \`select sid, username, attendance_days, first_date, last_date
             from public.attendance_legacy_identity_review
            where sid = 'channel-legacy' and username = 'Bob'\`
        );
        legacyMigration = {
          legacyBefore: legacyBefore.rows[0],
          legacyRecovery: legacyRecovery.rows[0],
          legacyAfter: legacyAfter.rows[0],
        };
      } finally {
        await client.end();
      }

      process.env.ARUBOT_DB_PROVIDER = 'postgres';
      process.env.POSTGRES_RUNTIME_URL = dbUrl;
      process.env.POSTGRES_URL = dbUrl;
      process.env.POSTGRES_SSL = 'false';
      const database = await import(${JSON.stringify(supabaseUrl)});
      await database.initDb();
      try {
        const first = await database.recordAttendanceAndGetStreak(
          'channel-1',
          'viewer-1',
          'Alice',
          '2026-07-18'
        );
        const second = await database.recordAttendanceAndGetStreak(
          'channel-1',
          'viewer-1',
          'Alice',
          '2026-07-18'
        );
        const sameNameDifferentUser = await database.recordAttendanceAndGetStreak(
          'channel-1',
          'viewer-2',
          'Alice',
          '2026-07-18'
        );
        const legacyNewAttendance = await database.recordAttendanceAndGetStreak(
          'channel-legacy',
          'viewer-bob',
          'Bob',
          '2026-07-18'
        );
        const totalDays = await database.getUserAttendanceTotalDays('channel-1', 'viewer-1');

        const verify = new Client({
          connectionString: dbUrl,
          ssl: false,
          connectionTimeoutMillis: 5_000,
          statement_timeout: 10_000,
          query_timeout: 10_000,
        });
        await verify.connect();
        let archivedRows = 0;
        let state = null;
        try {
          const archived = await verify.query(
            'select count(*)::integer as count from public.attendance_integrity_archive'
          );
          const stateResult = await verify.query(
            \`select last_date, streak, total_days
               from public.attendance_state
              where sid = $1 and user_id = $2\`,
            ['channel-1', 'viewer-1']
          );
          archivedRows = Number(archived.rows[0].count);
          state = stateResult.rows[0];
        } finally {
          await verify.end();
        }

        console.log(JSON.stringify({
          first,
          second,
          sameNameDifferentUser,
          legacyNewAttendance,
          totalDays,
          archivedRows,
          state,
          legacyMigration,
        }));
      } finally {
        await database.closeDatabaseConnections();
      }
    `;

    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root,
      env: {
        ...process.env,
        ARUBOT_TEST_POSTGRES_URL: dbUrl,
      },
      encoding: 'utf8',
      timeout: 25_000,
    }).trim().split(/\r?\n/).at(-1));

    expect(result.first).toMatchObject({ isNew: true, streak: 3, totalDays: 3 });
    expect(result.second).toMatchObject({ isNew: false, streak: 3, totalDays: 3 });
    expect(result.sameNameDifferentUser).toMatchObject({ isNew: true, totalDays: 1 });
    expect(result.legacyNewAttendance).toMatchObject({ isNew: true, streak: 1, totalDays: 2 });
    expect(result.totalDays).toBe(3);
    expect(result.archivedRows).toBe(3);
    expect(result.state).toMatchObject({ last_date: '2026-07-18', streak: 3, total_days: 3 });
    expect(result.legacyMigration.legacyBefore).toMatchObject({
      attendance_days: 2,
      first_date: '2026-07-01',
      last_date: '2026-07-02',
    });
    expect(result.legacyMigration.legacyRecovery).toMatchObject({
      resolution_status: 'updated',
      affected_rows: 1,
    });
    expect(result.legacyMigration.legacyAfter).toMatchObject({
      attendance_days: 1,
      first_date: '2026-07-02',
      last_date: '2026-07-02',
    });
  }, 30_000);
});
