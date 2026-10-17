import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Edit,
  Trash2,
  History,
  Plus,
  MoreHorizontal,
  ClipboardCopy,
  PlusCircle,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import EnhancedFoodSearch from '../../components/FoodSearch/FoodSearch';
import { usePreferences } from '@/contexts/PreferencesContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { debug } from '@/utils/logging';
import {
  getNutrientMetadata,
  formatNutrientValue,
} from '@/utils/nutrientUtils';
import { useCopyFoodEntriesFromYesterdayMutation } from '@/hooks/Diary/useFoodEntries';
import type { Food, FoodEntry, GlycemicIndex } from '@/types/food';
import type { Meal, FoodEntryMeal } from '@/types/meal';
import { formatTimeOfDayString } from '@/utils/timeFormatters';
interface MealTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  dietary_fiber: number;
  sugars?: number;
  sodium?: number;
  cholesterol?: number;
  saturated_fat?: number;
  monounsaturated_fat?: number;
  polyunsaturated_fat?: number;
  trans_fat?: number;
  potassium?: number;
  vitamin_a?: number;
  vitamin_c?: number;
  iron?: number;
  caffeine_mg?: number;
  water_ml?: number;
  alcohol_g?: number;
  calcium?: number;
  glycemic_index?: GlycemicIndex;
  custom_nutrients?: Record<string, number>;
}

import type { UserCustomNutrient } from '@/types/customNutrient';
import { DEFAULT_NUTRIENTS } from '@/constants/nutrients';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import AllergenBadges from '@/components/AllergenBadges';
import { diaryEntryImages, usableFoodImages } from '@/utils/foodImages';
import { useImageLightbox } from '@/hooks/Foods/useImageLightbox';
import ImageLightbox from '@/components/ImageLightbox';

const MOBILE_ENTRY_NUTRIENT_LIMIT = 4;

const MOBILE_NUTRIENT_LABEL_OVERRIDES: Record<
  string,
  { label: string; defaultLabel: string }
> = {
  carbs: { label: 'nutrition.carbs', defaultLabel: 'Carbs' },
  dietary_fiber: { label: 'nutrition.fiber', defaultLabel: 'Fiber' },
};

interface MealCardProps {
  meal: {
    name: string;
    type: string;
    entries: (FoodEntry | FoodEntryMeal)[];
    targetCalories?: number;
    selectedDate: string;
  };
  totals: MealTotals;
  selectedDate: string;
  onFoodSelect: (item: Food | Meal, mealType: string) => void;
  onEditEntry: (entry: FoodEntry | FoodEntryMeal) => void;
  onRemoveEntry: (
    itemId: string,
    itemType: 'foodEntry' | 'foodEntryMeal'
  ) => Promise<void>;
  getEntryNutrition: (entry: FoodEntry | FoodEntryMeal) => MealTotals;
  onCopyClick: (mealType: string) => void;
  onCopyFamilyClick: (mealType: string) => void;
  onConvertToMealClick: (mealType: string) => void;
  energyUnit: 'kcal' | 'kJ';
  convertEnergy: (
    value: number,
    fromUnit: 'kcal' | 'kJ',
    toUnit: 'kcal' | 'kJ'
  ) => number;
  customNutrients?: UserCustomNutrient[]; // Add customNutrients prop
  shouldOpenFoodSearch?: boolean;
  onFoodSearchClose?: () => void;
}

const MealCard = ({
  meal,
  totals,
  onFoodSelect,
  onEditEntry,
  onRemoveEntry,
  getEntryNutrition,
  onCopyClick,
  onCopyFamilyClick,
  onConvertToMealClick,
  energyUnit,
  convertEnergy,
  shouldOpenFoodSearch,
  onFoodSearchClose,
  selectedDate,
  customNutrients = [], // Default to empty array
}: MealCardProps) => {
  const { t } = useTranslation();
  const {
    loggingLevel,
    nutrientDisplayPreferences,
    getDateRelationToToday,
    timeFormat,
  } = usePreferences();
  const isMobile = useIsMobile();
  const platform = isMobile ? 'mobile' : 'desktop';

  const selectedDateRelation = getDateRelationToToday(selectedDate);

  const [internalFoodSearchOpen, setInternalFoodSearchOpen] = useState(false);
  // One viewer for the whole card; the clicked row supplies its own images.
  const { lightboxProps, openLightbox } = useImageLightbox();

  // Check if food search is open to handle state changes
  const isFoodSearchOpen = shouldOpenFoodSearch || internalFoodSearchOpen;

  const handleFoodSearchOpenChange = (open: boolean) => {
    setInternalFoodSearchOpen(open);
    if (!open && onFoodSearchClose) {
      onFoodSearchClose();
    }
  };
  const [searchParams] = useSearchParams();
  const highlightFoodId = searchParams.get('highlight') ?? null;
  const { mutate: copyFoodEntriesFromYesterday } =
    useCopyFoodEntriesFromYesterdayMutation();
  const getEnergyUnitString = (unit: 'kcal' | 'kJ'): string => {
    return unit === 'kcal'
      ? t('common.kcalUnit', 'kcal')
      : t('common.kJUnit', 'kJ');
  };
  debug(loggingLevel, 'MealCard: Component rendered for meal:', meal.name);
  debug(loggingLevel, 'MealCard: meal.entries:', meal.entries);
  const [editingFood, setEditingFood] = useState<Food | null>(null); // Changed from editingFoodEntry to editingFood

  const quickInfoPreferences =
    nutrientDisplayPreferences.find(
      (p) => p.view_group === 'quick_info' && p.platform === platform
    ) ||
    nutrientDisplayPreferences.find(
      (p) => p.view_group === 'quick_info' && p.platform === 'desktop'
    );
  const foodDatabasePreferences =
    nutrientDisplayPreferences.find(
      (p) => p.view_group === 'food_database' && p.platform === platform
    ) ||
    nutrientDisplayPreferences.find(
      (p) => p.view_group === 'food_database' && p.platform === 'desktop'
    );

  // Create a base list of summable nutrients
  const baseSummableNutrients = [
    'calories',
    'protein',
    'carbs',
    'fat',
    'dietary_fiber',
    'sugars',
    'sodium',
    'cholesterol',
    'saturated_fat',
    'monounsaturated_fat',
    'polyunsaturated_fat',
    'trans_fat',
    'potassium',
    'vitamin_a',
    'vitamin_c',
    'iron',
    'calcium',
    'caffeine_mg',
    // Summable like the rest: a meal states the water it holds. The hydration
    // ring still owns the day total, which is computed from its own arm.
    'water_ml',
    'alcohol_g',
  ];

  // Add custom nutrient names to summable nutrients list if they exist
  const summableNutrients = [
    ...baseSummableNutrients,
    ...customNutrients
      .filter((cn) => !baseSummableNutrients.includes(cn.name))
      .map((cn) => cn.name),
  ];

  const quickInfoNutrients = quickInfoPreferences
    ? quickInfoPreferences.visible_nutrients
    : DEFAULT_NUTRIENTS;

  debug(loggingLevel, 'MealCard: isMobile:', isMobile);
  debug(loggingLevel, 'MealCard: platform:', platform);
  debug(loggingLevel, 'MealCard: quickInfoPreferences:', quickInfoPreferences);
  debug(
    loggingLevel,
    'MealCard: foodDatabasePreferences:',
    foodDatabasePreferences
  );

  const visibleNutrientsForGrid = quickInfoNutrients.filter((nutrient) =>
    summableNutrients.includes(nutrient)
  );

  const handleCopyFromYesterday = () => {
    copyFoodEntriesFromYesterday({
      mealType: meal.type,
      targetDate: selectedDate,
    });
  };

  return (
    <>
      <Card className="border-x-0 rounded-none">
        <CardHeader className="px-1 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <CardTitle className="text-base font-semibold text-foreground">
                {meal.name}
              </CardTitle>
              <span className="text-xs sm:text-sm text-muted-foreground">
                {Math.round(convertEnergy(totals.calories, 'kcal', energyUnit))}
                {!!meal.targetCalories && (
                  <span>{` / ${Math.round(
                    convertEnergy(meal.targetCalories, 'kcal', energyUnit)
                  )}`}</span>
                )}
                {getEnergyUnitString(energyUnit)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Dialog
                open={isFoodSearchOpen}
                onOpenChange={handleFoodSearchOpenChange}
              >
                <DialogTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      debug(
                        loggingLevel,
                        `MealCard: Add Food button clicked for ${meal.name}.`
                      )
                    }
                    title={t('mealCard.addFoodTo', 'Add Food to')}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-6xl max-h-[85dvh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>
                      {t('mealCard.addFoodToMeal', {
                        mealName: t(`common.${meal.type}`, meal.name),
                        defaultValue: `Add Food to ${t(
                          `common.${meal.type}`,
                          meal.name
                        )}`,
                      })}
                    </DialogTitle>
                    <DialogDescription>
                      {t('mealCard.searchFoodsForMeal', {
                        mealName: t(
                          `common.${meal.type}`,
                          meal.name
                        ).toLowerCase(),
                        defaultValue: `Search for foods to add to your ${t(
                          `common.${meal.type}`,
                          meal.name
                        ).toLowerCase()}.`,
                      })}
                      <br />
                      <span className="text-destructive">
                        {(selectedDateRelation === 'past' &&
                          t(
                            'foodDiary.pastDateWarning',
                            'Warning: You are adding food entries for a past date.'
                          )) ||
                          (selectedDateRelation === 'future' &&
                            t(
                              'foodDiary.futureDateWarning',
                              'Warning: You are adding food entries for a future date.'
                            )) ||
                          ''}
                      </span>
                    </DialogDescription>
                  </DialogHeader>
                  <div className="[&_.bg-card]:rounded-none [&_.bg-card]:border-x-0 [&_.bg-card]:border-t-0 [&_.bg-card]:bg-transparent [&_.bg-card:hover]:bg-muted">
                    <EnhancedFoodSearch
                      mealType={meal.type}
                      onFoodSelect={(item, type) => {
                        if (type === 'food') {
                          debug(
                            loggingLevel,
                            'MealCard: Food selected in search:',
                            item
                          );
                          onFoodSelect(item as Food, meal.type);
                        } else {
                          debug(
                            loggingLevel,
                            'MealCard: Meal selected in search:',
                            item
                          );
                          onFoodSelect(item as Meal, meal.type);
                        }
                      }}
                    />
                  </div>
                </DialogContent>
              </Dialog>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={t('diary.mealActions', 'Meal actions')}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onCopyClick(meal.type)}>
                    <ClipboardCopy className="size-4" />
                    {t('diary.copyAllToDate', 'Copy entire day to date')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onCopyFamilyClick(meal.type)}
                  >
                    <Users className="size-4" />
                    {t('diary.copyFamilyTitle', 'Copy Food with Family')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleCopyFromYesterday}>
                    <History className="size-4" />
                    {t('diary.copyAllFromYesterday', 'Copy all from yesterday')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onConvertToMealClick(meal.type)}
                  >
                    <PlusCircle className="size-4" />
                    {t('mealCreation.convertToMeal', 'Create Meal from Diary')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-1 pb-3 sm:px-5">
          {meal.entries.length === 0 ? (
            <div className="py-3 text-sm text-muted-foreground">
              {t('foodDiary.noFoodsAddedYet', 'No foods added yet')}
            </div>
          ) : (
            <div className="space-y-0 md:space-y-3">
              {meal.entries.map((item) => {
                // Changed entry to item
                const entryNutrition = getEntryNutrition(item);
                const isFoodEntryMeal = 'foods' in item && 'entry_date' in item; // More robust check for FoodEntryMeal
                const isFoodEntry = !isFoodEntryMeal;
                const isFromMealPlan =
                  isFoodEntry && (item as FoodEntry).meal_plan_template_id;
                const entryName = isFoodEntryMeal
                  ? (item as FoodEntryMeal).name
                  : (item as FoodEntry).food_name;
                const entryDescription = isFoodEntryMeal
                  ? (item as FoodEntryMeal).description
                  : (item as FoodEntry).brand_name;
                const quantity = (item as FoodEntry | FoodEntryMeal).quantity;
                const unit = (item as FoodEntry | FoodEntryMeal).unit;
                const servingLabel = [quantity, unit]
                  .filter((value) => value !== undefined && value !== null)
                  .join(' ');
                const entryIsHighlighted =
                  'food_id' in item &&
                  (item as FoodEntry).food_id === highlightFoodId;
                // Food entries: per-entry override, else the food's own image.
                // Logged meals: the meal template's image.
                const entryImages = isFoodEntry
                  ? diaryEntryImages(item as FoodEntry)
                  : (() => {
                      const override = usableFoodImages(
                        (item as FoodEntryMeal).images
                      );
                      return override.length > 0
                        ? override
                        : usableFoodImages((item as FoodEntryMeal).meal_images);
                    })();
                const entryImageSrc = entryImages[0] ?? null;

                // Determine glycemic index directly from the entryNutrition object
                const giValue: GlycemicIndex | undefined | null =
                  entryNutrition.glycemic_index ?? null;
                const validGiValues: GlycemicIndex[] = [
                  'Very Low',
                  'Low',
                  'Medium',
                  'High',
                  'Very High',
                ];

                debug(
                  loggingLevel,
                  `MealCard: Rendering item: ${
                    isFoodEntryMeal
                      ? (item as FoodEntryMeal).name
                      : (item as FoodEntry).food_name
                  }, GI Value: ${giValue}, quickInfoNutrients includes GI: ${quickInfoNutrients.includes(
                    'glycemic_index'
                  )}, giValue is valid: ${
                    giValue != null &&
                    validGiValues.includes(giValue as GlycemicIndex)
                  }`
                );

                const getNutrientDisplay = (nutrient: string) => {
                  const metadata = getNutrientMetadata(
                    nutrient,
                    customNutrients
                  );
                  const value =
                    (entryNutrition[nutrient as keyof MealTotals] as number) ??
                    entryNutrition.custom_nutrients?.[nutrient] ??
                    0;

                  const displayValue =
                    nutrient === 'calories'
                      ? Math.round(
                          convertEnergy(value, 'kcal', energyUnit)
                        ).toString()
                      : formatNutrientValue(nutrient, value, customNutrients);

                  const unitDisplay =
                    nutrient === 'calories'
                      ? getEnergyUnitString(energyUnit)
                      : metadata.unit;

                  return { metadata, displayValue, unitDisplay };
                };

                const mobileCalories = visibleNutrientsForGrid.includes(
                  'calories'
                )
                  ? getNutrientDisplay('calories')
                  : null;
                const mobileNutrients = visibleNutrientsForGrid
                  .filter((nutrient) => nutrient !== 'calories')
                  .slice(0, MOBILE_ENTRY_NUTRIENT_LIMIT);

                if (isMobile) {
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'relative border-t border-border py-3 pr-11',
                        entryIsHighlighted && 'ring-2 ring-primary rounded-lg'
                      )}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium leading-snug text-card-foreground">
                            {entryName}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            {entryDescription && (
                              <span className="break-words">
                                {entryDescription}
                              </span>
                            )}
                            {entryDescription && servingLabel && (
                              <span aria-hidden="true">&bull;</span>
                            )}
                            {servingLabel && <span>{servingLabel}</span>}
                            {item.entry_time && (
                              <>
                                <span aria-hidden="true">&bull;</span>
                                <span className="text-muted-foreground">
                                  {formatTimeOfDayString(
                                    item.entry_time,
                                    timeFormat
                                  )}
                                </span>
                              </>
                            )}
                            {isFromMealPlan && (
                              <Badge variant="outline" className="text-xs">
                                {t('mealCard.fromPlan', 'From Plan')}
                              </Badge>
                            )}
                            {giValue &&
                              validGiValues.includes(
                                giValue as GlycemicIndex
                              ) &&
                              quickInfoNutrients.includes('glycemic_index') && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs font-medium"
                                >
                                  GI: {giValue}
                                </Badge>
                              )}
                          </div>
                          {isFoodEntry && (
                            <AllergenBadges
                              allergens={(item as FoodEntry).allergens}
                              traces={(item as FoodEntry).traces}
                            />
                          )}
                        </div>
                        {mobileCalories && (
                          <div className="text-right">
                            <div
                              className={cn(
                                'text-lg font-semibold tabular-nums leading-none text-foreground'
                              )}
                            >
                              {mobileCalories.displayValue}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {mobileCalories.unitDisplay}
                            </div>
                          </div>
                        )}
                      </div>

                      {mobileNutrients.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {mobileNutrients.map((nutrient) => {
                            const { metadata, displayValue, unitDisplay } =
                              getNutrientDisplay(nutrient);
                            const label =
                              MOBILE_NUTRIENT_LABEL_OVERRIDES[nutrient] ??
                              metadata;
                            return (
                              <span key={nutrient}>
                                {t(label.label, label.defaultLabel)}{' '}
                                {displayValue}
                                {unitDisplay}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="absolute right-0 top-2 size-11 text-muted-foreground"
                            aria-label={t('diary.foodEntryActions', {
                              name: entryName,
                              defaultValue: 'Actions for {{name}}',
                            })}
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="min-h-11"
                            onSelect={() => onEditEntry(item)}
                          >
                            <Edit className="size-4" />
                            {t('common.edit', 'Edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="min-h-11"
                            onSelect={() => {
                              void onRemoveEntry(
                                item.id,
                                isFoodEntryMeal ? 'foodEntryMeal' : 'foodEntry'
                              );
                            }}
                          >
                            <Trash2 className="size-4" />
                            {t('common.delete', 'Delete')}
                          </DropdownMenuItem>
                          {entryImageSrc && (
                            <DropdownMenuItem
                              className="min-h-11"
                              onSelect={() =>
                                openLightbox(
                                  entryImages,
                                  0,
                                  entryName ?? undefined
                                )
                              }
                            >
                              {t('food.viewImages', 'View images')}
                            </DropdownMenuItem>
                          )}
                          {visibleNutrientsForGrid.some(
                            (nutrient) =>
                              nutrient !== 'calories' &&
                              !mobileNutrients.includes(nutrient)
                          ) && (
                            <>
                              <DropdownMenuSeparator />
                              {visibleNutrientsForGrid
                                .filter(
                                  (nutrient) =>
                                    nutrient !== 'calories' &&
                                    !mobileNutrients.includes(nutrient)
                                )
                                .map((nutrient) => {
                                  const {
                                    metadata,
                                    displayValue,
                                    unitDisplay,
                                  } = getNutrientDisplay(nutrient);
                                  return (
                                    <DropdownMenuLabel
                                      key={nutrient}
                                      className="flex justify-between gap-4 font-normal text-muted-foreground"
                                    >
                                      <span>
                                        {t(
                                          metadata.label,
                                          metadata.defaultLabel
                                        )}
                                      </span>
                                      <span>
                                        {displayValue} {unitDisplay}
                                      </span>
                                    </DropdownMenuLabel>
                                  );
                                })}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                }

                return (
                  <div
                    key={item.id} // Use item.id directly
                    className={cn(
                      'flex flex-col sm:flex-row sm:items-center justify-between py-3 border-t border-border gap-4',
                      entryIsHighlighted && 'ring-2 ring-primary rounded-lg'
                    )}
                  >
                    {entryImageSrc && (
                      <button
                        type="button"
                        className="flex-shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={() =>
                          openLightbox(entryImages, 0, entryName ?? undefined)
                        }
                        aria-label={t('food.viewImages', 'View images')}
                      >
                        <img
                          src={entryImageSrc}
                          alt={entryName ?? ''}
                          className="w-16 h-16 object-cover rounded-md cursor-zoom-in"
                          loading="lazy"
                          onError={(e) => {
                            // A dead provider link shouldn't leave a broken icon.
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1">
                        <span className="font-medium">{entryName}</span>
                        {entryDescription ? (
                          <Badge variant="secondary" className="text-xs w-fit">
                            {entryDescription}
                          </Badge>
                        ) : null}
                        <span className="text-sm text-muted-foreground">
                          {servingLabel}
                        </span>
                        {item.entry_time && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                            {formatTimeOfDayString(item.entry_time, timeFormat)}
                          </span>
                        )}
                        {isFromMealPlan && (
                          <Badge variant="outline" className="text-xs w-fit">
                            {t('mealCard.fromPlan', 'From Plan')}
                          </Badge>
                        )}
                        {giValue &&
                          validGiValues.includes(giValue as GlycemicIndex) &&
                          quickInfoNutrients.includes('glycemic_index') && (
                            <Badge
                              variant="secondary"
                              className="text-xs w-fit font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary dark:bg-transparent"
                            >
                              GI: {giValue}
                            </Badge>
                          )}
                      </div>
                      <div
                        className="grid gap-x-4 gap-y-2 text-xs sm:text-sm mt-2 w-full"
                        style={{
                          gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? '60px' : '80px'}, 1fr))`,
                        }}
                      >
                        {visibleNutrientsForGrid.map((nutrient) => {
                          const { metadata, displayValue, unitDisplay } =
                            getNutrientDisplay(nutrient);

                          return (
                            <div
                              key={nutrient}
                              className="text-right min-w-[60px]"
                            >
                              <div className="font-medium text-muted-foreground">
                                {displayValue} {unitDisplay}
                              </div>
                              <div className="text-xs sm:text-xs text-muted-foreground">
                                {t(metadata.label, metadata.defaultLabel)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {isFoodEntry && (
                        <AllergenBadges
                          allergens={(item as FoodEntry).allergens}
                          traces={(item as FoodEntry).traces}
                        />
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          debug(
                            loggingLevel,
                            'MealCard: Edit entry button clicked:',
                            item.id
                          );
                          onEditEntry(item); // Pass the item directly
                        }}
                        title={t('common.edit', 'Edit')}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          debug(
                            loggingLevel,
                            'MealCard: Remove entry button clicked:',
                            item.id
                          );
                          onRemoveEntry(
                            item.id,
                            isFoodEntryMeal ? 'foodEntryMeal' : 'foodEntry'
                          );
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}

              <Separator />

              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-2 gap-4">
                <span className="font-semibold text-muted-foreground">
                  {t('mealCard.mealTotal', {
                    mealName: t(`common.${meal.type}`, meal.name),
                    defaultValue: `${meal.name} Total:`,
                  })}
                </span>
                <dl className="grid w-full grid-cols-1 gap-x-6 text-xs md:grid-cols-2 md:text-sm">
                  {visibleNutrientsForGrid.map((nutrient) => {
                    const metadata = getNutrientMetadata(
                      nutrient,
                      customNutrients
                    );
                    const val = totals[nutrient as keyof MealTotals];
                    const value =
                      (typeof val === 'number' || typeof val === 'string'
                        ? val
                        : totals.custom_nutrients?.[nutrient]) ?? 0;

                    const displayValue =
                      nutrient === 'calories'
                        ? Math.round(
                            convertEnergy(Number(value), 'kcal', energyUnit)
                          ).toString()
                        : formatNutrientValue(nutrient, value, customNutrients);

                    const unitDisplay =
                      nutrient === 'calories'
                        ? getEnergyUnitString(energyUnit)
                        : metadata.unit;

                    return (
                      <div
                        key={nutrient}
                        className="flex min-w-0 items-baseline justify-between gap-4 border-b py-1.5 last:border-0"
                      >
                        <dt className="min-w-0 break-words text-muted-foreground">
                          {t(metadata.label, metadata.defaultLabel)}
                        </dt>
                        <dd className="shrink-0 font-medium tabular-nums">
                          {displayValue} {unitDisplay}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Food Database Dialog */}
      {editingFood && (
        <Dialog
          open={true}
          onOpenChange={(open) => !open && setEditingFood(null)}
        >
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {t('mealCard.editFoodDatabase', 'Edit Food Database')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'mealCard.editFoodDatabaseDescription',
                  'Edit the nutritional information for this food in your database.'
                )}
              </DialogDescription>
            </DialogHeader>
            <p className="text-destructive">
              {t(
                'mealCard.editingTemporarilyUnavailable',
                'Editing food details is temporarily unavailable due to schema changes.'
              )}
            </p>
          </DialogContent>
        </Dialog>
      )}
      <ImageLightbox {...lightboxProps} />
    </>
  );
};

export default MealCard;
