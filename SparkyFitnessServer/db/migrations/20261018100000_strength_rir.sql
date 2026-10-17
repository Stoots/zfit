-- Cardio is excluded even if stale library metadata suggests a strength modality.
CREATE OR REPLACE FUNCTION public.is_strength_effort(modality text, category text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(coalesce(category, ''))) <> 'cardio'
    AND coalesce(modality, '') <> 'duration_distance'
    AND (modality IN ('weight_reps', 'bodyweight_reps', 'reps_only', 'weight_distance', 'weight_duration')
      OR lower(trim(coalesce(category, ''))) IN
        ('strength', 'powerlifting', 'olympic weightlifting', 'strongman', 'plyometrics', 'isometric', 'isometrics'));
$$;

-- One conversion rule for old data and all future legacy-client/import writes.
CREATE OR REPLACE FUNCTION public.strength_set_rir(rir numeric, rpe numeric, strength boolean)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN rir IS NULL AND rpe IS NOT NULL AND strength
    THEN greatest(0, least(10, 10 - rpe)) ELSE rir END;
$$;

CREATE OR REPLACE FUNCTION public.derive_strength_entry_rir()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE strength boolean;
BEGIN
  SELECT public.is_strength_effort(ee.modality, ee.category) INTO strength
    FROM public.exercise_entries ee WHERE ee.id = NEW.exercise_entry_id;
  NEW.rir := public.strength_set_rir(NEW.rir, NEW.rpe, strength);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS derive_strength_rir ON public.exercise_entry_sets;
CREATE TRIGGER derive_strength_rir BEFORE INSERT OR UPDATE OF rpe, rir
  ON public.exercise_entry_sets FOR EACH ROW EXECUTE FUNCTION public.derive_strength_entry_rir();

UPDATE public.exercise_entry_sets s
SET rir = public.strength_set_rir(s.rir, s.rpe, public.is_strength_effort(e.modality, e.category))
FROM public.exercise_entries e
WHERE e.id = s.exercise_entry_id AND s.rir IS NULL AND s.rpe IS NOT NULL
  AND public.is_strength_effort(e.modality, e.category);

-- Presets previously discarded effort fields; RIR must survive round trips.
ALTER TABLE public.workout_preset_exercise_sets ADD COLUMN IF NOT EXISTS rir numeric(3,1)
  CHECK (rir BETWEEN 0 AND 10);
COMMENT ON COLUMN public.workout_preset_exercise_sets.rir IS 'Prescribed reps in reserve, 0 = failure, 0..10.';

-- Walk frozen prescriptions/outcomes using each exercise's own snapshot metadata.
CREATE OR REPLACE FUNCTION public.strength_rir_json(value jsonb, strength boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb := value; item record; local_strength boolean := strength; converted numeric;
BEGIN
  IF jsonb_typeof(value) = 'array' THEN
    SELECT coalesce(jsonb_agg(public.strength_rir_json(element, strength) ORDER BY ordinal), '[]'::jsonb)
      INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS a(element, ordinal);
  ELSIF jsonb_typeof(value) = 'object' THEN
    IF value ? 'modality' OR value ? 'category' THEN
      local_strength := public.is_strength_effort(value->>'modality', value->>'category');
    END IF;
    IF jsonb_typeof(value->'rpe') = 'number' AND coalesce(value->'rir', 'null'::jsonb) = 'null'::jsonb THEN
      converted := public.strength_set_rir(NULL, (value->>'rpe')::numeric, local_strength);
      IF converted IS NOT NULL THEN result := jsonb_set(result, '{rir}', to_jsonb(converted)); END IF;
    END IF;
    FOR item IN SELECT key, val FROM jsonb_each(value) AS e(key, val) WHERE jsonb_typeof(val) IN ('array', 'object') LOOP
      result := jsonb_set(result, ARRAY[item.key], public.strength_rir_json(item.val, local_strength));
    END LOOP;
  END IF;
  RETURN result;
END;
$$;

UPDATE public.workout_plan_assignment_sets s
SET prescription = public.strength_rir_json(s.prescription, public.is_strength_effort(e.modality, e.category))
FROM public.workout_plan_template_assignments a JOIN public.exercises e ON e.id = a.exercise_id
WHERE s.assignment_id = a.id AND s.prescription ? 'rpe'
  AND s.prescription IS DISTINCT FROM public.strength_rir_json(s.prescription, public.is_strength_effort(e.modality, e.category));

UPDATE public.workout_plan_template_assignments SET preset_snapshot = public.strength_rir_json(preset_snapshot)
WHERE preset_snapshot IS NOT NULL
  AND preset_snapshot IS DISTINCT FROM public.strength_rir_json(preset_snapshot);
UPDATE public.training_program_sessions SET completed_workout = public.strength_rir_json(completed_workout)
WHERE completed_workout IS NOT NULL
  AND completed_workout IS DISTINCT FROM public.strength_rir_json(completed_workout);
