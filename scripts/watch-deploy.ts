import chokidar from "chokidar";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const deployTs = path.resolve(here, "./deploy-commands.ts");

function tsxLoaderArgs(): string[] {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20 ? ["--import", "tsx"] : ["--loader", "tsx"];
}

async function resolveWatchGlobs(): Promise<string[]> {
  const dist = path.resolve(here, "../dist/src/commands");
  const src = path.resolve(here, "../src/commands");
  const globs: string[] = [];
  try {
    if ((await fs.stat(dist)).isDirectory())
      globs.push(`${dist}/**/*.js`, `${dist}/**/*.json`);
  } catch {}
  try {
    if ((await fs.stat(src)).isDirectory())
      globs.push(`${src}/**/*.ts`, `${src}/**/*.json`);
  } catch {}
  if (globs.length === 0) globs.push(`${src}/**/*.ts`, `${src}/**/*.json`);
  return globs;
}

let running = false,
  queued = false;
function runDeploy() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const child = spawn(process.execPath, [...tsxLoaderArgs(), deployTs], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    running = false;
    if (queued) {
      queued = false;
      runDeploy();
    }
    if (code !== 0) console.error(`[deploy] exit ${code}`);
  });
  child.on("error", (e) => {
    running = false;
    console.error("[deploy] spawn error:", e);
  });
}

(async () => {
  const globs = await resolveWatchGlobs();
  console.log("[watch] globs:", globs.join(", "));

  const watcher = chokidar.watch(globs, {
    ignoreInitial: true, // prevent duplicate deploy on startup
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  });

  let bootDeployed = false;
  watcher
    .on("ready", () => {
      if (!bootDeployed) {
        bootDeployed = true;
        console.log("[watch] ready → initial deploy");
        runDeploy();
      }
    })
    .on("add", runDeploy)
    .on("change", runDeploy)
    .on("unlink", runDeploy)
    .on("error", (e) => console.error("[watch] error:", e));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
