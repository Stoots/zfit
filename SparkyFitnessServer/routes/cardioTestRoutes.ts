import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import checkPermissionMiddleware from '../middleware/checkPermissionMiddleware.js';
import {
  createCooperRunTestAttempt,
  editCooperRunTestAttempt,
  getCooperRunAttempts,
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
 *     responses:
 *       201: { description: The persisted Test Attempt. }
 *       400: { description: Invalid date or distance. }
 *       401: { description: Authentication required. }
 *       403: { description: Diary write access required. }
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

export default router;
