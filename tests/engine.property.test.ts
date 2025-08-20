import * as fc from "fast-check";
import { describe, it, expect } from 'vitest'
import {
  xpToNext,
  levelFromTotalXp,
  MAX_LEVEL,
  MemoryLevelStore,
  LevelingEngine,
} from "../src/features/leveling/engine.ts";

function xpAtLevelStart(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

describe("level math properties", () => {
  it("levelFromTotalXp is within [0, MAX_LEVEL]", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (total) => {
        const lvl = levelFromTotalXp(total);
        expect(lvl).toBeGreaterThanOrEqual(0);
        expect(lvl).toBeLessThanOrEqual(MAX_LEVEL);
      })
    );
  });

  it("monotonic: more XP never decreases level", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500_000 }),
        fc.integer({ min: 0, max: 500_000 }),
        (a, b) => {
          const x = Math.min(a, b);
          const y = Math.max(a, b);
          expect(levelFromTotalXp(y)).toBeGreaterThanOrEqual(
            levelFromTotalXp(x)
          );
        }
      )
    );
  });

  it("level bounds align with xpToNext sums", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 250_000 }), (total) => {
        const lvl = levelFromTotalXp(total);
        const start = xpAtLevelStart(lvl);
        const next =
          lvl < MAX_LEVEL ? xpAtLevelStart(lvl + 1) : Number.POSITIVE_INFINITY;
        expect(total).toBeGreaterThanOrEqual(start);
        expect(total).toBeLessThan(next);
      })
    );
  });

  it("xpToNext is positive for levels < MAX_LEVEL", () => {
    for (let l = 0; l < MAX_LEVEL; l += 1) {
      expect(xpToNext(l)).toBeGreaterThan(0);
    }
  });
});

describe("engine award properties", () => {
  it("awardRawXp is additive until MAX_LEVEL, then stops", async () => {
    const eng = new LevelingEngine(new MemoryLevelStore());
    const g = "g",
      u = "u";
    let total = 0;
    while (true) {
      const before = levelFromTotalXp(total);
      const r = await eng.awardRawXp(g, u, 50);
      total += r.awarded;
      const after = r.profile.level;
      if (after >= MAX_LEVEL) {
        // no more progression
        const r2 = await eng.awardRawXp(g, u, 50);
        expect(r2.awarded).toBe(0);
        expect(r2.profile.level).toBe(MAX_LEVEL);
        break;
      }
      expect(after).toBeGreaterThanOrEqual(before);
    }
  });

  it("awardMessageXp honors min/max and cooldown", async () => {
    const eng = new LevelingEngine(new MemoryLevelStore(), {
      minIntervalMs: 1_000,
      xpPerMessageMin: 10,
      xpPerMessageMax: 20,
    });
    const g = "g",
      u = "u";
    const r1 = await eng.awardMessageXp(g, u, 0);
    expect(r1.awarded).toBeGreaterThanOrEqual(10);
    expect(r1.awarded).toBeLessThanOrEqual(20);

    // cooldown blocks immediate double-award
    const r2 = await eng.awardMessageXp(g, u, 500);
    expect(r2.awarded).toBe(0);

    // after cooldown, award again
    const r3 = await eng.awardMessageXp(g, u, 1_500);
    expect(r3.awarded).toBeGreaterThan(0);
  });
});
