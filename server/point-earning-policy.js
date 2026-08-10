const DEFAULT_CHAT_POINTS = 1;
const DEFAULT_ATTENDANCE_POINTS = 0;
const DEFAULT_DONATION_POINTS_PER_1000_WON = 10;
const DEFAULT_ATTENDANCE_COMMAND = '!출석';

function normalizeNonNegativeNumber(value, fallback) {
  const source = value == null ? fallback : value;
  const numeric = Number(source);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function buildPointEarningPolicy(settings = {}) {
  const attendanceEnabled = settings?.attendanceEnabled !== false;
  const attendanceCommandOnly = settings?.attendanceCommandOnly === true;
  const attendanceOperational = attendanceEnabled
    && (!attendanceCommandOnly || settings?.botEnabled !== false);
  const attendanceCommandKeyword = String(
    settings?.attendanceCommandKeyword || DEFAULT_ATTENDANCE_COMMAND,
  ).trim() || DEFAULT_ATTENDANCE_COMMAND;
  const chatPointsPerMessage = normalizePointAward(
    settings?.channelPointsPerChat,
    DEFAULT_CHAT_POINTS,
  );
  const attendancePoints = normalizePointAward(
    settings?.channelPointsPerAttendance,
    DEFAULT_ATTENDANCE_POINTS,
  );
  const donationPointRatePer1000Won = normalizeNonNegativeNumber(
    settings?.donation?.pointsPerK,
    DEFAULT_DONATION_POINTS_PER_1000_WON,
  );
  const donationPointsPer1000Won = calculateDonationPointAward(
    1000,
    donationPointRatePer1000Won,
  );

  return {
    chatPointsPerMessage,
    attendancePoints,
    attendanceEnabled,
    attendanceOperational,
    attendanceMode: attendanceEnabled
      ? (attendanceCommandOnly ? 'command' : 'first_chat')
      : 'disabled',
    attendanceUnavailableReason: attendanceEnabled && !attendanceOperational
      ? 'bot_disabled'
      : null,
    attendanceCommandKeyword: attendanceEnabled && attendanceCommandOnly
      ? attendanceCommandKeyword
      : null,
    donationPointsPer1000Won,
    donationRounding: 'floor_total',
  };
}

export function calculateDonationPointAward(amount, pointsPer1000Won) {
  const normalizedAmount = normalizeNonNegativeNumber(amount, 0);
  const normalizedRate = normalizeNonNegativeNumber(pointsPer1000Won, 0);
  return Math.floor((normalizedAmount / 1000) * normalizedRate);
}

export function normalizePointAward(value, fallback = 0) {
  return Math.floor(normalizeNonNegativeNumber(value, fallback));
}

export function buildViewerPointSettingsSidCandidates(balance = {}) {
  const verifiedSid = String(balance?.pointSettingsSid || '').trim();
  if (verifiedSid) {
    return [verifiedSid.startsWith('user:') ? verifiedSid : `user:${verifiedSid}`];
  }

  const canonicalUid = String(balance?.canonicalChannelUid || '').trim();
  const channelUid = String(balance?.channelUid || '').trim();
  if (!canonicalUid) return [];

  // A canonical UID is authoritative only when platform-account metadata
  // distinguishes it from the public channel UID (or it is already a SID).
  // Ambiguous raw channel IDs must be resolved through ownership lookup first;
  // otherwise a stale legacy bot_settings row can be attached to a new owner.
  const isAuthoritativeOwner = canonicalUid.startsWith('user:')
    || (channelUid && canonicalUid !== channelUid);
  if (!isAuthoritativeOwner) return [];

  return [canonicalUid.startsWith('user:') ? canonicalUid : `user:${canonicalUid}`];
}

export async function resolveViewerPointEarningPolicy(balance = {}, {
  getSettings,
  resolveSid,
} = {}) {
  if (typeof getSettings !== 'function') {
    throw new TypeError('getSettings must be a function');
  }

  const seenSids = new Set();
  let fallbackPolicy = null;
  const readPolicy = async (sid) => {
    const normalizedSid = String(sid || '').trim();
    if (!normalizedSid || seenSids.has(normalizedSid)) return null;
    seenSids.add(normalizedSid);
    try {
      const settings = await getSettings(normalizedSid);
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
      const policy = buildPointEarningPolicy(settings);
      fallbackPolicy ||= policy;
      return Object.keys(settings).length > 0 ? policy : null;
    } catch {
      return null;
    }
  };

  for (const sid of buildViewerPointSettingsSidCandidates(balance)) {
    const policy = await readPolicy(sid);
    if (policy) return policy;
    // An authoritative SID with an empty settings object means the streamer is
    // using runtime defaults. Do not let a stale channel alias override them.
    if (fallbackPolicy) return fallbackPolicy;
  }

  if (typeof resolveSid === 'function') {
    const publicUids = Array.from(new Set([
      balance?.canonicalChannelUid,
      balance?.channelUid,
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    for (const uid of publicUids) {
      try {
        const resolvedSid = await resolveSid(uid);
        const policy = await readPolicy(resolvedSid);
        if (policy) return policy;
      } catch {
        // A disconnected or legacy channel must not block the other balances.
      }
    }
  }

  return fallbackPolicy;
}
