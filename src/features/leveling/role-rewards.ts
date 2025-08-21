import Database from "better-sqlite3";
import type { Client, Guild, Role } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { resolvedDbPath } from "./sqlite-store.js";
import { metrics } from "../../obs/metrics.js";
import { safeAddRole, safeRemoveRoles } from "../../lib/discord-retry.js";

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

export function getLevelRoleIds(guildId: string): string[] {
  const rows = listLevelRoles(guildId);
  return rows.map((r) => r.roleId);
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

/**
 * Remove all configured level roles from the given users.
 * Returns how many members changed and how many role removals were issued.
 */
export async function stripLevelRoles(
  client: Client,
  guildId: string,
  userIds: string[]
): Promise<{ members: number; removals: number }> {
  const g = await client.guilds.fetch(guildId);
  const levelRoleIds = new Set(getLevelRoleIds(guildId));
  if (levelRoleIds.size === 0) return { members: 0, removals: 0 };

  let membersChanged = 0;
  let totalRemovals = 0;

  for (const uid of userIds) {
    let m;
    try {
      m = await g.members.fetch(uid);
    } catch {
      continue;
    }
    const toRemove = m.roles.cache
      .filter((r) => levelRoleIds.has(r.id))
      .map((r) => r.id);
    if (toRemove.length === 0) continue;
    try {
      await m.roles.remove(toRemove, "Level reset");
      membersChanged += 1;
      totalRemovals += toRemove.length;
    } catch {}
  }

  try {
    metrics.inc("roles.strip.members", membersChanged);
    metrics.inc("roles.strip.removals", totalRemovals);
  } catch {}

  return { members: membersChanged, removals: totalRemovals };
}

/**
 * Remove all level roles from everyone currently holding any of them.
 */
export async function stripLevelRolesFromGuild(
  client: Client,
  guildId: string
): Promise<{ members: number; removals: number }> {
  const g = await client.guilds.fetch(guildId);
  const levelRoleIds = getLevelRoleIds(guildId);
  if (levelRoleIds.length === 0) return { members: 0, removals: 0 };

  // Collect unique user IDs from all level roles
  const userIds = new Set<string>();
  for (const rid of levelRoleIds) {
    try {
      const role = await g.roles.fetch(rid);
      role?.members.forEach((m) => userIds.add(m.id));
    } catch {}
  }
  return stripLevelRoles(client, guildId, Array.from(userIds));
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
        await safeRemoveRoles(member, [role], "Level change");
        removed.push(role.id);
      } catch {}
    }
    // then grant target if missing
    if (!member.roles.cache.has(target.roleId)) {
      const role = await fetchRole(g, target.roleId);
      if (role && canManageRole(g, role)) {
        try {
          await safeAddRole(member, role, "Level reward");
          granted.push(role.id);
        } catch {}
      }
    }
  }
  return { granted, removed };
}
