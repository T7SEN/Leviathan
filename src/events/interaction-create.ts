// src/events/interaction-create.ts
import {
  Client,
  Events,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { actionLogger } from "../lib/action-logger.js";
import { metrics } from "../obs/metrics.js";
import { handleClaimButton } from "../features/drops/claim.js";

type CommandModule = {
  data: { name: string; toJSON?: () => unknown };
  execute: (i: ChatInputCommandInteraction) => Promise<void>;
};

function commandsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // when running dev:   here = src/events  → ../commands = src/commands
  // when running dist:  here = dist/src/events → ../commands = dist/src/commands
  return path.resolve(here, "../commands");
}

async function readCommandFiles(dir: string): Promise<string[]> {
  try {
    const es = await fs.readdir(dir, { withFileTypes: true });
    return es
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter(
        (n) => (n.endsWith(".js") || n.endsWith(".ts")) && !n.endsWith(".d.ts")
      )
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

async function loadCommands(): Promise<Map<string, CommandModule>> {
  const map = new Map<string, CommandModule>();
  const dir = commandsDir();
  const files = await readCommandFiles(dir);
  for (const file of files) {
    try {
      const url = pathToFileURL(file).href;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod: any = await import(url);
      const data = mod.data ?? mod.default?.data;
      const execute = mod.execute ?? mod.default?.execute;
      if (!data || !execute || typeof data.name !== "string") continue;
      map.set(data.name, { data, execute });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("command load failed:", file, err);
    }
  }
  return map;
}

export async function registerInteractionHandler(client: Client) {
  const commands = await loadCommands();

  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("drop:claim:")
    ) {
      await handleClaimButton(interaction);
      return;
    }
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
