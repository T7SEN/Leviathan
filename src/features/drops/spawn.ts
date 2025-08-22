import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type TextBasedChannel,
} from "discord.js";
import { nanoid } from "nanoid";
import { createDrop, attachMessage, expireDrop } from "./store.js";
import { weightedPick } from "./util.js";
import { TIER_XP, TIER_WEIGHTS, type Tier } from "./tiers.js";
import { auditableSeed } from "../../lib/auditrng.js";
import { metrics } from "../../obs/metrics.js";
import { safeSend } from "../../lib/discord-retry.js";

export type SpawnOpts = {
  ttlMs?: number;
  decayEveryMs?: number;
  decayPct?: number;
  forceTier?: Tier | "auto";
  targetUserId?: string | null;
};

export async function spawnDrop(
  ch: TextBasedChannel,
  guildId: string,
  opts: SpawnOpts = {}
) {
  const now = Date.now();
  const decayMs = opts.decayEveryMs ?? 3_000;
  const decayPct = opts.decayPct ?? 0.05;
  const stepsToZero = Math.ceil(1 / decayPct); // e.g. 20 steps for 5%
  const ttl = opts.ttlMs ?? stepsToZero * decayMs; // default reaches 0%
  const forced =
    opts.forceTier && opts.forceTier !== "auto"
      ? (opts.forceTier as Tier)
      : null;
  const tier: Tier = forced ?? pickTier();
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
    targetUserId: opts.targetUserId ?? null,
  });

  const reserved = opts.targetUserId
    ? `\nreserved for <@${opts.targetUserId}>`
    : "";
  const embed = new EmbedBuilder()
    .setTitle("🎁 XP Capsule")
    .setDescription(
      `tier: **${tier}** • base: **${baseXp} XP**\n` +
        `decays every ${Math.floor(decayMs / 1000)}s${reserved}`
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
  const t = setInterval(async () => {
    const age = Date.now() - started;
    const remain = Math.max(0, ttl - age);
    const fracLeft = remain / ttl;
    const pctLeft = Math.max(0, Math.round(fracLeft * 100));

    if (remain <= 0) {
      clearInterval(t);
      try {
        expireDrop(guildId, dropId);
      } catch {}
      try {
        // @ts-expect-error message delete available at runtime
        await msg.delete();
      } catch {}
      return;
    }

    try {
      // @ts-expect-error edit exists on Message
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎁 XP Capsule")
            .setDescription(
              `tier: **${tier}** • base: **${baseXp} XP**\n` +
                `value left: ${pctLeft}%`
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
