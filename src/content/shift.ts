/**
 * Shift pairs for US QWERTY. PRD Sections 5, 11 (Stage 6+).
 *
 * A shifted character is not a new key: it is a chord on a key the player
 * already owns. That single fact drives every decision downstream --
 * shifted characters get their own stat entries (so `A` accuracy is real
 * data, and the confusion matrix's `A -> a` row IS the case-error flag the
 * PRD asks for), but they never block a stage gate, and the keyboard
 * visualization points at the base key plus the opposite-hand Shift.
 */

/** base -> shifted, for every key the curriculum can teach. */
export const SHIFT_OF: Record<string, string> = {
  a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'H', i: 'I',
  j: 'J', k: 'K', l: 'L', m: 'M', n: 'N', o: 'O', p: 'P', q: 'Q', r: 'R',
  s: 'S', t: 'T', u: 'U', v: 'V', w: 'W', x: 'X', y: 'Y', z: 'Z',
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&',
  '8': '*', '9': '(', '0': ')',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '-': '_', '=': '+',
};

/** shifted -> base. */
export const UNSHIFT: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFT_OF).map(([base, shifted]) => [shifted, base]),
);

export function isShiftedChar(ch: string): boolean {
  return ch in UNSHIFT;
}

/** The physical key that produces this character, shifted or not. */
export function baseKeyOf(ch: string): string {
  return UNSHIFT[ch] ?? ch;
}

/**
 * Which hand's Shift SHOULD be held for this character: the hand opposite
 * the one pressing the base key. PRD 11: opposite-hand Shift, visually
 * demonstrated. Measured, never gated (PRD 5).
 */
export function properShiftSide(ch: string, fingerOf: Record<string, string>): 'left' | 'right' | null {
  if (!isShiftedChar(ch)) return null;
  const finger = fingerOf[baseKeyOf(ch)];
  if (!finger) return null;
  return finger.startsWith('left') ? 'right' : 'left';
}
