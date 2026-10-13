-- Operator consolidation is separate from the generic #11 upgrade. Normal
-- assignment writes still validate membership immediately; only an explicit
-- consolidation transaction defers this one FK while retaining row identities.
BEGIN;
ALTER TABLE workout_plan_template_assignments
  ALTER CONSTRAINT workout_plan_assignment_session_fk DEFERRABLE INITIALLY IMMEDIATE;

CREATE TABLE IF NOT EXISTS workout_program_consolidations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  program_id uuid NOT NULL,
  target_plan_id integer NOT NULL,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (program_id, user_id)
    REFERENCES training_programs(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (target_plan_id, user_id)
    REFERENCES workout_plan_templates(id, user_id) ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS workout_program_consolidations_owner_program_idx
  ON workout_program_consolidations(user_id, program_id);
ALTER TABLE workout_program_consolidations ENABLE ROW LEVEL SECURITY;
COMMIT;
