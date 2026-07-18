const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

describe('KST attendance calendar and session integrity', () => {
  const root = path.join(__dirname, '..');
  const calendarUrl = pathToFileURL(path.join(root, 'server', 'attendance-calendar.js')).href;
  const transitionUrl = pathToFileURL(path.join(root, 'server', 'live-session-transition.js')).href;
  const serverIndex = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const serverDb = fs.readFileSync(path.join(root, 'server', 'supabase.js'), 'utf8');
  const migration = fs.readFileSync(
    path.join(root, 'server', 'migrations', '021_attendance_calendar_integrity.sql'),
    'utf8'
  );

  function runScenario() {
    const source = `
      const calendar = await import(${JSON.stringify(calendarUrl)});
      const transitions = await import(${JSON.stringify(transitionUrl)});
      const getDate = calendar.getKstCalendarDate;
      const staleDb = {
        live: true,
        start_date: '2026-07-05',
        session_start_time: Date.parse('2026-07-05T01:00:00Z'),
        last_update: Date.parse('2026-07-05T02:00:00Z'),
      };
      const sameCache = {
        live: true,
        startDate: '2026-07-18',
        sessionStartTime: Date.parse('2026-07-18T01:00:00Z'),
        lastUpdate: Date.parse('2026-07-18T02:00:00Z'),
      };
      const now = Date.parse('2026-07-18T03:00:00Z');
      const incoming = Date.parse('2026-07-18T01:00:00Z');
      const providerObservations = new Map();
      transitions.reconcileProviderLiveObservation({
        observations: providerObservations,
        sid: 'channel-1',
        provider: 'youtube',
        isLive: true,
        startTimestamp: incoming,
        now,
      });
      const protectedOffline = transitions.reconcileProviderLiveObservation({
        observations: providerObservations,
        sid: 'channel-1',
        provider: 'cime',
        isLive: false,
        now,
      });
      transitions.reconcileProviderLiveObservation({
        observations: providerObservations,
        sid: 'channel-1',
        provider: 'youtube',
        isLive: false,
        now,
      });
      const allOffline = transitions.reconcileProviderLiveObservation({
        observations: providerObservations,
        sid: 'channel-1',
        provider: 'chzzk',
        isLive: false,
        now,
      });
      const startupObservations = new Map();
      const primed = transitions.primeProviderLiveObservations({
        observations: startupObservations,
        targets: [
          { sid: 'channel-2', provider: 'chzzk' },
          { sid: 'channel-2', provider: 'cime' },
        ],
        now,
      });
      const startupOfflineDeferred = transitions.reconcileProviderLiveObservation({
        observations: startupObservations,
        sid: 'channel-2',
        provider: 'chzzk',
        isLive: false,
        now,
      });
      const startupAllOffline = transitions.reconcileProviderLiveObservation({
        observations: startupObservations,
        sid: 'channel-2',
        provider: 'cime',
        isLive: false,
        now,
      });
      const disconnectObservations = new Map();
      transitions.reconcileProviderLiveObservation({
        observations: disconnectObservations,
        sid: 'channel-3',
        provider: 'youtube',
        isLive: true,
        startTimestamp: incoming,
        now,
      });
      transitions.reconcileProviderLiveObservation({
        observations: disconnectObservations,
        sid: 'channel-3',
        provider: 'cime',
        isLive: false,
        now,
      });
      const afterLiveProviderDisconnect = transitions.removeProviderLiveObservation({
        observations: disconnectObservations,
        sid: 'channel-3',
        provider: 'youtube',
        now,
      });
      console.log(JSON.stringify({
        beforeKstMidnight: calendar.resolveAttendanceDate(Date.parse('2026-07-17T14:59:59.999Z')),
        atKstMidnight: calendar.resolveAttendanceDate(Date.parse('2026-07-17T15:00:00.000Z')),
        staleTransition: transitions.planLiveSessionTransition({
          currentSession: staleDb,
          isLive: true,
          incomingStartTimestamp: incoming,
          now,
          getDate,
        }),
        staleDateTransition: transitions.planLiveSessionTransition({
          currentSession: { ...staleDb, session_start_time: now },
          isLive: true,
          incomingStartTimestamp: incoming,
          now,
          getDate,
        }),
        cacheHeartbeat: transitions.planLiveSessionTransition({
          currentSession: sameCache,
          isLive: true,
          incomingStartTimestamp: incoming,
          now,
          getDate,
        }),
        longBroadcastHeartbeat: transitions.planLiveSessionTransition({
          currentSession: staleDb,
          isLive: true,
          incomingStartTimestamp: staleDb.session_start_time,
          now,
          getDate,
        }),
        missingStartHeartbeat: transitions.planLiveSessionTransition({
          currentSession: sameCache,
          isLive: true,
          incomingStartTimestamp: null,
          now,
          getDate,
        }),
        offlineTransition: transitions.planLiveSessionTransition({
          currentSession: sameCache,
          isLive: false,
          now,
          getDate,
        }),
        protectedOffline,
        allOffline,
        primed,
        startupOfflineDeferred,
        startupAllOffline,
        afterLiveProviderDisconnect,
      }));
    `;
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root,
      encoding: 'utf8',
    }));
  }

  test('uses the current KST calendar day at the UTC boundary', () => {
    const result = runScenario();
    expect(result.beforeKstMidnight).toBe('2026-07-17');
    expect(result.atKstMidnight).toBe('2026-07-18');
  });

  test('replaces a stale live session but preserves same and long-running sessions', () => {
    const result = runScenario();
    expect(result.staleTransition).toMatchObject({
      operation: 'start_session',
      reason: 'newer_platform_start',
      startDate: '2026-07-18',
    });
    expect(result.staleDateTransition).toMatchObject({
      operation: 'start_session',
      reason: 'newer_platform_start',
      startDate: '2026-07-18',
    });
    expect(result.cacheHeartbeat).toMatchObject({
      operation: 'heartbeat',
      reason: 'same_active_session',
      startDate: '2026-07-18',
    });
    expect(result.longBroadcastHeartbeat).toMatchObject({
      operation: 'heartbeat',
      startDate: '2026-07-05',
    });
    expect(result.missingStartHeartbeat).toMatchObject({
      operation: 'heartbeat',
      reason: 'start_time_unavailable',
      startDate: '2026-07-18',
    });
    expect(result.offlineTransition).toMatchObject({
      operation: 'end_session',
      reason: 'platform_offline',
    });
    expect(result.protectedOffline).toMatchObject({
      isLive: true,
      protectedByOtherProvider: true,
      startTimestamp: Date.parse('2026-07-18T01:00:00Z'),
    });
    expect(result.allOffline).toMatchObject({
      isLive: false,
      protectedByOtherProvider: false,
    });
    expect(result.primed).toEqual({ sidCount: 1, providerCount: 2 });
    expect(result.startupOfflineDeferred).toMatchObject({
      isLive: false,
      hasUnknownProvider: true,
      deferOffline: true,
    });
    expect(result.startupAllOffline).toMatchObject({
      isLive: false,
      hasUnknownProvider: false,
      deferOffline: false,
    });
    expect(result.afterLiveProviderDisconnect).toMatchObject({
      isLive: false,
      hasUnknownProvider: false,
      deferOffline: false,
    });
  });

  test('attendance date never falls back to a cached or database session start date', () => {
    const start = serverIndex.indexOf('async function getAttendanceDate');
    const end = serverIndex.indexOf('async function validateAndRecoverSessionState', start);
    const body = serverIndex.slice(start, end);
    expect(body).toContain('resolveAttendanceDate()');
    expect(body).toContain("source: 'current_kst'");
    expect(body).not.toContain('liveSession.get');
    expect(body).not.toContain('getLiveSessionFromDB');
  });

  test('all providers use common live-session reconciliation', () => {
    const cimeStart = serverIndex.indexOf('async function refreshCimeLiveStatus');
    const cimeEnd = serverIndex.indexOf('async function isCimeLiveAllowed', cimeStart);
    const cimeBody = serverIndex.slice(cimeStart, cimeEnd);
    expect(cimeBody).not.toContain('upsertLiveSessionToDB({');
    expect(serverIndex).toContain("updateSessionState(sid, anyLive, startTs, 'chzzk')");
    expect(serverIndex).toContain("updateSessionState(normalizedSid, live, startTs, 'youtube')");
    expect(cimeBody).toContain("updateSessionState(sid, live, parsedStartTs, 'cime')");
    expect(serverIndex).toContain('const sessionStateUpdateQueues = new Map()');
    expect(serverIndex).toContain('const providerLiveObservations = new Map()');
    expect(serverIndex).toContain('updateSessionStateLocked(sid, isLive, startTimestamp)');
    expect(serverIndex).toContain('primeConnectedProviderLiveObservations()');
    expect(serverIndex).toContain('providerObservationBootstrapPending = false');
    expect(serverIndex).toContain('reconcileSessionAfterProviderDisconnect(sid, normalizedProvider)');
    expect(serverIndex).toContain('disconnectedProviderRuntimeGuards.has(providerGuardKey)');
    expect(serverIndex).toContain('accountDeletionSessionGuards.has(sid)');
    expect(serverIndex).toContain("refreshYoutubeLiveStatus(ownerUserId, `user:${ownerUserId}`, { force: true })");
    const disconnectReconciliation = serverIndex.slice(
      serverIndex.indexOf('function reconcileSessionAfterProviderDisconnect'),
      serverIndex.indexOf('/**', serverIndex.indexOf('function reconcileSessionAfterProviderDisconnect'))
    );
    expect(disconnectReconciliation.indexOf('enqueueSessionStateUpdate')).toBeLessThan(
      disconnectReconciliation.indexOf('removeProviderLiveObservation')
    );
    const accountDeleteStart = serverIndex.indexOf("app.delete('/api/account'");
    const accountDeleteEnd = serverIndex.indexOf("app.post('/api/apikey/ws-ticket'", accountDeleteStart);
    const accountDeleteBody = serverIndex.slice(accountDeleteStart, accountDeleteEnd);
    expect(accountDeleteBody.indexOf('prepareAccountRuntimeDeletion(ownerUserId)')).toBeLessThan(
      accountDeleteBody.indexOf('deleteAccountData(ownerUserId')
    );
  });

  test('attendance points are awarded only for a newly inserted day', () => {
    const youtubeStart = serverIndex.indexOf('async function processYoutubeChatAutomation');
    const cimeStart = serverIndex.indexOf('async function processCimeChatAutomation');
    const cimeEnd = serverIndex.indexOf('async function ensureCimeSession', cimeStart);
    expect(serverIndex.slice(youtubeStart, cimeStart)).toContain('const bonus = result?.isNew ?');
    expect(serverIndex.slice(cimeStart, cimeEnd)).toContain('const bonus = result?.isNew ?');
  });

  test('Postgres records one attendance atomically and derives totals from canonical rows', () => {
    expect(serverDb).toContain("pg_advisory_xact_lock(hashtextextended($1, 0))");
    expect(serverDb).toContain('insert into public.live_days (sid, date)');
    expect(serverDb).toContain('count(distinct date)::integer as total_days');
    expect(serverDb).toContain("await pg.query('begin')");
    expect(serverDb).toContain("await pg.query('commit')");
    expect(serverDb).toContain("await pg.query('rollback')");
    expect(serverDb).toContain('withAttendanceTransactionRetry');
    expect(migration).toContain('attendance_sid_user_id_date_idx');
    expect(migration).toContain('attendance_state_sid_user_id_uniq');
    expect(migration).toContain('attendance_integrity_archive');
    expect(migration).toContain('to_jsonb(target)');
    expect(migration).toContain('revoke all on table public.attendance_integrity_archive from public');
    expect(migration).toContain('attendance_legacy_identity_review');
    expect(migration).toContain('resolve_attendance_legacy_identity');
    expect(migration).toContain('manual username-only identity resolution approved by');
    expect(serverDb).toContain("deleteRowsByColumnValues(pg, summary, 'public.attendance_integrity_archive'");
    expect(serverDb).toContain('ARUBOT_ATTENDANCE_ARCHIVE_RETENTION_DAYS');
    expect(migration).not.toMatch(/update\s+public\.attendance\s+set\s+date/i);
  });
});
