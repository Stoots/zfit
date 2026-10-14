import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import {
  addDays,
  daysBetween,
  dayToPickerDate,
  type TrainingProgram,
} from '@workspace/shared';
import { cn } from '@/lib/utils';
import type { ProgramSession } from './programTypes';

export default function ProgramSchedule({
  program,
  today,
}: {
  program: TrainingProgram;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const sessionsByDay = new Map<string, ProgramSession[]>();
  for (const phase of program.phases) {
    for (const week of phase.weeks) {
      for (const session of week.sessions) {
        const sessions = sessionsByDay.get(session.effective_date) ?? [];
        sessions.push(session);
        sessionsByDay.set(session.effective_date, sessions);
      }
    }
  }
  const weekCount = Math.ceil(
    (daysBetween(program.start_date, program.schedule_end_date) + 1) / 7
  );
  return (
    <section
      className="hidden space-y-3 lg:block"
      aria-label={t('trainingPrograms.schedule', 'Schedule')}
    >
      <h3 className="text-xl font-semibold">
        {t('trainingPrograms.schedule', 'Schedule')}
      </h3>
      <div className="overflow-hidden rounded-lg border bg-card">
        {Array.from({ length: weekCount }, (_, week) => (
          <div
            key={week}
            className="grid grid-cols-[5rem_repeat(7,minmax(0,1fr))] border-b last:border-b-0"
          >
            <div className="p-3 text-sm font-medium text-muted-foreground">
              {t('trainingPrograms.weekNumber', {
                number: week + 1,
                defaultValue: 'Week {{number}}',
              })}
            </div>
            {Array.from({ length: 7 }, (_, day) => {
              const date = addDays(program.start_date, week * 7 + day);
              return (
                <div
                  key={date}
                  aria-current={date === today ? 'date' : undefined}
                  className={cn(
                    'min-w-0 border-l p-2',
                    date === today &&
                      'relative outline -outline-offset-2 outline-primary',
                    date > program.schedule_end_date && 'bg-muted/30'
                  )}
                >
                  <time
                    dateTime={date}
                    className="block text-xs tabular-nums text-muted-foreground"
                  >
                    {dayToPickerDate(date).toLocaleDateString(i18n.language, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </time>
                  <ul className="mt-2 space-y-1">
                    {sessionsByDay.get(date)?.map((session) => (
                      <li key={session.id}>
                        <a
                          href={`#program-session-${session.id}`}
                          className={cn(
                            'flex min-h-11 items-start gap-1 rounded-md px-1 py-2 text-sm font-medium break-words hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            session.status === 'completed' &&
                              'text-muted-foreground'
                          )}
                        >
                          {session.status === 'completed' && (
                            <Check
                              className="mt-0.5 size-3 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span className="min-w-0">
                            {session.name}
                            {' · '}
                            <span
                              className={cn(
                                'text-xs font-normal',
                                session.status === 'missed'
                                  ? 'text-destructive'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {t(
                                `trainingPrograms.state.${session.status}`,
                                session.status
                              )}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
