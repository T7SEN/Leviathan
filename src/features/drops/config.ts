import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";

export type DropsConfig = {
  allowChannels: string[] | null;
  minMessagesBeforeSpawn: number;
  channelCooldownMs: number;
  globalPerHour: number;
  globalPerDay: number;
  decayEveryMs: number;
  decayPct: number;
  applyRoleMultiplier: boolean;
  perUserCooldownMs: number; // NEW
  pityEnabled: boolean; // NEW
  pityMinMessages: number; // NEW
  pityWindowMs: number; // NEW (24h)
  pityTier: "common" | "uncommon" | "rare" | "epic" | "legendary"; // NEW
};

const defaults: DropsConfig = {
  allowChannels: null,
  minMessagesBeforeSpawn: 20,
  channelCooldownMs: 15 * 60_000,
  globalPerHour: 3,
  globalPerDay: 10,
  decayEveryMs: 3_000,
  decayPct: 0.05,
  applyRoleMultiplier: true,
  perUserCooldownMs: 5 * 60_000,
  pityEnabled: true,
  pityMinMessages: 40,
  pityWindowMs: 24 * 60 * 60_000,
  pityTier: "common",
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
