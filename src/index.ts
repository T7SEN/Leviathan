// src/index.ts
import "dotenv/config";
import { Client, GatewayIntentBits, Events, Partials } from "discord.js";
import { registerInteractionHandler } from "./events/interaction-create.js";
import { registerMessageHandler } from "./events/message-create.js";
import { registerVoiceHandler } from "./events/voice-state.js";
import { installGlobalErrorLogger } from "./lib/global-error-logger.js";
import { installObservability } from "./lib/observability.js";
import { startLeaderboardWorker } from "./features/leaderboard/rollup.js";
import { startDropsSweeper } from "./features/drops/sweeper.js";
import { installDbHealth } from "./lib/db-health.js";

type LogLevel = "error" | "warn" | "info" | "debug";
const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};
const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) ?? "info";
const LEVEL_CUTOFF = LEVEL_ORDER[LOG_LEVEL] ?? LEVEL_ORDER.info;

function log(level: LogLevel, msg: string) {
  if (LEVEL_ORDER[level] <= LEVEL_CUTOFF) console.log(`[${level}] ${msg}`);
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing env: ${key}`);
  }
  return v;
}

function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [
      Partials.Channel,
      Partials.GuildMember,
      Partials.Message,
      Partials.User,
    ],
  });
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const client = createClient();

  installGlobalErrorLogger(client);
  installObservability(client);
  installDbHealth(client);

  await registerInteractionHandler(client);
  registerMessageHandler(client);
  registerVoiceHandler(client);

  startLeaderboardWorker();

  client.once(Events.ClientReady, (c) => {
    startDropsSweeper(client);
    log("info", `Leviathan online as ${c.user.tag}`);
  });

  client.on(Events.ShardReady, (id) => log("info", `shard ${id} ready`));
  client.on(Events.ShardDisconnect, (_, id) => log("warn", `shard ${id} dc`));
  client.on(Events.ShardError, (err) => log("error", `shard error: ${err}`));

  process.on("SIGINT", async () => {
    log("warn", "SIGINT received, shutting down");
    try {
      await client.destroy();
    } finally {
      process.exit(0);
    }
  });
  process.on("SIGTERM", async () => {
    log("warn", "SIGTERM received, shutting down");
    try {
      await client.destroy();
    } finally {
      process.exit(0);
    }
  });
  process.on("uncaughtException", (err) => {
    log("error", `uncaughtException: ${err?.stack ?? err}`);
  });
  process.on("unhandledRejection", (err) => {
    log("error", `unhandledRejection: ${String(err)}`);
  });

  await client.login(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
