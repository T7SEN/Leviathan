import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import {
  getAntiSpamConfig,
  setContentPolicy,
  setRuntimePolicy,
} from "../features/antispam/config.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("antispam")
  .setDescription("Configure anti-spam")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current anti-spam settings")
  )
  .addSubcommand((sc) =>
    sc
      .setName("content")
      .setDescription("Set content checks")
      .addIntegerOption((o) =>
        o
          .setName("min_chars")
          .setDescription("Minimum characters (0–200)")
          .setMinValue(0)
          .setMaxValue(200)
      )
      .addIntegerOption((o) =>
        o
          .setName("min_words")
          .setDescription("Minimum words (0–20)")
          .setMinValue(0)
          .setMaxValue(20)
      )
      .addBooleanOption((o) =>
        o
          .setName("allow_emoji_only")
          .setDescription("Allow emoji-only messages")
      )
      .addIntegerOption((o) =>
        o
          .setName("max_repeat_run")
          .setDescription("Max repeated char run (1–20)")
          .setMinValue(1)
          .setMaxValue(20)
      )
      .addIntegerOption((o) =>
        o
          .setName("min_distinct_chars")
          .setDescription("Min distinct chars (1–20)")
          .setMinValue(1)
          .setMaxValue(20)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("runtime")
      .setDescription("Set cooldown and duplicate window")
      .addIntegerOption((o) =>
        o
          .setName("per_channel_cooldown_sec")
          .setDescription("Per-channel cooldown seconds (0–600)")
          .setMinValue(0)
          .setMaxValue(600)
      )
      .addIntegerOption((o) =>
        o
          .setName("duplicate_window_min")
          .setDescription("Duplicate window minutes (0–120)")
          .setMinValue(0)
          .setMaxValue(120)
      )
  );

function ereply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Antispam", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await ereply(i, "Guild only.");
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const c = getAntiSpamConfig(i.guildId);
    await ereply(
      i,
      [
        "Anti-spam settings:",
        `- Content: minChars=${c.content.minChars}, ` +
          `minWords=${c.content.minWords}, ` +
          `allowEmojiOnly=${c.content.allowEmojiOnly},`,
        `  maxRepeatRun=${c.content.maxRepeatCharRun}, ` +
          `minDistinct=${c.content.minDistinctChars}`,
        `- Runtime: perChannelCooldown=` +
          `${Math.floor(c.runtime.perChannelCooldownMs / 1000)}s, ` +
          `duplicateWindow=` +
          `${Math.floor(c.runtime.duplicateWindowMs / 60000)}m`,
      ].join("\n")
    );
    return;
  }

  if (sub === "content") {
    const minChars = i.options.getInteger("min_chars");
    const minWords = i.options.getInteger("min_words");
    const allowEmojiOnly = i.options.getBoolean("allow_emoji_only");
    const maxRepeatRun = i.options.getInteger("max_repeat_run");
    const minDistinctChars = i.options.getInteger("min_distinct_chars");

    const cfg = setContentPolicy(i.guildId, {
      ...(minChars !== null ? { minChars } : {}),
      ...(minWords !== null ? { minWords } : {}),
      ...(allowEmojiOnly !== null ? { allowEmojiOnly } : {}),
      ...(maxRepeatRun !== null ? { maxRepeatCharRun: maxRepeatRun } : {}),
      ...(minDistinctChars !== null ? { minDistinctChars } : {}),
    });
    await ereply(
      i,
      `Updated content policy: ` +
        `minChars=${cfg.content.minChars}, ` +
        `minWords=${cfg.content.minWords}, ` +
        `allowEmojiOnly=${cfg.content.allowEmojiOnly}, ` +
        `maxRepeatRun=${cfg.content.maxRepeatCharRun}, ` +
        `minDistinct=${cfg.content.minDistinctChars}`
    );
    return;
  }

  // runtime
  const cool = i.options.getInteger("per_channel_cooldown_sec");
  const win = i.options.getInteger("duplicate_window_min");
  const cfg = setRuntimePolicy(i.guildId, {
    ...(cool !== null ? { perChannelCooldownMs: cool * 1000 } : {}),
    ...(win !== null ? { duplicateWindowMs: win * 60_000 } : {}),
  });
  await ereply(
    i,
    `Updated runtime: ` +
      `perChannelCooldown=${Math.floor(
        cfg.runtime.perChannelCooldownMs / 1000
      )}s, ` +
      `duplicateWindow=${Math.floor(cfg.runtime.duplicateWindowMs / 60000)}m`
  );
}
