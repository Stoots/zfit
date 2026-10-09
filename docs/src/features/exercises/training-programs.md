# Training Programs

A **Training Program** organizes multiple weeks around a goal. It contains ordered **Program Phases**, each with its own goal, dated weeks, and **Planned Sessions**. A **Workout Plan** remains a separate reusable collection of workouts: use it independently or select it for a Planned Session. Creating a Program does not activate, change or replace a Workout Plan.

## Author and schedule on web

1. Open **Exercises → Open Training Programs** (or `/training-programs`). Use **Manage Workout Plans** to create the Workout Plans you want to reuse.
2. Select **Create Training Program**. Enter a name, goal, and inclusive start/end dates.
3. Add phases and enter each phase's name and goal. Add weeks within the Program dates. Each week spans one to seven days; weeks must be chronological and cannot overlap.
4. Add Planned Sessions. Give each session a name, choose an authored calendar date within its week, and select one of your Workout Plans. Multiple sessions can share a date or reuse the same plan.
5. Leave **Auto-shift after a miss** off for fixed dates, or explicitly enable it. Save to view your schedule and history. Empty structures can be saved for later authoring.

Use the move buttons to change structure order; maintain chronological week dates when moving weeks or phases. Cancel discards unsaved edits. Delete requires confirmation and removes the Program and its history, never reusable Workout Plans or diary workouts. Removing a phase/week during aggregate editing removes only unrecorded sessions; ancestors containing recorded sessions cannot be removed.

## Completion and missed history

Every session starts **Planned**. In the Program detail view:

- **Link completed workout**: choose a diary date, select an owner-owned grouped workout or standalone exercise workout, and confirm completion. This is an explicit declaration that you completed that workout, not automatic detection from diary rows (which may contain planned sets). It does not log another workout. The diary date need not equal the session date, and the workout need not have originated from the selected Workout Plan.
- **Mark missed**: confirm a permanent missed record. There is no implicit clock-driven miss detection; the athlete can record a miss on any session date.
- **Completed** and **Missed** sessions show their recorded schedule date and outcome timestamp. Completion also shows the linked workout's name/date with a diary link. Workout and Workout Plan names are snapshotted when recording an outcome. Later diary or plan renames, diary date edits, and diary deletion do not rewrite the Program history. Diary deletion clears the live foreign-key link, not the completion snapshot.

Outcomes are final: a missed session cannot be changed to completed, a completed session cannot be changed to missed or linked to a different workout, and recorded sessions cannot be removed or rewritten through aggregate edits. One diary workout can fulfill at most one Planned Session across all of your Programs. A grouped workout's child exercise is not a separate standalone workout; link the grouped parent instead. Retrying the same outcome is idempotent, including after diary deletion.

## Fixed dates and deterministic auto-shift

**Fixed dates are the default** (`auto_shift: false`). Recording a miss changes only that session's state. Existing standalone Workout Plan schedules are unaffected.

When enabled, **each newly recorded miss advances all still-Planned Sessions in that Program whose current effective date is strictly later than the missed session's effective date by exactly one Gregorian calendar day**. Selection uses dates, not structure order, server time, elapsed time since the miss, or the diary workout date. All eligible dates move together, preserving intervals between them. Same-day sessions do not move. Missed and completed sessions never move, disappear, or change state through shifting. Repeated misses on different sessions apply cumulatively; retrying a miss on the same session does not shift again. Enabling/disabling the option affects only subsequent new misses and is not retroactive.

For example, sessions authored October 25, October 30 and November 7 become: **October 25 Missed**, **October 31 Planned**, **November 8 Planned**. Missing the October 31 session next retains both missed records and moves the last session to **November 9 Planned**. A completed session is skipped regardless of where it falls on the calendar.

### Date boundaries and aggregate editing

- `scheduled_date` is the **authored date**, strictly contained within the authored week and Program. Week dates remain chronological, nonoverlapping, and at most seven days inclusive.
- `effective_date` is the **resulting schedule date**. It starts equal to the authored date. Shifts may move it beyond its original week, phase's weeks, or Program end. Sessions retain their original week/phase IDs; no weeks are expanded or sessions reparented. The web UI displays the resulting date, the authored date when different, and `schedule_end_date` when the schedule extends beyond the authored Program end.
- `schedule_end_date` is the later of the authored Program end and all effective session dates, including recorded history. Authored Program/week dates do not expand automatically.
- All days are `YYYY-MM-DD` calendar strings from `0001-01-01` through `9999-12-31`. Adding one day respects month/year rollover and leap days, independent of DST and timezone. A miss that would push an eligible session past `9999-12-31` returns 409 and rolls back **both** the outcome and every shift. Disable auto-shift or edit the future authored date before retrying.
- Aggregate saves retain effective dates when authored dates are unchanged. Deliberately editing a still-Planned Session's authored date resets its effective date to the new authored date. Other edits, including Program/week range edits and auto-shift toggles, never recalculate dates.
- Recorded sessions must retain their IDs, parents, names, authored dates and Workout Plans; their effective dates, timestamps and completion snapshots are read-only. Their containing phases/weeks must remain. Order may change; goals and valid containing date ranges may be edited. An invalid or history-rewriting aggregate save is rejected atomically.
- Outcome recording and aggregate editing lock the Program in one transaction. Concurrent duplicate misses yield one shift; duplicate completion links yield one winner and 409 for the competing link.

## Privacy and deletion safety

Training Programs are owner-only. Family delegates cannot view or edit them, including with diary, report or exercise-library access. Switch to your own profile first. Only your own Workout Plans and diary workouts can be referenced. Explicit owner predicates, RLS and composite foreign keys enforce isolation. Existing standalone Workout Plan sharing is unchanged.

A Workout Plan used by a Planned Session cannot be deleted until its Program references are removed. The server returns HTTP 409 and leaves both the plan and diary history untouched. Recorded sessions cannot be individually removed to release that reference; explicit Program deletion remains available.

This feature does not automatically log workouts, create cardio tests, or expose AI queries.

## HTTP interface

Requests use the application's session cookie or API-key authentication. No request accepts `user_id`; ownership is derived from authentication. Acting-user switches and `x-on-behalf-of-user-id` delegation are refused.

| Method | Path                                                     | Result                                                                                  |
| ------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/api/training-programs`                                 | Your Programs with full structure, schedule and history                                 |
| POST   | `/api/training-programs`                                 | Create; returns persisted structure with HTTP 201                                       |
| GET    | `/api/training-programs/:id`                             | View your persisted Program                                                             |
| PUT    | `/api/training-programs/:id`                             | Atomically replace the editable aggregate, preserving recorded history                  |
| POST   | `/api/training-programs/:id/sessions/:sessionId/outcome` | Record a miss or link completion; returns the whole updated Program                     |
| DELETE | `/api/training-programs/:id`                             | Delete Program hierarchy/history, preserving diary workouts and Workout Plans; HTTP 204 |

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
              "workout_plan_id": 17
            }
          ]
        }
      ]
    }
  ]
}
```

`workout_plan_id` must identify an existing plan you own; `17` is illustrative. Omitted `schedule_type` defaults to `"fixed"` (authored-date policy); omitted `auto_shift` defaults to `false`. Responses include Program UUID, owner, audit timestamps, `schedule_end_date`, and stable UUIDs and zero-based `sort_order` for every child. Sessions also include `workout_plan_name`, `effective_date`, `status`, nullable `outcome_at`, and nullable `completed_workout: { type, id, name, entry_date }`.

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

## Focused verification

Start the server against an isolated PostgreSQL database first so migrations and RLS are applied. Integration tests use real Better Auth sessions, HTTP routes, repositories and the non-superuser application role. They skip explicitly if the database probe fails. Run backend fixtures **serially**, including the full suite, to avoid concurrent migration/RLS setup deadlocks.

```bash
# From SparkyFitnessServer
pnpm exec vitest run tests/trainingPrograms.integration.test.ts tests/workoutPlanTemplateService.test.ts tests/rlsPermissionMatrix.integration.test.ts --no-file-parallelism

# From SparkyFitnessFrontend
pnpm exec jest src/tests/components/TrainingPrograms.test.tsx --runInBand
```
