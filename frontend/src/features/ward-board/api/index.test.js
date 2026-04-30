import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wardBoardApi } from './index';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getWithPagination: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
  handleApiError: (error, fallback) => error?.message || fallback,
}));

describe('wardBoardApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches the board through getWithPagination with query params and abort signal', async () => {
    const signal = new AbortController().signal;
    apiClient.getWithPagination.mockResolvedValue({
      count: 1,
      results: [{ id: 'patient-1' }],
    });

    await expect(
      wardBoardApi.getBoard({ ward: 'ward-1', page: 2, page_size: 10 }, { signal })
    ).resolves.toEqual({
      count: 1,
      results: [{ id: 'patient-1' }],
    });

    expect(apiClient.getWithPagination).toHaveBeenCalledWith('/ward-board/', {
      signal,
      params: { ward: 'ward-1', page: 2, page_size: 10 },
    });
  });

  it('uses the stable task action endpoint before falling back to a generic patch', async () => {
    apiClient.post.mockRejectedValueOnce({ status: 404, message: 'not found' });
    apiClient.patch.mockResolvedValueOnce({ id: 'task-1', status: 'acknowledged' });

    await expect(
      wardBoardApi.runTaskAction({
        taskId: 'task-1',
        action: 'acknowledge',
        payload: { note: 'seen' },
      })
    ).resolves.toEqual({ id: 'task-1', status: 'acknowledged' });

    expect(apiClient.post).toHaveBeenCalledWith('/ward-board/tasks/task-1/acknowledge/', {
      note: 'seen',
    });
    expect(apiClient.patch).toHaveBeenCalledWith('/ward-board/tasks/task-1/', {
      action: 'acknowledge',
      note: 'seen',
    });
  });
});
