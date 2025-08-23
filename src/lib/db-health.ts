// src/lib/db-health.ts
import Database, { type Database as SqliteDb } from "better-sqlite3";
import type { Client, TextBasedChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { metrics } from "../obs/metrics.js";

type Health = { ok: boolean; details: string };

function openDb(): SqliteDb {
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function quickCheck(db: SqliteDb): string {
  try {
    const r = db.prepare("PRAGMA quick_check").get() as any;
    return String(Object.values(r)[0] ?? "unknown");
  } catch {
    return "error";
  }
}

function writeTest(db: SqliteDb): boolean {
  try {
    db.exec(`
			create table if not exists _health_check (
				key text primary key,
				val integer not null
			);
		`);
    db.prepare(
      "insert into _health_check (key, val) values (?, ?) " +
        "on conflict(key) do update set val = excluded.val"
    ).run("last", Date.now());
    return true;
  } catch {
    return false;
  }
}

function gatherTables(db: SqliteDb): string[] {
  try {
    const rows = db
      .prepare(
        `select name from sqlite_master
			 where type in ('table','view') and name not like 'sqlite_%'
			 order by name`
      )
      .all() as any[];
    return rows.map((r) => String(r.name));
  } catch {
    return [];
  }
}

function checkNow(): Health {
  const stop = metrics.startTimer("db.check.ms");
  const db = openDb();
  const qc = quickCheck(db);
  const canWrite = writeTest(db);
  const tables = gatherTables(db);
  stop();
  const ok = qc === "ok" && canWrite;
  const details =
    `quick_check=${qc} write=${canWrite ? "ok" : "fail"} ` +
    `tables=${tables.length}`;
  return { ok, details };
}

async function tryChannelLog(
  client: Client,
  title: string,
  body: string,
  ok: boolean
) {
  const id =
    process.env.ACTION_LOG_CHANNEL_ID ?? process.env.LOG_CHANNEL_ID ?? "";
  if (!id) return;
  try {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    const emb = new EmbedBuilder()
      .setTitle(title)
      .setDescription(body)
      .setColor(ok ? 0x10b981 : 0xef4444)
      .setTimestamp(new Date());

    // Some text-based unions (e.g., PartialGroupDMChannel) lack .send in d.ts
    const sender = ch as any;
    if (typeof sender.send !== "function") return;
    await sender.send({ embeds: [emb] });
  } catch {
    // ignore
  }
}

export function installDbHealth(client: Client) {
  client.once("ready", async () => {
    const h = checkNow();
    if (h.ok) metrics.inc("db.health.ok");
    else metrics.inc("db.health.fail");
    console.log(`[db-health] ${h.ok ? "OK" : "FAIL"} • ${h.details}`);
    await tryChannelLog(
      client,
      "DB health",
      `Startup ${h.ok ? "OK" : "FAIL"} • ${h.details}`,
      h.ok
    );
  });

  const t = setInterval(() => {
    const h = checkNow();
    if (h.ok) metrics.inc("db.health.ok");
    else metrics.inc("db.health.fail");
  }, 6 * 60 * 60 * 1000);
  // @ts-ignore
  t.unref?.();
}
