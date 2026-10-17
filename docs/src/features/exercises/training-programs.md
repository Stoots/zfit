# Training Programs

A **Training Program** organizes multiple weeks around a goal. It contains ordered **Program Phases**, each with its own goal, dated weeks, and **Planned Sessions**. A **Workout Plan** is a separate reusable collection of independently prescribed **Workout Sessions**. Use a plan independently or bind a Planned Session to one exact Workout Session. Creating a Program does not activate, change or replace a Workout Plan.

## Author and schedule on web

1. Open **Exercises → Open Training Programs** (or `/training-programs`). Use **Manage Workout Plans** to create the Workout Plans you want to reuse.
2. Select **Create Training Program**. Enter a name, goal, and inclusive start/end dates.
3. Add phases and enter each phase's name and goal. Add weeks within the Program dates. Each week spans one to seven days; weeks must be chronological and cannot overlap.
4. Add Planned Sessions. Give each a name and authored calendar date within its week, then choose an exact **Workout Session** inside one of your plans or a **Cardio Test** protocol. A Cardio Test does not create a placeholder Workout Plan. The Workout Session selector shows the session ordinal and prescription, so two sessions named A with 2 × 8 and 3 × 8 remain distinguishable. Multiple Planned Sessions can share a date or reuse the same workout session. **Optional** initially inherits the selected Workout Session; explicitly change it to override optionality for this Program binding. Cardio assessments start required unless marked optional.

   For a scheduled Cooper, five-effort sprint, 30-second power, or ramp test, choose **Record Test Attempt** from Program history on web or select the assessment on the Cardio Tests screen. The matching form opens with the Planned Session and its date selected. Saving the result completes the Planned Session and shows the attempt in Program history. Choose **Standalone Test Attempt** to record a test outside a Program. Removing a Program preserves its Test Attempts as standalone history. Use the **Test protocol** selector near the top of Cardio Tests to switch between Cooper run, 6-second sprint, 30-second power, and Ramp; each view shows that protocol’s entry, history, and trend. Program assessment links still open the matching protocol with its Planned Session and date selected; switching protocols starts a standalone attempt. In Cardio Test history, **Edit** brings the populated editor into view and focuses a heading naming the original attempt date. **Save** confirms the update; **Save** and **Cancel** return focus to the history action. Editing errors keep the populated form open. A ramp test starts at 100 W and increases by 20 W per minute; enter maximum watts, peak heart rate, and heart rate one minute after stopping to see heart-rate recovery and dated trends.

5. Leave **Auto-shift after a miss** off for fixed dates, or explicitly enable it. Save to view your schedule and history. Empty structures can be saved for later authoring.

Use the move buttons to change structure order; maintain chronological week dates when moving weeks or phases. Cancel discards unsaved edits. Delete requires confirmation and removes the Program and its history, never reusable Workout Plans or diary workouts. Removing a phase/week during aggregate editing removes only unrecorded sessions; ancestors containing recorded sessions cannot be removed.

### Author independent Workout Sessions

At **Exercises → Workout Plans**, add, name and order sessions inside a plan. Each session has its own ordered exercise/preset assignments and sets. Selecting a library preset freezes a local prescription; **Edit this session’s preset prescription** changes only that assignment, not the library preset or another session. Local copies are independent. Saving retains existing session UUIDs and assignment/set IDs; newly added sessions omit persisted IDs until the server creates them.

Weekly plans retain explicit weekdays, including unscheduled sessions without a weekday. Sequential plans advance in authored session order only after every assignment has a diary link; expanded preset children count once for their assignment. Saving a weekly prefill keeps retained diary snapshots and adds new exercises to an untouched generated group. It never adds exercises to a group with completed sets, edited exercises, recorded feedback, or to an explicitly started duplicate group. Removing or swapping an assignment removes only marked, future, incomplete, non-Program prefill rows from groups with no edited child or feedback; a swap then prefills the new exercise. Workout Sessions do not need a Program.

**Optional** is an explicit session checkbox, not a name convention. Existing sessions default to required. Copying and saving a Workout Session retain its flag and full prescription; names such as “C” or “accessory” never make it optional. Later library edits do not change an existing Program binding's stored optionality. Mark only the intended sessions optional; absent deload sessions remain absent rather than being generated.

Tap the body of an upcoming web Diary card, or focus it and press Enter/Space, to preview that exact occurrence without logging or changing anything. The phone-sized dialog shows the Workout Session name, Program/phase/week/date context, and exercises in prescription order, including every set's reps, load, duration/distance, rest and notes. The preview also shows the resolved frozen workout format and time cap. Loaded carries use metres or yards, while other distances retain enough precision to show short targets. **Start Workout** uses the same exact-session loader as the card's action; closing returns focus to the card. Loading failures offer a retry, and empty sessions explain that no exercises are prescribed. Cardio Test assessments share the four upcoming slots in effective-date/authored order and show the protocol description; their action opens the linked Test Attempt form. The card's **Start Workout** and **Mark complete** buttons keep their existing behavior.

**Start Workout** in the Program view opens the exact bound session, not the plan's standalone next session. The web Diary previews up to four pending exact sessions across effective dates in date and authored order, even when their plans are inactive, plus unrelated active standalone plans. A Program session stays in that preview until its Program outcome is recorded. Completing or linking any displayed occurrence immediately replaces it with the next pending occurrence, while earlier unfinished sessions remain visible. Finishing **Start Workout** playback from Home or the Program page sends the performed sets to the same atomic completion endpoint and records the Program outcome with the diary workout. An identical retry returns that result without logging again. Program playback does not offer exercise replacement because completion requires the prescribed exercises. If an older local draft contains a replacement, the server rejection offers **Save as a separate workout** (unlinked) or **Discard**. The same recovery is available if another completion or explicit link already recorded a different workout. Standalone playback still offers replacement and saves a diary workout normally. **Mark complete** confirms one atomic server action that logs the exact bound Workout Session prescription on the selected Diary date and records the Program outcome. Retrying after an uncertain response returns the recorded completion without logging another workout. The same dialog offers **Link an existing workout**: choose any diary date and explicitly select an unlinked workout, including a partial workout, to record its completion without logging a new one. A workout already linked to another Planned Session is unavailable. Sessions with no prescribed sets use only the link flow; the direct completion API rejects logging them without performed sets.

Web workout drafts are private to the signed-in account and the profile being acted on. Switching either identity resets the player to that profile's saved draft. Signing out clears all local workout drafts for that account. Older drafts saved without an account identity are never shown to another account; see below for how they are preserved or migrated.

Starting the same Planned Session with the same exact Workout Session on the same Diary date resumes its local draft, including logged sets and edited weights. If a different draft is already saved for that date (including a Planned Session rebound to another Workout Session), the player keeps it until you explicitly save its logged sets as a separate, unlinked workout or discard it. Edits and set logging on the newly started workout are disabled until you resolve the saved draft; afterward, you can edit, log sets and finish normally. Draft edits are stored immediately; if local storage fails, the player warns you to keep the page open and finish to save to the Diary. Logging sets and leaving the player do not complete the Program session: **Finish Workout** saves performed sets and records completion together. A failed finish keeps the player open with an error and allows retry.

Legacy web drafts from before account-scoped storage are preserved. A legacy Program draft migrates only into the signed-in account's own profile after its Program appears in that account's owner-only Program list and its date is valid. Migration keeps logged sets and edited weights, never overwrites an existing scoped draft, and uses the same exact-session restore and recovery checks above. The original is removed only after the scoped write succeeds. Unverifiable legacy drafts (including standalone workouts and foreign Programs) stay unavailable and untouched; signing out does not delete them.

Frozen execution retains all prescribed exercise/set data, effort, rest, distance, ranges and notes. A single-preset session uses its frozen format and time cap. Multi-assignment sessions retain each prescription but use one combined timer: matching frozen preset formats keep that format, including EMOM, and keep a shared time cap when all caps agree. Mixed formats become standard and drop the cap; mixed caps also drop the cap. There are no independent per-block timers. Logging keeps performed results separate from the server-frozen prescription; later local or library edits do not refresh that history.

Unlike a live library-preset start, a frozen Workout Session is not expanded to a generic EMOM/Tabata round count on load. Its authored sets stay exact; the single-format timer and frozen cap still run. For example, one authored EMOM set with a 120-second cap opens and saves one set, not two cloned sets.

### Apply selected prescription changes to future sessions

Ordinary **Save Plan** remains session-local; matching A/B names never expand an edit. For an intentional batch, edit an existing Workout Plan and choose **Apply prescription to future sessions…**:

1. Choose one saved source assignment from the current draft. Unsaved source prescription edits can supply the copied values; this action does not save the source or other draft edits.
2. Explicitly choose one Training Program or **Standalone sessions only**. Targets stay inside the open plan; no other plan or Program is silently included.
3. Select the fields to copy. For each target, choose its exact assignment and separately check **Include this target**. Session UUIDs, Program identities and all dated bindings distinguish same-name sessions.
4. Choose **Preview selected changes** and inspect every target's exercise UUID and selected before/after values. **Cancel preview** returns to selection without saving anything.
5. Confirm the exact batch. Success refreshes the saved plan and closes the editor, discarding the other unsaved draft edits. A conflict requires a new preview; no part of an invalid batch is saved.

Granular set edits require identical set numbers. Individual assignments require the same exercise UUID; frozen presets require the same ordered exercise UUIDs. Incompatible mappings are reported, never inferred from names. **Whole set collection** explicitly replaces all authored set data, including effort, notes and additional prescription fields. Preset format, time cap and description can be selected independently; unselected preset metadata remains unchanged.

For effort-only changes, select **RPE** and/or **Repetitions in reserve (RIR)** instead of the whole set collection. These granular fields work on individual assignments and every mapped frozen-preset exercise. Numeric values copy exactly; an unspecified/null source clears only the selected effort field. Unselected effort, repetitions, load, rest, notes and additional JSON keys (including absent keys) remain unchanged. RPE/RIR are authored JSON prescription fields, not new Workout Plan set columns.

A target must be strictly future-dated in the athlete's configured timezone (UTC fallback). Every binding of a reused Workout Session must be still Planned, future-dated, in the selected Program and explicitly accounted for. A session also referenced by another Program is unavailable. Standalone targets must have no Program binding and the saved plan must have an explicit future start date and valid date range. Any diary link, including an incomplete prefill, protects the entire session from bulk editing.

Bulk candidates use the same authoritative omission projection as Program history: an expired optional binding is **Omitted** and unavailable, even while its stored status remains `planned`. Both preview and apply recheck athlete-local effective dates. Bulk prescription changes never copy library optionality onto an independently overridden Program binding.

Preview and cancellation write nothing. Apply retains session/assignment identities, preserves unselected fields and other exercises, and never changes recorded outcomes, completion links, diary prescriptions or performed results. It rechecks the source, targets and bindings transactionally against the preview revision, rejecting stale or completed targets atomically. Diary start and Program outcomes participate in the same locking boundary.

Web plan/Program queries refresh on browser visibility/focus; mobile plan/Program queries refresh on screen focus and foreground resume. Existing in-progress workout drafts and recorded workouts retain their frozen prescription rather than being overwritten.

## Find the next session

In Program details, **Jump to next session** beside the week progress scrolls to and focuses the earliest pending Planned Session by its effective date, including overdue required sessions and pending optional sessions or Cardio Tests. Shifted dates take precedence over authored week order; ties keep the Program's existing session order. Completed, missed and omitted sessions remain in history. When none remain, the summary shows **No remaining sessions.**

## Completion and missed history

Every session starts **Planned**. Optional sessions become **Omitted** after their effective scheduled day ends in the athlete's saved preference timezone (UTC when absent or invalid). The API derives this status and the next-local-midnight boundary when reading history; it does not require opening the app, a background job or a persisted miss. Spring/fall DST days use their real 23/25-hour local boundaries. In the Program detail view:

- **Link completed workout**: choose a diary date, select an owner-owned grouped workout or standalone exercise workout, and confirm completion. This is an explicit declaration that you completed that workout, not automatic detection from diary rows (which may contain planned sets). It does not log another workout. The diary date need not equal the session date, and the workout need not have originated from the selected Workout Plan.
- **Mark missed**: confirm a permanent missed record for a required session. There is no implicit clock-driven miss detection. A required miss can only be recorded once the session's effective date is on or before the athlete's today in their timezone; a later session returns 409. Optional sessions cannot be marked missed and incur no missed penalty. Outcomes are permanent, preventing accidental early clicks from being unrecoverable or triggering auto-shift. Completions are not date-restricted; an omitted optional session can be explicitly completed later.
- **Completed** and **Missed** sessions show their recorded schedule date and outcome timestamp. Completion also shows the linked workout's name/date with a diary link. Workout, Workout Plan and Workout Session names are snapshotted when recording an outcome. Later diary or plan/session renames, diary date edits, and diary deletion do not rewrite the Program history. Diary deletion clears the live foreign-key link, not the completion snapshot.
- **Omitted** optional sessions remain visible in history but leave pending/up-next/start selection. Web history and mobile diary history offer **Link completed workout** for an explicit late completion. Linking retains the original effective date, records the real selected workout snapshot and does not shift other sessions or create another diary entry.

Recorded workout **Completed** and **Missed** outcomes are final: a required missed session cannot be changed to completed, a completed workout session cannot be changed to missed or linked to a different workout, and recorded sessions cannot be removed or rewritten through aggregate edits. Unlinking or moving a Cardio Test attempt returns its previous Planned Session to **Planned**. Omitted optional sessions may transition only through explicit completion linking; aggregate edits cannot reset them into planned sessions or change their optionality, date or binding. One diary workout can fulfill at most one Planned Session across all of your Programs. A grouped workout's child exercise is not a separate standalone workout; link the grouped parent instead. Retrying the same outcome is idempotent, including after diary deletion.

## Fixed dates and deterministic auto-shift

**Fixed dates are the default** (`auto_shift: false`). Recording a miss changes only that session's state. Existing standalone Workout Plan schedules are unaffected.

When enabled, **each newly recorded required miss advances all still-Planned Sessions in that Program whose current effective date is strictly later than the missed session's effective date by exactly one Gregorian calendar day**. Selection uses dates, not structure order, server time, elapsed time since the miss, or the diary workout date. All eligible dates move together, preserving intervals between them. Same-day sessions do not move: a Planned Session sharing the missed session's effective date stays put even if it comes later in the structure order. Missed, completed and omitted sessions never move, disappear, or change state through shifting. Optional omission and late completion never trigger a shift. Repeated required misses on different sessions apply cumulatively; retrying a miss on the same session does not shift again. Enabling/disabling the option affects only subsequent new misses and is not retroactive.

For example, sessions authored October 25, October 30 and November 7 become: **October 25 Missed**, **October 31 Planned**, **November 8 Planned**. Missing the October 31 session next retains both missed records and moves the last session to **November 9 Planned**. A completed session is skipped regardless of where it falls on the calendar.

### Date boundaries and aggregate editing

- `scheduled_date` is the **authored date**, strictly contained within the authored week and Program. Week dates remain chronological, nonoverlapping, and at most seven days inclusive.
- `effective_date` is the **resulting schedule date**. It starts equal to the authored date. Shifts may move it beyond its original week, phase's weeks, or Program end. Sessions retain their original week/phase IDs; no weeks are expanded or sessions reparented. The web UI displays the resulting date, the authored date when different, and `schedule_end_date` when the schedule extends beyond the authored Program end.
- `schedule_end_date` is the later of the authored Program end and all effective session dates, including recorded history. Authored Program/week dates do not expand automatically.
- All days are `YYYY-MM-DD` calendar strings from `0001-01-01` through `9999-12-31`. Adding one day respects month/year rollover and leap days, independent of DST and timezone. A miss that would push an eligible session past `9999-12-31` returns 409 and rolls back **both** the outcome and every shift. Disable auto-shift or edit the future authored date before retrying.
- Aggregate saves retain effective dates when authored dates are unchanged. Deliberately editing a still-Planned Session's authored date resets its effective date to the new authored date, discarding any shift it had accumulated. Other edits, including Program/week range edits and auto-shift toggles, never recalculate dates.
- Recorded sessions must retain their IDs, parents, names, authored dates and exact Workout Session bindings; their effective dates, timestamps and completion snapshots are read-only. Their containing phases/weeks must remain. Order may change; goals and valid containing date ranges may be edited. An invalid or history-rewriting aggregate save is rejected atomically.
- Outcome recording and aggregate editing lock the Program in one transaction. Concurrent duplicate misses yield one shift; duplicate completion links yield one winner and 409 for the competing link.

## Historical Program consolidation

The one-off #14 consolidation completed on 2026-10-15, and its operator tool
was retired in #50. The resulting reusable plan and exact Program session
bindings remain available through the ordinary workout flows. The private,
owner-only journal remains an audit record; its foreign key still protects the
target plan from deletion. Program deletion removes its journal but leaves
reusable plans and diary workouts intact. See the
[historical journal notes](../../developer/database.md#historical-program-consolidation-journal).

## Privacy and deletion safety

Training Programs are owner-only. Family delegates cannot view or edit them, including with diary, report or exercise-library access. Switch to your own profile first. Only your own Workout Plans and diary workouts can be referenced. Explicit owner predicates, RLS and composite foreign keys enforce isolation. Existing standalone Workout Plan sharing is unchanged.

A Workout Session used by a Planned Session cannot be removed or moved to another plan, and its parent plan cannot be deleted until Program references are removed. Past entries, completed sets, feedback, explicitly started workouts and Program-linked workouts protect assignment history: changing or removing those assignments or deleting their session or plan returns HTTP 409. Future, incomplete, non-Program rows marked as untouched weekly prefill are disposable when that plan is edited or deleted. Older entries without that marker remain protected. A simultaneous player save returns a retryable 409 if its prefill group was removed first, is busy, or now prescribes a different exercise. An unchanged diary child remains saveable after its library exercise is deleted; its stored snapshot and assignment link remain. Recorded Planned Sessions cannot be individually removed to release their reference; explicit Program deletion remains available. Hiding a library exercise remains an alternative to deleting linked identities.

Workouts are logged only after explicit Mark complete confirmation; Programs do not create cardio tests or expose AI queries.

## HTTP interface

Requests use the application's session cookie or API-key authentication. No request accepts `user_id`; ownership is derived from authentication. Acting-user switches and `x-on-behalf-of-user-id` delegation are refused.

| Method | Path                                                      | Result                                                                                             |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/api/training-programs`                                  | Your Programs with full structure, schedule and history                                            |
| POST   | `/api/training-programs`                                  | Create; returns persisted structure with HTTP 201                                                  |
| GET    | `/api/training-programs/:id`                              | View your persisted Program                                                                        |
| PUT    | `/api/training-programs/:id`                              | Atomically replace the editable aggregate, preserving recorded history                             |
| POST   | `/api/training-programs/:id/sessions/:sessionId/outcome`  | Record a miss or link completion; returns the whole updated Program                                |
| POST   | `/api/training-programs/:id/sessions/:sessionId/complete` | Atomically log the bound Workout Session and record completion; retries return the existing result |
| DELETE | `/api/training-programs/:id`                              | Delete Program hierarchy/history, preserving diary workouts and Workout Plans; HTTP 204            |

Example create body:

```json
{
  "name": "Autumn 10K",
  "goal": "Finish a 10 km race comfortably",
  "start_date": "2026-10-25",
  "end_date": "2026-11-07",
  "auto_shift": false,
  "phases": [
    {
      "name": "Base",
      "goal": "Build endurance",
      "weeks": [
        {
          "start_date": "2026-10-25",
          "end_date": "2026-10-31",
          "sessions": [
            {
              "name": "Easy run",
              "scheduled_date": "2026-10-30",
              "workout_session_id": "22222222-2222-4222-8222-222222222222"
            }
          ]
        }
      ]
    }
  ]
}
```

For a Workout Session binding, `workout_session_id` must identify an existing Workout Session inside a plan you own; the UUID is illustrative. Whole-plan selection is not accepted. For a Cardio Test binding, use `"cardio_test_type": "cooper_run"` instead of `workout_session_id`; the latter may be omitted or `null`. Supply exactly one of these bindings. Omitted `schedule_type` defaults to `"fixed"` (authored-date policy); omitted `auto_shift` defaults to `false`. New Workout Planned Sessions inherit `is_optional` from their library session unless explicitly overridden; Cardio Test sessions default to required. Omitting `is_optional` when updating an existing binding preserves that binding's stored flag. Responses include Program UUID, owner, audit timestamps, `schedule_end_date`, and stable UUIDs and zero-based `sort_order` for every child. Planned Sessions also include nullable `workout_session_id`, display-only `workout_plan_id` and plan/session names, nullable `cardio_test_type`, `is_optional`, `effective_date`, `status` (`planned`, `completed`, `missed`, or `omitted`), nullable `outcome_at`, `completed_workout: { type, id, name, entry_date }`, and `completed_test_attempt: { id, test_type, attempt_date, results }`. Workout fields are `null` for a Cardio Test binding; `completed_test_attempt` is `null` until an attempt completes it. For an omitted response, `outcome_at` is the derived local end-of-day boundary, not a stored outcome mutation.

Outcome bodies:

```json
{ "status": "missed" }
```

```json
{
  "status": "completed",
  "workout": { "type": "preset", "id": "11111111-1111-4111-8111-111111111111" }
}
```

Use `"individual"` for a standalone diary exercise entry. The example UUID must be replaced with a real owner-owned diary workout ID. Fetch selectable workouts through the existing `/api/v2/exercise-entries/by-date?selectedDate=YYYY-MM-DD` endpoint. Only `type` and `id` are accepted in the completion request; the server captures the snapshot.

For PUT, send only editable fields and existing child IDs you retain. New children omit IDs. Array order defines `sort_order`; omitted unrecorded children are removed in the same transaction. Unknown, duplicate, foreign or reparented child IDs are rejected. Responses are not valid PUT bodies because response-only outcome, audit, owner and ordering fields must be omitted.

Errors use `{ "error": "message" }`: invalid input/reference → 400; unauthenticated → 401; delegated context → 403; missing or foreign Program/session/workout → 404; final-outcome conflicts, duplicate workout links, history rewrites, calendar overflow and referenced plan deletion → 409. Shared contracts live in `shared/src/schemas/api/TrainingPrograms.api.zod.ts`; interactive API documentation is at `/api/api-docs/swagger`.

Nested plan requests use `sessions: [{ id?, name, day_of_week, sort_order, is_optional, assignments }]`; `is_optional` defaults to `false`, and assignments contain an exercise or frozen preset prescription. New session IDs are server-generated. The exact standalone execution endpoint is `POST /api/workout-plan-templates/sessions/:workoutSessionId/start` with `{ "entry_date": "YYYY-MM-DD" }`. Shared plan contracts live in `shared/src/schemas/api/WorkoutPlans.api.zod.ts`. The generic legacy upgrade refuses ambiguous whole-plan Program references until an operator provides an explicit per-Planned-Session mapping; see [database migration guidance](../../developer/database.md#workout-session-cutover-preflight-and-explicit-mapping). This is not selected-Program consolidation or permission to deploy the cutover.

### Bulk prescription HTTP interface

These endpoints are owner-only, including when an existing Workout Plan has sharing permissions. Authentication uses the same session-cookie/API-key layer; delegated acting-user contexts are rejected.

| Method | Path                                                                            | Result                                                                                                                     |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/workout-plan-templates/:id/bulk-prescriptions/candidates?program_id=UUID` | Exact sessions, assignments, all dated bindings, eligibility and rejection reasons; omit `program_id` for standalone scope |
| POST   | `/api/workout-plan-templates/bulk-prescriptions/preview`                        | Read-only canonical request, revision and per-target before/after prescriptions                                            |
| POST   | `/api/workout-plan-templates/bulk-prescriptions/apply`                          | Atomic confirmed apply; returns `{ plan }` with the canonical saved plan                                                   |

Preview accepts `{ plan_id, program_id, source_session_id, source_assignment_id, prescription, fields, targets }`. `program_id` is the explicit Program UUID or `null` for standalone. `prescription` uses the ordinary assignment input contract (including `sort_order`). Each target is `{ workout_session_id, assignment_id, planned_session_ids }`; supply every binding UUID for that session, or an empty array for an unbound standalone session. Select at most 100 distinct target sessions.

Selectable fields are `sets` (the entire set collection), `set_type`, `reps`, `weight`, `rpe`, `rir`, `duration`, `distance`, `rest_time`, `notes`, and, for frozen presets, `workout_format`, `time_cap_seconds`, `description`. Send the preview's exact `{ request, revision }` back to apply. Changing the request or any saved source/target/binding state invalidates confirmation; revisions conservatively include the enclosing plan, so another plan edit may also require a fresh preview.

Invalid requests return 400; unauthenticated access 401; delegated context 403; missing or foreign scope 404; stale, incompatible, nonfuture, recorded or wrong-scope targets 409. Database failures roll back every target. Contracts are exported from `shared/src/schemas/api/WorkoutPlanBulk.api.zod.ts`; no database migration is required.

## Focused verification

Start the server against an isolated PostgreSQL database first so migrations and RLS are applied. Integration tests use real Better Auth sessions, HTTP routes, repositories and the non-superuser application role. They skip explicitly if the database probe fails. Run backend fixtures **serially**, including the full suite, to avoid concurrent migration/RLS setup deadlocks.

```bash
# From SparkyFitnessServer
pnpm exec vitest run tests/trainingPrograms.integration.test.ts tests/workoutPlanTemplateService.test.ts tests/rlsPermissionMatrix.integration.test.ts --no-file-parallelism

# From SparkyFitnessFrontend
pnpm exec jest src/tests/components/TrainingPrograms.test.tsx --runInBand
```

The bulk suite uses real Better Auth sessions and a non-superuser PostgreSQL application role. Enable it only against a disposable database named `zfit_bulk13_disposable` or `zfit_bulk13_disposable_SUFFIX`, where `SUFFIX` contains lowercase letters or digits. The rollback scenario temporarily installs a failing trigger in that disposable database; never point it at an owner or production database.

```bash
# From SparkyFitnessServer, with that isolated database configured
RUN_BULK_PRESCRIPTION_DB=1 pnpm exec vitest run tests/workoutPlanBulk.integration.test.ts --no-file-parallelism
```
