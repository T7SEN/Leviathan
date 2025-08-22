// src/features/drops/claim.ts
import { type ButtonInteraction } from "discord.js";
import {
  fetchDrop,
  tryClaimDrop,
  expireDrop,
  getUserState,
  noteClaim,
} from "./store.js";
import { getDropsConfig } from "./config.js";
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

  const dropId = i.customId.split(":")[2] ?? "";
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

  // reserved-for-user check
  if (row.target_user_id && String(row.target_user_id) !== i.user.id) {
    await i.reply({
      content: "This capsule is reserved for someone else.",
      ephemeral: true,
    });
    return;
  }

  // per-user cooldown check
  const cfg = getDropsConfig(i.guildId);
  const us = getUserState(i.guildId, i.user.id);
  const since = now - (us.lastClaimMs ?? 0);
  if ((us.lastClaimMs ?? 0) > 0 && since < cfg.perUserCooldownMs) {
    const secs = Math.ceil((cfg.perUserCooldownMs - since) / 1000);
    await i.reply({
      content: `On cooldown. Try again in ${secs}s.`,
      ephemeral: true,
    });
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

  // payout using time-ratio + role multiplier, then award
  const created = Number(row.created_ms);
  const expires = Number(row.expires_ms);
  const ttl = Math.max(1, expires - created);
  const remain = Math.max(0, expires - now);
  const left = Math.min(1, remain / ttl);

  let base = Math.floor(Number(row.base_xp) * left);
  if (base < 1) base = 1;

  let mult = 1;
  try {
    const member = await i.guild.members.fetch(i.user.id);
    mult = getMultiplierForRoles(
      i.guildId!,
      Array.from(member.roles.cache.keys())
    );
  } catch {}

  let finalAmt = Math.floor(base * mult);
  if (finalAmt < 1) finalAmt = 1;

  const res = await engine.awardRawXp(i.guildId!, i.user.id, finalAmt, now);
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

  // note successful claim for cooldown tracking
  noteClaim(i.guildId!, i.user.id, now);

  metrics.inc("drops.claim");
  metrics.observe("drops.claim.xp", finalAmt);

  await i.reply({
    content: `You claimed **${finalAmt} XP** from a ${String(
      row.tier
    )} capsule.`,
    ephemeral: true,
  });

  // delete the original capsule message in 5s
  setTimeout(async () => {
    try {
      if ("delete" in i.message) {
        // component interactions carry the source message
        await (i.message as any).delete();
      } else if (row.message_id && i.channel) {
        const msg = await i.channel.messages.fetch(String(row.message_id));
        await msg.delete();
      }
    } catch {}
  }, 5000).unref?.();
}
