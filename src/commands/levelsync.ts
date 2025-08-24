// src/commands/levelsync.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import { makeEmbed } from "../lib/embeds.js";
import { engine } from "../features/leveling/service.js";
import {
  listLevelRoles,
  fetchRole, // now exported
  canManageRole, // now exported
} from "../features/leveling/role-rewards.js";

export const data = new SlashCommandBuilder()
  .setName("levelsync")
  .setDescription("Sync level roles with DB levels")
  .addSubcommand((sc) =>
    sc
      .setName("user")
      .setDescription("Sync one member")
      .addUserOption((o) =>
        o.setName("member").setDescription("Target member (default: you)")
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("all")
      .setDescription("Sync the whole guild (admin)")
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("Max members").setMinValue(1)
      )
  );

async function syncMember(
  i: ChatInputCommandInteraction,
  guildId: string,
  userId: string
): Promise<{ granted: string[]; removed: string[]; level: number }> {
  const g = await i.client.guilds.fetch(guildId);
  const member = await g.members.fetch(userId);
  if (member.user.bot) return { granted: [], removed: [], level: 0 };

  // Read profile without changing it: award 0 XP to get current profile
  const snap = await engine.awardRawXp(guildId, userId, 0, Date.now());
  const level = snap.profile.level;

  const mappings = listLevelRoles(guildId); // asc by level
  const target = mappings.filter((m) => m.level <= level).pop() ?? null;

  const granted: string[] = [];
  const removed: string[] = [];

  // remove any wrong level-roles
  for (const m of mappings) {
    if (!member.roles.cache.has(m.roleId)) continue;
    if (target && m.roleId === target.roleId) continue;
    const role = await fetchRole(g, m.roleId);
    if (!role || !canManageRole(g, role)) continue;
    try {
      await member.roles.remove(role);
      removed.push(role.id);
    } catch {}
  }

  // grant desired target if missing
  if (target && !member.roles.cache.has(target.roleId)) {
    const role = await fetchRole(g, target.roleId);
    if (role && canManageRole(g, role)) {
      try {
        await member.roles.add(role);
        granted.push(role.id);
      } catch {}
    }
  }

  return { granted, removed, level };
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await i.reply({
      embeds: [makeEmbed("Level Sync", "Guild only.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "user") {
    const user = i.options.getUser("member") ?? i.user;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await syncMember(i, i.guildId, user.id);
    const target =
      listLevelRoles(i.guildId)
        .filter((m) => m.level <= res.level)
        .pop() ?? null;
    const lines = [
      `user: <@${user.id}>`,
      `level: ${res.level}`,
      `target role: ${
        target ? `<@&${target.roleId}> (lvl ${target.level})` : "none"
      }`,
      `granted: ${res.granted.map((id) => `<@&${id}>`).join(", ") || "none"}`,
      `removed: ${res.removed.map((id) => `<@&${id}>`).join(", ") || "none"}`,
    ].join("\n");
    await i.editReply({ embeds: [makeEmbed("Level Sync • User", lines)] });
    return;
  }

  if (sub === "all") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({
        embeds: [makeEmbed("Level Sync", "Need Manage Server.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const limit = i.options.getInteger("limit") ?? 10_000;
    const g = await i.client.guilds.fetch(i.guildId);
    const members = await g.members.fetch();
    const mappings = listLevelRoles(i.guildId);

    let processed = 0,
      grants = 0,
      removals = 0,
      errors = 0;
    for (const m of members.values()) {
      if (processed >= limit) break;
      try {
        const res = await syncMember(i, i.guildId, m.id);
        grants += res.granted.length;
        removals += res.removed.length;
      } catch {
        errors += 1;
      }
      processed += 1;
    }

    const report = [
      `processed: ${processed}`,
      `granted: ${grants}`,
      `removed: ${removals}`,
      `errors: ${errors}`,
      `level-roles: ${
        mappings.length
          ? mappings.map((x) => `<@&${x.roleId}>`).join(", ")
          : "none"
      }`,
    ].join("\n");
    await i.editReply({ embeds: [makeEmbed("Level Sync • Guild", report)] });
  }
}
