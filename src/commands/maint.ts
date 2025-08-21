import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getFlag, setFlag, MAINTENANCE_MODE } from "../lib/global-settings.js";
import { replyEmbedText } from "../lib/embeds.js";
import { queueStatus, flushQueue } from "../features/maintenance/queue.js";

export const data = new SlashCommandBuilder()
  .setName("maint")
  .setDescription("Maintenance mode")
  .addSubcommand((sc) =>
    sc
      .setName("mode")
      .setDescription("Enable or disable maintenance mode")
      .addStringOption((o) =>
        o
          .setName("state")
          .setDescription("on | off")
          .setRequired(true)
          .addChoices(
            { name: "on", value: "on" },
            { name: "off", value: "off" }
          )
      )
  )
  .addSubcommand((sc) =>
    sc.setName("status").setDescription("Show maintenance and queue status")
  )
  .addSubcommand((sc) =>
    sc.setName("flush").setDescription("Process queued awards now")
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) return replyEmbedText(i, "Maintenance", "Guild only.", true);
  const sub = i.options.getSubcommand(true);

  if (sub === "mode") {
    const on = i.options.getString("state", true) === "on";
    setFlag(MAINTENANCE_MODE, on);
    const s = queueStatus(i.guildId);
    return replyEmbedText(
      i,
      "Maintenance",
      `maintenance=${on}\nqueued: msg=${s.msg}, voice=${s.voice}`,
      true
    );
  }

  if (sub === "status") {
    const on = getFlag(MAINTENANCE_MODE, false);
    const s = queueStatus(i.guildId);
    return replyEmbedText(
      i,
      "Maintenance",
      `maintenance=${on}\nqueued: msg=${s.msg}, voice=${s.voice}`,
      true
    );
  }

  // flush
  const r = await flushQueue(i.client, i.guildId);
  return replyEmbedText(
    i,
    "Maintenance",
    `flushed: msg=${r.msg}, voice=${r.voice}`,
    true
  );
}
