import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import type { Tier } from "./tiers.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });

db.exec(`
	create table if not exists drops (
		guild_id     text not null,
		drop_id      text not null,
		channel_id   text not null,
		message_id   text,
		seed         text not null,
		tier         text not null,
		base_xp      integer not null,
		created_ms   integer not null,
		expires_ms   integer not null,
		target_user_id text,
		state        text not null default 'open', -- open|claimed|expired
		claimed_user_id text,
		claimed_ms   integer,
		primary key (guild_id, drop_id)
	);
	create index if not exists idx_drops_state
		on drops (guild_id, state, expires_ms);
	
	create table if not exists drops_user_state (
		guild_id text not null,
		user_id  text not null,
		last_claim_ms integer not null default 0,
		last_pity_ms  integer not null default 0,
		pity_progress integer not null default 0,
		primary key (guild_id, user_id)
	);

  create table if not exists drops_claim_log (
    guild_id  text not null,
    user_id   text not null,
    drop_id   text not null,
    claimed_ms integer not null,
    primary key (guild_id, user_id, drop_id)
  );
  create index if not exists idx_drops_claim_log_gut
    on drops_claim_log (guild_id, user_id, claimed_ms);
`);

const ins = db.prepare(`
	insert into drops
	 (guild_id, drop_id, channel_id, seed, tier, base_xp, created_ms, expires_ms)
	values (?, ?, ?, ?, ?, ?, ?, ?)
`);

const setMsg = db.prepare(`
	update drops
	   set message_id = ?
	 where guild_id = ? and drop_id = ?
`);

const getRow = db.prepare(`
	select *
	  from drops
	 where guild_id = ? and drop_id = ?
`);

const claim = db.prepare(`
	update drops
	   set state = 'claimed', claimed_user_id = ?, claimed_ms = ?
	 where guild_id = ? and drop_id = ?
	   and state = 'open' and expires_ms >= ?
`);

const expireNow = db.prepare(`
	update drops
	   set state = 'expired'
	 where guild_id = ? and drop_id = ?
	   and state = 'open'
`);

export type DropRow = {
  guild_id: string;
  drop_id: string;
  channel_id: string;
  message_id?: string | null;
  seed: string;
  tier: string;
  base_xp: number;
  created_ms: number;
  expires_ms: number;
  target_user_id?: string | null;
  state: "open" | "claimed" | "expired";
  claimed_user_id?: string | null;
  claimed_ms?: number | null;
};

export function createDrop(p: {
  guildId: string;
  dropId: string;
  channelId: string;
  seed: string;
  tier: string;
  baseXp: number;
  createdMs: number;
  expiresMs: number;
  targetUserId?: string | null; // NEW
}) {
  ins.run(
    p.guildId,
    p.dropId,
    p.channelId,
    p.seed,
    p.tier,
    p.baseXp,
    p.createdMs,
    p.expiresMs
  );
  if (p.targetUserId) {
    db.prepare(
      `
			update drops set target_user_id = ? where guild_id = ? and drop_id = ?
		`
    ).run(p.targetUserId, p.guildId, p.dropId);
  }
}

export function attachMessage(
  guildId: string,
  dropId: string,
  messageId: string
) {
  setMsg.run(messageId, guildId, dropId);
}

// replace fetchDrop with a typed version
export function fetchDrop(guildId: string, dropId: string): DropRow | null {
  const r = getRow.get(guildId, dropId) as any;
  if (!r) return null;
  return {
    guild_id: String(r.guild_id),
    drop_id: String(r.drop_id),
    channel_id: String(r.channel_id),
    message_id: r.message_id ?? null,
    seed: String(r.seed),
    tier: String(r.tier),
    base_xp: Number(r.base_xp ?? 0),
    created_ms: Number(r.created_ms ?? 0),
    expires_ms: Number(r.expires_ms ?? 0),
    target_user_id: r.target_user_id ?? null,
    state: (r.state ?? "open") as "open" | "claimed" | "expired",
    claimed_user_id: r.claimed_user_id ?? null,
    claimed_ms: r.claimed_ms ?? null,
  };
}

export function recordClaim(
  guildId: string,
  userId: string,
  ms: number,
  dropId: string
) {
  db.prepare(
    `
		insert into drops_claim_log (guild_id, user_id, drop_id, claimed_ms)
		values (?, ?, ?, ?)
		on conflict(guild_id, user_id, drop_id) do nothing
	`
  ).run(guildId, userId, dropId, ms);
}

export function countClaimsSince(
  guildId: string,
  userId: string,
  sinceMs: number
): number {
  const r = db
    .prepare(
      `select count(*) as c
		   from drops_claim_log
		  where guild_id = ? and user_id = ? and claimed_ms >= ?`
    )
    .get(guildId, userId, sinceMs) as any;
  return Number(r?.c ?? 0);
}
export function tryClaimDrop(p: {
  guildId: string;
  dropId: string;
  userId: string;
  nowMs: number;
}) {
  const res = claim.run(p.userId, p.nowMs, p.guildId, p.dropId, p.nowMs);
  return Number(res.changes) === 1;
}

export function expireDrop(guildId: string, dropId: string) {
  expireNow.run(guildId, dropId);
}

export function getUserState(guildId: string, userId: string) {
  const r = db
    .prepare(
      `
		select last_claim_ms as lastClaimMs, last_pity_ms as lastPityMs, pity_progress as pityProgress
		  from drops_user_state where guild_id = ? and user_id = ?
	`
    )
    .get(guildId, userId) as any;
  return {
    lastClaimMs: Number(r?.lastClaimMs ?? 0),
    lastPityMs: Number(r?.lastPityMs ?? 0),
    pityProgress: Number(r?.pityProgress ?? 0),
  };
}

export function noteClaim(guildId: string, userId: string, nowMs: number) {
  db.prepare(
    `
		insert into drops_user_state (guild_id, user_id, last_claim_ms, last_pity_ms, pity_progress)
		values (?, ?, ?, 0, 0)
		on conflict(guild_id, user_id)
		do update set last_claim_ms = excluded.last_claim_ms, pity_progress = 0
	`
  ).run(guildId, userId, nowMs);
}

export function incPityProgress(guildId: string, userId: string, delta = 1) {
  db.prepare(
    `
		insert into drops_user_state (guild_id, user_id, pity_progress)
		values (?, ?, ?)
		on conflict(guild_id, user_id)
		do update set pity_progress = drops_user_state.pity_progress + excluded.pity_progress
	`
  ).run(guildId, userId, delta);
}

export function notePitySpawn(guildId: string, userId: string, nowMs: number) {
  db.prepare(
    `
		insert into drops_user_state (guild_id, user_id, last_pity_ms)
		values (?, ?, ?)
		on conflict(guild_id, user_id)
		do update set last_pity_ms = excluded.last_pity_ms, pity_progress = 0
	`
  ).run(guildId, userId, nowMs);
}

// append near other exports
export function getDropStats(guildId: string) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60_000;

  const openByTierRows = db
    .prepare(
      `select tier, count(*) as c
		   from drops
		  where guild_id = ? and state = 'open'
		  group by tier`
    )
    .all(guildId) as any[];

  const openByTier = Object.fromEntries(
    openByTierRows.map((r) => [String(r.tier), Number(r.c) | 0])
  );
  const openTotal = Object.values(openByTier).reduce(
    (s, n) => s + Number(n),
    0
  );

  const claimed24h =
    (
      db
        .prepare(
          `select count(*) as c
		   from drops
		  where guild_id = ? and state = 'claimed'
		    and coalesce(claimed_ms, 0) >= ?`
        )
        .get(guildId, dayAgo) as any
    )?.c ?? 0;

  const expired24h =
    (
      db
        .prepare(
          `select count(*) as c
		   from drops
		  where guild_id = ? and state = 'expired'
		    and expires_ms >= ?`
        )
        .get(guildId, dayAgo) as any
    )?.c ?? 0;

  return {
    openByTier,
    openTotal: Number(openTotal),
    claimed24h: Number(claimed24h),
    expired24h: Number(expired24h),
  };
}

export function topClaimers(
  guildId: string,
  sinceMs: number,
  limit = 5
): Array<{ userId: string; count: number }> {
  const rows = db
    .prepare(
      `select user_id, count(*) as c
		   from drops_claim_log
		  where guild_id = ? and claimed_ms >= ?
		  group by user_id
		  order by c desc
		  limit ?`
    )
    .all(guildId, sinceMs, limit) as any[];
  return rows.map((r) => ({
    userId: String(r.user_id),
    count: Number(r.c) | 0,
  }));
}

export function countSpawnsSince(guildId: string, sinceMs: number): number {
  const r = db
    .prepare(
      `select count(*) as c
		   from drops
		  where guild_id = ? and created_ms >= ?`
    )
    .get(guildId, sinceMs) as any;
  return Number(r?.c ?? 0);
}

export function lastChannelSpawnMs(guildId: string, channelId: string): number {
  const r = db
    .prepare(
      `select max(created_ms) as m
		   from drops
		  where guild_id = ? and channel_id = ?`
    )
    .get(guildId, channelId) as any;
  return Number(r?.m ?? 0);
}
