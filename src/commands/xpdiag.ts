import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { getConfig } from "../features/leveling/config.js";
import { getAntiSpamConfig } from "../features/antispam/config.js";
import { shouldCountMessage } from "../features/antispam/runtime.js";
import { getProfile } from "../features/leveling/service.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("xpdiag")
  .setDescription("Diagnose message XP gating")
  .addStringOption((o) =>
    o.setName("content").setDescription("Sample message (default provided)")
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId || !i.channelId) {
    await replyEmbedText(i, "XP Diagnosis", "Guild only.", true);
    return;
  }
  const content =
    i.options.getString("content") ??
    "this is a sample message for xp diagnosis";
  const cfg = getConfig(i.guildId);
  const as = getAntiSpamConfig(i.guildId);
  const prof = await getProfile(i.guildId, i.user.id);
  const now = Date.now();
  const engineLeft =
    prof.lastAwardMs === null
      ? 0
      : Math.max(0, cfg.minIntervalMs - (now - prof.lastAwardMs));

  let blocked = "";
  // blacklist checks
  if (cfg.channelBlacklist.includes(i.channelId)) blocked = "channel-blacklist";
  if (!blocked) {
    const member = await i.guild!.members.fetch(i.user.id);
    if (member.roles.cache.some((r) => cfg.roleBlacklist.includes(r.id))) {
      blocked = "role-blacklist";
    }
  }
  // anti-spam/runtime checks
  let runtime = { ok: true, reason: null as string | null };
  if (!blocked) {
    runtime = await shouldCountMessage(
      i.guildId,
      i.channelId,
      i.user.id,
      content,
      now,
      { content: as.content, runtime: as.runtime }
    );
    if (!runtime.ok) blocked = runtime.reason ?? "blocked";
  }

  await replyEmbedText(
    i,
    "XP Diagnosis",
    [
      `content="${content}"`,
      `blocked=${blocked || "no"}`,
      `engineCooldownMsLeft=${engineLeft}`,
      `antiSpam=${JSON.stringify(as.content)}`,
      `runtime=${JSON.stringify(as.runtime)}`,
    ].join("\n"),
    true
  );
}
