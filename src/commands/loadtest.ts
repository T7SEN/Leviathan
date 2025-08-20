import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { engine } from "../features/leveling/service.js";
import { metrics } from "../obs/metrics.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("loadtest")
  .setDescription("Stress test DB write queue")
  .addIntegerOption((o) =>
    o
      .setName("count")
      .setDescription("Number of XP writes (1–5000)")
      .setMinValue(1)
      .setMaxValue(5000)
      .setRequired(true)
  )
  .addIntegerOption((o) =>
    o
      .setName("amount")
      .setDescription("XP per write (default 1)")
      .setMinValue(0)
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Load Test", "Guild only.", true);
    return;
  }
  const n = i.options.getInteger("count", true);
  const amt = i.options.getInteger("amount") ?? 1;
  const stop = metrics.startTimer("loadtest.total");

  for (let k = 0; k < n; k += 1) {
    // awardRawXp hits LevelStore.set → writeQueue
    await engine.awardRawXp(i.guildId, i.user.id, amt);
  }
  stop();

  const snap = metrics.snapshot();
  await replyEmbedText(
    i,
    "Load Test",
    `done: ${n} writes of ${amt} XP\n` +
      `queue.size≈${(snap.summaries as any)["db.queue.len"]?.max ?? 0}\n` +
      `shed=${(snap.counters as any)["db.queue.shed"] ?? 0}\n` +
      `retries=${(snap.counters as any)["db.write.retry"] ?? 0}\n` +
      `fail=${(snap.counters as any)["db.write.fail"] ?? 0}`,
    true
  );
}
