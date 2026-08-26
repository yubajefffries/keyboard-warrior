/**
 * Keyboard layout data and the finger hint. PRD Section 10.
 *
 * The on-screen keyboard scaffold is gone (Jeff's 2026-08-26 verdict:
 * useless in play -- eyes belong on the text). What replaced it is the
 * animated hand-placement guide shown BEFORE a lesson (ui/handguide.ts),
 * which teaches where the hands sit and which finger owns which key while
 * nothing is shooting at you. What remains here is the shared layout data,
 * the finger-zone colours, and the in-combat FingerHint.
 */

import { FINGER_LABEL, FINGER_OF } from '../profile/mastery';
import { properShiftSide } from '../content/shift';

/** US QWERTY, the only layout the PRD supports. Progress heatmap and the
 *  hand guide both draw from it. */
export const KEYBOARD_ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

/** One colour per finger zone, shared by the hand guide and the hint. */
export const FINGER_COLORS: Record<string, string> = {
  'left-pinky': '#c2679a',
  'left-ring': '#9a7fd0',
  'left-middle': '#6d90d8',
  'left-index': '#57a9b8',
  'right-index': '#5fae7a',
  'right-middle': '#a8b25c',
  'right-ring': '#d0964f',
  'right-pinky': '#c86d5a',
  thumb: '#7f858c',
};

/**
 * PRD 10: a brief non-intrusive finger-zone hint MAY flash after repeated
 * errors on the same key.
 *
 * A player who has genuinely lost a key needs somewhere to go that is not
 * "look down", which undoes the habit touch typing is building. It names
 * the finger, not the location.
 */
export class FingerHint {
  private el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.className = 'fingerhint';
  }

  show(key: string, durationMs = 1800): void {
    const finger = FINGER_OF[key];
    if (!finger) return;
    // For a shifted character, name the chord: which finger, plus which hand
    // carries the Shift. Opposite-hand Shift, said out loud (PRD 11).
    const side = properShiftSide(key, FINGER_OF);
    const label = (FINGER_LABEL[finger] ?? finger) + (side ? ` + ${side} Shift` : '');
    this.el.innerHTML =
      `<b>${key === ' ' ? 'space' : key}</b>` +
      `<span>${label}</span>`;
    this.el.style.setProperty('--finger', FINGER_COLORS[finger] ?? '#7f858c');
    this.el.classList.add('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), durationMs);
  }

  hide(): void {
    this.el.classList.remove('on');
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
