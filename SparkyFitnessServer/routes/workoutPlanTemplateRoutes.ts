import express from 'express';
import { z } from 'zod';
import {
  workoutPlanCreateRequestSchema,
  workoutPlanUpdateRequestSchema,
  workoutPlanBulkRequestSchema,
  workoutPlanBulkApplyRequestSchema,
} from '@workspace/shared';
import exerciseService from '../services/exerciseService.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import { authenticate } from '../middleware/authMiddleware.js';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';
const router = express.Router();
const actingUserId = (req: express.Request) =>
  req.originalUserId || req.authenticatedUserId || req.userId;

const bulkCandidateParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
const bulkCandidateQuerySchema = z.strictObject({
  program_id: z.uuid().optional(),
});

/**
 * @swagger
 * /workout-plan-templates/{id}/bulk-prescriptions/candidates:
 *   get:
 *     summary: List exact future Workout Session candidates
 *     description: Owner-only, read-only. Reports every binding and exclusion reason. Omit program_id for standalone scope.
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: program_id, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Candidates with assignments, bindings and eligibility. }
 *       400: { description: Invalid plan or Program identifier. }
 *       403: { description: Authenticated owner required. }
 *       404: { description: Owned plan or Program not found. }
 * /workout-plan-templates/bulk-prescriptions/preview:
 *   post:
 *     summary: Preview explicit prescription changes without writing
 *     description: Returns per-target before/after prescriptions and a revision. Cancellation needs no API call.
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200: { description: Before/after batch and confirmation revision. }
 *       400: { description: Invalid request or source identity change. }
 *       403: { description: Authenticated owner required. }
 *       404: { description: Owned source or target not found. }
 *       409: { description: Incompatible mapping, history or unaccounted bindings. }
 * /workout-plan-templates/bulk-prescriptions/apply:
 *   post:
 *     summary: Atomically apply a confirmed bulk prescription preview
 *     description: Accepts request and revision; revalidates ownership, prescriptions, future bindings and history before any write. Returns the canonical saved plan.
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200: { description: Canonical saved plan. }
 *       400: { description: Invalid confirmation request. }
 *       403: { description: Authenticated owner required. }
 *       404: { description: Owned source or target not found. }
 *       409: { description: Stale preview or ineligible target; nothing applied. }
 */
router.get(
  '/:id/bulk-prescriptions/candidates',
  authenticate,
  async (req, res, next) => {
    try {
      const params = bulkCandidateParamsSchema.safeParse(req.params);
      const query = bulkCandidateQuerySchema.safeParse(req.query);
      if (!params.success || !query.success)
        return res.status(400).json({
          error: 'Select a valid plan ID and optional Training Program UUID.',
        });
      const candidates =
        await workoutPlanTemplateService.getBulkPrescriptionCandidates(
          req.userId,
          actingUserId(req),
          params.data.id,
          query.data.program_id ?? null
        );
      res.json(candidates);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/bulk-prescriptions/preview',
  authenticate,
  async (req, res, next) => {
    try {
      const parsed = workoutPlanBulkRequestSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: 'Invalid bulk prescription preview request.',
          details: parsed.error.flatten(),
        });
      const preview = await workoutPlanTemplateService.previewBulkPrescriptions(
        req.userId,
        actingUserId(req),
        parsed.data
      );
      res.json(preview);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/bulk-prescriptions/apply',
  authenticate,
  async (req, res, next) => {
    try {
      const parsed = workoutPlanBulkApplyRequestSchema.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({
          error: 'Invalid bulk prescription apply request.',
          details: parsed.error.flatten(),
        });
      const saved = await workoutPlanTemplateService.applyBulkPrescriptions(
        req.userId,
        actingUserId(req),
        parsed.data
      );
      res.json(saved);
    } catch (error) {
      next(error);
    }
  }
);

const startSessionParamsSchema = z.object({
  workoutSessionId: z.string().uuid(),
});
const startSessionBodySchema = z.strictObject({ entry_date: z.iso.date() });
/**
 * @swagger
 * /workout-plan-templates/sessions/{workoutSessionId}/start:
 *   post:
 *     summary: Start the exact prescribed Workout Session
 *     description: Expands this session's individual assignments and frozen preset prescriptions, never a plan's first/current session or a live library preset.
 *     tags: [Fitness & Workouts]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: workoutSessionId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [entry_date]
 *             properties:
 *               entry_date: { type: string, format: date }
 *     responses:
 *       201: { description: Created diary workouts from the exact session prescription. }
 *       400: { description: Invalid session ID or date. }
 *       401: { description: Authentication required. }
 *       403: { description: Diary write permission required. }
 *       404: { description: Workout Session not found or inaccessible. }
 */
router.post(
  '/sessions/:workoutSessionId/start',
  authenticate,
  checkPermissionMiddleware('diary'),
  async (req, res, next) => {
    try {
      const params = startSessionParamsSchema.safeParse(req.params);
      const body = startSessionBodySchema.safeParse(req.body);
      if (!params.success || !body.success) {
        const error = !params.success
          ? params.error
          : !body.success
            ? body.error
            : undefined;
        return res.status(400).json({
          error: 'Invalid workout session start payload.',
          details: error?.flatten(),
        });
      }
      const workouts = await exerciseService.logWorkoutPlanSession(
        req.userId,
        actingUserId(req),
        params.data.workoutSessionId,
        body.data.entry_date
      );
      res.status(201).json(workouts);
    } catch (error) {
      next(error);
    }
  }
);
/**
 * @swagger
 * /workout-plan-templates:
 *   post:
 *     summary: Create a new workout plan template
 *     tags: [Fitness & Workouts]
 *     description: Creates a new workout plan template for the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WorkoutPlanTemplate'
 *     responses:
 *       201:
 *         description: The workout plan template was created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkoutPlanTemplate'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Internal server error.
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const parsedBody = workoutPlanCreateRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        error: 'Invalid workout plan payload.',
        details: parsedBody.error.flatten(),
      });
    }
    const newPlan = await workoutPlanTemplateService.createWorkoutPlanTemplate(
      req.userId,
      parsedBody.data
    );
    res.status(201).json(newPlan);
  } catch (error) {
    next(error);
  }
});
/**
 * @swagger
 * /workout-plan-templates:
 *   get:
 *     summary: Get all workout plan templates
 *     tags: [Fitness & Workouts]
 *     description: Retrieves all workout plan templates for the authenticated user.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: A list of workout plan templates.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WorkoutPlanTemplate'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Internal server error.
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const plans =
      await workoutPlanTemplateService.getWorkoutPlanTemplatesByUserId(
        req.userId
      );
    res.status(200).json(plans);
  } catch (error) {
    next(error);
  }
});
/**
 * @swagger
 * /workout-plan-templates/{id}:
 *   get:
 *     summary: Get a specific workout plan template by ID
 *     tags: [Fitness & Workouts]
 *     description: Retrieves a specific workout plan template by its ID.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the workout plan template to retrieve.
 *     responses:
 *       200:
 *         description: The requested workout plan template.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkoutPlanTemplate'
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Workout plan template not found.
 *       500:
 *         description: Internal server error.
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const plan = await workoutPlanTemplateService.getWorkoutPlanTemplateById(
      req.userId,
      req.params.id
    );
    res.status(200).json(plan);
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    if (error.message.startsWith('Forbidden')) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      return res.status(403).json({ error: error.message });
    }
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    if (error.message === 'Workout plan template not found.') {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});
/**
 * @swagger
 * /workout-plan-templates/{id}:
 *   put:
 *     summary: Update an existing workout plan template
 *     tags: [Fitness & Workouts]
 *     description: Updates an existing workout plan template.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the workout plan template to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WorkoutPlanTemplate'
 *     responses:
 *       200:
 *         description: The workout plan template was updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WorkoutPlanTemplate'
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Workout plan template not found or could not be updated.
 *       500:
 *         description: Internal server error.
 */
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const parsedBody = workoutPlanUpdateRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({
        error: 'Invalid workout plan payload.',
        details: parsedBody.error.flatten(),
      });
    }
    const updatedPlan =
      await workoutPlanTemplateService.updateWorkoutPlanTemplate(
        req.userId,
        req.params.id,
        parsedBody.data
      );
    res.status(200).json(updatedPlan);
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    if (error.message.startsWith('Forbidden')) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      return res.status(403).json({ error: error.message });
    }
    if (
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      error.message.startsWith('Workout plan template not found')
    ) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});
/**
 * @swagger
 * /workout-plan-templates/{id}:
 *   delete:
 *     summary: Delete a workout plan template
 *     tags: [Fitness & Workouts]
 *     description: Deletes a specific workout plan template.
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The ID of the workout plan template to delete.
 *     responses:
 *       200:
 *         description: Workout plan template deleted successfully.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden.
 *       409:
 *         description: Completed, past, or Program-linked diary history prevents deletion.
 *       404:
 *         description: Workout plan template not found or could not be deleted.
 *       500:
 *         description: Internal server error.
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const result = await workoutPlanTemplateService.deleteWorkoutPlanTemplate(
      req.userId,
      req.params.id
    );
    res.status(200).json(result);
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    if (error.message.startsWith('Forbidden')) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      return res.status(403).json({ error: error.message });
    }
    if (
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      error.message.startsWith('Workout plan template not found')
    ) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});
/**
 * @swagger
 * /workout-plan-templates/active/{date}:
 *   get:
 *     summary: Get the active workout plan for a specific date
 *     tags: [Fitness & Workouts]
 *     description: Retrieves active plans with Workout Sessions and legacy assignment fields for upstream App Store v1.8.0 clients. The flat assignments are derived from sessions; next_assignment is the first assignment of next_session (or null).
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: The date to check for an active plan (YYYY-MM-DD).
 *     responses:
 *       200:
 *         description: Active plans for the date, including sessions, next_session, next_assignments, assignments, next_assignment, and sequence_position.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/WorkoutPlanTemplate'
 *       401:
 *         description: Unauthorized.
 *       500:
 *         description: Internal server error.
 */
router.get('/active/:date', authenticate, async (req, res, next) => {
  try {
    const activePlan =
      await workoutPlanTemplateService.getActiveWorkoutPlanForDate(
        req.userId,
        req.params.date
      );
    res.status(200).json(activePlan);
  } catch (error) {
    next(error);
  }
});
export default router;
