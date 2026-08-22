/**
 * The prompt row. PRD Sections 3.2, 6.
 *
 * Screen-space DOM, always: recoil, camera motion, and enemy lunges must never
 * be able to move the text the player is reading. Owned by one class because
 * both the placement drill and combat draw the same row, and two copies of
 * this rendering would drift apart.
 *
 * Split into two update paths on purpose. `render` runs per keystroke and
 * touches only the active token. `setUpcoming` / `setCompleted` run per token.
 * At 200 WPM the active token is rewritten ~17 times a second, and the queue
 * must not ride along.
 */

export interface PromptElements {
  active: HTMLElement;
  past: HTMLElement;
  next: HTMLElement;
}

export class PromptView {
  private el: PromptElements;
  private errorUntil = 0;
  private errorShown = false;

  constructor(el: PromptElements) {
    this.el = el;
  }

  /** Per keystroke: done / current / remaining of the active token. */
  render(token: string, typedCount: number): void {
    // Sentences and transmissions (Stages 9-10) cannot fit at drill size.
    // Classes, not inline styles, so text-size and contrast settings stack.
    this.el.active.classList.toggle('long', token.length > 22 && token.length <= 38);
    this.el.active.classList.toggle('xlong', token.length > 38);
    const done = token.slice(0, typedCount);
    const current = token[typedCount] ?? '';
    const rest = token.slice(typedCount + 1);
    this.el.active.innerHTML =
      `<span class="done">${escapeHtml(done)}</span>` +
      `<span class="current">${escapeHtml(current)}</span>` +
      `<span>${escapeHtml(rest)}</span>` +
      `<span class="errIcon">&#10006;</span>`;
  }

  /** Per token: the words the player can read ahead to. */
  setUpcoming(tokens: string[]): void {
    this.el.next.innerHTML = tokens
      .map((t, i) => `<span class="q q${i}">${escapeHtml(t)}</span>`)
      .join('');
  }

  /** Per token: completed words, most recent first. */
  setCompleted(tokens: string[]): void {
    this.el.past.innerHTML = tokens
      .slice(0, 2)
      .map((t) => `<span>${escapeHtml(t)}</span>`)
      .join('');
  }

  /** Error state is weight + underline style + icon, never color alone. */
  flashError(now: number, durationMs = 220): void {
    this.errorUntil = now + durationMs;
    this.errorShown = true;
    this.el.active.classList.add('error');
  }

  /** Called from the frame loop. The flag keeps it a pure JS compare on the
   *  frames (almost all of them) where there is no error class to clear. */
  tick(now: number): void {
    if (this.errorShown && now > this.errorUntil) {
      this.errorShown = false;
      this.el.active.classList.remove('error');
    }
  }

  clear(): void {
    this.el.active.innerHTML = '';
    this.el.next.innerHTML = '';
    this.el.past.innerHTML = '';
  }
}

/**
 * Escapes for BOTH element and attribute context: several call sites put the
 * result inside title="..." and data-* attributes, where an unescaped quote
 * is as much an exit as an angle bracket is in text.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
