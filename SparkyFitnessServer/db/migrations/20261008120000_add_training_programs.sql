-- Training Programs are separate from independently usable Workout Plans.
CREATE UNIQUE INDEX workout_plan_templates_id_user_id_key ON workout_plan_templates (id, user_id);

CREATE TABLE training_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  goal text NOT NULL CHECK (length(btrim(goal)) > 0),
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date),
  schedule_type text NOT NULL DEFAULT 'fixed' CHECK (schedule_type = 'fixed'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE INDEX training_programs_user_id_idx ON training_programs(user_id);

CREATE TABLE training_program_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  goal text NOT NULL CHECK (length(btrim(goal)) > 0),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (program_id, user_id) REFERENCES training_programs(id, user_id) ON DELETE CASCADE,
  UNIQUE (id, program_id, user_id)
);
CREATE INDEX training_program_phases_program_idx ON training_program_phases(program_id, sort_order);

CREATE TABLE training_program_weeks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  user_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL CHECK (end_date >= start_date AND end_date - start_date <= 6),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (phase_id, program_id, user_id) REFERENCES training_program_phases(id, program_id, user_id) ON DELETE CASCADE,
  UNIQUE (id, program_id, user_id)
);
CREATE INDEX training_program_weeks_phase_idx ON training_program_weeks(phase_id, sort_order);

CREATE TABLE training_program_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL,
  week_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  scheduled_date date NOT NULL,
  workout_plan_id integer NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (week_id, program_id, user_id) REFERENCES training_program_weeks(id, program_id, user_id) ON DELETE CASCADE,
  CONSTRAINT training_program_sessions_workout_plan_fk FOREIGN KEY (workout_plan_id, user_id)
    REFERENCES workout_plan_templates(id, user_id) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (id, program_id, user_id)
);
CREATE INDEX training_program_sessions_week_idx ON training_program_sessions(week_id, sort_order);
CREATE INDEX training_program_sessions_plan_idx ON training_program_sessions(workout_plan_id);
CREATE INDEX training_program_sessions_calendar_idx ON training_program_sessions(user_id, scheduled_date);
