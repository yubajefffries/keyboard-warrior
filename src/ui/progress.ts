/**
 * Progress screen. PRD Section 21: "Required, not polish."
 *
 * Shows WPM and accuracy over time, a per-key heatmap, session count, stage
 * gates, and export. Renders to an HTML string so it stays testable and has no
 * hidden dependency on the live game.
 *
 * The heatmap is the honest one: keys the player has never pressed read as
 * untouched rather than perfect. A key with two presses at 100% is not a
 * strength, and colouring it green would lie.
 */

import { gateStatus, keyReport, type KeyReport } from '../profile/mastery';
import { MASTERY_MIN_SAMPLES, MASTERY_RECENT_DAYS, type Profile, type KeyState } from '../profile/types';
import { STAGES, keysTaughtThrough } from '../curriculum/stages';
import { escapeHtml } from './prompt';
import { KEYBOARD_ROWS } from './keyboard';

const STATE_LABEL: Record<KeyState, string> = {
  unseen: 'not taught yet',
  introduced: 'just introduced',
  practiced: 'in progress',
  mastered: 'mastered',
  decayed: 'slipping',
  unverified: 'needs re-checking',
};

export function renderProgress(profile: Profile): string {
  const report = new Map(keyReport(profile).map((r) => [r.key, r]));
  const sessions = profile.sessions;
  const recent = sessions.slice(-30);
  const best = profile.speedTests.reduce((a, b) => (b.wpm > (a?.wpm ?? 0) ? b : a), profile.speedTests[0]);

  return `
    <div class="sheet">
      <h1>${escapeHtml(profile.name)}</h1>
      <p class="sub">${routeLabel(profile)} &middot; ${sessions.length} session${sessions.length === 1 ? '' : 's'}
         &middot; joined ${new Date(profile.createdAt).toLocaleDateString()}</p>

      <div class="cards">
        ${card('Best speed test', best ? `${Math.round(best.wpm)} WPM` : '&mdash;', best ? `${Math.round(best.accuracy * 100)}% accuracy over ${best.durationS}s` : 'No speed test yet')}
        ${card('Recent accuracy', recent.length ? `${Math.round(avg(recent.map((s) => s.accuracy)) * 100)}%` : '&mdash;', `Across the last ${recent.length} session${recent.length === 1 ? '' : 's'}`)}
        ${card('Recent speed', recent.length ? `${Math.round(avg(recent.map((s) => s.wpm)))} WPM` : '&mdash;', 'In lessons, not tests')}
      </div>

      <h2>Over time</h2>
      ${history(recent)}

      <h2>Every key</h2>
      ${heatmap(report)}
      <p class="legend">
        <span class="sw mastered"></span> mastered
        <span class="sw practiced"></span> in progress
        <span class="sw introduced"></span> just introduced
        <span class="sw decayed"></span> slipping
        <span class="sw unverified"></span> needs re-checking
        <span class="sw unseen"></span> not taught yet
      </p>
      <p class="note">A key is only judged on its last ${MASTERY_MIN_SAMPLES} presses within
         ${MASTERY_RECENT_DAYS} days. Until then it reads as introduced, however clean it looks:
         two correct presses is not evidence. A dot marks a key that turns up too rarely to judge
         often &mdash; those never hold a stage up.</p>

      <h2>Stage ${profile.stage}</h2>
      ${gateSummary(profile)}

      <h2>Curriculum</h2>
      ${stageList(profile)}

      <h2>Your save</h2>
      <p class="note">Browser storage is not a safe place for this. Export after every stage, and before
         anything clears your browsing data.</p>
      <div class="rowbtns">
        <button id="exportProfile">Export this profile</button>
        <button id="exportAll" class="ghost">Export every profile</button>
        <button id="importProfile" class="ghost">Import a save file</button>
      </div>
      <p id="transferMsg" class="msg"></p>

      <div class="rowbtns end"><button id="backToMenu" class="ghost">Back</button></div>
    </div>`;
}

function routeLabel(profile: Profile): string {
  const route = profile.route[0].toUpperCase() + profile.route.slice(1);
  return `${route} &middot; Stage ${profile.stage}`;
}

function card(label: string, value: string, detail: string): string {
  return `<div class="card"><span class="label">${label}</span><b>${value}</b><span class="detail">${detail}</span></div>`;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Two sparklines sharing an x axis. Inline SVG: no chart library earns its
 * bytes for 30 points, and the whole page must stay inside the perf budget.
 */
function history(sessions: Profile['sessions']): string {
  if (sessions.length < 2) {
    return `<p class="note">Two sessions are needed before a trend means anything. Keep playing.</p>`;
  }
  const wpm = sessions.map((s) => s.wpm);
  const acc = sessions.map((s) => s.accuracy * 100);
  return `
    <div class="charts">
      <figure>${spark(wpm, '#e8b04a')}<figcaption>WPM &middot; now ${Math.round(wpm[wpm.length - 1])}, best ${Math.round(Math.max(...wpm))}</figcaption></figure>
      <figure>${spark(acc, '#6dc26d', 0, 100)}<figcaption>Accuracy &middot; now ${Math.round(acc[acc.length - 1])}%</figcaption></figure>
    </div>`;
}

function spark(values: number[], color: string, forceMin?: number, forceMax?: number): string {
  const w = 340;
  const h = 70;
  const min = forceMin ?? Math.min(...values);
  const max = forceMax ?? Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 8) + 4;
      const y = h - 6 - ((v - min) / span) * (h - 14);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />
    </svg>`;
}

function heatmap(report: Map<string, KeyReport>): string {
  return `<div class="heat">${KEYBOARD_ROWS.map(
    (row) =>
      `<div class="heatrow">${row
        .map((key) => {
          const r = report.get(key);
          const state = r?.state ?? 'unseen';
          const title = r
            ? `${key.toUpperCase()}: ${STATE_LABEL[state]}, ${Math.round(r.accuracy * 100)}% over its last ${r.presses} presses` +
              (r.lowExposure ? '. Appears rarely, so it never blocks a stage.' : '')
            : `${key.toUpperCase()}: ${STATE_LABEL.unseen}`;
          const rare = r?.lowExposure ? ' rare' : '';
          return `<div class="heatkey ${state}${rare}" title="${escapeHtml(title)}"><span>${escapeHtml(key)}</span></div>`;
        })
        .join('')}</div>`,
  ).join('')}</div>`;
}

/**
 * Why the current stage is or is not going to close. PRD 12 gates a stage on
 * its taught frequent keys being mastered, and "I passed every lesson and
 * nothing happened" is the most confusing thing this game could do silently.
 */
/** One line per unmastered key: what would move it. Shared with the lesson result screen. */
export function describeBlocker(b: { key: string; accuracy: number; presses: number; needed: number }): string {
  return b.needed > 0
    ? `${b.needed} more press${b.needed === 1 ? '' : 'es'} before it can be judged`
    : `${Math.round(b.accuracy * 100)}% over its last ${b.presses}`;
}

function gateSummary(profile: Profile): string {
  const gate = gateStatus(profile, keysTaughtThrough(profile.stage));
  if (gate.ready) {
    return `<p class="note">Every key this stage teaches is solid. Passing its last lesson closes it.</p>`;
  }
  const rows = gate.blocking
    .slice(0, 6)
    .map((b) => `<div class="rl"><span>${b.key.toUpperCase()} &mdash; ${STATE_LABEL[b.state]}</span><b>${describeBlocker(b)}</b></div>`)
    .join('');
  return `
    <div class="result-lines">${rows}</div>
    ${gate.waived.length ? `<p class="note">${gate.waived.map((k) => k.toUpperCase()).join(', ')} appear too rarely to be held against you.</p>` : ''}`;
}

function stageList(profile: Profile): string {
  return `<ol class="stages">${STAGES.map((s) => {
    const cleared = profile.stagesCleared.includes(s.number);
    const current = profile.stage === s.number;
    const mark = cleared ? '✓' : current ? '▸' : '·';
    return `<li class="${cleared ? 'cleared' : current ? 'current' : ''}">
        <span class="mark">${mark}</span> Stage ${s.number}: ${escapeHtml(s.title)}
        <span class="detail">${s.lessons.length} lessons</span>
      </li>`;
  }).join('')}
    <li class="locked"><span class="mark">·</span> Stages 6-10 arrive in later phases</li>
  </ol>`;
}
