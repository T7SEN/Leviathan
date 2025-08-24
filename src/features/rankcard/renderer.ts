// src/features/rankcard/renderer.ts
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";
import type { User } from "discord.js";
import { getRankStyle } from "./style.js";
import { xpToNext } from "../leveling/engine.js";
import path from "node:path";
import fs from "node:fs";

type LoadedImage = Awaited<ReturnType<typeof loadImage>>;

try {
  const REG =
    process.env.RANKCARD_FONT_REGULAR ?? "assets/fonts/NotoSans-Regular.ttf";
  const BLD =
    process.env.RANKCARD_FONT_BOLD ?? "assets/fonts/NotoSans-Bold.ttf";
  GlobalFonts.registerFromPath(REG, "Noto Sans");
  GlobalFonts.registerFromPath(BLD, "Noto Sans Bold");
} catch {}

type Inputs = {
  guildId: string;
  user: User;
  level: number;
  totalXp: number;
  rank: number;
  streak?: number | null;
  voiceTodayMin?: number | null;
  guildIconUrl?: string | null;
  roleMultiplier?: number | null; // e.g. 1.2
  seasonLabel?: string | null; // e.g. 'S3 • Spring'
  seasonIconUrl?: string | null; // optional small emblem
  seasonId?: number | null; // draws "S#" badge on avatar
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function xpAtLevelStart(level: number): number {
  let sum = 0;
  for (let l = 0; l < level; l += 1) sum += xpToNext(l);
  return sum;
}

function normalizeSrc(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  const p = path.isAbsolute(src) ? src : path.resolve(process.cwd(), src);
  return fs.existsSync(p) ? p : src;
}

async function loadAnyImage(src: string): Promise<LoadedImage | null> {
  try {
    return await loadImage(normalizeSrc(src));
  } catch {
    return null;
  }
}

const W = 1024,
  H = 384;

export async function renderRankCard(inp: Inputs): Promise<Buffer> {
  const style = getRankStyle(inp.guildId);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // colors
  const theme = style.theme;
  const fg = theme === "light" ? "#111827" : "#f9fafb";
  const sub = theme === "light" ? "#374151" : "#9ca3af";
  const accent = "#5865f2";
  // theme-aware badges
  const badgeFill = theme === "light" ? "#10b981" : "#34d399";
  const badgeText = theme === "light" ? "#0b1b13" : "#052016";
  const seasonFill = theme === "light" ? "#374151" : "#f9fafb";
  const seasonText = theme === "light" ? "#f9fafb" : "#111827";
  const seasonBadgeFill = theme === "light" ? "#374151" : "#f9fafb";
  const seasonBadgeText = theme === "light" ? "#f9fafb" : "#111827";

  // background
  ctx.fillStyle = style.theme === "light" ? "#f3f4f6" : "#111827";
  ctx.fillRect(0, 0, W, H);
  if (style.backgroundUrl) {
    const bg = await loadAnyImage(style.backgroundUrl);
    if (bg) {
      ctx.globalAlpha = 0.35;
      ctx.drawImage(bg as any, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // avatar
  const avUrl = inp.user.displayAvatarURL({ extension: "png", size: 256 });
  const av = await loadAnyImage(avUrl);
  const AV = 192;
  const ax = 48,
    ay = (H - AV) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (av) ctx.drawImage(av as any, ax, ay, AV, AV);
  ctx.restore();

  // seasonal circular badge over avatar (bottom-right)
  if ((inp.seasonId && inp.seasonId > 0) || inp.seasonIconUrl) {
    const S = 56;
    const pad = 8;
    const bx = ax + AV - S + pad;
    const by = ay + AV - S + pad;
    const r = S / 2;
    // base circle
    ctx.fillStyle = seasonBadgeFill;
    ctx.beginPath();
    ctx.arc(bx + r, by + r, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    // icon inside if provided
    let drewIcon = false;
    if (inp.seasonIconUrl) {
      const em = await loadAnyImage(inp.seasonIconUrl);
      if (em) {
        const inset = 8;
        const sz = S - inset * 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx + r, by + r, r - inset, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(em as any, bx + inset, by + inset, sz, sz);
        ctx.restore();
        drewIcon = true;
      }
    }
    // fallback: text "S#"
    if (!drewIcon && inp.seasonId && inp.seasonId > 0) {
      const label = `S${inp.seasonId}`;
      ctx.fillStyle = seasonBadgeText;
      const prevA = ctx.textAlign,
        prevB = ctx.textBaseline;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = 'bold 22px "Noto Sans","Segoe UI",Arial';
      ctx.fillText(label, bx + r, by + r);
      ctx.textAlign = prevA;
      ctx.textBaseline = prevB;
    }
  }

  // username
  const nameX = 272;
  const nameY = 120;
  const nameFont = 'bold 40px "Noto Sans","Segoe UI",Arial';
  ctx.fillStyle = fg;
  ctx.font = nameFont;
  const uname = `${inp.user.username}`;
  const nameMetrics = ctx.measureText(uname);
  ctx.fillText(uname, nameX, nameY);

  // role multiplier badge next to username
  if (inp.roleMultiplier && inp.roleMultiplier > 1.0001) {
    const label = `×${inp.roleMultiplier.toFixed(2)}`;
    const badgeFont = '24px "Noto Sans","Segoe UI",Arial';
    ctx.font = badgeFont;
    const textW = Math.ceil(ctx.measureText(label).width);
    const padX = 12;
    const h = 28;
    const w = textW + padX * 2;

    // place right of name, vertically centered to name box
    const x = nameX + Math.ceil(nameMetrics.width) + 12;
    const ascent = nameMetrics.actualBoundingBoxAscent ?? 32;
    const nameTop = nameY - ascent;
    const y = nameTop + Math.round((ascent - h) / 2);

    // pill
    const r2 = h / 2;
    ctx.fillStyle = badgeFill;
    ctx.beginPath();
    ctx.moveTo(x + r2, y);
    ctx.arcTo(x + w, y, x + w, y + h, r2);
    ctx.arcTo(x + w, y + h, x, y + h, r2);
    ctx.arcTo(x, y + h, x, y, r2);
    ctx.arcTo(x, y, x + w, y, r2);
    ctx.closePath();
    ctx.fill();

    // centered label
    const tm = ctx.measureText(label);
    const cx = x + w / 2;
    const cy =
      y +
      h / 2 +
      (tm.actualBoundingBoxAscent - tm.actualBoundingBoxDescent) / 2;
    const prevAlign = ctx.textAlign;
    const prevBaseline = ctx.textBaseline;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = badgeText;
    ctx.fillText(label, cx, cy);
    ctx.textAlign = prevAlign;
    ctx.textBaseline = prevBaseline;
  }

  // meta
  ctx.font = '28px "Noto Sans","Segoe UI",Arial';
  ctx.fillStyle = sub;
  ctx.fillText(`Level ${inp.level}  •  Rank #${inp.rank}`, 272, 160);

  // progress bar
  const need = inp.level < 15 ? xpToNext(inp.level) : Infinity;
  const have = inp.totalXp - xpAtLevelStart(inp.level);
  const pct = Number.isFinite(need) ? clamp(have / need, 0, 1) : 1;
  const barX = 272,
    barY = 200,
    barW = 680,
    barH = 28;
  const r = barH / 2;

  // track
  ctx.fillStyle = style.theme === "light" ? "#e5e7eb" : "#1f2937";
  ctx.beginPath();
  ctx.moveTo(barX + r, barY);
  ctx.arcTo(barX + barW, barY, barX + barW, barY + barH, r);
  ctx.arcTo(barX + barW, barY + barH, barX, barY + barH, r);
  ctx.arcTo(barX, barY + barH, barX, barY, r);
  ctx.arcTo(barX, barY, barX + barW, barY, r);
  ctx.closePath();
  ctx.fill();

  // fill
  ctx.fillStyle = accent;
  const fillW = Math.max(r * 2, Math.floor(barW * pct));
  ctx.beginPath();
  ctx.moveTo(barX + r, barY);
  ctx.arcTo(barX + fillW, barY, barX + fillW, barY + barH, r);
  ctx.arcTo(barX + fillW, barY + barH, barX, barY + barH, r);
  ctx.arcTo(barX, barY + barH, barX, barY, r);
  ctx.arcTo(barX, barY, barX + fillW, barY, r);
  ctx.closePath();
  ctx.fill();

  // labels
  ctx.fillStyle = sub;
  ctx.font = '24px "Noto Sans","Segoe UI",Arial';
  const needTxt = Number.isFinite(need)
    ? `${have}/${need} XP`
    : `${inp.totalXp} XP`;
  ctx.fillText(needTxt, barX, barY + 56);

  let extraY = barY + 100;
  if (style.showStreak && typeof inp.streak === "number") {
    ctx.fillText(`Streak: ${inp.streak} day(s)`, barX, extraY);
    extraY += 34;
  }
  if (style.showVoice && typeof inp.voiceTodayMin === "number") {
    ctx.fillText(`Voice today: ${inp.voiceTodayMin} min`, barX, extraY);
  }

  // guild icon top-right
  if (inp.guildIconUrl) {
    const icon = await loadAnyImage(inp.guildIconUrl);
    if (icon) {
      const S = 96;
      const gx = W - S - 24;
      const gy = 24;
      ctx.save();
      ctx.beginPath();
      ctx.arc(gx + S / 2, gy + S / 2, S / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(icon as any, gx, gy, S, S);
      ctx.restore();
    }
  }

  // season emblem/label under guild icon
  if (inp.seasonLabel) {
    const baseX = W - 24;
    let curX = baseX;
    const y = 24 + 96 + 12;
    ctx.font = '22px "Noto Sans","Segoe UI",Arial';
    const txt = inp.seasonLabel ?? "";
    const tw = txt ? Math.ceil(ctx.measureText(txt).width) : 0;
    const pad = 12;
    const H2 = 32;
    let W2 = tw + pad * 2;
    const x = baseX - W2;
    const r3 = H2 / 2;
    ctx.fillStyle = seasonFill;
    ctx.beginPath();
    ctx.moveTo(x + r3, y);
    ctx.arcTo(x + W2, y, x + W2, y + H2, r3);
    ctx.arcTo(x + W2, y + H2, x, y + H2, r3);
    ctx.arcTo(x, y + H2, x, y, r3);
    ctx.arcTo(x, y, x + W2, y, r3);
    ctx.closePath();
    ctx.fill();
    curX = x + pad;
    ctx.fillStyle = seasonText;
    if (txt) ctx.fillText(txt, curX, y + 24);
  }

  return canvas.toBuffer("image/png");
}
