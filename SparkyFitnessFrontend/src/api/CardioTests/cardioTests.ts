import { z } from 'zod';
import {
  cooperRunAttemptInputSchema,
  cooperRunAttemptSchema,
  type CooperRunAttemptInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

const path = '/cardio-tests/cooper-run/attempts';

export async function getCooperRunAttempts() {
  return z.array(cooperRunAttemptSchema).parse(await apiCall<unknown>(path));
}

export async function createCooperRunAttempt(input: CooperRunAttemptInput) {
  const validated = cooperRunAttemptInputSchema.parse(input);
  return cooperRunAttemptSchema.parse(
    await apiCall<unknown>(path, {
      method: 'POST',
      body: JSON.stringify(validated),
    })
  );
}

export async function updateCooperRunAttempt(
  id: string,
  input: CooperRunAttemptInput
) {
  const validated = cooperRunAttemptInputSchema.parse(input);
  return cooperRunAttemptSchema.parse(
    await apiCall<unknown>(`${path}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(validated),
    })
  );
}
