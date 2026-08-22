/**
 * Break suggestion. PRD Section 11.
 *
 * "If accuracy collapses mid-session, defined as 10+ percentage points below
 * the session's rolling mean across the last 20 tokens, SHOULD suggest a
 * break rather than keep writing bad samples into mastery."
 *
 * Pure state machine, fed one per-token accuracy at a time. It fires at most
 * once per session: the point is one gentle nudge, not nagging someone who
 * has decided to push through.
 */

/** Tokens the collapse is measured over. PRD 11. */
export const FATIGUE_WINDOW_TOKENS = 20;
/** Percentage-point drop below the session mean that counts as a collapse. PRD 11. */
export const FATIGUE_DROP = 0.10;
/**
 * Tokens before the session mean is stable enough to accuse anyone of
 * collapsing against it. Below this the "mean" is mostly the warm-up. [REVIEW]
 */
export const FATIGUE_MIN_TOKENS = 40;

export interface FatigueState {
  /** Per-token accuracies, whole session, in order. */
  tokenAccuracies: number[];
  /** Set once the suggestion has fired; it never fires twice. */
  suggested: boolean;
}

export function newFatigueState(): FatigueState {
  return { tokenAccuracies: [], suggested: false };
}

export interface FatigueReading {
  /** True exactly once, on the token where the collapse is first detected. */
  suggestBreak: boolean;
  sessionMean: number;
  recentMean: number;
}

export function recordToken(state: FatigueState, accuracy: number): FatigueReading {
  state.tokenAccuracies.push(accuracy);
  const n = state.tokenAccuracies.length;
  const sessionMean = state.tokenAccuracies.reduce((a, b) => a + b, 0) / n;
  const recent = state.tokenAccuracies.slice(-FATIGUE_WINDOW_TOKENS);
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;

  const collapsed =
    !state.suggested &&
    n >= FATIGUE_MIN_TOKENS &&
    recent.length >= FATIGUE_WINDOW_TOKENS &&
    recentMean <= sessionMean - FATIGUE_DROP;

  if (collapsed) state.suggested = true;
  return { suggestBreak: collapsed, sessionMean, recentMean };
}
