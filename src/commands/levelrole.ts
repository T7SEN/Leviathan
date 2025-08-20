import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from "discord.js";
import {
  setLevelRole,
  removeLevelRole,
  listLevelRoles,
} from "../features/leveling/role-rewards.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("levelrole")
  .setDescription("Configure level→role rewards")
  .addSubcommand((sc) =>
    sc
      .setName("set")
      .setDescription("Grant this role at a level")
      .addIntegerOption((o) =>
        o
          .setName("level")
          .setDescription("Level 1–15")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(15)
      )
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role to grant").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("remove")
      .setDescription("Remove reward at a level")
      .addIntegerOption((o) =>
        o
          .setName("level")
          .setDescription("Level 1–15")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(15)
      )
  )
  .addSubcommand((sc) => sc.setName("list").setDescription("List all rewards"))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

function lackPerms(i: ChatInputCommandInteraction): boolean {
  const p = i.memberPermissions;
  return !p || !p.has(PermissionFlagsBits.ManageRoles);
}

async function reply(i: ChatInputCommandInteraction, s: string) {
  await replyEmbedText(i, "Level Role", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await reply(i, "Guild only.");
    return;
  }
  if (lackPerms(i)) {
    await reply(i, "Missing Manage Roles.");
    return;
  }

  const sub = i.options.getSubcommand(true);

  if (sub === "set") {
    const level = i.options.getInteger("level", true);
    const role = i.options.getRole("role", true);
    // quick manageability check to avoid unusable config
    const me = i.guild!.members.me;
    const manageable =
      me &&
      me.permissions.has(PermissionFlagsBits.ManageRoles) &&
      me.roles.highest.position > role.position;

    if (!manageable) {
      await reply(i, "I cannot manage that role. Check hierarchy.");
      return;
    }

    setLevelRole(i.guildId, level, role.id);
    await reply(i, `Set reward: L${level} → <@&${role.id}>`);
    return;
  }

  if (sub === "remove") {
    const level = i.options.getInteger("level", true);
    removeLevelRole(i.guildId, level);
    await reply(i, `Removed reward at L${level}.`);
    return;
  }

  // list
  const rows = listLevelRoles(i.guildId);
  if (rows.length === 0) {
    await reply(i, "No rewards configured.");
    return;
  }
  const lines = rows.map((r) => `L${r.level} → <@&${r.roleId}>`);
  await reply(i, "Rewards:\n" + lines.join("\n"));
}
