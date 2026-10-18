import type { TrainingProgram } from '@workspace/shared';

type PlannedSession =
  TrainingProgram['phases'][number]['weeks'][number]['sessions'][number];
type OmissionSession = Pick<
  PlannedSession,
  'is_optional' | 'effective_date'
> & { status: string };

// Render the same conditions in memory and in SQL so auto-shift cannot drift
// from the athlete's derived Omitted Sessions.
function omissionConditions(today: string) {
  return [
    ['is_optional', '=', true],
    ['status', '=', 'planned'],
    ['effective_date', '<', today],
  ] as const;
}

export function isOptionalProgramSessionOmitted(
  session: OmissionSession,
  today: string
): boolean {
  return omissionConditions(today).every(([field, operator, value]) =>
    operator === '<' ? session[field] < value : session[field] === value
  );
}

/** The date is a bound query parameter, never an athlete-supplied SQL fragment. */
export function omittedSessionSql(todayParameter: `$${number}::date`): string {
  return omissionConditions(todayParameter)
    .map(([field, operator, value]) => {
      const operand =
        operator === '<' || typeof value === 'boolean' ? value : `'${value}'`;
      return `${field} ${operator} ${operand}`;
    })
    .join(' AND ');
}

/** Program reads have already projected derived omission into the status. */
export function hasSessionOutcome(
  session: Pick<PlannedSession, 'status'>
): boolean {
  return session.status !== 'planned';
}
