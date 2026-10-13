import { z } from 'zod';
import {
  trainingProgramSchema,
  type TrainingProgram,
  type TrainingProgramOutcomeInput,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

export async function fetchTrainingPrograms(): Promise<TrainingProgram[]> {
  const response = await apiFetch<unknown>({
    endpoint: '/api/training-programs',
    serviceName: 'Training Programs API',
    operation: 'fetch training programs',
  });
  return z.array(trainingProgramSchema).parse(response);
}

export async function recordTrainingProgramOutcome(
  programId: string,
  sessionId: string,
  input: TrainingProgramOutcomeInput
): Promise<TrainingProgram> {
  const response = await apiFetch<unknown>({
    endpoint: `/api/training-programs/${encodeURIComponent(programId)}/sessions/${encodeURIComponent(sessionId)}/outcome`,
    serviceName: 'Training Programs API',
    operation: 'record planned session outcome',
    method: 'POST',
    body: input,
  });
  return trainingProgramSchema.parse(response);
}
