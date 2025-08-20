import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  ChannelType,
  Role,
} from "discord.js";
import { getConfig } from "../features/leveling/config.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { deterministicInt } from "../lib/detrand.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("auditrng")
  .setDescription("Show deterministic XP roll for a message")
  .addStringOption((o) =>
    o
      .setName("message_id")
      .setDescription("Message ID (from link or copy ID)")
      .setRequired(true)
  )
  .addChannelOption((o) =>
    o
      .setName("channel")
      .setDescription("Channel of the message (defaults to here)")
      .addChannelTypes(ChannelType.GuildText)
  )
  .addUserOption((o) =>
    o.setName("user").setDescription("Author if different from message fetcher")
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Audit RNG", "Guild only.", true);
    return;
  }

  const msgId = i.options.getString("message_id", true);
  const opt = i.options.getChannel("channel");
  const chan = opt ? await i.guild!.channels.fetch(opt.id) : i.channel;
  if (!chan || !chan.isTextBased()) {
    await replyEmbedText(i, "Audit RNG", "Provide a text channel.", true);
    return;
  }

  // try fetch message to confirm author
  let userId = i.options.getUser("user")?.id ?? i.user.id;
  try {
    if ("messages" in chan) {
      const m = await (chan as any).messages.fetch(msgId);
      userId = m.author.id;
    }
  } catch {
    // proceed with provided user
  }

  const cfg = getConfig(i.guildId);
  const member = await i.guild!.members.fetch(userId);
  const factor = getMultiplierForRoles(
    i.guildId,
    Array.from(member.roles.cache.keys())
  );
  const min = Math.floor(cfg.xpMin * factor);
  const max = Math.max(min, Math.floor(cfg.xpMax * factor));
  const roll = deterministicInt(min, max, msgId);

  await replyEmbedText(
    i,
    "Audit RNG",
    [
      `message=${msgId}`,
      `user=${userId}`,
      `range=${min}..${max}`,
      `roll=${roll}`,
      `note: actual award also honors cooldown and anti-spam`,
    ].join("\n"),
    true
  );
}
