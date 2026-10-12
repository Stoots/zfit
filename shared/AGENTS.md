# AGENTS.md

_Last updated: 2026-10-12_

`@workspace/shared` is a source-first TypeScript workspace library package for schemas, constants, and timezone/day helpers consumed by SparkyFitnessServer, SparkyFitnessFrontend, and SparkyFitnessMobile.

## Scope

- This package defines contracts and shared logic, not an app.
- Validate changes from consuming packages (server, frontend, mobile), not in isolation.
- Every schema change here potentially touches three packages.

## Structure

- `src/schemas/database/` - one Zod file per table (`Foods.zod.ts`, `Exercises.zod.ts`, ~60 files). Agent shortcut: to learn a table shape, read the matching file here instead of the SQL dump.
- `src/schemas/api/` - API request/response contracts (`*api.zod.ts`).
- `src/constants/` - shared constants and enums (exercises, nutrients, meal types, fasting protocols, medication schedules, cycle phases, etc.).
- `src/utils/` - timezone helpers (`todayInZone`, `instantToDay`, `dayToUtcRange`, `compareDays`, `addDays`, `isDayString`), cycle/menstruation helpers, and unit/calculation utilities.
- `src/ai/`, `src/cycle/`, `src/medications/`, `src/mood/` - domain-specific helpers.
- `src/symptoms/` - generic symptom tracking: constants and enums (scales, templates, sections, option kinds), template section resolution (`resolveSections`), built-in symptoms and pick-lists, head/body region ids for the location maps, and custom-field validation. The API contract is `src/schemas/api/Symptoms.api.zod.ts`.
- Training Programs: `src/schemas/api/TrainingPrograms.api.zod.ts` defines aggregate inputs and responses (ordered phases/weeks/Planned Sessions, fixed calendar dates, stable UUIDs and integer Workout Plan references). Database schemas are `TrainingPrograms.zod.ts`, `TrainingProgramPhases.zod.ts`, `TrainingProgramWeeks.zod.ts`, and `TrainingProgramSessions.zod.ts`. Owner-only; independent of standalone Workout Plans. `src/utils/dashboardWorkoutPlans.ts` (`selectDashboardWorkoutPlans`) splits eligible active plans into the next pending Program workout and standalone plans for the web and mobile dashboards; it is built on whole-plan references and will change with session-level references (issue #11).

## Naming Convention

- `X.api.zod.ts` = API request/response schema
- `X.zod.ts` = database table schema
- Export everything from `src/index.ts`; consuming packages import both types and values via `@workspace/shared`

## Cross-Package Contract Rules

- Changes to `src/schemas/api/` usually affect server routes and both frontend/mobile API clients.
- Changes to `src/schemas/database/` require a matching migration in the server (`SparkyFitnessServer/db/migrations/`), RLS policies, and the schema backup.
- Timezone/day-string helpers prevent bugs; prefer them over `toISOString().split('T')[0]`.
- Test any shared change from the consumer packages (`pnpm run validate` in SparkyFitnessServer, SparkyFitnessFrontend, and SparkyFitnessMobile after modifying shared).

## Working Rules

- Keep this package export-focused and schema-focused; logic that scales should live in consuming packages.
- Never export stale or unfinished types; if a consumer is drafting code and needs a type not yet here, add it.
