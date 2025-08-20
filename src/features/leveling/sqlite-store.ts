import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { LevelStore, LevelProfile } from "./engine.js";
import { writeQueue } from "../../db/write-queue.js";
import { metrics } from "../../obs/metrics.js";

export function resolvedDbPath(): string {
  const url = process.env.DATABASE_URL || "file:./db/leviathan.sqlite";
  return path.resolve(url.startsWith("file:") ? url.slice(5) : url);
}

function ensureDir(p: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

export class SQLiteLevelStore implements LevelStore {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private upsertStmt: Database.Statement;
  private topStmt: Database.Statement;

  constructor() {
    const file = resolvedDbPath();
    ensureDir(file);
    this.db = new Database(file, { fileMustExist: false });
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
			create table if not exists level_profiles (
				guild_id text not null,
				user_id text not null,
				xp integer not null,
				level integer not null,
				last_award_ms integer,
				primary key (guild_id, user_id)
			);
			create index if not exists idx_level_profiles_rank
			on level_profiles (guild_id, level desc, xp desc);
		`);
    this.getStmt = this.db.prepare(
      `select guild_id, user_id, xp, level, last_award_ms
			 from level_profiles
			 where guild_id = ? and user_id = ?`
    );
    this.upsertStmt = this.db.prepare(`
			insert into level_profiles (guild_id, user_id, xp, level, last_award_ms)
			values (@guildId, @userId, @xp, @level, @lastAwardMs)
			on conflict(guild_id, user_id) do update set
				xp = excluded.xp,
				level = excluded.level,
				last_award_ms = excluded.last_award_ms
		`);
    this.topStmt = this.db.prepare(`
			select guild_id, user_id, xp, level, last_award_ms
			from level_profiles
			where guild_id = ?
			order by level desc, xp desc
			limit ? offset ?
		`);
  }

  async get(guildId: string, userId: string): Promise<LevelProfile | null> {
    const row = this.getStmt.get(guildId, userId) as any;
    if (!row) return null;
    return {
      userId: row.user_id,
      guildId: row.guild_id,
      xp: Number(row.xp),
      level: Number(row.level),
      lastAwardMs:
        row.last_award_ms !== null ? Number(row.last_award_ms) : null,
    };
  }

  async set(p: LevelProfile): Promise<void> {
    await writeQueue.push(() => {
      this.upsertStmt.run({
        guildId: p.guildId,
        userId: p.userId,
        xp: p.xp,
        level: p.level,
        lastAwardMs: p.lastAwardMs,
      });
    });
    metrics.inc("db.level_profiles.upsert");
  }
  async listTop(
    guildId: string,
    limit: number,
    offset = 0
  ): Promise<LevelProfile[]> {
    const rows = this.topStmt.all(guildId, limit, offset) as any[];
    return rows.map((r) => ({
      userId: r.user_id,
      guildId: r.guild_id,
      xp: Number(r.xp),
      level: Number(r.level),
      lastAwardMs: r.last_award_ms !== null ? Number(r.last_award_ms) : null,
    }));
  }
}

const delGuildStmt = (() => {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  return db.prepare("delete from level_profiles where guild_id = ?");
})();

const delOneStmt = (() => {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  return db.prepare(
    "delete from level_profiles where guild_id = ? and user_id = ?"
  );
})();

export function resetGuildProfiles(guildId: string): number {
  try {
    const info = delGuildStmt.run(guildId);
    return Number(info.changes || 0);
  } catch {
    return 0;
  }
}

export function resetUserProfiles(guildId: string, userIds: string[]): number {
  let total = 0;
  const tx = (ids: string[]) => {
    for (const id of ids) {
      const info = delOneStmt.run(guildId, id);
      total += Number(info.changes || 0);
    }
  };
  // naive transaction wrapper; better-sqlite3 auto-batches per connection
  tx(userIds);
  return total;
}
