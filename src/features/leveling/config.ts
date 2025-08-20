import Database from "better-sqlite3";
import type { Snowflake } from "discord.js";
import { resolvedDbPath } from "./sqlite-store.js";

export type GuildConfig = {
  guildId: string;
  minIntervalMs: number;
  xpMin: number;
  xpMax: number;
  channelBlacklist: string[]; // channel IDs
  roleBlacklist: string[]; // role IDs
};

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists level_settings (
			guild_id text primary key,
			min_interval_ms integer not null,
			xp_min integer not null,
			xp_max integer not null,
			channel_blacklist text not null,
			role_blacklist text not null
		);
	`);
  return db;
}

const db = openDb();

const getStmt = db.prepare(`
	select guild_id, min_interval_ms, xp_min, xp_max,
	       channel_blacklist, role_blacklist
	from level_settings
	where guild_id = ?
`);

const upsertStmt = db.prepare(`
	insert into level_settings (
		guild_id, min_interval_ms, xp_min, xp_max,
		channel_blacklist, role_blacklist
	) values (
		@guildId, @minIntervalMs, @xpMin, @xpMax,
		@channelBlacklist, @roleBlacklist
	)
	on conflict(guild_id) do update set
		min_interval_ms = excluded.min_interval_ms,
		xp_min = excluded.xp_min,
		xp_max = excluded.xp_max,
		channel_blacklist = excluded.channel_blacklist,
		role_blacklist = excluded.role_blacklist
`);

function defConfig(guildId: string): GuildConfig {
  return {
    guildId,
    minIntervalMs: 60_000,
    xpMin: 15,
    xpMax: 25,
    channelBlacklist: [],
    roleBlacklist: [],
  };
}

function fromRow(row: any): GuildConfig {
  return {
    guildId: row.guild_id as string,
    minIntervalMs: Number(row.min_interval_ms),
    xpMin: Number(row.xp_min),
    xpMax: Number(row.xp_max),
    channelBlacklist: JSON.parse(row.channel_blacklist || "[]"),
    roleBlacklist: JSON.parse(row.role_blacklist || "[]"),
  };
}

function toRow(cfg: GuildConfig) {
  return {
    guildId: cfg.guildId,
    minIntervalMs: cfg.minIntervalMs,
    xpMin: cfg.xpMin,
    xpMax: cfg.xpMax,
    channelBlacklist: JSON.stringify(cfg.channelBlacklist),
    roleBlacklist: JSON.stringify(cfg.roleBlacklist),
  };
}

export function getConfig(guildId: string): GuildConfig {
  const row = getStmt.get(guildId);
  return row ? fromRow(row) : defConfig(guildId);
}

export function saveConfig(cfg: GuildConfig): void {
  upsertStmt.run(toRow(cfg));
}

export function setCooldown(guildId: string, ms: number): GuildConfig {
  const cfg = getConfig(guildId);
  cfg.minIntervalMs = Math.max(0, Math.floor(ms));
  saveConfig(cfg);
  return cfg;
}

export function setXpRange(
  guildId: string,
  min: number,
  max: number
): GuildConfig {
  const lo = Math.max(0, Math.floor(Math.min(min, max)));
  const hi = Math.max(lo, Math.floor(Math.max(min, max)));
  const cfg = getConfig(guildId);
  cfg.xpMin = lo;
  cfg.xpMax = hi;
  saveConfig(cfg);
  return cfg;
}

function addId(arr: string[], id: string): string[] {
  return arr.includes(id) ? arr : [...arr, id];
}

function removeId(arr: string[], id: string): string[] {
  return arr.filter((x) => x !== id);
}

export function addBlacklistedChannel(
  guildId: string,
  channelId: Snowflake
): GuildConfig {
  const cfg = getConfig(guildId);
  cfg.channelBlacklist = addId(cfg.channelBlacklist, channelId);
  saveConfig(cfg);
  return cfg;
}

export function removeBlacklistedChannel(
  guildId: string,
  channelId: Snowflake
): GuildConfig {
  const cfg = getConfig(guildId);
  cfg.channelBlacklist = removeId(cfg.channelBlacklist, channelId);
  saveConfig(cfg);
  return cfg;
}

export function addBlacklistedRole(
  guildId: string,
  roleId: Snowflake
): GuildConfig {
  const cfg = getConfig(guildId);
  cfg.roleBlacklist = addId(cfg.roleBlacklist, roleId);
  saveConfig(cfg);
  return cfg;
}

export function removeBlacklistedRole(
  guildId: string,
  roleId: Snowflake
): GuildConfig {
  const cfg = getConfig(guildId);
  cfg.roleBlacklist = removeId(cfg.roleBlacklist, roleId);
  saveConfig(cfg);
  return cfg;
}

export function setConfig(
  guildId: string,
  patch: Omit<GuildConfig, "guildId">
): GuildConfig {
  const cur = getConfig(guildId);
  const next: GuildConfig = {
    ...cur,
    ...patch,
    guildId,
  };
  saveConfig(next);
  return next;
}
