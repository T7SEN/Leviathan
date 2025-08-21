import {
  DiscordAPIError,
  type TextBasedChannel,
  type GuildMember,
  type Role,
} from "discord.js";
import { metrics } from "../obs/metrics.js";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

const NET_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

function retryAfterFromError(err: any): number {
  const raw = err?.rawError ?? {};
  const secA = Number(raw.retry_after ?? raw.retryAfter ?? 0);

  const h = err?.headers ?? err?.response?.headers;
  const get = (k: string) =>
    typeof h?.get === "function" ? h.get(k) : h?.[k] ?? h?.[k.toLowerCase()];
  const secB = Number(get?.("x-ratelimit-reset-after") ?? 0);
  const secC = Number(get?.("retry-after") ?? 0);

  const sec = Math.max(secA || 0, secB || 0, secC || 0);
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
}

function classify(err: any): {
  type: "ratelimit" | "server" | "network" | "fatal";
  waitMs?: number;
} {
  if (err instanceof DiscordAPIError) {
    if (err.status === 429) {
      return { type: "ratelimit", waitMs: retryAfterFromError(err) };
    }
    if (err.status >= 500) return { type: "server" };
    return { type: "fatal" };
  }
  if (NET_CODES.has(err?.code)) return { type: "network" };
  if (/AbortError|FetchError/i.test(String(err?.name ?? ""))) {
    return { type: "network" };
  }
  return { type: "fatal" };
}

function jitter(attempt: number): number {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

export async function withDiscordRetry<T>(
  op: string,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const out = await fn();
      if (attempt > 0) metrics.inc(`retry.success`);
      return out;
    } catch (err: any) {
      lastErr = err;
      const c = classify(err);
      if (c.type === "fatal") throw err;

      let wait =
        c.type === "ratelimit" && c.waitMs ? c.waitMs : jitter(attempt);
      if (wait <= 0) wait = jitter(attempt);

      metrics.inc(`retry.hit.${c.type}`);
      metrics.observe("retry.backoff.ms", wait);
      metrics.inc(`retry.attempts`);
      if (attempt === MAX_ATTEMPTS - 1) break;
      await sleep(wait);
      continue;
    }
  }
  throw lastErr;
}

/* High-level helpers */

export async function safeSend(ch: TextBasedChannel, payload: any) {
  if (!("send" in ch)) return;
  const sender = ch as unknown as {
    send: (opts: any) => Promise<unknown>;
  };
  return withDiscordRetry("channel.send", () => sender.send(payload));
}

export async function safeAddRole(
  member: GuildMember,
  role: Role,
  reason?: string
) {
  return withDiscordRetry("member.roles.add", () =>
    member.roles.add(role, reason)
  );
}

export async function safeRemoveRoles(
  member: GuildMember,
  roles: readonly (string | Role)[],
  reason?: string
) {
  return withDiscordRetry("member.roles.remove", () =>
    member.roles.remove(roles as any, reason)
  );
}
