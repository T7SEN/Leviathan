import {
  Client,
  Events,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { actionLogger } from "../lib/action-logger.js";
import { metrics } from "../obs/metrics.js";

type CommandModule = {
  data: { name: string; toJSON?: () => unknown };
  execute: (i: ChatInputCommandInteraction) => Promise<void>;
};

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function findCommandDirs(): Promise<string[]> {
  const candidates = [
    path.resolve("src/commands"),
    path.resolve("dist/commands"),
  ];
  const exists = await Promise.all(candidates.map(dirExists));
  return candidates.filter((_, i) => exists[i]);
}

async function readCommandFiles(dir: string): Promise<string[]> {
  const es = await fs.readdir(dir, { withFileTypes: true });
  return es
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => n.endsWith(".ts") || n.endsWith(".js"))
    .filter((n) => !n.endsWith(".d.ts"))
    .map((n) => path.join(dir, n));
}

async function loadCommands(): Promise<Map<string, CommandModule>> {
  const map = new Map<string, CommandModule>();
  const dirs = await findCommandDirs();
  for (const dir of dirs) {
    const files = await readCommandFiles(dir);
    for (const file of files) {
      const url = pathToFileURL(file).href;
      // dynamic import for ESM
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod: any = await import(url);
      const data = mod.data ?? mod.default?.data;
      const execute = mod.execute ?? mod.default?.execute;
      if (!data || !execute || typeof data.name !== "string") continue;
      map.set(data.name, { data, execute });
    }
  }
  return map;
}

export async function registerInteractionHandler(client: Client) {
  const commands = await loadCommands();

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    metrics.inc(`cmd.${interaction.commandName}.calls`);
    const cmd = commands.get(interaction.commandName);
    if (!cmd) {
      const msg = "Unknown command. Did you deploy the latest set?";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    try {
      await cmd.execute(interaction);
      await actionLogger(interaction.client).logCommand(interaction, "ok");
    } catch (err) {
      metrics.inc(`cmd.${interaction.commandName}.errors`);
      metrics.event("error");
      const msg = "Command failed.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: msg,
          flags: MessageFlags.Ephemeral,
        });
      }
      // eslint-disable-next-line no-console
      console.error("command error:", err);
      await actionLogger(interaction.client).logCommand(
        interaction,
        "error",
        err
      );
    }
  });
}
