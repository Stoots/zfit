import { parseArgs } from 'node:util';
import { open, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyWorkoutProgramConsolidation,
  consolidationIdentitySchema,
  preflightWorkoutProgramConsolidation,
} from '../models/workoutProgramConsolidationRepository.js';
import { endPool } from '../db/poolManager.js';

// No dotenv, default database, schema bootstrap or production discovery here.
// The operator supplies explicit environment and exact connection expectations.
const { values } = parseArgs({
  options: {
    action: { type: 'string', default: 'preflight' },
    owner: { type: 'string' },
    program: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    output: { type: 'string' },
    manifest: { type: 'string' },
    'legacy-mapping': { type: 'string' },
    'expected-host': { type: 'string' },
    'expected-port': { type: 'string' },
    'expected-database': { type: 'string' },
    execute: { type: 'boolean', default: false },
    'confirm-operation': { type: 'string' },
  },
});
const repository = await realpath(
  resolve(dirname(fileURLToPath(import.meta.url)), '../..')
);
async function privatePath(
  value: string | undefined,
  existing: boolean
): Promise<string> {
  if (!value) throw new Error('An explicit private file path is required.');
  const path = resolve(value);
  const physical = existing
    ? await realpath(path)
    : resolve(
        await realpath(dirname(path)),
        path.slice(dirname(path).length + 1)
      );
  if (physical === repository || physical.startsWith(repository + sep))
    throw new Error(
      'Private manifests, exports and receipts must remain outside the repository.'
    );
  if (existing && (await stat(physical)).mode & 0o077)
    throw new Error(
      'Private input must not be group/world-readable; use mode0600.'
    );
  return physical;
}
async function run(): Promise<void> {
  for (const [argument, environment] of [
    ['expected-host', 'SPARKY_FITNESS_DB_HOST'],
    ['expected-port', 'SPARKY_FITNESS_DB_PORT'],
    ['expected-database', 'SPARKY_FITNESS_DB_NAME'],
  ] as const) {
    if (!values[argument] || values[argument] !== process.env[environment])
      throw new Error(
        `Explicit --${argument} must exactly match the supplied database environment.`
      );
  }
  if (!values.owner) throw new Error('--owner UUID is required.');
  if (!process.env.SPARKY_FITNESS_APP_DB_USER)
    throw new Error(
      'Explicit application database credentials are required; no owner/OS-role fallback is permitted.'
    );
  const output = await privatePath(values.output, false);
  // Fail on an existing receipt or unwritable destination BEFORE database writes.
  const receipt = await open(output, 'wx', 0o600);
  let databaseApplied = false;
  try {
    let result: unknown;
    if (values.action === 'preflight') {
      if (values.execute || values.manifest || !values.program || !values.name)
        throw new Error(
          'Preflight requires --program UUID and --name, without --execute/--manifest.'
        );
      const legacyMapping = values['legacy-mapping']
        ? JSON.parse(
            await readFile(
              await privatePath(values['legacy-mapping'], true),
              'utf8'
            )
          )
        : undefined;
      result = await preflightWorkoutProgramConsolidation(values.owner, {
        program_id: values.program,
        target_plan_name: values.name,
        description: values.description,
        legacy_mapping: legacyMapping,
      });
    } else if (values.action === 'apply') {
      if (!values.execute || !values['confirm-operation'])
        throw new Error(
          'Apply requires --execute and explicit --confirm-operation UUID from the approved private manifest.'
        );
      const input: unknown = JSON.parse(
        await readFile(await privatePath(values.manifest, true), 'utf8')
      );
      const manifest =
        input && typeof input === 'object' && 'proposal' in input
          ? input.proposal
          : input;
      const identity = consolidationIdentitySchema.parse(manifest);
      if (
        values['confirm-operation'] !== identity.operation_id ||
        values.owner !== identity.user_id ||
        (values.program && values.program !== identity.program_id)
      )
        throw new Error(
          'Explicit operation/owner/Program confirmation does not match the approved manifest.'
        );
      result = await applyWorkoutProgramConsolidation(values.owner, manifest);
      databaseApplied = true;
    } else throw new Error('--action must be preflight or apply.');
    await receipt.writeFile(JSON.stringify(result, null, 2) + '\n');
    await receipt.sync();
    console.log(`${values.action} private receipt written: ${output}`);
  } catch (error) {
    if (!databaseApplied) await unlink(output);
    else
      console.error(
        'Database operation acknowledged; receipt failed. Recover by replaying the SAME approved manifest to a new private output path.'
      );
    throw error;
  } finally {
    await receipt.close();
  }
}
try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await endPool();
}
