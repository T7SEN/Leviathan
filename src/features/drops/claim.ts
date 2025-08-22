import { type ButtonInteraction } from "discord.js";
import { fetchDrop, tryClaimDrop, expireDrop } from "./store.js";
import { engine } from "../leveling/service.js";
import { getMultiplierForRoles } from "../leveling/role-multipliers.js";
import { markLeaderboardDirty } from "../leaderboard/rollup.js";
import { logXpEvent } from "../leveling/xp-journal.js";
import { metrics } from "../../obs/metrics.js";

export async function handleClaimButton(i: ButtonInteraction) {
  // guild+channel only
  if (
    !i.guildId ||
    !i.guild ||
    !i.channel ||
    !i.customId.startsWith("drop:claim:")
  )
    return;

  const parts = i.customId.split(":");
  const dropId = parts[2] ?? "";
  if (!dropId) {
    await i.reply({ content: "Bad drop id.", ephemeral: true });
    return;
  }

  const row = fetchDrop(i.guildId, dropId);
  if (!row) {
    await i.reply({ content: "Expired or missing drop.", ephemeral: true });
    return;
  }

  const now = Date.now();
  if (now > Number(row.expires_ms)) {
    expireDrop(i.guildId, dropId);
    await i.reply({ content: "Too late. It expired.", ephemeral: true });
    return;
  }

  // atomic claim
  const ok = tryClaimDrop({
    guildId: i.guildId!,
    dropId,
    userId: i.user.id,
    nowMs: now,
  });
  if (!ok) {
    await i.reply({
      content: "Already claimed by someone else.",
      ephemeral: true,
    });
    return;
  }

  // decay
  const ttl = Number(row.expires_ms) - Number(row.created_ms);
  const age = now - Number(row.created_ms);
  const ticks = Math.max(0, Math.floor(age / 3000));
  const left = Math.max(0, 1 - ticks * 0.05);

  let amount = Math.max(1, Math.floor(Number(row.base_xp) * left));

  // role multiplier
  try {
    const member = await i.guild.members.fetch(i.user.id);
    const mult = getMultiplierForRoles(
      i.guildId!,
      Array.from(member.roles.cache.keys())
    );
    amount = Math.max(1, Math.floor(amount * mult));
  } catch {}

  const res = await engine.awardRawXp(i.guildId!, i.user.id, amount, now);
  if (res.awarded > 0) {
    markLeaderboardDirty(i.guildId!);
    logXpEvent({
      guildId: i.guildId!,
      userId: i.user.id,
      createdMs: now,
      source: "other",
      amount: res.awarded,
      leveledUp: res.leveledUp,
      levelAfter: res.profile.level,
      qty: 1,
    });
  }

  metrics.inc("drops.claim");
  metrics.observe("drops.claim.xp", amount);

  await i.reply({
    content: `You claimed **${amount} XP** from a ${String(row.tier)} capsule.`,
    ephemeral: true,
  });

  // disable buttons
  try {
    const msg = await i.channel.messages.fetch(String(row.message_id ?? ""));
    await msg.edit({ components: [] });
  } catch {}
}
