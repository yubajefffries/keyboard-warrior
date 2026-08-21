/**
 * Input Fidelity harness page logic. PRD Section 3.1.
 * Uses the exact InputPipeline module the game uses; no renderer involved.
 */

import { InputPipeline, type KeyRecord } from '../input/pipeline';
import { RobotTypist, judgeBurst, type RobotReport } from '../dev/robot';

const TARGET = 'the quick brown fox jumps over the lazy dog; pack my box with five dozen jugs';

const pipeline = new InputPipeline();
const events: KeyRecord[] = [];
const blurLog: number[] = [];
let typed = '';
let repeats = 0;
const held = new Set<string>();

// Burst capture is kept separate from the manual drill so a robot run never
// pollutes the hand-typed panel above it.
let burstSent = '';
let burstObserved = '';
let lastBurst: { report: RobotReport; expected: string; observed: string } | null = null;

const $ = (id: string) => document.getElementById(id)!;

function renderCompare(): void {
  let html = '';
  for (let i = 0; i < TARGET.length; i++) {
    const ch = TARGET[i] === ' ' ? '&nbsp;' : escapeHtml(TARGET[i]);
    if (i < typed.length) {
      html += `<span class="${typed[i] === TARGET[i] ? 'ok' : 'bad'}">${ch}</span>`;
    } else {
      html += `<span class="pending">${ch}</span>`;
    }
  }
  $('typedCompare').innerHTML = html;
  if (typed.length >= TARGET.length) {
    const mismatches = [...TARGET].filter((c, i) => typed[i] !== c).length;
    $('compareResult').textContent =
      mismatches === 0
        ? 'PASS: every character captured in order.'
        : `${mismatches} mismatch(es). A mismatch you did not actually mistype = dropped or reordered event. Retry to confirm.`;
  } else {
    $('compareResult').textContent = `${typed.length} / ${TARGET.length}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const logBody = $('log');
function renderRow(r: KeyRecord): void {
  const tr = document.createElement('tr');
  const mods = [r.shift && 'S', r.ctrl && 'C', r.alt && 'A', r.meta && 'M'].filter(Boolean).join('') || '-';
  tr.innerHTML = `<td>${r.seq}</td><td>${r.type}</td><td>${escapeHtml(r.key)}</td><td>${r.code}</td>` +
    `<td>${r.repeat ? 'Y' : ''}</td><td>${mods}</td><td>${r.timeStamp.toFixed(3)}</td><td>${r.frameTime.toFixed(1)}</td>`;
  logBody.prepend(tr);
  while (logBody.children.length > 30) logBody.lastElementChild!.remove();
}

pipeline.subscribe((r) => {
  if (robot.running) {
    // Fast path during a burst: record what arrived and nothing else. Building
    // 600 table rows mid-run would be measuring the harness, not the pipeline.
    if (r.type === 'down' && !r.repeat && r.key.length === 1) burstObserved += r.key;
    events.push(r);
    return;
  }
  events.push(r);
  renderRow(r);
  $('count').textContent = String(events.length);
  if (r.type === 'down') {
    if (r.repeat) {
      repeats += 1;
      $('repeats').textContent = String(repeats);
    } else {
      held.add(r.code);
      if (r.key.length === 1 && !r.ctrl && !r.alt && !r.meta && typed.length < TARGET.length) {
        typed += r.key;
        renderCompare();
      }
    }
  } else {
    held.delete(r.code);
  }
  $('held').textContent = held.size ? [...held].join(' + ') : 'none';
  const res = pipeline.observedTimestampResolution();
  $('resolution').textContent = res === null ? 'n/a' : `~${res.toFixed(3)} ms`;
  $('caps').textContent = r.capsLock ? 'ON' : 'off';
});

window.addEventListener('blur', () => {
  blurLog.push(performance.now());
  held.clear();
  $('blurs').textContent = String(blurLog.length);
  $('held').textContent = 'none';
});

// ---------- Robot burst (PRD 3.1: the 100+ WPM gate) ----------
const robot = new RobotTypist({
  // Cycle the pangram: it covers every letter plus the semicolon, so a drop
  // cannot hide in a key the drill never presses.
  nextChar: () => TARGET[burstSent.length % TARGET.length],
  onSample: (s) => {
    burstSent += s.sent;
  },
  onFinish: (report) => {
    lastBurst = { report, expected: burstSent, observed: burstObserved };
    renderBurst();
    ($('burstRun') as HTMLButtonElement).disabled = false;
    ($('burstRun') as HTMLButtonElement).textContent = 'Run burst';
    $('count').textContent = String(events.length);
  },
});

function renderBurst(): void {
  if (!lastBurst) return;
  const { report, expected, observed } = lastBurst;
  const verdict = judgeBurst(report, { expected, observed });
  $('burstResult').innerHTML =
    `<div class="verdict ${verdict.pass ? 'pass' : 'fail'}">` +
    `${verdict.pass ? 'PASS' : 'FAIL'} &mdash; ${report.sent} keys at ` +
    `${report.achievedWpm.toFixed(1)} wpm (asked ${report.wpm})</div>` +
    verdict.lines
      .map(
        (l) =>
          `<div class="bline"><div class="head"><span>${escapeHtml(l.label)}</span>` +
          `<b><span class="mark ${l.pass ? 'ok' : 'bad'}">${l.pass ? '✓' : '✖'}</span> ` +
          `${escapeHtml(l.value)}</b></div>` +
          `<div class="detail">${escapeHtml(l.detail)}</div></div>`,
      )
      .join('');
}

$('burstRun').addEventListener('click', () => {
  if (robot.running) return;
  burstSent = '';
  burstObserved = '';
  const btn = $('burstRun') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running...';
  $('burstResult').innerHTML = '';
  robot.start({
    wpm: Number(($('burstWpm') as HTMLSelectElement).value),
    chars: Number(($('burstChars') as HTMLInputElement).value),
    jitterPct: Number(($('burstJitter') as HTMLInputElement).value),
    errorRate: 0,
    seed: 20260821,
  });
});

$('resetCompare').addEventListener('click', () => {
  typed = '';
  renderCompare();
});

$('export').addEventListener('click', () => {
  const payload = {
    schemaVersion: 1,
    userAgent: navigator.userAgent,
    exportedAt: new Date().toISOString(),
    observedTimestampResolutionMs: pipeline.observedTimestampResolution(),
    blurTimestamps: blurLog,
    drill: { target: TARGET, typed },
    burst: lastBurst
      ? {
          note: 'Synthetic in-page events: proves the app layer keeps up, not the OS input path.',
          report: lastBurst.report,
          dispatched: lastBurst.expected,
          received: lastBurst.observed,
          lossless: lastBurst.expected === lastBurst.observed,
        }
      : null,
    events,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `input-fidelity-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

pipeline.attach(window);
renderCompare();
