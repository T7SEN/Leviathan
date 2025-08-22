import Database from "better-sqlite3";
import type { Client, TextBasedChannel } from "discord.js";
import { resolvedDbPath } from "../leveling/sqlite-store.js";
import { expireDrop } from "./store.js";
import { getDropsConfig } from "./config.js";

const db = new Database(resolvedDbPath(), { fileMustExist: false });

export function startDropsSweeper(client: Client) {
  const tick = async () => {
    const now = Date.now();

    // 1) expire open + delete messages
    const expRows = db
      .prepare(
        `select guild_id, drop_id, channel_id, message_id
			   from drops
			  where state = 'open' and expires_ms < ?
			  limit 100`
      )
      .all(now) as any[];

    for (const r of expRows) {
      try {
        expireDrop(String(r.guild_id), String(r.drop_id));
      } catch {}
      try {
        const ch = await client.channels.fetch(String(r.channel_id));
        if (ch && "messages" in ch && r.message_id) {
          const msg = await (ch as TextBasedChannel).messages
            .fetch(String(r.message_id))
            .catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      } catch {}
    }

    // 2) prune old claimed/expired by guild retention
    const guilds = db
      .prepare(`select distinct guild_id as g from drops`)
      .all() as any[];
    for (const g of guilds) {
      const guildId = String(g.g);
      const cfg = getDropsConfig(guildId);
      const cutoff = now - cfg.dropRetentionMs;

      // prune claimed
      db.prepare(
        `delete from drops
				  where guild_id = ? and state = 'claimed'
				    and coalesce(claimed_ms, 0) < ?`
      ).run(guildId, cutoff);

      // prune expired
      db.prepare(
        `delete from drops
				  where guild_id = ? and state = 'expired'
				    and expires_ms < ?`
      ).run(guildId, cutoff);
    }
  };

  // run now, then on interval
  tick().catch(() => {});
  const int = setInterval(() => {
    tick().catch(() => {});
  }, getDropsConfig("global").sweeperIntervalMs || 60_000);
  // @ts-ignore
  int.unref?.();
}
