import { buildBulkSourcePrescription } from '@/hooks/Exercises/useWorkoutPlanBulk';
import type { WorkoutPlanDraft } from '@/types/workout';

it.each(['individual', 'preset'])(
  'materializes legacy strength RIR in a %s bulk source without converting cardio or explicit clears',
  (kind) => {
    const sets = [
      { set_number: 1, rpe: 8 },
      { set_number: 2, rpe: 8, rir: null },
      { set_number: 3, rpe: 8, rir: 0 },
    ];
    const session = {
      assignments: [
        {
          id: '1',
          sort_order: 0,
          exercise_id:
            kind === 'individual'
              ? '00000000-0000-4000-8000-000000000001'
              : undefined,
          modality: 'weight_reps',
          sets: kind === 'individual' ? sets : [],
          preset_snapshot:
            kind === 'preset'
              ? {
                  id: 1,
                  name: 'Mixed',
                  exercises: ['weight_reps', 'duration_distance'].map(
                    (modality) => ({
                      exercise_id: '00000000-0000-4000-8000-000000000001',
                      exercise_name: modality,
                      modality,
                      sets,
                    })
                  ),
                }
              : undefined,
        },
      ],
    } as unknown as WorkoutPlanDraft['sessions'][number];
    const result = buildBulkSourcePrescription(session, 1);
    const strength = result.preset_snapshot?.exercises[0]?.sets ?? result.sets!;
    expect(strength.map((set) => set.rir)).toEqual([2, null, 0]);
    if (result.preset_snapshot)
      expect(result.preset_snapshot.exercises[1]?.sets[0]?.rir).toBeUndefined();
  }
);
