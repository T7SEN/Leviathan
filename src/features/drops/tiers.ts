export type Tier = "common" | "uncommon" | "rare" | "epic" | "legendary";

export const TIER_XP: Record<Tier, number> = {
  common: 25,
  uncommon: 50,
  rare: 100,
  epic: 200,
  legendary: 400,
};

export const TIER_WEIGHTS: Record<Tier, number> = {
  common: 62,
  uncommon: 22,
  rare: 10,
  epic: 5,
  legendary: 1,
};
