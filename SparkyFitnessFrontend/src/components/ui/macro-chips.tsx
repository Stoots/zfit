import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface MacroChipsProps {
  protein: number;
  carbs: number;
  fat: number;
  kcal?: number;
  className?: string;
}

export function MacroChips({
  protein,
  carbs,
  fat,
  kcal,
  className,
}: MacroChipsProps) {
  const { t, i18n } = useTranslation();
  const grams = new Intl.NumberFormat(i18n.language, {
    style: 'unit',
    unit: 'gram',
    maximumFractionDigits: 1,
  });
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {(
        [
          ['protein', protein, 'bg-protein'],
          ['carbs', carbs, 'bg-carbs'],
          ['fat', fat, 'bg-fat'],
        ] as const
      ).map(([key, value, color]) => (
        <li
          key={key}
          className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
        >
          <span
            aria-hidden="true"
            className={cn('size-1.5 shrink-0 rounded-full', color)}
          />
          <span>{t(`nutrition.${key}`)}</span>
          <span className="font-medium tabular-nums">
            {grams.format(value)}
          </span>
        </li>
      ))}
      {kcal !== undefined && (
        <li className="inline-flex items-center rounded-full border px-3 py-1.5 text-xs tabular-nums">
          {new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: 0,
          }).format(kcal)}{' '}
          {t('common.kcal', 'kcal')}
        </li>
      )}
    </ul>
  );
}
