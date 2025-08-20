import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  Role,
} from "discord.js";
import {
  setRoleMultiplier,
  removeRoleMultiplier,
  listRoleMultipliers,
  clearRoleMultipliers,
} from "../features/leveling/role-multipliers.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("rolemult")
  .setDescription("Configure role XP multipliers")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc
      .setName("set")
      .setDescription("Set multiplier for a role")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role").setRequired(true)
      )
      .addNumberOption((o) =>
        o
          .setName("multiplier")
          .setDescription("0.0–5.0 (e.g., 1.2)")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(5)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("remove")
      .setDescription("Remove multiplier for a role")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show configured role multipliers")
  )
  .addSubcommand((sc) =>
    sc.setName("reset-default").setDescription("Keep only Booster role at 1.2×")
  );

function reply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Role Multiplier", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await reply(i, "Guild only.");
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "set") {
    const role = i.options.getRole("role", true) as Role;
    const mult = i.options.getNumber("multiplier", true);
    setRoleMultiplier(i.guildId, role.id, mult);
    await reply(i, `Set <@&${role.id}> → ${mult.toFixed(2)}×`);
    return;
  }

  if (sub === "remove") {
    const role = i.options.getRole("role", true) as Role;
    removeRoleMultiplier(i.guildId, role.id);
    await reply(i, `Removed <@&${role.id}> multiplier`);
    return;
  }

  if (sub === "show") {
    const rows = listRoleMultipliers(i.guildId);
    if (rows.length === 0) {
      await reply(i, "No role multipliers set. Default = 1.0×");
      return;
    }
    const lines = rows.map(
      (r) => `<@&${r.roleId}> → ${Number(r.multiplier).toFixed(2)}×`
    );
    await reply(i, "Role multipliers:\n" + lines.join("\n"));
    return;
  }

  // reset-default
  const g = i.guild!;
  // try RoleManager helper first, then fallback scan
  const booster =
    (g.roles as any).premiumSubscriberRole ??
    g.roles.cache.find((r) => r.tags && (r.tags as any).premiumSubscriberRole);
  if (!booster) {
    clearRoleMultipliers(i.guildId);
    await reply(i, "Cleared all. No Booster role found.");
    return;
  }
  clearRoleMultipliers(i.guildId);
  setRoleMultiplier(i.guildId, booster.id, 1.2);
  await reply(
    i,
    `Reset to default: <@&${booster.id}> → 1.20× (others cleared)`
  );
}
