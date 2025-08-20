import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";
import {
  claimMessageOnce,
  finalizeMessageAward,
} from "../features/leveling/award-ledger.js";
import { engine } from "../features/leveling/service.js";
import { getConfig } from "../features/leveling/config.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("ledger")
  .setDescription("Idempotency tests")
  .addSubcommand((sc) =>
    sc
      .setName("msg")
      .setDescription("Try to award for a message ID twice")
      .addStringOption((o) =>
        o.setName("message_id").setDescription("Message ID").setRequired(true)
      )
  );

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guild || !i.channel) {
    await replyEmbedText(i, "Ledger", "Guild only.", true);
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "msg") {
    const msgId = i.options.getString("message_id", true);
    const first = claimMessageOnce(i.guild.id, msgId, i.user.id);
    let awarded = 0;
    if (first) {
      const cfg = getConfig(i.guild.id);
      const member = await i.guild.members.fetch(i.user.id);
      const factor = getMultiplierForRoles(
        i.guild.id,
        Array.from(member.roles.cache.keys())
      );
      const min = Math.floor(cfg.xpMin * factor);
      const max = Math.max(min, Math.floor(cfg.xpMax * factor));
      const res = await engine.awardMessageXp(
        i.guild.id,
        i.user.id,
        Date.now(),
        {
          minIntervalMs: cfg.minIntervalMs,
          xpPerMessageMin: min,
          xpPerMessageMax: max,
        },
        msgId
      );
      awarded = res.awarded;
      finalizeMessageAward(i.guild.id, msgId, awarded);
    }
    await replyEmbedText(
      i,
      "Ledger",
      `claimed=${first} awarded=${awarded}`,
      true
    );
  }
}
