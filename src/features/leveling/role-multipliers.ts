import Database from "better-sqlite3";
import { resolvedDbPath } from "./sqlite-store.js";

const MIN = 0;
const MAX = 5;

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists role_multipliers (
			guild_id  text not null,
			role_id   text not null,
			multiplier real not null,
			primary key (guild_id, role_id)
		);
	`);
  return db;
}

const db = openDb();

const upsertStmt = db.prepare(`
	insert into role_multipliers (guild_id, role_id, multiplier)
	values (?, ?, ?)
	on conflict(guild_id, role_id) do update set
		multiplier = excluded.multiplier
`);
const deleteStmt = db.prepare(`
	delete from role_multipliers where guild_id = ? and role_id = ?
`);
const listStmt = db.prepare(`
	select role_id as roleId, multiplier
	from role_multipliers
	where guild_id = ?
`);
const clearStmt = db.prepare(`
	delete from role_multipliers where guild_id = ?
`);

export function setRoleMultiplier(
  guildId: string,
  roleId: string,
  multiplier: number
) {
  const m = Math.min(MAX, Math.max(MIN, Number(multiplier)));
  upsertStmt.run(guildId, roleId, m);
}

export function removeRoleMultiplier(guildId: string, roleId: string) {
  deleteStmt.run(guildId, roleId);
}

export function clearRoleMultipliers(guildId: string) {
  clearStmt.run(guildId);
}

export function listRoleMultipliers(
  guildId: string
): Array<{ roleId: string; multiplier: number }> {
  return listStmt.all(guildId) as any;
}

/**
 * Highest multiplier among the provided roles.
 * Returns 1 when none configured.
 */
export function getMultiplierForRoles(
  guildId: string,
  roleIds: string[]
): number {
  const rows = listRoleMultipliers(guildId);
  let best = 1;
  const set = new Set(roleIds);
  for (const r of rows) {
    if (set.has(r.roleId)) {
      if (r.multiplier > best) best = Number(r.multiplier);
    }
  }
  return best;
}
