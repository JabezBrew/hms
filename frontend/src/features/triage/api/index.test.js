import { beforeEach, describe, expect, it, vi } from 'vitest';
import { triageAssignmentApi } from './index';
import { v2Api } from '@/lib/api/v2/client';
vi.mock('@/lib/api/v2/client', () => ({ v2Api: { getStaffDirectory: vi.fn() } }));

describe('Triage staff directory adapter', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the bounded clinical directory endpoint and preserves pagination and cancellation', async () => {
    const signal = new AbortController().signal;
    v2Api.getStaffDirectory.mockResolvedValue({ data: [{ user_id: 'user-1', display_name: 'Test clinician' }], page: { has_next: true, next_cursor: 'next-staff' } });
    const page = await triageAssignmentApi.listStaff({ cursor: 'current-staff', signal });
    expect(v2Api.getStaffDirectory).toHaveBeenCalledWith({ query: { limit: 50, cursor: 'current-staff' }, signal });
    expect(page).toEqual({ results: [{ user_id: 'user-1', display_name: 'Test clinician' }], next_cursor: 'next-staff' });
  });
  it('preserves AbortError and fails visibly on ordinary errors', async () => {
    const aborted = new DOMException('Cancelled', 'AbortError');
    v2Api.getStaffDirectory.mockRejectedValueOnce(aborted).mockRejectedValueOnce(new Error('Offline'));
    await expect(triageAssignmentApi.listStaff()).rejects.toBe(aborted);
    await expect(triageAssignmentApi.listStaff()).rejects.toThrow();
  });
});
