import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("dbpath")
  .setDescription("Show SQLite file path");

export async function execute(i: ChatInputCommandInteraction) {
  await replyEmbedText(
    i,
    "Database path",
    `DB path: \`${resolvedDbPath()}\``,
    true
  );
}
