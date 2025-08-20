import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  CacheType,
} from "discord.js";
import {
  getConfig,
  setCooldown,
  setXpRange,
  addBlacklistedChannel,
  removeBlacklistedChannel,
  addBlacklistedRole,
  removeBlacklistedRole,
} from "../features/leveling/config.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("levelconfig")
  .setDescription("Configure leveling settings")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current settings")
  )
  .addSubcommand((sc) =>
    sc
      .setName("cooldown")
      .setDescription("Set message cooldown in seconds")
      .addIntegerOption((o) =>
        o
          .setName("seconds")
          .setDescription("0–3600")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(3600)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("xprange")
      .setDescription("Set XP per message range")
      .addIntegerOption((o) =>
        o
          .setName("min")
          .setDescription("Minimum XP")
          .setRequired(true)
          .setMinValue(0)
      )
      .addIntegerOption((o) =>
        o
          .setName("max")
          .setDescription("Maximum XP")
          .setRequired(true)
          .setMinValue(0)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("blacklist-channel-add")
      .setDescription("Ignore messages in a channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("blacklist-channel-remove")
      .setDescription("Remove blacklisted channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("blacklist-role-add")
      .setDescription("Ignore users with a role")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("blacklist-role-remove")
      .setDescription("Remove blacklisted role")
      .addRoleOption((o) =>
        o.setName("role").setDescription("Role").setRequired(true)
      )
  );

async function reply(i: ChatInputCommandInteraction, s: string) {
  await replyEmbedText(i, "Level Config", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await reply(i, "Guild only.");
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const cfg = getConfig(i.guildId);
    await reply(
      i,
      [
        "Current settings:",
        `- Cooldown: ${Math.floor(cfg.minIntervalMs / 1000)}s`,
        `- XP range: ${cfg.xpMin}–${cfg.xpMax}`,
        `- Channel blacklist: ${
          cfg.channelBlacklist.length
            ? cfg.channelBlacklist.map((id) => `<#${id}>`).join(", ")
            : "(none)"
        }`,
        `- Role blacklist: ${
          cfg.roleBlacklist.length
            ? cfg.roleBlacklist.map((id) => `<@&${id}>`).join(", ")
            : "(none)"
        }`,
      ].join("\n")
    );
    return;
  }

  if (sub === "cooldown") {
    const s = i.options.getInteger("seconds", true);
    const cfg = setCooldown(i.guildId, s * 1000);
    await reply(i, `Cooldown set to ${Math.floor(cfg.minIntervalMs / 1000)}s`);
    return;
  }

  if (sub === "xprange") {
    const min = i.options.getInteger("min", true);
    const max = i.options.getInteger("max", true);
    const cfg = setXpRange(i.guildId, min, max);
    await reply(i, `XP range set to ${cfg.xpMin}–${cfg.xpMax}`);
    return;
  }

  if (sub === "blacklist-channel-add") {
    const ch = i.options.getChannel("channel", true);
    const cfg = addBlacklistedChannel(i.guildId, ch.id);
    await reply(i, `Added <#${ch.id}>. Total: ${cfg.channelBlacklist.length}`);
    return;
  }

  if (sub === "blacklist-channel-remove") {
    const ch = i.options.getChannel("channel", true);
    const cfg = removeBlacklistedChannel(i.guildId, ch.id);
    await reply(
      i,
      `Removed <#${ch.id}>. Total: ${cfg.channelBlacklist.length}`
    );
    return;
  }

  if (sub === "blacklist-role-add") {
    const role = i.options.getRole("role", true);
    const cfg = addBlacklistedRole(i.guildId, role.id);
    await reply(i, `Added <@&${role.id}>. Total: ${cfg.roleBlacklist.length}`);
    return;
  }

  // blacklist-role-remove
  const role = i.options.getRole("role", true);
  const cfg = removeBlacklistedRole(i.guildId, role.id);
  await reply(i, `Removed <@&${role.id}>. Total: ${cfg.roleBlacklist.length}`);
}
