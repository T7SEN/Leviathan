import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { replyEmbedText } from "../lib/embeds.js";
import { getProfile } from "../features/leveling/service.js";
import { getRecap } from "../features/leveling/xp-journal.js";

export const data = new SlashCommandBuilder()
  .setName("recap")
  .setDescription("Personal XP recap")
  .addUserOption((o) => o.setName("user").setDescription("User to inspect"))
  .addIntegerOption((o) =>
    o
      .setName("days")
      .setDescription("Window in days (default 7)")
      .setMinValue(1)
      .setMaxValue(30)
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Recap", "Guild only.", true);
    return;
  }
  const target = i.options.getUser("user") ?? i.user;
  const days = i.options.getInteger("days") ?? 7;
  const now = Date.now();
  const from = now - days * 86_400_000;

  // current profile for context
  const prof = await getProfile(i.guildId, target.id);

  const r = getRecap(i.guildId, target.id, from, now);
  const msg = [
    `Target: <@${target.id}>`,
    `Window: last ${days} day(s)`,
    "",
    `Total gained: ${r.total} XP`,
    `• messages: ${r.bySource.msg ?? 0} XP`,
    `• voice: ${r.bySource.voice ?? 0} XP`,
    "",
    `Levels gained: ${r.levels}`,
    `Current level: ${prof.level}`,
    r.sinceMs && r.untilMs
      ? `Activity: ${new Date(r.sinceMs).toISOString()} → ${new Date(
          r.untilMs
        ).toISOString()}`
      : "Activity: no entries in this window",
  ].join("\n");

  await replyEmbedText(i, "Recap", msg, true);
}
