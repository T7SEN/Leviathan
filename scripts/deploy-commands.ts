import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody as CommandJson } from "discord-api-types/v10";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

async function resolveCommandsDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "../dist/src/commands");
  const src = path.resolve(here, "../src/commands");
  try {
    if ((await fs.stat(dist)).isDirectory())
      return { dir: dist, ext: ".js" as const };
  } catch {}
  return { dir: src, ext: ".ts" as const };
}

async function loadCommands(): Promise<CommandJson[]> {
  const out: CommandJson[] = [];
  const { dir, ext } = await resolveCommandsDir();

  for (const file of await fs.readdir(dir)) {
    if (!file.endsWith(ext)) continue;
    const modUrl = pathToFileURL(path.join(dir, file)).href;
    const mod = await import(modUrl);

    const data =
      mod.default?.data ?? mod.data ?? mod.command?.data ?? mod.command;

    const json = typeof data?.toJSON === "function" ? data.toJSON() : data;
    if (!json?.name) {
      console.warn(`[deploy] skipped ${file}`);
      continue;
    }
    out.push(json as CommandJson);
  }
  return out;
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const appId = requireEnv("DISCORD_CLIENT_ID");
  const guildId = process.env.PRIMARY_GUILD_ID;

  const commands = await loadCommands();
  console.log(`[deploy] ${commands.length} command(s)`);

  const rest = new REST({ version: "10" }).setToken(token);

  if (guildId) {
    console.log(`[deploy] to guild ${guildId}`);
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: commands,
    });
  } else {
    console.log("[deploy] global");
    await rest.put(Routes.applicationCommands(appId), { body: commands });
  }
  console.log("[deploy] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
