export function weightedPick<T extends [any, number]>(items: T[]): T[0] {
  if (items.length === 0) throw new Error("weightedPick: empty");
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of items) {
    if (r < w) return k;
    r -= w;
  }
  return items[0]![0];
}
