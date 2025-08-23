// src/features/drops/boss.ts
import type { Client, Guild, TextBasedChannel } from "discord.js";
import { getDropsConfig } from "./config.js";
import { getBossState, noteBossSpawn } from "./store.js";
import { spawnDrop } from "./spawn.js";
import { metrics } from "../../obs/metrics.js";

async function pickChannel(g: Guild, cfg: ReturnType<typeof getDropsConfig>) {
  // prefer configured bossChannelId
  if (cfg.bossChannelId) {
    try {
      const ch = await g.channels.fetch(cfg.bossChannelId);
      if (ch && "send" in ch) return ch as unknown as TextBasedChannel;
    } catch {}
  }
  // fallback: first allowlist channel
  if (cfg.allowChannels && cfg.allowChannels.length > 0) {
    for (const id of cfg.allowChannels) {
      try {
        const ch = await g.channels.fetch(id);
        if (ch && "send" in ch) return ch as unknown as TextBasedChannel;
      } catch {}
    }
  }
  // fallback: system channel
  if (g.systemChannel && "send" in g.systemChannel) {
    return g.systemChannel as unknown as TextBasedChannel;
  }
  // last resort: any text channel
  const chans = await g.channels.fetch();
  for (const [, ch] of chans) {
    if (ch && "send" in ch) return ch as unknown as TextBasedChannel;
  }
  return null;
}

export async function trySpawnBoss(
  client: Client,
  guildId: string
): Promise<boolean> {
  const g = await client.guilds.fetch(guildId);
  const cfg = getDropsConfig(guildId);
  if (!cfg.bossEnabled) return false;

  const s = getBossState(guildId);
  const now = Date.now();
  if (s.last > 0 && now - s.last < cfg.bossCooldownMs) return false;
  if (s.msg < cfg.bossMsgs) return false;
  if (s.vmin < cfg.bossVoiceMins) return false;

  const ch = await pickChannel(g, cfg);
  if (!ch) return false;

  // TTL to reach 0%, reuse decay config
  const stepsToZero = Math.ceil(1 / cfg.decayPct);
  const ttl = stepsToZero * cfg.decayEveryMs;

  await spawnDrop(ch, guildId, {
    forceTier: cfg.bossTier,
    ttlMs: ttl,
    decayEveryMs: cfg.decayEveryMs,
    decayPct: cfg.decayPct,
    baseXpOverride: cfg.bossBaseXp,
  });
  noteBossSpawn(guildId, now);
  metrics.inc("drops.boss.spawn");
  return true;
}

export async function spawnBossNow(
  client: Client,
  guildId: string,
  reset = true
): Promise<boolean> {
  const g = await client.guilds.fetch(guildId);
  const cfg = getDropsConfig(guildId);

  const ch = await pickChannel(g, cfg);
  if (!ch) return false;

  const stepsToZero = Math.ceil(1 / cfg.decayPct);
  const ttl = stepsToZero * cfg.decayEveryMs;

  await spawnDrop(ch as TextBasedChannel, guildId, {
    forceTier: cfg.bossTier,
    ttlMs: ttl,
    decayEveryMs: cfg.decayEveryMs,
    decayPct: cfg.decayPct,
    baseXpOverride: cfg.bossBaseXp,
  });

  if (reset) noteBossSpawn(guildId, Date.now());
  metrics.inc("drops.boss.spawn.forced");
  return true;
}
