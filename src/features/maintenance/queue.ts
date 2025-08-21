import { logXpEvent } from "../leveling/xp-journal.js";
import Database from "better-sqlite3";
import type { Client } from "discord.js";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import {
  claimMessageOnce,
  finalizeMessageAward,
} from "../leveling/award-ledger.js";
import { engine } from "../leveling/service.js";
import { applyLevelRewards, listLevelRoles } from "../leveling/role-rewards.js";
import { markLeaderboardDirty } from "../leaderboard/rollup.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists award_queue (
		guild_id   text not null,
		source     text not null,            -- 'msg' | 'voice'
		key        text not null,            -- msgId or userId:bucket
		user_id    text not null,
		payload    text not null,            -- JSON
		created_ms integer not null,
		primary key (guild_id, source, key)
	);
	create index if not exists idx_queue_created
		on award_queue (guild_id, created_ms);
`);

const put = db.prepare(`
	insert or ignore into award_queue
	 (guild_id, source, key, user_id, payload, created_ms)
	values (?, ?, ?, ?, ?, ?)
`);
const take = db.prepare(`
	select guild_id, source, key, user_id, payload, created_ms
	from award_queue
	where guild_id = ?
	order by created_ms asc
	limit ?
`);
const del = db.prepare(`
	delete from award_queue
	where guild_id = ? and source = ? and key = ?
`);
const cnt = db.prepare(`
	select source, count(*) as n
	from award_queue
	where guild_id = ?
	group by source
`);

export function enqueueMessageAward(
  guildId: string,
  userId: string,
  messageId: string,
  policy: {
    minIntervalMs: number;
    xpPerMessageMin: number;
    xpPerMessageMax: number;
  },
  createdMs: number
): void {
  const payload = JSON.stringify({
    type: "msg",
    minIntervalMs: policy.minIntervalMs,
    min: policy.xpPerMessageMin,
    max: policy.xpPerMessageMax,
    randKey: messageId,
  });
  put.run(guildId, "msg", messageId, userId, payload, createdMs);
}

export function enqueueVoiceBucket(
  guildId: string,
  userId: string,
  bucket: number, // minute bucket
  perMinute: number,
  createdMs: number
): void {
  const key = `${userId}:${bucket}`;
  const payload = JSON.stringify({
    type: "voice",
    bucket,
    perMinute,
  });
  put.run(guildId, "voice", key, userId, payload, createdMs);
}

export function queueStatus(guildId: string): Record<"msg" | "voice", number> {
  const out: any = { msg: 0, voice: 0 };
  for (const r of cnt.all(guildId) as any[]) {
    out[String(r.source)] = Number(r.n);
  }
  return out;
}

/** Flush queued items in time order. Returns processed counts. */
export async function flushQueue(
  client: Client,
  guildId: string,
  limit = 2000
): Promise<{ msg: number; voice: number }> {
  const rows = take.all(guildId, limit) as Array<{
    guild_id: string;
    source: "msg" | "voice";
    key: string;
    user_id: string;
    payload: string;
    created_ms: number;
  }>;
  let msg = 0,
    voice = 0;

  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as any;
      if (r.source === "msg" && p.type === "msg") {
        // ensure idempotency same as live path
        if (!claimMessageOnce(guildId, r.key, r.user_id, r.created_ms)) {
          del.run(guildId, r.source, r.key);
          continue;
        }
        const res = await engine.awardMessageXp(
          guildId,
          r.user_id,
          r.created_ms,
          {
            minIntervalMs: Number(p.minIntervalMs),
            xpPerMessageMin: Number(p.min),
            xpPerMessageMax: Number(p.max),
          },
          String(p.randKey)
        );
        finalizeMessageAward(guildId, r.key, res.awarded);
        markLeaderboardDirty(guildId);
        logXpEvent({
          guildId,
          userId: r.user_id,
          createdMs: r.created_ms,
          source: "msg",
          amount: res.awarded,
          leveledUp: res.leveledUp,
          levelAfter: res.profile.level,
          qty: 1,
        });
        if (res.leveledUp) {
          try {
            await applyLevelRewards(
              client,
              guildId,
              r.user_id,
              res.profile.level
            );
          } catch {}
        }
        msg += 1;
      } else if (r.source === "voice" && p.type === "voice") {
        const when = Number(p.bucket) * 60_000;
        const amt = Number(p.perMinute);
        const res = await engine.awardRawXp(guildId, r.user_id, amt, when);
        if (res.awarded > 0) {
          markLeaderboardDirty(guildId);
          logXpEvent({
            guildId,
            userId: r.user_id,
            createdMs: when,
            source: "voice",
            amount: res.awarded,
            leveledUp: res.leveledUp,
            levelAfter: res.profile.level,
            qty: 1,
          });
        }
        if (res.leveledUp) {
          try {
            await applyLevelRewards(
              client,
              guildId,
              r.user_id,
              res.profile.level
            );
          } catch {}
        }
        voice += 1;
      }
    } finally {
      del.run(guildId, r.source, r.key);
    }
  }
  return { msg, voice };
}
