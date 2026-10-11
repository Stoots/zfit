import { log } from '../../config/logging.js';
import exerciseRepository from '../../models/exercise.js';
import { deriveExerciseModality } from '@workspace/shared';
import { formatProviderExerciseName } from '../../utils/exerciseName.js';

const GARMIN_CARDIO_CATEGORY_INDICATORS = [
  'running',
  'walking',
  'cycling',
  'biking',
  'hiking',
  'swimming',
  'rowing',
  'elliptical',
  'treadmill',
  'cardio',
];

// Muscle vocabulary matches the free-exercise-db dataset already used to populate
// `exercises.primary_muscles`/`secondary_muscles` for every other exercise source
// (see BodyMapFilter.tsx's svgClassToSchemaName for the same names: "abdominals",
// "lower back", "quadriceps", etc.) so Garmin-created exercises render on the body map
// and filter correctly alongside everything else, instead of needing their own scheme.
//
// Garmin Connect's exerciseSets[].category/subCategory enum (BENCH_PRESS, LAT_PULLDOWN,
// ...) has no muscle field of its own; this is a best-effort mapping from that category
// name to the muscles it primarily/secondarily works. Unmapped categories fall through
// to empty arrays (exercise created with no muscle data) rather than guessing.
const GARMIN_CATEGORY_TO_MUSCLES: Record<
  string,
  { primary: string[]; secondary: string[] }
> = {
  BENCH_PRESS: { primary: ['chest'], secondary: ['triceps', 'shoulders'] },
  CHEST_PRESS: { primary: ['chest'], secondary: ['triceps', 'shoulders'] },
  FLYE: { primary: ['chest'], secondary: ['shoulders'] },
  PUSH_UP: { primary: ['chest'], secondary: ['triceps', 'shoulders'] },
  DIP: { primary: ['chest', 'triceps'], secondary: ['shoulders'] },
  SHOULDER_PRESS: { primary: ['shoulders'], secondary: ['triceps'] },
  SHOULDER_STABILITY: { primary: ['shoulders'], secondary: [] },
  SHRUG: { primary: ['traps'], secondary: ['shoulders'] },
  LATERAL_RAISE: { primary: ['shoulders'], secondary: [] },
  LAT_PULLDOWN: { primary: ['lats'], secondary: ['biceps'] },
  PULL_UP: { primary: ['lats'], secondary: ['biceps', 'shoulders'] },
  ROW: { primary: ['middle back', 'lats'], secondary: ['biceps'] },
  HYPEREXTENSION: {
    primary: ['lower back'],
    secondary: ['glutes', 'hamstrings'],
  },
  CURL: { primary: ['biceps'], secondary: ['forearms'] },
  TRICEPS_EXTENSION: { primary: ['triceps'], secondary: [] },
  CORE: { primary: ['abdominals'], secondary: [] },
  CRUNCH: { primary: ['abdominals'], secondary: [] },
  SIT_UP: { primary: ['abdominals'], secondary: ['hip flexors'] },
  PLANK: { primary: ['abdominals'], secondary: ['shoulders'] },
  LEG_RAISE: { primary: ['abdominals'], secondary: ['hip flexors'] },
  CHOP: { primary: ['abdominals'], secondary: ['shoulders'] },
  SQUAT: { primary: ['quadriceps'], secondary: ['glutes', 'hamstrings'] },
  LEG_PRESS: { primary: ['quadriceps'], secondary: ['glutes', 'hamstrings'] },
  LEG_CURL: { primary: ['hamstrings'], secondary: [] },
  LEG_EXTENSION: { primary: ['quadriceps'], secondary: [] },
  LUNGE: { primary: ['quadriceps'], secondary: ['glutes', 'hamstrings'] },
  DEADLIFT: {
    primary: ['lower back', 'hamstrings'],
    secondary: ['glutes', 'traps'],
  },
  HIP_RAISE: { primary: ['glutes'], secondary: ['hamstrings'] },
  HIP_SWING: { primary: ['glutes'], secondary: ['hamstrings'] },
  HIP_STABILITY: { primary: ['glutes'], secondary: ['abductors'] },
  CALF_RAISE: { primary: ['calves'], secondary: [] },
  OLYMPIC_LIFT: {
    primary: ['quadriceps', 'shoulders'],
    secondary: ['glutes', 'traps'],
  },
  PLYO: { primary: ['quadriceps'], secondary: ['calves', 'glutes'] },
  TOTAL_BODY: {
    primary: ['abdominals'],
    secondary: ['shoulders', 'quadriceps'],
  },
  WARM_UP: { primary: [], secondary: [] },
  RUN: { primary: ['quadriceps', 'hamstrings'], secondary: ['calves'] },
  BIKE: { primary: ['quadriceps'], secondary: ['calves', 'hamstrings'] },
};

/**
 * Best-effort mapping from a Garmin exercise category (e.g. "BENCH_PRESS") to the
 * primary/secondary muscle vocabulary used throughout the app. Returns empty arrays for
 * unrecognized categories rather than guessing from the exercise name.
 */
export function mapGarminCategoryToMuscles(rawCategory: unknown): {
  primary: string[];
  secondary: string[];
} {
  if (typeof rawCategory !== 'string' || rawCategory.trim().length === 0) {
    return { primary: [], secondary: [] };
  }
  const normalized = rawCategory
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (
    GARMIN_CATEGORY_TO_MUSCLES[normalized] || { primary: [], secondary: [] }
  );
}

/**
 * Maps Garmin categories to user-defined categories.
 * Supported categories: general, strength, cardio, yoga, powerlifting, olympic weightlifting, strongman, plyometrics, stretching, isometrics.
 */
export function mapGarminExerciseCategory(rawCategory: unknown): string {
  if (typeof rawCategory !== 'string' || rawCategory.trim().length === 0) {
    return 'general';
  }

  const normalized = rawCategory.trim().toLowerCase();

  // Yoga
  if (normalized.includes('yoga')) {
    return 'yoga';
  }

  // Stretching
  if (normalized.includes('stretching') || normalized.includes('flexibility')) {
    return 'stretching';
  }

  // Plyometrics
  if (normalized.includes('plyometrics')) {
    return 'plyometrics';
  }

  // Cardio indicators
  if (
    GARMIN_CARDIO_CATEGORY_INDICATORS.some((indicator) =>
      normalized.includes(indicator)
    )
  ) {
    return 'cardio';
  }

  // Olympic
  if (
    normalized.includes('olympic') ||
    normalized.includes('weightlifting') ||
    normalized.includes('weight_lifting')
  ) {
    if (normalized.includes('olympic')) return 'olympic weightlifting';
  }

  // Strength
  if (
    normalized.includes('strength_training') ||
    normalized.includes('strength') ||
    normalized.includes('weight_lifting') ||
    normalized.includes('weightlifting')
  ) {
    return 'strength';
  }

  // Powerlifting
  if (normalized.includes('powerlifting')) {
    return 'powerlifting';
  }

  // Strongman
  if (normalized.includes('strongman')) {
    return 'strongman';
  }

  // Isometrics
  if (normalized.includes('isometric')) {
    return 'isometrics';
  }

  // If the category itself looks like an exercise (e.g. LEG_CURL), it's likely strength
  if (normalized.includes('_')) {
    return 'strength';
  }

  return 'general';
}

/** Formats provider exercise labels using readable casing and known acronyms. */
export function formatExerciseName(name: string): string {
  return formatProviderExerciseName(name);
}

/** Reuse provider matches without renaming their library or historical labels. */
export async function getOrCreateGarminExercise(
  userId: string,
  rawName: string,
  rawCategory: unknown,
  source = 'garmin'
) {
  const formattedName = formatExerciseName(rawName);
  const mappedCategory = mapGarminExerciseCategory(rawCategory);
  const { primary: primaryMuscles, secondary: secondaryMuscles } =
    mapGarminCategoryToMuscles(rawCategory);

  // Preserve title-case then uppercase lookup precedence when aliases coexist.
  // Rename only an owned uppercase legacy alias to its readable display name.
  const legacyName = formattedName
    .toLowerCase()
    .split(' ')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  let exercise = await exerciseRepository.findExerciseByNameAndUserId(
    legacyName,
    userId
  );

  if (!exercise) {
    const uppercaseName = formattedName.toUpperCase();
    if (uppercaseName !== formattedName) {
      exercise = await exerciseRepository.findExerciseByNameAndUserId(
        uppercaseName,
        userId
      );
      if (exercise?.user_id === userId && exercise.name === uppercaseName) {
        await exerciseRepository.updateExercise(exercise.id, userId, {
          name: formattedName,
        });
        exercise.name = formattedName;
      }
    }
  }
  if (!exercise && formattedName !== legacyName) {
    exercise = await exerciseRepository.findExerciseByNameAndUserId(
      formattedName,
      userId
    );
  }

  if (exercise) {
    // If found and it's a user's exercise, ensure category is updated if it was previously general/uncategorized
    if (exercise.user_id === userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updates: Record<string, any> = {};
      if (
        (exercise.category === 'general' ||
          exercise.category === 'Uncategorized') &&
        mappedCategory !== 'general'
      ) {
        updates.category = mappedCategory;
        updates.modality = deriveExerciseModality(mappedCategory);
      }
      // Backfill muscles for a previously-created Garmin exercise that has none, so
      // the body map and muscle-group reports work for entries synced before this
      // mapping existed, without touching exercises the user has since edited.
      const hasNoMuscles =
        !exercise.primary_muscles ||
        exercise.primary_muscles === '[]' ||
        exercise.primary_muscles === 'null';
      if (hasNoMuscles && primaryMuscles.length > 0) {
        updates.primary_muscles = primaryMuscles;
        updates.secondary_muscles = secondaryMuscles;
      }
      if (Object.keys(updates).length > 0) {
        await exerciseRepository.updateExercise(exercise.id, userId, updates);
        Object.assign(exercise, updates);
      }
    }
    return exercise;
  }

  // Not found: persist the provider's casing, not the legacy lookup spelling.
  log(
    'info',
    `[garminExerciseMapper] Creating new Garmin exercise: "${formattedName}" (Category: ${mappedCategory})`
  );
  return await exerciseRepository.createExercise({
    user_id: userId,
    name: formattedName,
    category: mappedCategory,
    source: source,
    is_custom: true,
    shared_with_public: false,
    force: null,
    level: null,
    mechanic: null,
    equipment: null,
    primary_muscles: primaryMuscles.length > 0 ? primaryMuscles : null,
    secondary_muscles: secondaryMuscles.length > 0 ? secondaryMuscles : null,
    instructions: null,
    images: null,
  });
}
