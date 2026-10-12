import { useTranslation } from 'react-i18next';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ProgramItemControls({
  kind,
  index,
  length,
  onMove,
  onRemove,
  preserveHistory = false,
}: {
  kind: 'phase' | 'week' | 'session';
  index: number;
  length: number;
  onMove: (delta: number) => void;
  onRemove: () => void;
  preserveHistory?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={t('trainingPrograms.moveUp', {
          kind,
          number: index + 1,
          defaultValue: 'Move {{kind}} {{number}} up',
        })}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={index === length - 1}
        onClick={() => onMove(1)}
        aria-label={t('trainingPrograms.moveDown', {
          kind,
          number: index + 1,
          defaultValue: 'Move {{kind}} {{number}} down',
        })}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        onClick={onRemove}
        disabled={preserveHistory}
        aria-label={t('trainingPrograms.removeItem', {
          kind,
          number: index + 1,
          defaultValue: 'Remove {{kind}} {{number}}',
        })}
      >
        <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
        {t('common.remove', 'Remove')}
      </Button>
    </div>
  );
}
