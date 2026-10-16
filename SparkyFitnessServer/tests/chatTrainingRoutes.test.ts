import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
// @ts-expect-error supertest has no declaration in this workspace.
import request from 'supertest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { TrainingAnalysisScope } from '@workspace/shared';
const state = vi.hoisted(() => ({
  model: undefined as unknown,
  actor: 'owner',
  query: vi.fn(),
}));
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = 'owner';
    req.authenticatedUserId = state.actor;
    next();
  },
}));
vi.mock('../utils/adminCheck.js', () => ({
  resolveIsAdmin: vi.fn(async () => true),
}));
vi.mock('../models/chatRepository.js');
vi.mock('../models/measurementRepository.js');
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn(async () => 'UTC'),
}));
vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn(async () => ({ query: state.query, release: vi.fn() })),
}));
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() =>
    Object.assign(() => state.model, { chat: () => state.model })
  ),
}));
import chatRoutes from '../routes/chatRoutes.js';
import chatRepository from '../models/chatRepository.js';
import measurementRepository from '../models/measurementRepository.js';
const app = express();
app.use(express.json());
app.use('/api/chat', chatRoutes);
app.use(
  (
    error: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(error.status ?? 500).json({ error: error.message });
  }
);
const scope = {
  start_date: '2026-10-01',
  end_date: '2026-10-07',
  programs: false,
  test_types: ['cooper_run'],
  health_metrics: [],
};
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const textStep = {
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  content: [
    { type: 'text' as const, text: 'Your Cooper distance improved to 2400 m.' },
  ],
  warnings: [],
};
describe('authenticated training chat with mocked provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = 'owner';
    vi.mocked(chatRepository.getAiServiceSettingForBackend).mockResolvedValue({
      id: 'service',
      service_type: 'openai',
      api_key: 'mock',
      model_name: 'mock',
      source: 'user',
    });
    vi.mocked(chatRepository.saveChatHistory).mockResolvedValue(true);
    vi.mocked(measurementRepository.getCustomCategories).mockResolvedValue([]);
    state.query.mockResolvedValue({
      rows: [
        {
          id: 'attempt',
          test_type: 'cooper_run',
          attempt_date: '2026-10-02',
          results: { distance_meters: 2400 },
        },
      ],
    });
  });
  it('answers with selected data and no write/escalation tools or unrelated history', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          content: [
            {
              type: 'tool-call',
              toolCallId: 'read1',
              toolName: 'sparky_read_cardio_tests',
              input: '{}',
            },
          ],
          warnings: [],
        },
        textStep,
      ],
    });
    state.model = model;
    const response = await request(app)
      .post('/api/chat')
      .send({
        service_config_id: 'service',
        trainingAnalysis: scope,
        messages: [
          { role: 'user', content: 'Unrelated medical history' },
          { role: 'assistant', content: 'Sensitive earlier answer' },
          { role: 'user', content: 'How did my Cooper tests improve?' },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain('2400');
    const sent = model.doGenerateCalls[0]!;
    expect(sent.tools?.map((t) => t.name)).toEqual([
      'sparky_read_cardio_tests',
    ]);
    expect(JSON.stringify(sent.prompt)).not.toContain('Sensitive earlier');
    expect(JSON.stringify(sent.prompt)).not.toContain('Unrelated medical');
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('2400');
    expect(state.query.mock.calls[0]![1]).toEqual([
      'owner',
      '2026-10-01',
      '2026-10-07',
      ['cooper_run'],
    ]);
    expect(measurementRepository.getCustomCategories).not.toHaveBeenCalled();
  });
  it.each<{
    label: string;
    testTypes: TrainingAnalysisScope['test_types'];
    attemptDate: string;
  }>([
    { label: 'unchecked protocols', testTypes: [], attemptDate: '2026-10-02' },
    {
      label: 'out-of-range attempts',
      testTypes: ['ramp'],
      attemptDate: '2026-10-12',
    },
  ])(
    'never sends linked Test results to the provider for $label',
    async ({ testTypes, attemptDate }) => {
      const programId = '00000000-0000-4000-8000-000000000001';
      const phaseId = '00000000-0000-4000-8000-000000000002';
      const weekId = '00000000-0000-4000-8000-000000000003';
      const sessionId = '00000000-0000-4000-8000-000000000004';
      const attemptId = '00000000-0000-4000-8000-000000000005';
      state.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM training_programs'))
          return {
            rows: [
              {
                id: programId,
                user_id: 'owner',
                name: 'Build',
                goal: 'Fitness',
                start_date: '2026-10-01',
                end_date: '2026-10-07',
                schedule_type: 'fixed',
                auto_shift: false,
                created_at: new Date('2026-10-01T00:00:00Z'),
                updated_at: new Date('2026-10-01T00:00:00Z'),
              },
            ],
          };
        if (sql.includes('FROM training_program_phases'))
          return {
            rows: [
              {
                id: phaseId,
                program_id: programId,
                name: 'Base',
                goal: 'Consistency',
                sort_order: 0,
              },
            ],
          };
        if (sql.includes('FROM training_program_weeks'))
          return {
            rows: [
              {
                id: weekId,
                program_id: programId,
                phase_id: phaseId,
                start_date: '2026-10-01',
                end_date: '2026-10-07',
                sort_order: 0,
              },
            ],
          };
        if (sql.includes('FROM training_program_sessions'))
          return {
            rows: [
              {
                id: sessionId,
                program_id: programId,
                week_id: weekId,
                name: 'Ramp',
                scheduled_date: '2026-10-02',
                effective_date: '2026-10-02',
                status: 'completed',
                is_optional: false,
                outcome_at: new Date('2026-10-12T00:00:00Z'),
                completed_workout: null,
                workout_session_id: null,
                workout_session_name: null,
                workout_plan_id: null,
                workout_plan_name: null,
                cardio_test_type: 'ramp',
                sort_order: 0,
                completed_test_attempt: {
                  id: attemptId,
                  test_type: 'ramp',
                  attempt_date: attemptDate,
                  results: {
                    maximum_watts: 340,
                    peak_heart_rate: 180,
                    one_minute_heart_rate: 145,
                  },
                },
              },
            ],
          };
        if (sql.includes('FROM user_preferences'))
          return { rows: [{ timezone: 'UTC' }] };
        return { rows: [] };
      });
      const model = new MockLanguageModelV3({
        doGenerate: [
          {
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage,
            content: [
              {
                type: 'tool-call',
                toolCallId: 'program-read',
                toolName: 'sparky_read_training_programs',
                input: '{}',
              },
            ],
            warnings: [],
          },
          textStep,
        ],
      });
      state.model = model;
      const response = await request(app)
        .post('/api/chat')
        .send({
          service_config_id: 'service',
          trainingAnalysis: { ...scope, programs: true, test_types: testTypes },
          messages: [
            { role: 'user', content: 'Summarize my Program outcomes' },
          ],
        });
      expect(response.status).toBe(200);
      expect(model.doGenerateCalls).toHaveLength(2);
      const providerPrompt = JSON.stringify(model.doGenerateCalls[1]!.prompt);
      expect(providerPrompt).toContain(attemptId);
      expect(providerPrompt).toContain('completed');
      expect(providerPrompt).not.toContain('maximum_watts');
      expect(providerPrompt).not.toContain('peak_heart_rate');
      expect(providerPrompt).not.toContain('one_minute_heart_rate');
    }
  );
  it.each([
    [
      'extra owner field',
      { ...scope, user_id: 'other' },
      [{ role: 'user', content: 'Analyze' }],
    ],
    [
      'oversized range',
      { ...scope, start_date: '2020-01-01' },
      [{ role: 'user', content: 'Analyze' }],
    ],
    [
      'no selected sources',
      { ...scope, test_types: [] },
      [{ role: 'user', content: 'Analyze' }],
    ],

    [
      'invalid range',
      { ...scope, end_date: '2025-01-01' },
      [{ role: 'user', content: 'Analyze' }],
    ],
    ['no user query', scope, [{ role: 'assistant', content: 'Analyze' }]],
  ])(
    'rejects %s before contacting the provider',
    async (_name, trainingAnalysis, messages) => {
      const model = new MockLanguageModelV3({ doGenerate: textStep });
      state.model = model;
      const response = await request(app)
        .post('/api/chat')
        .send({ service_config_id: 'service', trainingAnalysis, messages });
      expect(response.status).toBe(400);
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(state.query).not.toHaveBeenCalled();
    }
  );
  it('cannot execute an existing mutation even when the provider attempts it', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage,
          content: [
            {
              type: 'tool-call',
              toolCallId: 'bad1',
              toolName: 'sparky_manage_workout_plans',
              input:
                '{"action":"delete_workout_plan","plan_id":1,"confirmed":true}',
            },
          ],
          warnings: [],
        },
        {
          ...textStep,
          content: [
            { type: 'text', text: 'Analysis cannot change your records.' },
          ],
        },
      ],
    });
    state.model = model;
    const response = await request(app)
      .post('/api/chat')
      .send({
        service_config_id: 'service',
        trainingAnalysis: scope,
        messages: [{ role: 'user', content: 'Analyze and delete my plan' }],
      });
    expect(response.status).toBe(200);
    expect(response.body.content).toContain('cannot change');
    expect(state.query).not.toHaveBeenCalled();
    expect(model.doGenerateCalls[0]!.tools?.map((t) => t.name)).toEqual([
      'sparky_read_cardio_tests',
    ]);
  });

  it('streams an answer through the existing web endpoint with the same read-only ceiling', async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't1' },
            {
              type: 'text-delta',
              id: 't1',
              delta: 'Consider an easier training day.',
            },
            { type: 'text-end', id: 't1' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage,
            },
          ],
        }),
      }),
    });
    state.model = model;
    const response = await request(app)
      .post('/api/chat/stream')
      .send({
        service_config_id: 'service',
        trainingAnalysis: scope,
        toolCategories: ['exercise', 'food'],
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'Suggest my next training focus' }],
          },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.text).toContain('Consider an easier training day.');
    expect(model.doStreamCalls[0]!.tools?.map((t) => t.name)).toEqual([
      'sparky_read_cardio_tests',
    ]);
    expect(state.query).not.toHaveBeenCalled();
  });
  it('keeps ordinary App Store chat tool selection when analysis is absent', async () => {
    const model = new MockLanguageModelV3({ doGenerate: textStep });
    state.model = model;
    const response = await request(app)
      .post('/api/chat')
      .send({
        service_config_id: 'service',
        toolCategories: ['exercise'],
        messages: [{ role: 'user', content: 'Log a workout' }],
      });
    expect(response.status).toBe(200);
    expect(model.doGenerateCalls[0]!.tools?.map((t) => t.name)).toContain(
      'sparky_manage_workout_plans'
    );
    expect(model.doGenerateCalls[0]!.tools?.map((t) => t.name)).not.toContain(
      'sparky_read_cardio_tests'
    );
  });

  it('rejects acting-user requests', async () => {
    state.actor = 'delegate';
    const response = await request(app)
      .post('/api/chat')
      .send({
        service_config_id: 'service',
        trainingAnalysis: scope,
        messages: [{ role: 'user', content: 'Analyze' }],
      });
    expect(response.status).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
});
