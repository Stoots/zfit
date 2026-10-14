import { daysBetween, type TrainingProgram } from '@workspace/shared';

export function programProgress(program: TrainingProgram, today: string) {
  const total = Math.ceil(
    (daysBetween(program.start_date, program.schedule_end_date) + 1) / 7
  );
  return {
    total,
    current: Math.max(
      0,
      Math.min(
        total,
        Math.floor(daysBetween(program.start_date, today) / 7) + 1
      )
    ),
    active: program.start_date <= today && today <= program.schedule_end_date,
  };
}
