// src/commands/export.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import Database from "better-sqlite3";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { makeEmbed } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("export")
  .setDescription("Export CSV data")
  .addSubcommand((sc) =>
    sc
      .setName("leaderboard")
      .setDescription("Export current leaderboard as CSV")
  )
  .addSubcommand((sc) =>
    sc
      .setName("season")
      .setDescription("Export a season archive as CSV")
      .addIntegerOption((o) =>
        o
          .setName("season_id")
          .setDescription("Season id (defaults to latest finished)")
          .setMinValue(1)
      )
  );

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await i.reply({
      embeds: [makeEmbed("Export", "Guild only.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  const sub = i.options.getSubcommand(true);

  if (sub === "leaderboard") {
    const rows = db
      .prepare(
        `select user_id as userId, xp, level
			 from level_profiles
			 where guild_id = ?
			 order by xp desc, user_id asc`
      )
      .all(i.guildId) as Array<{
      userId: string;
      xp: number;
      level: number;
    }>;

    let rank = 0;
    const lines = ["rank,user_id,xp,level"];
    for (const r of rows) {
      rank += 1;
      lines.push(
        [
          csvEscape(rank),
          csvEscape(r.userId),
          csvEscape(Number(r.xp)),
          csvEscape(r.level),
        ].join(",")
      );
    }
    const csv = lines.join("\n");
    const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), {
      name: `leaderboard_${i.guildId}_${todayIso()}.csv`,
    });

    await i.reply({
      embeds: [
        makeEmbed("Export", `Leaderboard rows: ${rows.length}\nAttached CSV.`),
      ],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // season archive
  let sid = i.options.getInteger("season_id") ?? null;
  if (sid === null) {
    const r = db
      .prepare(
        `select max(season_id) as sid
			   from seasons
			  where guild_id = ? and ended_ms is not null`
      )
      .get(i.guildId) as any;
    sid = Number(r?.sid ?? 0) || null;
    // fallback to max season_id if none ended yet
    if (sid === null) {
      const r2 = db
        .prepare(
          `select max(season_id) as sid
				   from seasons
				  where guild_id = ?`
        )
        .get(i.guildId) as any;
      sid = Number(r2?.sid ?? 0) || 1;
    }
  }

  const rows = db
    .prepare(
      `select rank, user_id as userId, xp, level
		   from level_profiles_archive
		  where guild_id = ? and season_id = ?
		  order by rank asc`
    )
    .all(i.guildId, sid) as Array<{
    rank: number;
    userId: string;
    xp: number;
    level: number;
  }>;

  const lines = ["rank,user_id,xp,level"];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.rank),
        csvEscape(r.userId),
        csvEscape(Number(r.xp)),
        csvEscape(r.level),
      ].join(",")
    );
  }
  const csv = lines.join("\n");
  const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), {
    name: `season_${sid}_${i.guildId}_${todayIso()}.csv`,
  });

  await i.reply({
    embeds: [
      makeEmbed("Export", `Season #${sid} rows: ${rows.length}\nAttached CSV.`),
    ],
    files: [file],
    flags: MessageFlags.Ephemeral,
  });
}
