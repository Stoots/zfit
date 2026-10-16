import express from 'express';
// @ts-expect-error TS7016 — package has no declarations.
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import workoutPlanTemplateRoutes from '../routes/workoutPlanTemplateRoutes.js';
import workoutPlanTemplateService from '../services/workoutPlanTemplateService.js';

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => next(),
}));
vi.mock('../services/workoutPlanTemplateService.js', () => ({
  default: { getBulkPrescriptionCandidates: vi.fn().mockResolvedValue([]) },
}));

describe('workout plan template acting user', () => {
  it.each([
    [
      {
        originalUserId: 'original',
        authenticatedUserId: 'authenticated',
        userId: 'target',
      },
      'original',
    ],
    [
      { authenticatedUserId: 'authenticated', userId: 'target' },
      'authenticated',
    ],
    [{ userId: 'target' }, 'target'],
  ])(
    'uses the first available actor in the existing precedence',
    async (identity, actor) => {
      const app = express();
      app.use((req, _res, next) => {
        Object.assign(req, identity);
        next();
      });
      app.use('/workout-plan-templates', workoutPlanTemplateRoutes);

      const response = await request(app).get(
        '/workout-plan-templates/1/bulk-prescriptions/candidates'
      );

      expect(response.status).toBe(200);
      expect(
        workoutPlanTemplateService.getBulkPrescriptionCandidates
      ).toHaveBeenCalledWith('target', actor, 1, null);
    }
  );
});
