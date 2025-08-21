import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  getActiveSeasonId,
  listSeasons,
  startNewSeason,
  getArchiveTop,
  setActiveSeasonId,
} from "../features/seasons/store.js";
import { replyEmbedText } from "../lib/embeds.js";
import { stripLevelRolesFromGuild } from "../features/leveling/role-rewards.js";

export const data = new SlashCommandBuilder()
  .setName("season")
  .setDescription("Season management")
  .addSubcommand((sc) =>
    sc.setName("show").setDescription("Show active season and recent seasons")
  )
  .addSubcommand((sc) =>
    sc
      .setName("new")
      .setDescription("Archive current and start a new season")
      .addBooleanOption((o) =>
        o
          .setName("confirm")
          .setDescription("Type true to confirm")
          .setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("name").setDescription("Optional season name")
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("top")
      .setDescription("Show top of an archived season")
      .addIntegerOption((o) =>
        o
          .setName("season_id")
          .setDescription("Season id (defaults to latest)")
          .setMinValue(1)
      )
      .addIntegerOption((o) =>
        o
          .setName("limit")
          .setDescription("Rows (1–25)")
          .setMinValue(1)
          .setMaxValue(25)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("activate")
      .setDescription("Switch active season id (no data move)")
      .addIntegerOption((o) =>
        o
          .setName("season_id")
          .setDescription("Existing season id")
          .setRequired(true)
          .setMinValue(1)
      )
  );

function ereply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Season", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) return ereply(i, "Guild only.");
  const sub = i.options.getSubcommand(true);

  if (sub === "show") {
    const active = getActiveSeasonId(i.guildId);
    const list = listSeasons(i.guildId).slice(0, 5);
    const lines = [
      `active=${active}`,
      ...list.map(
        (s) =>
          `#${s.seasonId} "${s.name ?? ""}" ` +
          `${new Date(s.startedMs).toISOString()} ` +
          `${s.endedMs ? "→ " + new Date(s.endedMs).toISOString() : ""}`
      ),
    ];
    return ereply(i, lines.join("\n"));
  }

  if (sub === "new") {
    const ok = i.options.getBoolean("confirm", true);
    if (!ok) return ereply(i, "aborted");
    const name = i.options.getString("name") ?? null;
    const r = await startNewSeason(i.guildId, name);
    const stats = await stripLevelRolesFromGuild(i.client, i.guildId!);
    return replyEmbedText(
      i,
      "Season",
      `season=${r.seasonId} archived=${r.archived}\n` +
        `active reset complete\n` +
        `roles removed: ${stats.removals} from ${stats.members} member(s)`,
      true
    );
  }

  if (sub === "top") {
    let sid = i.options.getInteger("season_id") ?? null;
    if (sid === null) {
      const list = listSeasons(i.guildId);
      sid = list.find((s) => s.endedMs !== null)?.seasonId ?? 1;
    }
    const limit = i.options.getInteger("limit") ?? 10;
    const rows = getArchiveTop(i.guildId, sid!, limit);
    if (rows.length === 0) return ereply(i, "no data");
    const lines = rows.map(
      (r) => `${r.rank}. <@${r.userId}> • ${r.xp} XP (L${r.level})`
    );
    return ereply(i, `season=${sid}\n` + lines.join("\n"));
  }

  // activate
  const sid = i.options.getInteger("season_id", true);
  const ok = setActiveSeasonId(i.guildId, sid);
  return ereply(i, ok ? `active=${sid}` : "season id not found");
}
