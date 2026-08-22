# Keyboard Warrior

Type like your life depends on it. A first-person action typing game and touch-typing tutor for one household. Desktop browser, US QWERTY, physical keyboard required. Export your save once profiles exist (Phase 1a); browser storage is volatile.

**Play it:** [keyboard-warrior-nine.vercel.app](https://keyboard-warrior-nine.vercel.app) or [yubajefffries.github.io/keyboard-warrior](https://yubajefffries.github.io/keyboard-warrior/). Profiles live in your browser's localStorage; the Progress screen's export button is your save file.

**Status: Phase 1a in progress.** Phase 0's gray-box slice proved the input pipeline and the typing-to-shoot loop; Phase 1a turns it into something a non-typist and a decent typist can both sit down with. See `docs/PRD_v0_4.md` for the full product spec.

## Run it

```
npm install
npm run dev
```

- `/` is the game: profile, 60-second placement, Stage 1-5 lessons in the gray-box encounter, speed test, progress screen. Type the prompt to fire. Wrong key is a dry-fire; backspace does nothing in combat. The next words sit to the right of the active one so you can read ahead: `F2` cycles how many (0-4).
- `/harness/input-fidelity.html` is the Input Fidelity Test harness (PRD 3.1). Run it in Chrome, Edge, and Firefox and export a log per browser into `docs/input-fidelity-logs/`.
- `/harness/legibility.html` is the Text Legibility harness (PRD 3.2): worst-case fog, motion, and flash behind the real prompt renderer with a measured WCAG contrast ratio.

- The robot typist plays the game for you at an exact speed so 100+ WPM can be tested without being able to type 100+ WPM: `F9` runs a burst, `F4` picks 80-200 WPM. Same test lives in the harness (panel 2) for a renderer-free run. What it proves and what it cannot: `docs/BURST_TESTING.md`.

`npm test` runs the unit tests for the input-independent core (typing engine, stats, content). `npm run build` type-checks and bundles all three pages.

## What is built

| Phase 1a requirement | State |
| --- | --- |
| Profile create, 60s placement, routing | done |
| Stages 1-2 lessons, pass criteria, diagnosis line | done |
| On-screen keyboard, force on/off/auto | done |
| Learn-mode health: only a reached player dies | done |
| Progress screen: WPM/accuracy history, per-key heatmap, stage gates | done |
| Export / import JSON with validation and migration | done |
| Speed Test 30s / 60s | done |
| Mastery engine: windows, decay, staleness, low-exposure | done |
| Phase 1b settings: finger guide, text size, high contrast, intensity, motion reduction, volume, pause-on-blur | done |
| Warm-up offer (day away; accuracy counts, latency excluded) | done |
| Break suggestion on accuracy collapse | done |
| Stage gate: taught frequent keys mastered + final lesson passed | done |
| Keyboard auto-hide, and the finger hint that makes it safe | done |
| Weak-key injection into lesson content (PRD 13) | done |
| Adaptive difficulty: enemy timing from demonstrated pace, timer-was-wrong easing (PRD 13) | done |
| Stages 3-5: upper row, lower row, common words (14 new lessons) | done |
| Stages 6-10: capitals, punctuation, numbers, sentences, paragraphs | later phases |

## Architecture rules

- `src/input/pipeline.ts` never imports the renderer. Every keystroke the game consumes flows through it as a stamped `KeyRecord` (seq, key, code, repeat, modifiers, timeStamp, frameTime).
- The active prompt is screen-space DOM. Recoil, camera motion, and enemy lunges cannot move it.
- Errors log once against the expected key; the pressed key feeds the confusion matrix. Corrections never erase errors.
- Repeats never advance combat text. Modifier chords are ignored. Caps Lock and stuck Shift are surfaced, never silently rewritten.
- Blur pauses combat and resume is explicit; blur during a timed drill discards the attempt instead, because a paused-and-resumed clock produces a WPM number that means nothing.
- Upcoming prompts come from a `TokenQueue`, so what is drawn as "coming up" is exactly what arrives. The display can never promise a word the source then changes.
- Browser storage is volatile and treated that way: every write is best-effort, a blocked store is surfaced rather than swallowed, and the export file is the durable copy.
- Import validates every profile before accepting any of them. A newer format is refused with a message; a malformed file changes nothing.
- Per-key history is capped by construction (rolling windows, not raw samples), so a long-lived family profile cannot grow without bound.
- Every mastery rule reads a window, never a lifetime total. A player who was 60% on K last month and is 98% today has mastered K.
- Nothing about mastery is announced. A decayed key quietly turns up more often; the game never says "you forgot R".
- Saves loaded from browser storage go through the same migration and validation as an imported file. Code that reads an old blob without upgrading it gets a profile missing every field the current engine expects.
- Enemy pacing never demands more than the player has demonstrated: the spawn interval has no upper clamp, because capping it for a slow typist would quietly reintroduce the demand the 20-40% buffer exists to remove. A lesson consistently failed at >=90% accuracy widens the buffer: the timer is wrong, not the player.

## Phase 0 exit gates (still open)

The PRD says Phase 1a does not begin until these are green. Phase 1a code exists
anyway, because all four gates need a human at a real keyboard on real hardware
and none of them can be closed by writing more code. Treat them as gates on
letting anyone else play, not on the work continuing.

1. Input Fidelity Test passes in Chrome, Edge, Firefox (logs filed in repo).
   The robot burst now covers the app-layer half on any machine; what still
   needs fingers is proof the OS/browser path never drops a real key.
2. Text Legibility Test passes at 1080p on UHD-class integrated graphics
3. Typing-to-shoot feels compelling with gray boxes and the real shotgun kit
4. 60fps at 1080p on integrated graphics through a 100+ WPM burst

## License

Code is MIT. See `LICENSES.md` for the asset policy.
