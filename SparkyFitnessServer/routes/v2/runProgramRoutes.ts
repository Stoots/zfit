import express from 'express';
import {
  completeRunProgramWorkoutBodySchema,
  rateRunProgramWorkoutBodySchema,
  upsertRunProgramBodySchema,
} from '@workspace/shared';
import requireSelfActor from '../../middleware/requireSelfMiddleware.js';
import {
  completeRunProgramWorkout,
  getRunProgram,
  InvalidRunProgramScheduleError,
  rateRunProgramWorkout,
  UnknownRunProgramError,
  upsertRunProgram,
} from '../../models/runProgramRepository.js';

/**
 * A person's run program and their place in it. Owner-only: a training plan is
 * personal, so a delegated context is refused outright. The program itself is
 * seeded from the built-in definitions in `@workspace/shared`; the stored copy
 * is what the person (and the AI assistant) can adjust.
 */
const router = express.Router();

router.use(requireSelfActor);

/**
 * @swagger
 * /v2/run-program:
 *   get:
 *     summary: Get the run program
 *     description: Returns the person's run program and place in it, or null.
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The program, or `{ program: null }`.
 *   put:
 *     summary: Start, switch on or off, or move within the run program
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The updated program.
 *       400:
 *         description: Invalid body or unknown program.
 */
router.get('/', async (req, res, next) => {
  try {
    const program = await getRunProgram(req.userId, req.authenticatedUserId);
    res.json({ program });
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const parsed = upsertRunProgramBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    const program = await upsertRunProgram(
      req.userId,
      parsed.data,
      req.authenticatedUserId
    );
    res.json({ program });
  } catch (error) {
    if (error instanceof UnknownRunProgramError) {
      return res.status(400).json({ error: 'Unknown run program' });
    }
    if (error instanceof InvalidRunProgramScheduleError) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * @swagger
 * /v2/run-program/complete:
 *   post:
 *     summary: Mark a run program workout done
 *     description: Moves on only if `index` is the workout that was due, so a repeated request changes nothing. An optional `entry_id` records which diary entry the workout was done as.
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The program, unchanged if `index` was not the due workout.
 */
router.post('/complete', async (req, res, next) => {
  try {
    const parsed = completeRunProgramWorkoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    await completeRunProgramWorkout(
      req.userId,
      parsed.data.index,
      req.authenticatedUserId,
      {
        programId: parsed.data.program_id,
        day: parsed.data.day,
        entryId: parsed.data.entry_id,
      }
    );
    const program = await getRunProgram(req.userId, req.authenticatedUserId);
    res.json({ program });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /v2/run-program/effort:
 *   post:
 *     summary: Rate how hard a finished run program workout felt
 *     description: Records a 1 to 10 rating for a workout that is already done, replacing an earlier rating of the same workout. A workout not yet done, or from another program, changes nothing.
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The program, unchanged if the workout could not be rated.
 */
router.post('/effort', async (req, res, next) => {
  try {
    const parsed = rateRunProgramWorkoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    await rateRunProgramWorkout(
      req.userId,
      parsed.data.index,
      parsed.data.rating,
      req.authenticatedUserId,
      parsed.data.program_id
    );
    const program = await getRunProgram(req.userId, req.authenticatedUserId);
    res.json({ program });
  } catch (error) {
    next(error);
  }
});

export default router;
