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
		state        text not null default 'open', -- open|claimed|expired
		claimed_user_id text,
		claimed_ms   integer,
		primary key (guild_id, drop_id)
	);
	create index if not exists idx_drops_state
		on drops (guild_id, state, expires_ms);
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

export function createDrop(p: {
  guildId: string;
  dropId: string;
  channelId: string;
  seed: string;
  tier: Tier;
  baseXp: number;
  createdMs: number;
  expiresMs: number;
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
}

export function attachMessage(
  guildId: string,
  dropId: string,
  messageId: string
) {
  setMsg.run(messageId, guildId, dropId);
}

export function fetchDrop(guildId: string, dropId: string): any | null {
  return getRow.get(guildId, dropId) ?? null;
}

export function tryClaimDrop(p: {
  guildId: string;
  dropId: string;
  userId: string;
  nowMs: number;
}): boolean {
  const res = claim.run(p.userId, p.nowMs, p.guildId, p.dropId, p.nowMs);
  return Number(res.changes) === 1;
}

export function expireDrop(guildId: string, dropId: string) {
  expireNow.run(guildId, dropId);
}
