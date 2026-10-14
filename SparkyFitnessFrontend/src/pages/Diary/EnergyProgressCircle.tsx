import { getEnergyUnitString } from '@/utils/nutritionCalculations';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { Numeral } from '@/components/ui/numeral';

interface EnergyCircleProps {
  remaining: number;
  progress: number;
  unit: 'kcal' | 'kJ';
  subline?: React.ReactNode;
  targetBand?: { min: number; max: number; eaten: number };
}

// Retain the existing energy contract while presenting its budget without a ring.
export const EnergyCircle = ({
  remaining,
  unit,
  subline,
  targetBand,
}: EnergyCircleProps) => {
  const { t } = useTranslation();
  const inRange =
    targetBand !== undefined &&
    targetBand.eaten >= targetBand.min &&
    targetBand.eaten <= targetBand.max;
  const isOverLimit =
    targetBand !== undefined && targetBand.eaten > targetBand.max;

  return (
    <div className="min-w-0 space-y-2">
      <Numeral
        value={remaining}
        unit={`${getEnergyUnitString(unit)} ${t('exercise.dailyProgress.remaining', 'remaining')}`}
        subline={subline}
      />
      {targetBand !== undefined && (
        <p
          className={`flex items-center gap-2 text-sm ${inRange ? 'text-success' : isOverLimit ? 'text-destructive' : 'text-warning'}`}
        >
          {inRange && <CheckCircle2 aria-hidden="true" className="size-4" />}
          {t('exercise.dailyProgress.targetBand', 'target {{min}}–{{max}}', {
            min: targetBand.min,
            max: targetBand.max,
          })}
        </p>
      )}
    </div>
  );
};
