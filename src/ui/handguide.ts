/**
 * The hand-placement guide. Replaces the in-combat on-screen keyboard
 * (PRD 10 rethought, 2026-08-26): posture is taught BEFORE the lesson, on
 * the intro screen, while nothing is shooting at you -- in combat the eyes
 * belong on the text and the FingerHint covers emergencies.
 *
 * One inline SVG, generated per lesson: a miniature QWERTY board, two
 * stylized hands resting on home row, and for each key the lesson
 * introduces, the OWNING fingertip glides out from its home key to the new
 * key and settles back, on a slow loop. Keys the lesson uses are edged in
 * their finger's colour, so the map and the hand agree.
 *
 * Animation is SMIL inside the SVG -- no JS per frame, no external assets,
 * and it obeys PRD 22: smooth glides and gentle pulses, never a strobe.
 */

import { KEYBOARD_ROWS, FINGER_COLORS } from './keyboard';
import { FINGER_OF } from '../profile/mastery';
import { baseKeyOf } from '../content/shift';

const KEY = 30;
const PITCH = 35;
const ROW_X = [2, 16, 26, 40]; // QWERTY stagger
const ROW_Y = [2, 39, 76, 113];
const SPACE_Y = 150;
const SPACE_W = 190;

/** Where each finger rests. The guide always draws the hands here. */
const HOME_KEY: Record<string, string> = {
  'left-pinky': 'a',
  'left-ring': 's',
  'left-middle': 'd',
  'left-index': 'f',
  'right-index': 'j',
  'right-middle': 'k',
  'right-ring': 'l',
  'right-pinky': ';',
  thumb: ' ',
};

interface Pt {
  x: number;
  y: number;
}

function keyCenters(): Map<string, Pt> {
  const centers = new Map<string, Pt>();
  KEYBOARD_ROWS.forEach((row, r) => {
    row.forEach((key, i) => {
      centers.set(key, { x: ROW_X[r] + i * PITCH + KEY / 2, y: ROW_Y[r] + KEY / 2 });
    });
  });
  centers.set(' ', { x: ROW_X[2] + 5 * PITCH, y: SPACE_Y + KEY / 2 });
  return centers;
}

const ease = '.4 0 .2 1';

/**
 * The travelling fingertip: out to each target, back home between trips,
 * resting a beat at home so the loop reads as "reach, return" rather than
 * an orbit. Line and tip share the same timing so the finger stays whole.
 */
function glideValues(home: Pt, targets: Pt[], axis: 'x' | 'y'): { values: string; keyTimes: string; splines: string } {
  const stops: number[] = [home[axis]];
  for (const t of targets) stops.push(t[axis], home[axis]);
  stops.push(home[axis]); // the rest beat
  const n = stops.length - 1;
  const keyTimes = stops.map((_, i) => (i === stops.length - 1 ? 1 : (i / n) * 0.82)).map((t) => t.toFixed(3));
  return {
    values: stops.map((v) => v.toFixed(1)).join(';'),
    keyTimes: keyTimes.join(';'),
    splines: Array(n).fill(ease).join(';'),
  };
}

/** The whole guide as an HTML string for a screen sheet. */
export function handGuideHtml(lesson: { keys: string[]; introduces: string[] }): string {
  const centers = keyCenters();
  const lessonKeys = new Set(lesson.keys.map(baseKeyOf).filter((k) => centers.has(k)));
  // The keys the hands demonstrate: what this lesson introduces, or (for a
  // review lesson) up to four of its keys, so the guide always moves.
  const demo = (lesson.introduces.length ? lesson.introduces : lesson.keys)
    .map(baseKeyOf)
    .filter((k, i, arr) => centers.has(k) && arr.indexOf(k) === i)
    .slice(0, 6);
  // Group demo keys by owning finger: one journey per finger, visiting each.
  const journeys = new Map<string, Pt[]>();
  for (const key of demo) {
    const finger = FINGER_OF[key];
    if (!finger || !HOME_KEY[finger]) continue;
    const pt = centers.get(key)!;
    const home = centers.get(HOME_KEY[finger])!;
    if (pt.x === home.x && pt.y === home.y) continue; // home keys pulse instead
    if (!journeys.has(finger)) journeys.set(finger, []);
    journeys.get(finger)!.push(pt);
  }

  const keys: string[] = [];
  KEYBOARD_ROWS.forEach((row, r) => {
    row.forEach((key, i) => {
      const finger = FINGER_OF[key];
      const color = finger ? FINGER_COLORS[finger] : '#3a3f46';
      const inLesson = lessonKeys.has(key);
      const home = Object.values(HOME_KEY).includes(key);
      keys.push(
        `<rect x="${ROW_X[r] + i * PITCH}" y="${ROW_Y[r]}" width="${KEY}" height="${KEY}" rx="6"` +
          ` fill="${home ? '#23262c' : '#17191d'}" stroke="${inLesson ? color : '#2a2d33'}"` +
          ` stroke-width="${inLesson ? 2 : 1}"/>`,
        `<text x="${ROW_X[r] + i * PITCH + KEY / 2}" y="${ROW_Y[r] + KEY / 2 + 4.5}" text-anchor="middle"` +
          ` font-size="13" fill="${inLesson ? '#e6e8ea' : home ? '#b8bcc1' : '#63676d'}">${key === '<' ? '&lt;' : key}</text>`,
      );
      // The physical bumps on F and J: the anchors the intro copy names.
      if (key === 'f' || key === 'j') {
        keys.push(
          `<rect x="${ROW_X[r] + i * PITCH + KEY / 2 - 5}" y="${ROW_Y[r] + KEY - 7}" width="10" height="2" rx="1" fill="#8a9096"/>`,
        );
      }
    });
  });
  const spaceX = centers.get(' ')!.x - SPACE_W / 2;
  const spaceInLesson = lessonKeys.has(' ');
  keys.push(
    `<rect x="${spaceX}" y="${SPACE_Y}" width="${SPACE_W}" height="${KEY}" rx="6" fill="#17191d"` +
      ` stroke="${spaceInLesson ? FINGER_COLORS.thumb : '#2a2d33'}" stroke-width="${spaceInLesson ? 2 : 1}"/>`,
  );

  // The hands: a soft palm under each half, a static digit line per finger
  // rising to its home key, and the fingertip dot that does the teaching.
  const hands: string[] = [];
  const palmY = SPACE_Y + 92;
  for (const side of ['left', 'right'] as const) {
    const fingers = ['pinky', 'ring', 'middle', 'index'].map((f) => `${side}-${f}`);
    const xs = fingers.map((f) => centers.get(HOME_KEY[f])!.x);
    const palmX = (xs[0] + xs[3]) / 2 + (side === 'left' ? 6 : -6);
    hands.push(
      `<ellipse cx="${palmX}" cy="${palmY}" rx="52" ry="34" fill="#1c1f24" stroke="#2e323a" stroke-width="1.5"/>`,
    );
    // The thumb reaches from the palm to the space bar.
    const thumbTip = { x: centers.get(' ')!.x + (side === 'left' ? -34 : 34), y: SPACE_Y + KEY / 2 };
    hands.push(
      `<line x1="${palmX + (side === 'left' ? 30 : -30)}" y1="${palmY - 10}" x2="${thumbTip.x}" y2="${thumbTip.y}"` +
        ` stroke="#3a3f46" stroke-width="7" stroke-linecap="round"/>`,
      `<circle cx="${thumbTip.x}" cy="${thumbTip.y}" r="6" fill="${FINGER_COLORS.thumb}"/>`,
    );

    fingers.forEach((finger, i) => {
      const home = centers.get(HOME_KEY[finger])!;
      const color = FINGER_COLORS[finger];
      // Knuckle order mirrors between hands: the left pinky is the leftmost
      // root, the right pinky the rightmost, so no finger crosses another.
      const rootX = palmX + (side === 'left' ? i - 1.5 : 1.5 - i) * 22;
      const rootY = palmY - 24;
      const targets = journeys.get(finger) ?? [];
      const demosHome = demo.includes(HOME_KEY[finger]);
      let tipAnim = '';
      let lineAnim = '';
      if (targets.length) {
        const dur = `${(targets.length * 2.2 + 1).toFixed(1)}s`;
        const vx = glideValues(home, targets, 'x');
        const vy = glideValues(home, targets, 'y');
        const anim = (attr: string, v: { values: string; keyTimes: string; splines: string }) =>
          `<animate attributeName="${attr}" values="${v.values}" keyTimes="${v.keyTimes}"` +
          ` calcMode="spline" keySplines="${v.splines}" dur="${dur}" repeatCount="indefinite"/>`;
        tipAnim = anim('cx', vx) + anim('cy', vy);
        lineAnim = anim('x2', vx) + anim('y2', vy);
      } else if (demosHome) {
        // A home-row lesson key: the finger taps in place.
        tipAnim = `<animate attributeName="r" values="6.5;9;6.5;6.5" keyTimes="0;0.2;0.4;1" dur="2.6s" repeatCount="indefinite"/>`;
      }
      hands.push(
        `<line x1="${rootX}" y1="${rootY}" x2="${home.x}" y2="${home.y}" stroke="#3a3f46" stroke-width="7" stroke-linecap="round">${lineAnim}</line>`,
        `<circle cx="${home.x}" cy="${home.y}" r="6.5" fill="${color}">${tipAnim}</circle>`,
      );
    });
  }

  const width = ROW_X[2] + KEYBOARD_ROWS[2].length * PITCH + 2;
  return (
    `<div class="handguide"><svg viewBox="0 0 ${width} ${palmY + 44}" role="img"` +
    ` aria-label="Hand placement: fingers rest on the home row; the coloured fingertip reaches for each new key and returns.">` +
    keys.join('') +
    hands.join('') +
    `</svg></div>`
  );
}
