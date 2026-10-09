-- Authored dates retain issue #2 containment; effective dates may extend beyond it.
ALTER TABLE training_programs ADD COLUMN auto_shift boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX exercise_entries_id_user_id_key ON exercise_entries(id, user_id);
CREATE UNIQUE INDEX exercise_preset_entries_id_user_id_key ON exercise_preset_entries(id, user_id);

ALTER TABLE training_program_sessions
  ADD COLUMN effective_date date,
  ADD COLUMN status text NOT NULL DEFAULT 'planned',
  ADD COLUMN outcome_at timestamptz,
  ADD COLUMN completed_workout jsonb,
  ADD COLUMN workout_plan_name_snapshot text,
  ADD COLUMN exercise_entry_id uuid,
  ADD COLUMN exercise_preset_entry_id uuid;
UPDATE training_program_sessions SET effective_date = scheduled_date;
ALTER TABLE training_program_sessions
  ALTER COLUMN effective_date SET NOT NULL,
  ADD CONSTRAINT training_program_sessions_effective_date_check CHECK (effective_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  ADD CONSTRAINT training_program_sessions_outcome_check CHECK (
    (status = 'planned' AND outcome_at IS NULL AND completed_workout IS NULL AND workout_plan_name_snapshot IS NULL AND exercise_entry_id IS NULL AND exercise_preset_entry_id IS NULL)
    OR (status = 'missed' AND outcome_at IS NOT NULL AND completed_workout IS NULL AND workout_plan_name_snapshot IS NOT NULL AND exercise_entry_id IS NULL AND exercise_preset_entry_id IS NULL)
    OR (status = 'completed' AND outcome_at IS NOT NULL AND completed_workout IS NOT NULL AND workout_plan_name_snapshot IS NOT NULL
      AND jsonb_typeof(completed_workout) = 'object'
      AND completed_workout ?& ARRAY['type','id','name','entry_date']
      AND ((completed_workout->>'type' = 'individual' AND exercise_preset_entry_id IS NULL AND (exercise_entry_id IS NULL OR exercise_entry_id::text = completed_workout->>'id'))
        OR (completed_workout->>'type' = 'preset' AND exercise_entry_id IS NULL AND (exercise_preset_entry_id IS NULL OR exercise_preset_entry_id::text = completed_workout->>'id'))))
  ),
  ADD CONSTRAINT training_program_sessions_exercise_entry_fk FOREIGN KEY (exercise_entry_id, user_id)
    REFERENCES exercise_entries(id, user_id) ON DELETE SET NULL (exercise_entry_id),
  ADD CONSTRAINT training_program_sessions_preset_entry_fk FOREIGN KEY (exercise_preset_entry_id, user_id)
    REFERENCES exercise_preset_entries(id, user_id) ON DELETE SET NULL (exercise_preset_entry_id);

-- Snapshot keys remain unique even after diary deletion clears the live FK.
CREATE UNIQUE INDEX training_program_sessions_completed_workout_key
  ON training_program_sessions(user_id, (completed_workout->>'type'), (completed_workout->>'id'))
  WHERE status = 'completed';
