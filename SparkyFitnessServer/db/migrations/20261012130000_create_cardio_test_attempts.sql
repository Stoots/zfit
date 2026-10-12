CREATE TABLE cardio_test_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  test_type text NOT NULL CHECK (test_type IN ('cooper_run')),
  attempt_date date NOT NULL CHECK (attempt_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  results jsonb NOT NULL CHECK (
    jsonb_typeof(results) = 'object'
    AND results ? 'distance_meters'
    AND CASE
      WHEN jsonb_typeof(results->'distance_meters') = 'number'
      THEN (results->>'distance_meters')::numeric > 0
      ELSE false
    END
    AND results - 'distance_meters' = '{}'::jsonb
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cardio_test_attempts_user_date_idx
  ON cardio_test_attempts(user_id, attempt_date, created_at, id);
