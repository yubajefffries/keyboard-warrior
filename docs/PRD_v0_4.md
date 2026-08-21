# KEYBOARD WARRIOR - TYPE LIKE YOUR LIFE DEPENDS ON IT

## Product Requirements Document

**Product Type:** Desktop-first browser game / typing tutor
**Genre:** Typing education, first-person action, horror/sci-fi
**Status:** Pre-production
**Version:** 0.4
**Supersedes:** 0.3
**License:** MIT
**Distribution:** Free, open source. Personal use for family and friends. Not a commercial product.

---

# 0. Changelog from 0.3

This revision resolves the v0.3 audit: contradictions fixed, measurement definitions made normative, browser-reality corrections applied. Judgment calls are marked **[REVIEW: ...]** in place.

Contradictions resolved:

- Practice no longer appears unlocked in the Phase 1a placement table before the mode exists; it now reads "when the mode exists," matching how Survival was already handled.
- The 5-minute Speed Test is assigned to Phase 2. Phase 1b still tops out at 2m.
- Combo presentation moved from Phase 2 into Phase 1b so Section 17 (visible from Stage 3, Intermediate+) and phasing agree.
- The hardcoded rare-key list (Q, Z, X, J) is replaced by a data-defined low-exposure key set. J is a home-row anchor and never belonged in the set; semicolon did and was missing.
- Active-target switching happens only at token boundaries; Screamer grace windows must respect that (Section 6).

New normative definitions (previously unspecified):

- Error attribution: errors log against the expected key; the pressed key is also recorded (confusion matrix).
- Response time split into first-key latency and inter-key interval; mastery uses inter-key interval only.
- Mastery evaluation window rewritten with named constants; the circular 50-100-or-7-days rule is gone.
- "Improving baseline" is now a defined EMA formula.
- Shift-chord error and stat rules for Stage 6+.
- Health model for Learn Stages 6-10 on Intermediate/Advanced profiles (the undefined middle band).
- The only death trigger in Learn is an enemy reaching the player.
- Blur during a timed Speed Test discards the attempt.
- Staleness rule so long-unsampled mastered keys re-enter the practice pool.
- Save schema versioning, forward migration, and fail-safe import validation from Phase 1a.
- Session defined for metrics; profile rename/delete/duplicate and a profile cap specified.
- Enemy queue vs the 5-rendered cap clarified; off-screen active-enemy indicator required.

Browser-reality corrections:

- Esc-in-fullscreen is best-effort (Keyboard Lock is Chromium-only; Firefox always exits fullscreen on the first Esc); the fullscreen-exit event itself triggers pause.
- Asset licensing policy added to Build Notes: code is MIT; committed assets must be redistributable; non-redistributable assets live behind a fetch script with a per-asset license manifest.
- MIT-compatible word-list candidates named in Section 20.
- The input harness must record observed timestamp resolution per browser.
- Photosensitivity and contrast gates now cite WCAG 2.3.1 and a numeric contrast floor, making both testable.

Nits: combo MAX multiplier defined (5x), the corrected-miss rule moved into Section 5, warm-up sample handling defined, the accuracy-collapse break trigger given numbers.

Judgment calls to review, all marked in place: `LOW_EXPOSURE_RATE` constant, `BASELINE_ALPHA` and its update floor, opposite-hand Shift measured but not gated, Stage 6-10 Learn keeping miss-as-information, `STALENESS_DAYS` = 30, `MAX_PROFILES` = 10, the 7:1 contrast floor, the 5x combo cap.

---

# 1. Product Overview

Keyboard Warrior is a first-person action typing game that teaches proper touch typing while delivering the atmosphere, sound, progression, and reward systems of a modern FPS.

Typing is the core gameplay mechanic. Enemies approach while letters, words, phrases, or sentences appear as targets. Correct typing fires weapons, damages enemies, opens doors, and completes objectives.

The game MUST function as both a legitimate touch-typing instructional program and an action game worth playing after the player has learned to type. A player who already types well MUST be able to skip the primer and play, not sit through finger-placement drills.

## Target Audience

Young adults and adults in one household and friend group. Skill at first launch will range from hunt-and-peck to competent touch typist.

- **New typist:** does not know home row; needs finger placement, on-screen keyboard, and forgiving lessons.
- **Returning / decent typist:** knows the layout, wants Speed Test, Survival, and harder content without replaying Stage 1.
- Teen-and-up horror theme is intentional and unconstrained by school or child-market requirements.

Each person gets their own local profile. Settings, mastery, horror intensity, and unlocks are per profile, never global.

Explicitly out of scope: children's education market, school deployment, institutional licensing, COPPA/FERPA compliance, rostering integrations, non-US-QWERTY layouts, mobile play.

## Requirement Language

MUST = required for the phase it appears in. SHOULD = strongly preferred. MAY = optional or future.

## Core Principles

1. **Typing is the weapon.** Every keypress has a visible or audible consequence. The mechanic must never feel like a typing test pasted onto a shooter.
2. **Readable text beats atmosphere.** If fog, recoil, camera motion, or flashes make the next character hard to read, atmosphere loses.
3. **One game, many skill levels.** Placement and profile settings route players. The curriculum is not a gate in front of Survival for people who already type.
4. **Learn optimizes for the correct next key. Survival optimizes for pressure.** Do not use one health model for both.
5. **The input pipeline is a product surface.** No feature may sit on the hot path until the Input Fidelity Test is green.
6. **Mastery is conservative.** Prefer leaving the keyboard visible a bit long over hiding it while the player still hunts for keys.
7. **Phase 0/1 art may be ugly. Phase 0/1 feel may not.** Input, prompt text, and one convincing gun kit are not polish.

---

# 2. Success Metrics

Because this is a learning tool, "fun" alone is not the bar. Metrics are per profile, computed locally. No telemetry.

### New typist (placement: Beginner)

- Reaches 25+ WPM at 90%+ accuracy within 10 hours of play
- Can type common words (Stage 5) entirely inside the game
- Per-key mastery for *taught, frequent* keys trends upward across sessions
- Returns for 3+ sessions per week during active learning

### Decent typist (placement: Intermediate or Advanced)

- Speed Test history is at least stable; accuracy SHOULD rise if it started below 96%
- WPM improvement of 15% within 20 sessions applies only if starting Speed Test WPM is under 60. Above that, track accuracy, consistency, and weak-key closure instead
- Voluntarily plays Survival or Practice without being forced through primer content

### Shared

- Speed Test history is visible on the Progress screen
- A profile can be exported and restored on another machine
- Low-exposure keys (Section 12) are not required to trend before the profile is considered healthy

If a metric cannot be read on the local Progress screen, it is not a metric yet.

---

# 3. Scope and Phasing

One phase in flight at a time. A phase is complete when its exit criteria are met. Do not start art-heavy or content-heavy work on an unproven input or text layer.

## Phase 0: Vertical Slice (prove the loop)

Ugly on purpose. No environment art investment.

- Gray-box room, capsule enemies, screen-space prompt, one active target
- Real keyboard input pipeline, miss-and-retry, combat backspace disabled
- One weapon behavior (pump shotgun: fire per completed sequence)
- **One real weapon SFX kit:** fire, dry-fire, pump, impact, shell. All other audio may be placeholder
- Per-key stat tracking (accuracy, latency), split by context
- Pause on blur; explicit resume
- Harness pages for Input Fidelity and Text Legibility remain in the repo

### Phase 0 Exit Criteria (hard gates, no exceptions)

If any test fails, Phase 1a does not begin.

1. **Input Fidelity Test passes** (Section 3.1)
2. **Text Legibility Test passes** (Section 3.2)
3. Typing-to-shoot feels compelling with gray-box visuals and the real shotgun kit
4. Runs 60fps at 1080p on Intel UHD-class integrated graphics, including during a 100+ WPM burst (no GC hitch that looks like lost keys)

## Phase 1a: Tutor That Shoots

Minimum thing a non-typist and a decent typist can both use.

- First-run profile create + 60-second placement (Section 3.3)
- One gray or lightly dressed room
- One enemy (Standard Infected)
- Pump shotgun only
- Stages 1–2 (finger placement, home-row words)
- On-screen keyboard with force on/off
- Learn-mode health rules (Section 16)
- Local profiles + Progress screen (WPM, accuracy, per-key heatmap)
- Speed Test: 30s and 60s
- Decent typists who place Intermediate+ skip to Speed Test / sandbox encounter using home-row and common words

**Exit criteria:**

- A hunt-and-peck player can finish Stage 2 without leaving the game
- A decent typist can create a profile, place out of the primer, and complete a Speed Test in the first session
- Keyboard viz can be forced on or off per profile
- Export/import JSON works

## Phase 1b: Course to Common Words

- One environment pass: abandoned laboratory (still inside the performance budget)
- Enemies: Standard Infected, Crawler, Brute
- Weapons: Pump Shotgun, Revolver
- Stages 3–5 (upper row, lower row, common words)
- Mastery engine, decay, auto-hide
- Speed Test: 15s / 30s / 60s / 2m
- Intensity, high-contrast text, and motion-reduction settings
- Lesson retry diagnosis line
- Combo presentation for Stage 3+ / Intermediate+ (hidden in early Learn so beginners are not dangled a system they cannot reach; Section 17)

**Exit criteria:** a beginner can go from zero to typing common words entirely inside the game. A decent typist can play the same encounters at Intermediate+ content without the keyboard viz.

## Phase 2: Full Curriculum and Survival

- Stages 6–10 (Shift, punctuation, numbers, sentences, paragraphs)
- Remaining weapons and enemies
- Survival with complexity-based scaling
- Practice mode, including Practice Problem Keys from Speed Test
- Second environment
- Speed Test: 5m duration added

## Phase 3: Campaign and Polish

- Story campaign
- Full audio layering and spatial audio
- Additional environments
- Optional AI-generated Infinite Campaign
- Transparent-hands finger guide, if usability testing supports it

## 3.1 Input Fidelity Test (the 100+ WPM lossless input test)

Rationale: every later system trusts that recorded keystrokes are true. Browsers were built for email, not games. Under fast typing they can drop keys, reorder near-simultaneous presses, lose input on focus change, and surrender shortcuts before the game sees them. Cheap keyboards add ghosting. A typing game that miscounts typing is not buggy, it is broken.

Test harness: a minimal Babylon.js page that displays text, logs every event, and compares the log against what was physically typed. The input layer MUST NOT depend on the scene graph. If rendering can block the logger, the test is invalid.

Log MUST include: `key`, `code`, `repeat`, modifiers, `timeStamp`, sequence number, and frame time of the event.

The harness MUST also record the observed timestamp resolution per browser. Browsers coarsen event timestamps (roughly 100 microseconds on Chromium; 1 ms or coarser on Firefox depending on privacy settings). The timing-precision gate below is judged against measured resolution, not assumed precision.

The test MUST pass in Chrome, Edge, and Firefox on target business-class hardware:

- **Lossless capture:** zero dropped keystrokes at sustained 100+ WPM
- **Correct ordering:** near-simultaneous keypresses arrive in press order
- **Focus resilience:** alt-tab, click-out, and OS notification mid-typing; no stuck keys, no phantom input. Encounter pauses on blur and resumes only on an explicit click or Space
- **Shortcut safety:** combat sequences MUST NOT require Ctrl, Alt, or Cmd. Keyboard Lock / `preventDefault` is best-effort for Ctrl+W and Ctrl+T and MUST be documented as such
- **Rollover check:** common 2-key and 3-key combinations register on a standard membrane keyboard; known ghosting limits are documented
- **Repeat ignored:** held keys MUST NOT auto-advance combat text
- **Caps Lock / stuck Shift:** detected and surfaced; they MUST NOT silently rewrite expected characters
- **Timing precision:** timestamps stable enough for per-key latency (Section 13)
- **Hitch budget:** JS pauses that would look like lost keys during a burst fail the test even if the log is complete

Deliverable: a written pass/fail log per browser, kept in the repo. Rerun after any input-layer change or browser update.

Godot (or another desktop shell) is a fallback only if this test cannot be made green in the three target browsers. Do not dual-track engines in Phase 0.

## 3.2 Text Legibility Test

Rationale: touch typing fails if the next character is hard to see. Horror presentation is a threat to the product.

Harness: the Phase 0 scene with the real prompt renderer, recoil, enemy motion, fog, and error flash enabled.

MUST pass at 1080p on the target UHD-class machine:

- The active prompt meets a **7:1** WCAG contrast ratio floor in both default and High Contrast Text modes **[REVIEW: default mode could relax to 4.5:1 if 7:1 fights the art direction]**
- Character size remains readable at the default sitting distance; a size step exists in settings
- Recoil, camera auto-face, and enemy lunge do not move the prompt. The prompt is screen-space (or a motion-locked reticle plane)
- Error feedback is visible without relying on red alone
- Flashes comply with **WCAG 2.3.1** (no more than three general or red flashes per second, within its luminance thresholds) and never wash out the current character
- Fog and darkness may hide the room; they MUST NOT hide the prompt

## 3.3 First-Run Placement

On first launch of a new profile, before any lesson:

1. Short explanation: sit at home row, F and J bumps, this is a shooting game that types.
2. A 60-second placement drill: home-row letters, then a few common words if accuracy stays high.
3. Route the profile:

| Result | Route | Keyboard viz default | Mode defaults |
| --- | --- | --- | --- |
| Hunt-and-peck / cannot hold home row | **Beginner**: Stage 1 | On | Learn, forgiving health, combo hidden |
| Knows home row, shaky speed or accuracy | **Intermediate**: Stage 3 or 5 depending on key coverage | Auto | Learn available; Speed Test unlocked; Practice when the mode exists (Phase 2) |
| Clean common-word typing | **Advanced**: skip primer | Off | Speed Test unlocked; Practice and Survival when the modes exist. Learn remains available to fill gaps |

The player can override the route. Placement never deletes the option to start at Stage 1.

A decent typist MUST be able to finish placement + one Speed Test in a single short session.

---

# 4. Core Product Principle: Typing Is the Weapon

The typing mechanic must never feel separate from the game.

- Beginner shotgun: complete `asdf`, shotgun fires, shell ejects, pump cycles, next sequence appears
- Intermediate revolver: each completed word fires one shot
- Automatic weapons: fire cadence follows typing, but see Section 15 for low-WPM automatic behavior so a new typist’s SMG does not sound like a broken pellet gun

Every correct key SHOULD produce a small confirmation (hit marker and/or soft tick). Every miss produces dry-fire. The gun is the tutor’s metronome.

---

# 5. Error Handling

The single most load-bearing mechanic. Model: **miss and retry**.

Shared rules, all combat-like typing including Learn encounters:

- A wrong keypress produces a dry-fire click and a brief error flash on the prompt
- The cursor does not advance; the player presses the correct key to continue
- Backspace does nothing during combat / Learn encounters
- The error is logged once against the **expected** key. The pressed key is also recorded, building a per-profile confusion matrix (adjacent-finger confusions feed Practice diagnostics)
- Errors never stall the flow (no dialog, no extra confirm)
- A miss that is then correctly typed still counts as one error for accuracy. Correction never erases the logged error

### Shift and chords (Stage 6+)

- A wrong-case letter is one error attributed to the letter and flagged `case_error`. Shift itself is never charged
- The `code` field records which Shift was used (ShiftLeft / ShiftRight). Opposite-hand Shift compliance is tracked as a stat and surfaced in Practice; it is measured, not gated, and same-hand Shift never fails a lesson **[REVIEW: gate it later if the family develops bad habits]**

### Learn to Type and campaign lessons

Error = information.

- Dry-fire + flash + log
- Combo breaks if combo is visible in this stage
- Health is not drained by a single miss
- Time pressure is a grade and a closing-distance warning, not a wipe, through Stage 5
- Death, if it happens at all, is a checkpoint retry plus a one-line diagnosis (`R was 70% this attempt`)

### Survival and explicit challenge encounters

Error = the full stack.

- Dry-fire + flash + log + combo break + a small health drain
- Still miss-and-retry; still no backspace
- Still punished exactly once per miss

Backspace exists in exactly two places:

1. Speed Test mode, standard typing-test behavior (corrected vs uncorrected)
2. A dedicated correction lesson that teaches the backspace reach

---

# 6. Target Disambiguation and Prompt Rendering

When multiple enemies are on screen:

- Exactly one target is **active**; its prompt is the only text that accepts input
- Upcoming targets are visible in the world but grayed; they cannot be typed
- On completion, the next target activates automatically by priority, not only by distance
- The content engine MUST never present two input-accepting strings at once

### Activation priority

1. Deadline threat (Screamer about to call reinforcements)
2. Immediate lethal threat
3. Nearest remaining enemy

### Switching rule

The active target changes **only at token boundaries** (a completed word or sequence). A Screamer whose timer goes live mid-token queues the switch for the next boundary; it never yanks input mid-word. Consequently, Screamer grace windows MUST be at least one maximum-token window generous at any difficulty (see Survival Scaling).

### Prompt rendering

- Active prompt is **screen-space** (or a locked plane on the reticle). World-space letters on a moving mesh are forbidden for the active string
- World highlight (light, outline, or marker) shows *which* enemy is active
- If the active enemy leaves the viewport, an off-screen directional indicator MUST mark it; encounters SHOULD keep the active enemy in frustum
- Upcoming enemy labels MAY be short world-space tags; they MUST stay secondary
- Default typeface is a highly readable UI face, not a horror display font. A larger size and High Contrast Text toggle are required from Phase 1b
- Error state MUST be distinguishable without color alone (weight, underline, or icon plus color)

This removes the classic multi-word ambiguity problem and keeps gaze on a stable line of text.

---

# 7. Platform and Performance

## Platform

- Desktop browser: modern Chrome, Edge, Firefox; Safari deferred unless Phase 1b is already green
- Windows and macOS
- Physical keyboard required
- **US QWERTY only.** ANSI and common tenkeyless boards are in scope. ISO Enter shape is visual-only; bindings stay QWERTY
- Full-screen supported. Esc opens pause where the browser allows interception, which is **best-effort**: Keyboard Lock is Chromium-only, and Firefox always exits fullscreen on the first Esc. The fullscreen-exit event MUST itself trigger pause, so the outcome is always "game paused" even when fullscreen drops
- Combat key sequences MUST avoid modifier traps. Do not design lessons around Ctrl/Alt/Cmd

## Performance Budget (hard requirements)

Target hardware: basic business-class PC, Intel UHD-class integrated graphics. No gaming GPU.

- 60fps at 1080p
- Low-poly models
- Baked lighting preferred; maximum 2 dynamic lights per scene
- Sprite-based particles only
- Maximum 5 enemies rendered simultaneously
- No post-processing stack (no bloom chains, SSAO, motion blur)
- Prompt renderer is cheap and stable; it is not allowed to hitch during a burst
- Asset budget enforced from Phase 0

## Engine

**Babylon.js** (WebGL, WebGPU where available). TypeScript.

Input, profile I/O, and content filtering MUST be testable without a loaded combat scene.

Godot is a fallback only after Section 3.1 fails across target browsers. Unity/Unreal rejected for deployment overhead.

---

# 8. Art Direction

Dark science fiction / horror: infected humans and unnatural creatures. Not limited to traditional zombies.

Quality comes from lighting mood, atmosphere, fog, animation, and audio rather than asset density, always inside the performance budget.

**Intensity is per profile** (Section 21): silhouette / low-gore default SHOULD exist so a family member can play the same systems without the full horror treatment. Intensity never changes pedagogy.

Environments (incremental): abandoned laboratory, underground bunker, hospital, subway tunnel, industrial complex, ruined city, others as capacity allows.

Phase 0–1a MAY ship capsules and a convincing weapon rig. “Modern independent FPS” mood is a Phase 1b+ target, not a Phase 0 promise.

## Player Perspective

First person. Visible: weapon, arms, reload, recoil, casings, impacts. No WASD during typing combat.

Recoil and weapon motion MUST NOT move the prompt.

---

# 9. Movement System

Rail-shooter style:

1. Player moves automatically through the environment
2. Stops at encounter areas
3. Auto-faces the next threat **between** targets
4. Completes the typing encounter
5. Continues when the area is clear

During an active target, yaw/pitch are frozen or heavily damped. Hands never leave typing position.

Advanced free-movement MAY be explored post-Phase 3.

---

# 10. Keyboard Visualization

An on-screen keyboard near the bottom of the screen during beginner play.

Shows: full layout, home-row emphasis (`A S D F` / `J K L ;` with F and J bump markers), current target key, correct finger via color-coded zones, keypress animation, next required key.

## Auto-Hide Rule

The visualization is a scaffold. Touch typing requires eyes on the text.

- Auto-hide when every **taught, frequent** key is mastered (Section 12). Low-exposure keys (Section 12) do not block hide
- Settings can force On or Off at any time and override auto behavior
- When hidden, a brief non-intrusive finger-zone hint MAY flash after repeated errors on the same key
- Advanced placement defaults to Off. Beginner defaults to On

## Finger Mapping

Left pinky `Q A Z`, left ring `W S X`, left middle `E D C`, left index `R F V T G B`, right index `Y H N U J M`, right middle `I K ,`, right ring `O L .`, right pinky `P ; /`, thumbs `Space`. Additional: opposite-hand Shift, Enter, Backspace, number row.

Finger Guide options: Key Highlighting, Animated Finger, Transparent Hands (Phase 3, after usability testing), Off.

---

# 11. Typing Curriculum

Progression is intentional, never random text. Content is filtered to the keys the profile has been taught (and, after Stage 2, to a mix of mastered and in-progress keys).

- **Stage 1: Finger placement.** F and J, then `A S D F` and `J K L ;`. Short combinations: `fj`, `ff`, `jj`, `asdf`, `jkl;`
- **Stage 2: Home row words.** Real and patterned combinations; muscle memory over meaning
- **Stage 3: Upper row.** Keys added in small groups, mixed with mastered keys
- **Stage 4: Lower row.** Same incremental process
- **Stage 5: Common words.** Real vocabulary filtered to the mastered key set
- **Stage 6: Capitalization.** Opposite-hand Shift, visually demonstrated
- **Stage 7: Punctuation.** Period, comma, question mark, exclamation, apostrophe, quotes, colon, semicolon
- **Stage 8: Numbers.** Correct fingers on the number row when numbers appear. Goal is competence under pressure, not assuming the player will touch-type digits for the rest of life
- **Stage 9: Sentences.** Natural sentences with rising pressure
- **Stage 10: Paragraphs.** Boss fights, door hacks, transmissions, timed escapes

### Lesson anatomy

Default lesson:

- 3–6 minutes
- One objective
- One mid-lesson checkpoint on anything longer than ~4 minutes
- Pass/fail from Section 12
- Esc pauses; resume is explicit
- On fail: retry from checkpoint, show one diagnosis line, no extra punishment

Warm-up: if the profile’s last session was more than a day ago, SHOULD offer a 30–45 second home-row or weak-key warm-up before a graded lesson. Warm-up samples count toward accuracy but are excluded from latency baselines; post-break typing is slow and would poison the EMA.

If accuracy collapses mid-session, defined as 10+ percentage points below the session’s rolling mean across the last 20 tokens, SHOULD suggest a break rather than keep writing bad samples into mastery.

### Placement vs curriculum

Beginner walks Stages in order. Intermediate and Advanced may jump to the first stage that contains unmastered frequent keys, or ignore Learn entirely.

---

# 12. Mastery Engine

Gates progression and keyboard auto-hide. All numeric thresholds are tunable constants.

### Key states

`unseen` → `introduced` → `practiced` → `mastered` → (optional) `decayed`

### Response time definitions

**First-key latency** is prompt render to the first keypress of a token; it includes read and recognition time. **Inter-key interval** is previous keypress to this keypress. They are separate stats. Mastery and baselines use inter-key interval only; first-key latency is reported separately on the Progress screen.

### Per-key mastery

A key is evaluated over its last `MASTERY_WINDOW` presses (named constant, default 75). No evaluation occurs until the key has `MASTERY_MIN_SAMPLES` (default 30) within the last 7 days.

A key is **mastered** when, within that window:

- Accuracy ≥ 95%
- Average inter-key interval is within 1.5× of **that key’s own improving baseline**, or within 1.8× of the player’s per-finger median inter-key interval if the key is newly introduced

**Improving baseline** (normative definition): an exponential moving average of the key’s per-session median inter-key interval, `BASELINE_ALPHA` default 0.3, updated only on sessions with 10+ samples for that key **[REVIEW: alpha and the update floor are estimates; tune in 1b]**.

Do not compare a brand-new key only against a global home-row median. New keys are supposed to be slower.

Samples are stored by context: `learn`, `combat`, `speed_test`. Adaptive content SHOULD prefer combat and speed-test samples when they exist.

### Low-exposure keys (replaces the fixed rare-key list)

A taught key is **low-exposure** when its observed sample rate falls below `LOW_EXPOSURE_RATE` (default 10 presses per session, rolling over the last 5 sessions) **[REVIEW: constant is a guess]**. In practice this catches Q, Z, X, semicolon, and most punctuation. It does not catch J, a home-row anchor with heavy drill exposure that never belonged in a frequency-based exemption list.

Low-exposure keys require mastery to *complete their introducing stage*, but MUST NOT block keyboard auto-hide or Stage 5 completion if frequent keys are mastered. They remain in the silent practice pool, and the pool MUST inject them at a floor rate so they keep accruing samples.

### Mastery decay and staleness

If a mastered key’s rolling accuracy drops below 85% with n ≥ 30, it silently becomes `decayed` and re-enters the practice pool. Do not toast “you forgot R.”

A mastered key with zero samples for `STALENESS_DAYS` (default 30) becomes `unverified` **[REVIEW]**: it keeps its badge on the heatmap but silently re-enters the practice pool until it re-confirms. Without this rule, keys that stop appearing hold stale mastery forever, because decay needs samples to fire.

### Lesson pass criteria

- 90% or better accuracy
- Stage WPM floor (Stage 1: 10 WPM; later floors tuned in Phase 1b and kept as constants)

### Stage gate

A stage completes when its **taught frequent keys** are mastered and its final lesson is passed. That is what triggers auto-hide checks.

---

# 13. Adaptive Learning Engine

Each profile tracks per-key accuracy and latency by context.

Example snapshot:

| Key | Accuracy | Inter-key interval | State |
| --- | ---: | ---: | --- |
| A | 99% | 180 ms | mastered |
| D | 92% | 260 ms | practiced |
| R | 76% | 430 ms | introduced |
| T | 73% | 470 ms | introduced |

### Weak-key injection

Weak keys are over-represented, but the run MUST still feel like a shootout.

- At most 25–40% of upcoming tokens may be chosen primarily to hit a weak key
- Surround them with mastered keys so combos and kills still happen
- Never build a wave that is only the player’s failures

### Adaptive difficulty

Enemy timing accounts for average WPM, recent WPM, accuracy, key-specific accuracy, and current lesson.

- Learn: 20–40% more completion time than recent performance requires. If a lesson is consistently failed at ≥90% accuracy, the timer is wrong, not the player
- Survival / challenge: buffer shrinks or disappears; required speed still MUST NOT exceed roughly the profile’s demonstrated peak WPM

---

# 14. Enemy Design

Enemies map to typing mechanics. One active target at a time (Section 6).

- **Standard Infected:** slow, beginner sequences and short words
- **Crawler:** fast, very short targets (`run`, `hit`, `red`), tests recognition speed
- **Brute:** high health, multiple words and phrases, boss-like
- **Screamer:** deadline threat; priority 1 if its timer is live
- **Flying Creature:** upper-row practice
- **Ground Creature:** lower-row practice
- **Apparition:** intermittent, rewards accuracy over speed
- **Armored Enemy:** layered targets (`BREAK`, `ARMOR`, `NOW`), each completion strips a layer

Phase 1a ships only Standard Infected. 1b adds Crawler and Brute. The rest are Phase 2.

---

# 15. Weapon Progression

**In Learn, the lesson dictates the weapon.** Weapons are pedagogical tools first. In Survival, any unlocked weapon may be selected.

- **Pump Shotgun** (beginner): fires per completed short sequence; slow, readable rhythm
- **Revolver:** one word, one shot
- **Semi-Automatic Pistol:** short segments fire rounds
- **Submachine Gun:** intended per-character fire at higher WPM. Below a tunable threshold, fire in 2–3 key bursts so low speed still sounds like a gun
- **Assault Rifle:** sustained phrases and sentences
- **Minigun:** high-WPM reward, sustained rapid typing
- **Sniper Rifle:** one long difficult phrase, one powerful shot; accuracy weighted heavily
- **Rocket Launcher:** paragraph completion triggers an explosive attack
- **Grenade Launcher:** punctuation and number exercises

Unlocks follow stage completion *or* placement. An Advanced profile SHOULD start with shotgun and revolver available and unlock later weapons as Speed Test / Survival milestones are hit, so a decent typist is not stuck on the pump until they replay Stage 5.

---

# 16. Player Health and Failure

Health is remaining reaction time under threat. It is not a morality score.

### Learn (through Stage 5, and any profile on Beginner)

- Time can close distance and raise warning audio
- Screen intensity stays mild; no panic stack that hides the prompt
- Misses do not chunk health
- A lesson does not end instantly from one mistake
- Death (defined below) is a retry from checkpoint with a diagnosis line and no other penalty

### Learn Stages 6–10 on Intermediate and Advanced profiles

The middle band, previously undefined. **[REVIEW: defaults chosen; add teeth if the family finds it toothless]**

- Misses remain information: dry-fire, flash, log, combo break; no health drain from a single miss
- Time pressure is real from Stage 6: enemies close faster, and an enemy reaching the player ends the lesson
- Death is still a checkpoint retry with a diagnosis line, never a run wipe
- Explicitly labeled **challenge lessons** MAY use the full Survival stack; they are opt-in and marked before entry

### Death trigger (all Learn)

The only thing that kills a player in Learn is an enemy physically reaching them. Misses never kill, and timers matter only because they let enemies close distance.

### Survival and late campaign challenge

- Health drains from elapsed time under threat and from misses
- Enemies close in, warning audio builds
- Screen intensity MAY rise but MUST obey the Text Legibility Test
- Death is a run end or checkpoint, depending on mode

---

# 17. Scoring and Combo

Score components: correct keys, word completions, eliminations, accuracy bonus, WPM bonus, combo bonus, no-error streaks, perfect encounters.

Scoring MUST NOT reward reckless speed over accuracy. In Learn, accuracy is weighted higher than WPM.

### Combo

- 10 correct = 2x, 25 = 3x, 50 = 4x, 100 = 5x (MAX; the multiplier caps there) **[REVIEW]**
- Errors break combo
- Hidden in Beginner Learn through Stage 2 so early players are not staring at a meter they cannot fill
- Visible from Stage 3, Intermediate+, Speed Test (optional), and Survival
- Weapon audio/visuals intensify at high combo only when the prompt remains readable

---

# 18. Game Modes

- **Learn to Type:** structured curriculum (Sections 11–12)
- **Campaign:** story levels using learned skills (Phase 3)
- **Survival:** continuous waves; complexity scaling below
- **Speed Test:** 15s / 30s / 60s / 2m / 5m (5m ships in Phase 2)
- **Practice:** home row, weak keys, capitals, numbers, punctuation, custom text, common words, difficult words

Mode availability depends on placement, not on a single forced campaign path. Learn is never removed.

## Survival Scaling Rule

Scale **complexity, not raw speed**. Typing speed has a physical ceiling.

Levers:

- More enemies queued (still one active target; enemies beyond the 5-rendered cap stay unspawned until a slot frees)
- Longer and rarer vocabulary
- Punctuation, capitalization, and number density
- Mixed-mechanic waves
- Shorter Screamer grace windows (never shorter than one maximum-token window; Section 6)
- Accuracy requirements for bonus objectives

Required completion speed never exceeds roughly the profile’s demonstrated peak WPM.

## Speed Test Metrics

Standard definition: **WPM = (characters ÷ 5) ÷ minutes**, characters include spaces.

Also: raw WPM, accuracy, correct/incorrect characters, corrected/uncorrected errors, consistency, peak WPM, slowest keys, least accurate keys.

**Practice Problem Keys** generates a Practice lesson from weaknesses (Phase 2). The corrected-miss rule for combat lives in Section 5.

Blur during a timed test discards the attempt: no score is recorded and no penalty applies. A paused-and-resumed timer would produce garbage WPM.

---

# 19. Audio Design

Audio is a headline feature. The shotgun loop is the Phase 0 proof.

### Phase 0 MUST

One finished weapon kit: fire, dry-fire (error), pump/cycle, impact, shell casing. Soft correct-key tick MAY ship in Phase 0.

### Phase 1

Functional enemy and UI sounds. Mix slider: SFX vs atmosphere. Key feedback MUST remain audible when atmosphere is up.

### Phase 3

Full layering and spatial audio.

- Weapons: mechanical action, mag, reload, explosion, space echo
- Environment: wind, machinery, drip, alarms, distant creatures, vents
- Enemies: idle, move, vocalize, alert, attack, damage, death, close breathing
- Spatial: unseen threats heard before they are seen
- Jump-scare stingers MUST NOT be the primary teacher. They are easy to disable via Intensity

---

# 20. Content Generation

No AI required for the standard game.

- Curated word lists with key-set and difficulty metadata. Name the source and license in the repo. MIT-compatible candidates: Norvig’s count_1w frequency list, SCOWL, google-10000-english; avoid SUBTLEX inside an MIT repo (non-commercial license). Add a hand-edited early-stage lexicon on top
- Early stages (`asdf jkl;`) have a tiny language; ship patterned drills *and* a curated mini-lexicon so Stage 2 is not a random letter hose
- Sentence libraries for later stages
- Filter all output to taught / allowed keys
- Vary content between playthroughs; memorizing a script must not be a viable strategy

### Optional AI (Phase 3+, optional mode only)

Infinite Campaign MAY generate mission text tuned to WPM, weak keys, and difficulty. Validate against the key-set filter and length limits before gameplay. AI is never required for the core curriculum.

---

# 21. User Progression, Settings, and Data

## Profiles

Multiple local profiles (family use). Per profile:

- Placement route and current lesson
- Keyboard viz preference and mastery state
- WPM / accuracy history
- Per-key stats by context
- Weak keys, weapon unlocks, achievements
- Survival records, speed-test history
- Campaign progress
- Intensity, audio mix, text size, high contrast, motion reduction

Profile management: rename, delete (confirmation plus an export prompt first), duplicate, and a cap of `MAX_PROFILES` (default 10) **[REVIEW]**.

A **session**, for every metric that counts sessions: continuous play separated from other play by 30+ minutes of idle.

## Progress screen (Phase 1a)

Required, not polish. Shows WPM and accuracy over time, per-key heatmap, session count, stage gates, and export.

## Settings that MUST exist by Phase 1b

- Keyboard visualization: Auto / On / Off
- Finger guide mode
- Text size
- High Contrast Text
- Intensity: Low (silhouettes, no gore, no stingers) / Full
- Motion reduction (less weapon bob; prompt already locked)
- Audio mix
- Force pause when the window blurs (on by default)

Esc always pauses. Settings are reachable from pause without eating the next combat key.

## Persistence

- Primary store may be localStorage or IndexedDB, but treat browser storage as volatile
- Export/import JSON MUST work in Phase 1a. The export carries a `schemaVersion`; import migrates older versions forward and refuses files from a newer version with a clear message, never a partial load
- Import validates structure before touching the existing profile; malformed or hand-edited files fail safe with no state change
- SHOULD remind the player to export after stage gates and before clearing browser data
- Cap stored per-key history so a long-lived family profile cannot grow without bound

Cloud accounts are out of scope.

---

# 22. Accessibility (adult household)

School compliance is out of scope. Adults still need:

- High Contrast Text and a non-color-only error state
- Photosensitivity-safe flashes per WCAG 2.3.1 (error, muzzle, damage; Section 3.2)
- Subtitles / captions when voiced content exists
- Audio mix that cannot bury dry-fire and confirm ticks
- Intensity Low for players who want the systems without the horror
- Pause on blur and an obvious resume affordance

Motor accessibility beyond “this is a typing game on a physical keyboard” is out of scope.

---

# 23. Risks

- **Core loop risk:** typing-to-shoot may not last past novelty. Mitigated by Phase 0 feel gate and by giving decent typists Survival/Speed Test instead of only the primer.
- **Mixed-skill risk:** one difficulty curve bores the developer or wrecks the family member. Mitigated by placement, per-profile settings, and split Learn vs Survival rules.
- **Text vs atmosphere risk:** FPS presentation hides the prompt. Mitigated by Section 3.2 and screen-space prompts.
- **Asset capacity risk:** 3D art is the long pole. Mitigated by capsules in 0/1a, one environment in 1b, low-poly budget, licensed libraries where allowed.
- **Performance risk:** integrated graphics. Mitigated by the budget from Phase 0, including hitch-as-input-failure.
- **Input fidelity risk:** browser key handling. Mitigated by Section 3.1 as a hard gate; harness is permanent.
- **Curriculum tuning risk:** mastery numbers and WPM floors are estimates. They are named constants, not physics.
- **Save risk:** browser storage evaporates. Mitigated by export in 1a and reminders.
- **Dual-engine risk:** thinking about Godot too early. Mitigated by fallback-only policy.

---

# 24. Open Questions

1. Exact WPM floor curve per stage (tune in 1b with real household play)
2. Whether Stage 8 numbers stay “correct fingers when needed” or become a full number-row mastery gate
3. Final word-list pick among the MIT-compatible candidates in Section 20
4. Safari: still deferred until 1b is green on Chromium and Firefox
5. 3D asset source: commissioned, open libraries, or generated (must satisfy the licensing policy in Section 25)
6. Whether Intermediate placement lands at Stage 3 or Stage 5 after more playtests
7. Whether combo belongs in Speed Test or stays combat-only

---

# 25. Build Notes (non-feature, but required)

- TypeScript, one bundler, the harness runnable as a local script
- Input layer isolated and covered by the Phase 0 tests
- No feature work on top of a red harness
- README states: US QWERTY, physical keyboard, family profiles, export your save

## Licensing policy

- Code is MIT
- Assets committed to the repo MUST be redistributable: CC0 or an explicit redistribution grant (Kenney, freesound CC0, ambientCG qualify)
- Licensed assets that forbid redistribution stay out of the repo and are pulled by a documented fetch script
- `LICENSES.md` lists every committed or fetched asset, its source, and its license
