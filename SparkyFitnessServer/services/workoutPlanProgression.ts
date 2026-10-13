export interface AssignmentProgressionInput {
  id: string | number;
  sort_order?: number | null;
}
export interface SessionProgressionInput<
  T extends AssignmentProgressionInput = AssignmentProgressionInput,
> {
  id: string;
  name: string;
  sort_order: number;
  assignments: T[];
}
export interface LoggedEntryProgressionInput {
  id?: string | number;
  workout_plan_assignment_id?: string | number | null;
  entry_date?: string | Date;
  created_at?: string | Date | null;
}
export interface SequencePosition {
  current: number;
  total: number;
  session_name: string;
}
export interface SequentialProgressionResult<
  T extends SessionProgressionInput,
> {
  nextSession: T | null;
  nextAssignments: T['assignments'];
  sequencePosition: SequencePosition | null;
}

/** Preserve chronological cycle progression, using stable session membership
 * rather than grouping assignments by an index or a repeated display label. */
export function computeSequentialPlanProgression<
  T extends SessionProgressionInput,
>(
  sessions: T[],
  loggedRows: LoggedEntryProgressionInput[]
): SequentialProgressionResult<T> {
  const ordered = sessions
    .filter((session) => session.assignments.length > 0)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  if (!ordered.length)
    return { nextSession: null, nextAssignments: [], sequencePosition: null };
  const logOrders = new Map<string, number[]>();
  for (const [order, entry] of loggedRows.entries()) {
    if (
      entry.workout_plan_assignment_id === null ||
      entry.workout_plan_assignment_id === undefined
    )
      continue;
    const id = String(entry.workout_plan_assignment_id);
    const orders = logOrders.get(id);
    if (orders) orders.push(order);
    else logOrders.set(id, [order]);
  }
  let threshold = -1;
  let activeOrder = 0;
  // Each complete session consumes a strictly later log, so this loop is bounded
  // by loggedRows.length. Empty authoring containers never block progression.
  while (true) {
    let incomplete = false;
    for (const [index, session] of ordered.entries()) {
      let completion = threshold;
      for (const assignment of session.assignments) {
        const order = logOrders
          .get(String(assignment.id))
          ?.find((value) => value > threshold);
        if (order === undefined) {
          incomplete = true;
          break;
        }
        completion = Math.max(completion, order);
      }
      if (incomplete) {
        activeOrder = index;
        break;
      }
      threshold = completion;
    }
    if (incomplete || threshold >= loggedRows.length - 1) break;
    // Unrelated/out-of-order logs cannot complete another whole cycle; the next
    // pass stops at the first missing assignment, as in the previous algorithm.
  }
  const nextSession = ordered[activeOrder]!;
  return {
    nextSession,
    nextAssignments: nextSession.assignments,
    sequencePosition: {
      current: activeOrder + 1,
      total: ordered.length,
      session_name: nextSession.name,
    },
  };
}
