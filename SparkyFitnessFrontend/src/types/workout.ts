import {
  ExerciseEntryResponse,
  ExerciseEntrySetRequest,
  ExerciseEntrySetResponse,
  ExerciseModality,
  PresetSessionResponse,
  WorkoutFormat,
  WorkoutPlanCreateRequest,
} from '@workspace/shared';
import { Exercise } from './exercises';

export type WorkoutPresetSet = ExerciseEntrySetRequest;
export interface PresetExercise {
  id: string;
  exercise_id: string;
  sets: number;
  reps: number;
  weight: number;
  image_url?: string;
  exercise_name: string;
}

export interface WorkoutPresetExercise {
  id?: string;
  exercise_id: string;
  image_url?: string;
  exercise_name: string; // Populated from backend join
  exercise?: Exercise; // Optional library metadata; frozen snapshots need not embed it.
  sets: WorkoutPresetSet[];
  category?: string;
  modality?: ExerciseModality | null; // Populated from backend join
  superset_group?: number | null;
  /** Within-session per-set ramp, kg. Null = off. */
  ramp_increment?: number | null;
  increment_value?: number | null;
  workout_plan_assignment_id?: string | number | null;
}

export interface WorkoutPreset {
  id: number | string;
  /** Present only when executing an exact, frozen plan session. */
  workout_session_id?: string;
  training_program?: { program_id: string; session_id: string };
  user_id: string;
  name: string;
  description?: string;
  is_public?: boolean;
  workout_format?: WorkoutFormat;
  time_cap_seconds?: number | null;
  created_at?: string;
  updated_at?: string;
  exercises: WorkoutPresetExercise[];
}

export interface PaginatedWorkoutPresets {
  presets: WorkoutPreset[];
  total: number;
  page: number;
  limit: number;
}

export interface WorkoutPlanAssignment {
  id?: string | number;
  workout_session_id?: string;
  preset_snapshot?: WorkoutPreset | null;
  sort_order?: number | null;
  workout_preset_id?: string | number | null;
  workout_preset_name?: string; // Populated from backend join
  exercise_id?: string;
  exercise_name?: string; // Populated from backend join
  sets: WorkoutPresetSet[];
  created_at?: string;
  updated_at?: string;
  category?: string;
  modality?: ExerciseModality | null; // Populated from backend join
}

export interface WorkoutPlanSession {
  id: string;
  name: string;
  day_of_week: number | null;
  is_optional: boolean;
  sort_order: number;
  assignments: WorkoutPlanAssignment[];
}

/** Editor write shape: new sessions have no persisted identity until saved. */
export type WorkoutPlanDraft = Omit<WorkoutPlanCreateRequest, 'sessions'> & {
  sessions: Array<Omit<WorkoutPlanSession, 'id'> & { id?: string }>;
};

export interface WorkoutPlanTemplate {
  id: string;
  user_id: string;
  plan_name: string;
  description?: string;
  start_date?: string;
  end_date?: string | null;
  is_active?: boolean;
  schedule_type?: 'weekly' | 'sequential';
  entry_mode?: 'prompt' | 'prefill';
  created_at?: string;
  updated_at?: string;
  sessions: WorkoutPlanSession[];
  next_session?: WorkoutPlanSession | null;
  next_assignments?: WorkoutPlanAssignment[];
  /** Dashboard attribution supplied when selecting an exact Program workout. */
  training_program_session_id?: string;
  sequence_position?: {
    current: number;
    total: number;
    session_name?: string | null;
  } | null;
}

// New interface for exercises coming from presets, where sets, reps, and weight are guaranteed
export interface ExerciseToLog extends Exercise {
  // Export the interface
  sets?: WorkoutPresetSet[];
  reps?: number;
  weight?: number;
  duration?: number; // Entry-level duration in minutes; per-set `duration` is seconds
  notes?: string;
  image_url?: string;
  exercise_name?: string; // Added to match PresetExercise
  distance?: number; // New field
  avg_heart_rate?: number; // New field
}

// The combined type for an exercise block
export type SortableExerciseItemData =
  WorkoutPresetExercise | WorkoutPlanAssignment | ExerciseEntryResponse;

// The combined type for a single set
export type SortableSetData =
  ExerciseEntrySetRequest | ExerciseEntrySetResponse;

// The combined type for presets list (used for labels)
export type PresetMetadata = WorkoutPreset | PresetSessionResponse;

export type SetFieldKey =
  keyof ExerciseEntrySetResponse | keyof ExerciseEntrySetRequest;
