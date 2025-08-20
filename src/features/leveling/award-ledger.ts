import Database from "better-sqlite3";
import { resolvedDbPath } from "./sqlite-store.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists award_ledger (
		guild_id   text not null,
		source     text not null, -- 'msg' | 'voice'
		key        text not null, -- msgId or userId:minuteBucket
		user_id    text not null,
		awarded    integer not null,
		created_ms integer not null,
		primary key (guild_id, source, key)
	);
	create index if not exists idx_award_user on award_ledger (guild_id, user_id);
`);

const insIgnore = db.prepare(`
	insert or ignore into award_ledger
		(guild_id, source, key, user_id, awarded, created_ms)
	values (?, ?, ?, ?, ?, ?)
`);
const updAward = db.prepare(`
	update award_ledger set awarded = ?
	where guild_id = ? and source = ? and key = ?
`);
const pruneStmt = db.prepare(`
	delete from award_ledger where created_ms < ?
`);

export function pruneLedger(olderThanMs: number): void {
  try {
    pruneStmt.run(olderThanMs);
  } catch {}
}

export function claimMessageOnce(
  guildId: string,
  messageId: string,
  userId: string,
  nowMs: number = Date.now()
): boolean {
  try {
    const r = insIgnore.run(guildId, "msg", messageId, userId, 0, nowMs);
    return Number(r.changes || 0) > 0;
  } catch {
    return false;
  }
}

export function finalizeMessageAward(
  guildId: string,
  messageId: string,
  awardedXp: number
): void {
  try {
    updAward.run(awardedXp, guildId, "msg", messageId);
  } catch {}
}

/** minute buckets = Math.floor(ms / 60000) */
export function claimVoiceMinutes(
  guildId: string,
  userId: string,
  minuteBuckets: number[],
  awardPerMinute: number,
  nowMs: number = Date.now()
): number {
  if (minuteBuckets.length === 0) return 0;
  const t = db.transaction(() => {
    let inserted = 0;
    for (const b of minuteBuckets) {
      const key = `${userId}:${b}`;
      const r = insIgnore.run(
        guildId,
        "voice",
        key,
        userId,
        awardPerMinute,
        nowMs
      );
      if (Number(r.changes || 0) > 0) inserted += 1;
    }
    return inserted;
  });
  try {
    return t();
  } catch {
    return 0;
  }
}
