import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ProgramSession, OutcomeStatus } from './programTypes';

export default function SessionRowActions({
  session,
  disabled,
  onRecord,
}: {
  session: ProgramSession;
  disabled: boolean;
  onRecord: (target: {
    session: ProgramSession;
    status: OutcomeStatus;
  }) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {session.status === 'planned' && (
        <div className="flex flex-wrap gap-3">
          <Button
            className="min-h-11"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onRecord({
                session,
                status: 'completed',
              })
            }
          >
            {t('trainingPrograms.linkCompleted', 'Link completed workout')}
          </Button>
          <Button
            className="min-h-11"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onRecord({
                session,
                status: 'missed',
              })
            }
          >
            {t('trainingPrograms.markMissed', 'Mark missed')}
          </Button>
        </div>
      )}
    </>
  );
}
