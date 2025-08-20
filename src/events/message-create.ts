import { Client, Events, type Message } from "discord.js";
import { engine } from "../features/leveling/service.js";
import { actionLogger } from "../lib/action-logger.js";
import { applyLevelRewards } from "../features/leveling/role-rewards.js";
import { getConfig } from "../features/leveling/config.js";
import { getAntiSpamConfig } from "../features/antispam/config.js";
import { shouldCountMessage } from "../features/antispam/runtime.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { applyStreakAndComputeBonus } from "../features/leveling/streaks.js";
import { metrics } from "../obs/metrics.js";
import { getFlag, ANNOUNCE_LEVELUPS } from "../lib/global-settings.js";
import { sendChannelEmbedText } from "../lib/embeds.js";
import {
  claimMessageOnce,
  finalizeMessageAward,
  pruneLedger,
} from "../features/leveling/award-ledger.js";
import { markLeaderboardDirty } from "../features/leaderboard/rollup.js";

function shouldCount(m: Message): boolean {
  if (!m.guildId) return false;
  if (m.author.bot) return false;
  if (m.system) return false;
  if (m.webhookId) return false;
  return true;
}

export function registerMessageHandler(client: Client) {
  client.on(Events.MessageCreate, async (m) => {
    if (!shouldCount(m)) return;
    metrics.inc("msg.seen");
    const cfg = getConfig(m.guildId!);
    // channel blacklist
    if (cfg.channelBlacklist.includes(m.channelId)) return;
    // role blacklist
    const member = m.member ?? (await m.guild!.members.fetch(m.author.id));
    if (member.roles.cache.some((r) => cfg.roleBlacklist.includes(r.id))) {
      metrics.inc("msg.reject.role-blacklist");
      return;
    }
    // anti-spam filters
    if (!m.content || m.content.trim().length === 0) return;
    const asCfg = getAntiSpamConfig(m.guildId!);
    const gate = await shouldCountMessage(
      m.guildId!,
      m.channelId,
      m.author.id,
      m.content,
      Date.now(),
      {
        content: asCfg.content,
        runtime: asCfg.runtime,
      }
    );
    if (!gate.ok) {
      metrics.inc(`msg.reject.${gate.reason ?? "blocked"}`);
      return;
    }
    // idempotency: one award per message ID
    if (!claimMessageOnce(m.guildId!, m.id, m.author.id)) {
      metrics.inc("msg.reject.duplicate");
      return;
    }

    // role multiplier
    const factor = getMultiplierForRoles(
      m.guildId!,
      Array.from(member.roles.cache.keys())
    );
    const baseMin = Math.floor(cfg.xpMin * factor);
    const baseMax = Math.max(baseMin, Math.floor(cfg.xpMax * factor));
    const stop = metrics.startTimer("engine.award.msg");
    const res = await engine.awardMessageXp(
      m.guildId!,
      m.author.id,
      Date.now(),
      {
        minIntervalMs: cfg.minIntervalMs,
        xpPerMessageMin: baseMin,
        xpPerMessageMax: baseMax,
      },
      m.id
    );
    stop();
    finalizeMessageAward(m.guildId!, m.id, res.awarded);
    if (Date.now() % 120_000 < 50)
      pruneLedger(Date.now() - 30 * 24 * 60 * 60_000);
    if (res.awarded > 0) {
      metrics.inc("xp.award.msg.count");
      metrics.observe("xp.award.msg", res.awarded);
      markLeaderboardDirty(m.guildId!);
    } else {
      metrics.inc("xp.award.msg.zero");
    }
    if (res.awarded > 0) {
      const st = applyStreakAndComputeBonus(
        m.guildId!,
        m.author.id,
        res.awarded,
        Date.now()
      );
      if (st.bonus > 0) {
        const extra = await engine.awardRawXp(
          m.guildId!,
          m.author.id,
          st.bonus
        );
        if (extra.awarded > 0) markLeaderboardDirty(m.guildId!);
        if (extra.leveledUp && extra.profile.level > res.profile.level) {
          await applyLevelRewards(
            m.client,
            m.guildId!,
            m.author.id,
            extra.profile.level
          );
        }
      }
    }
    if (res.leveledUp) {
      try {
        const lvl = res.profile.level;
        const grant = await applyLevelRewards(
          m.client,
          m.guildId!,
          m.author.id,
          lvl
        );
        const roles =
          grant.granted.length > 0
            ? ` • granted: ${grant.granted.map((id) => `<@&${id}>`).join(", ")}`
            : "";
        if (getFlag(ANNOUNCE_LEVELUPS, true)) {
          await sendChannelEmbedText(
            m.channel,
            "Level up",
            `<@${m.author.id}> reached level ${lvl}${roles}`
          );
        }
        await actionLogger(m.client).logLevelUp({
          userId: m.author.id,
          level: res.profile.level,
          guildId: m.guildId!,
          channelId: m.channelId,
        });
      } catch (err) {
        console.error("level-up announce failed:", err);
      }
    }
  });
}
