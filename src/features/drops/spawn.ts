import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type TextBasedChannel,
} from "discord.js";
import { nanoid } from "nanoid";
import { createDrop, attachMessage } from "./store.js";
import { weightedPick } from "./util.js";
import { TIER_XP, TIER_WEIGHTS, type Tier } from "./tiers.js";
import { auditableSeed } from "../../lib/auditrng.js";
import { metrics } from "../../obs/metrics.js";
import { safeSend } from "../../lib/discord-retry.js";

export type SpawnOpts = {
  ttlMs?: number;
  decayEveryMs?: number;
  decayPct?: number;
};

export async function spawnDrop(
  ch: TextBasedChannel,
  guildId: string,
  opts: SpawnOpts = {}
) {
  const now = Date.now();
  const ttl = opts.ttlMs ?? 30_000;
  const tier = pickTier();
  const baseXp = TIER_XP[tier];
  const dropId = nanoid(10);
  const channelId = (ch as any).id as string;
  const seed = auditableSeed(`${guildId}|${channelId}|${dropId}`);

  createDrop({
    guildId,
    dropId,
    channelId,
    seed,
    tier,
    baseXp,
    createdMs: now,
    expiresMs: now + ttl,
  });

  const decayMs = opts.decayEveryMs ?? 3_000;
  const decayPct = opts.decayPct ?? 0.05;

  const embed = new EmbedBuilder()
    .setTitle("🎁 XP Capsule")
    .setDescription(
      `tier: **${tier}** • base: **${baseXp} XP**\n` +
        `decays every ${Math.floor(decayMs / 1000)}s`
    )
    .setColor(0x5865f2);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`drop:claim:${dropId}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary)
  );

  // guard TextBasedChannel.send
  if (!("send" in ch)) return;
  const msg = await safeSend(ch, { embeds: [embed], components: [row] });
  // @ts-expect-error msg.id exists on Message
  attachMessage(guildId, dropId, msg.id as string);

  metrics.inc("drops.spawn");
  metrics.inc(`drops.spawn.${tier}`);

  const started = Date.now();
  // best-effort decay label
  const t = setInterval(async () => {
    const age = Date.now() - started;
    if (age >= ttl) {
      clearInterval(t);
      try {
        /* @ts-expect-error */
        await msg.edit({ components: [] });
      } catch {}
      return;
    }
    const ticks = Math.floor(age / decayMs);
    const pctLeft = Math.max(0, 1 - ticks * decayPct);
    try {
      /* @ts-expect-error */
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎁 XP Capsule")
            .setDescription(
              `tier: **${tier}** • base: **${baseXp} XP**\n` +
                `value left: ${(pctLeft * 100).toFixed(0)}%`
            )
            .setColor(0x5865f2),
        ],
      });
    } catch {}
  }, decayMs);
  // @ts-ignore
  t.unref?.();
}

function pickTier(): Tier {
  const items = Object.entries(TIER_WEIGHTS) as Array<[Tier, number]>;
  return weightedPick(items);
}
