import { describe, expect, it, vi } from 'vitest';
import exerciseEntryDb from '../models/exerciseEntry.js';
import type { WorkoutPlanPresetSnapshot } from '@workspace/shared';
import { getClient } from '../db/poolManager.js';
import type { PoolClient } from 'pg';

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(),
  getSystemClient: vi.fn(),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));

describe('authorized frozen diary exercise metadata', () => {
  it.each([true, false])(
    'preserves frozen nullable metadata with source visibility %s',
    async (visible) => {
      const exerciseId = '11111111-1111-4111-8111-111111111111';
      const frozen: WorkoutPlanPresetSnapshot['exercises'][number] = {
        id: 1,
        exercise_id: exerciseId,
        exercise_name: 'Original Press',
        category: null,
        modality: 'weight_reps',
        image_url: null,
        superset_group: null,
        calories_per_hour: 300,
        force: null,
        level: 'intermediate',
        mechanic: 'compound',
        equipment: ['Dumbbell'],
        primary_muscles: ['Chest'],
        secondary_muscles: [],
        instructions: ['Per side'],
        images: ['frozen-exercise.png'],
        sets: [],
      };
      let stored: Record<string, unknown> = {};
      let metadataReads = 0;
      const client = {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
          if (sql === 'SELECT id FROM exercises WHERE id = $1') {
            return { rows: visible ? [{ id: exerciseId }] : [] };
          }
          if (sql.includes('FROM exercises WHERE id')) {
            metadataReads++;
            return {
              rows: [
                {
                  name: 'Renamed Cardio',
                  category: 'Cardio',
                  modality: 'cardio',
                },
              ],
            };
          }
          if (sql.startsWith('INSERT INTO exercise_entries')) {
            const columns = sql
              .slice(sql.indexOf('(') + 1, sql.indexOf(')'))
              .split(',')
              .map((column) => column.trim());
            stored = Object.fromEntries(
              columns.map((column, index) => [column, params[index]])
            );
            stored.id = 'saved-entry';
            return { rows: [{ id: 'saved-entry' }] };
          }
          return { rows: [stored] };
        }),
        release: vi.fn(),
      };
      const result = await exerciseEntryDb._createExerciseEntryWithClient(
        client,
        'owner',
        {
          exercise_id: exerciseId,
          exercise_name: 'Forged draft label',
          entry_date: '2026-10-11',
          workout_plan_assignment_id: 52,
          sets: [],
          duration_minutes: 5,
          calories_burned: 25,
        },
        'actor',
        'Workout Plan',
        'saved-parent',
        { frozenExerciseSnapshot: frozen }
      );
      expect(result.entry).toMatchObject({
        exercise_id: visible ? exerciseId : null,
        exercise_name: 'Original Press',
        category: null,
        modality: 'weight_reps',
        force: null,
        level: 'intermediate',
        equipment: ['Dumbbell'],
        instructions: ['Per side'],
        primary_muscles: ['Chest'],
        secondary_muscles: [],
        images: ['frozen-exercise.png'],
        calories_per_hour: 300,
        duration_minutes: 5,
        calories_burned: 25,
        created_by_user_id: 'actor',
        workout_plan_assignment_id: 52,
        exercise_preset_entry_id: 'saved-parent',
      });
      expect(metadataReads).toBe(0);
    }
  );
});

describe('legacy grouped diary timing', () => {
  it.each([600, null])(
    'returns persisted parent timing with cap %s',
    async (cap) => {
      const client = {
        query: vi.fn(async (sql: string) => ({
          rows: sql.includes('FROM exercise_preset_entries')
            ? [
                {
                  id: 'saved-parent',
                  workout_preset_id: null,
                  name: 'A',
                  description: null,
                  notes: null,
                  source: 'Workout Plan',
                  created_at: '2026-10-11T10:00:00.000Z',
                  workout_format: 'emom',
                  time_cap_seconds: cap,
                },
              ]
            : [],
        })),
        release: vi.fn(),
      };
      // The legacy model only needs query/release from its scoped client.
      vi.mocked(getClient).mockResolvedValue(client as unknown as PoolClient);
      const diary = await exerciseEntryDb.getExerciseEntriesByDate(
        'owner',
        '2026-10-11'
      );
      expect(diary).toHaveLength(1);
      expect(diary[0]).toMatchObject({
        id: 'saved-parent',
        workout_format: 'emom',
        time_cap_seconds: cap,
      });
    }
  );
});
