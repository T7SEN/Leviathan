import { logXpEvent } from "../features/leveling/xp-journal.js";
import {
  Client,
  Events,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";
import { engine } from "../features/leveling/service.js";
import { getVoiceConfig } from "../features/voice/config.js";
import { applyLevelRewards } from "../features/leveling/role-rewards.js";
import { actionLogger } from "../lib/action-logger.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { applyStreakAndComputeBonus } from "../features/leveling/streaks.js";
import { metrics } from "../obs/metrics.js";
import { getFlag, MAINTENANCE_MODE } from "../lib/global-settings.js";
import { enqueueVoiceBucket } from "../features/maintenance/queue.js";
import {
  claimVoiceMinutes,
  pruneLedger,
} from "../features/leveling/award-ledger.js";
import { markLeaderboardDirty } from "../features/leaderboard/rollup.js";

type Session = {
  guildId: string;
  userId: string;
  channelId: string;
  eligible: boolean;
  lastAwardMs: number; // last time we considered minutes
};

const active = new Map<string, Session>(); // key = guildId:userId

function key(g: string, u: string) {
  return `${g}:${u}`;
}

function countHumans(ch: VoiceBasedChannel | null): number {
  if (!ch) return 0;
  let n = 0;
  for (const m of ch.members.values()) if (!m.user.bot) n += 1;
  return n;
}

function eligibleNow(s: VoiceState): boolean {
  const policy = getVoiceConfig(s.guild.id);
  const ch = s.channel;
  if (!ch) return false;
  if (policy.ignoreAfk && s.guild.afkChannelId === ch.id) return false;
  if (policy.requireUnmuted && (s.selfMute || s.selfDeaf)) return false;
  if (policy.requireOthers && countHumans(ch) < 2) return false;
  return true;
}

async function awardDue(
  client: Client,
  sess: Session,
  nowMs: number
): Promise<void> {
  if (!sess.eligible) return;
  const policy = getVoiceConfig(sess.guildId);
  const startBucket = Math.floor(sess.lastAwardMs / 60_000) + 1;
  const endBucket = Math.floor(nowMs / 60_000);
  const elapsedMin = Math.max(0, endBucket - startBucket + 1);
  if (elapsedMin <= 0) return;

  // apply role multiplier
  const g = await client.guilds.fetch(sess.guildId);
  const member = await g.members.fetch(sess.userId);
  const factor = getMultiplierForRoles(
    sess.guildId,
    Array.from(member.roles.cache.keys())
  );
  const perMin = Math.floor(policy.xpPerMinute * factor);
  if (getFlag(MAINTENANCE_MODE, false)) {
    for (let b = startBucket; b <= endBucket; b += 1) {
      enqueueVoiceBucket(sess.guildId, sess.userId, b, perMin, b * 60_000);
    }
    sess.lastAwardMs = nowMs;
    metrics.observe("maint.queue.voice", elapsedMin);
    return;
  }
  const buckets: number[] = [];
  for (let b = startBucket; b <= endBucket; b += 1) buckets.push(b);
  const claimed = claimVoiceMinutes(
    sess.guildId,
    sess.userId,
    buckets,
    perMin,
    nowMs
  );
  if (claimed <= 0) {
    sess.lastAwardMs = nowMs;
    return;
  }
  metrics.observe("voice.minutes", claimed);
  const xp = claimed * perMin;
  const stop = metrics.startTimer("engine.award.voice");
  const res = await engine.awardRawXp(sess.guildId, sess.userId, xp, nowMs);
  stop();
  if (Date.now() % 120_000 < 50)
    pruneLedger(Date.now() - 30 * 24 * 60 * 60_000);
  if (res.awarded > 0) {
    metrics.inc("xp.award.voice.count");
    metrics.observe("xp.award.voice", res.awarded);
    logXpEvent({
      guildId: sess.guildId,
      userId: sess.userId,
      createdMs: nowMs,
      source: "voice",
      amount: res.awarded,
      leveledUp: res.leveledUp,
      levelAfter: res.profile.level,
    });
  } else {
    metrics.inc("xp.award.voice.zero");
  }
  if (res.awarded > 0) {
    markLeaderboardDirty(sess.guildId);
    const st = applyStreakAndComputeBonus(
      sess.guildId,
      sess.userId,
      res.awarded,
      nowMs
    );
    if (st.bonus > 0) {
      const extra = await engine.awardRawXp(
        sess.guildId,
        sess.userId,
        st.bonus,
        nowMs
      );
      if (extra.awarded > 0) {
        markLeaderboardDirty(sess.guildId);
        logXpEvent({
          guildId: sess.guildId,
          userId: sess.userId,
          createdMs: nowMs,
          source: "voice",
          amount: extra.awarded,
          leveledUp: extra.leveledUp,
          levelAfter: extra.profile.level,
        });
      }
    }
  }
  sess.lastAwardMs += elapsedMin * 60_000;

  if (res.leveledUp) {
    await applyLevelRewards(
      client,
      sess.guildId,
      sess.userId,
      res.profile.level
    );
    await actionLogger(client).logLevelUp({
      userId: sess.userId,
      level: res.profile.level,
      guildId: sess.guildId,
      channelId: sess.channelId,
    });
  }
}

function openSession(s: VoiceState, nowMs: number): void {
  if (!s.channelId) return;
  const k = key(s.guild.id, s.id);
  active.set(k, {
    guildId: s.guild.id,
    userId: s.id,
    channelId: s.channelId,
    eligible: eligibleNow(s),
    lastAwardMs: nowMs,
  });
}

async function closeSession(
  client: Client,
  s: VoiceState,
  nowMs: number
): Promise<void> {
  const k = key(s.guild.id, s.id);
  const sess = active.get(k);
  if (!sess) return;
  await awardDue(client, sess, nowMs);
  active.delete(k);
}

async function flipEligibilityIfNeeded(
  client: Client,
  s: VoiceState,
  nowMs: number
): Promise<void> {
  const k = key(s.guild.id, s.id);
  const sess = active.get(k);
  if (!sess) return;
  const nextElig = eligibleNow(s);
  if (nextElig === sess.eligible) return;
  // pay out until now, then flip and reset clock
  await awardDue(client, sess, nowMs);
  sess.eligible = nextElig;
  sess.lastAwardMs = nowMs;
}

async function sweepChannel(
  client: Client,
  ch: VoiceBasedChannel | null,
  nowMs: number
): Promise<void> {
  if (!ch) return;
  for (const m of ch.members.values()) {
    if (m.user.bot) continue;
    const s = m.voice;
    // ensure tracked
    if (!active.has(key(s.guild.id, s.id))) {
      openSession(s, nowMs);
    }
    await flipEligibilityIfNeeded(client, s, nowMs);
  }
}

export function registerVoiceHandler(client: Client) {
  // periodic checkpoint every minute
  const timer = setInterval(async () => {
    const now = Date.now();
    for (const sess of active.values()) {
      await awardDue(client, sess, now);
    }
  }, 60_000);

  client.on(Events.VoiceStateUpdate, async (oldS, newS) => {
    const now = Date.now();
    // close on leave/move
    if (oldS.channelId && oldS.channelId !== newS.channelId) {
      await closeSession(client, oldS, now);
    }
    // open on join/move
    if (newS.channelId && oldS.channelId !== newS.channelId) {
      openSession(newS, now);
    }
    // flips on self mute/deaf or others joining/leaving
    await flipEligibilityIfNeeded(client, newS, now);
    await sweepChannel(client, oldS.channel, now);
    await sweepChannel(client, newS.channel, now);
  });

  // cleanup on process end
  client.once(Events.ClientReady, () => {
    // no-op, placeholder if you later want to announce readiness
  });
  client.once(
    "shardDisconnect" as unknown as typeof Events.ShardDisconnect,
    () => clearInterval(timer)
  );
}
