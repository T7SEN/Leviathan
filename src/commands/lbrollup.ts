import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  getRollupPage,
  rebuildGuildRollup,
  getPageSize,
  setPageSize,
} from "../features/leaderboard/rollup.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("lbrollup")
  .setDescription("Leaderboard rollup tools")
  .addSubcommand((sc) =>
    sc.setName("rebuild").setDescription("Rebuild pages now")
  )
  .addSubcommand((sc) =>
    sc
      .setName("show")
      .setDescription("Show page metadata")
      .addIntegerOption((o) =>
        o.setName("page").setDescription("Page number").setMinValue(1)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("set-pagesize")
      .setDescription("Set page size (1–50)")
      .addIntegerOption((o) =>
        o
          .setName("n")
          .setDescription("Rows per page")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(50)
      )
  );

function ereply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Leaderboard Rollup", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) return ereply(i, "Guild only.");
  const sub = i.options.getSubcommand(true);

  if (sub === "rebuild") {
    const r = await rebuildGuildRollup(i.guildId);
    return ereply(i, `rebuilt pages=${r.pages} size=${r.pageSize}`);
  }

  if (sub === "show") {
    const page = i.options.getInteger("page") ?? 1;
    const p = getRollupPage(i.guildId, page);
    if (!p) return ereply(i, "no page cached, run /lbrollup rebuild");
    const rows = p.rows.map(
      (r) => `${r.rank}. <@${r.userId}> • ${r.xp} XP (L${r.level})`
    );
    return ereply(
      i,
      [
        `page=${page} size=${p.pageSize} updated=${new Date(
          p.updatedMs
        ).toISOString()}`,
        ...rows,
      ].join("\n")
    );
  }

  // set-pagesize
  const n = i.options.getInteger("n", true);
  const v = setPageSize(i.guildId, n);
  return ereply(i, `page_size=${v}. Run /lbrollup rebuild.`);
}
