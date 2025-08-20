import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("testlog")
  .setDescription("Trigger global error logger")
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("Event to trigger")
      .setRequired(true)
      .addChoices(
        { name: "client.error", value: "client" },
        { name: "unhandledRejection", value: "unhandled" },
        { name: "uncaughtException", value: "uncaught" }
      )
  );

export async function execute(i: ChatInputCommandInteraction) {
  const type = i.options.getString("type", true);
  await replyEmbedText(i, "Test Log", `Firing ${type}`, true);

  if (type === "client") {
    i.client.emit("error", new Error("TEST: client.error"));
  } else if (type === "unhandled") {
    setTimeout(() => {
      void Promise.reject(new Error("TEST: unhandledRejection"));
    }, 100);
  } else if (type === "uncaught") {
    setTimeout(() => {
      throw new Error("TEST: uncaughtException");
    }, 100);
  }
}
