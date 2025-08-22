import Database from "better-sqlite3";
import type { Client } from "discord.js";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import {
  CH,
  weekKeyUtc,
  tryClaimAndAward,
  getWinner,
  monthKeyUtc,
} from "./store.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });

export async function checkActiveTrio(
  client: Client,
  guildId: string,
  userId: string,
  nowMs: number
): Promise<boolean> {
  const wk = weekKeyUtc(nowMs);
  if (getWinner(guildId, CH.activeTrio, wk)) return false;

  const start = Number(wk);
  const end = start + 7 * 86_400_000 - 1;

  const rows = db
    .prepare(
      `select cast(floor(created_ms/86400000) as integer) as dayKey,
		        count(*) as c
		   from xp_journal
		  where guild_id = ? and user_id = ? and source = 'msg'
		    and created_ms between ? and ?
		  group by dayKey
		  having c >= 3`
    )
    .all(guildId, userId, start, end) as any[];

  if (rows.length >= 3) {
    return tryClaimAndAward(client, guildId, CH.activeTrio, wk, userId, nowMs);
  }
  return false;
}

export async function checkMarathonMixMonthly(
  client: Client,
  guildId: string,
  userId: string,
  nowMs: number
): Promise<boolean> {
  const mk = monthKeyUtc(nowMs);
  if (getWinner(guildId, CH.marathonMix, mk)) return false;

  // month window [start, end)
  const start = Number(mk);
  const end =
    Date.UTC(
      new Date(start).getUTCFullYear(),
      new Date(start).getUTCMonth() + 1,
      1
    ) - 1;

  // harder thresholds
  const MSGS_REQ = 300;
  const VMIN_REQ = 600;

  const r = db
    .prepare(
      `select
		    sum(case when source='msg'   then 1           else 0 end) as msgs,
		    sum(case when source='voice' then coalesce(qty,1) else 0 end) as vmin
		   from xp_journal
		  where guild_id = ? and user_id = ?
		    and created_ms between ? and ?`
    )
    .get(guildId, userId, start, end) as any;

  const msgs = Number(r?.msgs ?? 0);
  const vmin = Number(r?.vmin ?? 0);
  if (msgs >= MSGS_REQ && vmin >= VMIN_REQ) {
    return tryClaimAndAward(client, guildId, CH.marathonMix, mk, userId, nowMs);
  }
  return false;
}
