import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TrainingProgram } from '@workspace/shared';
import { ArrowRight } from 'lucide-react';
import { Numeral } from '@/components/ui/numeral';
import { cn } from '@/lib/utils';
import { programProgress } from './programProgress';
import { Button } from '@/components/ui/button';

export default function ProgramList({
  programs,
  today,
}: {
  programs: UseQueryResult<TrainingProgram[]>;
  today: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {programs.isPending ? (
        <p role="status">
          {t('trainingPrograms.loading', 'Loading Training Programs…')}
        </p>
      ) : programs.isError ? (
        <div role="alert">
          <p>{programs.error.message}</p>
          <Button onClick={() => void programs.refetch()}>
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      ) : programs.data?.length === 0 ? (
        <div className="space-y-2 border-t py-8">
          <h2 className="text-lg font-semibold">
            {t('trainingPrograms.emptyTitle', 'Your next goal starts here')}
          </h2>
          <p className="max-w-prose text-muted-foreground">
            {t(
              'trainingPrograms.empty',
              'Create a Training Program, define your goal and date range, then build the phases and sessions that get you there.'
            )}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {programs.data
            ?.slice()
            .sort(
              (a, b) =>
                Number(programProgress(b, today).active) -
                Number(programProgress(a, today).active)
            )
            .map((item) => {
              const progress = programProgress(item, today);
              return (
                <li
                  key={item.id}
                  className={cn(
                    'min-w-0 space-y-5 rounded-3xl border bg-card p-5 sm:p-6',
                    progress.active && 'border-primary'
                  )}
                >
                  <div className="min-w-0">
                    <Link
                      className="inline-flex min-h-11 items-center break-words text-xl font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      to={`?program=${item.id}`}
                    >
                      {item.name}
                    </Link>
                    <p className="mt-1 break-words text-muted-foreground">
                      {item.goal}
                    </p>
                    <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                      {item.start_date} – {item.end_date}
                    </p>
                  </div>
                  <Numeral
                    value={progress.current}
                    size={progress.active ? 'hero' : 'lg'}
                    unit={t('trainingPrograms.weekProgress', {
                      current: progress.current,
                      total: progress.total,
                      defaultValue: 'Week {{current}} of {{total}}',
                    })}
                    subline={
                      progress.active
                        ? t(
                            'trainingPrograms.currentProgram',
                            'Current program'
                          )
                        : undefined
                    }
                  />
                  <Button asChild variant="outline" className="min-h-11 w-full">
                    <Link
                      to={`?program=${item.id}`}
                      aria-label={t('trainingPrograms.viewNamed', {
                        name: item.name,
                        defaultValue: 'View {{name}}',
                      })}
                    >
                      {t('common.view', 'View')}{' '}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </li>
              );
            })}
        </ul>
      )}
    </>
  );
}
