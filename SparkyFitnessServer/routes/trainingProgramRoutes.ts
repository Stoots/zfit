import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import onBehalfOfMiddleware from '../middleware/onBehalfOfMiddleware.js';
import { requireSelfActor } from '../middleware/requireSelfMiddleware.js';
import {
  getProgram,
  listPrograms,
  saveProgram,
  removeProgram,
  recordProgramOutcome,
} from '../services/trainingProgramService.js';

const router = express.Router();
router.use(authenticate, onBehalfOfMiddleware, requireSelfActor);

/**
 * @swagger
 * tags:
 *   - name: Training Programs
 *     description: Owner-only multi-week Training Programs, distinct from Workout Plans.
 * components:
 *   schemas:
 *     PlannedSessionInput:
 *       type: object
 *       additionalProperties: false
 *       required: [name, scheduled_date, workout_plan_id]
 *       properties:
 *         id: { type: string, format: uuid, description: Existing session ID on edits only. }
 *         name: { type: string, maxLength: 200 }
 *         scheduled_date: { type: string, format: date, description: Fixed calendar date within the week. }
 *         workout_plan_id: { type: integer, minimum: 1, description: An existing Workout Plan owned by the caller. }
 *     PlannedSession:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string }
 *         sort_order: { type: integer }
 *         scheduled_date: { type: string, format: date, description: Authored date within its week. }
 *         effective_date: { type: string, format: date, description: Resulting schedule date; may extend beyond the authored week or Program. }
 *         workout_plan_id: { type: integer }
 *         workout_plan_name: { type: string, description: Snapshotted for recorded outcomes. }
 *         status: { type: string, enum: [planned, completed, missed] }
 *         outcome_at: { type: string, format: date-time, nullable: true }
 *         completed_workout:
 *           type: object
 *           nullable: true
 *           description: Immutable completion snapshot, retained after diary deletion.
 *           properties:
 *             type: { type: string, enum: [preset, individual] }
 *             id: { type: string, format: uuid }
 *             name: { type: string }
 *             entry_date: { type: string, format: date }
 *     ProgramWeekInput:
 *       type: object
 *       additionalProperties: false
 *       required: [start_date, end_date, sessions]
 *       properties:
 *         id: { type: string, format: uuid }
 *         start_date: { type: string, format: date }
 *         end_date: { type: string, format: date, description: Inclusive; a week spans at most seven days. }
 *         sessions:
 *           type: array
 *           items: { $ref: '#/components/schemas/PlannedSessionInput' }
 *     ProgramPhaseInput:
 *       type: object
 *       additionalProperties: false
 *       required: [name, goal, weeks]
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string, maxLength: 200 }
 *         goal: { type: string, maxLength: 2000 }
 *         weeks:
 *           type: array
 *           items: { $ref: '#/components/schemas/ProgramWeekInput' }
 *     TrainingProgramInput:
 *       type: object
 *       additionalProperties: false
 *       required: [name, goal, start_date, end_date, phases]
 *       properties:
 *         name: { type: string, maxLength: 200 }
 *         goal: { type: string, maxLength: 2000 }
 *         start_date: { type: string, format: date }
 *         end_date: { type: string, format: date }
 *         schedule_type: { type: string, enum: [fixed], default: fixed }
 *         auto_shift:
 *           type: boolean
 *           default: false
 *           description: Each new miss advances still-planned sessions on strictly later effective dates by one calendar day. Same-day and recorded sessions never move. Toggles are not retroactive.
 *         phases:
 *           type: array
 *           description: Array order defines phase, week and session order. Weeks must be chronological and nonoverlapping.
 *           items: { $ref: '#/components/schemas/ProgramPhaseInput' }
 *     TrainingProgram:
 *       type: object
 *       description: The input structure plus id, user_id, created_at, updated_at and schedule_end_date (the later of authored end_date and every effective date). Every child has a stable UUID and zero-based sort_order. Authored dates stay contained; effective dates may extend beyond their original week and Program.
 *       properties:
 *         id: { type: string, format: uuid }
 *         user_id: { type: string, format: uuid }
 *         name: { type: string }
 *         goal: { type: string }
 *         start_date: { type: string, format: date }
 *         end_date: { type: string, format: date }
 *         schedule_type: { type: string, enum: [fixed] }
 *         auto_shift: { type: boolean, default: false }
 *         schedule_end_date: { type: string, format: date }
 *         created_at: { type: string, format: date-time }
 *         updated_at: { type: string, format: date-time }
 *         phases:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: { type: string, format: uuid }
 *               name: { type: string }
 *               goal: { type: string }
 *               sort_order: { type: integer }
 *               weeks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     sort_order: { type: integer }
 *                     start_date: { type: string, format: date }
 *                     end_date: { type: string, format: date }
 *                     sessions:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/PlannedSession' }
 * /training-programs:
 *   get:
 *     summary: List your Training Programs with their full structure
 *     tags: [Training Programs]
 *     responses:
 *       200:
 *         description: Programs owned by the authenticated caller.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/TrainingProgram' }
 *       401: { description: Authentication required. }
 *       403: { description: Acting on behalf of another user is forbidden. }
 *   post:
 *     summary: Create a Training Program with fixed-date Planned Sessions
 *     tags: [Training Programs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/TrainingProgramInput' }
 *     responses:
 *       201:
 *         description: Persisted Program.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TrainingProgram' }
 *       400: { description: Invalid structure, dates or Workout Plan ownership. }
 *       401: { description: Authentication required. }
 *       403: { description: Owner-only. }
 * /training-programs/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string, format: uuid }
 *   get:
 *     summary: View your Training Program
 *     tags: [Training Programs]
 *     responses:
 *       200:
 *         description: Persisted Program with authored dates, resulting schedule and recorded history.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TrainingProgram' }
 *       401: { description: Authentication required. }
 *       403: { description: Owner-only. }
 *       404: { description: Not found or not owned by the caller. }
 *   put:
 *     summary: Atomically edit the complete Program structure
 *     description: Retained children keep their IDs. Omitted unrecorded children are deleted. Unknown, foreign or reparented IDs are rejected. Recorded sessions and their ancestors must be retained; session names, authored dates and Workout Plans are immutable. Unchanged authored dates preserve effective dates; deliberately changing a planned authored date resets its effective date. Program/week dates do not expand automatically.
 *     tags: [Training Programs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/TrainingProgramInput' }
 *     responses:
 *       200:
 *         description: Persisted updated Program.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TrainingProgram' }
 *       400: { description: Invalid structure or ownership. }
 *       401: { description: Authentication required. }
 *       403: { description: Owner-only. }
 *       404: { description: Not found or not owned by the caller. }
 *       409: { description: An edit would remove or rewrite recorded history. }
 *   delete:
 *     summary: Delete your Program and its structure, keeping standalone Workout Plans
 *     tags: [Training Programs]
 *     responses:
 *       204: { description: Deleted. }
 *       401: { description: Authentication required. }
 *       403: { description: Owner-only. }
 *       404: { description: Not found or not owned by the caller. }
 */
/**
 * @swagger
 * /training-programs/{id}/sessions/{sessionId}/outcome:
 *   post:
 *     summary: Record a permanent missed outcome or link a completed diary workout
 *     description: Owner-only. Completion links a grouped preset entry or standalone exercise entry and snapshots its name/date and Workout Plan name. Diary renames, date edits and deletion do not rewrite history. One workout can fulfill only one session. Identical retries are idempotent; conflicting final outcomes return 409. With auto_shift enabled, a new miss adds one Gregorian calendar day to every still-planned session on a strictly later effective date. Same-day and recorded sessions never move. Effective dates can leave their authored week/Program without reparenting; overflow past 9999-12-31 rolls back the whole operation. Recording and aggregate edits serialize on the Program lock.
 *     tags: [Training Programs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 additionalProperties: false
 *                 required: [status]
 *                 properties:
 *                   status: { type: string, enum: [missed] }
 *               - type: object
 *                 additionalProperties: false
 *                 required: [status, workout]
 *                 properties:
 *                   status: { type: string, enum: [completed] }
 *                   workout:
 *                     type: object
 *                     additionalProperties: false
 *                     required: [type, id]
 *                     properties:
 *                       type: { type: string, enum: [preset, individual] }
 *                       id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Complete persisted Program with resulting schedule and history.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TrainingProgram' }
 *       400: { description: Invalid outcome or identifiers. }
 *       401: { description: Authentication required. }
 *       403: { description: Delegated context forbidden. }
 *       404: { description: Program, session or diary workout not found or not owned. }
 *       409: { description: Conflicting final outcome, workout already linked, or calendar overflow. }
 */
router.get('/', async (req, res, next) => {
  try {
    res.json(await listPrograms(req.userId));
  } catch (error) {
    next(error);
  }
});
router.get('/:id', async (req, res, next) => {
  try {
    res.json(await getProgram(req.userId, req.params.id));
  } catch (error) {
    next(error);
  }
});
router.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await saveProgram(req.userId, req.body));
  } catch (error) {
    next(error);
  }
});
router.put('/:id', async (req, res, next) => {
  try {
    res.json(await saveProgram(req.userId, req.body, req.params.id));
  } catch (error) {
    next(error);
  }
});
router.post('/:id/sessions/:sessionId/outcome', async (req, res, next) => {
  try {
    res.json(
      await recordProgramOutcome(
        req.userId,
        req.params.id,
        req.params.sessionId,
        req.body
      )
    );
  } catch (error) {
    next(error);
  }
});
router.delete('/:id', async (req, res, next) => {
  try {
    await removeProgram(req.userId, req.params.id);
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});
export default router;
