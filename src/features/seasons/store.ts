import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import { writeQueue } from "../../db/write-queue.js";
import { markLeaderboardDirty } from "../leaderboard/rollup.js";

type SeasonRow = {
  seasonId: number;
  name: string | null;
  startedMs: number;
  endedMs: number | null;
};

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists seasons (
		guild_id  text not null,
		season_id integer not null,
		name      text,
		started_ms integer not null,
		ended_ms   integer,
		primary key (guild_id, season_id)
	);
	create table if not exists seasons_active (
		guild_id  text primary key,
		season_id integer not null
	);
	create table if not exists level_profiles_archive (
		guild_id  text not null,
		season_id integer not null,
		user_id   text not null,
		xp        integer not null,
		level     integer not null,
		last_award_ms integer,
		rank      integer not null,
		archived_ms integer not null,
		primary key (guild_id, season_id, user_id)
	);
`);

const getActiveStmt = db.prepare(`
	select season_id from seasons_active where guild_id = ?
`);
const setActiveStmt = db.prepare(`
	insert into seasons_active (guild_id, season_id)
	values (?, ?)
	on conflict(guild_id) do update set season_id = excluded.season_id
`);
const getMaxSeasonStmt = db.prepare(`
	select max(season_id) as maxId from seasons where guild_id = ?
`);
const insertSeasonStmt = db.prepare(`
	insert into seasons (guild_id, season_id, name, started_ms, ended_ms)
	values (?, ?, ?, ?, null)
`);
const endSeasonStmt = db.prepare(`
	update seasons set ended_ms = ? where guild_id = ? and season_id = ?
`);
const fetchProfilesStmt = db.prepare(`
	select user_id as userId, xp, level, last_award_ms as lastAwardMs
	from level_profiles
	where guild_id = ?
	order by xp desc, user_id asc
`);
const clearProfilesStmt = db.prepare(`
	delete from level_profiles where guild_id = ?
`);
const insertArchiveStmt = db.prepare(`
	insert into level_profiles_archive (
		guild_id, season_id, user_id, xp, level, last_award_ms, rank, archived_ms
	) values (?, ?, ?, ?, ?, ?, ?, ?)
`);
const listSeasonsStmt = db.prepare(`
	select season_id as seasonId, name, started_ms as startedMs, ended_ms as endedMs
	from seasons
	where guild_id = ?
	order by season_id desc
`);
const topArchiveStmt = db.prepare(`
	select user_id as userId, xp, level, rank
	from level_profiles_archive
	where guild_id = ? and season_id = ?
	order by rank asc
	limit ?
`);
const seasonExistsStmt = db.prepare(`
	select 1 from seasons where guild_id = ? and season_id = ?
`);

export function getActiveSeasonId(guildId: string): number {
  const r = getActiveStmt.get(guildId) as any;
  return r ? Number(r.season_id) : 0;
}

export function listSeasons(guildId: string): SeasonRow[] {
  return listSeasonsStmt.all(guildId) as SeasonRow[];
}

export function getArchiveTop(
  guildId: string,
  seasonId: number,
  limit = 10
): Array<{ userId: string; xp: number; level: number; rank: number }> {
  return topArchiveStmt.all(guildId, seasonId, limit) as any;
}

/** Archives current profiles into a new season and clears active. */
export async function startNewSeason(
  guildId: string,
  name?: string | null
): Promise<{ seasonId: number; archived: number }> {
  const now = Date.now();
  const prev = getActiveSeasonId(guildId);
  const maxRow = getMaxSeasonStmt.get(guildId) as any;
  const nextId = Math.max(0, Number(maxRow?.maxId ?? 0)) + 1;

  // load ordered profiles to compute rank
  const rows = fetchProfilesStmt.all(guildId) as Array<{
    userId: string;
    xp: number;
    level: number;
    lastAwardMs: number | null;
  }>;

  // end previous season row if it exists
  if (prev > 0) {
    await writeQueue.push(() => endSeasonStmt.run(now, guildId, prev));
  }

  // create new season row
  await writeQueue.push(() =>
    insertSeasonStmt.run(guildId, nextId, name ?? null, now)
  );

  // archive old profiles with ranks
  let rank = 1;
  const txArchive = db.transaction(
    (
      gid: string,
      sid: number,
      items: Array<{
        userId: string;
        xp: number;
        level: number;
        lastAwardMs: number | null;
      }>
    ) => {
      for (const it of items) {
        insertArchiveStmt.run(
          gid,
          sid,
          it.userId,
          it.xp,
          it.level,
          it.lastAwardMs ?? null,
          rank,
          now
        );
        rank += 1;
      }
    }
  );
  if (rows.length > 0) {
    await writeQueue.push(() => txArchive(guildId, nextId, rows));
    // clear active profiles
    await writeQueue.push(() => clearProfilesStmt.run(guildId));
  }

  // activate new season
  await writeQueue.push(() => setActiveStmt.run(guildId, nextId));
  markLeaderboardDirty(guildId);

  return { seasonId: nextId, archived: rows.length };
}

export function setActiveSeasonId(guildId: string, seasonId: number): boolean {
  const ok = seasonExistsStmt.get(guildId, seasonId);
  if (!ok) return false;
  setActiveStmt.run(guildId, seasonId);
  markLeaderboardDirty(guildId);
  return true;
}
