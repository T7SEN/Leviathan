// src/lib/global-error-logger.ts
import type { Client, Channel, GuildTextBasedChannel } from "discord.js";
import { PermissionFlagsBits, EmbedBuilder } from "discord.js";

const ERR_COLOR = 0xef4444;

function pickChannelId(override?: string): string | null {
  const v =
    override ||
    process.env.ERROR_CHANNEL_ID ||
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

function clip(s: string, max = 1500) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 3)}...`;
}

function fmt(err: unknown, ctx: string): string {
  let body = "";
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`;
    const stack = err.stack || "";
    if (stack.includes(err.message)) {
      body = stack;
    } else {
      body = `${head}\n${stack}`;
    }
  } else {
    body = String(err);
  }
  const lines = [`where=${ctx}`, "", clip(body)];
  return lines.join("\n");
}

function buildErrorEmbed(ctx: string, message: string) {
  return new EmbedBuilder()
    .setTitle("Unhandled error")
    .setDescription(
      ["**context:** " + ctx, "", "```", message, "```"].join("\n")
    )
    .setColor(ERR_COLOR)
    .setTimestamp();
}

async function send(
  client: Client,
  payload: string | { embeds: EmbedBuilder[] },
  overrideId?: string
) {
  const id = pickChannelId(overrideId);
  if (!id) return;
  const ch = asGuildText(await client.channels.fetch(id).catch(() => null));
  if (!ch) return;
  const me = ch.guild.members.me;
  const perms = ch.permissionsFor(me!);
  const canEmbed = perms?.has(PermissionFlagsBits.EmbedLinks) === true;
  try {
    if (typeof payload === "string") {
      await ch.send({ content: payload });
    } else {
      if (canEmbed) {
        await ch.send(payload);
      } else {
        const e =
          Array.isArray(payload.embeds) && payload.embeds.length > 0
            ? payload.embeds[0]
            : null;
        const title = e?.data?.title ?? "Error";
        const desc = e?.data?.description ?? "";
        const text = [title, "", desc].join("\n");
        await ch.send({ content: text });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[Leviathan] error log send failed:", err);
  }
}

export function installGlobalErrorLogger(client: Client) {
  function handler(ctx: string) {
    return async (err: unknown) => {
      const message = fmt(err, ctx);
      // eslint-disable-next-line no-console
      console.error(message);
      const embed = buildErrorEmbed(ctx, message);
      await send(client, { embeds: [embed] });
    };
  }

  process.on("unhandledRejection", handler("unhandledRejection"));
  process.on("uncaughtException", handler("uncaughtException"));
  client.on("error", handler("client.error"));
}
