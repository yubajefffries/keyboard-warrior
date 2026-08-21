# Keyboard Warrior

Type like your life depends on it. A first-person action typing game and touch-typing tutor for one household. Desktop browser, US QWERTY, physical keyboard required. Export your save once profiles exist (Phase 1a); browser storage is volatile.

**Status: Phase 0 vertical slice.** Ugly on purpose. The point of this phase is to prove the input pipeline, the prompt legibility, and that typing-to-shoot feels good with gray boxes and one real shotgun kit. See `docs/PRD_v0_4.md` for the full product spec.

## Run it

```
npm install
npm run dev
```

- `/` is the Phase 0 encounter: gray-box corridor, capsule infected, pump shotgun, home-row content. Type the prompt to fire. Wrong key is a dry-fire; backspace does nothing in combat.
- `/harness/input-fidelity.html` is the Input Fidelity Test harness (PRD 3.1). Run it in Chrome, Edge, and Firefox and export a log per browser into `docs/input-fidelity-logs/`.
- `/harness/legibility.html` is the Text Legibility harness (PRD 3.2): worst-case fog, motion, and flash behind the real prompt renderer with a measured WCAG contrast ratio.

`npm test` runs the unit tests for the input-independent core (typing engine, stats, content). `npm run build` type-checks and bundles all three pages.

## Architecture rules (Phase 0)

- `src/input/pipeline.ts` never imports the renderer. Every keystroke the game consumes flows through it as a stamped `KeyRecord` (seq, key, code, repeat, modifiers, timeStamp, frameTime).
- The active prompt is screen-space DOM. Recoil, camera motion, and enemy lunges cannot move it.
- Errors log once against the expected key; the pressed key feeds the confusion matrix. Corrections never erase errors.
- Repeats never advance combat text. Modifier chords are ignored. Caps Lock and stuck Shift are surfaced, never silently rewritten.
- Blur pauses the game; resume is an explicit click or Space.

## Phase 0 exit gates (all must be green before Phase 1a)

1. Input Fidelity Test passes in Chrome, Edge, Firefox (logs filed in repo)
2. Text Legibility Test passes at 1080p on UHD-class integrated graphics
3. Typing-to-shoot feels compelling with gray boxes and the real shotgun kit
4. 60fps at 1080p on integrated graphics through a 100+ WPM burst

## License

Code is MIT. See `LICENSES.md` for the asset policy.
