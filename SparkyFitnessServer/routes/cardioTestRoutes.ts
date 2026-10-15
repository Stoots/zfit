import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import {
  createCooperRunTestAttempt,
  editCooperRunTestAttempt,
  getCooperRunAttempts,
  getProtocolAttempts,
  saveProtocolAttempt,
} from '../services/cardioTestAttemptService.js';

const router = express.Router();
router.use(authenticate, checkPermissionMiddleware('diary'));

/**
 * @swagger
 * /cardio-tests/cooper-run/attempts:
 *   get:
 *     summary: List Cooper run Test Attempts in date order
 *     tags: [Cardio Tests]
 *     responses:
 *       200: { description: The active user's dated attempts. }
 *       401: { description: Authentication required. }
 *       403: { description: Diary access required. }
 */
router.get('/cooper-run/attempts', async (req, res, next) => {
  try {
    res.json(await getCooperRunAttempts(req.userId, req.authenticatedUserId));
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /cardio-tests/cooper-run/attempts:
 *   post:
 *     summary: Record a Cooper run Test Attempt
 *     tags: [Cardio Tests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [attempt_date, distance_meters]
 *             properties:
 *               attempt_date: { type: string, format: date }
 *               distance_meters: { type: number, exclusiveMinimum: 0 }
 *               planned_session_id: { type: string, format: uuid, nullable: true, description: Optional owner-only Planned Session link; omit or null for standalone attempts. }
 *     responses:
 *       201: { description: The persisted Test Attempt. }
 *       400: { description: Invalid date or distance. }
 *       401: { description: Authentication required. }
 *       403: { description: Diary write access required; Program linking requires the owner. }
 */
router.post('/cooper-run/attempts', async (req, res, next) => {
  try {
    res
      .status(201)
      .json(
        await createCooperRunTestAttempt(
          req.userId,
          req.authenticatedUserId,
          req.body
        )
      );
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /cardio-tests/cooper-run/attempts/{id}:
 *   put:
 *     summary: Edit a Cooper run Test Attempt
 *     tags: [Cardio Tests]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [attempt_date, distance_meters]
 *             properties:
 *               attempt_date: { type: string, format: date }
 *               distance_meters: { type: number, exclusiveMinimum: 0 }
 *               planned_session_id: { type: string, format: uuid, nullable: true, description: Omit to retain the current link, or null to make the attempt standalone. }
 *     responses:
 *       200: { description: The updated Test Attempt. }
 *       400: { description: Invalid identifier, date or distance. }
 *       401: { description: Authentication required. }
 *       403: { description: Diary write access required. }
 *       404: { description: Test Attempt not found or not owned. }
 */
router.put('/cooper-run/attempts/:id', async (req, res, next) => {
  try {
    res.json(
      await editCooperRunTestAttempt(
        req.userId,
        req.authenticatedUserId,
        req.params.id!,
        req.body
      )
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /cardio-tests/{protocol}/attempts:
 *   get:
 *     summary: List dated Test Attempts for a protocol
 *     tags: [Cardio Tests]
 *     parameters:
 *       - in: path
 *         name: protocol
 *         required: true
 *         schema: { type: string, enum: [sprint_6s, power_30s, ramp] }
 *     responses:
 *       200: { description: The active user's dated attempts for this protocol. }
 *       403: { description: Diary access required. }
 *   post:
 *     summary: Record a Test Attempt with test_type, attempt_date and protocol results
 *     tags: [Cardio Tests]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [test_type, attempt_date, results]
 *             properties:
 *               planned_session_id: { type: string, format: uuid, nullable: true, description: Optional owner-only Planned Session link; omit or null for standalone attempts. }
 *     responses:
 *       201: { description: The persisted Test Attempt. }
 *       400: { description: Invalid protocol, date, or results. }
 *       403: { description: Diary write access required. }
 */
router.get('/:protocol/attempts', async (req, res, next) => {
  try {
    res.json(
      await getProtocolAttempts(
        req.userId,
        req.authenticatedUserId,
        req.params.protocol!
      )
    );
  } catch (error) {
    next(error);
  }
});
router.post('/:protocol/attempts', async (req, res, next) => {
  try {
    res
      .status(201)
      .json(
        await saveProtocolAttempt(
          req.userId,
          req.authenticatedUserId,
          req.params.protocol!,
          req.body
        )
      );
  } catch (error) {
    next(error);
  }
});
/**
 * @swagger
 * /cardio-tests/{protocol}/attempts/{id}:
 *   put:
 *     summary: Edit a dated Test Attempt within its original protocol
 *     tags: [Cardio Tests]
 *     description: Omit planned_session_id to retain the current Program link, or send null to make the attempt standalone. Program links are owner-only.
 *     responses:
 *       200: { description: The updated Test Attempt. }
 *       400: { description: Invalid identifier, protocol, date, or results. }
 *       404: { description: Test Attempt not found or not owned. }
 */
router.put('/:protocol/attempts/:id', async (req, res, next) => {
  try {
    res.json(
      await saveProtocolAttempt(
        req.userId,
        req.authenticatedUserId,
        req.params.protocol!,
        req.body,
        req.params.id!
      )
    );
  } catch (error) {
    next(error);
  }
});

export default router;
