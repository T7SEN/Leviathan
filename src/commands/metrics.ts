import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { metrics } from "../obs/metrics.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("metrics")
  .setDescription("Show runtime metrics snapshot");

export async function execute(i: ChatInputCommandInteraction) {
  const snap = metrics.snapshot();
  const pretty =
    "```json\n" + JSON.stringify(snap, null, 2).slice(0, 1900) + "\n```";
  await replyEmbedText(i, "Metrics", pretty, true);
}
