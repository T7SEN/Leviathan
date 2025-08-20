import crypto from "node:crypto";
import Database from "better-sqlite3";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { getConfig, setConfig } from "../features/leveling/config.js";
import {
  getAntiSpamConfig,
  setContentPolicy,
  setRuntimePolicy,
} from "../features/antispam/config.js";
import { getVoiceConfig, setVoicePolicy } from "../features/voice/config.js";
import {
  listRoleMultipliers,
  clearRoleMultipliers,
  setRoleMultiplier,
} from "../features/leveling/role-multipliers.js";
import {
  listLevelRoles,
  clearLevelRoles,
  setLevelRole,
} from "../features/leveling/role-rewards.js";
import {
  getStreakConfig,
  setStreakConfig,
} from "../features/leveling/streaks.js";

export const CONFIG_VERSION = 1;

// meta table (tracks last applied version per guild)
const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists config_meta (
		guild_id text primary key,
		version integer not null,
		updated_ms integer not null
	);
`);
const upsertMeta = db.prepare(`
	insert into config_meta (guild_id, version, updated_ms)
	values (?, ?, ?)
	on conflict(guild_id) do update set
		version = excluded.version,
		updated_ms = excluded.updated_ms
`);
const getMeta = db.prepare(`
	select version, updated_ms from config_meta where guild_id = ?
`);

export type SnapshotV1 = {
  version: 1;
  guildId: string;
  createdMs: number;
  payload: {
    leveling: ReturnType<typeof getConfig>;
    antispam: ReturnType<typeof getAntiSpamConfig>;
    voice: ReturnType<typeof getVoiceConfig>;
    streak: ReturnType<typeof getStreakConfig>;
    roleMultipliers: Array<{ roleId: string; multiplier: number }>;
    levelRoles: Array<{ level: number; roleId: string }>;
  };
  checksum: string;
};

type AnySnapshot = SnapshotV1;

function stableStringify(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ":" + stableStringify(v[k])
  );
  return "{" + parts.join(",") + "}";
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function computeChecksum(
  version: number,
  guildId: string,
  payload: unknown
): string {
  const base = stableStringify({ version, guildId, payload });
  return sha256(base);
}

export function getGuildMeta(
  guildId: string
): { version: number; updatedMs: number } | null {
  const r = getMeta.get(guildId) as any;
  return r
    ? { version: Number(r.version), updatedMs: Number(r.updated_ms) }
    : null;
}

export function makeSnapshot(guildId: string): SnapshotV1 {
  const payload = {
    leveling: getConfig(guildId),
    antispam: getAntiSpamConfig(guildId),
    voice: getVoiceConfig(guildId),
    streak: getStreakConfig(guildId),
    roleMultipliers: listRoleMultipliers(guildId),
    levelRoles: listLevelRoles(guildId),
  };
  const version = CONFIG_VERSION;
  const createdMs = Date.now();
  const checksum = computeChecksum(version, guildId, payload);
  return { version, guildId, createdMs, payload, checksum };
}

export function validateSnapshot(
  raw: unknown
): { ok: true; snap: AnySnapshot } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object")
    return { ok: false, reason: "not-object" };
  const s = raw as any;
  if (typeof s.version !== "number") return { ok: false, reason: "no-version" };
  if (!s.guildId) return { ok: false, reason: "no-guildId" };
  if (!s.payload) return { ok: false, reason: "no-payload" };
  const expect = computeChecksum(s.version, s.guildId, s.payload);
  if (s.checksum !== expect) return { ok: false, reason: "bad-checksum" };
  // migrations supported here if versions differ
  switch (s.version) {
    case 1:
      return { ok: true, snap: s as SnapshotV1 };
    default:
      return { ok: false, reason: "unsupported-version" };
  }
}

export function applySnapshot(
  guildId: string,
  snap: AnySnapshot,
  opts: { clearMultipliers?: boolean; clearLevelRoles?: boolean } = {}
): void {
  // migrate to current if needed (currently v1 == current)
  const v1 = snap as SnapshotV1;
  // leveling
  setConfig(guildId, {
    minIntervalMs: v1.payload.leveling.minIntervalMs,
    xpMin: v1.payload.leveling.xpMin,
    xpMax: v1.payload.leveling.xpMax,
    channelBlacklist: [...v1.payload.leveling.channelBlacklist],
    roleBlacklist: [...v1.payload.leveling.roleBlacklist],
  });
  // antispam
  setContentPolicy(guildId, v1.payload.antispam.content);
  setRuntimePolicy(guildId, v1.payload.antispam.runtime);
  // voice
  setVoicePolicy(guildId, v1.payload.voice);
  // streak
  setStreakConfig(guildId, v1.payload.streak);
  // multipliers
  if (opts.clearMultipliers) clearRoleMultipliers(guildId);
  for (const r of v1.payload.roleMultipliers) {
    setRoleMultiplier(guildId, r.roleId, r.multiplier);
  }
  // level roles
  if (opts.clearLevelRoles) clearLevelRoles(guildId);
  for (const lr of v1.payload.levelRoles) {
    setLevelRole(guildId, lr.level, lr.roleId);
  }
  // meta
  upsertMeta.run(guildId, CONFIG_VERSION, Date.now());
}
