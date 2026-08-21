/**
 * Input Fidelity harness page logic. PRD Section 3.1.
 * Uses the exact InputPipeline module the game uses; no renderer involved.
 */

import { InputPipeline, type KeyRecord } from '../input/pipeline';

const TARGET = 'the quick brown fox jumps over the lazy dog; pack my box with five dozen jugs';

const pipeline = new InputPipeline();
const events: KeyRecord[] = [];
const blurLog: number[] = [];
let typed = '';
let repeats = 0;
const held = new Set<string>();

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
