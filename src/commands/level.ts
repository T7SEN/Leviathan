import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getProfile } from "../features/leveling/service.js";
import { xpToNext } from "../features/leveling/engine.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("level")
  .setDescription("Show level and XP")
  .addUserOption((o) => o.setName("user").setDescription("User to inspect"));

function xpAtLevelStart(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Level", "Guild only.", true);
    return;
  }

  const target = i.options.getUser("user") ?? i.user;
  const p = await getProfile(i.guildId, target.id);

  const start = xpAtLevelStart(p.level);
  const need = xpToNext(p.level);
  const into = Math.max(0, p.xp - start);
  const pct = Math.min(100, Math.floor((into / need) * 100));

  await replyEmbedText(
    i,
    "Level",
    `Level for ${target}:\n` +
      `- Level: ${p.level}\n` +
      `- XP: ${into}/${need} (${pct}%)\n` +
      `- Total XP: ${p.xp}`,
    true
  );
}
