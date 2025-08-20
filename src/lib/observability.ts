import type { Client, TextBasedChannel } from "discord.js";
import { metrics } from "../obs/metrics.js";

function safeSend(ch: TextBasedChannel | null, msg: string): void {
  if (!ch || !("send" in ch)) return;
  try {
    ch.send({ content: msg });
  } catch {}
}

async function fetchChannel(
  client: Client,
  id: string | undefined
): Promise<TextBasedChannel | null> {
  if (!id) return null;
  try {
    const ch = await client.channels.fetch(id);
    return ch && ch.isTextBased() ? ch : null;
  } catch {
    return null;
  }
}

export function installObservability(client: Client) {
  // process-level error hooks
  const onErr = (e: unknown) => {
    metrics.inc("errors.unhandled");
    metrics.event("error");
  };
  process.on("unhandledRejection", onErr);
  process.on("uncaughtException", onErr);

  // periodic alerts
  const chanId =
    process.env.METRICS_ALERT_CHANNEL_ID ||
    process.env.ERROR_LOG_CHANNEL_ID ||
    "";
  const threshold = Number(process.env.METRICS_ERR_RATE_PER_MIN || "5");
  const intervalMs = 60_000;

  let chan: TextBasedChannel | null = null;

  client.once("ready", async () => {
    chan = await fetchChannel(client, chanId);
  });

  setInterval(() => {
    const rate = metrics.rate("error", 60_000) * 60; // per minute
    if (rate > threshold && chan) {
      const snap = metrics.snapshot().counters as any;
      const msg =
        `Error rate high: ${rate.toFixed(2)}/min ` +
        `(threshold ${threshold}/min). ` +
        `totals=${JSON.stringify(snap).slice(0, 300)}`;
      safeSend(chan, msg);
    }
  }, intervalMs);
}
