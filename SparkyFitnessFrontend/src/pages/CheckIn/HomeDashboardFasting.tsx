import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Numeral } from '@/components/ui/numeral';
import { StatRows } from '@/components/ui/stat-rows';
import { Progress } from '@/components/ui/progress';
import { Play, Timer, Square, Sparkles, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FASTING_PRESETS } from '@/constants/fastingPresets';
import { parseISO, addHours, differenceInMinutes, format } from 'date-fns';
import EndFastDialog from '../Fasting/EndFastDialog';
import FastingZoneBar from '../Fasting/FastingZoneBar';
import EatingWindowBar from '../Fasting/EatingWindowBar';
import {
  useCurrentFast,
  useEndFastMutation,
  useFastingStats,
  useStartFastMutation,
} from '@/hooks/Fasting/useFasting';

const HomeDashboardFasting = () => {
  const { t } = useTranslation();

  const [showStartDialog, setShowStartDialog] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('16-8');
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [startLocal, setStartLocal] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());

  const formatForLocalInput = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const {
    data: activeFast,
    isLoading,
    refetch: refetchCurrentFast,
  } = useCurrentFast();
  const { mutateAsync: startFast } = useStartFastMutation();
  const { mutate: endFast } = useEndFastMutation();

  useEffect(() => {
    if (!activeFast) return;
    const interval = setInterval(
      () => {
        setNow(Date.now());
      },
      activeFast.is_eating_window ? 10000 : 1000
    );
    return () => clearInterval(interval);
  }, [activeFast]);

  const dynamicEatingRemainingMinutes = useMemo(() => {
    if (!activeFast?.is_eating_window) return 0;
    if (activeFast.target_end_time) {
      const targetMs = parseISO(activeFast.target_end_time).getTime();
      return Math.max(0, Math.floor((targetMs - now) / 60000));
    }
    return activeFast.eating_window_remaining_minutes ?? 0;
  }, [activeFast, now]);

  useEffect(() => {
    if (activeFast?.is_eating_window && activeFast.target_end_time) {
      const targetMs = parseISO(activeFast.target_end_time).getTime();
      if (now >= targetMs) {
        void refetchCurrentFast();
      }
    }
  }, [now, activeFast, refetchCurrentFast]);

  const { data: stats } = useFastingStats();
  const averageDurationMinutes = Number(stats?.average_duration_minutes ?? 0);
  const averageDurationHours = Number.isFinite(averageDurationMinutes)
    ? Math.round(averageDurationMinutes / 60)
    : 0;

  if (isLoading) return <Card className="h-64 animate-pulse" />;

  const handleStartFast = async () => {
    const preset = FASTING_PRESETS.find((p) => p.id === selectedPresetId);
    if (!preset) return;

    const start = startLocal ? new Date(startLocal) : new Date();
    const end = addHours(start, preset.fastingHours);

    await startFast({
      startTime: start,
      targetEndTime: end,
      fastingType: preset.name,
    });
    setShowStartDialog(false);
  };

  const handleEndFast = (
    start: Date,
    end: Date,
    weight?: number,
    mood?: { value: number; notes: string }
  ) => {
    if (!activeFast) return;
    endFast({
      id: activeFast.id,
      startTime: start,
      endTime: end,
      weight: weight,
      mood: mood,
    });
  };
  const formatDuration = () => {
    if (!activeFast) return '';
    const mins = differenceInMinutes(
      new Date(),
      parseISO(activeFast.start_time)
    );
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const elapsedMs = activeFast
    ? Math.max(0, now - parseISO(activeFast.start_time).getTime())
    : 0;
  const fastDurationHours = elapsedMs / (1000 * 60 * 60);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsed = [
    Math.floor(elapsedSeconds / 3600),
    Math.floor((elapsedSeconds % 3600) / 60),
    elapsedSeconds % 60,
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
  const progress = activeFast?.target_end_time
    ? Math.min(
        100,
        Math.max(
          0,
          (elapsedMs /
            Math.max(
              1,
              parseISO(activeFast.target_end_time).getTime() -
                parseISO(activeFast.start_time).getTime()
            )) *
            100
        )
      )
    : 0;

  return (
    <Card className="flex min-w-0 flex-col h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-xl">
          <div className="flex items-center gap-2">
            <Timer className="w-5 h-5 text-primary" />
            {t('fasting.checklistTitle', 'Fasting Timer')}
          </div>
          {activeFast?.is_eating_window ? (
            <Badge
              variant="secondary"
              className="flex items-center gap-1 text-xs bg-success/10 text-success border-success/20"
            >
              <Sparkles className="w-3 h-3" />
              {t('fasting.eatingWindowOpen', 'Eating Window Open')}
            </Badge>
          ) : (
            activeFast?.is_auto_calculated && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-xs bg-primary/10 text-primary border-primary/20"
              >
                <Sparkles className="w-3 h-3" />
                {t('fasting.autoFromMeals', 'Auto (from meals)')}
              </Badge>
            )
          )}
        </CardTitle>
        <CardDescription>
          {activeFast
            ? activeFast.is_eating_window
              ? t('fasting.eatingWindowDescription', {
                  defaultValue: `Eating window open · ${Math.floor((activeFast.eating_window_remaining_minutes ?? 0) / 60)}h ${(activeFast.eating_window_remaining_minutes ?? 0) % 60}m remaining (closes at ${activeFast.target_end_time ? format(parseISO(activeFast.target_end_time), 'h:mm a') : ''})`,
                  remaining: `${Math.floor((activeFast.eating_window_remaining_minutes ?? 0) / 60)}h ${(activeFast.eating_window_remaining_minutes ?? 0) % 60}m`,
                  endTime: activeFast.target_end_time
                    ? format(parseISO(activeFast.target_end_time), 'h:mm a')
                    : '',
                })
              : activeFast.is_auto_calculated && activeFast.start_meal_name
                ? t('fasting.currentlyFastingAfterMeal', {
                    meal: activeFast.start_meal_name,
                    defaultValue: `Fasting since ${activeFast.start_meal_name}`,
                  })
                : t('fasting.currentlyFasting', 'You are currently fasting')
            : t('fasting.readyToStart', 'Ready to start a new fast?')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-6">
        <div className="flex flex-col items-center justify-center">
          {activeFast && activeFast.is_eating_window ? (
            <div className="flex flex-col items-center justify-center py-2 text-center space-y-4 w-full">
              <Numeral
                value={`${Math.floor(dynamicEatingRemainingMinutes / 60)}h ${dynamicEatingRemainingMinutes % 60}m`}
                size="lg"
                subline={t(
                  'fasting.remainingInEatingWindow',
                  'Remaining in your eating window'
                )}
              />

              {/* Eating Window Color Bands Bar */}
              {activeFast.start_time && activeFast.target_end_time && (
                <div className="w-full px-2">
                  <EatingWindowBar
                    startTime={activeFast.start_time}
                    targetEndTime={activeFast.target_end_time}
                    remainingMinutes={dynamicEatingRemainingMinutes}
                  />
                </div>
              )}

              <p className="text-xs text-muted-foreground max-w-xs">
                {t(
                  'fasting.eatingWindowHint',
                  'Fasting will automatically resume after your eating window closes.'
                )}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartLocal(formatForLocalInput(new Date()));
                  setShowStartDialog(true);
                }}
                className="text-xs"
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                {t('fasting.startFastEarly', 'Start Fasting Now')}
              </Button>
            </div>
          ) : activeFast &&
            activeFast.start_time &&
            activeFast.target_end_time ? (
            <div className="w-full space-y-4 py-4">
              <Numeral
                value={elapsed}
                size="lg"
                subline={
                  progress >= 100
                    ? t('checkIn.fastingGoalReached', 'Goal reached')
                    : `${Math.round(progress)}%`
                }
              />
              <Progress
                value={progress}
                aria-label={t('fasting.checklistTitle', 'Fasting Timer')}
                className="h-1"
              />
            </div>
          ) : (
            <div className="text-center space-y-4 py-4">
              <Button
                onClick={() => {
                  setStartLocal(formatForLocalInput(new Date()));
                  setShowStartDialog(true);
                }}
                className="w-full gap-2 font-semibold"
              >
                <Play className="w-4 h-4" />
                {t('fasting.startFast', 'Start Fast')}
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        {activeFast && !activeFast.is_eating_window && (
          <>
            <div className="w-full">
              <FastingZoneBar
                hoursFasted={fastDurationHours}
                startTime={activeFast.start_time}
                targetEndTime={activeFast.target_end_time}
              />
            </div>

            <Button
              variant="destructive"
              size="lg"
              onClick={() => setShowEndDialog(true)}
              className="w-full"
            >
              <Square className="w-4 h-4 mr-2 fill-current" />
              {t('fasting.endFast', 'End Fast')}
            </Button>
          </>
        )}

        {/* Mini Stats Row */}
        {stats && (
          <StatRows
            rows={[
              {
                id: 'total',
                label: t('fasting.totalFasts', 'Total Fasts'),
                value: stats.total_completed_fasts,
              },
              {
                id: 'average',
                label: t('fasting.avgDuration', 'Avg Duration'),
                value: t('fasting.hoursShort', {
                  count: averageDurationHours,
                  defaultValue: `${averageDurationHours}h`,
                }),
              },
            ]}
          />
        )}
      </CardContent>

      {/* Start Fast Dialog */}
      <Dialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('homeFasting.startNew', 'Start a New Fast')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'homeFasting.description',
                'Select a protocol to begin your fast.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('homeFasting.startTime', 'Start Time')}</Label>
              <Input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('homeFasting.protocol', 'Fasting Protocol')}</Label>
              <Select
                value={selectedPresetId}
                onValueChange={setSelectedPresetId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FASTING_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.fastingHours}:{p.eatingHours})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {
                  FASTING_PRESETS.find((p) => p.id === selectedPresetId)
                    ?.description
                }
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStartDialog(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleStartFast}>
              {t('homeFasting.start', 'Start Fasting')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EndFastDialog
        isOpen={showEndDialog}
        onClose={() => setShowEndDialog(false)}
        durationFormatted={formatDuration()}
        initialStartISO={activeFast?.start_time ?? null}
        initialEndISO={new Date().toISOString()}
        onEnd={(start, end, weight, mood) => {
          handleEndFast(start, end, weight, mood);
        }}
      />
    </Card>
  );
};

export default HomeDashboardFasting;
