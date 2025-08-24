// src/commands/eta.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { makeEmbed } from "../lib/embeds.js";
import {
  xpToNext,
  levelFromTotalXp,
  MAX_LEVEL,
} from "../features/leveling/engine.js";
import { engine } from "../features/leveling/service.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";

export const data = new SlashCommandBuilder()
  .setName("eta")
  .setDescription("Messages, voice minutes, and ETA to reach levels")
  .addUserOption((o) =>
    o.setName("member").setDescription("Target member (default: you)")
  )
  .addIntegerOption((o) =>
    o
      .setName("target")
      .setDescription("Target level (default: table to max)")
      .setMinValue(1)
      .setMaxValue(MAX_LEVEL)
  )
  .addNumberOption((o) =>
    o.setName("msgxp").setDescription("Avg XP per message (default 20)")
  )
  .addNumberOption((o) =>
    o.setName("vxp").setDescription("XP per voice minute (default 10)")
  )
  .addIntegerOption((o) =>
    o.setName("msgs_per_day").setDescription("Messages/day for ETA math")
  )
  .addIntegerOption((o) =>
    o.setName("vmins_per_day").setDescription("Voice minutes/day for ETA math")
  )
  .addBooleanOption((o) =>
    o
      .setName("apply_role_mult")
      .setDescription("Apply user role multiplier (default on)")
  );

function totalXpToReachLevel(lvl: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(lvl, MAX_LEVEL); i += 1) s += xpToNext(i);
  return s;
}

function ceilDiv(a: number, b: number): number {
  if (b <= 0) return Infinity;
  return Math.ceil(a / b);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await i.reply({
      embeds: [makeEmbed("ETA", "Guild only.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = i.options.getUser("member") ?? i.user;
  const targetLevel = i.options.getInteger("target") ?? null;
  const baseMsgXp = i.options.getNumber("msgxp") ?? 20;
  const baseVxp = i.options.getNumber("vxp") ?? 10;
  const msgsPerDay = i.options.getInteger("msgs_per_day") ?? 0;
  const vminsPerDay = i.options.getInteger("vmins_per_day") ?? 0;
  const applyRoleMult = i.options.getBoolean("apply_role_mult") ?? true;

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  // read profile without mutating
  const snap = await engine.awardRawXp(i.guildId, user.id, 0, Date.now());
  const profile = snap.profile;
  const curLvl = profile.level;
  const curXp = profile.xp;

  // multiplier
  let mult = 1;
  if (applyRoleMult) {
    try {
      const g = await i.client.guilds.fetch(i.guildId);
      const m = await g.members.fetch(user.id);
      const roleIds = Array.from(m.roles.cache.keys());
      mult = getMultiplierForRoles(i.guildId, roleIds);
    } catch {}
  }
  const msgXp = Math.max(0.0001, baseMsgXp * mult);
  const vxp = Math.max(0.0001, baseVxp * mult);

  // helper to format one row
  function rowFor(lvl: number) {
    const need = Math.max(0, totalXpToReachLevel(lvl) - curXp);
    const msgs = ceilDiv(need, msgXp);
    const mins = ceilDiv(need, vxp);

    let eta = "";
    const perDay = msgsPerDay * msgXp + vminsPerDay * vxp;
    if (perDay > 0) {
      const days = need / perDay;
      const d = Math.floor(days);
      const h = Math.ceil((days - d) * 24);
      eta = ` • eta ≈ ${d}d ${h}h`;
    }
    return (
      `L${lvl.toString().padStart(2, " ")}  ` +
      `need ${need.toString().padStart(1, " ")} xp  ` +
      `≈ ${msgs} msgs  |  ${mins} voice mins${eta}`
    );
  }

  const head = [
    `user: <@${user.id}>`,
    `current: L${curLvl} (${curXp} xp total)`,
    `avg msg xp: ${msgXp.toFixed(2)}  •  voice xp/min: ${vxp.toFixed(2)}`,
    applyRoleMult ? `role multiplier: ×${mult.toFixed(2)}` : "role mult: off",
    msgsPerDay || vminsPerDay
      ? `pace: ${msgsPerDay || 0} msgs/day, ${vminsPerDay || 0} min/day`
      : "pace: not set",
  ].join("\n");

  let body = "";
  if (targetLevel) {
    if (targetLevel <= curLvl) {
      body = `Already at L${curLvl} (target ≤ current).`;
    } else {
      body = rowFor(targetLevel);
    }
  } else {
    const lines: string[] = [];
    for (let lvl = Math.max(curLvl + 1, 1); lvl <= MAX_LEVEL; lvl += 1) {
      lines.push(rowFor(lvl));
    }
    body = lines.length
      ? "```\n" + lines.join("\n") + "\n```"
      : "Max level reached.";
  }

  await i.editReply({
    embeds: [makeEmbed("ETA • Levels", head + "\n\n" + body)],
  });
}
