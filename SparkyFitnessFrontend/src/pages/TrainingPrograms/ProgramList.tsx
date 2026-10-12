import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TrainingProgram } from '@workspace/shared';
import { Button } from '@/components/ui/button';

export default function ProgramList({
  programs,
}: {
  programs: UseQueryResult<TrainingProgram[]>;
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
        <ul className="divide-y border-y">
          {programs.data?.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-4 py-5"
            >
              <div className="min-w-0 flex-1">
                <Link
                  className="break-words text-lg font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <Button asChild variant="outline" className="min-h-11">
                <Link
                  to={`?program=${item.id}`}
                  aria-label={t('trainingPrograms.viewNamed', {
                    name: item.name,
                    defaultValue: 'View {{name}}',
                  })}
                >
                  {t('common.view', 'View')}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
