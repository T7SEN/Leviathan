import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getRankStyle, setRankStyle } from "../features/rankcard/style.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("rankstyle")
  .setDescription("Configure rank-card style")
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current style")
  )
  .addSubcommand((sc) =>
    sc
      .setName("set")
      .setDescription("Update style")
      .addStringOption((o) =>
        o
          .setName("theme")
          .setDescription("dark | light")
          .addChoices(
            { name: "dark", value: "dark" },
            { name: "light", value: "light" }
          )
      )
      .addStringOption((o) =>
        o
          .setName("background_url")
          .setDescription("Image URL or empty to clear")
      )
      .addBooleanOption((o) =>
        o.setName("show_streak").setDescription("Show streak line")
      )
      .addBooleanOption((o) =>
        o.setName("show_voice").setDescription("Show voice minutes line")
      )
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Rank style", "Guild only.", true);
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const s = getRankStyle(i.guildId);
    await replyEmbedText(
      i,
      "Rank style",
      `theme=${s.theme}\nbackground=${s.backgroundUrl ?? "none"}\nshowStreak=${
        s.showStreak
      }\nshowVoice=${s.showVoice}`,
      true
    );
    return;
  }

  const theme = i.options.getString("theme");
  const bg = i.options.getString("background_url");
  const showStreak = i.options.getBoolean("show_streak");
  const showVoice = i.options.getBoolean("show_voice");

  const next = setRankStyle(i.guildId, {
    ...(theme ? { theme: theme as "dark" | "light" } : {}),
    ...(bg !== null ? { backgroundUrl: bg || null } : {}),
    ...(showStreak !== null ? { showStreak: showStreak as boolean } : {}),
    ...(showVoice !== null ? { showVoice: showVoice as boolean } : {}),
  });
  await replyEmbedText(
    i,
    "Rank style",
    `updated\ntheme=${next.theme}\nbackground=${
      next.backgroundUrl ?? "none"
    }\nshowStreak=${next.showStreak}\nshowVoice=${next.showVoice}`,
    true
  );
}
