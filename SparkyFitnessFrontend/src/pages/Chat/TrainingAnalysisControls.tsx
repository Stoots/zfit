import { useTranslation } from 'react-i18next';
import {
  type TrainingAnalysisScope,
  TRAINING_HEALTH_METRICS,
  cardioTestTypeSchema,
} from '@workspace/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useTrainingProgramsList } from '@/hooks/TrainingPrograms/useTrainingPrograms';

export function TrainingAnalysisControls({
  enabled,
  onEnabledChange,
  scope,
  onScopeChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  scope: TrainingAnalysisScope;
  onScopeChange: (scope: TrainingAnalysisScope) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: programs } = useTrainingProgramsList(
    user?.id,
    enabled && scope.programs
  );
  return (
    <div className="border-b px-4 py-3 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="training-analysis">
          {t('chat.trainingAnalysis.title')}
        </Label>
        <Switch
          id="training-analysis"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
      {enabled && (
        <details className="mt-3" open>
          <summary className="cursor-pointer text-sm">
            {t('chat.trainingAnalysis.scope')}
          </summary>
          <div className="mt-3 max-h-60 overflow-y-auto space-y-3 pr-2">
            <p className="text-sm text-muted-foreground">
              {t('chat.trainingAnalysis.description')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <Label htmlFor="analysis-start">
                  {t('chat.trainingAnalysis.start')}
                </Label>
                <Input
                  id="analysis-start"
                  type="date"
                  value={scope.start_date}
                  onChange={(e) =>
                    onScopeChange({ ...scope, start_date: e.target.value })
                  }
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor="analysis-end">
                  {t('chat.trainingAnalysis.end')}
                </Label>
                <Input
                  id="analysis-end"
                  type="date"
                  value={scope.end_date}
                  onChange={(e) =>
                    onScopeChange({ ...scope, end_date: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id="analysis-programs"
                checked={scope.programs}
                onCheckedChange={(checked) =>
                  onScopeChange({ ...scope, programs: checked === true })
                }
              />
              <Label htmlFor="analysis-programs">
                {t('chat.trainingAnalysis.programs')}
              </Label>
            </div>
            {scope.programs && (
              <label className="block text-sm">
                {t('chat.trainingAnalysis.program')}
                <select
                  className="mt-1 block w-full min-h-11 rounded-md border bg-background px-3 text-foreground"
                  value={scope.program_id ?? ''}
                  onChange={(e) =>
                    onScopeChange({
                      ...scope,
                      program_id: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">
                    {t('chat.trainingAnalysis.allPrograms')}
                  </option>
                  {programs?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <fieldset>
              <legend className="text-sm font-medium">
                {t('chat.trainingAnalysis.tests')}
              </legend>
              <div className="grid grid-cols-2 gap-x-4">
                {cardioTestTypeSchema.options.map((protocol) => (
                  <div
                    key={protocol}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <Checkbox
                      id={`analysis-${protocol}`}
                      checked={scope.test_types.includes(protocol)}
                      onCheckedChange={(checked) =>
                        onScopeChange({
                          ...scope,
                          test_types:
                            checked === true
                              ? [...scope.test_types, protocol]
                              : scope.test_types.filter((p) => p !== protocol),
                        })
                      }
                    />
                    <Label htmlFor={`analysis-${protocol}`}>
                      {t(`chat.trainingAnalysis.${protocol}`)}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium">
                {t('chat.trainingAnalysis.health')}
              </legend>
              {TRAINING_HEALTH_METRICS.map((metric) => (
                <div key={metric} className="flex min-h-11 items-center gap-3">
                  <Checkbox
                    id={`analysis-${metric}`}
                    checked={scope.health_metrics.includes(metric)}
                    onCheckedChange={(checked) =>
                      onScopeChange({
                        ...scope,
                        health_metrics:
                          checked === true
                            ? [...scope.health_metrics, metric]
                            : scope.health_metrics.filter((m) => m !== metric),
                      })
                    }
                  />
                  <Label htmlFor={`analysis-${metric}`}>
                    {t(`chat.trainingAnalysis.${metric}`)}
                  </Label>
                </div>
              ))}
            </fieldset>
          </div>
        </details>
      )}
    </div>
  );
}
