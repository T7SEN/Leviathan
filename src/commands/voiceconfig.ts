import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { getVoiceConfig, setVoicePolicy } from "../features/voice/config.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("voiceconfig")
  .setDescription("Configure voice XP")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show current voice settings")
  )
  .addSubcommand((sc) =>
    sc
      .setName("set")
      .setDescription("Update voice settings")
      .addIntegerOption((o) =>
        o
          .setName("min_session_sec")
          .setDescription("Minimum session seconds (0–3600)")
          .setMinValue(0)
          .setMaxValue(3600)
      )
      .addIntegerOption((o) =>
        o
          .setName("xp_per_min")
          .setDescription("XP per minute (0–100)")
          .setMinValue(0)
          .setMaxValue(100)
      )
      .addBooleanOption((o) =>
        o
          .setName("require_others")
          .setDescription("Require ≥2 humans in channel")
      )
      .addBooleanOption((o) =>
        o.setName("ignore_afk").setDescription("Ignore AFK channel")
      )
      .addBooleanOption((o) =>
        o
          .setName("require_unmuted")
          .setDescription("Require user not self-muted/deafened")
      )
  );

function reply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Voice Config", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await reply(i, "Guild only.");
    return;
  }

  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const p = getVoiceConfig(i.guildId);
    await reply(
      i,
      [
        "Voice settings:",
        `- minSession=${Math.floor(p.minSessionMs / 1000)}s`,
        `- xpPerMin=${p.xpPerMinute}`,
        `- requireOthers=${p.requireOthers}`,
        `- ignoreAfk=${p.ignoreAfk}`,
        `- requireUnmuted=${p.requireUnmuted}`,
      ].join("\n")
    );
    return;
  }

  const minSec = i.options.getInteger("min_session_sec");
  const xppm = i.options.getInteger("xp_per_min");
  const reqO = i.options.getBoolean("require_others");
  const ignAfk = i.options.getBoolean("ignore_afk");
  const reqUn = i.options.getBoolean("require_unmuted");

  const next = setVoicePolicy(i.guildId, {
    ...(minSec !== null ? { minSessionMs: minSec * 1000 } : {}),
    ...(xppm !== null ? { xpPerMinute: xppm } : {}),
    ...(reqO !== null ? { requireOthers: reqO } : {}),
    ...(ignAfk !== null ? { ignoreAfk: ignAfk } : {}),
    ...(reqUn !== null ? { requireUnmuted: reqUn } : {}),
  });

  await reply(
    i,
    [
      "Updated voice settings:",
      `- minSession=${Math.floor(next.minSessionMs / 1000)}s`,
      `- xpPerMin=${next.xpPerMinute}`,
      `- requireOthers=${next.requireOthers}`,
      `- ignoreAfk=${next.ignoreAfk}`,
      `- requireUnmuted=${next.requireUnmuted}`,
    ].join("\n")
  );
}
