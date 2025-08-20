import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing env: ${key}`);
  }
  return v;
}

type CommandJson = RESTPostAPIChatInputApplicationCommandsJSONBody;

async function readCommandFiles(): Promise<string[]> {
  const root = path.resolve("src/commands");
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile()) {
        if ((p.endsWith(".ts") || p.endsWith(".js")) && !p.endsWith(".d.ts")) {
          files.push(p);
        }
      }
    }
  }
  await walk(root);
  return files;
}

async function loadCommands(): Promise<CommandJson[]> {
  const files = await readCommandFiles();
  const cmds: CommandJson[] = [];
  for (const file of files) {
    const url = pathToFileURL(file).href;
    const mod = await import(url);
    const data = mod.data ?? mod.default?.data;
    if (!data) continue;
    // Support SlashCommandBuilder or plain JSON
    const json = typeof data.toJSON === "function" ? data.toJSON() : data;
    if (json && typeof json.name === "string") {
      cmds.push(json as CommandJson);
    }
  }
  console.log(
    "[deploy] commands:",
    cmds.map((c) => c.name).join(", ") || "(none)"
  );
  return cmds;
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const appId = requireEnv("DISCORD_CLIENT_ID");
  const guildId = requireEnv("PRIMARY_GUILD_ID");

  const commands = await loadCommands();

  const rest = new REST({ version: "10" }).setToken(token);

  console.log(`Deploying ${commands.length} command(s) to guild ${guildId}...`);

  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: commands,
  });

  console.log("Deploy complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
