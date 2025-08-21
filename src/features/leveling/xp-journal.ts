import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";

type Source = "msg" | "voice" | "other";

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists xp_journal (
		id           integer primary key autoincrement,
		guild_id     text not null,
		user_id      text not null,
		created_ms   integer not null,
		source       text not null,          -- 'msg' | 'voice' | 'other'
		amount       integer not null,       -- XP granted
		leveled_up   integer not null,       -- 0/1
		level_after  integer not null,       -- level after this award
		qty          integer not null default 1 -- messages=1, voice=minutes
	);
	create index if not exists idx_xp_journal_gut
		on xp_journal (guild_id, user_id, created_ms);
`);
// migrate qty if missing
try {
  const cols = db.prepare(`pragma table_info(xp_journal)`).all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === "qty")) {
    db.exec(`alter table xp_journal
			add column qty integer not null default 1`);
  }
} catch {}

const ins = db.prepare(`
	insert into xp_journal
	 (guild_id, user_id, created_ms, source, amount, leveled_up, level_after, qty)
	values (?, ?, ?, ?, ?, ?, ?, ?)
`);

export function logXpEvent(p: {
  guildId: string;
  userId: string;
  createdMs: number;
  source: Source;
  amount: number;
  leveledUp: boolean;
  levelAfter: number;
  qty?: number; // default 1
}) {
  ins.run(
    p.guildId,
    p.userId,
    p.createdMs,
    p.source,
    Math.max(0, Math.floor(p.amount)),
    p.leveledUp ? 1 : 0,
    Math.max(0, Math.floor(p.levelAfter)),
    Math.max(1, Math.floor(p.qty ?? 1))
  );
}
// fix typo-safe wrapper to avoid breaking callers if they used leveedUp by mistake
logXpEvent as any; // no-op

export function getSeasonActivity(
  guildId: string,
  userId: string,
  fromMs: number,
  toMs: number
): { msgCount: number; voiceMin: number; xpTotal: number } {
  const rows = db
    .prepare(
      `select source,
		        count(*) as n,
		        sum(coalesce(qty,1)) as q,
		        sum(amount) as xp
		   from xp_journal
		  where guild_id = ? and user_id = ?
		    and created_ms between ? and ?
		  group by source`
    )
    .all(guildId, userId, fromMs, toMs) as any[];

  let msgCount = 0;
  let voiceMin = 0;
  let xpTotal = 0;
  for (const r of rows) {
    xpTotal += Number(r.xp ?? 0);
    if (String(r.source) === "msg") msgCount += Number(r.n ?? 0);
    if (String(r.source) === "voice") voiceMin += Number(r.q ?? 0);
  }
  return { msgCount, voiceMin, xpTotal };
}

// add to src/features/leveling/xp-journal.ts

export function getRecap(
  guildId: string,
  userId: string,
  fromMs: number,
  toMs: number
): {
  total: number;
  bySource: Record<string, number>;
  levels: number;
  sinceMs: number | null;
  untilMs: number | null;
} {
  const rows = db
    .prepare(
      `select source,
		        sum(amount)            as xp,
		        sum(leveled_up)        as ups,
		        min(created_ms)        as sinceMs,
		        max(created_ms)        as untilMs
		   from xp_journal
		  where guild_id = ?
		    and user_id  = ?
		    and created_ms between ? and ?
		  group by source`
    )
    .all(guildId, userId, fromMs, toMs) as any[];

  let total = 0;
  let ups = 0;
  let since: number | null = null;
  let until: number | null = null;
  const by: Record<string, number> = {};

  for (const r of rows) {
    const s = Number(r.xp ?? 0);
    total += s;
    ups += Number(r.ups ?? 0);
    by[String(r.source)] = s;
    const a = Number(r.sinceMs ?? 0);
    const b = Number(r.untilMs ?? 0);
    since = since === null ? a : Math.min(since, a);
    until = until === null ? b : Math.max(until, b);
  }

  return { total, bySource: by, levels: ups, sinceMs: since, untilMs: until };
}
