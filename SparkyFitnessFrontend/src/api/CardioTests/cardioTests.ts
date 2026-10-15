import { z } from 'zod';
import {
  cooperRunAttemptInputSchema,
  cooperRunAttemptSchema,
  type CooperRunAttemptInput,
  cardioTestAttemptInputSchema,
  cardioTestAttemptSchema,
  type CardioTestAttemptInput,
} from '@workspace/shared';
import { apiCall } from '@/api/api';

const path = '/cardio-tests/cooper-run/attempts';

export async function getCooperRunAttempts() {
  return z.array(cooperRunAttemptSchema).parse(await apiCall<unknown>(path));
}

export async function getProtocolAttempts(
  protocol: CardioTestAttemptInput['test_type']
) {
  return z
    .array(cardioTestAttemptSchema)
    .parse(await apiCall<unknown>(`/cardio-tests/${protocol}/attempts`));
}
export async function saveProtocolAttempt(
  input: CardioTestAttemptInput,
  id?: string
) {
  const validated = cardioTestAttemptInputSchema.parse(input);
  return cardioTestAttemptSchema.parse(
    await apiCall<unknown>(
      `/cardio-tests/${validated.test_type}/attempts${id ? `/${id}` : ''}`,
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(validated) }
    )
  );
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
