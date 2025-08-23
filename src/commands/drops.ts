// src/commands/drops.ts

import { spawnBossNow } from "../features/drops/boss.js";
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  AttachmentBuilder,
} from "discord.js";
import { makeEmbed } from "../lib/embeds.js";
import { spawnDrop } from "../features/drops/spawn.js";
import {
  getDropsConfig,
  setDropsConfig,
  resetDropsConfig,
} from "../features/drops/config.js";
import {
  getDropStats,
  topClaimers,
  getBossState,
  listClaimsSince,
} from "../features/drops/store.js";

type TierOpt = "auto" | "common" | "uncommon" | "rare" | "epic" | "legendary";
type Key =
  | "allowChannels"
  | "channelDenylist"
  | "minMessagesBeforeSpawn"
  | "channelCooldownMs"
  | "globalPerHour"
  | "globalPerDay"
  | "decayEveryMs"
  | "decayPct"
  | "applyRoleMultiplier"
  | "perUserCooldownMs"
  | "pityEnabled"
  | "pityMinMessages"
  | "pityWindowMs"
  | "pityTier"
  | "sweeperIntervalMs"
  | "dropRetentionMs"
  | "minAccountAgeMs"
  | "minGuildJoinAgeMs"
  | "maxClaimsPerMinutePerUser"
  | "maxClaimsPerHourPerUser";

const TIER_CHOICES: readonly TierOpt[] = [
  "auto",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;

function ep(i: ChatInputCommandInteraction, title: string, msg: string) {
  return i.reply({
    embeds: [makeEmbed(title, msg)],
    flags: MessageFlags.Ephemeral,
  });
}

export const data = new SlashCommandBuilder()
  .setName("drops")
  .setDescription("XP drops");
data.addSubcommand((sc) =>
  sc
    .setName("spawn")
    .setDescription("Spawn a drop in this channel (admin)")
    .addStringOption((o) =>
      o
        .setName("tier")
        .setDescription("Force a tier")
        .addChoices(
          { name: "auto", value: "auto" },
          { name: "common", value: "common" },
          { name: "uncommon", value: "uncommon" },
          { name: "rare", value: "rare" },
          { name: "epic", value: "epic" },
          { name: "legendary", value: "legendary" }
        )
    )
);
data.addSubcommand((sc) =>
  sc.setName("status").setDescription("Show drops status")
);
data.addSubcommand((sc) =>
  sc.setName("stats").setDescription("Guild drop stats (24h)")
);
data.addSubcommand((sc) =>
  sc
    .setName("export")
    .setDescription("Export claims as CSV")
    .addIntegerOption((o) =>
      o
        .setName("days")
        .setDescription("How many days back (default 7)")
        .setMinValue(1)
        .setMaxValue(90)
    )
);
data.addSubcommandGroup((g) =>
  g
    .setName("boss")
    .setDescription("Boss capsule controls")
    .addSubcommand((sc) =>
      sc.setName("status").setDescription("Show boss counters")
    )
    .addSubcommand((sc) =>
      sc.setName("spawn").setDescription("Force spawn boss (admin)")
    )
    .addSubcommand((sc) =>
      sc
        .setName("setchannel")
        .setDescription("Set boss spawn channel")
        .addStringOption((o) =>
          o
            .setName("value")
            .setDescription('"here"|"none"|id/#mention')
            .setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("set")
        .setDescription("Set boss config key")
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription(
              "bossMsgs|bossVoiceMins|bossCooldownMs|bossBaseXp|bossEnabled"
            )
            .setRequired(true)
            .addChoices(
              { name: "bossMsgs", value: "bossMsgs" },
              { name: "bossVoiceMins", value: "bossVoiceMins" },
              { name: "bossCooldownMs", value: "bossCooldownMs" },
              { name: "bossBaseXp", value: "bossBaseXp" },
              { name: "bossEnabled", value: "bossEnabled" }
            )
        )
        .addStringOption((o) =>
          o
            .setName("value")
            .setDescription("number or on/off")
            .setRequired(true)
        )
    )
);
data.addSubcommandGroup((g) =>
  g
    .setName("config")
    .setDescription("View or change drops config")
    .addSubcommand((sc) =>
      sc.setName("show").setDescription("Show current config")
    )
    .addSubcommand((sc) =>
      sc.setName("reset").setDescription("Reset to defaults")
    )
    .addSubcommand((sc) =>
      sc
        .setName("set")
        .setDescription("Set one key")
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription("Config key")
            .setRequired(true)
            .addChoices(
              { name: "allowChannels", value: "allowChannels" },
              { name: "channelDenylist", value: "channelDenylist" },
              {
                name: "minMessagesBeforeSpawn",
                value: "minMessagesBeforeSpawn",
              },
              { name: "channelCooldownMs", value: "channelCooldownMs" },
              { name: "globalPerHour", value: "globalPerHour" },
              { name: "globalPerDay", value: "globalPerDay" },
              { name: "decayEveryMs", value: "decayEveryMs" },
              { name: "decayPct", value: "decayPct" },
              { name: "applyRoleMultiplier", value: "applyRoleMultiplier" },
              { name: "perUserCooldownMs", value: "perUserCooldownMs" },
              { name: "pityEnabled", value: "pityEnabled" },
              { name: "pityMinMessages", value: "pityMinMessages" },
              { name: "pityWindowMs", value: "pityWindowMs" },
              { name: "pityTier", value: "pityTier" },
              { name: "sweeperIntervalMs", value: "sweeperIntervalMs" },
              { name: "dropRetentionMs", value: "dropRetentionMs" },
              { name: "minAccountAgeMs", value: "minAccountAgeMs" },
              { name: "minGuildJoinAgeMs", value: "minGuildJoinAgeMs" },
              {
                name: "maxClaimsPerMinutePerUser",
                value: "maxClaimsPerMinutePerUser",
              },
              {
                name: "maxClaimsPerHourPerUser",
                value: "maxClaimsPerHourPerUser",
              }
            )
        )
        .addStringOption((o) =>
          o
            .setName("value")
            .setDescription(
              'Value. allow/channel lists: "any"|"none"|"here"|ids/mentions'
            )
            .setRequired(true)
        )
    )
);

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId || !i.channel) {
    await ep(i, "Drops", "Guild channel only.");
    return;
  }

  const group = i.options.getSubcommandGroup(false);
  const sub = i.options.getSubcommand(true);

  // /drops spawn
  if (!group && sub === "spawn") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await ep(i, "Drops", "Need Manage Server.");
      return;
    }
    const t = (i.options.getString("tier") ?? "auto") as TierOpt;
    const force: TierOpt = TIER_CHOICES.includes(t) ? t : "auto";
    await spawnDrop(i.channel, i.guildId, { forceTier: force });
    await ep(i, "Drops", `Spawned (${force}).`);
    return;
  }

  // execute: handle 'stats'
  if (!group && sub === "stats") {
    const s = getDropStats(i.guildId);
    const openLines = Object.keys(s.openByTier).length
      ? Object.entries(s.openByTier)
          .map(([k, v]) => `• ${k}: ${v}`)
          .join("\n")
      : "none";

    const top = topClaimers(i.guildId, Date.now() - 24 * 60 * 60_000, 5);
    const topLines = top.length
      ? top.map((x) => `• <@${x.userId}>: ${x.count}`).join("\n")
      : "none";

    const body = [
      `Open total: ${s.openTotal}`,
      `Open by tier:\n${openLines}`,
      `Claimed last 24h: ${s.claimed24h}`,
      `Expired last 24h: ${s.expired24h}`,
      `Top claimers (24h):\n${topLines}`,
    ].join("\n");

    await ep(i, "Drops • Stats", body);
    return;
  }

  // inside execute()
  if (group === "boss" && sub === "status") {
    const cfg = getDropsConfig(i.guildId);
    const s = getBossState(i.guildId);
    const body = [
      `enabled: ${cfg.bossEnabled}`,
      `msgs: ${s.msg} / ${cfg.bossMsgs}`,
      `voiceMins: ${s.vmin} / ${cfg.bossVoiceMins}`,
      `cooldownMs: ${cfg.bossCooldownMs}`,
      `channel: ${cfg.bossChannelId ? `<#${cfg.bossChannelId}>` : "auto"}`,
      `baseXp: ${cfg.bossBaseXp}`,
    ].join("\n");
    await ep(i, "Drops • Boss status", body);
    return;
  }

  if (group === "boss" && sub === "spawn") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await ep(i, "Drops", "Need Manage Server.");
      return;
    }
    const ok = await spawnBossNow(i.client, i.guildId!); // no conditions
    await ep(i, "Drops • Boss", ok ? "Spawned." : "No eligible channel.");
    return;
  }

  if (group === "boss" && sub === "setchannel") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await ep(i, "Drops", "Need Manage Server.");
      return;
    }
    const raw = i.options.getString("value", true).trim();
    let val: string | null;
    if (/^(none|null)$/i.test(raw)) val = null;
    else if (/^here$/i.test(raw)) val = i.channelId;
    else {
      const id = raw.replace(/[<#>]/g, "");
      if (!/^\d{5,}$/.test(id)) {
        await ep(i, "Drops • Boss", "Invalid channel id.");
        return;
      }
      val = id;
    }
    const next = setDropsConfig(i.guildId, { bossChannelId: val });
    await ep(
      i,
      "Drops • Boss",
      `channel → ${next.bossChannelId ? `<#${next.bossChannelId}>` : "auto"}`
    );
    return;
  }

  if (group === "boss" && sub === "set") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await ep(i, "Drops", "Need Manage Server.");
      return;
    }
    type BossKey =
      | "bossMsgs"
      | "bossVoiceMins"
      | "bossCooldownMs"
      | "bossBaseXp"
      | "bossEnabled";
    const key = i.options.getString("key", true) as BossKey;
    const raw = i.options.getString("value", true);

    const patch: any = {};
    if (key === "bossEnabled") {
      patch.bossEnabled = /^(1|true|on|yes)$/i.test(raw);
    } else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        await ep(i, "Drops • Boss", "Value must be a non-negative number.");
        return;
      }
      patch[key] = Math.floor(v);
    }

    const next = setDropsConfig(i.guildId, patch);
    const body = [
      `enabled: ${next.bossEnabled}`,
      `msgs: ${next.bossMsgs}`,
      `voiceMins: ${next.bossVoiceMins}`,
      `cooldownMs: ${next.bossCooldownMs}`,
      `channel: ${next.bossChannelId ? `<#${next.bossChannelId}>` : "auto"}`,
      `baseXp: ${next.bossBaseXp}`,
    ].join("\n");
    await ep(i, "Drops • Boss", body);
    return;
  }

  // /drops status
  if (!group && sub === "status") {
    await ep(i, "Drops", "Active: auto spawns enabled.");
    return;
  }

  // /drops config show
  if (group === "config" && sub === "show") {
    const cfg = getDropsConfig(i.guildId);
    const lines = [
      `allowChannels: ${
        cfg.allowChannels
          ? cfg.allowChannels.map((id) => `<#${id}>`).join(", ")
          : "any"
      }`,
      `channelDenylist: ${
        cfg.channelDenylist
          ? cfg.channelDenylist.map((id) => `<#${id}>`).join(", ")
          : "none"
      }`,
      `minMessagesBeforeSpawn: ${cfg.minMessagesBeforeSpawn}`,
      `channelCooldownMs: ${cfg.channelCooldownMs}`,
      `globalPerHour: ${cfg.globalPerHour}`,
      `globalPerDay: ${cfg.globalPerDay}`,
      `decayEveryMs: ${cfg.decayEveryMs}`,
      `decayPct: ${cfg.decayPct}`,
      `applyRoleMultiplier: ${cfg.applyRoleMultiplier}`,
      `perUserCooldownMs: ${cfg.perUserCooldownMs}`,
      `pityEnabled: ${cfg.pityEnabled}`,
      `pityMinMessages: ${cfg.pityMinMessages}`,
      `pityWindowMs: ${cfg.pityWindowMs}`,
      `pityTier: ${cfg.pityTier}`,
      `sweeperIntervalMs: ${cfg.sweeperIntervalMs}`,
      `dropRetentionMs: ${cfg.dropRetentionMs}`,
      `minAccountAgeMs: ${cfg.minAccountAgeMs}`,
      `minGuildJoinAgeMs: ${cfg.minGuildJoinAgeMs}`,
      `maxClaimsPerMinutePerUser: ${cfg.maxClaimsPerMinutePerUser}`,
      `maxClaimsPerHourPerUser: ${cfg.maxClaimsPerHourPerUser}`,
    ].join("\n");
    await ep(i, "Drops • Config", lines);
    return;
  }

  // /drops config reset
  if (group === "config" && sub === "reset") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await ep(i, "Drops", "Need Manage Server.");
      return;
    }
    resetDropsConfig(i.guildId);
    const cfg = getDropsConfig(i.guildId);
    await ep(
      i,
      "Drops • Config",
      "Reset to defaults.\n" +
        `minMessagesBeforeSpawn: ${cfg.minMessagesBeforeSpawn}\n` +
        `channelCooldownMs: ${cfg.channelCooldownMs}`
    );
    return;
  }

  if (!group && sub === "export") {
    const days = i.options.getInteger("days") ?? 7;
    const since = Date.now() - days * 24 * 60 * 60_000;
    const rows = listClaimsSince(i.guildId, since);

    // CSV header
    let csv = "userId,dropId,claimedAt\n";
    for (const r of rows) {
      const ts = new Date(r.claimedMs).toISOString();
      csv += `${r.userId},${r.dropId},${ts}\n`;
    }
    const buf = Buffer.from(csv, "utf8");
    const file = new AttachmentBuilder(buf, {
      name: `drops-claims-${days}d.csv`,
    });

    await i.reply({
      embeds: [makeEmbed("Drops • Export", `Rows: ${rows.length}`)],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // /drops config set
  if (group === "config" && sub === "set") {
    const me = await i.guild!.members.fetch(i.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await ep(i, "Drops", "Need Manage Server.");
      return;
    }

    const key = i.options.getString("key", true) as Key;
    const raw = i.options.getString("value", true);
    const patch: Partial<ReturnType<typeof getDropsConfig>> = {};

    if (key === "allowChannels" || key === "channelDenylist") {
      const v = raw.trim();
      if (/^(any|none|null|empty)$/i.test(v)) {
        (patch as any)[key] = null;
      } else if (/^here$/i.test(v)) {
        (patch as any)[key] = [i.channelId];
      } else {
        const ids = v
          .split(",")
          .map((s) => s.trim())
          .map((s) => s.replace(/[<#>]/g, ""))
          .filter((s) => /^\d{5,}$/.test(s));
        if (ids.length === 0) {
          await ep(i, "Drops • Config", "No valid channel IDs.");
          return;
        }
        (patch as any)[key] = ids;
      }
    } else if (key === "pityEnabled" || key === "applyRoleMultiplier") {
      (patch as any)[key] = /^(1|true|on|yes)$/i.test(raw);
    } else if (key === "pityTier") {
      if (
        !(
          ["common", "uncommon", "rare", "epic", "legendary"] as const
        ).includes(raw as any)
      ) {
        await ep(i, "Drops • Config", "pityTier invalid.");
        return;
      }
      patch.pityTier = raw as any;
    } else if (key === "decayPct") {
      const v = Number(raw);
      if (!Number.isFinite(v) || v <= 0 || v >= 1) {
        await ep(i, "Drops • Config", "decayPct must be 0–1 (e.g., 0.05).");
        return;
      }
      patch.decayPct = v;
    } else if (
      key === "minMessagesBeforeSpawn" ||
      key === "channelCooldownMs" ||
      key === "globalPerHour" ||
      key === "globalPerDay" ||
      key === "decayEveryMs" ||
      key === "perUserCooldownMs" ||
      key === "pityMinMessages" ||
      key === "pityWindowMs" ||
      key === "sweeperIntervalMs" ||
      key === "dropRetentionMs" ||
      key === "minAccountAgeMs" ||
      key === "minGuildJoinAgeMs" ||
      key === "maxClaimsPerMinutePerUser" ||
      key === "maxClaimsPerHourPerUser"
    ) {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        await ep(i, "Drops • Config", "Value must be a non-negative number.");
        return;
      }
      (patch as any)[key] = Math.floor(v);
    } else {
      await ep(i, "Drops • Config", "Unknown key.");
      return;
    }

    const next = setDropsConfig(i.guildId, patch);
    const lines = [
      "Updated.",
      `allowChannels: ${
        next.allowChannels
          ? next.allowChannels.map((id) => `<#${id}>`).join(", ")
          : "any"
      }`,
      `channelDenylist: ${
        next.channelDenylist
          ? next.channelDenylist.map((id) => `<#${id}>`).join(", ")
          : "none"
      }`,
      `minMessagesBeforeSpawn: ${next.minMessagesBeforeSpawn}`,
      `channelCooldownMs: ${next.channelCooldownMs}`,
      `globalPerHour: ${next.globalPerHour}`,
      `globalPerDay: ${next.globalPerDay}`,
      `decayEveryMs: ${next.decayEveryMs}`,
      `decayPct: ${next.decayPct}`,
      `applyRoleMultiplier: ${next.applyRoleMultiplier}`,
      `perUserCooldownMs: ${next.perUserCooldownMs}`,
      `pityEnabled: ${next.pityEnabled}`,
      `pityMinMessages: ${next.pityMinMessages}`,
      `pityWindowMs: ${next.pityWindowMs}`,
      `pityTier: ${next.pityTier}`,
      `sweeperIntervalMs: ${next.sweeperIntervalMs}`,
      `dropRetentionMs: ${next.dropRetentionMs}`,
      `minAccountAgeMs: ${next.minAccountAgeMs}`,
      `minGuildJoinAgeMs: ${next.minGuildJoinAgeMs}`,
      `maxClaimsPerMinutePerUser: ${next.maxClaimsPerMinutePerUser}`,
      `maxClaimsPerHourPerUser: ${next.maxClaimsPerHourPerUser}`,
    ].join("\n");

    await ep(i, "Drops • Config", lines);
    return;
  }
}
