import type { TFunction } from 'i18next';

export function cardioTestTitle(protocol: string, t: TFunction): string {
  switch (protocol) {
    case 'cooper_run':
      return t('cardioTests.cooper.title', 'Cooper Run Test');
    case 'sprint_6s':
      return t(
        'cardioTests.sprint_6s.title',
        '5 × 6-second sprint (54-second rests)'
      );
    case 'power_30s':
      return t(
        'cardioTests.power_30s.title',
        '2 × 30-second power (60-second rest)'
      );
    case 'ramp':
      return t('cardioTests.ramp.title', 'Ramp Test');
    default:
      return t('cardioTests.title', 'Cardio Tests');
  }
}
