import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import { type VoiceXpPolicy, defaultVoicePolicy } from "./policy.js";

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists voice_settings (
			guild_id text primary key,
			min_session_ms integer not null,
			xp_per_min integer not null,
			require_others integer not null,
			ignore_afk integer not null,
			require_unmuted integer not null
		);
	`);
  return db;
}

const db = openDb();

const getStmt = db.prepare(`
	select * from voice_settings where guild_id = ?
`);

const upsertStmt = db.prepare(`
	insert into voice_settings (
		guild_id, min_session_ms, xp_per_min,
		require_others, ignore_afk, require_unmuted
	) values (
		@guildId, @minSessionMs, @xpPerMinute,
		@requireOthers, @ignoreAfk, @requireUnmuted
	)
	on conflict(guild_id) do update set
		min_session_ms = excluded.min_session_ms,
		xp_per_min = excluded.xp_per_min,
		require_others = excluded.require_others,
		ignore_afk = excluded.ignore_afk,
		require_unmuted = excluded.require_unmuted
`);

function fromRow(r: any): VoiceXpPolicy {
  return {
    minSessionMs: Number(r.min_session_ms),
    xpPerMinute: Number(r.xp_per_min),
    requireOthers: Number(r.require_others) === 1,
    ignoreAfk: Number(r.ignore_afk) === 1,
    requireUnmuted: Number(r.require_unmuted) === 1,
  };
}

function toRow(gId: string, p: VoiceXpPolicy) {
  return {
    guildId: gId,
    minSessionMs: Math.max(0, Math.floor(p.minSessionMs)),
    xpPerMinute: Math.max(0, Math.floor(p.xpPerMinute)),
    requireOthers: p.requireOthers ? 1 : 0,
    ignoreAfk: p.ignoreAfk ? 1 : 0,
    requireUnmuted: p.requireUnmuted ? 1 : 0,
  };
}

export function getVoiceConfig(guildId: string): VoiceXpPolicy {
  const row = getStmt.get(guildId);
  return row ? fromRow(row) : { ...defaultVoicePolicy };
}

export function setVoicePolicy(
  guildId: string,
  patch: Partial<VoiceXpPolicy>
): VoiceXpPolicy {
  const cur = getVoiceConfig(guildId);
  const next = { ...cur, ...patch };
  upsertStmt.run(toRow(guildId, next));
  return next;
}
