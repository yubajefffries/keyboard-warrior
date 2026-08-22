/**
 * Phase 1a app shell. PRD Sections 3.3, 10, 11, 16, 18, 21.
 *
 * Owns the screens and the profile; the encounter, the timed drill, and the
 * progress view own their own behaviour. Everything here is wiring and flow:
 * profile -> placement -> menu -> lesson or speed test -> result.
 *
 * One screen element whose contents are replaced, rather than a dozen hidden
 * divs, because most screens are generated from profile data anyway and a
 * stale hidden div is a bug waiting to be shipped.
 */

import { InputPipeline } from '../input/pipeline';
import { WeaponAudio } from '../audio/sfx';
import { PromptView, escapeHtml } from '../ui/prompt';
import { FingerHint, KeyboardViz, resolveVisibility } from '../ui/keyboard';
import { describeBlocker, renderProgress } from '../ui/progress';
import { Encounter } from '../game/encounter';
import { TimedDrill } from '../modes/drill';
import { absorbSamples, autoKeyboardVisible, gateStatus } from '../profile/mastery';
import {
  ProfileStore,
  createProfile,
  recordActivity,
  recordSpeedTest,
} from '../profile/store';
import { exportFilename, exportProfiles, importProfiles } from '../profile/transfer';
import type { Profile, Route } from '../profile/types';
import { MAX_PROFILES } from '../profile/types';
import {
  PLACEMENT_DURATION_MS,
  PlacementScorer,
  PlacementSource,
  routeFor,
  type PlacementRoute,
} from '../placement/placement';
import { judgeLesson, lessonAt, stage, keysTaughtThrough, STAGES } from '../curriculum/stages';
import { AdaptiveSource, planFor, practiceNote } from '../curriculum/adaptive';
import { easingFrom, pacingFor } from '../game/pacing';
import { newFatigueState, recordToken } from '../game/fatigue';
import { comboVisible } from '../game/scoring';
import {
  SurvivalSource,
  WAVE_HEAL,
  isNewBest,
  wavePlan,
} from '../modes/survival';
import { TAUGHT_KEYS } from '../content/sequences';
import { weakKeys } from '../profile/mastery';
import { WordSource, wordsFor } from '../modes/speedtest';
import { SPEED_TEST_DURATIONS, SpeedTestScorer } from '../modes/speedtest';
import type { SpeedTestResult } from '../profile/types';

// ---------- DOM ----------
const $ = (id: string) => document.getElementById(id)!;
const canvas = $('renderCanvas') as HTMLCanvasElement;
const screenEl = $('screen');
const hudEl = $('hud');
const clockEl = $('clock');
const warningsEl = $('warnings');
const robotPanel = $('robotPanel');
const promptRow = $('promptRow');

// ---------- Core ----------
const store = new ProfileStore();
const pipeline = new InputPipeline();
const audio = new WeaponAudio();
const prompt = new PromptView({ active: $('prompt'), past: $('promptPast'), next: $('promptNext') });
const keyboard = new KeyboardViz($('kbviz'));
const fingerHint = new FingerHint($('fingerHint'));

let profile: Profile | null = null;

const lookahead = () => profile?.settings.lookahead ?? 3;

const encounter = new Encounter({
  canvas,
  prompt,
  hud: hudEl,
  keyboard,
  audio,
  pipeline,
  lookahead,
});

const drill = new TimedDrill({ prompt, keyboard, pipeline, audio, lookahead }, 'speed_test');
/** Warm-ups record as learn: combat and speed-test evidence is preferred by
 *  the mastery engine, and a cold-handed warm-up should not outrank it. */
const warmupDrill = new TimedDrill({ prompt, keyboard, pipeline, audio, lookahead }, 'learn');

pipeline.onWarnings((w) => {
  const msgs: string[] = [];
  if (w.capsLockOn) msgs.push('CAPS LOCK is on');
  if (w.stuckShift) msgs.push('Shift looks stuck down');
  warningsEl.textContent = msgs.join(' | ');
  warningsEl.style.display = msgs.length ? 'block' : 'none';
});
pipeline.attach(window);

// ---------- Screen plumbing ----------
type Chrome = { prompt: boolean; hud: boolean; clock: boolean; keyboard: boolean };
const NO_CHROME: Chrome = { prompt: false, hud: false, clock: false, keyboard: false };

function setChrome(chrome: Partial<Chrome>): void {
  const c = { ...NO_CHROME, ...chrome };
  promptRow.style.display = c.prompt ? 'grid' : 'none';
  hudEl.style.display = c.hud ? 'block' : 'none';
  clockEl.style.display = c.clock ? 'block' : 'none';
  const showKeyboard = c.keyboard && keyboardWanted();
  keyboard.setVisible(showKeyboard);
  // The prompt lifts to clear the keyboard; CSS owns how far.
  document.body.classList.toggle('kb', showKeyboard);
}

/** Placement forces the keyboard on: we do not yet know who is typing. */
let forceKeyboard = false;

function keyboardWanted(): boolean {
  if (forceKeyboard) return true;
  if (!profile) return false;
  // Auto asks the mastery engine, which hides the scaffold once every taught
  // frequent key is mastered and brings it back if one decays.
  return resolveVisibility(
    profile.settings.keyboardViz,
    autoKeyboardVisible(profile, keysTaughtThrough(profile.stage)),
  );
}

function showScreen(html: string, opts: { dim?: boolean } = {}): void {
  screenEl.innerHTML = html;
  screenEl.classList.toggle('dim', opts.dim === true);
  screenEl.classList.add('show');
}

function hideScreen(): void {
  screenEl.classList.remove('show');
  screenEl.innerHTML = '';
}

function on(id: string, handler: () => void): void {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function save(): void {
  if (profile) store.update(profile);
}

// ---------- Profiles ----------
function showProfiles(): void {
  setChrome({});
  robotPanel.style.display = 'none';
  const profiles = store.list();
  const rows = profiles
    .map(
      (p) => `
      <div class="prow">
        <div class="who">
          <b>${escapeHtml(p.name)}</b>
          <span>${p.route[0].toUpperCase() + p.route.slice(1)} &middot; Stage ${p.stage} &middot;
            ${p.sessions.length} session${p.sessions.length === 1 ? '' : 's'}</span>
        </div>
        <button class="small" data-play="${p.id}">Play</button>
        <button class="small ghost" data-delete="${p.id}">Delete</button>
      </div>`,
    )
    .join('');

  showScreen(`
    <div class="sheet narrow">
      <h1 class="big">KEYBOARD WARRIOR</h1>
      <p class="lead">Type like your life depends on it.</p>
      ${profiles.length ? `<div class="plist">${rows}</div>` : '<p>No profiles yet on this browser.</p>'}
      <div class="rowbtns">
        <button id="newProfile" ${store.atCapacity ? 'disabled' : ''}>New profile</button>
        <button id="importHere" class="ghost">Import a save file</button>
      </div>
      ${store.atCapacity ? `<p class="note" style="text-align:center">This browser holds the maximum of ${MAX_PROFILES} profiles.</p>` : ''}
      ${store.persistent ? '' : '<p class="msg bad">This browser is blocking storage. You can play, but nothing will be saved unless you export.</p>'}
      ${store.dropped > 0 ? `<p class="msg bad">${store.dropped} saved profile${store.dropped === 1 ? '' : 's'} could not be read and ${store.dropped === 1 ? 'was' : 'were'} left out. If you have an export file, import it.</p>` : ''}
      ${store.migratedFrom !== null ? `<p class="msg good">Your save was upgraded from an older version of the game.</p>` : ''}
      <p id="transferMsg" class="msg"></p>
    </div>`);

  for (const el of screenEl.querySelectorAll('[data-play]')) {
    el.addEventListener('click', () => openProfile((el as HTMLElement).dataset.play!));
  }
  for (const el of screenEl.querySelectorAll('[data-delete]')) {
    el.addEventListener('click', () => confirmDelete((el as HTMLElement).dataset.delete!));
  }
  on('newProfile', showCreate);
  on('importHere', () => pickImportFile(() => showProfiles()));
}

function confirmDelete(id: string): void {
  const target = store.get(id);
  if (!target) return;
  // PRD 21: delete needs a confirmation AND an export prompt first.
  showScreen(`
    <div class="sheet narrow">
      <h1>Delete ${escapeHtml(target.name)}?</h1>
      <p>Every session, every key, gone. There is no undo and no cloud copy.</p>
      <div class="rowbtns">
        <button id="exportFirst" class="ghost">Export it first</button>
        <button id="reallyDelete">Delete permanently</button>
      </div>
      <div class="rowbtns"><button id="cancelDelete" class="ghost">Keep it</button></div>
    </div>`);
  on('exportFirst', () => downloadJSON(exportFilename([target]), exportProfiles([target])));
  on('reallyDelete', () => {
    store.remove(id);
    if (profile?.id === id) profile = null;
    showProfiles();
  });
  on('cancelDelete', showProfiles);
}

function showCreate(): void {
  showScreen(`
    <div class="sheet narrow">
      <h1>Who is typing?</h1>
      <p>One profile per person. Progress, stats, and settings are all per profile.</p>
      <div class="rowbtns"><input type="text" id="profileName" maxlength="24" placeholder="Name" autocomplete="off" /></div>
      <div class="rowbtns">
        <button id="createProfile">Continue</button>
        <button id="cancelCreate" class="ghost">Back</button>
      </div>
      <p id="createMsg" class="msg"></p>
    </div>`);
  const input = $('profileName') as HTMLInputElement;
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doCreate();
  });
  on('createProfile', doCreate);
  on('cancelCreate', showProfiles);

  function doCreate(): void {
    const name = input.value.trim();
    if (!name) {
      $('createMsg').textContent = 'A name, any name.';
      $('createMsg').className = 'msg bad';
      return;
    }
    const created = createProfile(name);
    const result = store.add(created);
    if (!result.ok) {
      $('createMsg').textContent = result.error;
      $('createMsg').className = 'msg bad';
      return;
    }
    profile = created;
    store.setActive(created.id);
    applySettings();
    showPlacementIntro();
  }
}

function openProfile(id: string): void {
  const found = store.get(id);
  if (!found) return;
  profile = found;
  store.setActive(id);
  audio.ensureStarted();
  applySettings();
  if (!profile.placement) showPlacementIntro();
  else showMenu();
}

// ---------- Placement (PRD 3.3) ----------
function showPlacementIntro(): void {
  setChrome({});
  showScreen(`
    <div class="sheet narrow">
      <h1>Before we start</h1>
      <p class="lead">Put your left index finger on <b>F</b> and your right index finger on <b>J</b>.
         Both keys have a raised bump. That is home row, and you should be able to find it without looking.</p>
      <p>This is a shooting game where typing is the weapon. Every finished word fires the gun.</p>
      <p>Sixty seconds of typing tells us where to start you. It is not a test you can fail:
         the worst outcome is that we start at the very beginning, which is a fine place to start.</p>
      <div class="rowbtns">
        <button id="startPlacement">Start the 60-second check</button>
        <button id="skipPlacement" class="ghost">Skip, start at Stage 1</button>
      </div>
    </div>`);
  on('startPlacement', runPlacement);
  on('skipPlacement', () => {
    if (!profile) return;
    applyRoute({ route: 'beginner', stage: 1, reason: 'You chose to start at the beginning.' }, null);
    showMenu();
  });
}

function runPlacement(): void {
  if (!profile) return;
  audio.ensureStarted();
  hideScreen();
  forceKeyboard = true;
  setChrome({ prompt: true, clock: true, keyboard: true });

  const source = new PlacementSource(Date.now() & 0xffff);
  const scorer = new PlacementScorer();

  drill.start(source, PLACEMENT_DURATION_MS, {
    onPress: (_pressed, expected, correct) => scorer.record(expected, correct),
    onToken: () => source.considerPromotion(scorer.accuracy),
    onTick: (remaining) => setClock(remaining),
    onFinish: (elapsed) => {
      forceKeyboard = false;
      const score = scorer.score(elapsed, source.reachedWords);
      const route = routeFor(score);
      showPlacementResult(route, score.wpm, score.accuracy, source.reachedWords);
    },
    onAbort: (reason) => {
      forceKeyboard = false;
      setChrome({});
      showScreen(`
        <div class="sheet narrow">
          <h1>Let's start that again</h1>
          <p>${escapeHtml(reason)} A timed check only means something if the clock and your hands
             were running together, so this one is discarded.</p>
          <div class="rowbtns"><button id="retryPlacement">Run it again</button></div>
        </div>`);
      on('retryPlacement', runPlacement);
    },
  });
}

function showPlacementResult(route: PlacementRoute, wpm: number, accuracy: number, reachedWords: boolean): void {
  setChrome({});
  showScreen(`
    <div class="sheet narrow">
      <h1>${Math.round(wpm)} WPM at ${Math.round(accuracy * 100)}%</h1>
      <p class="lead">${escapeHtml(route.reason)}</p>
      <div class="result-lines">
        <div class="rl"><span>Starting point</span><b>Stage ${route.stage} &middot; ${route.route}</b></div>
        <div class="rl"><span>On-screen keyboard</span><b>${route.route === 'beginner' ? 'on' : route.route === 'intermediate' ? 'auto' : 'off'}</b></div>
        <div class="rl"><span>Speed Test</span><b>${route.route === 'beginner' ? 'available any time' : 'unlocked'}</b></div>
      </div>
      <div class="rowbtns">
        <button id="acceptRoute">Start at Stage ${route.stage}</button>
        ${route.stage > 1 ? '<button id="overrideRoute" class="ghost">I would rather start at Stage 1</button>' : ''}
      </div>
      <p class="note" style="text-align:center;margin-top:18px">
        ${reachedWords ? '' : 'The check stayed on home-row letters, so it never saw you type words. '}
        You can change this later; Stage 1 is never taken away.</p>
    </div>`);
  on('acceptRoute', () => {
    applyRoute(route, { wpm, accuracy, reachedWords });
    showMenu();
  });
  on('overrideRoute', () => {
    applyRoute({ route: 'beginner', stage: 1, reason: route.reason }, { wpm, accuracy, reachedWords }, route.route);
    showMenu();
  });
}

function applyRoute(
  route: PlacementRoute,
  measured: { wpm: number; accuracy: number; reachedWords: boolean } | null,
  overriddenFrom: Route | null = null,
): void {
  if (!profile) return;
  profile.route = route.route;
  profile.stage = route.stage;
  profile.lesson = 0;
  profile.settings.keyboardViz =
    route.route === 'beginner' ? 'on' : route.route === 'intermediate' ? 'auto' : 'off';
  profile.placement = {
    at: new Date().toISOString(),
    route: route.route,
    wpm: measured?.wpm ?? 0,
    accuracy: measured?.accuracy ?? 0,
    reachedWords: measured?.reachedWords ?? false,
    overriddenFrom,
  };
  save();
}

// ---------- Menu ----------
function showMenu(): void {
  if (!profile) return showProfiles();
  setChrome({});
  robotPanel.style.display = 'none';
  const lesson = lessonAt(profile.stage, profile.lesson);
  const stageInfo = stage(profile.stage);
  const learnLabel = lesson
    ? `Stage ${profile.stage} &middot; ${escapeHtml(lesson.title)}`
    : `Stage ${profile.stage} is not built yet`;

  showScreen(`
    <div class="sheet narrow">
      <h1>${escapeHtml(profile.name)}</h1>
      <p class="sub">${profile.route[0].toUpperCase() + profile.route.slice(1)} &middot;
         ${stageInfo ? escapeHtml(stageInfo.title) : 'Beyond the built curriculum'}</p>
      <div class="menu">
        <button id="playLearn" ${lesson ? '' : 'disabled'}>
          Learn to type<span class="sub">${learnLabel}</span>
        </button>
        <button id="playSpeed" class="ghost">
          Speed test<span class="sub">15 seconds to 2 minutes, no enemies</span>
        </button>
        <button id="playSurvival" class="ghost" ${survivalUnlocked(profile) ? '' : 'disabled'}>
          Survival<span class="sub">${survivalUnlocked(profile)
            ? profile.survivalBest
              ? `Best: wave ${profile.survivalBest.wave}, ${profile.survivalBest.score.toLocaleString()} points`
              : 'Waves without end. How far can you get?'
            : 'Clear Stage 5 to unlock: it takes the whole alphabet'}</span>
        </button>
        <button id="playProgress" class="ghost">
          Progress<span class="sub">Every key, every session, and your export</span>
        </button>
        <button id="playSettings" class="ghost">
          Settings<span class="sub">Keyboard, look-ahead, robot</span>
        </button>
        <button id="switchProfile" class="ghost">
          Switch profile<span class="sub">${store.count} on this browser</span>
        </button>
      </div>
      ${lesson ? '' : `<p class="note" style="text-align:center;margin-top:20px">Every stage is built. Speed test is always open.</p>`}
    </div>`);

  on('playLearn', startLesson);
  on('playSpeed', showSpeedSetup);
  on('playSurvival', showSurvivalIntro);
  on('playProgress', showProgress);
  on('playSettings', () => showSettings(showMenu));
  on('switchProfile', showProfiles);
}

// ---------- Lessons (PRD 11, 12, 16) ----------
/**
 * Accuracy at each death of the current lesson attempt streak, for the
 * timer-was-wrong rule (PRD 13). Reset when the lesson passes or the player
 * moves to a different lesson; deliberately NOT persisted, because "the timer
 * was wrong today" says nothing about next week.
 */
let deathAccuracies: number[] = [];
/** Break-suggestion state, whole play session, across lessons. PRD 11. */
const fatigue = newFatigueState();
/** One line queued for the next result or death screen. Never a toast mid-combat. */
let fatigueNote: string | null = null;
/** The warm-up is offered once per app session at most. */
let warmupHandled = false;

const WARMUP_SECONDS = 45;
const WARMUP_GAP_HOURS = 24;

/** PRD 11: a day or more away earns the offer of a short warm-up first. */
function shouldOfferWarmup(): boolean {
  if (!profile || warmupHandled) return false;
  const gapMs = Date.now() - Date.parse(profile.lastPlayedAt);
  return Number.isFinite(gapMs) && gapMs >= WARMUP_GAP_HOURS * 3_600_000;
}

function showWarmupOffer(): void {
  warmupHandled = true;
  setChrome({});
  showScreen(`
    <div class="sheet narrow">
      <h1>It has been a minute</h1>
      <p class="lead">Cold hands type slowly, and the first minutes back always score worse than you really are.</p>
      <p>${WARMUP_SECONDS} seconds of easy typing first. It counts toward accuracy but not toward
         your speed baselines, so a slow restart cannot mark any key as slipping.</p>
      <div class="rowbtns">
        <button id="startWarmup">Warm up first</button>
        <button id="skipWarmup" class="ghost">Straight to the lesson</button>
      </div>
    </div>`);
  on('startWarmup', runWarmup);
  on('skipWarmup', startLesson);
}

function runWarmup(): void {
  if (!profile) return;
  audio.ensureStarted();
  hideScreen();
  setChrome({ prompt: true, clock: true, keyboard: true });

  // Weak keys first, then whatever the profile has been taught; home row is
  // the floor for a profile with nothing else.
  const taught = keysTaughtThrough(profile.stage);
  const weak = new Set(weakKeys(profile, [...taught]).slice(0, 6));
  const pool = wordsFor(taught.size ? taught : TAUGHT_KEYS);
  const weighted = pool.filter((w) => [...w].some((ch) => weak.has(ch)));
  const source = new WordSource(weighted.length >= 8 ? weighted : pool, Date.now() & 0xffff);

  warmupDrill.start(source, WARMUP_SECONDS * 1000, {
    onTick: (remaining) => setClock(remaining),
    onFinish: () => {
      // Counts toward accuracy and exposure, never toward latency baselines
      // (PRD 11): post-break typing is slow and would poison the EMA.
      const session = recordActivity(profile!, {
        correctChars: warmupDrill.stats.samplesIn().filter((x) => x.correct).length,
        activeMs: WARMUP_SECONDS * 1000,
        accuracy: warmupDrill.stats.totalAccuracy(),
      });
      absorbSamples(profile!, warmupDrill.stats.samplesIn(), {
        sessionId: session.startedAt,
        excludeLatency: true,
      });
      save();
      startLesson();
    },
    onAbort: () => startLesson(), // a lost warm-up is no loss at all
  });
}

function startLesson(): void {
  if (!profile) return;
  if (shouldOfferWarmup()) return showWarmupOffer();
  const lesson = lessonAt(profile.stage, profile.lesson);
  if (!lesson) return showMenu();
  deathAccuracies = [];
  setChrome({});
  const note = practiceNote(profile, planFor(profile, lesson));
  showScreen(`
    <div class="sheet narrow">
      <h1>${escapeHtml(lesson.title)}</h1>
      <p class="sub">Stage ${profile.stage}, lesson ${profile.lesson + 1}</p>
      <p class="lead">${escapeHtml(lesson.objective)}</p>
      ${lesson.introduces.length ? `<p>New keys: <b>${lesson.introduces.map((k) => k.toUpperCase()).join('  ')}</b></p>` : ''}
      ${note ? `<p>${escapeHtml(note)}</p>` : ''}
      <p>${lesson.targetTokens} sequences with the ${profile.stage >= 3 ? 'revolver: one word, one shot' : 'pump shotgun'}.
         Wrong key is a dry fire, and the cursor waits: fix it and carry on. Backspace does nothing here.</p>
      <div class="rowbtns">
        <button id="beginLesson">Begin</button>
        <button id="lessonBack" class="ghost">Back</button>
      </div>
      <p class="keys">Esc pause &nbsp;|&nbsp; F2 words ahead &nbsp;|&nbsp; F9 robot burst</p>
    </div>`);
  on('beginLesson', () => runLesson(lesson));
  on('lessonBack', showMenu);
}

function runLesson(lesson: NonNullable<ReturnType<typeof lessonAt>>): void {
  if (!profile) return;
  audio.ensureStarted();
  hideScreen();
  setChrome({ prompt: true, hud: true, keyboard: true });

  // PRD 16 middle band: Stage 6+ on a non-beginner route drops the buffer to
  // the bottom of the PRD's range. Beginners stay forgiving everywhere.
  const tightBand = profile.stage >= 6 && profile.route !== 'beginner';
  const pacing = pacingFor(profile, lesson, easingFrom(deathAccuracies), { tightBand });
  // Invisible to the player by design; visible to anyone tuning the constants.
  console.debug('[pacing]', pacing);

  encounter.on({
    onTokenComplete: (_token, completed, tokenAccuracy) => {
      const reading = recordToken(fatigue, tokenAccuracy);
      if (reading.suggestBreak) {
        fatigueNote = `Accuracy has slipped ${Math.round((reading.sessionMean - reading.recentMean) * 100)} points below your session. Five minutes away beats bad reps: mastery is watching all of this.`;
      }
      if (completed >= lesson.targetTokens) finishLesson(lesson);
    },
    onDeath: (diagnosis) => {
      const before = easingFrom(deathAccuracies);
      // A death with almost no typing carries no accuracy evidence -- the
      // player walked away or froze, and 0/0 would read as 100%. Record it
      // as streak-breaking instead of timer-indicting.
      const p = encounter.progress;
      deathAccuracies.push(p.presses >= 10 ? p.accuracy : 0);
      showDeath(diagnosis, easingFrom(deathAccuracies) > before);
    },
    onPause: (reason) => showPause(reason),
    onStruggle: (key) => {
      // Only when the scaffold is off (the answer would already be on screen)
      // and only when the finger guide is wanted at all.
      if (!keyboard.shown && profile?.settings.fingerGuide !== 'off') fingerHint.show(key);
    },
    onBurstReport: (html) => {
      robotPanel.style.display = 'block';
      robotPanel.innerHTML = html;
    },
  });
  // Weak keys are over-represented inside the PRD's limits; a decayed key
  // rejoins the pool here, silently. From Stage 3: the lesson dictates the
  // revolver (PRD 15), crawlers and brutes join (PRD 14), and the combo
  // meter becomes visible (PRD 17).
  encounter.start(new AdaptiveSource(lesson, planFor(profile, lesson), Date.now() & 0xffff), {
    pacing,
    weapon: profile.stage >= 3 ? 'revolver' : 'shotgun',
    variety: profile.stage >= 3,
    showCombo: comboVisible(profile.route, profile.stage),
  });
}

function finishLesson(lesson: NonNullable<ReturnType<typeof lessonAt>>): void {
  if (!profile) return;
  const p = encounter.progress;
  encounter.stop();
  setChrome({});

  const outcome = judgeLesson(profile.stage, p.accuracy, p.wpm, p.tokensCompleted, encounter.worstKey());
  const showScore = comboVisible(profile.route, profile.stage);
  const score = encounter.finalizeScore(p.accuracy, p.wpm);

  // Session first: it decides which session id the samples belong to, and the
  // low-exposure rate is measured per session, not per lesson.
  const session = recordActivity(profile, {
    correctChars: p.correctChars,
    activeMs: p.activeMs,
    accuracy: p.accuracy,
  });
  // Fold the samples in whatever the verdict: a failed lesson is still real
  // typing, and mastery needs the evidence more than the scoreboard does.
  absorbSamples(profile, encounter.stats.samplesIn('combat'), { sessionId: session.startedAt });

  if (outcome.passed) deathAccuracies = [];
  const wasStage = profile.stage;
  let advanced = false;
  let stageCleared = false;
  /** Set when the last lesson passed but the stage's keys are not there yet. */
  let gate: ReturnType<typeof gateStatus> | null = null;

  if (outcome.passed) {
    const stageInfo = stage(profile.stage);
    if (stageInfo && profile.lesson + 1 < stageInfo.lessons.length) {
      profile.lesson += 1;
      advanced = true;
    } else {
      // PRD 12: a stage completes when its taught FREQUENT keys are mastered
      // AND its final lesson is passed. Passing the last lesson is only half.
      gate = gateStatus(profile, keysTaughtThrough(profile.stage));
      if (gate.ready) {
        if (!profile.stagesCleared.includes(profile.stage)) profile.stagesCleared.push(profile.stage);
        stageCleared = true;
        const next = STAGES.find((s) => s.number > profile!.stage);
        if (next) {
          profile.stage = next.number;
          profile.lesson = 0;
          advanced = true;
        }
      }
    }
  }
  save();

  showScreen(`
    <div class="sheet narrow">
      <h1>${escapeHtml(lesson.title)}</h1>
      <div class="verdict-big ${outcome.passed ? 'pass' : 'fail'}">${outcome.passed ? 'PASSED' : 'NOT YET'}</div>
      <p class="lead">${escapeHtml(outcome.diagnosis)}</p>
      <div class="result-lines">
        <div class="rl"><span>Accuracy</span><b>${Math.round(outcome.accuracy * 100)}%</b></div>
        <div class="rl"><span>Speed</span><b>${Math.round(outcome.wpm)} WPM</b></div>
        <div class="rl"><span>Sequences</span><b>${outcome.tokensCompleted}</b></div>
      </div>
      ${showScore ? `
      <h2 style="margin-top:26px">Score</h2>
      <div class="result-lines">
        <div class="rl"><span>Keys and words</span><b>${(score.keys + score.words).toLocaleString()}</b></div>
        <div class="rl"><span>Eliminations</span><b>${score.eliminations.toLocaleString()}</b></div>
        ${score.streakBonuses ? `<div class="rl"><span>Streak bonuses</span><b>${score.streakBonuses.toLocaleString()}</b></div>` : ''}
        <div class="rl"><span>Accuracy bonus</span><b>${score.accuracyBonus.toLocaleString()}</b></div>
        <div class="rl"><span>Speed bonus</span><b>${score.wpmBonus.toLocaleString()}</b></div>
        ${score.perfectBonus ? `<div class="rl"><span>Perfect: not one miss</span><b>${score.perfectBonus.toLocaleString()}</b></div>` : ''}
        <div class="rl"><span>Best streak</span><b>${encounter.bestStreak}</b></div>
        <div class="rl"><span><b>Total</b></span><b>${score.total.toLocaleString()}</b></div>
      </div>` : ''}
      ${stageCleared && advanced ? `<p class="lead" style="margin-top:18px">Stage ${wasStage} cleared. Export your progress from the Progress screen while you are thinking about it.</p>` : ''}
      ${stageCleared && !advanced ? `<p class="lead" style="margin-top:18px">Stage ${wasStage} cleared &mdash; the whole course, from finding the two bumps to typing full transmissions under fire. The keyboard is yours now. Speed test is where the numbers keep climbing, and Survival is coming in the next phase.</p>` : ''}
      ${gate && !gate.ready ? gateBlock(gate) : ''}
      ${fatigueNote ? `<p class="note" style="text-align:center;margin-top:14px">${escapeHtml(fatigueNote)}</p>` : ''}
      <div class="rowbtns">
        ${outcome.passed && advanced ? '<button id="nextLesson">Next lesson</button>' : ''}
        ${!outcome.passed || (gate !== null && !gate.ready) ? '<button id="retryLesson">Try it again</button>' : ''}
        <button id="resultMenu" class="ghost">Back to menu</button>
      </div>
    </div>`);
  fatigueNote = null;
  on('nextLesson', startLesson);
  on('retryLesson', () => runLesson(lesson));
  on('resultMenu', showMenu);
}

/**
 * The stage gate held. Say exactly which keys and what would move them, since
 * "passed the lesson but the stage did not close" is otherwise baffling.
 */
function gateBlock(gate: ReturnType<typeof gateStatus>): string {
  const rows = gate.blocking
    .slice(0, 4)
    .map((b) => `<div class="rl"><span>${b.key.toUpperCase()}</span><b>${describeBlocker(b)}</b></div>`)
    .join('');
  return `
    <p class="lead" style="margin-top:18px">Lesson passed. The stage stays open until these keys are solid.</p>
    <div class="result-lines">${rows}</div>
    ${gate.waived.length ? `<p class="note" style="text-align:center;margin-top:10px">${gate.waived.map((k) => k.toUpperCase()).join(', ')} appear too rarely to hold the stage up, so they are not blocking.</p>` : ''}`;
}

/** PRD 16: death is a checkpoint retry with one diagnosis line, nothing more. */
function showDeath(diagnosis: string, eased = false): void {
  setChrome({ prompt: true, hud: true, keyboard: true });
  showScreen(
    `<div class="sheet narrow">
      <h1>THEY REACHED YOU</h1>
      <p class="lead">${escapeHtml(diagnosis)}</p>
      ${eased
        ? '<p>You were accurate, so that one is on the clock, not on you. They will come slower this time.</p>'
        : '<p>Nothing was lost. Misses never kill here; only letting one close the distance does.</p>'}
      ${fatigueNote ? `<p class="note" style="text-align:center">${escapeHtml(fatigueNote)}</p>` : ''}
      <div class="rowbtns">
        <button id="retryCheckpoint">Retry from checkpoint</button>
        <button id="deathMenu" class="ghost">Back to menu</button>
      </div>
    </div>`,
    { dim: true },
  );
  fatigueNote = null;
  on('retryCheckpoint', () => {
    hideScreen();
    // Re-derive pacing so timer-was-wrong deaths take effect on the retry.
    const lesson = profile ? lessonAt(profile.stage, profile.lesson) : null;
    if (profile && lesson) {
      const tightBand = profile.stage >= 6 && profile.route !== 'beginner';
      const pacing = pacingFor(profile, lesson, easingFrom(deathAccuracies), { tightBand });
      console.debug('[pacing]', pacing);
      encounter.setPacing(pacing);
    }
    encounter.retry();
  });
  on('deathMenu', () => {
    encounter.stop();
    showMenu();
  });
}

function showPause(reason: string): void {
  showScreen(
    `<div class="sheet narrow">
      <h1>PAUSED</h1>
      <p class="lead">${escapeHtml(reason)}</p>
      <div class="rowbtns">
        <button id="resumeBtn">Resume</button>
        <button id="pauseSettings" class="ghost">Settings</button>
        <button id="quitLesson" class="ghost">Leave lesson</button>
      </div>
      <p class="keys">Space also resumes.</p>
    </div>`,
    { dim: true },
  );
  on('resumeBtn', doResume);
  on('pauseSettings', () => showSettings(() => showPause(reason)));
  on('quitLesson', () => {
    if (run) {
      // Walking away is an ending too: the run is recorded, not vanished.
      endSurvival('You walked away. The record keeps what you cleared.');
      return;
    }
    encounter.stop();
    showMenu();
  });
}

function doResume(): void {
  if (encounter.currentState !== 'paused') return;
  audio.ensureStarted();
  hideScreen();
  setChrome({ prompt: true, hud: true, keyboard: true });
  encounter.resume();
}

// ---------- Survival (PRD 16, 18) ----------
/**
 * Unlocked by clearing Stage 5 (the whole alphabet) or by placing Advanced.
 * PRD 3.3 gives Advanced "Survival when the mode exists"; everyone else earns
 * it through the curriculum. Learn is never removed either way.
 */
function survivalUnlocked(p: Profile): boolean {
  return p.stagesCleared.includes(5) || p.route === 'advanced';
}

/** Live state of the current run. Null when no run is active. */
let run: { wave: number; kills: number; killsThisWave: number; source: SurvivalSource } | null = null;

function showSurvivalIntro(): void {
  if (!profile || !survivalUnlocked(profile)) return;
  setChrome({});
  const best = profile.survivalBest;
  showScreen(`
    <div class="sheet narrow">
      <h1>Survival</h1>
      <p class="lead">Waves without end. Each one is a bigger crowd with harder words,
         never a faster clock than you have already proven you can beat.</p>
      <p>Health drains while they are close, and a little on every miss. Clearing a wave
         buys some back. When it reaches zero, or one of them reaches you, the run ends.</p>
      ${best ? `<p class="sub">Best run: wave ${best.wave} &middot; ${best.kills} kills &middot; ${best.score.toLocaleString()} points</p>` : ''}
      <div class="rowbtns">
        <button id="startSurvival">Start the run</button>
        <button id="survivalBack" class="ghost">Back</button>
      </div>
    </div>`);
  on('startSurvival', runSurvival);
  on('survivalBack', showMenu);
}

function runSurvival(): void {
  if (!profile) return;
  audio.ensureStarted();
  hideScreen();
  setChrome({ prompt: true, hud: true, keyboard: true });

  const source = new SurvivalSource(keysTaughtThrough(profile.stage), Date.now() & 0xffff);
  run = { wave: 1, kills: 0, killsThisWave: 0, source };
  const plan = wavePlan(profile, 1, source.meanTokenChars);
  console.debug('[survival]', plan);

  encounter.on({
    onKill: () => {
      if (!run) return;
      run.kills += 1;
      run.killsThisWave += 1;
      if (run.killsThisWave >= wavePlan(profile!, run.wave, run.source.meanTokenChars).quota) {
        // Quota met: stop feeding the room. The wave ends when it is empty.
        encounter.setSpawningEnabled(false);
      }
    },
    onTokenComplete: () => {
      // Wave boundary check rides the same beat as everything else: after a
      // kill that emptied a closed room, advance.
      if (run && encounter.aliveCount === 0 && run.killsThisWave >= wavePlan(profile!, run.wave, run.source.meanTokenChars).quota) {
        nextWave();
      }
    },
    onDeath: (reason) => endSurvival(reason),
    onPause: (r) => showPause(r),
    onStruggle: (key) => {
      if (!keyboard.shown && profile?.settings.fingerGuide !== 'off') fingerHint.show(key);
    },
    onBurstReport: (html) => {
      robotPanel.style.display = 'block';
      robotPanel.innerHTML = html;
    },
  });

  encounter.start(run.source, {
    pacing: { spawnIntervalS: plan.spawnIntervalS, walkTimeS: plan.walkTimeS },
    weapon: profile.stage >= 3 ? 'revolver' : 'shotgun',
    variety: true,
    showCombo: true, // PRD 17: always visible in Survival
    mode: 'survival',
  });
  encounter.setMix({ crawlerChance: plan.crawlerChance, bruteChance: plan.bruteChance });
  showWaveBanner(1);
}

function nextWave(): void {
  if (!profile || !run) return;
  run.wave += 1;
  run.killsThisWave = 0;
  run.source.setWave(run.wave);
  const plan = wavePlan(profile, run.wave, run.source.meanTokenChars);
  console.debug('[survival]', plan);
  encounter.setPacing({ spawnIntervalS: plan.spawnIntervalS, walkTimeS: plan.walkTimeS });
  encounter.setMix({ crawlerChance: plan.crawlerChance, bruteChance: plan.bruteChance });
  encounter.setWaveNumber(run.wave);
  encounter.healBy(WAVE_HEAL);
  encounter.setSpawningEnabled(true);
  showWaveBanner(run.wave);
}

const waveBanner = document.getElementById('waveBanner')!;
function showWaveBanner(wave: number): void {
  waveBanner.textContent = `WAVE ${wave}`;
  waveBanner.classList.remove('show');
  void waveBanner.offsetWidth;
  waveBanner.classList.add('show');
}

function endSurvival(reason: string): void {
  if (!profile || !run) return;
  const p = encounter.progress;
  const score = encounter.finalizeScore(p.accuracy, p.wpm);
  const result = { wave: run.wave, kills: run.kills, score: score.total, at: new Date().toISOString() };
  const newBest = isNewBest(profile.survivalBest, result);
  if (newBest) profile.survivalBest = result;

  // A survival run is real typing under the realest pressure the game has:
  // it feeds mastery like any combat does.
  const session = recordActivity(profile, {
    correctChars: p.correctChars,
    activeMs: p.activeMs,
    accuracy: p.accuracy,
  });
  absorbSamples(profile, encounter.stats.samplesIn('combat'), { sessionId: session.startedAt });
  save();

  const finishedRun = run;
  run = null;
  encounter.stop();
  setChrome({});
  showScreen(`
    <div class="sheet narrow">
      <h1>THE RUN ENDS</h1>
      <p class="lead">${escapeHtml(reason)}</p>
      ${newBest ? '<div class="verdict-big pass">NEW BEST</div>' : ''}
      <div class="result-lines">
        <div class="rl"><span>Waves</span><b>${finishedRun.wave}</b></div>
        <div class="rl"><span>Kills</span><b>${finishedRun.kills}</b></div>
        <div class="rl"><span>Accuracy</span><b>${Math.round(p.accuracy * 100)}%</b></div>
        <div class="rl"><span>Speed</span><b>${Math.round(p.wpm)} WPM</b></div>
        <div class="rl"><span>Best streak</span><b>${encounter.bestStreak}</b></div>
        <div class="rl"><span><b>Score</b></span><b>${score.total.toLocaleString()}</b></div>
      </div>
      ${profile.survivalBest && !newBest ? `<p class="note" style="text-align:center;margin-top:12px">Best remains wave ${profile.survivalBest.wave}, ${profile.survivalBest.score.toLocaleString()} points.</p>` : ''}
      <div class="rowbtns">
        <button id="againSurvival">Run it again</button>
        <button id="survivalMenu" class="ghost">Back to menu</button>
      </div>
    </div>`);
  on('againSurvival', runSurvival);
  on('survivalMenu', showMenu);
}

// ---------- Speed Test (PRD 18) ----------
function showSpeedSetup(): void {
  if (!profile) return;
  setChrome({});
  const best = profile.speedTests.reduce<SpeedTestResult | null>((a, b) => (a && a.wpm > b.wpm ? a : b), null);
  showScreen(`
    <div class="sheet narrow">
      <h1>Speed test</h1>
      <p class="lead">Common words, no enemies, no forgiveness for the clock.</p>
      <p>Words are filtered to keys you have been taught, so this measures typing rather than surprise.</p>
      ${best ? `<p class="sub">Your best: ${Math.round(best.wpm)} WPM at ${Math.round(best.accuracy * 100)}% over ${best.durationS}s</p>` : ''}
      <div class="rowbtns">
        ${SPEED_TEST_DURATIONS.map((d) => `<button data-dur="${d}">${d < 60 ? `${d} seconds` : `${d / 60} minute${d > 60 ? 's' : ''}`}</button>`).join('')}
      </div>
      <div class="rowbtns"><button id="speedBack" class="ghost">Back</button></div>
      <p class="note" style="text-align:center;margin-top:18px">
        Clicking away discards the attempt. A paused clock would make the number meaningless.</p>
    </div>`);
  for (const el of screenEl.querySelectorAll('[data-dur]')) {
    el.addEventListener('click', () => runSpeedTest(Number((el as HTMLElement).dataset.dur) as 15 | 30 | 60 | 120));
  }
  on('speedBack', showMenu);
}

function runSpeedTest(durationS: 15 | 30 | 60 | 120): void {
  if (!profile) return;
  audio.ensureStarted();
  hideScreen();
  setChrome({ prompt: true, clock: true, keyboard: true });

  const taught = keysTaughtThrough(profile.stage);
  const scorer = new SpeedTestScorer();
  const source = new WordSource(wordsFor(taught), Date.now() & 0xffff);

  drill.start(source, durationS * 1000, {
    onPress: (_pressed, expected, correct) => scorer.record(expected, correct, null),
    onToken: (token) => scorer.completeToken(token, performance.now()),
    onTick: (remaining) => setClock(remaining),
    onFinish: (elapsed) => {
      const result = scorer.result(durationS, elapsed);
      const session = recordActivity(profile!, {
        correctChars: result.correctChars,
        activeMs: elapsed,
        accuracy: result.accuracy,
      });
      absorbSamples(profile!, drill.stats.samplesIn('speed_test'), { sessionId: session.startedAt });
      recordSpeedTest(profile!, result);
      save();
      showSpeedResult(result, scorer.weakest());
    },
    onAbort: (reason) => {
      setChrome({});
      showScreen(`
        <div class="sheet narrow">
          <h1>Attempt discarded</h1>
          <p class="lead">${escapeHtml(reason)}</p>
          <p>Nothing was recorded and nothing was penalised. A timer that stopped while your hands did not
             would produce a number that means nothing.</p>
          <div class="rowbtns">
            <button id="againSpeed">Run it again</button>
            <button id="abortMenu" class="ghost">Back to menu</button>
          </div>
        </div>`);
      on('againSpeed', () => runSpeedTest(durationS));
      on('abortMenu', showMenu);
    },
  });
}

function showSpeedResult(result: SpeedTestResult, weak: { slowest: string[]; leastAccurate: string[] }): void {
  setChrome({});
  showScreen(`
    <div class="sheet narrow">
      <h1>${Math.round(result.wpm)} WPM</h1>
      <p class="sub">${result.durationS} seconds &middot; ${Math.round(result.accuracy * 100)}% accuracy</p>
      <div class="result-lines">
        <div class="rl"><span>Raw speed, before mistakes</span><b>${Math.round(result.rawWpm)} WPM</b></div>
        <div class="rl"><span>Correct characters</span><b>${result.correctChars}</b></div>
        <div class="rl"><span>Wrong keys</span><b>${result.incorrectChars}</b></div>
        <div class="rl"><span>Peak</span><b>${Math.round(result.peakWpm)} WPM</b></div>
        <div class="rl"><span>Consistency (lower is steadier)</span><b>${result.consistency.toFixed(1)}</b></div>
        ${weak.slowest.length ? `<div class="rl"><span>Slowest keys</span><b>${weak.slowest.map((k) => k.toUpperCase()).join(' ')}</b></div>` : ''}
        ${weak.leastAccurate.length ? `<div class="rl"><span>Least accurate</span><b>${weak.leastAccurate.map((k) => k.toUpperCase()).join(' ')}</b></div>` : ''}
      </div>
      <div class="rowbtns">
        <button id="againSpeed">Again</button>
        <button id="speedMenu" class="ghost">Back to menu</button>
      </div>
    </div>`);
  on('againSpeed', () => runSpeedTest(result.durationS as 15 | 30 | 60 | 120));
  on('speedMenu', showMenu);
}

// ---------- Progress + transfer ----------
function showProgress(): void {
  if (!profile) return;
  setChrome({});
  showScreen(renderProgress(profile));
  on('backToMenu', showMenu);
  on('exportProfile', () => downloadJSON(exportFilename([profile!]), exportProfiles([profile!])));
  on('exportAll', () => {
    const all = store.list();
    downloadJSON(exportFilename(all), exportProfiles(all));
  });
  on('importProfile', () => pickImportFile(() => showProgress()));
}

function downloadJSON(filename: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  setTransferMessage(`Saved ${filename}. Keep it somewhere your browser cannot clear.`, 'good');
}

function setTransferMessage(text: string, kind: 'good' | 'bad'): void {
  const el = document.getElementById('transferMsg');
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${kind}`;
}

/**
 * Import replaces every profile on this browser, and says so before it does.
 * Merging two family saves key by key is a Phase 1b problem; silently picking
 * a winner would be worse than refusing.
 */
function pickImportFile(after: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    // A real export for a full household is well under 1 MB. Refuse before
    // reading: parsing a gigabyte of "JSON" hangs the tab long before
    // validation gets a say.
    if (file.size > 10_000_000) {
      setTransferMessage('That file is far too large to be a Keyboard Warrior export. Nothing was changed.', 'bad');
      return;
    }
    const text = await file.text();
    const result = importProfiles(text);
    if (!result.ok) {
      setTransferMessage(`${result.error} ${result.detail ?? ''}`.trim(), 'bad');
      return;
    }
    store.replaceAll(result.profiles);
    profile = store.list()[0] ?? null;
    if (profile) store.setActive(profile.id);
    after();
    setTransferMessage(
      `Imported ${result.profiles.length} profile${result.profiles.length === 1 ? '' : 's'}` +
        (result.migratedFrom !== null ? `, upgraded from format ${result.migratedFrom}` : '') +
        '.',
      'good',
    );
  });
  input.click();
}

// ---------- Settings ----------
const ROBOT_SPEEDS = [80, 100, 120, 150, 200];
let robotSpeedIndex = 1;
const BURST_CHARS = 200;

function showSettings(back: () => void): void {
  if (!profile) return;
  const s = profile.settings;

  /** One row of segment buttons; data-set attributes drive one generic handler. */
  function seg<T extends string | number>(key: string, values: T[], current: T, labels?: string[]): string {
    return `<span class="seg">${values
      .map(
        (v, i) =>
          `<button data-set="${key}" data-value="${v}" class="${String(current) === String(v) ? 'on' : ''}">${labels ? labels[i] : v}</button>`,
      )
      .join('')}</span>`;
  }

  showScreen(
    `<div class="sheet narrow">
      <h1>Settings</h1>
      <p class="sub">${escapeHtml(profile.name)}</p>
      <div class="settings">
        <div class="row">
          <span>On-screen keyboard</span>
          ${seg('keyboardViz', ['auto', 'on', 'off'], s.keyboardViz)}
        </div>
        <div class="row">
          <span>Finger guide<span class="keyhint">colours + hints</span></span>
          ${seg('fingerGuide', ['highlight', 'off'], s.fingerGuide, ['on', 'off'])}
        </div>
        <div class="row">
          <span>Words shown ahead<span class="keyhint">F2</span></span>
          ${seg('lookahead', [0, 1, 2, 3, 4], s.lookahead)}
        </div>
        <div class="row">
          <span>Text size</span>
          ${seg('textSize', ['normal', 'large'], s.textSize)}
        </div>
        <div class="row">
          <span>High contrast text</span>
          ${seg('highContrast', ['off', 'on'], s.highContrast ? 'on' : 'off')}
        </div>
        <div class="row">
          <span>Intensity<span class="keyhint">low: silhouettes, no flash</span></span>
          ${seg('intensity', ['full', 'low'], s.intensity)}
        </div>
        <div class="row">
          <span>Motion reduction<span class="keyhint">less recoil and sway</span></span>
          ${seg('motionReduction', ['off', 'on'], s.motionReduction ? 'on' : 'off')}
        </div>
        <div class="row">
          <span>Sound volume</span>
          ${seg('audioMix', [0, 0.25, 0.5, 0.75, 1], s.audioMix, ['mute', '25', '50', '75', '100'])}
        </div>
        <div class="row">
          <span>Pause when the window loses focus</span>
          ${seg('pauseOnBlur', ['on', 'off'], s.pauseOnBlur ? 'on' : 'off')}
        </div>
        <div class="row">
          <span>Robot burst speed<span class="keyhint">F4 cycles, F9 runs</span></span>
          <span class="seg">
            ${ROBOT_SPEEDS.map(
              (v, i) => `<button data-robot="${i}" class="${robotSpeedIndex === i ? 'on' : ''}">${v}</button>`,
            ).join('')}
          </span>
        </div>
      </div>
      <p class="note" style="margin-top:16px">Keyboard on Auto follows mastery: it hides once every taught key
         is solid and returns if one slips. Timed speed tests always discard on focus loss regardless of the
         pause setting, because a paused clock makes the number a lie.</p>
      <div class="rowbtns"><button id="settingsBack">Done</button></div>
    </div>`,
    { dim: true },
  );

  for (const el of screenEl.querySelectorAll('[data-set]')) {
    el.addEventListener('click', () => {
      const key = (el as HTMLElement).dataset.set!;
      const raw = (el as HTMLElement).dataset.value!;
      const st = profile!.settings as unknown as Record<string, unknown>;
      if (key === 'lookahead' || key === 'audioMix') st[key] = Number(raw);
      else if (key === 'highContrast' || key === 'motionReduction' || key === 'pauseOnBlur') st[key] = raw === 'on';
      else st[key] = raw;
      save();
      applySettings();
      showSettings(back);
    });
  }
  for (const el of screenEl.querySelectorAll('[data-robot]')) {
    el.addEventListener('click', () => {
      robotSpeedIndex = Number((el as HTMLElement).dataset.robot);
      showSettings(back);
    });
  }
  on('settingsBack', back);
}

/**
 * Push the active profile's settings into every system that renders or plays.
 * Called on profile open and after any settings change, so a change made from
 * the pause menu is visible the moment the game resumes.
 */
function applySettings(): void {
  const s = profile?.settings;
  document.body.classList.toggle('text-large', s?.textSize === 'large');
  document.body.classList.toggle('high-contrast', s?.highContrast === true);
  keyboard.setFingerGuide(s?.fingerGuide !== 'off');
  audio.setVolume(s?.audioMix ?? 0.5);
  encounter.setEffects({
    intensity: s?.intensity ?? 'full',
    motionReduction: s?.motionReduction === true,
  });
}

// ---------- Clock ----------
function setClock(remainingMs: number): void {
  const seconds = Math.ceil(remainingMs / 1000);
  clockEl.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  clockEl.classList.toggle('low', seconds <= 10);
}

// ---------- Global keys ----------
// F-keys only, and only the three no major browser has claimed (F1 help,
// F3 find, F10 menu bar, F11 fullscreen, F12 devtools are all off limits).
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

  if (e.key === 'Escape' && encounter.currentState === 'running') {
    encounter.pause('You paused.');
    return;
  }
  if (e.key === ' ' && encounter.currentState === 'paused') {
    e.preventDefault();
    doResume();
    return;
  }
  if (e.key === 'F2' && profile) {
    e.preventDefault();
    profile.settings.lookahead = profile.settings.lookahead >= 4 ? 0 : profile.settings.lookahead + 1;
    save();
  }
  if (e.key === 'F4') {
    e.preventDefault();
    robotSpeedIndex = (robotSpeedIndex + 1) % ROBOT_SPEEDS.length;
  }
  if (e.key === 'F9') {
    e.preventDefault();
    if (encounter.burstRunning) encounter.stopBurst();
    else if (!encounter.startBurst(ROBOT_SPEEDS[robotSpeedIndex], BURST_CHARS)) {
      robotPanel.style.display = 'block';
      robotPanel.innerHTML =
        '<h3>ROBOT BURST</h3><div class="foot">Start a lesson first: the robot types what the game asks for.</div>';
    }
  }
});

// Blur pauses combat and discards timed attempts (PRD 18, 21).
function onFocusLost(reason: string): void {
  // Timed drills ALWAYS discard on blur (PRD 18): pausing a clock makes the
  // WPM a lie, and that holds whatever the pause preference says.
  if (drill.isRunning) drill.abort(reason);
  else if (warmupDrill.isRunning) warmupDrill.abort(reason);
  else if (profile?.settings.pauseOnBlur !== false) encounter.pause(reason);
}
window.addEventListener('blur', () => onFocusLost('The window lost focus.'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost('The tab was hidden.');
});

// ---------- Boot ----------
const resumed = store.active();
if (resumed) {
  profile = resumed;
  applySettings();
  if (!profile.placement) showPlacementIntro();
  else showMenu();
} else {
  showProfiles();
}
