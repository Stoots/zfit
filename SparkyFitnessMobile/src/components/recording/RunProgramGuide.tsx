import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Icon from '../Icon';
import { programName } from './RunProgramCard';

/** What the weeks of a program look like, in a sentence or two. */
export function programStructure(t: TFunction, id: string): string {
  switch (id) {
    case 'beginner5k':
      return t('runPrograms.guide.structure.beginner5k', {
        defaultValue:
          'Weeks 1 to 4 alternate short runs with walks, starting at 1 minute of running and building to 5-minute runs. Weeks 5 and 6 mix run and walk intervals with one continuous run. Weeks 7 to 9 are continuous runs of 25, 28 and then 30 minutes.',
      });
    case 'walkFit':
      return t('runPrograms.guide.structure.walkFit', {
        defaultValue:
          'Weeks 1 to 4 alternate stretches of brisk walking (3 to 8 minutes) with 2 minutes of easy walking. Weeks 5 and 6 use two longer brisk stretches of 12 and 15 minutes. Weeks 7 and 8 are continuous brisk walks of 20 to 30 minutes.',
      });
    case 'fiveToTenK':
      return t('runPrograms.guide.structure.fiveToTenK', {
        defaultValue:
          'Each week has two steady runs and a long run. The long run grows from 40 to 65 minutes. Every fourth week is lighter so you can recover, and the last week eases off.',
      });
    case 'faster5k':
      return t('runPrograms.guide.structure.faster5k', {
        defaultValue:
          'Each week has a speed session (fast and easy repeats), an easy run and a longer run. In weeks 1 to 3 the longer run is easy; in weeks 4 to 6 it becomes a tempo run of 15, 20 and then 25 minutes.',
      });
    case 'halfMarathon':
      return t('runPrograms.guide.structure.halfMarathon', {
        defaultValue:
          'Each week has an easy run, a middle run and a long run. The long run builds from 50 to 115 minutes, every fourth week is lighter, and the last week is short before race day.',
      });
    case 'marathon':
      return t('runPrograms.guide.structure.marathon', {
        defaultValue:
          'Most weeks have two easy runs, a middle run and a long run. The long run builds from 70 minutes to 2¾ hours, every fourth week is lighter, and the last two weeks taper before race day.',
      });
    default:
      return '';
  }
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <View className="mt-3">
    <Text className="text-text-primary text-sm font-semibold">{title}</Text>
    <Text className="text-text-secondary text-sm mt-1">{children}</Text>
  </View>
);

/**
 * "How the plans work": what a workout is made of, how hard each part should
 * feel, and what pace to walk at. Effort-based on purpose, since the same pace
 * is easy for one person and hard for another.
 */
const RunProgramGuide: React.FC<{
  /** The program being followed, to describe its weeks as well. */
  programId?: string;
  defaultOpen?: boolean;
}> = ({ programId, defaultOpen = false }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const title = t('runPrograms.guide.title', {
    defaultValue: 'How the plans work',
  });

  return (
    <View className="bg-surface rounded-xl p-4 mt-4" testID="run-program-guide">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        className="flex-row items-center justify-between"
      >
        <Text className="text-text-primary text-base font-semibold">
          {title}
        </Text>
        <Icon
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={18}
          color="#999"
        />
      </Pressable>
      {open ? (
        <View>
          {programId ? (
            <Section title={programName(t, programId)}>
              {programStructure(t, programId)}
            </Section>
          ) : null}
          <Section
            title={t('runPrograms.guide.workout.title', {
              defaultValue: 'Each workout',
            })}
          >
            {t('runPrograms.guide.workout.body', {
              defaultValue:
                'A workout starts with a warm-up walk (a gentle jog before speed sessions), then its steps in order, then a cool-down walk. The app tells you when to switch, so you can put your phone away. Weeks are not tied to the calendar: if you miss a workout, the same one stays due.',
            })}
          </Section>
          <Section
            title={t('runPrograms.guide.run.title', {
              defaultValue: 'How hard to run',
            })}
          >
            {t('runPrograms.guide.run.body', {
              defaultValue:
                'Go by effort, not pace. Run slowly enough that you could talk in short sentences. If you cannot, slow down or take a walk break early. Beginner runs should feel easy to moderate, around 4 to 5 out of 10. Easy runs stay conversational, tempo runs feel comfortably hard (about 6 to 7 out of 10), and the fast pieces in speed sessions feel hard but controlled (7 to 8 out of 10), with the easy pieces between them a relaxed jog.',
            })}
          </Section>
          <Section
            title={t('runPrograms.guide.walk.title', {
              defaultValue: 'How fast to walk',
            })}
          >
            {t('runPrograms.guide.walk.body', {
              defaultValue:
                'Walk briskly but comfortably, about 5 to 6 km/h (3 to 3.5 mph), which is roughly 10 to 12 minutes per kilometer or 16 to 19 minutes per mile. Keep moving rather than stopping: the walks are for getting your breath back, so you should be able to talk normally by the end of each one. The warm-up and cool-down walks can be a little easier.',
            })}
          </Section>
          <Section
            title={t('runPrograms.guide.listen.title', {
              defaultValue: 'Listening to your body',
            })}
          >
            {t('runPrograms.guide.listen.body', {
              defaultValue:
                'Aches that settle after a day are normal; sharp or lasting pain is not, so stop and rest. If a week was too hard, repeat it or ask Sparky to ease the next workouts. Leave a rest day between workouts while you are starting out. This is general guidance, not medical advice: if you are unsure about starting a new exercise plan, check with your doctor first.',
            })}
          </Section>
        </View>
      ) : null}
    </View>
  );
};

export default RunProgramGuide;
