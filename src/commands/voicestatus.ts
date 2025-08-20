import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getVoiceConfig } from "../features/voice/config.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("voicestatus")
  .setDescription("Show current voice XP eligibility");

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guild) {
    await replyEmbedText(i, "Voice Status", "Guild only.", true);
    return;
  }
  const me = await i.guild.members.fetch(i.user.id);
  const ch = me.voice.channel;
  const p = getVoiceConfig(i.guild.id);

  if (!ch) {
    await replyEmbedText(i, "Voice Status", "Not in a voice channel.", true);
    return;
  }

  const humans = ch.members.filter((m) => !m.user.bot).size;
  const inAfk = i.guild.afkChannelId === ch.id;
  const muted = me.voice.selfMute || me.voice.selfDeaf;
  const eligible =
    (!p.ignoreAfk || !inAfk) &&
    (!p.requireUnmuted || !muted) &&
    (!p.requireOthers || humans >= 2);

  await replyEmbedText(
    i,
    "Voice Status",
    [
      `channel=#${ch.name}(${ch.id})`,
      `humans=${humans}`,
      `muted=${muted}`,
      `inAfk=${inAfk}`,
      `policy=minSessionSec=${Math.floor(p.minSessionMs / 1000)} xpPerMin=${
        p.xpPerMinute
      } requireOthers=${p.requireOthers} ignoreAfk=${
        p.ignoreAfk
      } requireUnmuted=${p.requireUnmuted}`,
      `eligibleNow=${eligible}`,
    ].join("\n"),
    true
  );
}
