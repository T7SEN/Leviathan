import Database from "better-sqlite3";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });
db.exec(`
	create table if not exists global_settings (
		key text primary key,
		value text not null
	);
`);

export const ANNOUNCE_LEVELUPS = "announce_levelups";

export function getFlag(key: string, def: boolean): boolean {
  try {
    const row = db
      .prepare("select value from global_settings where key = ?")
      .get(key) as any;
    return row ? String(row.value) === "1" : def;
  } catch {
    return def;
  }
}

export function setFlag(key: string, val: boolean): void {
  db.prepare(
    `
		insert into global_settings (key, value) values (?, ?)
		on conflict(key) do update set value = excluded.value
	`
  ).run(key, val ? "1" : "0");
}
