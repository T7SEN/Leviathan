import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import { type AntiSpamPolicy, defaultAntiSpamPolicy } from "./policy.js";
import { type RuntimePolicy, defaultRuntimePolicy } from "./runtime.js";

export type AntiSpamGuildConfig = {
  guildId: string;
  content: AntiSpamPolicy;
  runtime: RuntimePolicy;
};

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists antispam_settings (
			guild_id text primary key,
			min_chars integer not null,
			min_words integer not null,
			allow_emoji_only integer not null,
			max_repeat_run integer not null,
			min_distinct_chars integer not null,
			per_channel_cooldown_ms integer not null,
			duplicate_window_ms integer not null
		);
	`);
  return db;
}

const db = openDb();

const getStmt = db.prepare(`
	select * from antispam_settings where guild_id = ?
`);

const upsertStmt = db.prepare(`
	insert into antispam_settings (
		guild_id,
		min_chars, min_words, allow_emoji_only,
		max_repeat_run, min_distinct_chars,
		per_channel_cooldown_ms, duplicate_window_ms
	) values (
		@guildId,
		@minChars, @minWords, @allowEmojiOnly,
		@maxRepeatRun, @minDistinctChars,
		@perChannelCooldownMs, @duplicateWindowMs
	)
	on conflict(guild_id) do update set
		min_chars = excluded.min_chars,
		min_words = excluded.min_words,
		allow_emoji_only = excluded.allow_emoji_only,
		max_repeat_run = excluded.max_repeat_run,
		min_distinct_chars = excluded.min_distinct_chars,
		per_channel_cooldown_ms = excluded.per_channel_cooldown_ms,
		duplicate_window_ms = excluded.duplicate_window_ms
`);

function def(guildId: string): AntiSpamGuildConfig {
  return {
    guildId,
    content: { ...defaultAntiSpamPolicy },
    runtime: { ...defaultRuntimePolicy },
  };
}

function fromRow(r: any): AntiSpamGuildConfig {
  return {
    guildId: r.guild_id as string,
    content: {
      minChars: Number(r.min_chars),
      minWords: Number(r.min_words),
      allowEmojiOnly: Number(r.allow_emoji_only) === 1,
      maxRepeatCharRun: Number(r.max_repeat_run),
      minDistinctChars: Number(r.min_distinct_chars),
    },
    runtime: {
      perChannelCooldownMs: Number(r.per_channel_cooldown_ms),
      duplicateWindowMs: Number(r.duplicate_window_ms),
    },
  };
}

function toRow(cfg: AntiSpamGuildConfig) {
  return {
    guildId: cfg.guildId,
    minChars: cfg.content.minChars,
    minWords: cfg.content.minWords,
    allowEmojiOnly: cfg.content.allowEmojiOnly ? 1 : 0,
    maxRepeatRun: cfg.content.maxRepeatCharRun,
    minDistinctChars: cfg.content.minDistinctChars,
    perChannelCooldownMs: cfg.runtime.perChannelCooldownMs,
    duplicateWindowMs: cfg.runtime.duplicateWindowMs,
  };
}

export function getAntiSpamConfig(guildId: string): AntiSpamGuildConfig {
  const row = getStmt.get(guildId);
  return row ? fromRow(row) : def(guildId);
}

export function saveAntiSpamConfig(cfg: AntiSpamGuildConfig): void {
  upsertStmt.run(toRow(cfg));
}

export function setContentPolicy(
  guildId: string,
  patch: Partial<AntiSpamPolicy>
): AntiSpamGuildConfig {
  const cfg = getAntiSpamConfig(guildId);
  cfg.content = { ...cfg.content, ...patch };
  saveAntiSpamConfig(cfg);
  return cfg;
}

export function setRuntimePolicy(
  guildId: string,
  patch: Partial<RuntimePolicy>
): AntiSpamGuildConfig {
  const cfg = getAntiSpamConfig(guildId);
  cfg.runtime = { ...cfg.runtime, ...patch };
  saveAntiSpamConfig(cfg);
  return cfg;
}
