import { cn } from '@/lib/utils';

export function AmbientGlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'ambient-glow pointer-events-none absolute inset-0 rounded-[inherit]',
        className
      )}
    />
  );
}
