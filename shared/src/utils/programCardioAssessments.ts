import type { TrainingProgram } from "../schemas/api/TrainingPrograms.api.zod.ts";

/** Keep the scheduled test choices consistent across web and mobile. */
export function selectProgramCardioAssessmentChoices(
  programs: readonly TrainingProgram[],
  testType: string,
  selectedSessionId: string | null,
) {
  return programs.flatMap((program) =>
    program.phases.flatMap((phase) =>
      phase.weeks.flatMap((week) =>
        week.sessions
          .filter(
            (session) =>
              session.cardio_test_type === testType &&
              (session.status === "planned" ||
                session.status === "omitted" ||
                session.id === selectedSessionId),
          )
          .map((session) => ({ program, phase, session })),
      ),
    ),
  );
}
