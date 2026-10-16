import assert from "node:assert/strict";
import cardAttributes from "../shared/src/constants/dashboardWorkoutCardAttributes.json" with { type: "json" };
import { test } from "node:test";
import {
  assertSnapshot,
  expectedWorkoutCards,
  readWorkoutCards,
} from "./deployment-smoke.mjs";

const entry = "/assets/index-new.js";
const sessionA = "00000000-0000-4000-8000-000000000001";
const sessionB = "00000000-0000-4000-8000-000000000002";
const standaloneId = "00000000-0000-4000-8000-000000000003";
const prescription = (count, assignmentId = 1) => [
  {
    id: assignmentId,
    workout_session_id: assignmentId === 1 ? sessionA : sessionB,
    exercise_id: 42,
    workout_preset_id: null,
    sets: Array.from({ length: count }, (_, index) => ({
      set_number: index + 1,
      reps: 8,
      weight: null,
      notes: "8–10 per side",
      rest_time: 90,
    })),
  },
];
const card = (id, count = 2, plannedId = "planned-a", planId = "7") => ({
  workoutSessionId: id,
  workoutPlanId: planId,
  trainingProgramSessionId: plannedId,
  prescription: prescription(count, id === sessionA ? 1 : 2),
});
const expected = [card(sessionA)];
const valid = () => ({
  entry,
  controlled: true,
  unobstructed: true,
  expected,
  actual: [...expected],
});

test("rejects a stale entry asset even when the visible workout order matches", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), entry: "/assets/index-old.js" }, entry),
    /different frontend build/,
  );
});

test("rejects an uncached session that cannot prove the warm-client update path", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), controlled: false }, entry),
    /warm-cache verification was not exercised/,
  );
});

test("rejects the whole program instead of the next upcoming workout", () => {
  assert.throws(
    () =>
      assertSnapshot(
        {
          ...valid(),
          actual: [
            card(sessionB, 3, "planned-b"),
            card(sessionA),
            card(standaloneId, 2, null, "8"),
          ],
        },
        entry,
      ),
    /live Training Program schedule/,
  );
});

test("rejects a different workout even when only one card is shown", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), actual: [card(sessionB, 3)] }, entry),
    /live Training Program schedule/,
  );
});

test("accepts the next scheduled workout and unchanged standalone plans", () => {
  const cards = [card(sessionA), card(standaloneId, 2, null, "8")];
  assertSnapshot({ ...valid(), expected: cards, actual: cards }, entry);
});

test("rejects an empty account instead of reporting a vacuous pass", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), expected: [], actual: [] }, entry),
    /cannot exercise/,
  );
});

test("rejects a dialog-obstructed surface even when the DOM contains the correct cards", () => {
  assert.throws(
    () => assertSnapshot({ ...valid(), unobstructed: false }, entry),
    /Close open dialogs/,
  );
});

const session = (id, count, assignmentId) => ({
  id,
  name: "A",
  day_of_week: null,
  sort_order: assignmentId - 1,
  assignments: prescription(count, assignmentId),
});
const first = session(sessionA, 2, 1);
const second = session(sessionB, 3, 2);
const plan = {
  id: 7,
  plan_name: "Same plan",
  sessions: [first, second],
  next_session: first,
  next_assignments: first.assignments,
};
const planned = (id, workoutSessionId, date) => ({
  id,
  workout_session_id: workoutSessionId,
  workout_plan_id: 7,
  workout_session_name: "A",
  effective_date: date,
  status: "planned",
});
const program = (sessions) => [{ phases: [{ weeks: [{ sessions }] }] }];

test("ranks upcoming sessions by exact UUID and date, not plan progression", () => {
  const cards = expectedWorkoutCards(
    program([
      planned("planned-a", sessionA, "2026-10-12"),
      planned("planned-b", sessionB, "2026-10-11"),
    ]),
    [plan],
    [],
  );
  assert.deepEqual(cards, [card(sessionB, 3, "planned-b"), card(sessionA)]);
});

test("retains authored same-day order for distinct same-plan same-label sessions", () => {
  const sessions = [
    planned("planned-b", sessionB, "2026-10-11"),
    planned("planned-a", sessionA, "2026-10-11"),
  ];
  assert.deepEqual(expectedWorkoutCards(program(sessions), [plan], []), [
    card(sessionB, 3, "planned-b"),
    card(sessionA),
  ]);
  assert.deepEqual(
    expectedWorkoutCards(program([...sessions].reverse()), [plan], []),
    [card(sessionA), card(sessionB, 3, "planned-b")],
  );
});

test("skips an unavailable nonfirst session while filling the queue", () => {
  const missing = planned(
    "missing",
    "00000000-0000-4000-8000-000000000099",
    "2026-10-12",
  );
  assert.deepEqual(
    expectedWorkoutCards(
      program([
        planned("planned-a", sessionA, "2026-10-11"),
        missing,
        planned("planned-b", sessionB, "2026-10-13"),
      ]),
      [plan],
      [],
    ),
    [card(sessionA), card(sessionB, 3, "planned-b")],
  );
});

test("keeps four pending occurrences after completing the third out of order", () => {
  const sessions = Array.from({ length: 6 }, (_, index) =>
    planned(`occurrence-${index + 1}`, sessionA, `2026-10-${11 + index}`),
  );
  const select = () =>
    expectedWorkoutCards(program(sessions), [plan], []).map(
      (card) => card.trainingProgramSessionId,
    );
  assert.deepEqual(select(), [
    "occurrence-1",
    "occurrence-2",
    "occurrence-3",
    "occurrence-4",
  ]);
  sessions[2].status = "completed";
  assert.deepEqual(select(), [
    "occurrence-1",
    "occurrence-2",
    "occurrence-4",
    "occurrence-5",
  ]);
});

test("rejects the wrong same-label UUID even when plan and prescription match", () => {
  assert.throws(
    () =>
      assertSnapshot(
        {
          ...valid(),
          actual: [{ ...expected[0], workoutSessionId: sessionB }],
        },
        entry,
      ),
    /live Training Program schedule/,
  );
});

test("rejects the right UUID with another session's prescription", () => {
  assert.throws(
    () =>
      assertSnapshot(
        {
          ...valid(),
          actual: [{ ...expected[0], prescription: second.assignments }],
        },
        entry,
      ),
    /live Training Program schedule/,
  );
});

test("planned sessions stay visible until their Program outcome is recorded", () => {
  assert.deepEqual(
    expectedWorkoutCards(
      program([
        planned("planned-a", sessionA, "2026-10-11"),
        planned("planned-b", sessionB, "2026-10-11"),
      ]),
      [plan],
      [{ exercises: [{ workout_plan_assignment_id: 1 }] }],
    ),
    [card(sessionA), card(sessionB, 3, "planned-b")],
  );
});

test("completed and missed Program plans never become standalone previews", () => {
  for (const status of ["completed", "missed"]) {
    assert.deepEqual(
      expectedWorkoutCards(
        program([{ ...planned("planned-b", sessionB, "2026-10-11"), status }]),
        [plan],
        [],
      ),
      [],
    );
  }
});

test("frozen preset prescription differences fail even with matching session identity", () => {
  const frozen = [
    {
      id: 3,
      workout_session_id: sessionA,
      workout_preset_id: 5,
      preset_snapshot: {
        id: 5,
        name: "A",
        description: null,
        workout_format: "strength",
        exercises: [{ exercise_id: 42, sets: prescription(2)[0].sets }],
      },
    },
  ];
  const correct = { ...expected[0], prescription: frozen };
  const changed = structuredClone(correct);
  changed.prescription[0].preset_snapshot.exercises[0].sets[0].weight = 50;
  assert.throws(
    () =>
      assertSnapshot(
        { ...valid(), expected: [correct], actual: [changed] },
        entry,
      ),
    /live Training Program schedule/,
  );
});

test("reads stable identity and full prescription from the card, never its label", () => {
  const original = globalThis.document;
  const attributes = {
    [cardAttributes.sessionId]: sessionB,
    [cardAttributes.planId]: "7",
    [cardAttributes.programSessionId]: "planned-b",
    [cardAttributes.prescription]: JSON.stringify(second.assignments),
  };
  globalThis.document = {
    querySelectorAll: () => [
      {
        textContent: "Start Workout",
        closest: (selector) => {
          assert.equal(selector, `[${cardAttributes.sessionId}]`);
          return { getAttribute: (key) => attributes[key] ?? null };
        },
      },
    ],
  };
  try {
    assert.deepEqual(readWorkoutCards(cardAttributes), [
      card(sessionB, 3, "planned-b"),
    ]);
    assert.equal(
      readWorkoutCards(cardAttributes, [card(sessionB, 3, "planned-b")]),
      true,
    );
    assert.equal(readWorkoutCards(cardAttributes, [card(sessionA)]), false);
    delete attributes[cardAttributes.prescription];
    assert.equal(
      readWorkoutCards(cardAttributes, [card(sessionB, 3, "planned-b")]),
      false,
    );
  } finally {
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  }
});

test("inactive owner-bound sessions include same-day conditioning in authored order", () => {
  const programs = program([
    planned("planned-a", sessionA, "2026-10-11"),
    planned("planned-b", sessionB, "2026-10-11"),
    planned("later", sessionA, "2026-10-12"),
  ]);
  programs[0].user_id = "owner";
  const inactive = {
    ...plan,
    user_id: "owner",
    is_active: false,
    next_session: null,
    sessions: [first, { ...second, name: "Conditioning" }],
  };
  assert.deepEqual(expectedWorkoutCards(programs, [], [], [inactive]), [
    card(sessionA),
    card(sessionB, 3, "planned-b"),
    card(sessionA, 2, "later"),
  ]);
  assert.deepEqual(
    expectedWorkoutCards(
      programs,
      [],
      [],
      [{ ...inactive, user_id: "other-owner" }],
    ),
    [],
  );
});

test("unbound inactive library plans are not added as standalone previews", () => {
  assert.deepEqual(
    expectedWorkoutCards(
      [],
      [],
      [],
      [{ ...plan, user_id: "owner", is_active: false }],
    ),
    [],
  );
});

test("active progression is retained when the library also contains that plan", () => {
  const programs = program([
    {
      ...planned("completed", sessionB, "2026-10-11"),
      workout_plan_id: 99,
      status: "completed",
    },
  ]);
  programs[0].user_id = "owner";
  const active = {
    ...plan,
    next_session: second,
    next_assignments: second.assignments,
  };
  const library = { ...plan, user_id: "owner", next_session: first };
  assert.deepEqual(expectedWorkoutCards(programs, [active], [], [library]), [
    card(sessionB, 3, null),
  ]);
});

test("logging an assignment does not hide another scheduled occurrence", () => {
  assert.deepEqual(
    expectedWorkoutCards(
      program([
        planned("planned-a", sessionA, "2026-10-11"),
        planned("planned-b", sessionB, "2026-10-12"),
      ]),
      [plan],
      [{ workout_plan_assignment_id: 1 }],
    ),
    [card(sessionA), card(sessionB, 3, "planned-b")],
  );
});

test("partial diary linking retains a weekly session until every assignment is linked", () => {
  const assignments = [
    ...first.assignments,
    { ...first.assignments[0], id: 3 },
  ];
  const weeklySession = { ...first, day_of_week: 0, assignments };
  const weeklyPlan = {
    ...plan,
    schedule_type: "weekly",
    sessions: [weeklySession],
    next_session: weeklySession,
    next_assignments: assignments,
  };
  const partial = [
    {
      completed_at: null,
      exercises: [
        { workout_plan_assignment_id: 1 },
        { workout_plan_assignment_id: 1 },
      ],
    },
  ];
  const expectedCard = {
    ...card(sessionA, 2, null),
    prescription: assignments,
  };
  assert.deepEqual(expectedWorkoutCards([], [weeklyPlan], partial), [
    expectedCard,
  ]);
  assert.deepEqual(
    expectedWorkoutCards(
      [],
      [weeklyPlan],
      [...partial, { workout_plan_assignment_id: 3, completed_at: null }],
    ),
    [],
  );
  const programs = program([planned("planned-a", sessionA, "2026-10-11")]);
  assert.deepEqual(expectedWorkoutCards(programs, [weeklyPlan], partial), [
    { ...expectedCard, trainingProgramSessionId: "planned-a" },
  ]);
});
