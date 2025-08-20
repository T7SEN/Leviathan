export type VoiceXpPolicy = {
  minSessionMs: number; // minimum eligible segment
  xpPerMinute: number; // XP per full minute
  requireOthers: boolean; // no solo farming
  ignoreAfk: boolean; // skip guild AFK channel
  requireUnmuted: boolean; // user must not self-mute/deafen
};

export const defaultVoicePolicy: VoiceXpPolicy = {
  minSessionMs: 60_000,
  xpPerMinute: 10,
  requireOthers: true,
  ignoreAfk: true,
  requireUnmuted: true,
};
