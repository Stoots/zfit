import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';

export const chartSeries = [1, 2, 3, 4, 5, 6].map(
  (series) => `hsl(var(--chart-${series}))`
);

export const trendChartTheme = {
  grid: { stroke: 'hsl(var(--border))', vertical: false },
  axis: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
  tooltip: {
    backgroundColor: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 16,
  },
  reference: { stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '4 4' },
};

interface TrendChartProps {
  data: { label: string; value: number | null }[];
  label: string;
  valueLabel: string;
  target?: { value: number; label: string };
  events?: { at: string; label: string }[];
  color?: string;
  formatValue?: (value: number) => string;
  className?: string;
}

export function trendDomain(
  data: TrendChartProps['data'],
  target?: number
): [number, number] {
  const values = data.flatMap(({ value }) =>
    value !== null && Number.isFinite(value) ? [value] : []
  );
  if (target !== undefined && Number.isFinite(target)) values.push(target);
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.1, Math.abs(max) * 0.01) || 1;
  return [min - padding, max + padding];
}

export function TrendChart({
  data,
  label,
  valueLabel,
  target,
  events = [],
  color = chartSeries[0],
  formatValue,
  className,
}: TrendChartProps) {
  return (
    <figure aria-label={label} className={cn('min-w-0', className)}>
      <figcaption className="mb-4 text-sm font-medium">{label}</figcaption>
      <div className="h-64 min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            accessibilityLayer
            margin={{ top: 32, right: 16, bottom: 8, left: 0 }}
          >
            <CartesianGrid {...trendChartTheme.grid} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={trendChartTheme.axis}
              minTickGap={32}
            />
            <YAxis
              domain={trendDomain(data, target?.value)}
              axisLine={false}
              tickLine={false}
              tick={trendChartTheme.axis}
              tickFormatter={formatValue}
              width={52}
            />
            <Tooltip
              contentStyle={trendChartTheme.tooltip}
              formatter={(value) =>
                typeof value === 'number' && formatValue
                  ? formatValue(value)
                  : value
              }
            />
            {target && (
              <ReferenceLine
                y={target.value}
                {...trendChartTheme.reference}
                label={{
                  value: target.label,
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                  position: 'insideTopRight',
                }}
              />
            )}
            {events.map((event) => (
              <ReferenceLine
                key={`${event.at}-${event.label}`}
                x={event.at}
                {...trendChartTheme.reference}
                label={{
                  value: event.label,
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                  position: 'insideTopLeft',
                }}
              />
            ))}
            <Line
              type="linear"
              dataKey="value"
              name={valueLabel}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">
        {data.map((point, index) => (
          <li key={`${point.label}-${index}`}>
            {point.label}:{' '}
            {point.value === null
              ? '—'
              : (formatValue?.(point.value) ?? point.value)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
