import { afterAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  isOptionalProgramSessionOmitted,
  omittedSessionSql,
} from '../models/plannedSessionOutcome.js';
import { endPool, getSystemClient } from '../db/poolManager.js';
import {
  databaseReachable,
  requireDatabaseInCI,
} from './databaseIntegrationGuard.js';

const boundaries = [
  ['0001-01-01', '0001-01-01', false],
  ['0001-01-01', '0001-01-02', true],
  ['2024-02-29', '2024-03-01', true],
  ['2026-12-31', '2027-01-01', true],
  ['9999-12-30', '9999-12-31', true],
  ['9999-12-31', '9999-12-31', false],
  ['9999-12-31', '9999-12-30', false],
] as const;

describe('Planned Session omission calendar boundaries', () => {
  it.each(boundaries)(
    'optional session on %s as of %s is omitted: %s',
    (date, today, omitted) => {
      expect(
        isOptionalProgramSessionOmitted(
          { is_optional: true, status: 'planned', effective_date: date },
          today
        )
      ).toBe(omitted);
    }
  );
});

const skipEnvVar = 'SKIP_TRAINING_PROGRAM_DB';
const run = await databaseReachable(skipEnvVar);
requireDatabaseInCI(run, skipEnvVar, 'Planned Session outcome');

describe.runIf(run)('Planned Session omission SQL calendar boundaries', () => {
  afterAll(endPool);

  it.each(boundaries)(
    'optional session on %s as of %s is omitted: %s',
    async (date, today, omitted) => {
      const client: PoolClient = await getSystemClient();
      try {
        const result = await client.query<{ omitted: boolean }>(
          `SELECT (${omittedSessionSql('$4::date')}) AS omitted
           FROM (VALUES ($1::boolean, $2::text, $3::date))
             AS session(is_optional, status, effective_date)`,
          [true, 'planned', date, today]
        );
        expect(result.rows[0]?.omitted).toBe(omitted);
      } finally {
        client.release();
      }
    }
  );
});
