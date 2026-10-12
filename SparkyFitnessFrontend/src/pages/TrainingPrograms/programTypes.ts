import type { TrainingProgram } from '@workspace/shared';

export type ProgramSession =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
export type OutcomeStatus = 'missed' | 'completed';
