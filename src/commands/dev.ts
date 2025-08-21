import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  getFlag,
  setFlag,
  ANNOUNCE_LEVELUPS,
  MAINTENANCE_MODE,
} from "../lib/global-settings.js";
import { replyEmbedText } from "../lib/embeds.js";
import { ENABLE_RANKCARDS } from "../lib/global-settings.js";

export const data = new SlashCommandBuilder()
  .setName("dev")
  .setDescription("Global dev toggles")
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current toggles")
  )
  .addSubcommand((sc) =>
    sc
      .setName("announce-levelups")
      .setDescription("Enable or disable level-up announcements")
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
    sc
      .setName("rankcard")
      .setDescription("Enable or disable rank-card images")
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
  );

export async function execute(i: ChatInputCommandInteraction) {
  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const on = getFlag(ANNOUNCE_LEVELUPS, true);
    const rc = getFlag(ENABLE_RANKCARDS, true);
    const mm = getFlag(MAINTENANCE_MODE, false);
    await replyEmbedText(
      i,
      "Dev",
      `announce_levelups=${on}\nrankcards=${rc}\nmaintenance=${mm}`,
      true
    );
    return;
  }

  if (sub === "rankcard") {
    const on = i.options.getString("state", true) === "on";
    setFlag(ENABLE_RANKCARDS, on);
    await replyEmbedText(i, "Dev", `rankcards=${on}`, true);
    return;
  }

  const state = i.options.getString("state", true);
  const on = state === "on";
  setFlag(ANNOUNCE_LEVELUPS, on);
  await replyEmbedText(i, "Dev", `announce_levelups=${on}`, true);
}
