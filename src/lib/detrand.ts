// FNV-1a 32-bit
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i) & 0xff;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic integer in [min, max] from key */
export function deterministicInt(
  min: number,
  max: number,
  key: string
): number {
  const lo = Math.min(min, max) | 0;
  const hi = Math.max(min, max) | 0;
  const span = hi - lo + 1;
  if (span <= 1) return lo;
  const n = fnv1a32(key);
  return lo + (n % span);
}
