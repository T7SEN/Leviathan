import { metrics } from "../obs/metrics.js";

type Task = () => void;

const MAX_QUEUE = Number(process.env.DB_WRITE_MAX_QUEUE || "1000"); // drop when exceeded
const BUSY_RETRIES = Number(process.env.DB_WRITE_BUSY_RETRIES || "6");
const RETRY_BASE_MS = Number(process.env.DB_WRITE_RETRY_BASE_MS || "8"); // 8,16,32,...

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

class WriteQueue {
  private q: Array<{
    fn: Task;
    resolve: () => void;
    reject: (e: any) => void;
  }> = [];
  private running = false;

  size() {
    return this.q.length;
  }

  async push(fn: Task): Promise<void> {
    if (this.q.length >= MAX_QUEUE) {
      metrics.inc("db.queue.shed");
      return Promise.resolve(); // shed silently (by design)
    }
    return new Promise((resolve, reject) => {
      this.q.push({ fn, resolve, reject });
      metrics.observe("db.queue.len", this.q.length);
      if (!this.running) this.run().catch(() => {});
    });
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.q.length) {
        const item = this.q.shift()!;
        const stop = metrics.startTimer("db.write");
        let ok = false;
        let attempt = 0;
        // retry on busy/locked with exponential backoff
        while (!ok) {
          try {
            item.fn();
            ok = true;
            item.resolve();
          } catch (e: any) {
            const code = e?.code || "";
            const busy = code === "SQLITE_BUSY" || code === "SQLITE_LOCKED";
            if (!busy || attempt >= BUSY_RETRIES) {
              metrics.inc("db.write.fail");
              item.reject(e);
              break;
            }
            attempt += 1;
            metrics.inc("db.write.retry");
            await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
          }
        }
        stop();
        metrics.event("db.write.done");
      }
    } finally {
      this.running = false;
    }
  }
}

export const writeQueue = new WriteQueue();
