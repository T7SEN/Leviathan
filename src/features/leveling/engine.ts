// src/features/engine.ts
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

/**
 * Global scale for XP required per level.
 * Example: LEVEL_XP_SCALE=1.25 → +25% harder across the board.
 */
const XP_SCALE: number = Number(process.env.LEVEL_XP_SCALE ?? "1") || 1;

/**
 * Precise per-level control: XP needed to go from L → L+1.
 * Only include levels you want to override. Others use the base formula.
 * Example values shown; adjust or leave {} to disable overrides.
 */
const LEVEL_XP_OVERRIDE: Record<number, number> = {
  // 1: 60,
  // 2: 110,
  // 3: 170,
  // ...
  // 14: 1490,
  // 15: 999999999, // effectively prevents 15 → 16
};

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

function sanitizePolicy(p: LevelPolicy): LevelPolicy {
  let min = Math.floor(p.xpPerMessageMin);
  let max = Math.floor(p.xpPerMessageMax);
  if (min < 0) min = 0;
  if (max < 0) max = 0;
  if (max < min) {
    const t = min;
    min = max;
    max = t;
  }
  const minIntervalMs = Math.max(0, Math.floor(p.minIntervalMs));
  return { minIntervalMs, xpPerMessageMin: min, xpPerMessageMax: max };
}

/**
 * XP required to advance from `level` → `level + 1`.
 * - Stops at MAX_LEVEL
 * - Uses per-level override if present, else base formula 8L^2 + 25L
 * - Applies global XP_SCALE
 * - Always returns at least 1 for L=0 edge case
 */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return Number.POSITIVE_INFINITY;

  const base =
    LEVEL_XP_OVERRIDE[level] !== undefined
      ? LEVEL_XP_OVERRIDE[level]
      : 128 * (3 * level * level + 3 * level + 1);

  const scaled = Math.ceil((base > 0 ? base : 1) * XP_SCALE);
  return scaled > 0 ? scaled : 1;
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
    this.policy = sanitizePolicy(policy);
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
    const policy = sanitizePolicy(overridePolicy ?? this.policy);
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
      : nodeRandomInt(policy.xpPerMessageMin, policy.xpPerMessageMax + 1);

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
