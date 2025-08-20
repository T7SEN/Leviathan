import Database from "better-sqlite3";
import { resolvedDbPath } from "./sqlite-store.js";

export type StreakConfig = {
  enabled: boolean;
  threshold: number; // days needed before bonus applies
  bonusFlat: number; // flat XP bonus
  bonusPercent: number; // percent of base award, e.g., 0.2 = 20%
  oncePerDay: boolean; // bonus at most once per UTC day
};

export type StreakState = {
  guildId: string;
  userId: string;
  lastDay: number; // UTC day number
  count: number; // current streak count
  lastBonusDay: number; // last UTC day a bonus was applied
};

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists streak_settings (
			guild_id text primary key,
			enabled integer not null,
			threshold integer not null,
			bonus_flat integer not null,
			bonus_percent real not null,
			once_per_day integer not null
		);
		create table if not exists streak_state (
			guild_id text not null,
			user_id text not null,
			last_day integer not null,
			count integer not null,
			last_bonus_day integer not null,
			primary key (guild_id, user_id)
		);
	`);
  return db;
}

const db = openDb();

const getCfgStmt = db.prepare(`
	select enabled, threshold, bonus_flat, bonus_percent, once_per_day
	from streak_settings where guild_id = ?
`);
const upsertCfgStmt = db.prepare(`
	insert into streak_settings (
		guild_id, enabled, threshold, bonus_flat, bonus_percent, once_per_day
	) values (?, ?, ?, ?, ?, ?)
	on conflict(guild_id) do update set
		enabled = excluded.enabled,
		threshold = excluded.threshold,
		bonus_flat = excluded.bonus_flat,
		bonus_percent = excluded.bonus_percent,
		once_per_day = excluded.once_per_day
`);

const getStateStmt = db.prepare(`
	select last_day, count, last_bonus_day
	from streak_state where guild_id = ? and user_id = ?
`);
const upsertStateStmt = db.prepare(`
	insert into streak_state (
		guild_id, user_id, last_day, count, last_bonus_day
	) values (@guildId, @userId, @lastDay, @count, @lastBonusDay)
	on conflict(guild_id, user_id) do update set
		last_day = excluded.last_day,
		count = excluded.count,
		last_bonus_day = excluded.last_bonus_day
`);
const clearGuildStmt = db.prepare(`
	delete from streak_state where guild_id = ?
`);
const clearUserStmt = db.prepare(`
	delete from streak_state where guild_id = ? and user_id = ?
`);

function dayFromMs(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

export function getStreakConfig(guildId: string): StreakConfig {
  const row = getCfgStmt.get(guildId) as any;
  if (!row) {
    return {
      enabled: false,
      threshold: 3,
      bonusFlat: 10,
      bonusPercent: 0.1,
      oncePerDay: true,
    };
  }
  return {
    enabled: Number(row.enabled) === 1,
    threshold: Number(row.threshold),
    bonusFlat: Number(row.bonus_flat),
    bonusPercent: Number(row.bonus_percent),
    oncePerDay: Number(row.once_per_day) === 1,
  };
}

export function setStreakConfig(
  guildId: string,
  patch: Partial<StreakConfig>
): StreakConfig {
  const cur = getStreakConfig(guildId);
  const next: StreakConfig = { ...cur, ...patch };
  upsertCfgStmt.run(
    guildId,
    next.enabled ? 1 : 0,
    Math.max(1, Math.floor(next.threshold)),
    Math.max(0, Math.floor(next.bonusFlat)),
    Math.max(0, Number(next.bonusPercent)),
    next.oncePerDay ? 1 : 0
  );
  return next;
}

export function getStreakState(guildId: string, userId: string): StreakState {
  const row = getStateStmt.get(guildId, userId) as any;
  if (!row) {
    return {
      guildId,
      userId,
      lastDay: -1,
      count: 0,
      lastBonusDay: -1,
    };
  }
  return {
    guildId,
    userId,
    lastDay: Number(row.last_day),
    count: Number(row.count),
    lastBonusDay: Number(row.last_bonus_day),
  };
}

export function resetStreakUser(guildId: string, userId: string): void {
  clearUserStmt.run(guildId, userId);
}

export function resetStreakGuild(guildId: string): void {
  clearGuildStmt.run(guildId);
}

/**
 * Update streak for today's activity and compute bonus for this award.
 * Returns the bonus XP (may be 0) and new streak count.
 */
export function applyStreakAndComputeBonus(
  guildId: string,
  userId: string,
  baseAward: number,
  nowMs: number = Date.now()
): { bonus: number; count: number; newDay: boolean } {
  const cfg = getStreakConfig(guildId);
  const day = dayFromMs(nowMs);
  const st = getStreakState(guildId, userId);

  let newDay = false;
  let count = st.count;

  if (st.lastDay === day) {
    // same day, count unchanged
  } else if (st.lastDay === day - 1) {
    count = st.count + 1;
    newDay = true;
  } else {
    count = 1;
    newDay = true;
  }

  let lastBonusDay = st.lastBonusDay;

  // persist day and count early
  upsertStateStmt.run({
    guildId,
    userId,
    lastDay: day,
    count,
    lastBonusDay,
  });

  if (!cfg.enabled) {
    return { bonus: 0, count, newDay };
  }

  if (cfg.oncePerDay && lastBonusDay === day) {
    return { bonus: 0, count, newDay };
  }

  if (count < Math.max(1, cfg.threshold)) {
    return { bonus: 0, count, newDay };
  }

  const pct = Math.max(0, cfg.bonusPercent);
  const flat = Math.max(0, cfg.bonusFlat);
  const extra = Math.floor(baseAward * pct) + flat;
  const bonus = Math.max(0, extra);

  if (bonus > 0) {
    lastBonusDay = day;
    upsertStateStmt.run({
      guildId,
      userId,
      lastDay: day,
      count,
      lastBonusDay,
    });
  }

  return { bonus, count, newDay };
}
