import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextBasedChannel,
} from "discord.js";
import { safeSend } from "./discord-retry.js";

const DEFAULT_COLOR = 0x5865f2;

function splitText(s: string, max = 4000): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of s.split("\n")) {
    if ((cur + line + "\n").length > max) {
      out.push(cur.trimEnd());
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.length) out.push(cur.trimEnd());
  return out;
}

export function makeEmbed(title: string, desc: string) {
  return new EmbedBuilder()
    .setColor(DEFAULT_COLOR)
    .setTitle(title)
    .setDescription(desc)
    .setTimestamp();
}

export async function replyEmbedText(
  i: ChatInputCommandInteraction,
  title: string,
  text: string,
  ephemeral = false
) {
  const parts = splitText(text);
  await i.reply({
    embeds: [makeEmbed(title, parts[0] ?? "")],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    allowedMentions: { users: [], roles: [], repliedUser: false },
  });
  for (let k = 1; k < parts.length; k += 1) {
    await i.followUp({
      embeds: [makeEmbed(title, parts[k]!)],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      allowedMentions: { users: [], roles: [], repliedUser: false },
    });
  }
}

export async function sendChannelEmbedText(
  ch: TextBasedChannel,
  title: string,
  text: string
) {
  if (!("send" in ch)) return;
  return safeSend(ch, {
    embeds: [makeEmbed(title, text)],
    allowedMentions: { users: [], roles: [], repliedUser: false },
  });
}
