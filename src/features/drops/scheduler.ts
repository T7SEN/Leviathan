// src/features/drops/scheduler.ts

import type { Client, TextBasedChannel } from "discord.js";
import { spawnDrop } from "./spawn.js";
import { metrics } from "../../obs/metrics.js";
import { getDropsConfig } from "./config.js";
import {
  incPityProgress,
  getUserState,
  notePitySpawn,
  countSpawnsSince,
  lastChannelSpawnMs,
} from "./store.js";

type ChanMap<T> = Map<string, T>; // channelId → T

const recentMsgs = new Map<string, ChanMap<number>>(); // counter

function getChanMap<T>(root: Map<string, ChanMap<T>>, g: string): ChanMap<T> {
  let m = root.get(g);
  if (!m) {
    m = new Map();
    root.set(g, m);
  }
  return m;
}

/** Call once per eligible message */
export async function onEligibleMessage(
  client: Client,
  guildId: string,
  channelId: string,
  userId: string
): Promise<void> {
  const cfg = getDropsConfig(guildId);
  const now = Date.now();

  // channel allowlist
  if (cfg.allowChannels && !cfg.allowChannels.includes(channelId)) return;
  if (cfg.channelDenylist && cfg.channelDenylist.includes(channelId)) return;

  // global caps (DB, restart-proof)
  const hourCount = countSpawnsSince(guildId, now - 60 * 60_000);
  if (hourCount >= cfg.globalPerHour) return;
  const dayCount = countSpawnsSince(guildId, now - 24 * 60 * 60_000);
  if (dayCount >= cfg.globalPerDay) return;

  // per-channel cooldown
  const last = lastChannelSpawnMs(guildId, channelId);
  if (last && now - last < cfg.channelCooldownMs) return;

  // increment activity
  const rm = getChanMap(recentMsgs, guildId);
  const n = (rm.get(channelId) ?? 0) + 1;
  rm.set(channelId, n);
  if (n < cfg.minMessagesBeforeSpawn) return;

  // pity progress per user
  if (cfg.pityEnabled) incPityProgress(guildId, userId, 1);

  // channel spawn
  if (n >= cfg.minMessagesBeforeSpawn) {
    // attempt spawn
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch || !("send" in ch)) return;
      // derive TTL so the bar can reach 0%
      const stepsToZero = Math.ceil(1 / cfg.decayPct);
      const ttl = stepsToZero * cfg.decayEveryMs;

      await spawnDrop(ch as TextBasedChannel, guildId, {
        ttlMs: ttl,
        decayEveryMs: cfg.decayEveryMs,
        decayPct: cfg.decayPct,
      });

      // record
      metrics.inc("drops.autospawn");
      rm.set(channelId, 0);
    } catch {
      // ignore send errors
    }
    return;
  }
  // personal pity spawn check (no cooldown hit and within caps)
  if (cfg.pityEnabled) {
    const us = getUserState(guildId, userId);
    const sinceClaim = now - us.lastClaimMs;
    const sincePity = now - us.lastPityMs;
    const need = cfg.pityMinMessages;
    const okWindow =
      sinceClaim >= cfg.pityWindowMs && sincePity >= cfg.channelCooldownMs;
    if (us.pityProgress >= need && okWindow) {
      try {
        const ch = await client.channels.fetch(channelId);
        if (!ch || !("send" in ch)) return;
        const stepsToZero = Math.ceil(1 / cfg.decayPct);
        const ttl = stepsToZero * cfg.decayEveryMs;

        await spawnDrop(ch as TextBasedChannel, guildId, {
          ttlMs: ttl,
          decayEveryMs: cfg.decayEveryMs,
          decayPct: cfg.decayPct,
          forceTier: cfg.pityTier,
          targetUserId: userId,
        });
        notePitySpawn(guildId, userId, now);
        metrics.inc("drops.pityspawn");
      } catch {}
    }
  }
}
