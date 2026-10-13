-- Optionality is authored data, never inferred from labels. Existing sessions
-- remain required. Program bindings retain their own flag independently of
-- subsequent library edits; owner-consistent FKs and RLS are unchanged.
ALTER TABLE workout_plan_sessions
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;
ALTER TABLE training_program_sessions
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;

-- Omitted is an authoritative calendar projection of an unfinished optional
-- session, not a stored final outcome. Reads do not mutate schedules or history.
-- Persisted missed/completed outcomes and completion uniqueness stay unchanged.
