import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ApplicationCommandOptionType,
} from "discord.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all commands and descriptions");

type AnyOpt = {
  type: number;
  name: string;
  description?: string;
  options?: AnyOpt[];
};

function fmtSubcommands(opts?: AnyOpt[]): string[] {
  if (!opts || opts.length === 0) return [];
  const lines: string[] = [];
  for (const o of opts) {
    if (o.type === ApplicationCommandOptionType.Subcommand) {
      const desc = o.description || "";
      lines.push(`  • ${o.name} — ${desc}`);
    } else if (o.type === ApplicationCommandOptionType.SubcommandGroup) {
      lines.push(`  • ${o.name}:`);
      for (const sub of o.options || []) {
        if (sub.type === ApplicationCommandOptionType.Subcommand) {
          const d = sub.description || "";
          lines.push(`    ◦ ${sub.name} — ${d}`);
        }
      }
    }
  }
  return lines;
}

function chunk(s: string, max = 1900): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of s.split("\n")) {
    if ((cur + line + "\n").length > max) {
      out.push(cur.trimEnd());
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.length) out.push(cur.trimEnd());
  return out;
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guild) {
    await i.reply({
      content: "Guild only.",
    });
    return;
  }

  const coll = await i.guild.commands.fetch();
  const cmds = Array.from(coll.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const lines: string[] = [];
  lines.push("Commands:");
  for (const c of cmds) {
    const desc = c.description || "";
    lines.push(`/${c.name} — ${desc}`);
    const opts: AnyOpt[] = (c.options as unknown as AnyOpt[]) ?? [];
    lines.push(...fmtSubcommands(opts));
  }

  await replyEmbedText(i, "Help", lines.join("\n"), false);
}
