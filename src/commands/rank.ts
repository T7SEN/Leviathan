import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import * as level from "./level.js";

export const data = new SlashCommandBuilder()
  .setName("rank")
  .setDescription("Alias of /level")
  .addUserOption((o) => o.setName("user").setDescription("User to inspect"));

export async function execute(i: ChatInputCommandInteraction) {
  return level.execute(i);
}
