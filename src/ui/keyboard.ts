/**
 * On-screen keyboard. PRD Section 10.
 *
 * A scaffold, not furniture: it exists so a hunt-and-peck player can find a
 * key without looking down, and the PRD is explicit that touch typing needs
 * eyes on the text, so it is built to be turned off. Auto-hide against mastery
 * lands with the mastery engine in Phase 1b; the hook is here.
 *
 * Built once as DOM and then updated by toggling classes on cached elements.
 * Rebuilding 60 keys of innerHTML per keystroke would put the viz straight
 * into the burst-test numbers.
 */

import { FINGER_LABEL, FINGER_OF } from '../profile/mastery';
import { baseKeyOf, properShiftSide } from '../content/shift';

/** US QWERTY, the only layout the PRD supports. Progress heatmap uses it too. */
export const KEYBOARD_ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

/** Internal cell ids for the two Shift keys; never real characters. */
const LSHIFT = '<LS>';
const RSHIFT = '<RS>';

const FINGER_COLORS: Record<string, string> = {
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

export class KeyboardViz {
  private root: HTMLElement;
  private cells = new Map<string, HTMLElement>();
  private target: string | null = null;
  private upcoming: string | null = null;
  private visible = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
  }

  private build(): void {
    this.root.innerHTML = '';
    this.root.classList.add('kbviz');
    KEYBOARD_ROWS.forEach((row, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kbrow';
      // The bottom letter row carries the Shift keys, so opposite-hand Shift
      // can be visually demonstrated (PRD 11) rather than described.
      const isBottom = rowIndex === KEYBOARD_ROWS.length - 1;
      if (isBottom) rowEl.appendChild(this.shiftCell(LSHIFT, 'left-pinky'));
      for (const key of row) {
        const cell = document.createElement('div');
        cell.className = 'kbkey';
        cell.textContent = key;
        const finger = FINGER_OF[key];
        if (finger) cell.style.setProperty('--finger', FINGER_COLORS[finger] ?? '#7f858c');
        // F and J carry the physical bumps; the whole home row is the anchor.
        if (key === 'f' || key === 'j') cell.classList.add('bump');
        if (['a', 's', 'd', 'f', 'j', 'k', 'l', ';'].includes(key)) cell.classList.add('home');
        this.cells.set(key, cell);
        rowEl.appendChild(cell);
      }
      if (isBottom) rowEl.appendChild(this.shiftCell(RSHIFT, 'right-pinky'));
      this.root.appendChild(rowEl);
    });
    const spaceRow = document.createElement('div');
    spaceRow.className = 'kbrow';
    const space = document.createElement('div');
    space.className = 'kbkey kbspace';
    space.textContent = 'space';
    space.style.setProperty('--finger', FINGER_COLORS.thumb);
    this.cells.set(' ', space);
    spaceRow.appendChild(space);
    this.root.appendChild(spaceRow);
  }

  private shiftCell(id: string, finger: string): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'kbkey kbshift';
    cell.textContent = String.fromCharCode(0x21e7);
    cell.style.setProperty('--finger', FINGER_COLORS[finger]);
    this.cells.set(id, cell);
    return cell;
  }

  private shiftCellFor(ch: string): HTMLElement | null {
    const side = properShiftSide(ch, FINGER_OF);
    if (!side) return null;
    return this.cells.get(side === 'left' ? LSHIFT : RSHIFT) ?? null;
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.style.display = on ? 'flex' : 'none';
  }

  /**
   * PRD 10 finger guide. Off keeps the keyboard usable as a plain key map:
   * the target key still lights, but neutrally, with no finger-zone colours.
   */
  setFingerGuide(on: boolean): void {
    this.root.classList.toggle('noguide', !on);
  }

  get shown(): boolean {
    return this.visible;
  }

  /**
   * The key the player must press now, and the one after it. A shifted
   * character lights its base key AND the opposite-hand Shift: the chord is
   * shown, not described.
   */
  setTarget(key: string | null, next: string | null = null): void {
    if (key === this.target && next === this.upcoming) return;
    if (this.target) {
      this.cells.get(baseKeyOf(this.target))?.classList.remove('target');
      this.shiftCellFor(this.target)?.classList.remove('target');
    }
    if (this.upcoming) this.cells.get(baseKeyOf(this.upcoming))?.classList.remove('next');
    this.target = key;
    this.upcoming = next;
    if (key) {
      this.cells.get(baseKeyOf(key))?.classList.add('target');
      this.shiftCellFor(key)?.classList.add('target');
    }
    // Never mark the same cell as both: the current key wins.
    if (next && next !== key && (!key || baseKeyOf(next) !== baseKeyOf(key))) {
      this.cells.get(baseKeyOf(next))?.classList.add('next');
    }
  }

  /** Keypress animation. Purely cosmetic, cheap enough to run at 200 WPM. */
  flash(key: string, kind: 'hit' | 'miss'): void {
    const cell = this.cells.get(baseKeyOf(key));
    if (!cell) return;
    const cls = kind === 'hit' ? 'hit' : 'miss';
    cell.classList.remove(cls);
    // Force a reflow so the animation restarts on rapid repeats of one key.
    void cell.offsetWidth;
    cell.classList.add(cls);
    setTimeout(() => cell.classList.remove(cls), kind === 'hit' ? 120 : 260);
  }
}

/**
 * PRD 10: Settings force On or Off and override auto. `autoWants` is what the
 * mastery engine concluded; the caller computes it, because the keyboard has
 * no business knowing how mastery works.
 */
export function resolveVisibility(pref: 'auto' | 'on' | 'off', autoWants: boolean): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return autoWants;
}

/**
 * PRD 10: when the keyboard is hidden, a brief non-intrusive finger-zone hint
 * MAY flash after repeated errors on the same key.
 *
 * This is what makes auto-hide safe to ship. Hiding the scaffold is the point
 * of learning to touch type, but a player who has genuinely lost a key needs
 * somewhere to go that is not "look down", which undoes the habit the hiding
 * was building. It names the finger, not the location.
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
