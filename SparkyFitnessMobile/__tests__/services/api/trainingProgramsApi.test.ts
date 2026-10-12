import { fetchTrainingPrograms } from '../../../src/services/api/trainingProgramsApi';
import {
  getActiveServerConfig,
  type ServerConfig,
} from '../../../src/services/storage';

jest.mock('../../../src/services/storage', () => ({
  getActiveServerConfig: jest.fn(),
  proxyHeadersToRecord: jest.requireActual('../../../src/services/storage')
    .proxyHeadersToRecord,
}));

jest.mock('../../../src/services/LogService', () => ({
  addLog: jest.fn(),
}));

const mockGetActiveServerConfig = getActiveServerConfig as jest.MockedFunction<
  typeof getActiveServerConfig
>;

describe('trainingProgramsApi', () => {
  const mockFetch = jest.fn();
  const testConfig: ServerConfig = {
    id: 'test-id',
    url: 'https://example.com',
    apiKey: 'test-api-key-12345',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetActiveServerConfig.mockResolvedValue(testConfig);
  });

  it('requests /api/training-programs and returns an empty list', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

    await expect(fetchTrainingPrograms()).resolves.toEqual([]);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/api/training-programs',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('rejects a response that does not match the program schema', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 1 }]),
    });

    await expect(fetchTrainingPrograms()).rejects.toThrow();
  });
});
