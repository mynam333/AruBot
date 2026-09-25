// Next.js and older shared links can supply encoded or already-decoded params.
// Channel identities never contain path separators or literal percent signs.
export function decodeChannelRouteParam(value: string): string | null {
  let decoded = value;
  for (let depth = 0; depth < 3 && decoded.includes('%'); depth += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return null;
    }
  }
  return /^(?:(?:chzzk|cime|youtube):)?[a-z0-9_-]{1,128}$/i.test(decoded) ? decoded : null;
}
