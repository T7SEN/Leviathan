import { randomInt as nodeRandomInt } from "node:crypto";
import { deterministicInt } from "../../lib/detrand.js";

export type LevelProfile = {
  userId: string;
  guildId: string;
  xp: number;
  level: number;
  lastAwardMs: number | null;
};
export const MAX_LEVEL = 15;

export interface LevelStore {
  get: (guildId: string, userId: string) => Promise<LevelProfile | null>;
  set: (profile: LevelProfile) => Promise<void>;
  listTop: (
    guildId: string,
    limit: number,
    offset?: number
  ) => Promise<LevelProfile[]>;
}

export type LevelPolicy = {
  minIntervalMs: number; // per-user cooldown
  xpPerMessageMin: number; // inclusive
  xpPerMessageMax: number; // inclusive
};

export const defaultPolicy: LevelPolicy = {
  minIntervalMs: 60_000,
  xpPerMessageMin: 15,
  xpPerMessageMax: 25,
};

export function xpToNext(level: number): number {
  // Stop progression at cap
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;
  // 8L^2 + 25L, clamp so L=0 costs > 0 XP
  const v = 8 * (level * level) + 25 * level;
  return v > 0 ? v : 1;
}

export function levelFromTotalXp(totalXp: number): number {
  // 0-based levels up to MAX_LEVEL
  let lvl = 0;
  let rem = totalXp;
  while (lvl < MAX_LEVEL && rem >= xpToNext(lvl)) {
    rem -= xpToNext(lvl);
    lvl += 1;
  }
  return lvl;
}

export function randomInt(min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export class MemoryLevelStore implements LevelStore {
  private map = new Map<string, LevelProfile>();

  private key(g: string, u: string): string {
    return `${g}:${u}`;
  }

  async get(g: string, u: string): Promise<LevelProfile | null> {
    return this.map.get(this.key(g, u)) ?? null;
  }

  async set(p: LevelProfile): Promise<void> {
    this.map.set(this.key(p.guildId, p.userId), p);
  }
  async listTop(
    guildId: string,
    limit: number,
    offset = 0
  ): Promise<LevelProfile[]> {
    const rows: LevelProfile[] = [];
    for (const p of this.map.values()) {
      if (p.guildId === guildId) rows.push(p);
    }
    rows.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return b.xp - a.xp;
    });
    return rows.slice(offset, offset + limit);
  }
}

export class LevelingEngine {
  private store: LevelStore;
  private policy: LevelPolicy;

  constructor(store: LevelStore, policy: LevelPolicy = defaultPolicy) {
    this.store = store;
    this.policy = policy;
  }

  async awardMessageXp(
    guildId: string,
    userId: string,
    nowMs: number = Date.now(),
    overridePolicy?: LevelPolicy,
    randKey?: string
  ): Promise<{
    profile: LevelProfile;
    awarded: number;
    leveledUp: boolean;
  }> {
    const policy = overridePolicy ?? this.policy;
    const prev = (await this.store.get(guildId, userId)) ?? {
      userId,
      guildId,
      xp: 0,
      level: 0,
      lastAwardMs: null,
    };

    // No XP beyond cap
    if (prev.level >= MAX_LEVEL) {
      return { profile: prev, awarded: 0, leveledUp: false };
    }

    if (
      prev.lastAwardMs !== null &&
      nowMs - prev.lastAwardMs < policy.minIntervalMs
    ) {
      return { profile: prev, awarded: 0, leveledUp: false };
    }

    const add = randKey
      ? deterministicInt(
          policy.xpPerMessageMin,
          policy.xpPerMessageMax,
          randKey
        )
      : nodeRandomInt(policy.xpPerMessageMin, policy.xpPerMessageMax);

    const newTotal = prev.xp + add;
    const newLevel = levelFromTotalXp(newTotal);
    const leveledUp = newLevel > prev.level;

    const next: LevelProfile = {
      ...prev,
      xp: newTotal,
      level: newLevel,
      lastAwardMs: nowMs,
    };

    await this.store.set(next);

    return { profile: next, awarded: add, leveledUp };
  }
  async awardRawXp(
    guildId: string,
    userId: string,
    amount: number,
    nowMs: number = Date.now()
  ): Promise<{
    profile: LevelProfile;
    awarded: number;
    leveledUp: boolean;
  }> {
    const prev = (await this.store.get(guildId, userId)) ?? {
      userId,
      guildId,
      xp: 0,
      level: 0,
      lastAwardMs: null,
    };
    if (prev.level >= MAX_LEVEL || amount <= 0) {
      return { profile: prev, awarded: 0, leveledUp: false };
    }
    const newTotal = prev.xp + amount;
    const newLevel = levelFromTotalXp(newTotal);
    const leveledUp = newLevel > prev.level;
    const next: LevelProfile = {
      ...prev,
      xp: newTotal,
      level: newLevel,
      lastAwardMs: nowMs,
    };
    await this.store.set(next);
    return { profile: next, awarded: amount, leveledUp };
  }
}
