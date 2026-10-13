import 'dotenv/config';
import { cleanupUnlinkedAccounts, closeDatabaseConnections } from '../server/supabase.js';
import { automationSoundOwnerKey, deleteAccountAutomationSoundFiles } from '../server/account-local-files.js';

const failureCode = error => typeof error?.code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(error.code)
  ? error.code : 'cleanup_failed';

const args = process.argv.slice(2);
if (args.some(arg => !['--apply', '--dry-run'].includes(arg)) || (args.includes('--apply') && args.includes('--dry-run'))) {
  console.error('Usage: node scripts/cleanup-unlinked-accounts.js [--dry-run | --apply]');
  process.exitCode = 1;
} else {
  const dryRun = !args.includes('--apply');
  const before = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let after = '', more = true;
  const total = { dryRun, scanned: 0, eligible: 0, deleted: 0, failed: 0, databaseFailed: 0,
    soundDirectoriesCleaned: 0, soundDirectoriesFailed: 0, soundFailureCodes: Object.create(null), skipped: {} };
  try {
    while (more) {
      const soundFailures = [];
      const onDeleted = dryRun ? undefined : owner => {
        try {
          deleteAccountAutomationSoundFiles(owner);
          total.soundDirectoriesCleaned++;
        } catch (error) {
          const code = failureCode(error);
          total.soundDirectoriesFailed++;
          total.failed++;
          total.soundFailureCodes[code] = (total.soundFailureCodes[code] || 0) + 1;
          // Only a hashed storage key and a bounded error code, never FS paths,
          // raw exceptions, connection strings or credentials.
          let ownerKey = null;
          try { ownerKey = automationSoundOwnerKey(owner); } catch { /* Invalid identity is reported by code. */ }
          soundFailures.push({ ownerKey, code });
        }
      };
      const result = await cleanupUnlinkedAccounts({ dryRun, before, after, limit: 50, onDeleted });
      for (const key of ['scanned', 'eligible', 'deleted']) total[key] += result[key];
      total.failed += result.failed.length;
      total.databaseFailed += result.failed.length;
      for (const [key, value] of Object.entries(result.skipped)) total.skipped[key] = (total.skipped[key] || 0) + value;
      more = result.hasMore; after = result.after;
      console.log(JSON.stringify({ scanned: result.scanned, eligible: result.eligible, deleted: result.deleted,
        failed: result.failed.length + soundFailures.length, databaseFailed: result.failed.length,
        soundDirectoriesFailed: soundFailures.length, soundFailures, hasMore: more }));
    }
  } catch (error) {
    total.failed++;
    console.error('[unlinked-account-cleanup]', failureCode(error));
    process.exitCode = 1;
  } finally {
    try { await closeDatabaseConnections(); }
    catch (error) {
      total.failed++;
      console.error('[unlinked-account-cleanup:close]', failureCode(error));
    }
    console.log(JSON.stringify(total));
    if (total.failed) process.exitCode = 1;
  }
}
