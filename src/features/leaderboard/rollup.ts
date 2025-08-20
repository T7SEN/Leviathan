import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import { writeQueue } from "../../db/write-queue.js";
import { metrics } from "../../obs/metrics.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists leaderboard_settings (
		guild_id text primary key,
		page_size integer not null
	);
	create table if not exists leaderboard_pages (
		guild_id  text not null,
		page_no   integer not null,
		page_size integer not null,
		content   text not null,    -- JSON array of {rank,userId,xp,level}
		updated_ms integer not null,
		primary key (guild_id, page_no)
	);
	create index if not exists idx_lb_pages_guild
		on leaderboard_pages (guild_id, page_no);
`);

const upsertSetting = db.prepare(`
	insert into leaderboard_settings (guild_id, page_size)
	values (?, ?)
	on conflict(guild_id) do update set page_size = excluded.page_size
`);
const getSetting = db.prepare(`
	select page_size from leaderboard_settings where guild_id = ?
`);
const delPages = db.prepare(`
	delete from leaderboard_pages where guild_id = ?
`);
const putPage = db.prepare(`
	insert or replace into leaderboard_pages
		(guild_id, page_no, page_size, content, updated_ms)
	values (?, ?, ?, ?, ?)
`);
const getPageStmt = db.prepare(`
	select content, updated_ms, page_size
	from leaderboard_pages where guild_id = ? and page_no = ?
`);

export function getPageSize(guildId: string): number {
  const r = getSetting.get(guildId) as any;
  return r ? Math.max(1, Number(r.page_size)) : 10;
}
export function setPageSize(guildId: string, n: number): number {
  const v = Math.max(1, Math.min(50, Math.floor(n)));
  upsertSetting.run(guildId, v);
  return v;
}

const dirty = new Map<string, number>(); // guildId → lastMarkedMs

export function markLeaderboardDirty(guildId: string): void {
  dirty.set(guildId, Date.now());
}

export function getRollupPage(
  guildId: string,
  pageNo: number
): {
  rows: Array<{ rank: number; userId: string; xp: number; level: number }>;
  updatedMs: number;
  pageSize: number;
} | null {
  const r = getPageStmt.get(guildId, pageNo) as any;
  if (!r) return null;
  return {
    rows: JSON.parse(String(r.content)),
    updatedMs: Number(r.updated_ms),
    pageSize: Number(r.page_size),
  };
}

export async function rebuildGuildRollup(
  guildId: string,
  maxRows: number = 5000
): Promise<{ pages: number; pageSize: number }> {
  const pageSize = getPageSize(guildId);
  const rows = db
    .prepare(
      `select user_id as userId, xp, level
		 from level_profiles
		 where guild_id = ?
		 order by xp desc, user_id asc
		 limit ?`
    )
    .all(guildId, maxRows) as Array<{
    userId: string;
    xp: number;
    level: number;
  }>;

  const now = Date.now();
  await writeQueue.push(() => delPages.run(guildId));

  let rank = 1;
  let page = 1;
  let buf: any[] = [];
  let pages = 0;

  for (const r of rows) {
    buf.push({
      rank,
      userId: r.userId,
      xp: Number(r.xp),
      level: Number(r.level),
    });
    if (buf.length === pageSize) {
      const payload = JSON.stringify(buf);
      // eslint-disable-next-line no-loop-func
      await writeQueue.push(() =>
        putPage.run(guildId, page, pageSize, payload, now)
      );
      pages += 1;
      page += 1;
      buf = [];
    }
    rank += 1;
  }
  if (buf.length > 0) {
    const payload = JSON.stringify(buf);
    await writeQueue.push(() =>
      putPage.run(guildId, page, pageSize, payload, now)
    );
    pages += 1;
  }

  metrics.inc("lb.rollup.rebuilt");
  metrics.observe("lb.rollup.pages", pages);
  return { pages, pageSize };
}

/** Background worker. Debounces per guild. */
export function startLeaderboardWorker() {
  const DEBOUNCE_MS = 15_000;
  const TICK_MS = 5_000;
  setInterval(async () => {
    const now = Date.now();
    for (const [g, t] of Array.from(dirty.entries())) {
      if (now - t < DEBOUNCE_MS) continue;
      dirty.delete(g);
      try {
        await rebuildGuildRollup(g);
      } catch {
        metrics.inc("lb.rollup.error");
      }
    }
  }, TICK_MS);
}
