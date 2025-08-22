import Database from "better-sqlite3";
import type { Client } from "discord.js";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import { engine } from "../leveling/service.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists challenge_claims (
		guild_id   text not null,
		challenge  text not null,
		period_key text not null,     -- day start or week start (UTC ms)
		user_id    text not null,
		claimed_ms integer not null,
		primary key (guild_id, challenge, period_key)
	);
	create index if not exists idx_cc_user
		on challenge_claims (guild_id, challenge, user_id);
`);

export function dayKeyUtc(ms: number): string {
  const d = new Date(ms);
  const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return String(key);
}

export function weekKeyUtc(ms: number): string {
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon
  const key = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - dow
  );
  return String(key);
}

export function monthKeyUtc(ms: number): string {
  const d = new Date(ms);
  const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return String(key);
}

const insertClaim = db.prepare(`
	insert into challenge_claims
	 (guild_id, challenge, period_key, user_id, claimed_ms)
	values (?, ?, ?, ?, ?)
`);

export const CH = {
  voiceSprint: "voice_sprint",
  activeTrio: "active_trio",
  marathonMix: "marathon_mix",
} as const;

export type ChallengeKey = keyof typeof CH;
export type ChallengeId = (typeof CH)[ChallengeKey];

const REWARD_BY_ID: Record<ChallengeId, number> = {
  voice_sprint: 100,
  active_trio: 200,
  marathon_mix: 500,
};
export const REWARDS = {
  [CH.voiceSprint]: 100,
  [CH.activeTrio]: 200,
  [CH.marathonMix]: 500,
} as const;

export function getWinner(
  guildId: string,
  challenge: string,
  periodKey: string
): { userId: string; claimedMs: number } | null {
  const r = db
    .prepare(
      `select user_id as userId, claimed_ms as claimedMs
		   from challenge_claims
		  where guild_id = ? and challenge = ? and period_key = ?`
    )
    .get(guildId, challenge, periodKey) as any;
  return r ?? null;
}

export async function tryClaimAndAward(
  client: Client,
  guildId: string,
  challenge: ChallengeId,
  periodKey: string,
  userId: string,
  nowMs: number,
  rewardOverride?: number
): Promise<boolean> {
  try {
    insertClaim.run(guildId, String(challenge), periodKey, userId, nowMs);
  } catch {
    return false;
  }
  const reward = rewardOverride ?? REWARD_BY_ID[challenge] ?? 0;
  if (reward > 0) {
    await engine.awardRawXp(guildId, userId, reward, nowMs);
  }
  return true;
}
