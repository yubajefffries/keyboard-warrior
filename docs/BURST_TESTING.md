# Burst testing: proving the game holds at 100+ WPM

The Phase 0 exit gate asks for an Input Fidelity run "at 100+ WPM". That gate has a
problem: almost nobody can hold 100 WPM on demand, and while trying, nobody can tell
a dropped event from their own typo. So the measurement was untakeable.

The robot typist takes it instead. It dispatches keydown/keyup pairs at an exact rate
through the same `InputPipeline` the game uses, and reports what the app did with them.

## What it proves, and what it does not

| | Covered by the robot | Still needs a human or a driver |
|---|---|---|
| App drops or reorders a keystroke | yes | |
| Per-keystroke main-thread cost | yes | |
| Frame hitches while typing fast | yes | |
| Whether typing at speed *feels* right | | yes |
| OS → browser drops a real hardware key | | yes |

Synthetic events enter at `dispatchEvent`. Everything from the browser's event queue
down is real; everything above it (keyboard driver, OS message loop, browser input
thread) is skipped. So a PASS means **the game keeps up**. It does not mean the
browser never loses a key from an actual keyboard.

To close that half:

- **Cheap:** panel 1 of the harness, hand-typed at your real top speed. A mismatch you
  did not actually mistype is a drop. This works because you only need it to hold for a
  sentence, not for a gate.
- **Thorough:** drive the page with CDP `Input.dispatchKeyEvent` (Playwright's
  `keyboard.press`). Those enter above the renderer, through the browser's real input
  path. Not wired up: it needs Playwright as a dev dependency, and the app-layer result
  is what actually moves this project right now.

## Running it

**In the harness** (`/harness/input-fidelity.html`, panel 2) — renderer-free, so a
failure here is the input layer and nothing else. Pick a speed, pick a key count, run.
This is the one to run in Chrome, Edge, and Firefox and export for
`docs/input-fidelity-logs/`.

**In the game** (`/`) — the whole thing under load: Babylon rendering, WebAudio,
enemies, prompt redraws.

| Key | |
|---|---|
| `F4` | cycle robot speed: 80 / 100 / 120 / 150 / 200 WPM |
| `F9` | start / stop a 200-key burst |
| `F2` | cycle how many words are shown ahead (0–4) |

Start the encounter first — the robot types what the game asks for, so it needs a live
prompt. **Watch the screen while it runs.** The report answers "did anything break";
your eyes answer "did it glitch", and at 150–200 WPM you can finally see the game at a
speed no amount of practice would let you test by hand.

The run uses 12% interval jitter and a 4% deliberate error rate, so it exercises the
miss-and-retry path the way a fast human does, not as a metronome.

## Reading the report

Four checks, each with the number that moved:

- **Lossless + in order** — every dispatched key arrived exactly once, in order. This is
  the only check that can indict the input pipeline itself. A failure names the character
  index where the streams diverge. Compared at the deepest point available: what
  `TypingEngine` accepted, not what the DOM emitted.
- **Rate actually achieved** — did the robot hold the requested speed. If it reports
  late slots, the machine could not sustain the rate; the robot re-anchors its schedule
  rather than firing back-to-back to catch up, because a flood is a different test.
- **Per-key app cost** — p99 wall time inside `dispatchEvent`, i.e. the game's whole
  synchronous response to one keystroke. Budget is 4 ms. At 100 WPM a keystroke arrives
  every 120 ms, so 4 ms is already 30× headroom.
- **No visible hitch** — worst frame during the burst; fails on any frame over two 60 Hz
  budgets.

Export the JSON from the pause menu (or the harness export) to file a run.

**Headless browsers fail the last two checks by construction.** Software rendering runs
around 15 fps, so every frame is a "hitch" and the main thread is too busy to hold
200 WPM. Judge frames and cost on the real machine, at 1080p, on real graphics — the
same rule that already applies to the Phase 0 FPS gate.

## Known results

| Date | Where | Speed | Result |
|---|---|---|---|
| 2026-08-21 | harness, headless Chromium | 150 WPM × 300 | PASS on all four. 300/300 lossless, p99 0.20 ms, 64 fps |
| 2026-08-21 | game, headless Chromium | 200 WPM × 200 | 200/200 lossless. Frames and cost failed as expected under software rendering (15 fps) |

The game has not yet been burst-tested on real hardware. That run, in Chrome, Edge, and
Firefox, is what closes Phase 0 gate 1.
