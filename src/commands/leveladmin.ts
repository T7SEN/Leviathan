import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  Role,
} from "discord.js";
import { getProfile, saveProfile } from "../features/leveling/service.js";
import {
  levelFromTotalXp,
  xpToNext,
  MAX_LEVEL,
} from "../features/leveling/engine.js";
import {
  applyLevelRewards,
  stripLevelRoles,
  stripLevelRolesFromGuild,
} from "../features/leveling/role-rewards.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("leveladmin")
  .setDescription("Admin: adjust levels and XP")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("givexp")
      .setDescription("Add XP to a user")
      .addUserOption((o) =>
        o.setName("user").setDescription("Target user").setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("amount")
          .setDescription("XP to add (1–100000)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(100000)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("setlevel")
      .setDescription("Set a user level directly")
      .addUserOption((o) =>
        o.setName("user").setDescription("Target user").setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("level")
          .setDescription("Level 0–15")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(15)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reset")
      .setDescription("Reset a user to level 0")
      .addUserOption((o) =>
        o.setName("user").setDescription("Target user").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("resetbulk")
      .setDescription("Bulk reset users in this guild")
      .addStringOption((o) =>
        o
          .setName("scope")
          .setDescription("Reset all or by role")
          .setRequired(true)
          .addChoices(
            { name: "all", value: "all" },
            { name: "role", value: "role" }
          )
      )
      .addBooleanOption((o) =>
        o
          .setName("confirm")
          .setDescription("Type: I understand. Set true to proceed.")
          .setRequired(true)
      )
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role to reset (when scope=role)")
      )
  );

function xpAtLevelStart(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

async function reply(i: ChatInputCommandInteraction, s: string) {
  await replyEmbedText(i, "Level Admin", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await reply(i, "Guild only.");
    return;
  }

  const sub = i.options.getSubcommand(true);

  if (sub === "givexp") {
    const user = i.options.getUser("user", true);
    const amt = i.options.getInteger("amount", true);
    const prev = await getProfile(i.guildId, user.id);
    const beforeLvl = prev.level;
    const nextXp = prev.xp + amt;
    const nextLvl = Math.min(levelFromTotalXp(nextXp), MAX_LEVEL);
    const next = {
      ...prev,
      xp: nextXp,
      level: nextLvl,
      lastAwardMs: Date.now(),
    };
    await saveProfile(next);
    if (nextLvl > beforeLvl) {
      await applyLevelRewards(i.client, i.guildId, user.id, nextLvl);
    }
    await reply(
      i,
      `Added ${amt} XP to ${user} → ` +
        `level ${beforeLvl} → ${nextLvl}, total XP ${nextXp}`
    );
    return;
  }

  if (sub === "setlevel") {
    const user = i.options.getUser("user", true);
    const lvlRaw = i.options.getInteger("level", true);
    const lvl = Math.max(1, Math.min(MAX_LEVEL, lvlRaw));
    const baseXp = xpAtLevelStart(lvl);
    const prev = await getProfile(i.guildId, user.id);
    const next = {
      ...prev,
      xp: baseXp,
      level: lvl,
      lastAwardMs: Date.now(),
    };
    await saveProfile(next);
    await applyLevelRewards(i.client, i.guildId, user.id, lvl);
    await reply(i, `Set ${user} to level ${lvl} (base XP ${baseXp}).`);
    return;
  }

  if (sub === "resetbulk") {
    const confirmed = i.options.getBoolean("confirm", true);
    if (!confirmed) {
      await reply(i, "Aborted. Set confirm=true to proceed.");
      return;
    }

    const scope = i.options.getString("scope", true);

    // ALL: reset every profile, then strip all level roles
    if (scope === "all") {
      const { resetGuildProfiles } = await import(
        "../features/leveling/sqlite-store.js"
      );
      const rows = resetGuildProfiles(i.guildId); // returns number of rows reset
      const stats = await stripLevelRolesFromGuild(i.client, i.guildId!);
      await replyEmbedText(
        i,
        "Level admin",
        `bulk reset (all) complete\nrows: ${rows}\nroles removed: ${stats.removals} from ${stats.members} member(s)`,
        true
      );
      return;
    }

    // ROLE: reset only members with a given role, then strip roles from them
    const opt = i.options.getRole("role", true);
    // ensure a Guild Role, not APIRole
    const role = await i.guild!.roles.fetch(opt.id);
    if (!role) {
      await reply(i, "role not found");
      return;
    }

    // fetch full member list to include offline members
    await i.guild!.members.fetch();
    const ids: string[] = Array.from(role.members.keys());
    if (ids.length === 0) {
      await reply(i, "No members found with that role.");
      return;
    }

    const { resetUserProfiles } = await import(
      "../features/leveling/sqlite-store.js"
    );
    const rows = resetUserProfiles(i.guildId, ids);
    const stats = await stripLevelRoles(i.client, i.guildId!, ids);

    await replyEmbedText(
      i,
      "Level admin",
      `bulk reset (role ${role}) complete\nrows: ${rows}\nroles removed: ${stats.removals} from ${stats.members} member(s)`,
      true
    );
    return;
  }

  // reset
  const user = i.options.getUser("user", true);
  const prev = await getProfile(i.guildId, user.id);
  const next = {
    ...prev,
    xp: 0,
    level: 0,
    lastAwardMs: null,
  };
  await saveProfile(next); // save first

  // then strip level roles
  const stats = await stripLevelRoles(i.client, i.guildId!, [user.id]);

  await replyEmbedText(
    i,
    "Level admin",
    `reset ${user} → level 0\nroles removed: ${stats.removals} from ${stats.members} member(s)`,
    true
  );
  return;
}

export async function execute_resetbulk(i: ChatInputCommandInteraction) {}
