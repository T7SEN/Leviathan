import "dotenv/config";
import { Client, GatewayIntentBits, Events } from "discord.js";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing env: ${key}`);
  }
  return v;
}

type LogLevel = "error" | "warn" | "info" | "debug";
const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

function log(level: LogLevel, msg: string) {
  const order: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };
  const current = order[LOG_LEVEL];
  if (order[level] <= current) {
    console.log(`[${level}] ${msg}`);
  }
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (c) => {
    log("info", `Leviathan online as ${c.user.tag}`);
  });

  process.on("unhandledRejection", (err) => {
    log("error", `unhandledRejection: ${String(err)}`);
  });

  process.on("uncaughtException", (err) => {
    log("error", `uncaughtException: ${String(err)}`);
  });

  await client.login(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
