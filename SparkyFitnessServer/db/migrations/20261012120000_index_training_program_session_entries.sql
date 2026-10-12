-- training_program_sessions references diary rows through composite foreign keys
-- (entry id + user_id) declared ON DELETE SET NULL. Without an index on the
-- referencing columns, every diary delete scans the whole table to null them out.
-- Partial indexes: most sessions never link a diary entry.
CREATE INDEX IF NOT EXISTS idx_training_program_sessions_exercise_entry
  ON public.training_program_sessions (exercise_entry_id, user_id)
  WHERE exercise_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_program_sessions_exercise_preset_entry
  ON public.training_program_sessions (exercise_preset_entry_id, user_id)
  WHERE exercise_preset_entry_id IS NOT NULL;
