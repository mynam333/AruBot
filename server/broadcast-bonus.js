import { isBroadcastBonusCategory, validateBroadcastBonus } from '../shared/broadcast-bonus.js';

const fields = 'live, bonus_session_key, bonus_amount, bonus_categories';
function describe(row) {
  return row?.live
    ? { live: true, sessionKey: row.bonus_session_key, amount: row.bonus_amount, categories: row.bonus_categories }
    : { live: false, sessionKey: null, amount: 0, categories: [] };
}

export async function readBroadcastBonus(pg, sid) {
  return describe((await pg.query(`select ${fields} from live_sessions where sid=$1`, [sid])).rows[0]);
}

export async function saveBroadcastBonus(pg, sid, input) {
  const { sessionKey, amount, categories } = validateBroadcastBonus(input);
  const { rows } = await pg.query(
    `update live_sessions set bonus_amount=$3, bonus_categories=$4
     where sid=$1 and live and bonus_session_key::text=$2 returning ${fields}`,
    [sid, sessionKey, amount, categories],
  );
  if (!rows[0]) throw Object.assign(new Error('방송이 종료되었거나 변경되었습니다. 현재 방송을 다시 확인해 주세요.'), { status: 409 });
  return describe(rows[0]);
}

// Called inside the deduction transaction, after locking the viewer's wallet.
// The row lock serializes purchases against edits, offline transitions and cleanup.
export async function readEligibleAllowance(pg, sid, category, viewer) {
  if (!sid || !isBroadcastBonusCategory(category)) return null;
  const { rows } = await pg.query(
    'select bonus_session_key, bonus_amount from live_sessions where sid=$1 and live and bonus_amount>0 and $2=any(bonus_categories) for share',
    [sid, category],
  );
  if (!rows[0]) return null;
  await pg.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`broadcast-bonus:${sid}:${viewer.canonicalUserId}`]);
  const used = await pg.query('select coalesce(sum(spent),0) as spent from broadcast_bonus_usage where sid=$1 and user_id=any($2::text[])', [sid, viewer.identityKeys]);
  return { sessionKey: rows[0].bonus_session_key, remaining: Math.max(0, rows[0].bonus_amount - Number(used.rows[0].spent)) };
}

export async function useAllowance(pg, sid, userId, amount) {
  await pg.query(`insert into broadcast_bonus_usage(sid,user_id,spent) values ($1,$2,$3)
    on conflict(sid,user_id) do update set spent=broadcast_bonus_usage.spent+excluded.spent`, [sid, userId, amount]);
}

export async function restoreAllowance(pg, sid, receipt) {
  if (!receipt.bonusSpent) return 0;
  const session = await pg.query('select 1 from live_sessions where sid=$1 and live and bonus_session_key::text=$2 for share', [sid, receipt.sessionKey]);
  if (!session.rowCount) return 0;
  const { rowCount } = await pg.query('update broadcast_bonus_usage set spent=spent-$3 where sid=$1 and user_id=$2 and spent >= $3', [sid, receipt.userId, receipt.bonusSpent]);
  if (!rowCount) {
    // Account erasure can remove this viewer while other entries still need to settle.
    const usage = await pg.query('select 1 from broadcast_bonus_usage where sid=$1 and user_id=$2', [sid, receipt.userId]);
    if (usage.rowCount) throw new Error('Broadcast point refund does not match original spend');
    return 0;
  }
  return receipt.bonusSpent;
}
