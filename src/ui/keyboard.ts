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

import { FINGER_OF } from '../profile/mastery';

/** US QWERTY, the only layout the PRD supports. */
const ROWS: string[][] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];

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

export type FingerGuideMode = 'highlight' | 'off';

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
    for (const row of ROWS) {
      const rowEl = document.createElement('div');
      rowEl.className = 'kbrow';
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
      this.root.appendChild(rowEl);
    }
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

  setVisible(on: boolean): void {
    this.visible = on;
    this.root.style.display = on ? 'flex' : 'none';
  }

  get shown(): boolean {
    return this.visible;
  }

  /** The key the player must press now, and the one after it. */
  setTarget(key: string | null, next: string | null = null): void {
    if (key === this.target && next === this.upcoming) return;
    if (this.target) this.cells.get(this.target)?.classList.remove('target');
    if (this.upcoming) this.cells.get(this.upcoming)?.classList.remove('next');
    this.target = key;
    this.upcoming = next;
    if (key) this.cells.get(key)?.classList.add('target');
    // Never mark the same cell as both: the current key wins.
    if (next && next !== key) this.cells.get(next)?.classList.add('next');
  }

  /** Keypress animation. Purely cosmetic, cheap enough to run at 200 WPM. */
  flash(key: string, kind: 'hit' | 'miss'): void {
    const cell = this.cells.get(key);
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
 * PRD 10: Settings force On or Off and override auto. Auto resolves against
 * mastery, which is Phase 1b; until then auto follows the route the placement
 * drill assigned, which is the same signal auto-hide will eventually refine.
 */
export function resolveVisibility(
  pref: 'auto' | 'on' | 'off',
  route: 'beginner' | 'intermediate' | 'advanced',
): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return route === 'beginner';
}
