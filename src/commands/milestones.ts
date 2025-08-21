// src/commands/milestones.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { replyEmbedText } from "../lib/embeds.js";
import { xpToNext } from "../features/leveling/engine.js";
import { listLevelRoles } from "../features/leveling/role-rewards.js";

export const data = new SlashCommandBuilder()
  .setName("milestones")
  .setDescription("List level perks and required XP");

function totalToReachLevel(L: number): number {
  let sum = 0;
  for (let l = 0; l < L; l += 1) sum += xpToNext(l);
  return sum;
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Milestones", "Guild only.", true);
    return;
  }

  const mappings = listLevelRoles(i.guildId);
  const byLevel = new Map<number, string[]>();
  for (const m of mappings) {
    const arr = byLevel.get(m.level) ?? [];
    arr.push(`<@&${m.roleId}>`);
    byLevel.set(m.level, arr);
  }

  const lines: string[] = [];
  for (let L = 0; L <= 15; L += 1) {
    const total = totalToReachLevel(L);
    const toNext = L < 15 ? xpToNext(L) : 0;
    const roles = byLevel.get(L)?.join(", ") ?? "—";
    const row =
      L < 15
        ? `L${L} • total ${total} XP • to next ${toNext} XP • role: ${roles}`
        : `L${L} • total ${total} XP • max level • role: ${roles}`;
    lines.push(row);
  }

  await replyEmbedText(i, "Milestones", lines.join("\n"), true);
}
