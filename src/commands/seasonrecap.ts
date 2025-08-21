import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  AttachmentBuilder,
  EmbedBuilder,
} from "discord.js";
import Database from "better-sqlite3";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { getProfile } from "../features/leveling/service.js";
import { getActiveSeasonId, listSeasons } from "../features/seasons/store.js";
import { renderSeasonRecap } from "../features/rankcard/recap-renderer.js";
import { getSeasonActivity } from "../features/leveling/xp-journal.js";

export const data = new SlashCommandBuilder()
  .setName("seasonrecap")
  .setDescription("Season recap card: top 3 and your stats")
  .addUserOption((o) => o.setName("user").setDescription("User to show"))
  .addIntegerOption((o) =>
    o
      .setName("season_id")
      .setDescription("Season id (defaults to active or latest)")
      .setMinValue(1)
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await i.reply({ content: "Guild only." });
    return;
  }
  const target = i.options.getUser("user") ?? i.user;
  const wantedId = i.options.getInteger("season_id") ?? null;

  // resolve season
  const seasons = listSeasons(i.guildId);
  let sid = wantedId;
  if (!sid) {
    const a = getActiveSeasonId(i.guildId);
    sid = a || (seasons[0]?.seasonId ?? 1);
  }
  const srow = seasons.find((s) => s.seasonId === sid);
  const fromMs = Number(srow?.startedMs ?? Date.now());
  const toMs = Number(srow?.endedMs ?? Date.now());

  // top 3
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  let top: Array<{ userId: string; xp: number; level: number; rank: number }>;
  if (srow?.endedMs) {
    top = db
      .prepare(
        `select user_id as userId, xp, level, rank
			   from level_profiles_archive
			  where guild_id = ? and season_id = ?
			  order by rank asc
			  limit 3`
      )
      .all(i.guildId, sid) as any;
  } else {
    top = db
      .prepare(
        `select user_id as userId, xp, level,
			        row_number() over(order by xp desc, user_id asc) as rank
			   from level_profiles
			  where guild_id = ?
			  order by xp desc, user_id asc
			  limit 3`
      )
      .all(i.guildId) as any;
  }
  // fetch users
  const topUsers = await Promise.all(
    top.map(async (r) => ({
      user: await i.client.users.fetch(r.userId),
      xp: Number(r.xp),
      level: Number(r.level),
      rank: Number(r.rank),
    }))
  );

  // me: rank + activity totals
  const prof = await getProfile(i.guildId, target.id);
  let myRank = 1;
  if (srow?.endedMs) {
    const r = db
      .prepare(
        `select rank from level_profiles_archive
			  where guild_id = ? and season_id = ? and user_id = ?`
      )
      .get(i.guildId, sid, target.id) as any;
    myRank = Number(r?.rank ?? 1);
  } else {
    const r = db
      .prepare(
        `select 1 + count(*) as rank
			   from level_profiles
			  where guild_id = ? and xp > (
			    select xp from level_profiles
			     where guild_id = ? and user_id = ?
			   )`
      )
      .get(i.guildId, i.guildId, target.id) as any;
    myRank = Number(r?.rank ?? 1);
  }

  const from = fromMs || Date.now();
  const to = toMs || Date.now();
  const act = getSeasonActivity(i.guildId, target.id, from, to);

  const png = await renderSeasonRecap({
    guildId: i.guildId,
    seasonLabel:
      `S${sid}` +
      (srow?.name ? ` • ${srow.name}` : "") +
      (srow?.endedMs ? " • archived" : ""),
    guildIconUrl: i.guild?.iconURL({ extension: "png", size: 128 }) ?? null,
    top3: topUsers,
    me: {
      user: target,
      rank: myRank,
      xp: prof.xp,
      level: prof.level,
      msgCount: act.msgCount,
      voiceMin: act.voiceMin,
    },
  });

  const file = new AttachmentBuilder(png, { name: "season-recap.png" });
  const embed = new EmbedBuilder()
    .setTitle("Season recap")
    .setDescription(`Season S${sid}` + (srow?.name ? ` • ${srow.name}` : ""))
    .setImage("attachment://season-recap.png")
    .setColor(0x5865f2);

  await i.reply({ embeds: [embed], files: [file] });
}
