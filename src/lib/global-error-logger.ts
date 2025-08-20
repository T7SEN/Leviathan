import type { Client, Channel, GuildTextBasedChannel } from "discord.js";

function pickChannelId(override?: string): string | null {
  const v =
    override ||
    process.env.ERROR_CHANNEL_ID ||
    process.env.LOG_CHANNEL_ID ||
    null;
  return v && v.length > 0 ? v : null;
}

function fmt(err: unknown, ctx: string): string {
  let body = "";
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`;
    const stack = err.stack || "";
    body = `${head}\n${stack}`;
  } else if (typeof err === "string") {
    body = err;
  } else {
    try {
      body = JSON.stringify(err);
    } catch {
      body = String(err);
    }
  }
  const prefix = `[Leviathan] ${ctx}`;
  const code = "```";
  const max = 1900;
  const clipped = body.length > max ? body.slice(0, max) + "…" : body;
  return `${prefix}\n${code}\n${clipped}\n${code}`;
}

function asGuildText(ch: Channel | null): GuildTextBasedChannel | null {
  if (!ch) return null;
  // v14 runtime type guard
  if (typeof (ch as any).isTextBased !== "function") return null;
  if (!(ch as any).isTextBased()) return null;
  // ensure it belongs to a guild so .send exists
  return "guild" in ch && (ch as any).guild
    ? (ch as GuildTextBasedChannel)
    : null;
}

export function installGlobalErrorLogger(
  client: Client,
  options?: { channelId?: string }
) {
  const channelId = pickChannelId(options?.channelId);

  async function send(content: string) {
    if (!channelId) return;
    if (!client.isReady()) return;
    try {
      const ch = await client.channels.fetch(channelId);
      const text = asGuildText(ch);
      if (!text) return;
      await text.send({ content });
    } catch (e) {
      console.error("[Leviathan] log send failed:", e);
    }
  }

  function handler(ctx: string) {
    return async (err: unknown) => {
      const msg = fmt(err, ctx);
      console.error(msg);
      await send(msg);
    };
  }

  process.on("unhandledRejection", handler("unhandledRejection"));
  process.on("uncaughtException", handler("uncaughtException"));
  client.on("error", handler("client.error"));
}
