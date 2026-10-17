-- Migration: One sleep entry per night and source, one custom category per name
-- File: SparkyFitnessServer/db/migrations/20261006180000_unique_sleep_entries_and_custom_categories.sql
--
-- Sleep entries:
--
-- Two overlapping syncs could each find no entry for a night and both insert
-- one. Keep the most recently updated entry of each night and source (each
-- sync writes the whole night, and a later manual edit also counts as newest),
-- delete the rest with their stages, then enforce one entry per night and
-- source so upsertSleepEntry can rely on ON CONFLICT.
--
-- Custom categories:
--
-- Integrations look a category up by name and create it when it is missing,
-- so two overlapping syncs could each create one. Categories could also be
-- given the same name by hand, sometimes with a different unit, data type or
-- frequency.
--
-- Same-name categories with the same definition are merged into the oldest of
-- them, one at a time: a missing display name is filled in and the duplicate's
-- measurements move onto the oldest. A duplicate is not merged, and keeps its
-- own measurements, when that would put two readings in one Daily or Hourly
-- slot (same day, hour for Hourly, and source), so no reading is deleted or
-- stacked. Merging a different definition would reinterpret its measurements
-- (32 inches shown as 32 cm), so those are never merged either. Every category
-- left sharing a name is renamed "<name> (2)", "<name> (3)" and so on, and one
-- category per user and name is then enforced.

BEGIN;

-- Sleep entries

-- Stop new entries for a night arriving between the cleanup and the index.
LOCK TABLE public.sleep_entries IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM public.sleep_entries s
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, entry_date, source
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS position
  FROM public.sleep_entries
) ranked
WHERE s.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS sleep_entries_user_date_source_key
  ON public.sleep_entries (user_id, entry_date, source);

-- Custom categories

-- Stop categories and measurements changing between the merge and the index.
LOCK TABLE public.custom_categories, public.custom_measurements
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMPORARY TABLE custom_category_merge ON COMMIT DROP AS
SELECT c.id,
       c.user_id,
       c.name,
       c.display_name,
       c.created_at,
       FIRST_VALUE(c.id) OVER definition AS keep_id
FROM public.custom_categories c
WINDOW definition AS (
  PARTITION BY c.user_id, c.name, c.measurement_type,
               COALESCE(c.data_type, 'numeric'), c.frequency
  ORDER BY c.created_at, c.id
);

DO $$
DECLARE
  duplicate RECORD;
BEGIN
  FOR duplicate IN
    SELECT c.id, c.display_name, c.frequency, merge.keep_id
    FROM custom_category_merge merge
    JOIN public.custom_categories c ON c.id = merge.id
    WHERE merge.id <> merge.keep_id
    ORDER BY merge.keep_id, c.created_at, c.id
  LOOP
    IF duplicate.frequency IN ('Daily', 'Hourly') AND EXISTS (
      SELECT 1
      FROM public.custom_measurements theirs
      JOIN public.custom_measurements ours
        ON ours.entry_date = theirs.entry_date
       AND ours.source = theirs.source
       AND (duplicate.frequency = 'Daily'
            OR ours.entry_hour IS NOT DISTINCT FROM theirs.entry_hour)
      WHERE theirs.category_id = duplicate.id
        AND ours.category_id = duplicate.keep_id
    ) THEN
      -- Kept as its own category; renamed below.
      UPDATE custom_category_merge SET keep_id = id WHERE id = duplicate.id;
    ELSE
      UPDATE public.custom_categories
      SET display_name = duplicate.display_name
      WHERE id = duplicate.keep_id
        AND display_name IS NULL;
      UPDATE public.custom_measurements
      SET category_id = duplicate.keep_id
      WHERE category_id = duplicate.id;
      DELETE FROM public.custom_categories WHERE id = duplicate.id;
    END IF;
  END LOOP;
END $$;

-- The oldest remaining category keeps the name; rename the others.
DO $$
DECLARE
  survivor RECORD;
  suffix_number INTEGER;
  candidate TEXT;
BEGIN
  FOR survivor IN
    SELECT id, user_id, name, position
    FROM (
      SELECT id, user_id, name,
             ROW_NUMBER() OVER (
               PARTITION BY user_id, name ORDER BY created_at, id
             ) AS position
      FROM custom_category_merge
      WHERE id = keep_id
    ) ranked
    WHERE position > 1
    ORDER BY user_id, name, position
  LOOP
    suffix_number := survivor.position;
    LOOP
      -- custom_categories.name is VARCHAR(50), so shorten the base to fit.
      candidate := LEFT(survivor.name, 50 - LENGTH(' (' || suffix_number || ')'))
                   || ' (' || suffix_number || ')';
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.custom_categories
        WHERE user_id = survivor.user_id AND name = candidate
      );
      suffix_number := suffix_number + 1;
    END LOOP;
    UPDATE public.custom_categories SET name = candidate WHERE id = survivor.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS custom_categories_user_name_key
  ON public.custom_categories (user_id, name);

COMMIT;
