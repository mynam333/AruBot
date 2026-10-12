export function visibleQueueRows(height: number, rowHeight: number, total: number, footerHeight = 30) {
  const available = Math.max(0, height);
  const rows = Math.floor(available / Math.max(1, rowHeight));
  return total <= rows ? total : Math.max(0, Math.floor((available - footerHeight) / Math.max(1, rowHeight)));
}

export function titleScrollTiming(distance: number) {
  const travel = Math.max(1000, Math.max(0, distance) / 32 * 1000);
  const pause = 1800;
  const duration = pause + travel + pause + 1;
  return { duration, start: pause / duration, end: (pause + travel) / duration, reset: (duration - 1) / duration };
}
