# Fork changelog

- Strength sets now use RIR throughout the web player, diary, presets and plan prescriptions. Existing strength RPE converts to RIR only when missing; explicit RIR and cardio ratings are preserved. App Store RPE writes remain compatible.

Upstream `CHANGELOG.md` is release-please managed; fork changes are recorded here instead.

### Unreleased

- Add `pnpm deploy:live` for verified full deployments, private backups, exact image pinning, read-only dry runs, and image-only rollback (#90).

- Show a collapsed **Last time** reference under each web workout-player exercise: prior date, sets, preferred weight unit, RIR and warm-ups; skip today and untouched prescriptions with one filtered history request per exercise (#85).

#### Bug fixes

- Keep sprint and 30-second power chart tooltip dates readable in both web themes; verify all four Cardio Test entry, edit and graph flows at the phone viewport (#95).

- Hide the web Dashboard header playback icon while a Program or Workout Plan session card is shown, leaving the session’s Start Workout action (#86).

- Keep web-authored preset RIR when legacy clients edit other set fields; preserve cardio effort in previews and multi-set editors, and derive legacy strength RIR in bulk copies and appended workout sets without changing cardio effort during RIR-only copies (#82).

- Scope web workout drafts to the signed-in account and acting profile; reset playback on profile changes and clear account drafts on sign-out (#78). Legacy Program drafts migrate only after verifying the signed-in owner's Program list, preserving completed sets and edited weights; unverifiable drafts remain untouched, including on sign-out. Stale session-expiry probes cannot clear drafts after recovery.
- Prevent empty or untouched prescribed diary workouts (including explicitly started Workout Sessions and weekly prefill) from completing a Program session through linking; keep partial workouts and duration-only individual entries linkable, including historical entries with blank backing sets (#77).

- Restore upstream App Store Workout Plan reads and flat create/edit requests, preserving session identities, optionality and frozen prescriptions; reject ambiguous edits and protected-history removal, including HTTP 409 for flat saves of unscheduled weekly sessions or detached frozen assignments that the App Store form drops (#74).
- Remove untouched future weekly-prefill workouts outside a changed weekday or date window, preserving retained workout identities and edited history.

- Preserve logged web Program sets and weights when reopening the same session from the Dashboard or leaving the player immediately after an edit; show a warning when local draft storage fails. Require the same exact Workout Session when resuming and offer explicit separate-save/discard recovery for incompatible saved drafts, blocking new edits and set logging until that recovery is resolved (#76).
- Show readable web chat errors and a labeled Retry that preserves the question and its original Training analysis disclosure without duplicating the transcript; restored or evicted questions use ordinary chat when their original scope is unavailable, and Edit → Update always uses ordinary chat (#64).
- Preview upcoming web dashboard Workout Sessions before starting, with exact prescriptions, occurrence context, accessible phone-sized dialogs, and Cardio Test protocol previews; retain short carry distances and frozen workout formats/time caps, refresh previews after plan edits, and pluralize rep counts (#67).
- Add a phone-friendly jump from the Program summary to the earliest pending session by effective date, including overdue sessions, and show when none remain (#62).

- Bring populated Cardio Test editors into view with a dated heading and return focus to history after Save or Cancel for all four web protocols (#60).

- Keep web food-entry quantity, unit, time and notes after a failed save; allow retry and block duplicate submissions while saving (#58).

- Make food picker nutrient labels, values and serving captions readable in both themes, retaining nutrient colors as marks (#59).

- Put daily weight entry and Save before the trend chart on web Check-In, keeping the selected date, preferred units and complete measurement form (#63).
- Show four pending Program workouts on the web dashboard and refresh the queue immediately after completing or linking any occurrence, preserving earlier unfinished sessions and completed outcomes when mutation responses arrive out of order (#49).
- Restore hidden CSV exercises in place on re-import, counting them as updated while preserving separate-copy imports for hidden manual exercises (#21).

- Allow Workout Program consolidation when a Program includes Cardio Tests, preserving assessment and attempt links; assessment-only Programs return no workout proposal.
- Prevent exercise replacement in web Training Program playback and recover older substituted drafts as separate, unlinked workouts.
- Preserve a Workout Session's shared interval format and time cap across matching frozen presets on web, consistent with mobile.
- Keep new exercises in their untouched weekly prefill workout and allow plan edits to replace only marked future incomplete prefill rows, preserving manually started, edited, feedback-bearing, past, completed and Program-linked diary history; reject stale player saves after a prescribed exercise changes while allowing unchanged snapshots after library deletion (#45).
- Show the next three pending Training Program workouts on the web dashboard and the next one on mobile (ordered by effective date), keeping the session picker for standalone Workout Plans and falling back to all plans if Programs fail to load.
- Reject `missed` outcomes for future Planned Sessions so an accidental click cannot trigger an irreversible auto-shift; index Program session diary links.
- Restore per-set RPE entry in started workouts, including timed cardio, with decimal effort values retained in resumed drafts and workout save requests.
- Show prescribed set notes on workout start and provide editable exercise notes that persist with the workout.

#### Features

- Add a phone-friendly protocol selector to web Cardio Tests, showing one protocol’s entry, history and trend while preserving Program assessment deep links (#61).

- Record and graph ramp Test Attempts on web, including heart-rate recovery and Program assessment linking (#6).
- Add owner-only, read-only Training analysis to web chat with explicit Program, Cardio Test and synced Apple Health disclosure controls (#8).

- Make the fork web app installable from iPhone Safari with correctly sized icons, standalone launch metadata, safe-area spacing, and phone-sized Training Programs, Workout Sessions, and Cardio Tests controls.
- Record five-effort sprint and two-effort 30-second power Test Attempts with dated history and trends on web and mobile.
- Schedule Cardio Test assessments in Program Phases without placeholder Workout Sessions, link dated Test Attempts to Program history, and retain standalone attempts (#7).
- Cooper run Test Attempts (#4): entry, edit, dated history, and trend graph on web and mobile; native acceptance pending per `agent-docs/cooper-manual-acceptance.md`.
- Normalize stored exercise and diary exercise names with consistent capitalization (#10).
- Bind Program Planned Sessions to exact Workout Sessions and retain session-level prescriptions (#11).
- Support optional sessions and linking a completed workout after its scheduled date (#12).
- Preview and apply selected future prescriptions in bulk with Program-aware conflict checks (#13).
- Add owner-scoped Workout Plan consolidation preflight, explicit mappings, replay-safe transactions, and private rollback receipts (#14). Live cutover completed on 2026-10-15; the one-off tool was retired in #50.
- Training Programs: authoring, outcomes, and optional auto-shift (issues #2, #3). See `docs/src/features/exercises/training-programs.md` and `docs/adr/`.

#### Developer tooling

- Sync upstream through #2944 on 2026-10-17, retaining fork Training Programs, Cardio Tests, Training analysis and the web redesign.

- Retire the completed one-off Program consolidation tool and its acceptance job (#50); retain the historical journal, migration, schema and owner-only RLS coverage.

- Add a warm-cache deployment smoke command that verifies the browser's loaded frontend asset and live upcoming-workout order, with private JSON/screenshot evidence and CI acceptance checks (`agent-docs/deployment-smoke.md`).
- Run the Training Program integration suite in CI against Postgres; trigger consumer checks for shared-contract changes.
- Add guarded, isolated PostgreSQL acceptance jobs for bulk workflows (the completed consolidation slice was retired in #50); require the JSON report checker to reject missing, skipped or incomplete suites. The existing migration-check job runs the RLS matrix.
