// src/commands/drops.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { makeEmbed } from "../lib/embeds.js";
import { spawnDrop } from "../features/drops/spawn.js";
import {
  getDropsConfig,
  setDropsConfig,
  resetDropsConfig,
} from "../features/drops/config.js";

type TierOpt = "auto" | "common" | "uncommon" | "rare" | "epic" | "legendary";
type Key =
  | "allowChannels"
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
  | "pityTier";

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
  .setDescription("XP drops")
  .addSubcommand((sc) =>
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
  )
  .addSubcommand((sc) =>
    sc.setName("status").setDescription("Show drops status")
  )
  .addSubcommandGroup((g) =>
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
                { name: "pityTier", value: "pityTier" }
              )
          )
          .addStringOption((o) =>
            o
              .setName("value")
              .setDescription(
                'Value. allowChannels: "any"|"here"|"none"|ids/mentions'
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

    if (key === "allowChannels") {
      const v = raw.trim();
      if (/^(any|none|null)$/i.test(v)) {
        patch.allowChannels = null;
      } else if (/^here$/i.test(v)) {
        patch.allowChannels = [i.channelId];
      } else {
        const ids = v
          .split(",")
          .map((s) => s.trim())
          .map((s) => s.replace(/[<#>]/g, ""))
          .filter((s) => /^\d{5,}$/.test(s));
        if (ids.length === 0) {
          await ep(
            i,
            "Drops • Config",
            "No valid channel IDs. Use #mentions or ids."
          );
          return;
        }
        patch.allowChannels = ids;
      }
    } else if (key === "pityEnabled" || key === "applyRoleMultiplier") {
      patch[key] = /^(1|true|on|yes)$/i.test(raw) as any;
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
      key === "pityWindowMs"
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
    ].join("\n");

    await ep(i, "Drops • Config", lines);
    return;
  }
}
