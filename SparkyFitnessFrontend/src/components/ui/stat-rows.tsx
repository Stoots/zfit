import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StatRowsProps {
  rows: { id: string; label: ReactNode; value: ReactNode; meta?: ReactNode }[];
  actions?: {
    id: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }[];
  className?: string;
}

export function StatRows({ rows, actions, className }: StatRowsProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <dl className="divide-y divide-border">
        {rows.map(({ id, label, value, meta }) => (
          <div
            key={id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
          >
            <dt className="min-w-0 text-sm text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-3 gap-y-1 text-right text-sm">
              <span className="font-medium tabular-nums">{value}</span>
              {meta && (
                <span className="text-xs text-muted-foreground">{meta}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {actions && actions.length > 0 && (
        <div className="mt-2 flex flex-wrap divide-x divide-border border-t">
          {actions.map(({ id, label, ...props }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal rounded-none px-3 py-3"
              {...props}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
