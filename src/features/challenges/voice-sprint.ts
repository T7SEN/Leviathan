import type { Client, VoiceBasedChannel } from "discord.js";
import { CH, dayKeyUtc, tryClaimAndAward, getWinner } from "./store.js";

type SprintState = {
  accMin: number;
  lastBucket: number;
};

const state = new Map<string, SprintState>(); // key = guild:user

function key(g: string, u: string) {
  return `${g}:${u}`;
}

/**
 * Call once per award cycle with elapsed minutes.
 * ok = in non-AFK VC with ≥2 other users.
 */
export async function updateVoiceSprint(
  client: Client,
  guildId: string,
  userId: string,
  ok: boolean,
  elapsedMin: number,
  nowMs: number
): Promise<boolean> {
  if (!ok || elapsedMin <= 0) {
    state.delete(key(guildId, userId));
    return false;
  }

  const k = key(guildId, userId);
  const cur = state.get(k) ?? { accMin: 0, lastBucket: 0 };
  const bucket = Math.floor(nowMs / 60_000);

  if (cur.lastBucket === 0 || bucket === cur.lastBucket + elapsedMin) {
    cur.accMin += elapsedMin;
  } else {
    cur.accMin = elapsedMin;
  }
  cur.lastBucket = bucket;
  state.set(k, cur);

  if (cur.accMin >= 60) {
    const dk = dayKeyUtc(nowMs);
    if (!getWinner(guildId, CH.voiceSprint, dk)) {
      const won = await tryClaimAndAward(
        client,
        guildId,
        CH.voiceSprint,
        dk,
        userId,
        nowMs
      );
      if (won) {
        state.delete(k);
        return true;
      }
    }
  }
  return false;
}
