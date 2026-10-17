import { MacroChips } from '@/components/ui/macro-chips';
import { Label } from '@/components/ui/label';
import {
  getNutrientMetadata,
  formatNutrientValue,
} from '@/utils/nutrientUtils';
import type { FoodVariant } from '@/types/food';
import { CalculatedNutrition } from '@/utils/nutritionCalculations';
import { UserCustomNutrient } from '@/types/customNutrient';
import { useTranslation } from 'react-i18next';
import { formatServingLabel } from '@/utils/foodServing';

interface NutrientGridProps {
  nutrition: CalculatedNutrition;
  customNutrients: UserCustomNutrient[];
  energyUnit: 'kcal' | 'kJ';
  convertEnergy: (
    value: number,
    from: 'kcal' | 'kJ',
    to: 'kcal' | 'kJ'
  ) => number;
  baseVariant: FoodVariant | null | undefined;
  visibleNutrients: string[];
}

export const NutrientGrid = ({
  nutrition,
  customNutrients,
  energyUnit,
  convertEnergy,
  baseVariant,
  visibleNutrients,
}: NutrientGridProps) => {
  const getEnergyUnitString = (unit: 'kcal' | 'kJ'): string => {
    return unit === 'kcal' ? 'kcal' : 'kJ';
  };
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
        {visibleNutrients.map((key) => {
          if (key === 'calories') {
            return (
              <div
                key="calories"
                className="flex items-center justify-between gap-3 border-b py-3"
              >
                <Label className="text-sm">
                  {t(
                    'diary.nutrientsGrid.calories2',
                    'Calories ({{energyUnitString}})',
                    { energyUnitString: getEnergyUnitString(energyUnit) }
                  )}
                </Label>
                <div className="text-base font-medium tabular-nums">
                  {Math.round(
                    convertEnergy(nutrition.calories, 'kcal', energyUnit)
                  )}
                </div>
              </div>
            );
          }

          const customNutrient = customNutrients.find((cn) => cn.name === key);
          if (customNutrient) {
            const value = nutrition.custom_nutrients?.[key] || 0;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 border-b py-3"
              >
                <Label className="text-sm">
                  {customNutrient.name} ({customNutrient.unit})
                </Label>
                <div className="text-base font-medium tabular-nums">
                  {formatNutrientValue(key, value, customNutrients)}
                </div>
              </div>
            );
          }

          if (key in nutrition && key !== 'custom_nutrients') {
            const meta = getNutrientMetadata(key, customNutrients);
            const value = nutrition[key as keyof CalculatedNutrition] as number;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 border-b py-3"
              >
                <Label className="text-sm">
                  {t(meta.label, { defaultValue: meta.defaultLabel })} (
                  {meta.unit})
                </Label>
                <div className="text-base font-medium tabular-nums">
                  {formatNutrientValue(key, value, customNutrients)}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {baseVariant && (
        <div className="bg-muted p-4 rounded-lg mt-4">
          <h4 className="font-medium mb-2">
            {t(
              'diary.nutrientsGrid.baseValuesPer2',
              'Base Values (per {{baseVariant}}):',
              {
                baseVariant: formatServingLabel(baseVariant),
              }
            )}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm">
            <div>
              {Math.round(
                convertEnergy(baseVariant.calories || 0, 'kcal', energyUnit)
              )}{' '}
              {getEnergyUnitString(energyUnit)}
            </div>
            <MacroChips
              protein={baseVariant.protein || 0}
              carbs={baseVariant.carbs || 0}
              fat={baseVariant.fat || 0}
            />
          </div>
        </div>
      )}
    </div>
  );
};
