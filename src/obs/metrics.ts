type Num = number;

type Summary = {
  count: Num;
  sum: Num;
  min: Num;
  max: Num;
};

function newSummary(): Summary {
  return { count: 0, sum: 0, min: Infinity, max: -Infinity };
}

export class Metrics {
  private counters = new Map<string, Num>();
  private sums = new Map<string, Summary>();
  private events = new Map<string, Num[]>(); // timestamps (ms)

  inc(name: string, by: Num = 1): void {
    const v = this.counters.get(name) ?? 0;
    this.counters.set(name, v + by);
  }

  observe(name: string, value: Num): void {
    const s = this.sums.get(name) ?? newSummary();
    s.count += 1;
    s.sum += value;
    if (value < s.min) s.min = value;
    if (value > s.max) s.max = value;
    this.sums.set(name, s);
  }

  startTimer(name: string): () => void {
    const t0 = performance.now();
    return () => {
      const ms = performance.now() - t0;
      this.observe(`${name}.ms`, ms);
    };
  }

  event(name: string, atMs: Num = Date.now()): void {
    const arr = this.events.get(name) ?? [];
    arr.push(atMs);
    // prune > 30m old
    const cutoff = atMs - 30 * 60_000;
    while (arr.length && arr[0]! < cutoff) arr.shift();
    this.events.set(name, arr);
  }

  rate(name: string, windowMs: Num): Num {
    const arr = this.events.get(name) ?? [];
    const now = Date.now();
    const cutoff = now - windowMs;
    let i = arr.length - 1;
    let n = 0;
    for (; i >= 0; i -= 1) {
      if (arr[i]! >= cutoff) n += 1;
      else break;
    }
    return n / (windowMs / 1000);
  }

  snapshot(): Record<string, unknown> {
    const counters: Record<string, Num> = {};
    for (const [k, v] of this.counters) counters[k] = v;

    const summaries: Record<string, unknown> = {};
    for (const [k, v] of this.sums) {
      const avg = v.count > 0 ? v.sum / v.count : 0;
      summaries[k] = {
        count: v.count,
        sum: v.sum,
        min: v.min,
        max: v.max,
        avg,
      };
    }

    const rates: Record<string, unknown> = {};
    for (const k of this.events.keys()) {
      rates[`${k}.rate_60s`] = this.rate(k, 60_000);
      rates[`${k}.rate_5m`] = this.rate(k, 5 * 60_000);
    }

    return { counters, summaries, rates };
  }
}

export const metrics = new Metrics();
