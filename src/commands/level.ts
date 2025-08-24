import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
} from "discord.js";
import { getProfile } from "../features/leveling/service.js";
import { xpToNext } from "../features/leveling/engine.js";
import { replyEmbedText } from "../lib/embeds.js";
import { ENABLE_RANKCARDS, getFlag } from "../lib/global-settings.js";
import { renderRankCard } from "../features/rankcard/renderer.js";
import { getArchiveTop } from "../features/seasons/store.js";
import Database from "better-sqlite3";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { getActiveSeasonId, listSeasons } from "../features/seasons/store.js";

export const data = new SlashCommandBuilder()
  .setName("level")
  .setDescription("Show level and XP")
  .addUserOption((o) => o.setName("user").setDescription("User to inspect"));

function xpAtLevelStart(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Level", "Guild only.", true);
    return;
  }
  const target = i.options.getUser("user") ?? i.user;
  const profile = await getProfile(i.guildId, target.id);

  const body =
    `<@${target.id}> • Level ${profile.level}\n` + `Total XP: ${profile.xp}`;

  const rcDefault = (process.env.ENABLE_RANKCARDS ?? "1") !== "0";
  if (!getFlag(ENABLE_RANKCARDS, rcDefault)) {
    await replyEmbedText(i, "Level", body, false);
    return;
  }

  // O(1-ish) rank via COUNT(*)
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  const r = db
    .prepare(
      `select 1 + count(*) as rank
		 from level_profiles
		 where guild_id = ?
		   and xp > (select xp from level_profiles where guild_id = ? and user_id = ?)`
    )
    .get(i.guildId, i.guildId, target.id) as any;
  const rank = Number(r?.rank ?? 1);

  // guild icon url
  const guildIconUrl =
    i.guild?.iconURL({ extension: "png", size: 128 }) ?? null;

  // role multiplier factor
  const member = await i.guild!.members.fetch(target.id);
  const roleMultiplier = getMultiplierForRoles(
    i.guildId,
    Array.from(member.roles.cache.keys())
  );

  // season label
  const activeId = getActiveSeasonId(i.guildId);
  const seasons = listSeasons(i.guildId);
  const active = seasons.find((s) => s.seasonId === activeId);
  const seasonLabel =
    activeId > 0
      ? `S${activeId}` + (active?.name ? ` • ${active.name}` : "")
      : null;

  const png = await renderRankCard({
    guildId: i.guildId,
    user: target,
    level: profile.level,
    totalXp: profile.xp,
    rank,
    guildIconUrl,
    roleMultiplier,
    seasonLabel,
    seasonIconUrl: process.env.RANKCARD_SEASON_ICON_URL || null,
    seasonId: activeId > 0 ? activeId : null,
  });

  const file = new AttachmentBuilder(png, { name: "rank.png" });
  const embed = new EmbedBuilder()
    .setTitle("Level")
    .setDescription(body)
    .setImage("attachment://rank.png")
    .setColor(0x5865f2);

  await i.reply({ embeds: [embed], files: [file] });
}
