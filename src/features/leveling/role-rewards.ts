import Database from "better-sqlite3";
import type { Client, Guild, Role } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { resolvedDbPath } from "./sqlite-store.js";

type LevelRole = { level: number; roleId: string };

function openDb(): Database.Database {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.exec(`
		create table if not exists level_roles (
			guild_id text not null,
			level integer not null,
			role_id text not null,
			primary key (guild_id, level)
		);
	`);
  return db;
}

const db = openDb();
const upsertStmt = db.prepare(`
	insert into level_roles (guild_id, level, role_id)
	values (?, ?, ?)
	on conflict(guild_id, level) do update set role_id = excluded.role_id
`);
const clearGuildStmt = db.prepare(`
  delete from level_roles where guild_id = ?
`);
const deleteStmt = db.prepare(`
	delete from level_roles where guild_id = ? and level = ?
`);
const listStmt = db.prepare(`
	select level, role_id as roleId
	from level_roles
	where guild_id = ?
	order by level asc
`);

export function setLevelRole(guildId: string, level: number, roleId: string) {
  upsertStmt.run(guildId, level, roleId);
}

export function clearLevelRoles(guildId: string): void {
  clearGuildStmt.run(guildId);
}

export function removeLevelRole(guildId: string, level: number) {
  deleteStmt.run(guildId, level);
}

export function listLevelRoles(guildId: string): LevelRole[] {
  return listStmt.all(guildId) as LevelRole[];
}

async function fetchRole(g: Guild, roleId: string): Promise<Role | null> {
  const cached = g.roles.cache.get(roleId) || null;
  if (cached) return cached;
  try {
    return await g.roles.fetch(roleId);
  } catch {
    return null;
  }
}

function canManageRole(g: Guild, role: Role): boolean {
  const me = g.members.me;
  if (!me) return false;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  // must be strictly higher than target role
  return me.roles.highest.position > role.position;
}

export async function applyLevelRewards(
  client: Client,
  guildId: string,
  userId: string,
  newLevel: number
): Promise<{ granted: string[]; removed: string[] }> {
  const g = await client.guilds.fetch(guildId);
  const member = await g.members.fetch(userId);
  const mappings = listLevelRoles(guildId); // asc by level
  // pick highest configured role at or below newLevel
  const target = mappings.filter((m) => m.level <= newLevel).pop() ?? null;

  const granted: string[] = [];
  const removed: string[] = [];

  // If target exists, remove any other level-roles first
  if (target) {
    for (const m of mappings) {
      if (m.roleId === target.roleId) continue;
      if (!member.roles.cache.has(m.roleId)) continue;
      const role = await fetchRole(g, m.roleId);
      if (!role) continue;
      if (!canManageRole(g, role)) continue;
      try {
        await member.roles.remove(role);
        removed.push(role.id);
      } catch {
        // ignore failure
      }
    }
    // then grant target if missing
    if (!member.roles.cache.has(target.roleId)) {
      const role = await fetchRole(g, target.roleId);
      if (role && canManageRole(g, role)) {
        try {
          await member.roles.add(role);
          granted.push(role.id);
        } catch {
          // ignore failure
        }
      }
    }
  }
  return { granted, removed };
}
