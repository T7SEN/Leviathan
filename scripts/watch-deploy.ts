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
let ready = false;

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
  console.log("[watch] watching dir: src/commands (recursive)");
  const watcher = chokidar.watch("src/commands", {
    persistent: true,
    ignoreInitial: false, // gate with ready
    depth: 99,
    ignored: ["**/*.d.ts", "**/*.map", "**/node_modules/**"],
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 120 },
  });
  const debounced = debounce(trigger, 700);
  const onFile = (evt: string) => (file: string) => {
    if (!ready) return;
    const lower = file.toLowerCase();
    if (!(lower.endsWith(".ts") || lower.endsWith(".js"))) return;
    console.log(`[watch] ${evt}: ${file}`);
    debounced();
  };
  const onDir = (evt: string) => (dir: string) => {
    if (!ready) return;
    console.log(`[watch] ${evt}: ${dir}`);
    debounced();
  };
  watcher
    .on("add", onFile("add"))
    .on("change", onFile("change"))
    .on("unlink", onFile("unlink"))
    .on("addDir", onDir("addDir"))
    .on("unlinkDir", onDir("unlinkDir"))
    .on("error", (err) => console.error("[watch] error:", err))
    .on("ready", async () => {
      ready = true;
      console.log("[watch] ready → initial deploy");
      await trigger();
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
