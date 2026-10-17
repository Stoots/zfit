import { EnergyUnit } from '@/contexts/PreferencesContext';
import { UserCustomNutrient } from '@/types/customNutrient';
import { FoodVariant } from '@/types/food';
import { getGridClass } from '@/utils/layout';

import { useTranslation } from 'react-i18next';
interface NutrientGridProps {
  food: Partial<FoodVariant> | null;
  visibleNutrients: string[];
  energyUnit: EnergyUnit;
  convertEnergy: (value: number, from: EnergyUnit, to: EnergyUnit) => number;
  getEnergyUnitString: (unit: EnergyUnit) => string;
  customNutrients?: UserCustomNutrient[];
}

export const NutrientGrid = ({
  food,
  visibleNutrients,
  energyUnit,
  convertEnergy,
  getEnergyUnitString,
  customNutrients = [],
}: NutrientGridProps) => {
  const { t } = useTranslation();
  const nutrientDetails: {
    [key: string]: { color: string; label: string; unit: string };
  } = {
    calories: {
      color: 'bg-foreground',
      label: getEnergyUnitString(energyUnit),
      unit: '',
    },
    protein: {
      color: 'bg-protein',
      label: t('foodSearch.nutrientGrid.protein', 'protein'),
      unit: 'g',
    },
    carbs: {
      color: 'bg-carbs',
      label: t('foodSearch.nutrientGrid.carbs', 'carbs'),
      unit: 'g',
    },
    fat: {
      color: 'bg-fat',
      label: t('foodSearch.nutrientGrid.fat', 'fat'),
      unit: 'g',
    },
    dietary_fiber: {
      color: 'bg-nutrition',
      label: t('foodSearch.nutrientGrid.fiber', 'fiber'),
      unit: 'g',
    },
    sugars: {
      color: 'bg-carbs',
      label: t('foodSearch.nutrientGrid.sugar', 'sugar'),
      unit: 'g',
    },
    sodium: {
      color: 'bg-water',
      label: t('foodSearch.nutrientGrid.sodium', 'sodium'),
      unit: 'mg',
    },
    cholesterol: {
      color: 'bg-primary',
      label: t('foodSearch.nutrientGrid.cholesterol', 'cholesterol'),
      unit: 'mg',
    },
    saturated_fat: {
      color: 'bg-fat',
      label: t('foodSearch.nutrientGrid.satFat', 'sat fat'),
      unit: 'g',
    },
    trans_fat: {
      color: 'bg-fat',
      label: t('foodSearch.nutrientGrid.transFat', 'trans fat'),
      unit: 'g',
    },
    potassium: {
      color: 'bg-nutrition',
      label: t('foodSearch.nutrientGrid.potassium', 'potassium'),
      unit: 'mg',
    },
    vitamin_a: {
      color: 'bg-carbs',
      label: t('foodSearch.nutrientGrid.vitA', 'vit a'),
      unit: 'mcg',
    },
    vitamin_c: {
      color: 'bg-carbs',
      label: t('foodSearch.nutrientGrid.vitC', 'vit c'),
      unit: 'mg',
    },
    iron: {
      color: 'bg-muted-foreground',
      label: t('foodSearch.nutrientGrid.iron', 'iron'),
      unit: 'mg',
    },
    calcium: {
      color: 'bg-water',
      label: t('foodSearch.nutrientGrid.calcium', 'calcium'),
      unit: 'mg',
    },
    glycemic_index: {
      color: 'bg-primary',
      label: t('foodSearch.nutrientGrid.gi', 'GI'),
      unit: '',
    },
  };

  // Add custom nutrients to nutrientDetails
  customNutrients.forEach((cn: UserCustomNutrient) => {
    if (!nutrientDetails[cn.name]) {
      nutrientDetails[cn.name] = {
        color: 'bg-primary', // Default color for custom nutrients
        label: cn.name,
        unit: cn.unit,
      };
    }
  });

  return (
    <div
      className={`grid grid-cols-2 ${getGridClass(visibleNutrients.length)} gap-2 text-sm text-muted-foreground`}
    >
      {visibleNutrients.map((nutrient) => {
        const details = nutrientDetails[nutrient];
        if (!details) return null;

        const digits = nutrient === 'calories' ? 0 : 1;

        let displayValue: number | string;
        if (nutrient === 'calories') {
          const kcalValue = Number(
            (food?.[nutrient as keyof FoodVariant] as number) || 0
          );
          displayValue = Math.round(
            convertEnergy(kcalValue, 'kcal', energyUnit)
          );
        } else if (nutrient === 'glycemic_index') {
          displayValue = food?.glycemic_index || 'None';
        } else {
          let value = Number(food?.[nutrient as keyof FoodVariant] as number);

          if (isNaN(value) && food?.custom_nutrients) {
            const customVal = food.custom_nutrients[nutrient];
            if (customVal !== undefined) {
              value = Number(customVal);
            }
          }

          displayValue = (value || 0).toFixed(digits);
        }

        return (
          <div key={nutrient} className="min-w-0 break-words">
            <span
              aria-hidden="true"
              className={`inline-block size-1.5 shrink-0 rounded-full mr-1.5 align-middle ${details.color}`}
            />
            <span className="font-medium text-foreground">
              {displayValue}
              {details.unit}
            </span>{' '}
            {details.label}
          </div>
        );
      })}
    </div>
  );
};
