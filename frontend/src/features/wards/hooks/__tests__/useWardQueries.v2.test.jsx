import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useAllocationLogs,
  useAmenities,
  useAmenity,
  useAvailableBeds,
  useBed,
  useBeds,
  usePractitionerAssignments,
  useSection,
  useSectionBeds,
  useSections,
  useStaffAssignments,
  useStaffRoles,
  useTransfers,
  useWard,
  useWardBeds,
  useWardSections,
  useWardStaff,
  useWards,
} from '../useWardQueries';
import { wardsApi } from '@/features/wards/api';

vi.mock('@/features/wards/api', () => ({
  wardsApi: {
    getAllocationLogs: vi.fn(),
    getAmenities: vi.fn(),
    getAmenity: vi.fn(),
    getAvailableBeds: vi.fn(),
    getBed: vi.fn(),
    getBeds: vi.fn(),
    getStaffAssignments: vi.fn(),
    getStaffAssignmentsByPractitioner: vi.fn(),
    getStaffRoles: vi.fn(),
    getSection: vi.fn(),
    getSectionBeds: vi.fn(),
    getSections: vi.fn(),
    getTransfers: vi.fn(),
    getWard: vi.fn(),
    getWardStaff: vi.fn(),
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
    wardsApi.getAllocationLogs.mockResolvedValue([]);
    wardsApi.getAmenities.mockResolvedValue([]);
    wardsApi.getAmenity.mockResolvedValue({});
    wardsApi.getAvailableBeds.mockResolvedValue([]);
    wardsApi.getBed.mockResolvedValue({});
    wardsApi.getBeds.mockResolvedValue([]);
    wardsApi.getStaffAssignments.mockResolvedValue([]);
    wardsApi.getStaffAssignmentsByPractitioner.mockResolvedValue([]);
    wardsApi.getStaffRoles.mockResolvedValue([]);
    wardsApi.getSection.mockResolvedValue({});
    wardsApi.getSectionBeds.mockResolvedValue([]);
    wardsApi.getSections.mockResolvedValue([]);
    wardsApi.getTransfers.mockResolvedValue([]);
    wardsApi.getWard.mockResolvedValue({});
    wardsApi.getWardStaff.mockResolvedValue([]);
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

  it('threads React Query AbortSignal into ward ancillary reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useTransfers({ ward: 'ward-1' }), { wrapper });
    renderHook(() => useAllocationLogs({ ward: 'ward-1' }), { wrapper });
    renderHook(() => useAmenities({ category: 'oxygen' }), { wrapper });
    renderHook(() => useAmenity('amenity-1'), { wrapper });
    renderHook(() => useAvailableBeds({ ward: 'ward-1' }), { wrapper });
    renderHook(() => useWardStaff('ward-1', 'nursing'), { wrapper });
    renderHook(() => useStaffAssignments({ ward: 'ward-1' }), { wrapper });
    renderHook(() => usePractitionerAssignments('practitioner-1'), { wrapper });
    renderHook(() => useStaffRoles({ category: 'nursing' }), { wrapper });

    await waitFor(() => {
      expect(wardsApi.getTransfers).toHaveBeenCalledWith({
        ward: 'ward-1',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getAllocationLogs).toHaveBeenCalledWith({
        ward: 'ward-1',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getAmenities).toHaveBeenCalledWith({
        category: 'oxygen',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getAmenity).toHaveBeenCalledWith('amenity-1', {
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getAvailableBeds).toHaveBeenCalledWith({
        ward: 'ward-1',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getWardStaff).toHaveBeenCalledWith('ward-1', {
        category: 'nursing',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getStaffAssignments).toHaveBeenCalledWith({
        ward: 'ward-1',
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getStaffAssignmentsByPractitioner).toHaveBeenCalledWith('practitioner-1', {
        signal: expect.any(AbortSignal),
      });
      expect(wardsApi.getStaffRoles).toHaveBeenCalledWith({
        category: 'nursing',
        signal: expect.any(AbortSignal),
      });
    });
  });
});
