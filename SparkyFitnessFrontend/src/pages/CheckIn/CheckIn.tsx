import { useAuth } from '@/hooks/useAuth';
import { useActiveUser } from '@/contexts/ActiveUserContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import SleepEntrySection from './SleepEntrySection';
import DayNavigator from '@/components/DayNavigator';
import { CheckInForm } from './CheckInForm';
import { RecentActivity } from './RecentActivity';
import { CheckInTopRow } from './CheckInTopRow';
import { useCheckInLogic } from '@/hooks/CheckIn/useCheckInLogic';
import { useSearchParams } from 'react-router-dom';
import { CheckInPhotos } from './CheckInPhotos';
import SymptomsPanel from '../Symptoms/SymptomsPanel';
import { useCheckInPhotoDates } from '@/hooks/CheckIn/useCheckInPhotos';
import { useState } from 'react';
import { EditFastDialog } from '../Fasting/EditFastDialog';
import { useUpdateFastMutation } from '@/hooks/Fasting/useFasting';
import { FastingLog } from '@/types/fasting';
import { CombinedMeasurement } from '@/types/checkin';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Timer,
  Activity,
  Moon,
  Camera,
  HeartPulse,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CheckInWeightTrend } from './CheckInWeightTrend';
import { MindfulnessSection } from './MindfulnessSection';

const CheckIn = () => {
  const { user } = useAuth();
  const { activeUserId } = useActiveUser();
  const { convertWeight, convertMeasurement } = usePreferences();

  const currentUserId = activeUserId || user?.id;

  const {
    bodyFatPercentage,
    boneMassKg,
    bodyWaterPercentage,
    muscleMassKg,
    bmr,
    customCategories,
    customNotes,
    customValues,
    customPlaceholders,
    handleCalculateBodyFat,
    handleDeleteMeasurementClick,
    handleSubmit,
    height,
    hips,
    loading,
    mood,
    moodNotes,
    moodTags,
    neck,
    placeholders,
    recentMeasurements,
    selectedDate,
    setBodyFatPercentage,
    setBoneMassKg,
    setBodyWaterPercentage,
    setMuscleMassKg,
    setBmr,
    setCustomNotes,
    setCustomValues,
    setHeight,
    setHips,
    setMood,
    setMoodNotes,
    setMoodTags,
    setNeck,
    setSelectedDate,
    setSteps,
    setUseMostRecentForCalculation,
    setWaist,
    setWeight,
    shouldConvertCustomMeasurement,
    steps,
    useMostRecentForCalculation,
    waist,
    weight,
    handleSaveMood,
    isSavingMood,
  } = useCheckInLogic(currentUserId);

  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const photoDates = useCheckInPhotoDates();

  const [editingFast, setEditingFast] = useState<FastingLog | null>(null);
  const [isEditFastOpen, setIsEditFastOpen] = useState(false);
  const { mutateAsync: updateFast } = useUpdateFastMutation();

  const handleEditFastClick = (measurement: CombinedMeasurement) => {
    if (measurement.originalFast) {
      setEditingFast(measurement.originalFast);
      setIsEditFastOpen(true);
    }
  };

  const activeTab = searchParams.get('tab') || 'measurements';

  const handleTabChange = (value: string) => {
    setSearchParams((prev) => {
      prev.set('tab', value);
      return prev;
    });
  };

  return (
    <div className="min-w-0 space-y-6">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <div className="flex flex-col gap-4 mb-6 border-b pb-4">
          {/* Tab Selector on the Left */}
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl sm:grid-cols-3 lg:grid-cols-6">
            {[
              {
                id: 'measurements',
                label: t('checkIn.tabs.measurements', 'Measurements'),
                icon: Activity,
              },
              {
                id: 'fasting',
                label: t('checkIn.tabs.fasting', 'Fasting & Mood'),
                icon: Timer,
              },
              {
                id: 'mindfulness',
                label: t('checkIn.tabs.mindfulness', 'Mindfulness'),
                icon: Sparkles,
              },
              {
                id: 'sleep',
                label: t('checkIn.tabs.sleep', 'Sleep'),
                icon: Moon,
              },
              {
                id: 'photos',
                label: t('checkIn.tabs.photos', 'Photos'),
                icon: Camera,
              },
              {
                id: 'symptoms',
                label: t('checkIn.tabs.symptoms', 'Symptoms'),
                icon: HeartPulse,
              },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="min-h-11 min-w-0 gap-2 whitespace-normal px-3 text-sm"
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span>{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Date Filter on the Right */}
          <div className="order-first flex min-w-0 flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">
              {t('checkIn.title', 'Check-In')}
            </h1>
            <DayNavigator
              selectedDate={selectedDate}
              onDateChange={(dateString) => {
                setSelectedDate(dateString);
                setSearchParams((prev) => {
                  prev.set('date', dateString);
                  return prev;
                });
              }}
              markedDates={photoDates}
              markedDatesLabel={t(
                'checkIn.photos.calendarLegend',
                'Progress photos'
              )}
              className="grid-cols-none flex flex-wrap mb-0 items-center gap-2"
            />
          </div>
        </div>

        <TabsContent
          value="fasting"
          className="focus-visible:outline-none space-y-6"
        >
          <CheckInTopRow
            mood={mood}
            moodNotes={moodNotes}
            moodTags={moodTags}
            setMood={setMood}
            setMoodNotes={setMoodNotes}
            setMoodTags={setMoodTags}
            onSaveMood={handleSaveMood}
            isSavingMood={isSavingMood}
          />
          <RecentActivity
            convertMeasurement={convertMeasurement}
            convertWeight={convertWeight}
            handleDeleteMeasurementClick={handleDeleteMeasurementClick}
            recentMeasurements={recentMeasurements.filter(
              (m) => m.type === 'fasting'
            )}
            shouldConvertCustomMeasurement={shouldConvertCustomMeasurement}
            handleEditFastClick={handleEditFastClick}
            title={t('checkIn.recentFasts', 'Recent Fasts')}
            description={t(
              'checkIn.recentFastsDescription',
              'Your latest fasting logs and status.'
            )}
          />
        </TabsContent>

        <TabsContent
          value="measurements"
          className="focus-visible:outline-none space-y-6"
        >
          <CheckInForm
            bodyFatPercentage={bodyFatPercentage}
            boneMassKg={boneMassKg}
            bodyWaterPercentage={bodyWaterPercentage}
            muscleMassKg={muscleMassKg}
            bmr={bmr}
            customCategories={customCategories}
            customNotes={customNotes}
            customPlaceholders={customPlaceholders}
            customValues={customValues}
            handleCalculateBodyFat={handleCalculateBodyFat}
            handleSubmit={handleSubmit}
            height={height}
            hips={hips}
            loading={loading}
            neck={neck}
            placeholders={placeholders}
            setBodyFatPercentage={setBodyFatPercentage}
            setBoneMassKg={setBoneMassKg}
            setBodyWaterPercentage={setBodyWaterPercentage}
            setMuscleMassKg={setMuscleMassKg}
            setBmr={setBmr}
            setCustomNotes={setCustomNotes}
            setCustomValues={setCustomValues}
            setHeight={setHeight}
            setHips={setHips}
            setNeck={setNeck}
            setSteps={setSteps}
            setUseMostRecentForCalculation={setUseMostRecentForCalculation}
            setWaist={setWaist}
            setWeight={setWeight}
            shouldConvertCustomMeasurement={shouldConvertCustomMeasurement}
            steps={steps}
            useMostRecentForCalculation={useMostRecentForCalculation}
            waist={waist}
            weight={weight}
          />
          <CheckInWeightTrend
            selectedDate={selectedDate}
            photoDates={photoDates}
          />
          <RecentActivity
            convertMeasurement={convertMeasurement}
            convertWeight={convertWeight}
            handleDeleteMeasurementClick={handleDeleteMeasurementClick}
            recentMeasurements={recentMeasurements.filter(
              (m) => m.type === 'standard' || m.type === 'custom'
            )}
            shouldConvertCustomMeasurement={shouldConvertCustomMeasurement}
            title={t('checkIn.recentMeasurements', 'Recent Measurements')}
            description={t(
              'checkIn.recentMeasurementsDescription',
              'Your latest logged weight, body metrics, and custom categories.'
            )}
          />
        </TabsContent>

        <TabsContent value="mindfulness" className="focus-visible:outline-none">
          <MindfulnessSection selectedDate={selectedDate} />
        </TabsContent>

        <TabsContent value="sleep" className="focus-visible:outline-none">
          <SleepEntrySection key={selectedDate} selectedDate={selectedDate} />
        </TabsContent>

        <TabsContent value="photos" className="focus-visible:outline-none">
          <CheckInPhotos selectedDate={selectedDate} />
        </TabsContent>

        <TabsContent value="symptoms" className="focus-visible:outline-none">
          <SymptomsPanel
            selectedDate={selectedDate}
            onDateChange={(dateString) => {
              setSelectedDate(dateString);
              setSearchParams((prev) => {
                prev.set('date', dateString);
                return prev;
              });
            }}
          />
        </TabsContent>
      </Tabs>

      <EditFastDialog
        isOpen={isEditFastOpen}
        onClose={() => setIsEditFastOpen(false)}
        fast={editingFast}
        onSave={updateFast}
      />
    </div>
  );
};

export default CheckIn;
