import { z } from 'zod';
import { trainingProgramSchema, type TrainingProgram } from '@workspace/shared';
import { apiFetch } from './apiClient';

export async function fetchTrainingPrograms(): Promise<TrainingProgram[]> {
  const response = await apiFetch<unknown>({
    endpoint: '/api/training-programs',
    serviceName: 'Training Programs API',
    operation: 'fetch training programs',
  });
  return z.array(trainingProgramSchema).parse(response);
}
