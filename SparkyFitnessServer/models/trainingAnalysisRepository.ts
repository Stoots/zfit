import type { PoolClient } from 'pg';
import type {
  CardioTestAttempts,
  TrainingAnalysisScope,
} from '@workspace/shared';
import { getClient } from '../db/poolManager.js';

const CUSTOM_CATEGORIES: Record<
  TrainingAnalysisScope['health_metrics'][number],
  string[]
> = {
  total_steps: [],
  total_distance_meters: ['distance', 'Distance'],
  active_calories: [],
  resting_heart_rate: ['resting_heart_rate', 'RestingHeartRate'],
  vo2_max: ['vo2_max', 'Vo2Max'],
  heart_rate: [
    'heart_rate',
    'HeartRate',
    'heart_rate_min',
    'heart_rate_max',
    'heart_rate_avg',
  ],
  hrv: [
    'HRV',
    'HRV_SDNN',
    'HeartRateVariabilitySDNN',
    'HRV_SDNN_min',
    'HRV_SDNN_max',
    'HRV_SDNN_avg',
  ],
};

const DAILY_COLUMNS = new Set([
  'total_steps',
  'total_distance_meters',
  'active_calories',
  'resting_heart_rate',
  'vo2_max',
]);

export async function readTrainingHealth(
  userId: string,
  scope: TrainingAnalysisScope
) {
  const client: PoolClient = await getClient(userId, userId);
  try {
    const rows: Record<string, unknown>[] = [];
    let truncated = false;
    const daily = scope.health_metrics.filter((m) => DAILY_COLUMNS.has(m));
    if (daily.length) {
      const result = await client.query<Record<string, unknown>>(
        `SELECT entry_date::text, source_provider, ${daily.join(', ')}
         FROM daily_health_metrics WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
         AND lower(source_provider) IN ('healthkit', 'apple_health')
         AND (${daily.map((m) => `${m} IS NOT NULL`).join(' OR ')}) ORDER BY entry_date, source_provider LIMIT 1001`,
        [userId, scope.start_date, scope.end_date]
      );
      truncated ||= result.rows.length > 1000;
      rows.push(...result.rows.slice(0, 1000));
    }
    const samples = scope.health_metrics.filter(
      (m) => m === 'heart_rate' || m === 'hrv'
    );
    if (samples.length) {
      const result = await client.query<Record<string, unknown>>(
        `SELECT entry_date::text, source_provider, metric, value.key AS method,
           COUNT(*)::int AS count, AVG(value.value::numeric) AS mean,
           MIN(value.value::numeric) AS min, MAX(value.value::numeric) AS max
         FROM health_metric_samples
         CROSS JOIN LATERAL jsonb_array_elements(samples) AS sample
         CROSS JOIN LATERAL jsonb_each_text(sample) AS value
         WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3 AND metric = ANY($4::text[])
           AND lower(source_provider) IN ('healthkit', 'apple_health')
           AND ((metric = 'heart_rate' AND value.key = 'bpm')
             OR (metric = 'hrv' AND value.key IN ('sdnn_ms', 'rmssd_ms')))
         GROUP BY entry_date, source_provider, metric, value.key
         ORDER BY entry_date, source_provider, metric, value.key LIMIT 3001`,
        [userId, scope.start_date, scope.end_date, samples]
      );
      truncated ||= result.rows.length > 3000;
      rows.push(...result.rows.slice(0, 3000));
    }
    const categories = scope.health_metrics.flatMap(
      (m) => CUSTOM_CATEGORIES[m]
    );
    if (categories.length) {
      const result = await client.query<Record<string, unknown>>(
        `SELECT cm.entry_date::text, cm.source AS source_provider, cc.name AS category,
           cc.measurement_type AS unit, COUNT(*)::int AS count,
           AVG(cm.value::numeric) AS mean, MIN(cm.value::numeric) AS min, MAX(cm.value::numeric) AS max
         FROM custom_measurements cm JOIN custom_categories cc ON cc.id = cm.category_id AND cc.user_id = cm.user_id
         WHERE cm.user_id = $1 AND cm.entry_date BETWEEN $2 AND $3 AND cc.name = ANY($4::text[])
           AND lower(cm.source) IN ('healthkit', 'apple_health') AND cc.data_type = 'numeric'
           AND cm.value ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'
         GROUP BY cm.entry_date, cm.source, cc.name, cc.measurement_type
         ORDER BY cm.entry_date, cc.name, cm.source LIMIT 3001`,
        [userId, scope.start_date, scope.end_date, categories]
      );
      truncated ||= result.rows.length > 3000;
      rows.push(...result.rows.slice(0, 3000));
    }
    if (scope.health_metrics.includes('active_calories')) {
      const result = await client.query<Record<string, unknown>>(
        `SELECT entry_date::text, source AS source_provider, calories_burned AS active_calories
         FROM exercise_entries WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
           AND lower(source) IN ('healthkit', 'apple_health') AND exercise_name = 'Active Calories'
           AND duration_minutes = 0 AND exercise_preset_entry_id IS NULL AND source_id IS NULL
         ORDER BY entry_date, id LIMIT 1001`,
        [userId, scope.start_date, scope.end_date]
      );
      truncated ||= result.rows.length > 1000;
      rows.push(...result.rows.slice(0, 1000));
    }
    return {
      rows,
      truncated,
      units: {
        total_steps: 'steps',
        total_distance_meters: 'm',
        active_calories: 'kcal',
        resting_heart_rate: 'bpm',
        vo2_max: 'mL/kg/min',
        heart_rate: 'bpm',
        hrv: 'ms (SDNN and RMSSD kept separate)',
      },
    };
  } finally {
    client.release();
  }
}

export async function readTrainingAttempts(
  userId: string,
  scope: TrainingAnalysisScope
) {
  const client: PoolClient = await getClient(userId, userId);
  try {
    const result = await client.query<
      Pick<
        CardioTestAttempts,
        'id' | 'test_type' | 'attempt_date' | 'results' | 'planned_session_id'
      >
    >(
      `SELECT id, test_type, attempt_date::text, results, planned_session_id
       FROM cardio_test_attempts WHERE user_id = $1 AND attempt_date BETWEEN $2 AND $3
       AND test_type = ANY($4::text[]) ORDER BY attempt_date, id LIMIT 501`,
      [userId, scope.start_date, scope.end_date, scope.test_types]
    );
    return {
      attempts: result.rows.slice(0, 500),
      truncated: result.rows.length > 500,
    };
  } finally {
    client.release();
  }
}
