import Database from "better-sqlite3";
import { resolvedDbPath } from "../leveling/sqlite-store.js";

export type RankStyle = {
  theme: "dark" | "light";
  backgroundUrl: string | null;
  showStreak: boolean;
  showVoice: boolean;
};

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists rank_style (
		guild_id text primary key,
		theme text not null,
		background_url text,
		show_streak integer not null,
		show_voice integer not null
	);
`);
const getStmt = db.prepare(`
	select theme, background_url, show_streak, show_voice
	from rank_style where guild_id = ?
`);
const upsertStmt = db.prepare(`
	insert into rank_style (guild_id, theme, background_url, show_streak, show_voice)
	values (?, ?, ?, ?, ?)
	on conflict(guild_id) do update set
		theme = excluded.theme,
		background_url = excluded.background_url,
		show_streak = excluded.show_streak,
		show_voice = excluded.show_voice
`);

export function getRankStyle(guildId: string): RankStyle {
  const r = getStmt.get(guildId) as any;
  if (!r) {
    const theme =
      process.env.RANKCARD_DEFAULT_THEME === "light" ? "light" : "dark";
    const backgroundUrl = process.env.RANKCARD_DEFAULT_BACKGROUND_URL || null;
    const showStreak = (process.env.RANKCARD_SHOW_STREAK ?? "1") !== "0";
    const showVoice = (process.env.RANKCARD_SHOW_VOICE ?? "0") === "1";
    return { theme, backgroundUrl, showStreak, showVoice };
  }
  return {
    theme: r.theme === "light" ? "light" : "dark",
    backgroundUrl: r.background_url ?? null,
    showStreak: Number(r.show_streak) === 1,
    showVoice: Number(r.show_voice) === 1,
  };
}

export function setRankStyle(
  guildId: string,
  patch: Partial<RankStyle>
): RankStyle {
  const cur = getRankStyle(guildId);
  const next: RankStyle = { ...cur, ...patch };
  upsertStmt.run(
    guildId,
    next.theme,
    next.backgroundUrl,
    next.showStreak ? 1 : 0,
    next.showVoice ? 1 : 0
  );
  return next;
}
