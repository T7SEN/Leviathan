// scripts/deploy-commands.ts
import "dotenv/config";
import { REST, Routes } from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody as CmdJson } from "discord-api-types/v10";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing env: ${key}`);
  }
  return v;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function hereDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

async function resolveCommandsRoot(): Promise<string> {
  // Works for:
  //  - dev:  src/scripts → ../commands = src/commands
  //  - dist: dist/scripts → ../src/commands = dist/src/commands
  const h = hereDir();
  const candidates = [
    path.resolve(h, "../src/commands"),
    path.resolve(h, "../commands"),
    path.resolve(process.cwd(), "src/commands"),
    path.resolve(process.cwd(), "dist/src/commands"),
  ];
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(c)) return c;
  }
  throw new Error("Cannot locate commands directory");
}

async function readCommandFiles(): Promise<string[]> {
  const root = await resolveCommandsRoot();
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      if (err?.code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(p);
      } else if (
        e.isFile() &&
        (p.endsWith(".js") || p.endsWith(".ts")) &&
        !p.endsWith(".d.ts")
      ) {
        out.push(p);
      }
    }
  }
  await walk(root);
  return out.sort();
}

async function loadCommands(): Promise<CmdJson[]> {
  const files = await readCommandFiles();
  const cmds: CmdJson[] = [];
  for (const file of files) {
    try {
      const url = pathToFileURL(file).href;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod: any = await import(url);
      const data = mod.data ?? mod.default?.data;
      if (!data) continue;
      const json = typeof data.toJSON === "function" ? data.toJSON() : data;
      if (json && typeof json.name === "string") {
        cmds.push(json as CmdJson);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[deploy] load failed:", file, err);
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    "[deploy] commands:",
    cmds.map((c) => c.name).join(", ") || "(none)"
  );
  return cmds;
}

async function main() {
  const token = requireEnv("DISCORD_TOKEN");
  const appId =
    process.env.DISCORD_CLIENT_ID ??
    process.env.APPLICATION_ID ??
    requireEnv("DISCORD_CLIENT_ID");

  // Prefer guild deploy for speed. Fall back to global if no guild env set or DEPLOY_GLOBAL=1
  const guildId =
    process.env.DEV_GUILD_ID ??
    process.env.PRIMARY_GUILD_ID ??
    process.env.GUILD_ID ??
    "";

  const commands = await loadCommands();
  const rest = new REST({ version: "10" }).setToken(token);

  if (!guildId || process.env.DEPLOY_GLOBAL === "1") {
    console.log(`Deploying ${commands.length} command(s) globally…`);
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log("Deploy complete (global).");
    return;
  }

  console.log(`Deploying ${commands.length} command(s) to guild ${guildId}…`);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: commands,
  });
  console.log("Deploy complete (guild).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
