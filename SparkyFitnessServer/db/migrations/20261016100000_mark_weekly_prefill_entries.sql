ALTER TABLE public.exercise_entries
  ADD COLUMN is_weekly_prefill boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.exercise_entries.is_weekly_prefill IS
  'True only for untouched weekly Workout Plan prefill rows; legacy rows are conservatively protected.';

CREATE FUNCTION public.clear_weekly_prefill_on_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- An edit to a generated row makes it diary history, even without completed sets.
  NEW.is_weekly_prefill := false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_weekly_prefill_on_edit
BEFORE UPDATE ON public.exercise_entries
FOR EACH ROW WHEN (OLD.is_weekly_prefill)
EXECUTE FUNCTION public.clear_weekly_prefill_on_edit();
