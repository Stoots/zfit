import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { UIMessage } from 'ai';

let mockTransport: {
  prepareSendMessagesRequest: (options: {
    messages: UIMessage[];
    body: object;
  }) => Promise<{ body: Record<string, unknown> }>;
};
jest.mock('@assistant-ui/react-ai-sdk', () => ({
  AssistantChatTransport: jest.fn().mockImplementation((options) => {
    mockTransport = options;
    return options;
  }),
  useChatRuntime: () => ({}),
}));
jest.mock('@/components/thread', () => ({
  Thread: () => {
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
  useChatHistoryQuery: () => ({ data: [] }),
}));
jest.mock('@/hooks/useInvalidateKeys', () => ({
  useDiaryInvalidation: () => jest.fn(),
  useChatInvalidation: () => jest.fn(),
}));
jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
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
  useTrainingProgramsList: () => ({ data: [] }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === 'chat.trainingAnalysis.title'
        ? 'Training analysis (read-only)'
        : key,
  }),
}));
import SparkyChatInterface from '@/pages/Chat/SparkyChatInterface';

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
