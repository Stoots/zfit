import { z } from 'zod';
import {
  cooperRunAttemptInputSchema,
  cooperRunAttemptSchema,
  type CooperRunAttemptInput,
  cardioTestAttemptInputSchema,
  cardioTestAttemptSchema,
  type CardioTestAttemptInput,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

const endpoint = '/api/cardio-tests/cooper-run/attempts';
const serviceName = 'Cardio Tests API';

export async function fetchCooperRunAttempts() {
  const response = await apiFetch<unknown>({
    endpoint,
    serviceName,
    operation: 'fetch Cooper run Test Attempts',
  });
  return z.array(cooperRunAttemptSchema).parse(response);
}

export async function fetchProtocolAttempts(
  protocol: CardioTestAttemptInput['test_type']
) {
  const response = await apiFetch<unknown>({
    endpoint: `/api/cardio-tests/${protocol}/attempts`,
    serviceName,
    operation: 'fetch Test Attempts',
  });
  return z.array(cardioTestAttemptSchema).parse(response);
}
export async function saveProtocolAttempt(
  input: CardioTestAttemptInput,
  id?: string
) {
  const validated = cardioTestAttemptInputSchema.parse(input);
  const response = await apiFetch<unknown>({
    endpoint: `/api/cardio-tests/${validated.test_type}/attempts${id ? `/${id}` : ''}`,
    method: id ? 'PUT' : 'POST',
    body: validated,
    serviceName,
    operation: 'save Test Attempt',
  });
  return cardioTestAttemptSchema.parse(response);
}

export async function createCooperRunAttempt(input: CooperRunAttemptInput) {
  const validated = cooperRunAttemptInputSchema.parse(input);
  const response = await apiFetch<unknown>({
    endpoint,
    method: 'POST',
    body: validated,
    serviceName,
    operation: 'record Cooper run Test Attempt',
  });
  return cooperRunAttemptSchema.parse(response);
}

export async function updateCooperRunAttempt(
  id: string,
  input: CooperRunAttemptInput
) {
  const validated = cooperRunAttemptInputSchema.parse(input);
  const response = await apiFetch<unknown>({
    endpoint: `${endpoint}/${id}`,
    method: 'PUT',
    body: validated,
    serviceName,
    operation: 'edit Cooper run Test Attempt',
  });
  return cooperRunAttemptSchema.parse(response);
}
