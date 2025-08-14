import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

/**
 * /hello — replies with a greeting
 */
export const data = new SlashCommandBuilder()
  .setName("hello")
  .setDescription("Say hello");

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: `Hello, ${interaction.user}`,
    flags: MessageFlags.Ephemeral,
  });
}
