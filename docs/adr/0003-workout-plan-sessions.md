---
status: accepted
---

# Reference individual Workout Sessions within a Workout Plan

ADR 0001 separates multiweek Training Programs from reusable Workout Plans, but linking each Planned Session to an entire Workout Plan leaves the intended workout ambiguous when the plan contains multiple sessions. Retain that separation and make a Program's planned workout reference a specific Workout Session within a Workout Plan, preserving each session's independent prescription even when A/B labels recur across weeks. This avoids requiring a separate top-level plan for every dated workout; Optional Sessions remain distinct from required training and must not block required-session progression or trigger rescheduling when omitted.

## Cutover constraints

Preserve existing Program identity, authored dates, session order, phase/week structure, prescriptions, completed-workout history and links. Consolidation must retain optional-day omissions in deload weeks and strength-before-conditioning order on shared dates; it must not flatten week-specific prescriptions into identical repeating workouts.

## Interview decisions

- Optional Sessions become Omitted after their scheduled calendar day ends in the athlete's timezone if no completion has been recorded. Omission does not count as a required-session miss, block required workouts or shift the schedule. A workout performed but logged later can still be linked as completion.
- Editing a Session Prescription affects only that session by default. A separate bulk action previews selected changes against explicitly chosen future sessions before applying them; it never changes completed-workout prescriptions or results.
- Standardise exercise-name capitalisation in existing library entries, planned workouts, historical diary labels and future create/edit/import paths. Capitalise the first letter while preserving acronyms and proper names; do not blindly lowercase the remaining text, merge exercises, change IDs or replace a historical exercise with its current renamed identity. Historical corrections are label-only and preserve all workout values and links.

## Status and relationship to ADR 0001

The user confirmed this design on 2026-10-11. It supersedes ADR 0001 only where planned workouts reference whole Workout Plans rather than specific Workout Sessions; the separation of Programs and Plans, fixed-date default and required-session history remain in force. This is an accepted target design, not a claim that the implementation or live-data cutover is complete.

Implementation specification: [GitHub issue #9](https://github.com/Stoots/zfit/issues/9). The approved execution tickets are #11 (session-level plans), #12 (optional outcomes), #13 (bulk edits), #10 (capitalisation) and #14 (consolidation/cutover).
