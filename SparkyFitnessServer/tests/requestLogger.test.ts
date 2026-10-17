import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { log } from '../config/logging.js';
import { requestLogger } from '../middleware/requestLogger.js';

vi.mock('../config/logging', () => ({ log: vi.fn() }));

function run(originalUrl: string, path = originalUrl) {
  const next = vi.fn() as NextFunction;
  requestLogger()(
    { method: 'GET', originalUrl, path } as Request,
    {} as Response,
    next
  );
  return next;
}

describe('requestLogger', () => {
  it('skips the container health check but still calls next', () => {
    vi.mocked(log).mockClear();
    expect(run('/api/health')).toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('logs other requests', () => {
    vi.mocked(log).mockClear();
    run('/api/exercise-entries/history?x=1', '/api/exercise-entries/history');
    expect(log).toHaveBeenCalledWith(
      'info',
      'Incoming request: GET /api/exercise-entries/history?x=1 (Path: /api/exercise-entries/history)'
    );
  });
});
