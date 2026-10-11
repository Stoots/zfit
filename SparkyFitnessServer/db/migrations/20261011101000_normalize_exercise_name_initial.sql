-- Label-only correction: never refresh history from the current library name.
-- The same invoker-rights rule guards every repository, import, provider and AI
-- write, including snapshots without a surviving library exercise. RLS and all
-- non-name fields (including audit timestamps) remain unchanged.
-- Rollback requires a pre-upgrade backup: uppercasing is not reversible.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_exercise_name_initial(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
    SELECT upper(left(value, 1)) || substring(value FROM 2);
$function$;

CREATE OR REPLACE FUNCTION public.normalize_exercise_library_name()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.name := public.normalize_exercise_name_initial(NEW.name);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_exercise_snapshot_name()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.exercise_name := public.normalize_exercise_name_initial(NEW.exercise_name);
    RETURN NEW;
END;
$function$;

-- Replacing only our own triggers makes an explicit repeat run safe.
DROP TRIGGER IF EXISTS normalize_exercise_library_name ON public.exercises;
CREATE TRIGGER normalize_exercise_library_name
BEFORE INSERT OR UPDATE OF name ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.normalize_exercise_library_name();

DROP TRIGGER IF EXISTS normalize_exercise_snapshot_name ON public.exercise_entries;
CREATE TRIGGER normalize_exercise_snapshot_name
BEFORE INSERT OR UPDATE OF exercise_name ON public.exercise_entries
FOR EACH ROW EXECUTE FUNCTION public.normalize_exercise_snapshot_name();

UPDATE public.exercises
SET name = public.normalize_exercise_name_initial(name)
WHERE name IS DISTINCT FROM public.normalize_exercise_name_initial(name);

UPDATE public.exercise_entries
SET exercise_name = public.normalize_exercise_name_initial(exercise_name)
WHERE exercise_name IS DISTINCT FROM public.normalize_exercise_name_initial(exercise_name);
UPDATE public.training_program_sessions
SET completed_workout = jsonb_set(
    completed_workout,
    '{name}',
    to_jsonb(public.normalize_exercise_name_initial(completed_workout->>'name')),
    false
)
WHERE status = 'completed'
  AND completed_workout->>'type' = 'individual'
  AND completed_workout->>'name' IS DISTINCT FROM
      public.normalize_exercise_name_initial(completed_workout->>'name');

COMMIT;
