import chokidar from "chokidar";
import { spawn } from "node:child_process";
import path from "node:path";

function runDeploy(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.resolve("scripts/deploy-commands.ts");
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`deploy exit ${code}`));
    });
  });
}

let queued = false;
let running = false;

async function trigger() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    await runDeploy();
  } catch (err) {
    console.error("[watch] deploy failed:", err);
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void trigger();
    }
  }
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function main() {
  console.log("[watch] watching src/commands");
  await trigger(); // initial deploy
  const watcher = chokidar.watch("src/commands/**/*.{ts,js}", {
    ignoreInitial: true,
  });
  const debounced = debounce(trigger, 800);
  watcher
    .on("add", debounced)
    .on("change", debounced)
    .on("unlink", debounced)
    .on("error", (err) => {
      console.error("[watch] error:", err);
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
