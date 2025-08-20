import Database from "better-sqlite3";
import crypto from "node:crypto";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import {
  type AntiSpamPolicy,
  defaultAntiSpamPolicy,
  evaluateContent,
} from "./policy.js";

export type RuntimePolicy = {
  perChannelCooldownMs: number;
  duplicateWindowMs: number;
};

export const defaultRuntimePolicy: RuntimePolicy = {
  perChannelCooldownMs: 20_000,
  duplicateWindowMs: 10 * 60_000,
};

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists message_fingerprint (
			guild_id text not null,
			channel_id text not null,
			user_id text not null,
			hash text not null,
			created_ms integer not null
		);
		create index if not exists idx_fp_user_time
			on message_fingerprint (guild_id, user_id, created_ms);
		create index if not exists idx_fp_user_hash_time
			on message_fingerprint (guild_id, user_id, hash, created_ms);
		create index if not exists idx_fp_user_ch_time
			on message_fingerprint (guild_id, channel_id, user_id, created_ms);
	`);
  return db;
}

const db = openDb();

const insStmt = db.prepare(`
	insert into message_fingerprint
		(guild_id, channel_id, user_id, hash, created_ms)
	values (?, ?, ?, ?, ?)
`);
const lastStmt = db.prepare(`
	select created_ms from message_fingerprint
	where guild_id = ? and channel_id = ? and user_id = ?
	order by created_ms desc limit 1
`);
const dupStmt = db.prepare(`
	select 1 from message_fingerprint
	where guild_id = ? and user_id = ? and hash = ? and created_ms >= ?
	limit 1
`);
const pruneStmt = db.prepare(`
	delete from message_fingerprint where created_ms < ?
`);

function norm(s: string): string {
  return s.normalize("NFKC").trim().toLowerCase();
}

function hash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function maybePrune(nowMs: number, windowMs: number) {
  // cheap periodic prune
  if (nowMs % 17_000 < 50) {
    pruneStmt.run(nowMs - 2 * windowMs);
  }
}

export async function shouldCountMessage(
  guildId: string,
  channelId: string,
  userId: string,
  content: string,
  nowMs: number = Date.now(),
  policy: {
    content?: AntiSpamPolicy;
    runtime?: RuntimePolicy;
  } = {}
): Promise<{ ok: boolean; reason: string | null }> {
  const contentPolicy = policy.content ?? defaultAntiSpamPolicy;
  const runtimePolicy = policy.runtime ?? defaultRuntimePolicy;

  // content checks
  const contentReason = evaluateContent(content, contentPolicy);
  if (contentReason) return { ok: false, reason: contentReason };

  const n = norm(content);
  const h = hash(n);

  // per-channel cooldown
  const last = lastStmt.get(guildId, channelId, userId) as any;
  if (
    last &&
    nowMs - Number(last.created_ms) < runtimePolicy.perChannelCooldownMs
  ) {
    return { ok: false, reason: "cooldown" };
  }

  // duplicate within window (any channel in guild by same user)
  const since = nowMs - runtimePolicy.duplicateWindowMs;
  const dup = dupStmt.get(guildId, userId, h, since);
  if (dup) return { ok: false, reason: "duplicate" };

  // accept and record
  insStmt.run(guildId, channelId, userId, h, nowMs);
  maybePrune(nowMs, runtimePolicy.duplicateWindowMs);
  return { ok: true, reason: null };
}
