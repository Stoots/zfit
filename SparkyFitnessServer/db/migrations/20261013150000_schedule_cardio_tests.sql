ALTER TABLE training_program_sessions
  ALTER COLUMN workout_session_id DROP NOT NULL,
  ADD COLUMN cardio_test_type text,
  ADD CONSTRAINT training_program_sessions_kind_check CHECK (
    (workout_session_id IS NOT NULL AND cardio_test_type IS NULL)
    OR (workout_session_id IS NULL AND cardio_test_type IS NOT NULL)
  ),
  ADD CONSTRAINT training_program_sessions_cardio_identity UNIQUE (id, user_id, cardio_test_type);

ALTER TABLE training_program_sessions
  DROP CONSTRAINT training_program_sessions_outcome_check,
  ADD CONSTRAINT training_program_sessions_outcome_check CHECK (
    (status = 'planned' AND outcome_at IS NULL AND completed_workout IS NULL
      AND workout_plan_name_snapshot IS NULL AND exercise_entry_id IS NULL AND exercise_preset_entry_id IS NULL)
    OR (status = 'missed' AND outcome_at IS NOT NULL AND completed_workout IS NULL
      AND exercise_entry_id IS NULL AND exercise_preset_entry_id IS NULL
      AND (cardio_test_type IS NOT NULL OR workout_plan_name_snapshot IS NOT NULL))
    OR (status = 'completed' AND outcome_at IS NOT NULL AND
      ((cardio_test_type IS NOT NULL AND completed_workout IS NULL
        AND exercise_entry_id IS NULL AND exercise_preset_entry_id IS NULL)
      OR (cardio_test_type IS NULL AND completed_workout IS NOT NULL AND workout_plan_name_snapshot IS NOT NULL
        AND jsonb_typeof(completed_workout) = 'object'
        AND completed_workout ?& ARRAY['type','id','name','entry_date']
        AND ((completed_workout->>'type' = 'individual' AND exercise_preset_entry_id IS NULL
          AND (exercise_entry_id IS NULL OR exercise_entry_id::text = completed_workout->>'id'))
        OR (completed_workout->>'type' = 'preset' AND exercise_entry_id IS NULL
          AND (exercise_preset_entry_id IS NULL OR exercise_preset_entry_id::text = completed_workout->>'id'))))))
  );

ALTER TABLE cardio_test_attempts
  ADD COLUMN planned_session_id uuid,
  ADD CONSTRAINT cardio_test_attempts_planned_session_fk
    FOREIGN KEY (planned_session_id, user_id, test_type)
    REFERENCES training_program_sessions(id, user_id, cardio_test_type)
    ON DELETE SET NULL (planned_session_id);

CREATE UNIQUE INDEX cardio_test_attempts_planned_session_key
  ON cardio_test_attempts(planned_session_id) WHERE planned_session_id IS NOT NULL;
