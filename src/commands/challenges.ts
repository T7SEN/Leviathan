// src/commands/challenges.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import { makeEmbed } from "../lib/embeds.js";
import {
  CH,
  dayKeyUtc,
  weekKeyUtc,
  getWinner,
  monthKeyUtc,
} from "../features/challenges/store.js";

const REW = {
  voice_sprint: 100,
  active_trio: 200,
  marathon_mix: 500,
} as const;

export const data = new SlashCommandBuilder()
  .setName("challenges")
  .setDescription("Challenge winners and rules");

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await i.reply({
      embeds: [makeEmbed("Challenges", "Guild only.")],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = Date.now();
  const daily = getWinner(i.guildId, CH.voiceSprint, dayKeyUtc(now));
  const weeklyA = getWinner(i.guildId, CH.activeTrio, weekKeyUtc(now));
  const monthlyM = getWinner(i.guildId, CH.marathonMix, monthKeyUtc(now));

  const winners = [
    `Daily • Voice Sprint (+${REW.voice_sprint} XP): ` +
      `${daily ? `<@${daily.userId}>` : "unclaimed"}`,
    `Weekly • Active Trio (+${REW.active_trio} XP): ` +
      `${weeklyA ? `<@${weeklyA.userId}>` : "unclaimed"}`,
    `Monthly • Marathon Mix (+${REW.marathon_mix} XP): ` +
      `${monthlyM ? `<@${monthlyM.userId}>` : "unclaimed"}`,
  ].join("\n");

  const rules = [
    "Voice Sprint (daily): stay 60 continuous minutes in a",
    "non-AFK voice channel with ≥2 other users.",
    "Active Trio (weekly): send ≥3 eligible messages on",
    "≥3 distinct UTC days this week.",
    "Marathon Mix (Monthly): reach ≥300 eligible messages and",
    "≥600 voice minutes this month.",
    "First finisher per guild and period wins. One winner per day/week.",
  ].join("\n");

  await i.reply({
    embeds: [makeEmbed("Challenges", `${winners}\n\nRules\n${rules}`)],
    flags: MessageFlags.Ephemeral,
  });
}
