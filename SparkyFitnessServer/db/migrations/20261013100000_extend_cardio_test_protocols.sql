CREATE FUNCTION cardio_test_results_valid(protocol text, result jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE effort jsonb;
BEGIN
  IF jsonb_typeof(result) <> 'object' THEN RETURN false; END IF;
  IF protocol = 'cooper_run' THEN
    RETURN result ? 'distance_meters'
      AND jsonb_typeof(result->'distance_meters') = 'number'
      AND (result->>'distance_meters')::numeric > 0
      AND result - 'distance_meters' = '{}'::jsonb;
  ELSIF protocol = 'sprint_6s' THEN
    IF NOT (result ? 'peak_watts')
       OR result - 'peak_watts' <> '{}'::jsonb
       OR jsonb_typeof(result->'peak_watts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(result->'peak_watts') <> 5 THEN RETURN false; END IF;
    FOR effort IN SELECT value FROM jsonb_array_elements(result->'peak_watts') LOOP
      IF jsonb_typeof(effort) <> 'number' OR (effort #>> '{}')::numeric < 0 THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF protocol = 'power_30s' THEN
    IF NOT (result ? 'efforts')
       OR result - 'efforts' <> '{}'::jsonb
       OR jsonb_typeof(result->'efforts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(result->'efforts') <> 2 THEN RETURN false; END IF;
    FOR effort IN SELECT value FROM jsonb_array_elements(result->'efforts') LOOP
      IF jsonb_typeof(effort) <> 'object'
         OR NOT (effort ? 'peak_watts' AND effort ? 'average_watts')
         OR effort - 'peak_watts' - 'average_watts' <> '{}'::jsonb
         OR jsonb_typeof(effort->'peak_watts') <> 'number'
         OR jsonb_typeof(effort->'average_watts') <> 'number' THEN RETURN false; END IF;
      IF (effort->>'average_watts')::numeric < 0
         OR (effort->>'average_watts')::numeric > (effort->>'peak_watts')::numeric THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF protocol = 'ramp' THEN
    RETURN result ? 'maximum_watts' AND result ? 'peak_heart_rate' AND result ? 'one_minute_heart_rate'
      AND result - 'maximum_watts' - 'peak_heart_rate' - 'one_minute_heart_rate' = '{}'::jsonb
      AND jsonb_typeof(result->'maximum_watts') = 'number'
      AND jsonb_typeof(result->'peak_heart_rate') = 'number'
      AND jsonb_typeof(result->'one_minute_heart_rate') = 'number'
      AND (result->>'maximum_watts')::numeric >= 0
      AND (result->>'peak_heart_rate')::numeric > 0
      AND (result->>'peak_heart_rate')::numeric = trunc((result->>'peak_heart_rate')::numeric)
      AND (result->>'one_minute_heart_rate')::numeric > 0
      AND (result->>'one_minute_heart_rate')::numeric = trunc((result->>'one_minute_heart_rate')::numeric);
  END IF;
  RETURN false;
END;
$$;

ALTER TABLE cardio_test_attempts DROP CONSTRAINT cardio_test_attempts_test_type_check;
ALTER TABLE cardio_test_attempts DROP CONSTRAINT cardio_test_attempts_results_check;
ALTER TABLE cardio_test_attempts ADD CONSTRAINT cardio_test_attempts_test_type_check
  CHECK (test_type IN ('cooper_run', 'sprint_6s', 'power_30s', 'ramp'));
ALTER TABLE cardio_test_attempts ADD CONSTRAINT cardio_test_attempts_results_check
  CHECK (cardio_test_results_valid(test_type, results));
