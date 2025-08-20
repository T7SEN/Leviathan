export type AntiSpamPolicy = {
  minChars: number; // min total characters
  minWords: number; // min words split by whitespace
  allowEmojiOnly: boolean; // if false, emoji-only gets blocked
  maxRepeatCharRun: number; // e.g., 'hhhhhh' fails if run > limit
  minDistinctChars: number; // require variety, e.g., at least 3 distinct
};

export const defaultAntiSpamPolicy: AntiSpamPolicy = {
  minChars: 8,
  minWords: 2,
  allowEmojiOnly: false,
  maxRepeatCharRun: 5,
  minDistinctChars: 3,
};

const emojiRegex =
  /^(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})+$/u;

function isEmojiOnly(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  return emojiRegex.test(trimmed);
}

function longestRun(s: string): number {
  let best = 0;
  let cur = 0;
  let prev = "";
  for (const ch of s) {
    if (ch === prev) {
      cur += 1;
    } else {
      prev = ch;
      cur = 1;
    }
    if (cur > best) best = cur;
  }
  return best;
}

function countDistinct(s: string): number {
  const set = new Set<string>();
  for (const ch of s) set.add(ch);
  return set.size;
}

/**
 * Returns null if ok, or a short reason string if rejected.
 */
export function evaluateContent(
  content: string,
  policy: AntiSpamPolicy = defaultAntiSpamPolicy
): string | null {
  const text = content.normalize("NFKC");

  if (!policy.allowEmojiOnly && isEmojiOnly(text)) {
    return "emoji-only";
  }

  if (text.trim().length < policy.minChars) {
    return "too-short";
  }

  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length < policy.minWords) {
    return "too-few-words";
  }

  if (longestRun(text) > policy.maxRepeatCharRun) {
    return "repeated-char-run";
  }

  if (countDistinct(text.replace(/\s+/g, "")) < policy.minDistinctChars) {
    return "low-variety";
  }

  return null;
}
