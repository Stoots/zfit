import { z } from 'zod';
import {
  trainingProgramSchema,
  type TrainingProgramInput,
  type TrainingProgramOutcomeInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

export async function getTrainingPrograms() {
  return z
    .array(trainingProgramSchema)
    .parse(await apiCall<unknown>('/training-programs'));
}
export async function getTrainingProgram(id: string) {
  return trainingProgramSchema.parse(
    await apiCall<unknown>(`/training-programs/${id}`)
  );
}
export async function saveTrainingProgram(
  input: TrainingProgramInput,
  id?: string
) {
  return trainingProgramSchema.parse(
    await apiCall<unknown>(
      id ? `/training-programs/${id}` : '/training-programs',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(input),
      }
    )
  );
}
export async function deleteTrainingProgram(id: string): Promise<void> {
  await apiCall<unknown>(`/training-programs/${id}`, { method: 'DELETE' });
}

export async function recordTrainingProgramOutcome(
  id: string,
  sessionId: string,
  input: TrainingProgramOutcomeInput
) {
  return trainingProgramSchema.parse(
    await apiCall<unknown>(
      `/training-programs/${id}/sessions/${sessionId}/outcome`,
      { method: 'POST', body: JSON.stringify(input) }
    )
  );
}
