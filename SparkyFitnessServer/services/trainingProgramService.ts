import { z } from 'zod';
import { todayInZone } from '@workspace/shared';
import {
  trainingProgramInputSchema,
  trainingProgramOutcomeInputSchema,
} from '@workspace/shared';
import {
  getTrainingPrograms,
  saveTrainingProgram,
  deleteTrainingProgram,
  recordTrainingProgramOutcome,
} from '../models/trainingProgramRepository.js';
import { HttpError } from '../utils/errors.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

function describeFirstIssue(error: z.ZodError): string {
  const issue = error.issues[0]!;
  return `${issue.path.join('.')}: ${issue.message}`;
}

function programId(id: string): string {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new HttpError('Invalid Training Program ID.', 400);
  return parsed.data;
}

export async function listPrograms(userId: string) {
  return getTrainingPrograms(userId);
}
export async function getProgram(userId: string, id: string) {
  const program = (await getTrainingPrograms(userId, programId(id)))[0];
  if (!program) throw new HttpError('Training Program not found.', 404);
  return program;
}
export async function saveProgram(userId: string, body: unknown, id?: string) {
  const parsed = trainingProgramInputSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(describeFirstIssue(parsed.error), 400);
  const saved = await saveTrainingProgram(
    userId,
    parsed.data,
    id ? programId(id) : undefined
  );
  if (!saved) throw new HttpError('Training Program not found.', 404);
  return saved;
}
export async function removeProgram(userId: string, id: string) {
  if (!(await deleteTrainingProgram(userId, programId(id)))) {
    throw new HttpError('Training Program not found.', 404);
  }
}

export async function recordProgramOutcome(
  userId: string,
  id: string,
  sessionId: string,
  body: unknown
) {
  const parsed = trainingProgramOutcomeInputSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(
      `Provide a missed outcome or a completed outcome with a diary workout type and UUID. ${describeFirstIssue(parsed.error)}`,
      400
    );
  const session = z.uuid().safeParse(sessionId);
  if (!session.success) throw new HttpError('Invalid Planned Session ID.', 400);
  // "Today" is the athlete's calendar day in their own timezone.
  const today = todayInZone(await loadUserTimezone(userId));
  return recordTrainingProgramOutcome(
    userId,
    programId(id),
    session.data,
    parsed.data,
    today
  );
}
