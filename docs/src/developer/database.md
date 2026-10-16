# Database Schema & Migrations

_Last updated: 2026-10-11_

This document covers the database structure, schema design, and migration process for SparkyFitness.

**Note:**

- For **authoritative table definitions**, see `db_schema_backup.sql` (SQL source) or `shared/src/schemas/database/` (TypeScript Zod schemas).
- For **security tier classifications and permission mappings**, see [Database Security Tiers](./database-security-tiers).

---

## Database Overview

SparkyFitness uses PostgreSQL 15+ with Row Level Security (RLS) to ensure data isolation between users. The database follows a normalized design with clear relationships between entities.

---

## Schema Design Principles

### Naming Conventions

- **Tables**: Snake case, plural (e.g., `food_entries`, `user_preferences`)
- **Columns**: Snake case (e.g., `created_at`, `user_id`, `total_calories`)
- **Foreign Keys**: `{table_name}_id` format (e.g., `user_id`, `food_item_id`)
- **Indexes**: Descriptive names (e.g., `idx_food_entries_user_date`, `idx_measurements_user_type`)

### Standard Fields

All tables include these audit fields:

- `id` - UUID primary key using `gen_random_uuid()`
- `created_at` - Timestamp with timezone, defaults to `NOW()`
- `updated_at` - Timestamp with timezone, updated via triggers

---

## Row Level Security (RLS)

Every user-specific table has RLS policies to enforce data isolation. PostgreSQL context functions (initialized via `public.set_app_context(userId, authenticatedUserId)` on every connection) control access:

```sql
-- Example: diary logs are readable by delegates with diary read access and
-- writable by delegates with can_manage_diary. rls_policies.sql usually applies
-- this via the create_diary_policy('food_entries') generator, which emits:
ALTER TABLE food_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_policy ON public.food_entries FOR SELECT TO PUBLIC
  USING (has_diary_read_access(user_id));
CREATE POLICY modify_policy ON public.food_entries FOR ALL TO PUBLIC
  USING (has_diary_access(user_id))
  WITH CHECK (has_diary_access(user_id));
```

**Key functions:**

- `current_user_id()` — active profile context (may differ during family delegation; from `app.user_id`)
- `authenticated_user_id()` — the true logged-in actor (never changes; from `app.authenticated_user_id`)
- `can_access_user_data(target_user_id, permission_type, authenticated_user_id())` — resolves a logical permission (`diary`, `checkin`, `medications`, `reports`, plus `*_read` variants) against the `family_access` grant. Domain shortcuts wrap it: `has_diary_read_access`, `has_diary_access`, `has_checkin_read_access`, `has_medication_access`, `has_family_access`.

Cycle and pregnancy tables are owner-only (no delegation). See `SparkyFitnessServer/db/rls_policies.sql` for the complete policy set and the `create_*_policy` generators.

---

## Table Index

Quick reference of all tables by domain and purpose. For detailed security tier, permission type, and access rules, see [Database Security Tiers](./database-security-tiers).

### Authentication & Identity (Tier 1: Owner-Only)

| Table          | Purpose                                     |
| -------------- | ------------------------------------------- |
| `user`         | Account identity, password hash, email      |
| `session`      | Active authentication sessions              |
| `api_key`      | User-generated API keys for external access |
| `passkey`      | Passwordless login credentials              |
| `two_factor`   | 2FA recovery codes and secrets              |
| `verification` | Email verification tokens                   |
| `account`      | Auth credentials and email accounts         |

### Food & Nutrition (Tier 2/3: Owner-Write, Delegate-Read/Write)

| Table                            | Purpose                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `foods`                          | Custom food items created by user                                      |
| `food_variants`                  | Serving size options for foods                                         |
| `food_entries`                   | Logged meals/calories for the day                                      |
| `food_entry_meals`               | Meal details associated with logged entries                            |
| `meals`                          | Custom meal templates                                                  |
| `meal_foods`                     | Ingredients assigned to meals                                          |
| `meal_types`                     | Custom meal type definitions (breakfast, lunch, etc.)                  |
| `meal_plans`                     | Weekly meal planning schedules                                         |
| `meal_plan_templates`            | Reusable meal plan templates (supports multiple active plans per user) |
| `meal_plan_template_assignments` | Scheduled meal templates to calendar                                   |
| `meal_plan_assignment_sets`      | Sets within assigned meal plans                                        |

### Exercise & Workouts (Tier 2/3: Owner-Write, Delegate-Read/Write)
| Table | Purpose |
|-------|---------|
| `exercises` | Custom exercises created by user |
| `exercise_entries` | Logged exercises for the day |
| `exercise_preset_entries` | Logged workout presets with frozen workout format and nullable time cap |
| `exercise_entry_sets` | Reps, weights, and sets completed |
| `exercise_entry_activity_details` | Heart rate, distance, activity data |
| `exercise_entry_laps` | Lap split intervals for workouts |
| `exercise_entry_hr_zones` | Heart-rate time-in-zone splits per workout |
| `exercise_entry_gps_points` | GPS trackpoints & second-by-second telemetry. One row per workout (the `points` column holds the whole track as JSONB), not one row per trackpoint |
| `workout_presets` | Custom workout/preset templates |
| `workout_preset_exercises` | Exercises assigned to presets |
| `workout_preset_exercise_sets` | Reps/sets configured in presets |
| `workout_plan_templates` | Templates for weekly and sequential workout schedules |
| `workout_plan_sessions` | Stable owner-consistent sessions with independent prescriptions, optional weekdays and authored order |
| `workout_plan_template_assignments` | Ordered exercise/preset assignments belonging to an exact Workout Session; presets execute from local snapshots |
| `workout_plan_assignment_sets` | Individual exercise prescriptions; distance and JSONB extension fields retain effort/ranges and per-side instructions |
| `workout_feedback` | Session / per-exercise workout feedback (difficulty, pain flag and note) behind adaptive suggestions |
| `cardio_test_attempts` | Dated Test Attempts for Cooper run and other supported Cardio Tests |

### Training Programs (Tier 1: Owner-Only)

| Table                           | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `training_programs`             | Goal and inclusive fixed date range for a multi-week Program            |
| `training_program_phases`       | Ordered goal-bearing Program Phases                                    |
| `training_program_weeks`        | Chronological, nonoverlapping weeks within phases                      |
| `training_program_sessions`     | Dated Planned Sessions referencing exact Workout Sessions or Cardio Test protocols |
| `workout_program_consolidations` | Owner-only approved consolidation manifests and repeat/recovery receipts |

The four Program hierarchy tables and consolidation journal use `create_owner_policy`; composite foreign keys preserve owner identity. A Planned Session references either an exact `workout_plan_sessions` row or a Cardio Test protocol. `cardio_test_attempts.planned_session_id` is nullable for standalone attempts and has a composite foreign key with owner and protocol; only an owner can set it through the API. Program deletion clears this link and retains the attempt. The session's plan ID/name are derived display-only API fields. Removing a Program-referenced workout session/plan, diary-linked assignment or journal-referenced target plan is refused with HTTP 409, atomically. Program deletion cascades through its hierarchy and journal but leaves Workout Plans and their prescriptions intact.

Migration `20261011120000_optional_workout_sessions.sql` adds required-by-default
`is_optional` flags to the existing library and Program session tables. It does
not alter ownership policies, existing identities, prescriptions or outcomes.
New Program bindings inherit library optionality unless overridden; existing
bindings retain their own stored flag. An uncompleted optional session past its
effective athlete-local day is projected as `omitted`, with `outcome_at` derived
from the next local midnight. The database retains its underlying `planned`
status until an explicit completion link; no scheduler, diary write or automatic
miss is involved. Required completed/missed history remains immutable.

### Measurements & Health (Tier 1/3: Owner-Only or Delegate-Write)

| Table                     | Purpose                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_in_measurements`   | Weight, body composition, BMR, and circumference measurements                                                                                                                          |
| `check_in_photos`         | Progress photos                                                                                                                                                                        |
| `custom_measurements`     | User-defined custom measurement types                                                                                                                                                  |
| `custom_categories`       | User-defined measurement categories                                                                                                                                                    |
| `water_intake`            | Total water logged for the day                                                                                                                                                         |
| `water_intake_entries`    | Individual logged water cups                                                                                                                                                           |
| `water_containers`        | Configured container sizes                                                                                                                                                             |
| `sleep_entries`           | Sleep logs (bedtime, wake time)                                                                                                                                                        |
| `sleep_entry_stages`      | Sleep stage breakdowns (REM, Deep, Light)                                                                                                                                              |
| `sleep_need_calculations` | AI sleep need calculations                                                                                                                                                             |
| `daily_sleep_need`        | Sleep goals calculated for the day                                                                                                                                                     |
| `health_metric_samples`   | Intraday wearable telemetry — heart rate, HRV, respiration, SpO2, stress, body battery, skin temperature. One JSONB-bucketed row per user/metric/day/provider (not one row per sample) |
| `vitals_entries`          | Blood pressure, blood glucose, and temperature logs                                                                                                                                    |
| `daily_health_metrics`    | Daily automated wearable summary, scores, and source-timed total calories                                                                                                              |

### Fasting, Mood, Medications, & Symptoms (Tier 1/3: Owner-Only or Delegate-Write)

| Table                        | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `fasting_logs`               | Fasting timeline logs (start/end fast)                                                 |
| `user_fasting_preferences`   | Intermittent fasting targets, auto-calculation config, and alert timing                |
| `mood_entries`               | Logged mood and energy levels                                                          |
| `mindfulness_sessions`       | Logged mindfulness, meditation, and breathwork sessions                                |
| `user_custom_moods`          | User-defined mood tags (icon/color)                                                    |
| `medications`                | Custom medication inventory lists                                                      |
| `medication_schedules`       | Reminders and schedules for medications                                                |
| `medication_entries`         | Logs of medications taken                                                              |
| `medication_pens`            | Trackers for medication delivery pens                                                  |
| `medication_titration_steps` | Automated titration dosage plans                                                       |
| `injection_entries`          | Injection logs (site, time, etc.)                                                      |
| `user_custom_symptoms`       | Symptom definitions (template, sections, custom fields)                                |
| `symptom_entries`            | Symptom quick logs and episodes (also holds cycle-hub symptoms, `source = 'cycle'`)    |
| `user_symptom_options`       | Pick-list library: locations, qualities, associated symptoms, triggers, relief methods |
| `symptom_entry_treatments`   | Medications and relief methods used for a symptom entry, with effectiveness            |
| `symptom_entry_photos`       | Photos attached to a symptom entry                                                     |
| `symptom_free_days`          | Explicit "no symptoms today" markers                                                   |

### Cycle & Pregnancy (Tier 1: Owner-Only)

| Table                       | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `cycles`                    | Menstrual cycle history records            |
| `cycle_settings`            | Cycle hub settings (mode, parameters)      |
| `cycle_daily_entries`       | Per-day cycle logs (flow, BBT, mood, etc.) |
| `cycle_test_entries`        | Ovulation and pregnancy test logs          |
| `pregnancies`               | Pregnancy records (due date, status)       |
| `pregnancy_kick_sessions`   | Fetal kick-counter sessions                |
| `pregnancy_contractions`    | Contraction timer logs                     |
| `pregnancy_photos`          | Bump photo journal                         |
| `pregnancy_checklist_state` | Weekly pregnancy checklist completion      |
| `health_appointments`       | Prenatal and other health appointments     |

### User Preferences & Settings (Tier 2: Owner-Only Write, Delegate-Read)

| Table                                 | Purpose                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `profiles`                            | User full name, height, display metrics                                                     |
| `user_preferences`                    | Unit, formatting, and chart display preferences                                             |
| `user_nutrient_display_preferences`   | Nutrient column display preferences                                                         |
| `user_meal_visibilities`              | Visibility settings for meals                                                               |
| `user_goals`                          | Active daily calorie/macro goals                                                            |
| `user_custom_nutrients`               | Custom nutrient definitions                                                                 |
| `user_nutrient_goal_preferences`      | Per-user minimum/maximum/target goal direction override per nutrient (predefined or custom) |
| `user_water_containers`               | Configured container sizes                                                                  |
| `user_dashboard_layouts`              | Rearranged dashboard widget positions                                                       |
| `user_medication_display_preferences` | GLP-1/Medication display preferences                                                        |
| `user_mood_display_preferences`       | Mood picker visibility settings                                                             |
| `user_cycle_display_preferences`      | Cycle dashboard tile visibility                                                             |
| `user_allergen_preferences`           | Allergen preferences                                                                        |
| `user_ignored_updates`                | Records of skipped release updates                                                          |

### AI & Chat (Tier 1: Owner-Only)

| Table                 | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `sparky_chat_history` | AI Assistant chat messages and history       |
| `ai_service_settings` | User-defined custom assistant configurations |

### Admin & System (Tier 1: Admin-Only or Public)

| Table                                   | Purpose                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `global_settings`                       | Application feature flags and config                                                               |
| `sso_provider`                          | Active Single Sign-On providers                                                                    |
| `oidc_providers`                        | OpenID Connect integration settings                                                                |
| `external_provider_types`               | Search provider configurations (FatSecret, USDA, Canadian Nutrient File)                           |
| `external_data_providers`               | Configured API integration credentials, including personal or global Open Food Facts accounts      |
| `openfoodfacts_product_read_rate_limit` | Singleton lease and cooldown coordinating Open Food Facts product reads across server instances    |
| `openfoodfacts_sync_queue`              | Dormant revision-aware automatic upload state and retained history; unused by manual contributions |
| `rate_limit`                            | Sign-in rate limit counters shared across server instances                                         |
| `medication_types`                      | Medication categories lookup                                                                       |
| `medication_route_types`                | Medication administration routes lookup                                                            |
| `medication_schedule_types`             | Medication scheduling frequencies lookup                                                           |
| `admin_activity_logs`                   | Admin action audits                                                                                |
| `day_classification_cache`              | Daily summary caching logs                                                                         |

### Internal & Shared (Tier 2: Owner-Only or System)

| Table               | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `onboarding_data`   | Initial user onboarding metrics          |
| `onboarding_status` | User onboarding status                   |
| `family_access`     | Sharing rules and delegation credentials |
| `backup_settings`   | Automated database backup settings       |

---

## Provider Credentials (`external_data_providers`)

Integration credentials are stored **encrypted, not in the plaintext columns**. This
trips up most people writing their first provider.

`external_data_providers` has both plaintext (`app_id`, `app_key`) and encrypted
(`encrypted_app_id` / `app_id_iv` / `app_id_tag`, and the matching `app_key` triplet)
columns. The plaintext columns are legacy and **stay `NULL`** — reading them returns
nothing even for a provider that is configured and syncing correctly, which surfaces
as a misleading "email is missing" or "API key is missing" error on a row that
genuinely has one.

Open Food Facts contributions in the first release use explicit owner-only preview
and confirmation endpoints at `/api/v2/foods/:foodId/openfoodfacts/preview` and
`/api/v2/foods/:foodId/openfoodfacts/contribute`. The server-wide
`allow_openfoodfacts_contributions` gate makes this available; it does not grant
publication consent. The authenticated actor must own the food, have an active
personal account or eligible global fallback, and confirm the exact data and own
photo. A short-lived signed preview binds the food, outgoing fields, sanitized
image, product language, provider configuration and public product revision.

Eligibility excludes Open Food Facts and proprietary-provider imports, requires a
non-empty name and checksum-valid non-internal GTIN, and only permits a
metric-convertible default variant. Photo upload precedes the structured data
write. If the photo succeeds but the data result cannot be confirmed, the
response reports that partial result without assuming the data was not saved.

Automatic queue functions and `openfoodfacts_sync_queue` remain dormant for future
work. The release disables automatic worker/scheduler execution, installs no food
enqueue or preference-backfill triggers, and does not let an old
`auto_contribute_openfoodfacts` preference activate uploads. Saving a product,
provider or setting therefore creates no public contribution or backfill.

Product Opener reads from barcode lookup and manual preview/confirmation share the
database-coordinated permit in `openfoodfacts_product_read_rate_limit`. It is held
through the response and enforces at least five seconds between product reads
across server instances; search endpoints are not throttled by this limiter.

Encryption is AES-GCM via `security/encryption.ts`, keyed by
`SPARKY_FITNESS_API_ENCRYPTION_KEY`. Each value needs all three of its columns
(ciphertext, IV, auth tag) to be decryptable.

### Reading a credential

Two supported paths, depending on what you need:

- **A single provider's secret, inside an integration.** Query the encrypted triplet
  directly and `decrypt()` it. See `integrations/hevy/hevyService.ts`
  (`getHevyApiKey`) for the reference shape — note it uses `getSystemClient()`,
  since a background sync has no user request context.
- **A user's providers, for the UI or a service.** Use
  `externalProviderRepository.getExternalDataProviders(userId)`. It decrypts on the
  way out and returns the plaintext on the `app_id` / `app_key` properties of the
  returned object — so those _field names_ are populated even though the _columns_
  of the same name are `NULL`. Failed decryption is logged and yields `null` rather
  than throwing, so treat a `null` credential as "unusable", not "absent".

### Writing a credential

Never `INSERT`/`UPDATE` the plaintext columns. Encrypt first and write the triplet —
`externalProviderRepository` handles this for the standard create/update paths.

### What this means for a new provider

A provider whose `required_fields` include `app_id`/`app_key` is storing a user's
real third-party credential. Where that credential is an account **password** rather
than a revocable API key, note that the encryption is necessarily reversible: the
server must recover the plaintext to log in, so a database dump plus
`SPARKY_FITNESS_API_ENCRYPTION_KEY` yields working credentials. Prefer providers
that issue scoped, revocable API keys, and set `is_strictly_private = TRUE` on any
provider type holding a personal credential so it is never exposed through family
sharing.

---

## Database Migrations

SparkyFitness uses a custom migration system that runs automatically on server startup.

### Migration Process

The migration system:

1. **Checks current database version** on startup
2. **Applies pending migrations** in order
3. **Tracks applied migrations** in `system.schema_migrations`
4. **Logs migration results** for debugging

`SparkyFitnessServer/index.ts` loads configuration, awaits database initialization
and RLS, and only then dynamically imports the server. Preserve that ordering:
an import-time failure after migrations does not imply migration failure.
The exercise repository aggregator uses static named function imports from
`exerciseTemplate.ts`; those function declarations are initialized during ESM
linking. Do not restore a top-level awaited dynamic import on the
repository → template → service → repository cycle, or eagerly read the
template's default object within that cycle: the former prevents server import
from settling, and the latter can access an uninitialized binding.

### Migration Structure

Migrations are stored in `SparkyFitnessServer/db/migrations/` with the naming pattern:

```
YYYYMMDDHHMMSS_description.sql
```

Example: `20240315103000_add_exercise_tracking.sql`

### Creating a New Migration

1. **Create the migration file** in the migrations directory:

   ```bash
   cd SparkyFitnessServer/db/migrations/
   touch 20240315142000_add_meal_planning.sql
   ```

2. **Write the migration SQL** — see the migration checklist in the repo's agent-docs folder (for developers and AI tools)

3. **`db_schema_backup.sql` updates itself** — after merge, CI regenerates it from the migrations and opens an automated sync PR; never edit it by hand

4. **Apply RLS policies** (these are reapplied automatically on startup from `db/rls_policies.sql`)

### Exercise-name capitalisation migration

`20261011101000_normalize_exercise_name_initial.sql` corrects `public.exercises.name` and `public.exercise_entries.exercise_name` in one transaction. Each historical label is transformed from its own stored value, including entries with a deleted parent. Only those two label columns change: IDs, owners, provider identifiers, relationships, prescriptions, results, raw provider details and audit timestamps remain intact. Already-normalized rows are not updated on a repeat run.

`public.normalize_exercise_name_initial(text)` uses PostgreSQL's `upper(left(value, 1)) || substring(value FROM 2)`. It preserves the remaining text; NULL, empty strings, leading whitespace and non-letter initial characters are not trimmed or rewritten. Case conversion follows the database locale.

Invoker-rights `BEFORE INSERT OR UPDATE OF` triggers enforce the rule at the existing library and diary persistence boundaries. They do not grant permissions or bypass RLS. No new tables, columns, Zod contracts, sharing rules or security tiers are introduced; existing web/mobile API responses carry the stored names. Plan/preset exercise labels continue to read the library through their existing joins.

Exact name-based repository lookups normalize the incoming initial character without changing user scope. CSV library import opts into `findExerciseByNameAndUserId(..., { visibleOnly: true })`, excluding `is_quick_exercise` records just like library search; history/provider callers retain access to hidden records by default. Garmin preserves established matching precedence: legacy title-case first, uppercase second, decoded provider casing last. These are matching-only spellings, never renames or merges; newly authored provider labels retain acronym/proper-name casing. Provider IDs and raw detail payloads are unchanged.

#### Disposable rehearsal and rollback

1. Back up the database and matching application version **before** applying this migration. Restrict access to backups: a real installation contains private health data and credentials. Uppercasing is not reversible, so do not attempt a generic lowercase rollback.
2. Restore into a disposable PostgreSQL database with a name containing `test`, point both owner and application connection settings at that isolated database, and disable scheduled jobs. Never run these regression suites or the broad migration runner against a live installation.
3. Run the normal startup migration/RLS path (the server's `test:migrations` script is also available for a disposable rehearsal). Compare full library/snapshot rows and related prescription/result tables against the backup, allowing only each row's own initial label character to change. Include renamed and deleted parents.
4. From `SparkyFitnessServer`, explicitly opt in to the real-database regressions:
   ```bash
   SPARKY_FITNESS_RUN_NAME_MIGRATION_TEST=1 pnpm exec vitest run \
     tests/exerciseNameMigration.integration.test.ts \
     tests/exerciseNameCapitalisation.integration.test.ts \
     --no-file-parallelism
   ```
   Both suites require reachable PostgreSQL; the write/read suite additionally requires the migrated schema and configured application role. Fixtures use the canonical nested Workout Session contract and owner-consistent UUID membership, not obsolete flat-plan writes. Full-row comparisons include session identity/audits and prescription relationships. Fixtures are synthetic and delete linked diary rows before owner cleanup. The migration suite exercises repeat runs and an injected failure after library correction to prove transaction rollback.
5. Rehearse full backup restore into another disposable database, verifying original labels, non-name data and pre-upgrade migration/schema state. For an authorized deployment rollback, stop writers, restore the pre-migration backup and matching application version, and verify before restarting. Do not drop the normalizer while running application queries that depend on it. Changes made after the backup require a separate recovery decision.

Before any approved deployment, exercise the actual library and diary with a new lowercase-first write/import and retained historical wording. Follow the frontend deployment smoke gate in [Troubleshooting](./troubleshooting) for live rollout; a disposable local smoke does not authorize or prove production deployment.

### Migration Best Practices

#### Backwards Compatibility

- **Add columns** with default values to avoid breaking existing code
- **Create new tables** rather than modifying existing ones when possible
- **Use transactions** to ensure atomic migrations
- **Test migrations** on development data first

#### Transaction Management

```sql
BEGIN;
-- All migration statements here
-- If any statement fails, entire migration rolls back
COMMIT;
```

#### Index Creation

```sql
-- Create indexes concurrently to avoid blocking
CREATE INDEX CONCURRENTLY idx_food_entries_user_date
ON food_entries(user_id, created_at);
```

#### Data Migration

```sql
BEGIN;
-- Create new table
CREATE TABLE new_table (id UUID PRIMARY KEY, ...);

-- Migrate existing data
INSERT INTO new_table (...)
SELECT ... FROM old_table;

-- Drop old table (after verifying migration)
-- DROP TABLE old_table;

COMMIT;
```

### Rollback Strategy

While not automated, rollback migrations can be created:

1. **Document rollback steps** in migration comments
2. **Create rollback scripts** for complex migrations
3. **Test rollback procedures** in development
4. **Backup database** before applying production migrations

### Selected-Program consolidation operator runbook

Consolidation is an explicit operator action, not a startup data migration or a
public HTTP endpoint. Reuse the [generic Workout Session upgrade](#workout-session-cutover-preflight-and-explicit-mapping)
first. Normal startup applies `20261011140000_workout_program_consolidation.sql`
and reapplies RLS. This additive migration makes the assignment/session membership
FK `DEFERRABLE INITIALLY IMMEDIATE`; ordinary writes still validate immediately.
Only consolidation temporarily defers it and validates it again before commit.
The new Tier 1 journal stores the operation UUID, owner, Program, target plan,
approved manifest, result and creation timestamp. Owner/Program deletion cascades
its journal rows; deleting a journal-referenced target plan is refused. The
journal is a replay receipt, not an inverse migration or a substitute for a backup.

#### Connection and private-file guards

Run `scripts/consolidateWorkoutProgram.script.ts` from `SparkyFitnessServer`.
It does not load dotenv, discover deployments, bootstrap a schema or choose a
default database. Supply `SPARKY_FITNESS_DB_HOST`, `SPARKY_FITNESS_DB_PORT`,
`SPARKY_FITNESS_DB_NAME`, `SPARKY_FITNESS_APP_DB_USER` and
`SPARKY_FITNESS_APP_DB_PASSWORD` through a protected environment file. Never put
passwords in command arguments or publish environment files. The connected
application role must not be a superuser, bypass RLS or have table-owner privileges.
The actor and requested owner must be the same; delegates cannot consolidate.

`--expected-host`, `--expected-port` and `--expected-database` must exactly match
the supplied environment strings. This is an explicit-target guard, **not** a
disposable-only restriction or production approval. Every private manifest,
legacy map and receipt must be outside the repository's physical path (including
symlink resolution). Inputs must have no group/world permissions; use mode `0600`.
`--output` is mandatory and opened exclusively with mode `0600` before database
writes: an existing output path is rejected, never overwritten.

#### Read-only inventory and reviewed mapping

The following command template uses operator-supplied private paths and IDs, not
real installation values:

```bash
# From SparkyFitnessServer; configure these variables without exposing secrets.
node --env-file="$PRIVATE_ENV_FILE" --import tsx scripts/consolidateWorkoutProgram.script.ts \
  --action preflight --owner "$OWNER_UUID" --program "$PROGRAM_UUID" \
  --name 'Consolidated Workout Plan' \
  --expected-host "$EXPECTED_HOST" --expected-port "$EXPECTED_PORT" \
  --expected-database "$EXPECTED_DATABASE" --output "$NEW_PRIVATE_PREFLIGHT"
```

`--action` defaults to `preflight`. Preflight requires `--program` and `--name`;
`--description` is optional, and `--execute`/`--manifest` are refused. Its
repeatable-read, read-only transaction inventories owner-scoped Programs,
plans, sessions, assignments, sets, diary links, sharing grants and prior journals,
including references outside the selected Program. Review `schema_state`,
`inventory`, `unresolved`, `blockers`, `legacy_mapping`, `protections` and `proposal`.
Never approve by labels, row counts or the plan's first/current session.

On a legacy whole-plan schema, `--legacy-mapping "$PRIVATE_LEGACY_MAP"` accepts a
JSON object mapping each ambiguous **Planned Session UUID to an integer legacy
assignment ID** in its intended group. Other-Program keys and foreign anchors
are rejected. Weekly groups use weekday (including null); sequential groups use
the legacy session index. The report remains blocked with no apply proposal:
use the existing generic upgrade's `app.workout_session_upgrade_mapping` setting
with the reviewed map, then normal startup migrations/RLS, and rerun preflight.
Passing a map to this CLI does not itself upgrade the schema.

On the session schema, review the exact source/target Session UUIDs and plan IDs,
every assignment/set source-to-target ID, authored occurrence order and all sorted
Planned Session bindings. The strict manifest also binds operation UUID, owner,
Program and a SHA-256 inventory revision. The target is an **inactive sequential
plan with prompt entry mode and `start_date`/`end_date` both SQL NULL**. Program
dates remain in the owner-only Program; do not copy its private calendar into a
family-readable library container or insert dates into the target manifest.

Every current new-apply session mapping requires `target_day_of_week: null`.
Preflight proposes this explicitly; both moves and clones persist the reviewed
null into the sequential destination, even when the source plan is weekly.
Protected weekly sources retain their original weekdays. Program dates and
authored order remain unchanged; destination weekdays are not a replacement
Program calendar. Non-null or missing destination weekdays are rejected for
new writes, not silently normalized during apply.

An old **unapplied** manifest missing this field requires a fresh preflight and
review before approval. Never add the field to an already approved receipt and
treat that edit as the original approval.

Unprotected moves retain Session UUIDs and assignment/set IDs. Protected sources
are cloned with explicitly approved new IDs and full SQL/JSON prescriptions;
only selected Program live bindings point to the clone. Original snapshots,
performed workouts and outside links stay at the source. Protection reasons
include an active standalone plan, active family library/report readers,
unselected sessions in the source plan, another Program binding, diary links
outside selected recorded outcomes, and a retained consolidation journal.
Completed selected outcome links alone do not require a clone. Library and
Program optional flags remain independent; absent deload sessions are not created.

`retire_plan_ids` defaults to an empty array. Add only explicitly reviewed source
plan IDs to the approved private proposal: every session must be accounted for
by safe moves, with no protected/clone/unselected/active consumers. Apply deletes
only those approved containers after verifying they are empty. It never performs
an implicit cleanup of old plans.

Numeric target IDs are a **read-only forecast, not a reservation**. Preflight
does not consume sequences. Concurrent global/hidden ID claims can invalidate
the proposal; apply rejects collisions rather than overwriting another row.
Review full prescriptions (including null/absent fields, frozen presets, effort,
rest, per-side instructions, ranges/notes, distance, format/cap), Program hierarchy
IDs/audits, dates/order, outcomes and diary/activity history against the inventory.

#### Approved apply, interruption and repeat recovery

After backup/rehearsal and the applicable explicit approval, retain the exact
approved proposal or whole preflight report in a mode-`0600` manifest:

```bash
node --env-file="$PRIVATE_ENV_FILE" --import tsx scripts/consolidateWorkoutProgram.script.ts \
  --action apply --owner "$OWNER_UUID" --program "$PROGRAM_UUID" \
  --manifest "$PRIVATE_APPROVED_MANIFEST" --execute \
  --confirm-operation "$APPROVED_OPERATION_UUID" \
  --expected-host "$EXPECTED_HOST" --expected-port "$EXPECTED_PORT" \
  --expected-database "$EXPECTED_DATABASE" --output "$NEW_PRIVATE_RECEIPT"
```

Apply requires `--execute`, `--confirm-operation` and the private manifest.
Operation/owner must match it exactly; `--program` is optional on apply but, when
supplied, must also match. Keep it in operator commands for explicit scope.
Apply locks the operation and owner graph, re-inventories and validates freshness,
membership, protections and retirements in one transaction. Errors roll back all
table changes and journal insertion; there is no automatic retry.

PostgreSQL sequence consumption is **nontransactional**: failed or interrupted
apply may advance allocators without leaving table changes. Sequence values are
excluded from the approved graph revision. If the graph is unchanged, approved
numeric IDs remain free and allocators are at or beyond them, replay the **same
approved manifest and operation UUID**, with a new output path. A committed
operation returns `already_applied: true` without changing rows or sequences.
Reusing the operation UUID with a different manifest is rejected. A stale graph
or claimed ID needs a newly reviewed/approved proposal, not an edited recovery
manifest or guessed replacement IDs.

A receipt error after database acknowledgment explicitly requests same-manifest
replay to a new private output. A killed process can leave an empty reserved
output file: it is not proof of rollback or commit. Recover through the journal
using the same manifest before preparing another operation. Do not delete journal
rows or reset sequences to make a repeat appear new.

**Recorded historical recovery:** the CLI validates operation/owner/Program
identity and confirmation without rewriting the supplied manifest. The repository
validates the identity envelope and actual owner, then locks the owner/operation
and reads the owner-scoped journal within the application-role transaction.
An exact unchanged recorded manifest returns the stored acknowledgment with
`already_applied: true` **before current write-schema validation**, including
historical manifests without `target_day_of_week`. Replay does not reinterpret,
coerce or reapply historical data and changes neither graph rows nor sequences.
A changed manifest for a recorded operation is rejected with status 409.
Delegates, unrelated owners and forged-owner requests cannot recover its receipt.

Only an **unrecorded** operation reaches strict current write validation.
An unrecorded old manifest missing `target_day_of_week` is rejected with status
400 and requires fresh preflight/review; there is no historical-format write
path. Never patch an approved manifest or rewrite a journal to recover a receipt.
Preserve the exact original input and use a new private output path.

The isolated disposable-Postgres consolidation regression suite passed 39 tests
with no failures, skips or pending cases. The existing RLS matrix ran separately
through the migration-check suite; its 26 pre-existing skipped cases remain
skips, not passes. These database checks do not constitute browser or production
acceptance. All database runs used disposable local PostgreSQL databases; no
live cutover, public-origin or native-runtime acceptance was run.

#### Private backup, isolated restore and rollback

1. Discover the actual deployment (`docker compose ls`) and read the runbook
   beside its Compose file before planning a live action. Record the exact
   database/application versions, migration state, selected owner/Program and
   connection expectations privately. Inventory approval is separate from
   approval to deploy or apply to that installation.
2. Take a protected full PostgreSQL backup before schema upgrade or consolidation,
   alongside the matching application/configuration and local editable Program
   export. Use the installation's backup procedure (for example a custom-format
   `pg_dump` through its explicit backup role), restrictive permissions and a
   checksum. Keep dumps, auth/environment files, exports and receipts outside
   Git and public trackers. Stop or fence writers for an approved cutover window;
   concurrent writes can stale the manifest.
3. Restore the backup into a **new isolated database**, never over the current
   installation for rehearsal. Supply explicit isolated owner/application
   connections and disable background integrations/jobs. Verify full rows,
   sequences, policies, triggers, FK identities/deferral and migration state,
   not only counts. PostgreSQL can canonicalize CHECK-expression text on restore;
   inspect semantic equivalence rather than claiming byte-identical deparses.
4. Rehearse normal startup upgrade, read-only preflight, approved apply,
   rejection/fault/interruption and same-manifest recovery/repeat there. Compare
   every prescription, hierarchy/date/order/optional flag, outcome, diary link,
   performed result and unrelated row; sequence advancement after rollback is
   an expected separately recorded difference. Rehearse backup restoration into
   another isolated database and retain evidence before approving live use.
5. For a separately authorized post-commit rollback, fence writers and preserve
   the current failed/post-cutover state first. Restore the pre-operation backup
   and its matching application/schema/configuration using the deployment runbook,
   then verify before reopening writes. There is no CLI `rollback` action:
   do not reverse mappings or delete the target manually. Full restore also
   replaces later unrelated writes; recovering changes since backup requires an
   explicit operator decision. Keep the backup available until acceptance ends.

Local rehearsal does not authorize production access, migration, deployment or
cutover and does not complete live acceptance. After separately approved live
application, verify the exact Program and week-specific strength/conditioning
starts, preserved completed/incomplete history, optional omission and same-day
order, and bulk preview/cancel/apply boundaries. Follow the [frontend deployment
smoke gate](./troubleshooting#frontend-deployment-smoke-gate) at the public origin
with caching enabled and verify the browser-loaded build, not container health.
Exercise the actual supported mobile flow; unavailable Android/iOS/watch runtime
checks must be reported as blockers, not inferred from tests or typechecks.
Refresh the private editable Program export from migrated data and retain
verification/rollback receipts outside Git/public issues.

### Workout Session cutover: preflight and explicit mapping

Migration `20261011110000_workout_plan_sessions.sql` is a clean transactional
cutover, not a live Program-consolidation operation. Do not deploy old consumers
against the new schema. The integration owner rehearses this on an explicitly
disposable database before any separately approved live operation.

Legacy grouping uses weekly `day_of_week` (including a distinct unscheduled null
group), or sequential `COALESCE(session_index, 1)`, never `session_name`. A legacy
plan with no assignments gets one empty session, so existing Program links can
retain their zero prescriptions without inventing work. Stable assignment/set
IDs, assignment and Planned Session audit timestamps, Program/phase/week/Planned Session IDs, authored
and effective dates, order, outcome JSON, existing name snapshots, completion FKs
and diary assignment links are retained. Presets freeze their full current
prescription once; no historical diary/outcome values are refreshed.
Logged preset parents gain nullable `time_cap_seconds` without a history
backfill. Execution's explicit frozen format/cap wins over mutable library
metadata; explicit null means no cap. Diary edits retain both timer fields unless
supplied explicitly. Explicit plan deletion rejects all linked diary history,
including incomplete prefill, before any deletion and never cleans up/unlinks it.
The binding backfill changes only the new Planned Session `workout_session_id`
and `workout_session_name_snapshot`; legacy `created_at`/`updated_at` and outcome
fields are untouched. Its queued legacy plan-FK checks are explicitly validated
with `SET CONSTRAINTS training_program_sessions_workout_plan_fk IMMEDIATE` before
the final table alteration. No constraint trigger is disabled; the new session
FK remains `DEFERRABLE INITIALLY DEFERRED`.

#### 1. Read-only preflight on the legacy schema

Use a migration/admin connection to a **disposable legacy baseline**, containing
all migrations before `20261011110000` (including name-only #10 if integrated).
Run this before invoking the session migration:

```sql
WITH candidate_groups AS (
  SELECT p.id AS workout_plan_id, p.user_id, p.schedule_type,
    CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week
      ELSE COALESCE(a.session_index, 1) END AS legacy_group_key,
    COALESCE(jsonb_agg(a.id ORDER BY a.sort_order NULLS LAST, a.id)
      FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb) AS assignment_anchors,
    count(a.id) = 0 AS empty_plan
  FROM workout_plan_templates p
  LEFT JOIN workout_plan_template_assignments a ON a.template_id = p.id
  GROUP BY p.id, p.user_id, p.schedule_type, legacy_group_key
), candidates AS (
  SELECT workout_plan_id, user_id, count(*) AS candidate_count,
    jsonb_agg(jsonb_build_object('schedule_type', schedule_type,
      'legacy_group_key', legacy_group_key, 'assignment_anchors', assignment_anchors,
      'empty_plan', empty_plan) ORDER BY legacy_group_key NULLS LAST) AS groups
  FROM candidate_groups GROUP BY workout_plan_id, user_id
)
SELECT s.id AS planned_session_id, s.program_id, s.workout_plan_id,
  s.scheduled_date, s.effective_date, s.sort_order, s.status,
  c.candidate_count, c.groups, c.candidate_count <> 1 AS requires_mapping
FROM training_program_sessions s
JOIN candidates c ON c.workout_plan_id = s.workout_plan_id AND c.user_id = s.user_id
ORDER BY s.program_id, s.scheduled_date, s.sort_order, s.id;
```

For **each** ambiguous Planned Session choose an assignment anchor from its
intended legacy group. The map is keyed by Planned Session UUID, not plan ID,
label or current progression. Reuse of a plan by another Program therefore
requires its own explicit decisions. One-group and empty plans auto-bind only
their unique target. Weekly null weekdays remain unscheduled; standalone
progression does not select them by weekday.

#### 2. Mapping interface and fail-closed error

The exact PostgreSQL setting is `app.workout_session_upgrade_mapping`. Its JSON
object maps a Planned Session UUID to a legacy **integer assignment ID**; both
JSON numeric values and decimal strings resolve through their text value:

```json
{
  "00000000-0000-4000-8000-000000000101": 7001,
  "00000000-0000-4000-8000-000000000102": 7002
}
```

With an absent/incomplete mapping, the migration raises SQLSTATE `P0001` **before
creating tables or changing rows**. The following is the expected shape, not
recorded rehearsal output (JSON key/row order is not guaranteed):

```text
ERROR: Workout Session preflight requires explicit operator mapping: [{"planned_session_id": "...", "workout_plan_id": 42, "candidate_count": 2}]
HINT: Set app.workout_session_upgrade_mapping to {"planned-session-uuid": legacy-assignment-id}. No first/current/label fallback is permitted.
```

An unknown Planned Session, or anchor from another plan/owner, raises:

```text
ERROR: Workout Session preflight mapping contains an unknown Planned Session or an assignment from another plan/owner
```

Missing mappings for ambiguous references are reported first. A non-object JSON
value, invalid weekly weekday, or inaccessible private legacy preset/exercise
also aborts preflight. Owner/public/family library access is checked before the
admin connection copies prescription data.

Apply from the repository root on the **disposable database only**, replacing
the UUIDs/assignment IDs with reviewed preflight output:

```bash
: "${DISPOSABLE_DATABASE_URL:?Set an explicitly disposable legacy database URL}"
psql "$DISPOSABLE_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v mapping='{"00000000-0000-4000-8000-000000000101":7001,"00000000-0000-4000-8000-000000000102":7002}' <<'SQL'
SELECT set_config('app.workout_session_upgrade_mapping', :'mapping', false);
\i SparkyFitnessServer/db/migrations/20261011110000_workout_plan_sessions.sql
\i SparkyFitnessServer/db/rls_policies.sql
SQL
```

`set_config(..., false)` is required here: the migration opens its own transaction,
so the map must exist in the same connection before `BEGIN`. For a migration
runner already inside a transaction, the equivalent syntax is
`SET LOCAL app.workout_session_upgrade_mapping = '{"planned-session-uuid":7001}';`.
Manual rehearsal application does not mark the normal startup migration tracking
row; explicit replay of this SQL is safe after its successful cutover. Do not
modify migration tracking in production as a substitute for an approved cutover.

#### 3. Minimal legacy seed for isolated rehearsal

Run the following in `psql` as the migration role on that disposable **pre-#11**
schema. It creates two same-label independently prescribed sequential groups,
two weekly groups (different labels on Monday still form one group), an empty
referenced plan, a public preset owned by a second user, and completed history:

```sql
BEGIN;
INSERT INTO public."user"(id,email,email_verified,name,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000000001','session-owner@example.invalid',true,'Session owner',now(),now()),
       ('00000000-0000-4000-8000-000000000002','session-provider@example.invalid',true,'Preset provider',now(),now());
INSERT INTO exercises(name,category,user_id,is_custom,source,shared_with_public)
VALUES ('Split squat','Strength','00000000-0000-4000-8000-000000000001',true,'custom',true)
RETURNING id AS exercise_id \gset
INSERT INTO workout_plan_templates(user_id,plan_name,schedule_type,entry_mode,start_date,end_date,is_active)
VALUES ('00000000-0000-4000-8000-000000000001','Sequential legacy','sequential','prompt','2026-10-11','2026-10-17',false)
RETURNING id AS sequential_plan_id \gset
INSERT INTO workout_plan_templates(user_id,plan_name,schedule_type,entry_mode,is_active)
VALUES ('00000000-0000-4000-8000-000000000001','Weekly legacy','weekly','prompt',false)
RETURNING id AS weekly_plan_id \gset
INSERT INTO workout_plan_templates(user_id,plan_name,schedule_type,entry_mode,is_active)
VALUES ('00000000-0000-4000-8000-000000000001','Empty legacy','sequential','prompt',false)
RETURNING id AS empty_plan_id \gset
INSERT INTO workout_plan_template_assignments(template_id,session_index,session_name,exercise_id,sort_order)
VALUES (:sequential_plan_id,1,'A',:'exercise_id',0) RETURNING id AS a2_anchor \gset
INSERT INTO workout_plan_template_assignments(template_id,session_index,session_name,exercise_id,sort_order)
VALUES (:sequential_plan_id,2,'A',:'exercise_id',0) RETURNING id AS a3_anchor \gset
INSERT INTO workout_plan_assignment_sets(assignment_id,set_number,set_type,reps,weight,rest_time,notes)
SELECT :a2_anchor,n,'Working Set',8,NULL,90,'RPE 7; 8-10 reps; per side' FROM generate_series(1,2) n;
INSERT INTO workout_plan_assignment_sets(assignment_id,set_number,set_type,reps,weight,rest_time,notes)
SELECT :a3_anchor,n,'Working Set',8,NULL,120,'RIR 2; per side' FROM generate_series(1,3) n;
INSERT INTO workout_plan_template_assignments(template_id,day_of_week,session_name,exercise_id,sort_order)
VALUES (:weekly_plan_id,1,'A',:'exercise_id',0) RETURNING id AS monday_anchor \gset
INSERT INTO workout_plan_template_assignments(template_id,day_of_week,session_name,exercise_id,sort_order)
VALUES (:weekly_plan_id,1,'Different label, same explicit day',:'exercise_id',1),
       (:weekly_plan_id,3,'A',:'exercise_id',0);
INSERT INTO workout_presets(user_id,name,description,is_public,workout_format)
VALUES ('00000000-0000-4000-8000-000000000002','Shared legacy preset',NULL,true,'standard')
RETURNING id AS preset_id \gset
INSERT INTO workout_preset_exercises(workout_preset_id,exercise_id,sort_order)
VALUES (:preset_id,:'exercise_id',0) RETURNING id AS preset_exercise_id \gset
INSERT INTO workout_preset_exercise_sets(workout_preset_exercise_id,set_number,reps,weight,rest_time,notes)
VALUES (:preset_exercise_id,1,8,NULL,60,'Do not refresh historical values');
INSERT INTO workout_plan_template_assignments(template_id,session_index,session_name,workout_preset_id,sort_order)
VALUES (:sequential_plan_id,2,'A',:preset_id,1);
INSERT INTO training_programs(id,user_id,name,goal,start_date,end_date)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Legacy Program','Preserve identity','2026-10-11','2026-10-17');
INSERT INTO training_program_phases(id,program_id,user_id,name,goal,sort_order)
VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','Phase','Preserve identity',0);
INSERT INTO training_program_weeks(id,program_id,phase_id,user_id,start_date,end_date,sort_order)
VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','2026-10-11','2026-10-17',0);
INSERT INTO training_program_sessions(id,program_id,week_id,user_id,name,scheduled_date,effective_date,workout_plan_id,sort_order)
VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','A','2026-10-11','2026-10-11',:sequential_plan_id,0),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','A','2026-10-12','2026-10-12',:sequential_plan_id,1),
('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','Weekly','2026-10-12','2026-10-12',:weekly_plan_id,2),
('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001','Empty','2026-10-13','2026-10-13',:empty_plan_id,3);
INSERT INTO exercise_entries(user_id,exercise_id,exercise_name,entry_date,duration_minutes,calories_burned,workout_plan_assignment_id,source)
VALUES ('00000000-0000-4000-8000-000000000001',:'exercise_id','Historical label','2026-10-11',30,200,:a2_anchor,'manual')
RETURNING id AS diary_id \gset
UPDATE training_program_sessions SET status='completed',outcome_at='2026-10-11T12:00:00Z',
  exercise_entry_id=:'diary_id',workout_plan_name_snapshot='Historical plan label',
  completed_workout=jsonb_build_object('type','individual','id',:'diary_id','name','Historical label','entry_date','2026-10-11')
WHERE id='00000000-0000-4000-8000-000000000101';
COMMIT;
SELECT jsonb_build_object(
  '00000000-0000-4000-8000-000000000101',:a2_anchor,
  '00000000-0000-4000-8000-000000000102',:a3_anchor,
  '00000000-0000-4000-8000-000000000103',:monday_anchor
) AS reviewed_fixture_mapping;
```

Copy that last JSON into the `-v mapping=...` invocation. First run without a map
to rehearse fail-closed ambiguity; then apply with the explicit map. Compare
full prescription rows and all retained IDs/links/outcome JSON against the
pre-upgrade export, not just counts. Confirm the empty Planned Session binds one
empty session, Monday retains both assignments, Wednesday is a separate session,
and A 2×8 / A 3×8 remain different sessions. Repeat with a private unshared preset
to require preflight rejection; repeat with an active exercise-library family
grant to permit the same prescription without granting Program access.

#### 4. Verification and rollback boundaries

Rehearsal and runtime checks are owned by the integration owner; these commands
are instructions, not claimed passing evidence. After upgrade, run the persisted
authenticated Program/plan scenarios and actual session start paths: exact bind,
isolated local snapshot edits, unchanged completed history, foreign ID rejection,
sharing, weekly/sequential standalone progression, and idempotent weekly prefill.
`dashboardWorkoutPlans.test.ts` covers same-day exact-session cards and missing
binding safety; the other affected server contract tests are migrated with the
consumer slice.

Any preflight/apply failure rolls the migration transaction back; retry from the
unchanged legacy baseline after resolving the reported mapping/access problem.
After a successful cutover, rollback requires restoring the rehearsed
pre-cutover backup plus the matching old consumer build. Do not reconstruct the
removed flat grouping columns from session names or silently replace session
identity with the first/current workout.

### Troubleshooting Migrations

#### Migration Fails

1. **Check migration logs** in application startup
2. **Verify database connection** and permissions
3. **Check for syntax errors** in migration SQL
4. **Ensure migration dependencies** are met

#### Migration Tracking Issues

```sql
-- Check applied migrations
SELECT * FROM migrations ORDER BY applied_at;

-- Manually mark migration as applied (if needed)
INSERT INTO migrations (version, applied_at)
VALUES ('20240315142000', NOW());
```

#### Database State Issues

```sql
-- Check table structure
\d table_name

-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'table_name';

-- Check indexes
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'table_name';
```

---

## Database Maintenance

### Performance Monitoring

- **Query performance**: Use `EXPLAIN ANALYZE` for slow queries
- **Index usage**: Monitor index usage with `pg_stat_user_indexes`
- **Connection monitoring**: Track connection pool usage

### Regular Maintenance

- **VACUUM**: Regular vacuuming for performance
- **ANALYZE**: Update table statistics
- **Index maintenance**: Rebuild indexes if needed
- **Log rotation**: Rotate and archive database logs
