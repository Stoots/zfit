import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Coffee, Moon, Clock, AlertTriangle, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useActiveCaffeineQuery } from '@/hooks/Diary/useCaffeineKinetics';
import { trendChartTheme } from '@/components/ui/trend-chart';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  activeCaffeineAt,
  caffeineCurve,
  caffeineCutoff,
  thresholdCrossingTime,
} from '@workspace/shared';

/** Local HH:MM for an instant, in the viewer's own zone. */
const clockLabel = (instant: string | number) =>
  new Date(instant).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

interface CaffeineCardProps {
  date: string;
  userId?: string | null;
}

export const CaffeineCard = ({ date, userId }: CaffeineCardProps) => {
  const { t } = useTranslation();
  const { data, isLoading } = useActiveCaffeineQuery(date, userId);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Ticking timer: re-evaluate active caffeine continuous decay without refetching
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Derived above the early returns: hooks must run in the same order on every
  // render, and the card returns null on a day with no caffeine.
  const bedtimeMs = data ? new Date(data.bedtime_at).getTime() : 0;

  // The plotted window belongs to the day on screen: an hour before its first
  // dose to two hours past its bedtime, so the curve shows where it is heading
  // rather than stopping at the moment of most interest.
  //
  // The wall clock must never widen it. This card renders for whatever date the
  // diary is showing, and the server answers for that date, so on a past day
  // `Date.now()` sits outside the window entirely -- stretching the range to
  // reach it drew a curve from that day's first coffee to this instant, and
  // caffeineCurve steps the whole span at 10-minute intervals with no cap. A
  // year-old dose meant ~52k points and a hung chart.
  const windowMs = useMemo(() => {
    if (!data || data.doses.length === 0) return null;
    const rawEnd = bedtimeMs + 2 * 60 * 60 * 1000;

    // The calendar start of the viewed day in local time
    const [y, m, d] = date.split('-').map(Number);
    const dayStartMs =
      y && m && d
        ? new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
        : bedtimeMs - 24 * 60 * 60 * 1000;
    const nowBelongsToDay = nowMs >= dayStartMs && nowMs <= rawEnd;

    // Doses belonging to the day on screen:
    const dayDoses = data.doses.filter((dose) => {
      const ms = new Date(dose.at).getTime();
      return ms >= dayStartMs && ms <= rawEnd;
    });

    const firstDoseMs =
      dayDoses.length > 0
        ? dayDoses.reduce(
            (earliest, dose) => Math.min(earliest, new Date(dose.at).getTime()),
            Number.POSITIVE_INFINITY
          )
        : dayStartMs + 8 * 60 * 60 * 1000;
    const doseStart =
      dayDoses.length > 0 ? firstDoseMs - 60 * 60 * 1000 : firstDoseMs;
    const rawStart = nowBelongsToDay ? Math.min(doseStart, nowMs) : doseStart;

    // Align start to the top of the hour without local-time mutation
    const startDate = new Date(rawStart);
    const startRemainderMs =
      (startDate.getMinutes() * 60 + startDate.getSeconds()) * 1000 +
      startDate.getMilliseconds();
    const start = rawStart - startRemainderMs;

    // Align end to the top of the next hour without local-time mutation
    const endDate = new Date(rawEnd);
    const endRemainderMs =
      (endDate.getMinutes() * 60 + endDate.getSeconds()) * 1000 +
      endDate.getMilliseconds();
    const end =
      endRemainderMs === 0 ? rawEnd : rawEnd + (3600 * 1000 - endRemainderMs);

    return {
      start,
      end,
      nowBelongsToDay,
    };
  }, [data, bedtimeMs, nowMs, date]);

  // Consistent 1-hour interval ticks across the plotted window
  const ticks = useMemo(() => {
    if (!windowMs) return [];
    const result: number[] = [];
    const ONE_HOUR_MS = 60 * 60 * 1000;
    for (let t = windowMs.start; t <= windowMs.end; t += ONE_HOUR_MS) {
      result.push(t);
    }
    return result;
  }, [windowMs]);

  // "Now" on the day being viewed, otherwise that day's edge -- so the decay
  // figure and the cutoff describe the day on screen rather than this instant.
  const referenceMs =
    windowMs && !windowMs.nowBelongsToDay ? windowMs.end : nowMs;
  const nowIsInWindow = windowMs?.nowBelongsToDay ?? false;

  const chart = useMemo(() => {
    if (!data || !windowMs) return [];
    return caffeineCurve(
      data.doses,
      windowMs.start,
      windowMs.end,
      data.half_life_hours,
      10
    );
  }, [data, windowMs]);

  // Recomputed rather than parsed back from the response's local HH:MM: the
  // shared helper returns the exact instant, which is what the plot needs, and
  // it is the same function the server answered with.
  const cutoffMs = useMemo(() => {
    if (!data) return null;
    const cutoff = caffeineCutoff({
      doses: data.doses,
      bedtimeInstant: data.bedtime_at,
      nowInstant: referenceMs,
      halfLifeHours: data.half_life_hours,
      thresholdMg: data.threshold_mg,
      doseMg: data.cutoff_dose_mg,
    });
    if (cutoff.kind !== 'by' && cutoff.kind !== 'passed') return null;
    return new Date(cutoff.at).getTime();
  }, [data, referenceMs]);

  // Recomputed from the same doses, so the words and the curve cannot drift.
  const crossingAt = useMemo(
    () =>
      data
        ? thresholdCrossingTime(
            data.doses,
            data.half_life_hours,
            data.threshold_mg
          )
        : null,
    [data]
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Always render once placed: see the note in DailyHealthMetricsCard. The
  // Diary layout is user-arranged, so an empty day is reported rather than
  // silently collapsing the tile and reflowing the grid.
  if (!data || data.doses.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold">
            {t('diary.caffeine.title', 'Caffeine Kinetics')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            {t('diary.caffeine.empty', 'No caffeine logged for this day.')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const {
    half_life_hours,
    target_bedtime,
    doses,
    at_bedtime_mg,
    latest_safe_dose_time,
    cutoff_state,
    cutoff_dose_mg,
    threshold_mg,
    has_estimated_times,
  } = data;

  const currentActiveMg = activeCaffeineAt(doses, referenceMs, half_life_hours);

  // A long half-life against a small headroom can push the cutoff a day or
  // more into the past, outside the plotted window. The marker is already
  // hidden there; the legend must go with it, because it prints a bare HH:MM
  // that would read as a time today.
  const cutoffInWindow =
    cutoffMs !== null &&
    chart.length > 0 &&
    cutoffMs >= chart[0]!.t &&
    cutoffMs <= chart[chart.length - 1]!.t;

  const peakMg = chart.reduce((max, point) => Math.max(max, point.mg), 0);
  const yMax = Math.max(peakMg, threshold_mg) * 1.15;

  const getBedtimeBadge = (bedtimeMg: number) => {
    if (bedtimeMg < 25) {
      return (
        <Badge variant="secondary" className="bg-success/10 text-success">
          {t('diary.caffeine.sleepImpactMinimal', 'Minimal sleep impact')}
        </Badge>
      );
    }
    if (bedtimeMg < 50) {
      return (
        <Badge variant="secondary" className="bg-primary/10 text-primary">
          {t('diary.caffeine.sleepImpactLow', 'Low sleep impact')}
        </Badge>
      );
    }
    if (bedtimeMg < 100) {
      return (
        <Badge variant="secondary" className="bg-warning/10 text-warning">
          {t('diary.caffeine.sleepImpactModerate', 'Moderate sleep impact')}
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        {t('diary.caffeine.sleepImpactHigh', 'High sleep impact')}
      </Badge>
    );
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center space-x-2">
          <Coffee className="w-5 h-5 text-warning" />
          <CardTitle className="text-base font-medium">
            {t('diary.caffeine.activeCaffeine', 'Active Caffeine')}
          </CardTitle>
        </div>
        {has_estimated_times && (
          <Badge
            variant="outline"
            className="text-xs text-muted-foreground flex items-center gap-1"
          >
            <Info className="w-3 h-3" />
            {t('diary.caffeine.estimatedTimes', 'Estimated times')}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Stats Grid */}
        <div className="divide-y divide-border">
          {/* Active Now */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
            <span className="text-xs text-muted-foreground">
              {t('diary.caffeine.activeNow', 'Active Now')}
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-numeral font-bold text-warning">
                {Math.round(currentActiveMg)}
              </span>
              <span className="text-xs text-muted-foreground">mg</span>
            </div>
            <span className="text-xs text-muted-foreground mt-0.5">
              {t('diary.caffeine.halfLifeLabel', '{{hours}}h half-life', {
                hours: half_life_hours,
              })}
            </span>
          </div>

          {/* At Bedtime */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Moon className="w-3 h-3 text-primary" />
                {t('diary.caffeine.atBedtime', 'At Bedtime')} ({target_bedtime})
              </span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-xl font-numeral font-bold">
                {Math.round(at_bedtime_mg)}
              </span>
              <span className="text-xs text-muted-foreground">mg</span>
            </div>
            <div className="mt-1">{getBedtimeBadge(at_bedtime_mg)}</div>
          </div>

          {/* Bedtime Cutoff */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-3">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3 text-success" />
              {t('diary.caffeine.bedtimeCutoff', 'Last Coffee By')}
            </span>
            <div className="mt-1">
              {cutoff_state === 'by' && latest_safe_dose_time ? (
                <span className="text-xl font-numeral font-bold text-success">
                  {latest_safe_dose_time}
                </span>
              ) : cutoff_state === 'passed' ? (
                <span className="text-sm font-medium text-warning">
                  {t('diary.caffeine.cutoffPassed', 'Too late for another')}
                </span>
              ) : cutoff_state === 'over' ? (
                <span className="text-sm font-medium text-destructive">
                  {t('diary.caffeine.cutoffOver', 'Already over for tonight')}
                </span>
              ) : (
                <span className="text-sm font-medium text-muted-foreground">
                  {t('diary.caffeine.anytimeSafe', 'Any time')}
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground mt-0.5">
              {cutoff_state === 'over'
                ? t('diary.caffeine.cutoffOverDesc', {
                    defaultValue: 'Already past {{threshold}}mg at bedtime',
                    threshold: threshold_mg,
                  })
                : t('diary.caffeine.cutoffDesc', {
                    defaultValue: 'For a {{dose}}mg dose',
                    dose: Math.round(cutoff_dose_mg),
                  })}
            </span>
          </div>
        </div>

        {/* The curve: where the day has been and where it is heading.
            Evaluated client-side from the same doses the tiles use, so the
            chart and the numbers beside it cannot disagree. */}
        <div className="pt-1">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart
              data={chart}
              margin={{ top: 10, right: 10, left: -14, bottom: 0 }}
            >
              <defs>
                <linearGradient id="caffeineFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="hsl(var(--warning))"
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="100%"
                    stopColor="hsl(var(--warning))"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={trendChartTheme.grid.stroke}
                vertical={false}
              />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={
                  windowMs
                    ? [windowMs.start, windowMs.end]
                    : ['dataMin', 'dataMax']
                }
                ticks={ticks}
                tickFormatter={clockLabel}
                stroke={trendChartTheme.axis.fill}
                fontSize={11}
                minTickGap={30}
              />
              <YAxis
                domain={[0, Math.ceil(yMax)]}
                stroke={trendChartTheme.axis.fill}
                fontSize={11}
                width={38}
              />
              <Tooltip
                contentStyle={trendChartTheme.tooltip}
                labelFormatter={(value) => clockLabel(Number(value))}
                formatter={(
                  value:
                    string | number | ReadonlyArray<string | number> | undefined
                ) => [
                  `${Math.round(Number(value))} mg`,
                  t('diary.caffeine.activeCaffeine', 'Active Caffeine'),
                ]}
              />
              <Area
                type="monotone"
                dataKey="mg"
                stroke="hsl(var(--warning))"
                strokeWidth={2}
                fill="url(#caffeineFill)"
                isAnimationActive={false}
                dot={false}
              />
              <ReferenceLine
                y={threshold_mg}
                stroke={'hsl(var(--destructive))'}
                strokeDasharray="4 4"
              />
              <ReferenceLine
                x={bedtimeMs}
                stroke={'hsl(var(--primary))'}
                strokeDasharray="2 4"
              />
              {nowIsInWindow && (
                <ReferenceLine
                  x={nowMs}
                  stroke={'hsl(var(--muted-foreground))'}
                  strokeWidth={1}
                />
              )}
              {/* The moment another dose stops fitting under the threshold.
                  Hidden when it falls outside the plotted window rather than
                  clamped to the edge, which would put it at a time it is not. */}
              {cutoffInWindow && cutoffMs !== null && (
                <ReferenceLine
                  x={cutoffMs}
                  stroke={'hsl(var(--success))'}
                  strokeDasharray="3 3"
                  ifOverflow="hidden"
                />
              )}
              {/* A dose whose time was assumed rather than logged is drawn
                  hollow: the payload carries that per dose, and the card used
                  to say so only once, for the whole day. */}
              {doses
                .filter((dose) => {
                  if (!windowMs) return true;
                  const doseMs = new Date(dose.at).getTime();
                  return doseMs >= windowMs.start && doseMs <= windowMs.end;
                })
                .map((dose, idx) => {
                  const doseMs = new Date(dose.at).getTime();
                  return (
                    <ReferenceDot
                      // Time plus amount is not unique: the same drink logged
                      // twice at the same minute collides. Index it, as the dose
                      // list below already does.
                      key={`${dose.at}-${idx}`}
                      x={doseMs}
                      y={activeCaffeineAt(doses, doseMs, half_life_hours)}
                      r={4}
                      fill={
                        dose.is_estimated
                          ? 'transparent'
                          : 'hsl(var(--warning))'
                      }
                      stroke="hsl(var(--warning))"
                      strokeWidth={dose.is_estimated ? 1.5 : 1}
                      strokeDasharray={dose.is_estimated ? '2 2' : '0'}
                      ifOverflow="hidden"
                    />
                  );
                })}
            </AreaChart>
          </ResponsiveContainer>
          {/* Every mark on the plot is named here rather than labelled in
              place: in-plot labels were clipped by the top margin, and the
              "now" line had no label at all. */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1">
              <span className="h-[2px] w-4 rounded bg-warning/10" />
              {t('diary.caffeine.legendCurve', 'Active caffeine')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0 w-4 border-t-2 border-dashed border-destructive/30" />
              {t('diary.caffeine.legendThreshold', {
                defaultValue: '{{threshold}}mg sleep threshold',
                threshold: threshold_mg,
              })}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-0 border-l-2 border-dashed border-primary/30" />
              {t('diary.caffeine.legendBedtime', {
                defaultValue: 'Bedtime {{time}}',
                time: target_bedtime,
              })}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-0 border-l-2 border-border" />
              {t('diary.caffeine.legendNow', 'Now')}
            </span>
            {cutoffInWindow && cutoffMs !== null && (
              <span className="flex items-center gap-1">
                <span className="h-3 w-0 border-l-2 border-dashed border-success/30" />
                {t('diary.caffeine.legendCutoff', {
                  defaultValue: 'Last {{dose}}mg dose {{time}}',
                  dose: Math.round(cutoff_dose_mg),
                  time: clockLabel(cutoffMs),
                })}
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-warning/10" />
              {t('diary.caffeine.legendDose', 'Logged dose')}
            </span>
            {has_estimated_times && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full border border-dashed border-warning/30" />
                {t('diary.caffeine.legendEstimated', 'Assumed time')}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {crossingAt
              ? t('diary.caffeine.crossingNote', {
                  defaultValue: 'Back under {{threshold}}mg from {{time}}',
                  threshold: threshold_mg,
                  time: clockLabel(crossingAt),
                })
              : t('diary.caffeine.underThreshold', {
                  defaultValue: 'Stays under {{threshold}}mg tonight',
                  threshold: threshold_mg,
                })}
          </p>
        </div>

        {/* Dose list strip */}
        <div className="space-y-1.5 pt-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t('diary.caffeine.contributingDoses', 'Recent Doses (48h)')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {doses.map((dose, idx) => (
              <div
                key={`${dose.at}-${idx}`}
                className="text-xs px-3 py-1.5 rounded-full border flex items-center gap-1.5"
              >
                <span className="font-medium">{dose.name || 'Dose'}:</span>
                <span>{dose.mg}mg</span>
                <span className="text-xs text-muted-foreground">
                  (
                  {new Date(dose.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  )
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CaffeineCard;
