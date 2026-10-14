import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface NumeralProps {
  value: number | string | null;
  unit?: ReactNode;
  subline?: ReactNode;
  size?: 'hero' | 'lg' | 'md';
  unitPosition?: 'below' | 'beside';
  locale?: string;
  formatOptions?: Intl.NumberFormatOptions;
  className?: string;
}

export function Numeral({
  value,
  unit,
  subline,
  size = 'hero',
  unitPosition = 'below',
  locale,
  formatOptions,
  className,
}: NumeralProps) {
  const { i18n } = useTranslation();
  const formatted =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? new Intl.NumberFormat(locale ?? i18n.language, formatOptions).format(
            value
          )
        : '—'
      : (value ?? '—');
  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'flex min-w-0 gap-x-2 gap-y-1',
          unitPosition === 'beside' ? 'flex-wrap items-baseline' : 'flex-col'
        )}
      >
        <span
          className={cn(
            'font-numeral font-bold leading-tight tracking-tight tabular-nums break-words',
            {
              'text-7xl': size === 'hero',
              'text-5xl': size === 'lg',
              'text-3xl': size === 'md',
            }
          )}
        >
          {formatted}
        </span>
        {unit && (
          <span className="text-sm font-medium text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {subline && (
        <div className="mt-3 text-sm text-muted-foreground">{subline}</div>
      )}
    </div>
  );
}
