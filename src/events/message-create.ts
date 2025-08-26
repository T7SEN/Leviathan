import { incBoss } from "../features/drops/store.js";
import { trySpawnBoss } from "../features/drops/boss.js";
import { onEligibleMessage } from "../features/drops/scheduler.js";
import {
  checkActiveTrio,
  checkMarathonMixMonthly,
} from "../features/challenges/weekly.js";
import { logXpEvent } from "../features/leveling/xp-journal.js";
import {
  Client,
  Events,
  type Message,
  AttachmentBuilder,
  EmbedBuilder,
} from "discord.js";
import { engine } from "../features/leveling/service.js";
import { actionLogger } from "../lib/action-logger.js";
import { applyLevelRewards } from "../features/leveling/role-rewards.js";
import { getConfig } from "../features/leveling/config.js";
import { getAntiSpamConfig } from "../features/antispam/config.js";
import { shouldCountMessage } from "../features/antispam/runtime.js";
import { getMultiplierForRoles } from "../features/leveling/role-multipliers.js";
import { applyStreakAndComputeBonus } from "../features/leveling/streaks.js";
import { getActiveSeasonId } from "../features/seasons/store.js";
import { metrics } from "../obs/metrics.js";
import { enqueueMessageAward } from "../features/maintenance/queue.js";
import {
  getFlag,
  ANNOUNCE_LEVELUPS,
  ENABLE_RANKCARDS,
  MAINTENANCE_MODE,
} from "../lib/global-settings.js";
import { sendChannelEmbedText } from "../lib/embeds.js";
import { renderRankCard } from "../features/rankcard/renderer.js";
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

    // feed auto-spawn scheduler on eligible messages
    onEligibleMessage(m.client, m.guildId!, m.channelId, m.author.id).catch(
      () => {}
    );

    // maintenance: enqueue and exit
    if (getFlag(MAINTENANCE_MODE, false)) {
      const factor = getMultiplierForRoles(
        m.guildId!,
        Array.from(member.roles.cache.keys())
      );
      const baseMin = Math.floor(cfg.xpMin * factor);
      const baseMax = Math.max(baseMin, Math.floor(cfg.xpMax * factor));
      enqueueMessageAward(
        m.guildId!,
        m.author.id,
        m.id,
        {
          minIntervalMs: cfg.minIntervalMs,
          xpPerMessageMin: baseMin,
          xpPerMessageMax: baseMax,
        },
        Date.now()
      );
      metrics.inc("maint.queue.msg");
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
      logXpEvent({
        guildId: m.guildId!,
        userId: m.author.id,
        createdMs: Date.now(),
        source: "msg",
        amount: res.awarded,
        leveledUp: res.leveledUp,
        levelAfter: res.profile.level,
        qty: 1,
      });
      await checkActiveTrio(m.client, m.guildId!, m.author.id, Date.now());
      await checkMarathonMixMonthly(
        m.client,
        m.guildId!,
        m.author.id,
        Date.now()
      );
      incBoss(m.guildId!, "msg", 1);
      trySpawnBoss(m.client, m.guildId!).catch(() => {});
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
        if (extra.awarded > 0) {
          markLeaderboardDirty(m.guildId!);
          logXpEvent({
            guildId: m.guildId!,
            userId: m.author.id,
            createdMs: Date.now(),
            source: "msg",
            amount: extra.awarded,
            leveledUp: extra.leveledUp,
            levelAfter: extra.profile.level,
            qty: 1,
          });
        }
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
        const rcDefault = (process.env.ENABLE_RANKCARDS ?? "1") !== "0";
        if (getFlag(ANNOUNCE_LEVELUPS, true)) {
          if (getFlag(ENABLE_RANKCARDS, rcDefault)) {
            const sid = getActiveSeasonId(m.guildId!);
            const png = await renderRankCard({
              guildId: m.guildId!,
              user: m.author,
              level: lvl,
              totalXp: res.profile.xp,
              rank: 1, // rank not critical for announce
              seasonId: sid > 0 ? sid : null,
              seasonIconUrl: process.env.RANKCARD_SEASON_ICON_URL || null,
            });
            const file = new AttachmentBuilder(png, { name: "rank.png" });
            const embed = new EmbedBuilder()
              .setTitle("Level up")
              .setDescription(`<@${m.author.id}> reached level ${lvl}${roles}`)
              .setImage("attachment://rank.png")
              .setColor(0x5865f2);
            await (m.channel as any).send({ embeds: [embed], files: [file] });
          } else {
            await sendChannelEmbedText(
              m.channel,
              "Level up",
              `<@${m.author.id}> reached level ${lvl}${roles}`
            );
          }
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
