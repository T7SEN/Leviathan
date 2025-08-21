// src/commands/ranks.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as milestones from "./milestones.js";

export const data = new SlashCommandBuilder()
  .setName("ranks")
  .setDescription("Alias of /milestones");

export async function execute(i: ChatInputCommandInteraction) {
  return milestones.execute(i);
}
