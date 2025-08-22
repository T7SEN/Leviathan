import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { makeEmbed } from "../lib/embeds.js";
import { spawnDrop } from "../features/drops/spawn.js";

export const data = new SlashCommandBuilder()
  .setName("drops")
  .setDescription("XP drops")
  .addSubcommand((sc) =>
    sc
      .setName("spawn")
      .setDescription("Spawn a drop in this channel (admin)")
      .addStringOption((o) =>
        o
          .setName("tier")
          .setDescription("Force a tier")
          .addChoices(
            { name: "auto", value: "auto" },
            { name: "common", value: "common" },
            { name: "uncommon", value: "uncommon" },
            { name: "rare", value: "rare" },
            { name: "epic", value: "epic" },
            { name: "legendary", value: "legendary" }
          )
      )
  )
  .addSubcommand((sc) =>
    sc.setName("status").setDescription("Show drops status")
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId || !i.channel) {
    await i.reply({
      embeds: [makeEmbed("Drops", "Guild channel only.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "spawn") {
    // permission gate
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await i.reply({
        embeds: [makeEmbed("Drops", "Need Manage Server.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await spawnDrop(i.channel, i.guildId, {});
    await i.reply({
      embeds: [makeEmbed("Drops", "Spawned.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "status") {
    await i.reply({
      embeds: [makeEmbed("Drops", "Active: manual spawn only.")],
      flags: MessageFlags.Ephemeral,
    });
  }
}
