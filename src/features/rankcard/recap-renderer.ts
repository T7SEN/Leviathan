import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { User } from "discord.js";
import path from "node:path";
import fs from "node:fs";
import { getRankStyle } from "./style.js";
import { levelFromTotalXp } from "../leveling/engine.js";

try {
  const REG =
    process.env.RANKCARD_FONT_REGULAR ?? "assets/fonts/NotoSans-Regular.ttf";
  const BLD =
    process.env.RANKCARD_FONT_BOLD ?? "assets/fonts/NotoSans-Bold.ttf";
  GlobalFonts.registerFromPath(REG, "Noto Sans");
  GlobalFonts.registerFromPath(BLD, "Noto Sans Bold");
} catch {}

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

function normalizeSrc(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  const p = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
  return fs.existsSync(p) ? p : src;
}

async function loadAny(src?: string | null): Promise<LoadedImage | null> {
  if (!src) return null;
  try {
    return await loadImage(normalizeSrc(src));
  } catch {
    return null;
  }
}

export type RecapTop = {
  user: User;
  xp: number;
  level: number;
  rank: number;
};

export async function renderSeasonRecap(p: {
  guildId: string;
  seasonLabel: string;
  guildIconUrl?: string | null;
  top3: RecapTop[];
  me: {
    user: User;
    rank: number;
    xp: number;
    level: number;
    msgCount: number;
    voiceMin: number;
  };
}) {
  const style = getRankStyle(p.guildId);
  const W = 1024,
    H = 512;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // bg
  ctx.fillStyle = style.theme === "light" ? "#f3f4f6" : "#0b0f1a";
  ctx.fillRect(0, 0, W, H);
  const bg = await loadAny(style.backgroundUrl);
  if (bg) {
    ctx.globalAlpha = 0.3;
    ctx.drawImage(bg as any, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  const fg = style.theme === "light" ? "#111827" : "#f9fafb";
  const sub = style.theme === "light" ? "#374151" : "#9ca3af";
  const accent = "#5865f2";

  // header
  const gicon = await loadAny(p.guildIconUrl ?? null);
  if (gicon) {
    const S = 72;
    ctx.save();
    ctx.beginPath();
    ctx.arc(36 + S / 2, 36 + S / 2, S / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(gicon as any, 36, 36, S, S);
    ctx.restore();
  }
  ctx.fillStyle = fg;
  ctx.font = 'bold 40px "Noto Sans","Segoe UI",Arial';
  ctx.fillText("Season Recap", 128, 80);
  ctx.font = '24px "Noto Sans","Segoe UI",Arial';
  ctx.fillStyle = sub;
  ctx.fillText(p.seasonLabel, 128, 112);

  // top 3
  const slotW = 300,
    slotH = 160,
    startX = 64,
    startY = 160,
    gap = 24;
  for (let idx = 0; idx < Math.min(3, p.top3.length); idx += 1) {
    const t = p.top3[idx]!;
    const x = startX + idx * (slotW + gap);
    const y = startY;

    // card
    ctx.fillStyle = style.theme === "light" ? "#e5e7eb" : "#111827";
    ctx.beginPath();
    ctx.roundRect(x, y, slotW, slotH, 16);
    ctx.fill();

    // avatar
    const av = await loadAny(
      t.user.displayAvatarURL({ extension: "png", size: 128 })
    );
    const AV = 72;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + 24 + AV / 2, y + 24 + AV / 2, AV / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (av) ctx.drawImage(av as any, x + 24, y + 24, AV, AV);
    ctx.restore();

    // text
    const lvl = levelFromTotalXp(t.xp);
    ctx.fillStyle = fg;
    ctx.font = 'bold 22px "Noto Sans","Segoe UI",Arial';
    ctx.fillText(`#${t.rank} ${t.user.username}`, x + 24 + AV + 12, y + 48);
    ctx.font = '20px "Noto Sans","Segoe UI",Arial';
    ctx.fillStyle = sub;
    ctx.fillText(`L${lvl + 1} • ${t.xp} XP`, x + 24 + AV + 12, y + 80);

    // medal
    const medal = ["#fbbf24", "#9ca3af", "#c084fc"][idx] ?? "#94a3b8";
    ctx.fillStyle = medal;
    ctx.beginPath();
    ctx.arc(x + slotW - 28, y + 28, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // me panel
  const meY = startY + slotH + 28;
  ctx.fillStyle = style.theme === "light" ? "#e5e7eb" : "#111827";
  ctx.beginPath();
  ctx.roundRect(64, meY, W - 128, 200, 20);
  ctx.fill();

  const avMe = await loadAny(
    p.me.user.displayAvatarURL({ extension: "png", size: 128 })
  );
  const AVM = 96;
  ctx.save();
  ctx.beginPath();
  ctx.arc(88 + AVM / 2, meY + 28 + AVM / 2, AVM / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avMe) ctx.drawImage(avMe as any, 88, meY + 28, AVM, AVM);
  ctx.restore();

  ctx.fillStyle = fg;
  ctx.font = 'bold 28px "Noto Sans","Segoe UI",Arial';
  const meLvl = levelFromTotalXp(p.me.xp);
  ctx.fillText(
    `You • #${p.me.rank} • L${meLvl + 1} • ${p.me.xp} XP`,
    88 + AVM + 16,
    meY + 64
  );
  ctx.font = '22px "Noto Sans","Segoe UI",Arial';
  ctx.fillStyle = sub;
  ctx.fillText(
    `Messages: ${p.me.msgCount}   •   Voice: ${p.me.voiceMin} min`,
    88 + AVM + 16,
    meY + 96
  );

  // progress bar to next level (optional)
  ctx.fillStyle = style.theme === "light" ? "#d1d5db" : "#1f2937";
  const bx = 88 + AVM + 16;
  const by = meY + 124;
  const bw = W - bx - 64;
  const bh = 16;
  ctx.fillStyle = style.theme === "light" ? "#d1d5db" : "#1f2937";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.fill();
  // no exact next here; this is decorative
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(bx, by, Math.floor(bw * 0.4), bh, 8);
  ctx.fill();

  return canvas.toBuffer("image/png");
}
