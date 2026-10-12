import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ProgramDraft } from './useProgramDraft';

export default function ProgramHeaderFields({
  draft,
  hasRecordedSessions,
  onChange,
}: {
  draft: ProgramDraft;
  hasRecordedSessions: boolean;
  onChange: (patch: Partial<ProgramDraft>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="program-name">
            {t('trainingPrograms.name', 'Program name')}
          </Label>
          <Input
            id="program-name"
            value={draft.name}
            maxLength={200}
            onChange={(e) => onChange({ name: e.target.value })}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="program-goal">
            {t('trainingPrograms.goal', 'Program goal')}
          </Label>
          <Textarea
            id="program-goal"
            value={draft.goal}
            maxLength={2000}
            onChange={(e) => onChange({ goal: e.target.value })}
            required
          />
        </div>
        <div>
          <Label htmlFor="program-start">
            {t('trainingPrograms.startDate', 'Program start date')}
          </Label>
          <Input
            id="program-start"
            type="date"
            value={draft.start_date}
            onChange={(e) => onChange({ start_date: e.target.value })}
            required
          />
        </div>
        <div>
          <Label htmlFor="program-end">
            {t('trainingPrograms.endDate', 'Program end date')}
          </Label>
          <Input
            id="program-end"
            type="date"
            value={draft.end_date}
            min={draft.start_date}
            onChange={(e) => onChange({ end_date: e.target.value })}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label
          className="flex min-h-11 items-center gap-3"
          htmlFor="program-auto-shift"
        >
          <input
            id="program-auto-shift"
            type="checkbox"
            className="h-5 w-5"
            checked={draft.auto_shift ?? false}
            onChange={(event) => onChange({ auto_shift: event.target.checked })}
          />
          {t('trainingPrograms.autoShift', 'Auto-shift after a miss')}
        </Label>
        <p className="max-w-prose text-sm text-muted-foreground">
          {t(
            'trainingPrograms.shiftHelp',
            'Off by default. Each new miss moves later still-planned sessions forward one calendar day, even beyond the authored week or Program. Same-day, missed and completed sessions stay unchanged.'
          )}
        </p>
        {hasRecordedSessions && (
          <p className="text-sm text-muted-foreground">
            {t(
              'trainingPrograms.historyHelp',
              'Recorded sessions and their containing weeks/phases cannot be removed. Their names, authored dates and Workout Plans are locked. Future authored date edits reset that session’s shifted date; other edits preserve the resulting schedule.'
            )}
          </p>
        )}
      </div>
    </>
  );
}
