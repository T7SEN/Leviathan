// src/lib/action-logger.ts
import type {
  Client,
  Channel,
  GuildTextBasedChannel,
  ChatInputCommandInteraction,
} from "discord.js";
import { PermissionFlagsBits, EmbedBuilder } from "discord.js";

type Outcome = "ok" | "warn" | "error" | "info";

const LOG_COLORS = {
  ok: 0x22c55e,
  info: 0x3b82f6,
  warn: 0xf59e0b,
  error: 0xef4444,
} as const;

function pickChannelId(override?: string): string | null {
  const v =
    override ||
    process.env.ACTION_LOG_CHANNEL_ID ||
    process.env.LOG_CHANNEL_ID ||
    null;
  return v && v.length > 0 ? v : null;
}

function asGuildText(ch: Channel | null): GuildTextBasedChannel | null {
  if (!ch) return null;
  // @ts-ignore runtime guard
  if (typeof (ch as any).isTextBased !== "function") return null;
  // @ts-ignore runtime guard
  if (!(ch as any).isTextBased()) return null;
  // @ts-ignore ensure guild-bound channel
  if (!(ch as any).guild) return null;
  return ch as unknown as GuildTextBasedChannel;
}

function buildLogEmbed(
  title: string,
  lines: string[],
  severity: keyof typeof LOG_COLORS = "info"
) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setColor(LOG_COLORS[severity])
    .setTimestamp();
}

function clip(s: string, max = 900) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

export class ActionLogger {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  private async pickChannel(
    overrideId?: string
  ): Promise<GuildTextBasedChannel | null> {
    const id = pickChannelId(overrideId);
    if (!id) return null;
    try {
      const ch = await this.client.channels.fetch(id).catch(() => null);
      const asText = asGuildText(ch);
      if (!asText) return null;
      const me = asText.guild.members.me;
      if (!me) return null;
      const perms = asText.permissionsFor(me);
      const canSend =
        perms?.has(
          PermissionFlagsBits.SendMessages | PermissionFlagsBits.ViewChannel
        ) === true;
      if (!canSend) return null;
      return asText;
    } catch {
      return null;
    }
  }

  async send(content: string, overrideId?: string) {
    const ch = await this.pickChannel(overrideId);
    if (!ch) return;
    try {
      await ch.send({ content });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[Leviathan] action log send failed:", e);
    }
  }

  async sendEmbed(embed: EmbedBuilder, overrideId?: string) {
    const ch = await this.pickChannel(overrideId);
    if (!ch) return;
    try {
      const me = ch.guild.members.me;
      const perms = ch.permissionsFor(me!);
      const canEmbed = perms?.has(PermissionFlagsBits.EmbedLinks) === true;
      if (canEmbed) {
        await ch.send({ embeds: [embed] });
      } else {
        const text = [
          embed.data.title ?? "Log",
          "",
          ...(embed.data.description ? [embed.data.description] : []),
        ].join("\n");
        await ch.send({ content: text });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[Leviathan] action log send failed:", e);
    }
  }

  async logLevelUp(p: {
    userId: string;
    level: number;
    guildId: string;
    channelId: string;
  }) {
    const lines = [`<@${p.userId}> → **L${p.level}**`, `in <#${p.channelId}>`];
    const embed = buildLogEmbed("Level up", lines, "ok");
    await this.sendEmbed(embed);
  }

  async logCommand(
    interaction: ChatInputCommandInteraction,
    outcome: Outcome,
    err?: unknown
  ) {
    const user = `<@${interaction.user.id}>`;
    const where = interaction.channel ? `<#${interaction.channel.id}>` : "(DM)";
    const path = `/${interaction.commandName}`;
    const isAdmin =
      interaction.memberPermissions?.has("Administrator") === true;
    const mod = isAdmin ? "admin" : "user";

    const lines: string[] = [
      `${user} ran **${path}**`,
      `in ${where} • mode=${mod} • status=${outcome}`,
    ];

    if (outcome === "error" && err) {
      const msg = err instanceof Error ? err.message : String(err);
      const short = clip(msg, 300);
      lines.push("", "```", short, "```");
    }

    const sev: Outcome = outcome === "error" ? "error" : "info";
    const embed = buildLogEmbed("Command", lines, sev);
    await this.sendEmbed(embed);
  }
}

let singleton: ActionLogger | null = null;

export function actionLogger(client: Client): ActionLogger {
  if (!singleton) singleton = new ActionLogger(client);
  return singleton;
}
