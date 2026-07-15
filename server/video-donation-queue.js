const ACTIVE_DURABLE_JOB_STATUSES = new Set(['queued', 'processing']);

function getRuntimeJobId(item) {
  return String(item?.runtimeJobId || item?.id || '').trim();
}

export function countVideoDonationQueueIncludingItem(queue, item, durableStatus) {
  const items = Array.isArray(queue) ? queue : [];
  const itemId = getRuntimeJobId(item);
  const alreadyIncluded = itemId
    ? items.some((queued) => getRuntimeJobId(queued) === itemId)
    : false;
  const active = ACTIVE_DURABLE_JOB_STATUSES.has(String(durableStatus || '').trim().toLowerCase());
  return items.length + (!alreadyIncluded && active ? 1 : 0);
}

export function countNonDurableVideoDonationItems(queue) {
  const items = Array.isArray(queue) ? queue : [];
  return items.filter((item) => !String(item?.runtimeJobId || '').trim()).length;
}

export function appendVideoDonationQueueCount(message, queueSize) {
  const text = String(message || '').trim();
  const normalizedSize = Number.isFinite(Number(queueSize))
    ? Math.max(0, Math.floor(Number(queueSize)))
    : 0;
  return `${text}${text ? ' ' : ''}(총 ${normalizedSize}개)`;
}
