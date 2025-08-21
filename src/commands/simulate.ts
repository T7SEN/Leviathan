import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import Database from "better-sqlite3";
import { replyEmbedText } from "../lib/embeds.js";
import { resolvedDbPath } from "../features/leveling/sqlite-store.js";
import { getProfile } from "../features/leveling/service.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { xpToNext } from "../features/leveling/engine.js";

export const data = new SlashCommandBuilder()
  .setName("simulate")
  .setDescription("Simulate XP and level from messages/voice")
  .addUserOption((o) => o.setName("user").setDescription("Target user"))
  .addIntegerOption((o) =>
    o.setName("messages").setDescription("Number of messages").setMinValue(0)
  )
  .addIntegerOption((o) =>
    o.setName("voice_min").setDescription("Voice minutes").setMinValue(0)
  )
  .addIntegerOption((o) =>
    o
      .setName("msg_min")
      .setDescription("Override XP per message min")
      .setMinValue(0)
  )
  .addIntegerOption((o) =>
    o
      .setName("msg_max")
      .setDescription("Override XP per message max")
      .setMinValue(0)
  )
  .addIntegerOption((o) =>
    o
      .setName("voice_per_min")
      .setDescription("Override XP per voice minute")
      .setMinValue(0)
  )
  .addNumberOption((o) =>
    o
      .setName("multiplier")
      .setDescription("Override role multiplier, e.g. 1.2")
      .setMinValue(0)
  );

function levelFromTotalXp(total: number): { level: number; carry: number } {
  let lvl = 0;
  let need = xpToNext(lvl);
  while (lvl < 15 && total >= need) {
    total -= need;
    lvl += 1;
    need = xpToNext(lvl);
  }
  return { level: lvl, carry: total };
}

function sumXpToLevel(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await replyEmbedText(i, "Simulate", "Guild only.", true);
    return;
  }
  const target = i.options.getUser("user") ?? i.user;
  const profile = await getProfile(i.guildId, target.id);

  // current configs (with safe fallbacks)
  let cfgMsgMin = 15;
  let cfgMsgMax = 35;
  try {
    const mod: any = await import("../features/antispam/config.js");
    const c = mod.getAntiSpamConfig(i.guildId);
    if (c?.xpMin != null) cfgMsgMin = Number(c.xpMin);
    if (c?.xpMax != null) cfgMsgMax = Number(c.xpMax);
  } catch {}

  let cfgVoicePerMin = 5;
  try {
    // try common locations; fall through if not present
    let c: any = null;
    try {
      const m1: any = await import("../features/voice/config.js");
      c = m1.getVoiceConfig?.(i.guildId);
    } catch {}
    if (!c) {
      const m2: any = await import("../features/voice/config.js");
      c = m2.getVoiceConfig?.(i.guildId);
    }
    if (c?.xpPerMinute != null) cfgVoicePerMin = Number(c.xpPerMinute);
  } catch {}

  // overrides
  const messages = i.options.getInteger("messages") ?? 0;
  const voiceMin = i.options.getInteger("voice_min") ?? 0;
  const msgMin = i.options.getInteger("msg_min") ?? cfgMsgMin;
  const msgMax = Math.max(msgMin, i.options.getInteger("msg_max") ?? cfgMsgMax);
  const voicePerMin = i.options.getInteger("voice_per_min") ?? cfgVoicePerMin;

  // multiplier
  let mult = i.options.getNumber("multiplier") ?? null;
  if (mult === null) {
    const member = await i.guild!.members.fetch(target.id);
    mult = getMultiplierForRoles(
      i.guildId,
      Array.from(member.roles.cache.keys())
    );
  }

  // expected per-message XP = midpoint of [min,max], then multiplier
  const perMsg = Math.floor(((msgMin + msgMax) / 2) * mult);
  const perVoice = Math.floor(voicePerMin * mult);

  const xpFromMsgs = Math.max(0, messages) * perMsg;
  const xpFromVoice = Math.max(0, voiceMin) * perVoice;
  const simGain = xpFromMsgs + xpFromVoice;

  // current totals
  const currentTotal = profile.xp;
  const { level: curLevel } = levelFromTotalXp(currentTotal);

  // simulated totals
  const simTotal = currentTotal + simGain;
  const { level: simLevel } = levelFromTotalXp(simTotal);

  // rank estimate (COUNT users with higher XP)
  const db = new Database(resolvedDbPath(), { fileMustExist: false });
  const rankRow = db
    .prepare(
      `select 1 + count(*) as rank
		 from level_profiles
		 where guild_id = ?
		   and xp > ?`
    )
    .get(i.guildId, simTotal) as any;
  const simRank = Number(rankRow?.rank ?? 1);

  const lines = [
    `Target: <@${target.id}>`,
    `Multiplier: ${mult.toFixed(2)}`,
    "",
    `Messages: ${messages} × ${perMsg} XP = ${xpFromMsgs}`,
    `Voice: ${voiceMin} min × ${perVoice} XP = ${xpFromVoice}`,
    `Gain total: ${simGain} XP`,
    "",
    `Current: ${currentTotal} XP • L${curLevel}`,
    `Simulated: ${simTotal} XP • L${simLevel} • est. rank #${simRank}`,
    "",
    "(streak bonuses not included)",
  ].join("\n");

  await replyEmbedText(i, "Simulation", lines, true);
}
