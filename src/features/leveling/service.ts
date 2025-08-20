import { LevelingEngine, type LevelProfile } from "./engine.js";
import { SQLiteLevelStore } from "./sqlite-store.js";

const store = new SQLiteLevelStore();
export const engine = new LevelingEngine(store);

export function emptyProfile(guildId: string, userId: string): LevelProfile {
  return {
    userId,
    guildId,
    xp: 0,
    level: 0,
    lastAwardMs: null,
  };
}

export async function getProfile(
  guildId: string,
  userId: string
): Promise<LevelProfile> {
  return (await store.get(guildId, userId)) ?? emptyProfile(guildId, userId);
}

export async function saveProfile(p: LevelProfile): Promise<void> {
  await store.set(p);
}

export async function topProfiles(guildId: string, limit: number, offset = 0) {
  return store.listTop(guildId, limit, offset);
}
