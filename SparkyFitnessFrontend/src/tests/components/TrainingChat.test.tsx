import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { UIMessage } from 'ai';

const mockToast = jest.fn();
let mockComposerType: 'thread' | 'edit' = 'thread';
let mockRunConfig: { custom?: Record<string, unknown> } = {};
const mockComposer = {
  getState: () => ({ runConfig: mockRunConfig }),
  setRunConfig: (config: typeof mockRunConfig) => {
    mockRunConfig = config;
  },
};
const mockAui = { composer: mockComposer };
jest.mock('@assistant-ui/react', () => ({
  useAui: () => mockAui,
  useAuiState: (
    selector: (state: {
      composer: {
        type: typeof mockComposerType;
        runConfig: typeof mockRunConfig;
      };
    }) => unknown
  ) =>
    selector({
      composer: { type: mockComposerType, runConfig: mockRunConfig },
    }),
}));
let mockHistory: Array<{ id: string; content: string; isUser: boolean }> = [];
let mockOnError: (error: Error) => void;

let mockTransport: {
  prepareSendMessagesRequest: (options: {
    trigger: 'submit-message' | 'regenerate-message';
    messages: UIMessage[];
    body: object;
    requestMetadata?: unknown;
  }) => Promise<{ body: Record<string, unknown> }>;
};
jest.mock('@assistant-ui/react-ai-sdk', () => ({
  AssistantChatTransport: jest.fn().mockImplementation((options) => {
    mockTransport = options;
    return options;
  }),
  useChatRuntime: (options: { onError: (error: Error) => void }) => {
    mockOnError = options.onError;
    return {};
  },
}));
jest.mock('@/components/thread', () => ({
  Thread: () => {
    useChatQuestionSource();
    const [answer, setAnswer] = useState('');
    return (
      <>
        <button
          onClick={async () => {
            const request = await mockTransport.prepareSendMessagesRequest({
              messages: [
                {
                  id: 'q',
                  role: 'user',
                  parts: [
                    { type: 'text', text: 'Summarize my training program' },
                  ],
                },
              ],
              trigger: 'submit-message',
              requestMetadata: mockRunConfig,
              body: {},
            });
            const response = await global.fetch('/api/chat/stream', {
              method: 'POST',
              body: JSON.stringify(request.body),
            });
            setAnswer(await response.text());
          }}
        >
          Ask training question
        </button>
        <p>{answer}</p>
      </>
    );
  },
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'owner' } }),
}));
jest.mock('@/hooks/AI/useAIServiceSettings', () => ({
  useActiveAIService: () => ({ data: { id: 'configured-service' } }),
}));
jest.mock('@/hooks/AI/useSparkyChat', () => ({
  useChatPreferencesQuery: () => ({ data: {} }),
  useChatHistoryQuery: () => ({ data: mockHistory }),
}));
jest.mock('@/hooks/useInvalidateKeys', () => ({
  useDiaryInvalidation: () => jest.fn(),
  useChatInvalidation: () => jest.fn(),
}));
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));
jest.mock('@/contexts/ChatToolCategoriesContext', () => ({
  useChatToolCategories: () => ({
    getSelected: () => ['exercise'],
    setActiveService: jest.fn(),
    hasCustomSelection: false,
  }),
}));
jest.mock('@/contexts/PreferencesContext', () => ({
  usePreferences: () => ({ timezone: 'UTC' }),
}));
jest.mock('@/hooks/TrainingPrograms/useTrainingPrograms', () => ({
  useTrainingProgramsList: () => ({
    data: [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic Program' },
    ],
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'chat.trainingAnalysis.title'
        ? 'Training analysis (read-only)'
        : key,
  }),
}));
import { useChatQuestionSource } from '@/hooks/AI/useChatQuestionSource';
import SparkyChatInterface from '@/pages/Chat/SparkyChatInterface';
import { chatErrorMessage } from '@/utils/chatError';

beforeEach(() => {
  mockHistory = [];
  mockComposerType = 'thread';
  mockRunConfig = {};
  mockToast.mockClear();
});

it('asks in read-only training mode and displays the answer with explicitly selected disclosure scope', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    text: async () => 'You completed three sessions. Consider a recovery day.',
  } as Response);
  global.fetch = fetchMock;
  render(<SparkyChatInterface />);
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Ask training question' })
  );
  expect(
    await screen.findByText(
      'You completed three sessions. Consider a recovery day.'
    )
  ).toBeInTheDocument();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
  expect(body.trainingAnalysis).toMatchObject({
    programs: true,
    test_types: [],
    health_metrics: [],
  });
  expect(body.messages[0].parts[0].text).toBe('Summarize my training program');
  delete (global as { fetch?: unknown }).fetch;
});

it.each([undefined, null])(
  'uses translated fallback when the chat error is %s',
  (error) => {
    expect(chatErrorMessage(error, 'Please try again.')).toBe(
      'Please try again.'
    );
  }
);

it.each([
  [
    '{"error":"Training analysis is temporarily unavailable."}',
    'Training analysis is temporarily unavailable.',
  ],
  [
    '{"error":{"message":"Service busy. Try again."}}',
    'Service busy. Try again.',
  ],
  ['{"message":"Service busy."}', 'Service busy.'],
  ['<html>Bad gateway</html>', 'chat.transportError'],
  ['{"error":', 'chat.transportError'],
  ['null', 'chat.transportError'],
  ['[]', 'chat.transportError'],
  ['503', 'chat.transportError'],
  ['The service is busy. Try again.', 'The service is busy. Try again.'],
  ['Failed to fetch', 'chat.transportError'],
  ['', 'chat.transportError'],
])('shows readable feedback for %s', (raw, expected) => {
  render(<SparkyChatInterface />);
  mockOnError(new Error(raw));
  expect(mockToast).toHaveBeenLastCalledWith({
    title: 'chat.errorTitle',
    description: expected,
    variant: 'destructive',
  });
});

const question: UIMessage = {
  id: 'retry-question',
  role: 'user',
  parts: [{ type: 'text', text: 'Summarize my training program' }],
};

it('retains the failed question disclosure even after the next-question controls change', async () => {
  render(<SparkyChatInterface />);
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  fireEvent.click(screen.getByLabelText('chat.trainingAnalysis.ramp'));
  fireEvent.click(screen.getByLabelText('chat.trainingAnalysis.total_steps'));
  fireEvent.change(screen.getByLabelText('chat.trainingAnalysis.program'), {
    target: { value: '11111111-1111-4111-8111-111111111111' },
  });
  const original = await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'submit-message',
    requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
    body: {},
  });
  expect(original.body['trainingAnalysis']).toMatchObject({
    program_id: '11111111-1111-4111-8111-111111111111',
    test_types: ['ramp'],
    health_metrics: ['total_steps'],
  });
  fireEvent.change(screen.getByLabelText('chat.trainingAnalysis.program'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByLabelText('chat.trainingAnalysis.cooper_run'));
  fireEvent.change(screen.getByLabelText('chat.trainingAnalysis.start'), {
    target: { value: '2026-01-01' },
  });
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  const retried = await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'regenerate-message',
    body: {},
  });
  expect(retried.body['trainingAnalysis']).toEqual(
    original.body['trainingAnalysis']
  );
  expect(retried.body['messages']).toEqual([question]);
});

it('does not opt an ordinary failed question into Training analysis on retry', async () => {
  render(<SparkyChatInterface />);
  await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'submit-message',
    requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
    body: {},
  });
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  const retried = await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'regenerate-message',
    body: {},
  });
  expect(retried.body['trainingAnalysis']).toBeUndefined();
  const next = await mockTransport.prepareSendMessagesRequest({
    messages: [question, { ...question, id: 'next-question' }],
    trigger: 'submit-message',
    requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
    body: {},
  });
  expect(next.body['trainingAnalysis']).toMatchObject({ programs: true });
});

it.each([false, true])(
  'restored question never inherits next-question analysis (original analysis: %s)',
  async (originalAnalysis) => {
    const mounted = render(<SparkyChatInterface />);
    if (originalAnalysis) {
      fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
      fireEvent.change(screen.getByLabelText('chat.trainingAnalysis.program'), {
        target: { value: '11111111-1111-4111-8111-111111111111' },
      });
    }
    await mockTransport.prepareSendMessagesRequest({
      messages: [question],
      trigger: 'submit-message',
      requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
      body: {},
    });
    mounted.unmount();
    mockHistory = [
      {
        id: question.id,
        content: 'Summarize my training program',
        isUser: true,
      },
      { id: 'saved-answer', content: 'Saved answer', isUser: false },
    ];
    render(<SparkyChatInterface />);
    fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
    const regenerated = await mockTransport.prepareSendMessagesRequest({
      messages: [question],
      trigger: 'regenerate-message',
      body: {},
    });
    expect(regenerated.body['trainingAnalysis']).toBeUndefined();
    expect(regenerated.body['messages']).toEqual([question]);
    expect(mockToast).toHaveBeenLastCalledWith({
      description: 'chat.trainingAnalysis.newQuestionRequired',
    });
    const retry = await mockTransport.prepareSendMessagesRequest({
      messages: [question],
      trigger: 'regenerate-message',
      body: {},
    });
    expect(retry.body['trainingAnalysis']).toBeUndefined();
    fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
    mockToast.mockClear();
    const ordinary = await mockTransport.prepareSendMessagesRequest({
      messages: [question],
      trigger: 'regenerate-message',
      body: {},
    });
    expect(ordinary.body['trainingAnalysis']).toBeUndefined();
    expect(mockToast).not.toHaveBeenCalled();
  }
);

it('evicts the oldest scope after 50 questions and retries it without analysis', async () => {
  render(<SparkyChatInterface />);
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  for (let index = 0; index < 51; index++) {
    await mockTransport.prepareSendMessagesRequest({
      messages: [{ ...question, id: `question-${index}` }],
      trigger: 'submit-message',
      requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
      body: {},
    });
  }
  fireEvent.click(screen.getByLabelText('chat.trainingAnalysis.ramp'));
  const retained = await mockTransport.prepareSendMessagesRequest({
    messages: [{ ...question, id: 'question-1' }],
    trigger: 'regenerate-message',
    body: {},
  });
  expect(retained.body['trainingAnalysis']).toMatchObject({ test_types: [] });
  mockToast.mockClear();
  for (let retry = 0; retry < 2; retry++) {
    const evicted = await mockTransport.prepareSendMessagesRequest({
      messages: [{ ...question, id: 'question-0' }],
      trigger: 'regenerate-message',
      body: {},
    });
    expect(evicted.body['trainingAnalysis']).toBeUndefined();
    expect(evicted.body['messages']).toEqual([
      { ...question, id: 'question-0' },
    ]);
    expect(mockToast).toHaveBeenLastCalledWith({
      description: 'chat.trainingAnalysis.newQuestionRequired',
    });
  }
  const next = await mockTransport.prepareSendMessagesRequest({
    messages: [{ ...question, id: 'question-51' }],
    trigger: 'submit-message',
    requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
    body: {},
  });
  expect(next.body['trainingAnalysis']).toMatchObject({ test_types: ['ramp'] });
});

it.each(['ordinary', 'narrow', 'restored', 'evicted'] as const)(
  'sends an unchanged %s Edit Update and its following regenerate as ordinary chat',
  async (source) => {
    if (source === 'restored') {
      mockHistory = [
        {
          id: question.id,
          content: 'Summarize my training program',
          isUser: true,
        },
      ];
    }
    const mounted = render(<SparkyChatInterface />);
    if (source === 'narrow') {
      fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
      fireEvent.change(screen.getByLabelText('chat.trainingAnalysis.program'), {
        target: { value: '11111111-1111-4111-8111-111111111111' },
      });
    }
    if (source !== 'restored') {
      await mockTransport.prepareSendMessagesRequest({
        messages: [question],
        trigger: 'submit-message',
        requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
        body: {},
      });
    }
    if (source === 'evicted') {
      for (let index = 0; index < 50; index++) {
        await mockTransport.prepareSendMessagesRequest({
          messages: [{ ...question, id: `new-${index}` }],
          trigger: 'submit-message',
          requestMetadata: { custom: { trainingAnalysisSource: 'thread' } },
          body: {},
        });
      }
    }
    if (source !== 'narrow') {
      fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
    }
    fireEvent.change(screen.getByLabelText('chat.trainingAnalysis.program'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByLabelText('chat.trainingAnalysis.total_steps'));
    // The SDK gives Edit > Update a new ID even when its text is unchanged.
    const edited = { ...question, id: 'edit-generated-id' };
    mockComposerType = 'edit';
    mounted.rerender(<SparkyChatInterface />);
    mockToast.mockClear();
    const updated = await mockTransport.prepareSendMessagesRequest({
      messages: [edited],
      trigger: 'submit-message',
      requestMetadata: mockRunConfig,
      body: {},
    });
    expect(JSON.parse(JSON.stringify(updated.body))).not.toHaveProperty(
      'trainingAnalysis'
    );
    expect(updated.body['messages']).toEqual([edited]);
    expect(mockToast).toHaveBeenLastCalledWith({
      description: 'chat.trainingAnalysis.newQuestionRequired',
    });
    const regenerated = await mockTransport.prepareSendMessagesRequest({
      messages: [edited],
      trigger: 'regenerate-message',
      body: {},
    });
    expect(JSON.parse(JSON.stringify(regenerated.body))).not.toHaveProperty(
      'trainingAnalysis'
    );
    expect(regenerated.body['messages']).toEqual([edited]);
    mockComposerType = 'thread';
    mounted.rerender(<SparkyChatInterface />);
    const next = await mockTransport.prepareSendMessagesRequest({
      messages: [{ ...question, id: 'fresh-composer-question' }],
      trigger: 'submit-message',
      requestMetadata: mockRunConfig,
      body: {},
    });
    expect(next.body['trainingAnalysis']).toMatchObject({
      programs: true,
      health_metrics: ['total_steps'],
    });
  }
);

it('keeps a cached analysis question ordinary after Edit Update with analysis disabled', async () => {
  const mounted = render(<SparkyChatInterface />);
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'submit-message',
    requestMetadata: mockRunConfig,
    body: {},
  });
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  mockComposerType = 'edit';
  mounted.rerender(<SparkyChatInterface />);
  mockToast.mockClear();
  // Explicit edit provenance wins even if an adapter preserves the original ID.
  const updated = await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'submit-message',
    requestMetadata: mockRunConfig,
    body: {},
  });
  expect(updated.body['trainingAnalysis']).toBeUndefined();
  expect(mockToast).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  const regenerated = await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'regenerate-message',
    body: {},
  });
  expect(regenerated.body['trainingAnalysis']).toBeUndefined();
});

it('does not authorize analysis for a submit without composer provenance', async () => {
  render(<SparkyChatInterface />);
  fireEvent.click(screen.getByLabelText('Training analysis (read-only)'));
  const submitted = await mockTransport.prepareSendMessagesRequest({
    messages: [question],
    trigger: 'submit-message',
    body: {},
  });
  expect(submitted.body['trainingAnalysis']).toBeUndefined();
  expect(mockToast).toHaveBeenLastCalledWith({
    description: 'chat.trainingAnalysis.newQuestionRequired',
  });
});
