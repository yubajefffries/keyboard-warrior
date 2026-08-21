# Asset licenses

Policy (PRD Section 25): code is MIT. Assets committed to this repo must be redistributable (CC0 or an explicit redistribution grant). Licensed assets that forbid redistribution stay out of the repo and are pulled by a documented fetch script. Every committed or fetched asset gets a row here.

| Asset | Source | License | Notes |
| --- | --- | --- | --- |
| Weapon SFX kit (fire, dry-fire, pump, impact, shell, tick) | Synthesized at runtime in `src/audio/sfx.ts` (WebAudio) | MIT (part of the code) | Stand-in that satisfies the redistribution policy. Candidate replacement: a recorded CC0 kit (e.g. freesound CC0) via a fetch script, keeping the same `WeaponAudio` interface. |

No binary assets are committed yet. No fetch script exists yet.
