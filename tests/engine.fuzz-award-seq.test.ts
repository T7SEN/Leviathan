import * as fc from "fast-check";
import { describe, it, expect } from 'vitest'
import {
  MemoryLevelStore,
  LevelingEngine,
  levelFromTotalXp,
  MAX_LEVEL,
} from "../src/features/leveling/engine.ts";

describe("fuzz: random award sequences", () => {
  it("engine state stays consistent with levelFromTotalXp", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 200 }), { maxLength: 500 }),
        async (seq) => {
          const eng = new LevelingEngine(new MemoryLevelStore());
          const g = "g",
            u = "u";
          let expectedTotal = 0;
          for (const amt of seq) {
            const r = await eng.awardRawXp(g, u, amt);
            expectedTotal += r.awarded;
            const lvl = levelFromTotalXp(expectedTotal);
            expect(r.profile.level).toBe(lvl);
            if (lvl >= MAX_LEVEL) break;
          }
          // No negative surprises at end
          const final = (await eng.awardRawXp(g, u, 0)).profile;
          expect(final.xp).toBe(expectedTotal);
          expect(final.level).toBe(levelFromTotalXp(expectedTotal));
        }
      ),
      { numRuns: 50 }
    );
  });
});
