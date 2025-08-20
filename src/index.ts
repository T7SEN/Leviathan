import "dotenv/config";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { registerInteractionHandler } from "./events/interaction-create.js";
import { registerMessageHandler } from "./events/message-create.js";
import { installGlobalErrorLogger } from "./lib/global-error-logger.js";
import { registerVoiceHandler } from "./events/voice-state.js";
import { installObservability } from "./lib/observability.js";
import { startLeaderboardWorker } from "./features/leaderboard/rollup.js";

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
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  installGlobalErrorLogger(client);
  await registerInteractionHandler(client);
  registerMessageHandler(client);
  registerVoiceHandler(client);
  installObservability(client);
  startLeaderboardWorker();

  client.once(Events.ClientReady, (c) => {
    log("info", `Leviathan online as ${c.user.tag}`);
  });

  await client.login(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
