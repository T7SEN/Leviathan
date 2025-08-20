import {
  xpToNext,
  levelFromTotalXp,
  MAX_LEVEL,
  MemoryLevelStore,
  LevelingEngine,
} from "../src/features/leveling/engine.ts";
import { describe, it, expect } from "vitest";

function xpAtLevelStart(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

describe("soak: curve and cap", () => {
  it("reaches MAX_LEVEL within bounded steps and then freezes", async () => {
    const eng = new LevelingEngine(new MemoryLevelStore(), {
      minIntervalMs: 0,
      xpPerMessageMin: 15,
      xpPerMessageMax: 25,
    });
    const g = "g",
      u = "u";
    let steps = 0;
    // award until max level or max steps
    while (steps < 100_000) {
      const r = await eng.awardMessageXp(g, u, steps);
      steps += 1;
      if (r.profile.level >= MAX_LEVEL) break;
    }
    expect(steps).toBeLessThan(100_000);

    // further awards do nothing
    const before = (await eng.awardRawXp(g, u, 0)).profile;
    const r2 = await eng.awardRawXp(g, u, 999);
    expect(r2.awarded).toBe(0);
    expect(r2.profile.level).toBe(MAX_LEVEL);
    expect(r2.profile.xp).toBe(before.xp);
  });

  it("xpAtLevelStart matches levelFromTotalXp boundaries up to cap", () => {
    let total = 0;
    for (let l = 0; l < MAX_LEVEL; l += 1) {
      const start = xpAtLevelStart(l);
      expect(levelFromTotalXp(start)).toBe(l);
      total = start + xpToNext(l) - 1;
      expect(levelFromTotalXp(total)).toBe(l);
    }
  });
});
