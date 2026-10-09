import { z } from 'zod';
import {
  trainingProgramInputSchema,
  trainingProgramOutcomeInputSchema,
} from '@workspace/shared';
import {
  getTrainingPrograms,
  saveTrainingProgram,
  deleteTrainingProgram,
  TrainingProgramError,
  recordTrainingProgramOutcome,
} from '../models/trainingProgramRepository.js';

function programId(id: string): string {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success)
    throw new TrainingProgramError('Invalid Training Program ID.', 400);
  return parsed.data;
}

export async function listPrograms(userId: string) {
  return getTrainingPrograms(userId);
}
export async function getProgram(userId: string, id: string) {
  const program = (await getTrainingPrograms(userId, programId(id)))[0];
  if (!program)
    throw new TrainingProgramError('Training Program not found.', 404);
  return program;
}
export async function saveProgram(userId: string, body: unknown, id?: string) {
  const parsed = trainingProgramInputSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new TrainingProgramError(
      `${issue.path.join('.')}: ${issue.message}`,
      400
    );
  }
  const saved = await saveTrainingProgram(
    userId,
    parsed.data,
    id ? programId(id) : undefined
  );
  if (!saved)
    throw new TrainingProgramError('Training Program not found.', 404);
  return saved;
}
export async function removeProgram(userId: string, id: string) {
  if (!(await deleteTrainingProgram(userId, programId(id)))) {
    throw new TrainingProgramError('Training Program not found.', 404);
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
    throw new TrainingProgramError(
      'Provide a missed outcome or a completed outcome with a diary workout type and UUID.',
      400
    );
  const session = z.uuid().safeParse(sessionId);
  if (!session.success)
    throw new TrainingProgramError('Invalid Planned Session ID.', 400);
  return recordTrainingProgramOutcome(
    userId,
    programId(id),
    session.data,
    parsed.data
  );
}
