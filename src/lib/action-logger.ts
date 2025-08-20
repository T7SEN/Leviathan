import type {
  Client,
  Channel,
  GuildTextBasedChannel,
  ChatInputCommandInteraction,
} from "discord.js";
import { PermissionFlagsBits } from "discord.js";

function pickChannelId(override?: string): string | null {
  const v = override || process.env.ACTION_LOG_CHANNEL_ID || null;
  return v && v.length > 0 ? v : null;
}

function asGuildText(ch: Channel | null): GuildTextBasedChannel | null {
  if (!ch) return null;
  if (typeof (ch as any).isTextBased !== "function") return null;
  if (!(ch as any).isTextBased()) return null;
  return "guild" in ch && (ch as any).guild
    ? (ch as GuildTextBasedChannel)
    : null;
}

function clip(s: string, n = 500): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function isMod(i: ChatInputCommandInteraction): boolean {
  const p = i.memberPermissions;
  if (!p) return false;
  const flags = [
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
  ];
  return flags.some((f) => p.has(f));
}

class ActionLogger {
  private client: Client;
  private channelId: string | null;

  constructor(client: Client, channelId?: string) {
    this.client = client;
    this.channelId = pickChannelId(channelId);
  }

  private async send(content: string) {
    if (!this.channelId) return;
    if (!this.client.isReady()) return;
    try {
      const ch = await this.client.channels.fetch(this.channelId);
      const text = asGuildText(ch);
      if (!text) return;
      await text.send({ content });
    } catch (e) {
      // console fallback
      console.error("[Leviathan] action log send failed:", e);
    }
  }

  async logLevelUp(p: {
    userId: string;
    level: number;
    guildId: string;
    channelId: string;
  }) {
    const msg = `[level-up] <@${p.userId}> → L${p.level} in <#${p.channelId}>`;
    await this.send(msg);
  }

  async logCommand(
    i: ChatInputCommandInteraction,
    outcome: "ok" | "error",
    err?: unknown
  ) {
    let sub: string | null = null;
    try {
      sub = i.options.getSubcommand(false);
    } catch {
      sub = null;
    }
    const path = `/${i.commandName}${sub ? " " + sub : ""}`;
    const who = `${i.user.tag} (${i.user.id})`;
    const where = i.channelId ? `<#${i.channelId}>` : "(no-channel)";
    const mod = isMod(i) ? "yes" : "no";
    let extra = "";
    if (outcome === "error") {
      const msg = err instanceof Error ? err.message : String(err ?? "");
      extra = ` | err=${clip(msg)}`;
    }
    await this.send(
      `[cmd] ${who} ran ${path} in ${where} | mod=${mod} | ${outcome}${extra}`
    );
  }
}

let singleton: ActionLogger | null = null;

export function actionLogger(client: Client): ActionLogger {
  if (!singleton) singleton = new ActionLogger(client);
  return singleton;
}
