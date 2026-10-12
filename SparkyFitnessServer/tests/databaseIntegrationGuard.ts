import pg from 'pg';
import { it } from 'vitest';

export async function databaseReachable(skipEnvVar: string): Promise<boolean> {
  if (
    Boolean(process.env[skipEnvVar]) ||
    !process.env.SPARKY_FITNESS_APP_DB_USER
  )
    return false;

  const probe = new pg.Client({
    host: process.env.SPARKY_FITNESS_DB_HOST,
    port: Number(process.env.SPARKY_FITNESS_DB_PORT) || 5432,
    database: process.env.SPARKY_FITNESS_DB_NAME,
    user: process.env.SPARKY_FITNESS_APP_DB_USER,
    password: process.env.SPARKY_FITNESS_APP_DB_PASSWORD,
    connectionTimeoutMillis: 2000,
  });
  try {
    await probe.connect();
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

export function requireDatabaseInCI(
  run: boolean,
  skipEnvVar: string,
  suiteName: string
): void {
  const skipRequested = Boolean(process.env[skipEnvVar]);
  it.runIf(!run && Boolean(process.env.CI) && !skipRequested)(
    `requires a reachable database in CI (set ${skipEnvVar} to opt out)`,
    () => {
      throw new Error(
        `${suiteName} integration tests need Postgres: set SPARKY_FITNESS_DB_* and SPARKY_FITNESS_APP_DB_USER/PASSWORD, or set ${skipEnvVar} to skip deliberately.`
      );
    }
  );
}
