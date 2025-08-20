import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import Database from "better-sqlite3";
import { getRollupPage, getPageSize } from "../features/leaderboard/rollup.js";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the server leaderboard")
  .addIntegerOption((o) =>
    o.setName("page").setDescription("Page number").setMinValue(1)
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Leaderboard", "Guild only.", true);
    return;
  }
  const page = i.options.getInteger("page") ?? 1;

  // 1) Try materialized page
  const cached = getRollupPage(i.guildId, page);
  if (cached) {
    const lines = cached.rows.map(
      (r) => `${r.rank}. <@${r.userId}> • ${r.xp} XP (L${r.level})`
    );
    await replyEmbedText(
      i,
      `Leaderboard • Page ${page}`,
      lines.join("\n") || "No data."
    );
    return;
  }

  // 2) Fallback to live SQL if cache not built yet
  const size = getPageSize(i.guildId);
  const offset = (page - 1) * size;
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  const rows = db
    .prepare(
      `select user_id as userId, xp, level
		 from level_profiles
		 where guild_id = ?
		 order by xp desc, user_id asc
		 limit ? offset ?`
    )
    .all(i.guildId, size, offset) as Array<{
    userId: string;
    xp: number;
    level: number;
  }>;

  const lines = rows.map(
    (r, idx) =>
      `${offset + idx + 1}. <@${r.userId}> • ${Number(r.xp)} XP (L${r.level})`
  );

  await replyEmbedText(
    i,
    `Leaderboard • Page ${page}`,
    lines.join("\n") || "No data."
  );
}
