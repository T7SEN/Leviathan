// src/features/drops/config.ts

import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";

export type DropsConfig = {
  allowChannels: string[] | null;
  channelDenylist: string[] | null;
  minMessagesBeforeSpawn: number;
  channelCooldownMs: number;
  globalPerHour: number;
  globalPerDay: number;
  decayEveryMs: number;
  decayPct: number; // 0–1
  applyRoleMultiplier: boolean;

  // per-user + pity
  perUserCooldownMs: number;
  pityEnabled: boolean;
  pityMinMessages: number;
  pityWindowMs: number;
  pityTier: "common" | "uncommon" | "rare" | "epic" | "legendary";

  // sweeper / retention
  sweeperIntervalMs: number;
  dropRetentionMs: number;

  // anti-abuse
  minAccountAgeMs: number;
  minGuildJoinAgeMs: number;
  maxClaimsPerMinutePerUser: number;
  maxClaimsPerHourPerUser: number;

  // BOSS CAPSULE
  bossEnabled: boolean;
  bossMsgs: number;
  bossVoiceMins: number;
  bossCooldownMs: number;
  bossChannelId: string | null;
  bossTier: "legendary" | "epic" | "rare" | "uncommon" | "common";
  bossBaseXp: number;
};

const defaults: DropsConfig = {
  allowChannels: null,
  channelDenylist: null,
  minMessagesBeforeSpawn: 20,
  channelCooldownMs: 15 * 60_000,
  globalPerHour: 3,
  globalPerDay: 10,
  decayEveryMs: 3_000,
  decayPct: 0.05,
  applyRoleMultiplier: true,

  // per-user + pity
  perUserCooldownMs: 5 * 60_000,
  pityEnabled: true,
  pityMinMessages: 40,
  pityWindowMs: 24 * 60 * 60_000,
  pityTier: "uncommon",

  // sweeper / retention
  sweeperIntervalMs: 60_000,
  dropRetentionMs: 7 * 24 * 60 * 60_000,

  // anti-abuse
  minAccountAgeMs: 7 * 24 * 60 * 60_000,
  minGuildJoinAgeMs: 24 * 60 * 60_000,
  maxClaimsPerMinutePerUser: 3,
  maxClaimsPerHourPerUser: 20,

  // BOSS CAPSULE
  bossEnabled: true,
  bossMsgs: 500,
  bossVoiceMins: 120,
  bossCooldownMs: 6 * 60_000, // 6 minutes
  bossChannelId: null,
  bossTier: "legendary",
  bossBaseXp: 800,
};

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists drops_config (
		guild_id text primary key,
		json     text not null
	)
`);

function loadRaw(guildId: string): Partial<DropsConfig> | null {
  const r = db
    .prepare("select json from drops_config where guild_id = ?")
    .get(guildId) as any;
  if (!r?.json) return null;
  try {
    return JSON.parse(String(r.json));
  } catch {
    return null;
  }
}

export function getDropsConfig(guildId: string): DropsConfig {
  const raw = loadRaw(guildId);
  // merging with defaults auto-fills any newly added fields like boss*
  return { ...defaults, ...(raw ?? {}) };
}

export function setDropsConfig(
  guildId: string,
  patch: Partial<DropsConfig>
): DropsConfig {
  const next = { ...getDropsConfig(guildId), ...patch };
  db.prepare(
    `
		insert into drops_config (guild_id, json)
		values (?, ?)
		on conflict(guild_id) do update set json = excluded.json
	`
  ).run(guildId, JSON.stringify(next));
  return next;
}

export function resetDropsConfig(guildId: string) {
  db.prepare("delete from drops_config where guild_id = ?").run(guildId);
}
