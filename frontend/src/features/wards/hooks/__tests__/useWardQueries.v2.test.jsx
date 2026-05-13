import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useBed,
  useBeds,
  useSection,
  useSectionBeds,
  useSections,
  useWard,
  useWardBeds,
  useWardSections,
  useWards,
} from '../useWardQueries';
import { wardsApi } from '@/features/wards/api';

vi.mock('@/features/wards/api', () => ({
  wardsApi: {
    getBed: vi.fn(),
    getBeds: vi.fn(),
    getSection: vi.fn(),
    getSectionBeds: vi.fn(),
    getSections: vi.fn(),
    getWard: vi.fn(),
    getWardSections: vi.fn(),
    getWards: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useWardQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wardsApi.getBed.mockResolvedValue({});
    wardsApi.getBeds.mockResolvedValue([]);
    wardsApi.getSection.mockResolvedValue({});
    wardsApi.getSectionBeds.mockResolvedValue([]);
    wardsApi.getSections.mockResolvedValue([]);
    wardsApi.getWard.mockResolvedValue({});
    wardsApi.getWardSections.mockResolvedValue([]);
    wardsApi.getWards.mockResolvedValue([]);
  });

  it('threads React Query AbortSignal into ward and bed reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useWards({ status: 'active' }), { wrapper });
    renderHook(() => useWard('ward-1'), { wrapper });
    renderHook(() => useBeds({ ward: 'ward-1' }), { wrapper });
    renderHook(() => useWardBeds('ward-1', { status: 'available' }), { wrapper });
    renderHook(() => useBed('bed-1'), { wrapper });

    await waitFor(() => {
      expect(wardsApi.getWards).toHaveBeenCalledWith({
        status: 'active',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getWard).toHaveBeenCalledWith('ward-1', {
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getBeds).toHaveBeenCalledWith({
        ward: 'ward-1',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getBeds).toHaveBeenCalledWith({
        ward: 'ward-1',
        status: 'available',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getBed).toHaveBeenCalledWith('bed-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into ward section reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useSections({ ward: 'ward-1' }), { wrapper });
    renderHook(() => useWardSections('ward-1'), { wrapper });
    renderHook(() => useSection('section-1'), { wrapper });
    renderHook(() => useSectionBeds('section-1'), { wrapper });

    await waitFor(() => {
      expect(wardsApi.getSections).toHaveBeenCalledWith({
        ward: 'ward-1',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getWardSections).toHaveBeenCalledWith('ward-1', {
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getSection).toHaveBeenCalledWith('section-1', {
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getSectionBeds).toHaveBeenCalledWith(
        'section-1',
        {},
        { signal: expect.any(AbortSignal) },
      );
    });
  });
});
