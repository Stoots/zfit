-- Atomic cutover. Rollback after commit requires restoring the pre-upgrade backup:
-- the removed grouping columns cannot represent independently prescribed sessions.
-- Preflight/mapping: see docs/src/developer/database.md, Workout Session cutover.
BEGIN;
DO $migration$
DECLARE
  mapping jsonb := COALESCE(NULLIF(current_setting('app.workout_session_upgrade_mapping', true), ''), '{}')::jsonb;
  unresolved jsonb;
BEGIN
  -- Migration tracking normally prevents re-entry; explicit replay is also safe.
  IF to_regclass('public.workout_plan_sessions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'workout_plan_template_assignments' AND column_name = 'session_index'
  ) THEN
    ALTER TABLE exercise_preset_entries ADD COLUMN IF NOT EXISTS time_cap_seconds integer
      CHECK (time_cap_seconds IS NULL OR time_cap_seconds >= 0);
    RETURN;
  END IF;
  IF jsonb_typeof(mapping) <> 'object' THEN
    RAISE EXCEPTION 'Workout Session upgrade mapping must be a JSON object of Planned Session UUID to legacy assignment ID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id
    WHERE p.schedule_type = 'weekly' AND a.day_of_week NOT BETWEEN 0 AND 6
  ) THEN
    RAISE EXCEPTION 'Workout Session preflight: weekly assignments with an invalid weekday require operator correction';
  END IF;

  -- An assignment ID is an unambiguous anchor into a legacy group; labels never
  -- define membership. Every ambiguous Program reference needs its own mapping.
  WITH groups AS (
    SELECT p.id AS template_id, CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week ELSE COALESCE(a.session_index, 1) END AS group_key
    FROM workout_plan_templates p LEFT JOIN workout_plan_template_assignments a ON a.template_id = p.id
    GROUP BY p.id, group_key
  ), counts AS (
    SELECT template_id, count(*) AS sessions FROM groups GROUP BY template_id
  )
  SELECT jsonb_agg(jsonb_build_object('planned_session_id', s.id, 'workout_plan_id', s.workout_plan_id, 'candidate_count', COALESCE(c.sessions, 0))) INTO unresolved
  FROM training_program_sessions s LEFT JOIN counts c ON c.template_id = s.workout_plan_id
  WHERE COALESCE(c.sessions, 0) <> 1 AND NOT EXISTS (
    SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id
    WHERE a.id::text = mapping->>s.id::text AND a.template_id = s.workout_plan_id AND p.user_id = s.user_id
  );
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Workout Session preflight requires explicit operator mapping: %', unresolved
      USING HINT = 'Set app.workout_session_upgrade_mapping to {"planned-session-uuid": legacy-assignment-id}. No first/current/label fallback is permitted.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM training_program_sessions s WHERE mapping ? s.id::text AND NOT EXISTS (
      SELECT 1 FROM workout_plan_template_assignments a JOIN workout_plan_templates p ON p.id = a.template_id
      WHERE a.id::text = mapping->>s.id::text AND a.template_id = s.workout_plan_id AND p.user_id = s.user_id
    )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(mapping) k WHERE NOT EXISTS (SELECT 1 FROM training_program_sessions s WHERE s.id::text = k)
  ) THEN
    RAISE EXCEPTION 'Workout Session preflight mapping contains an unknown Planned Session or an assignment from another plan/owner';
  END IF;

  -- Startup uses an administrative connection. Do not let that bypass copy a
  -- private provider's library data into another owner's frozen prescription.
  -- These predicates mirror the existing library owner/public/family boundary;
  -- a diary-only grant requires viewing the provider's profile, not this owner.
  IF EXISTS (
    SELECT 1 FROM workout_plan_template_assignments a
    JOIN workout_plan_templates p ON p.id = a.template_id
    JOIN workout_presets wp ON wp.id = a.workout_preset_id
    WHERE NOT COALESCE(wp.user_id = p.user_id OR wp.is_public OR EXISTS (
      SELECT 1 FROM family_access fa WHERE fa.owner_user_id = wp.user_id AND fa.family_user_id = p.user_id
        AND fa.is_active AND (fa.access_end_date IS NULL OR fa.access_end_date > now())
        AND (fa.access_permissions->>'can_view_reports' = 'true' OR fa.access_permissions->>'can_view_exercise_library' = 'true')
    ), false)
  ) OR EXISTS (
    SELECT 1 FROM workout_plan_template_assignments a
    JOIN workout_plan_templates p ON p.id = a.template_id
    LEFT JOIN workout_preset_exercises pe ON pe.workout_preset_id = a.workout_preset_id
    JOIN exercises e ON e.id = COALESCE(a.exercise_id, pe.exercise_id)
    WHERE NOT COALESCE(e.user_id = p.user_id OR e.shared_with_public OR EXISTS (
      SELECT 1 FROM family_access fa WHERE fa.owner_user_id = e.user_id AND fa.family_user_id = p.user_id
        AND fa.is_active AND (fa.access_end_date IS NULL OR fa.access_end_date > now())
        AND (fa.access_permissions->>'can_view_reports' = 'true' OR fa.access_permissions->>'can_view_exercise_library' = 'true')
    ), false)
  ) THEN
    RAISE EXCEPTION 'Workout Session preflight: a legacy assignment references a private preset or exercise not accessible to its plan owner';
  END IF;

  CREATE TABLE workout_plan_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id integer NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
    sort_order integer NOT NULL CHECK (sort_order >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (template_id, user_id) REFERENCES workout_plan_templates(id, user_id) ON DELETE CASCADE,
    UNIQUE (id, user_id),
    UNIQUE (id, template_id, user_id)
  );
  CREATE INDEX workout_plan_sessions_template_order_idx ON workout_plan_sessions(template_id, sort_order, id);
  ALTER TABLE workout_plan_sessions ENABLE ROW LEVEL SECURITY;
  CREATE TRIGGER update_workout_plan_sessions_timestamp BEFORE UPDATE ON workout_plan_sessions
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

  -- Empty plans have one empty session: their zero prescriptions remain zero,
  -- and existing Program references have exactly one unambiguous target.
  CREATE TEMP TABLE workout_session_upgrade_groups ON COMMIT DROP AS
    SELECT gen_random_uuid() AS id, p.id AS template_id, p.user_id,
      CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week ELSE COALESCE(a.session_index, 1) END AS group_key,
      CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week ELSE NULL END AS day_of_week,
      COALESCE((array_agg(NULLIF(btrim(a.session_name), '') ORDER BY a.sort_order NULLS LAST, a.id)
        FILTER (WHERE NULLIF(btrim(a.session_name), '') IS NOT NULL))[1],
        CASE WHEN p.schedule_type = 'weekly' THEN COALESCE((ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[a.day_of_week + 1], 'Unscheduled')
          ELSE 'Session ' || COALESCE(a.session_index, 1)::text END) AS name,
      COALESCE(min(a.created_at), max(p.created_at)) AS created_at,
      COALESCE(max(a.updated_at), max(p.updated_at)) AS updated_at
    FROM workout_plan_templates p LEFT JOIN workout_plan_template_assignments a ON a.template_id = p.id
    GROUP BY p.id, p.user_id, p.schedule_type,
      CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week ELSE COALESCE(a.session_index, 1) END,
      CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week ELSE NULL END,
      CASE WHEN p.schedule_type = 'weekly' THEN COALESCE((ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[a.day_of_week + 1], 'Unscheduled')
        ELSE 'Session ' || COALESCE(a.session_index, 1)::text END;
  INSERT INTO workout_plan_sessions(id, template_id, user_id, name, day_of_week, sort_order, created_at, updated_at)
    SELECT id, template_id, user_id, name, day_of_week,
      (row_number() OVER (PARTITION BY template_id ORDER BY group_key) - 1)::integer,
      COALESCE(created_at, now()), COALESCE(updated_at, now()) FROM workout_session_upgrade_groups;

  ALTER TABLE workout_plan_template_assignments ADD COLUMN workout_session_id uuid, ADD COLUMN user_id uuid, ADD COLUMN preset_snapshot jsonb;
  ALTER TABLE workout_plan_template_assignments DISABLE TRIGGER update_workout_plan_template_assignments_timestamp;
  UPDATE workout_plan_template_assignments a SET workout_session_id = g.id, user_id = g.user_id
    FROM workout_session_upgrade_groups g, workout_plan_templates p
    WHERE a.template_id = g.template_id AND p.id = a.template_id
      AND g.group_key IS NOT DISTINCT FROM CASE WHEN p.schedule_type = 'weekly' THEN a.day_of_week ELSE COALESCE(a.session_index, 1) END;
  -- Freeze the complete current prescription once. No diary/outcome snapshot is
  -- refreshed, and no assignment/set/Program identity or diary link is replaced.
  UPDATE workout_plan_template_assignments a SET preset_snapshot = (
    SELECT jsonb_build_object('id', wp.id, 'name', wp.name, 'description', wp.description,
      'workout_format', wp.workout_format, 'time_cap_seconds', wp.time_cap_seconds,
      'exercises', COALESCE((
        SELECT jsonb_agg((to_jsonb(wpe) - 'workout_preset_id' - 'created_at' - 'updated_at') ||
          jsonb_build_object('exercise_name', e.name, 'category', e.category, 'modality', e.modality,
            'primary_muscles', e.primary_muscles, 'secondary_muscles', e.secondary_muscles,
            'equipment', e.equipment, 'instructions', e.instructions, 'images', e.images,
            'sets', COALESCE((SELECT jsonb_agg(to_jsonb(ps) - 'workout_preset_exercise_id' - 'created_at' - 'updated_at' ORDER BY ps.set_number, ps.id)
              FROM workout_preset_exercise_sets ps WHERE ps.workout_preset_exercise_id = wpe.id), '[]'::jsonb))
          ORDER BY wpe.sort_order, wpe.id)
        FROM workout_preset_exercises wpe JOIN exercises e ON e.id = wpe.exercise_id WHERE wpe.workout_preset_id = wp.id
      ), '[]'::jsonb)) FROM workout_presets wp WHERE wp.id = a.workout_preset_id
  ) WHERE a.workout_preset_id IS NOT NULL;
  ALTER TABLE workout_plan_template_assignments ENABLE TRIGGER update_workout_plan_template_assignments_timestamp;
  ALTER TABLE workout_plan_template_assignments
    ALTER COLUMN workout_session_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL,
    ADD CONSTRAINT workout_plan_assignment_session_fk FOREIGN KEY (workout_session_id, template_id, user_id)
      REFERENCES workout_plan_sessions(id, template_id, user_id) ON DELETE CASCADE,
    DROP CONSTRAINT chk_workout_assignment_type,
    ADD CONSTRAINT chk_workout_assignment_type CHECK (
      (exercise_id IS NOT NULL AND workout_preset_id IS NULL AND preset_snapshot IS NULL)
      OR (exercise_id IS NULL AND preset_snapshot IS NOT NULL AND jsonb_typeof(preset_snapshot) = 'object'
        AND preset_snapshot ?& ARRAY['id','name','description','workout_format','exercises']
        AND jsonb_typeof(preset_snapshot->'exercises') = 'array'
        AND (workout_preset_id IS NULL OR preset_snapshot->>'id' = workout_preset_id::text))
    );
  CREATE INDEX workout_plan_assignments_session_idx ON workout_plan_template_assignments(workout_session_id, sort_order, id);
  ALTER TABLE workout_plan_assignment_sets ADD COLUMN distance numeric,
    ADD COLUMN prescription jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(prescription) = 'object');
  -- Existing diary timer history is not refreshed from today's library. New
  -- session execution supplies its frozen time cap explicitly, including null.
  ALTER TABLE exercise_preset_entries ADD COLUMN time_cap_seconds integer
    CHECK (time_cap_seconds IS NULL OR time_cap_seconds >= 0);
  -- Frozen preset assignments survive library deletion. Linked assignments may
  -- not be deleted implicitly: the diary relationship is part of their identity.
  ALTER TABLE workout_plan_template_assignments DROP CONSTRAINT workout_plan_template_assignments_workout_preset_id_fkey;
  ALTER TABLE workout_plan_template_assignments ADD CONSTRAINT workout_plan_template_assignments_workout_preset_id_fkey
    FOREIGN KEY (workout_preset_id) REFERENCES workout_presets(id) ON DELETE SET NULL;
  ALTER TABLE exercise_entries DROP CONSTRAINT exercise_entries_workout_plan_assignment_id_fkey;
  ALTER TABLE exercise_entries ADD CONSTRAINT exercise_entries_workout_plan_assignment_id_fkey
    FOREIGN KEY (workout_plan_assignment_id) REFERENCES workout_plan_template_assignments(id) ON DELETE RESTRICT;

  ALTER TABLE training_program_sessions ADD COLUMN workout_session_id uuid, ADD COLUMN workout_session_name_snapshot text;
  -- Legacy Program sessions have no timestamp-update trigger: change only the
  -- two new fields, leaving created_at/updated_at and all outcome data untouched.
  UPDATE training_program_sessions s SET workout_session_id = COALESCE(
    (SELECT a.workout_session_id FROM workout_plan_template_assignments a WHERE a.id::text = mapping->>s.id::text AND a.template_id = s.workout_plan_id),
    (SELECT g.id FROM workout_session_upgrade_groups g WHERE g.template_id = s.workout_plan_id
      AND (SELECT count(*) FROM workout_session_upgrade_groups all_g WHERE all_g.template_id = s.workout_plan_id) = 1)
  );
  UPDATE training_program_sessions s SET workout_session_name_snapshot = ws.name
    FROM workout_plan_sessions ws WHERE ws.id = s.workout_session_id AND s.status <> 'planned';
  -- The legacy plan FK is INITIALLY DEFERRED. Discharge its queued UPDATE
  -- checks before ALTER TABLE; PostgreSQL rejects DDL with pending trigger events.
  -- This validates, rather than suppresses, the old ownership/reference boundary.
  -- Only the soon-to-be-dropped legacy FK changes mode; the new FK stays deferred.
  SET CONSTRAINTS training_program_sessions_workout_plan_fk IMMEDIATE;
  ALTER TABLE training_program_sessions ALTER COLUMN workout_session_id SET NOT NULL,
    ADD CONSTRAINT training_program_sessions_workout_session_fk FOREIGN KEY (workout_session_id, user_id)
      REFERENCES workout_plan_sessions(id, user_id) DEFERRABLE INITIALLY DEFERRED,
    DROP CONSTRAINT training_program_sessions_workout_plan_fk,
    DROP COLUMN workout_plan_id;
  CREATE INDEX training_program_sessions_workout_session_idx ON training_program_sessions(workout_session_id);
  ALTER TABLE workout_plan_template_assignments DROP COLUMN day_of_week, DROP COLUMN session_index, DROP COLUMN session_name;
END;
$migration$;
COMMIT;
