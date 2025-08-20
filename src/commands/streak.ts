import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import {
  getStreakConfig,
  setStreakConfig,
  getStreakState,
  resetStreakUser,
  resetStreakGuild,
  applyStreakAndComputeBonus,
} from "../features/leveling/streaks.js";
import { engine } from "../features/leveling/service.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("streak")
  .setDescription("Streak bonus settings and tools")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show streak config")
  )
  .addSubcommand((sc) =>
    sc
      .setName("set")
      .setDescription("Update streak config")
      .addBooleanOption((o) =>
        o.setName("enabled").setDescription("Enable streak bonuses")
      )
      .addIntegerOption((o) =>
        o
          .setName("threshold")
          .setDescription("Days before bonus (≥1)")
          .setMinValue(1)
      )
      .addIntegerOption((o) =>
        o
          .setName("bonus_flat")
          .setDescription("Flat bonus XP per day (≥0)")
          .setMinValue(0)
      )
      .addNumberOption((o) =>
        o
          .setName("bonus_percent")
          .setDescription("Percent of base (e.g., 0.2)")
          .setMinValue(0)
          .setMaxValue(5)
      )
      .addBooleanOption((o) =>
        o.setName("once_per_day").setDescription("Only once per UTC day")
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("user")
      .setDescription("Show a user streak")
      .addUserOption((o) =>
        o.setName("user").setDescription("Target user").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reset-user")
      .setDescription("Reset a user streak")
      .addUserOption((o) =>
        o.setName("user").setDescription("Target user").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reset-all")
      .setDescription("Reset all streaks in this guild")
      .addBooleanOption((o) =>
        o
          .setName("confirm")
          .setDescription("Set true to confirm")
          .setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("test")
      .setDescription("Apply streak bonus now to yourself")
      .addIntegerOption((o) =>
        o
          .setName("base_award")
          .setDescription("Base XP to simulate (default 20)")
          .setMinValue(0)
      )
  );

function ereply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Streak", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await ereply(i, "Guild only.");
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const c = getStreakConfig(i.guildId);
    await ereply(
      i,
      [
        "Streak config:",
        `- enabled=${c.enabled}`,
        `- threshold=${c.threshold}`,
        `- bonusFlat=${c.bonusFlat}`,
        `- bonusPercent=${c.bonusPercent}`,
        `- oncePerDay=${c.oncePerDay}`,
      ].join("\n")
    );
    return;
  }

  if (sub === "set") {
    const next = setStreakConfig(i.guildId, {
      ...(i.options.getBoolean("enabled") !== null
        ? { enabled: i.options.getBoolean("enabled") as boolean }
        : {}),
      ...(i.options.getInteger("threshold") !== null
        ? { threshold: i.options.getInteger("threshold") as number }
        : {}),
      ...(i.options.getInteger("bonus_flat") !== null
        ? { bonusFlat: i.options.getInteger("bonus_flat") as number }
        : {}),
      ...(i.options.getNumber("bonus_percent") !== null
        ? {
            bonusPercent: i.options.getNumber("bonus_percent") as number,
          }
        : {}),
      ...(i.options.getBoolean("once_per_day") !== null
        ? {
            oncePerDay: i.options.getBoolean("once_per_day") as boolean,
          }
        : {}),
    });
    await ereply(
      i,
      [
        "Updated:",
        `- enabled=${next.enabled}`,
        `- threshold=${next.threshold}`,
        `- bonusFlat=${next.bonusFlat}`,
        `- bonusPercent=${next.bonusPercent}`,
        `- oncePerDay=${next.oncePerDay}`,
      ].join("\n")
    );
    return;
  }

  if (sub === "user") {
    const u = i.options.getUser("user", true);
    const st = getStreakState(i.guildId, u.id);
    await ereply(
      i,
      `Streak for ${u}: count=${st.count}, lastDay=${st.lastDay}`
    );
    return;
  }

  if (sub === "reset-user") {
    const u = i.options.getUser("user", true);
    resetStreakUser(i.guildId, u.id);
    await ereply(i, `Reset streak for ${u}.`);
    return;
  }

  if (sub === "reset-all") {
    const ok = i.options.getBoolean("confirm", true);
    if (!ok) {
      await ereply(i, "Aborted.");
      return;
    }
    resetStreakGuild(i.guildId);
    await ereply(i, "Reset all streaks in this guild.");
    return;
  }

  // test
  const base = i.options.getInteger("base_award") ?? 20;
  const res = applyStreakAndComputeBonus(
    i.guildId,
    i.user.id,
    base,
    Date.now()
  );
  if (res.bonus > 0) {
    await engine.awardRawXp(i.guildId, i.user.id, res.bonus);
  }
  await ereply(
    i,
    `Test base=${base}, bonus=${res.bonus}, streak=${res.count}, ` +
      `newDay=${res.newDay}`
  );
}
