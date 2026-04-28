import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const reactQueryMocks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useMutation: reactQueryMocks.useMutation,
    useQuery: reactQueryMocks.useQuery,
    useQueryClient: reactQueryMocks.useQueryClient,
  };
});

import { appointmentKeys, useAppointmentType, useAppointmentTypes } from '@/features/appointments/hooks/useAppointmentQueries';
import { patientKeys, usePatientValidationRules } from '@/features/patients/hooks/usePatientQueries';
import {
  IMMUTABLE_METADATA_GC_TIME,
  hasMeaningfulQueryParams,
  immutableMetadataQueryOptions,
} from '@/lib/react-query';
import { billingKeys, useServiceCategories } from '@/hooks/useBillingQueries';
import { chartKeys, useChartCategories, useChartIntervals } from '@/hooks/useChartQueries';
import { useTemplateCategories } from '@/hooks/useClinicalNotesQueries';
import { useDrugForms } from '@/hooks/useDrugSafetyQueries';
import { useFacilities } from '@/hooks/useFacilityQueries';
import { inventoryKeys, useInventoryCategories } from '@/hooks/useInventoryQueries';
import { labKeys, useLabPanels, useLabTests } from '@/hooks/useLabQueries';
import { useSystemCapabilities } from '@/hooks/useSystemQueries';

function getLastQueryCall() {
  return reactQueryMocks.useQuery.mock.calls.at(-1)?.[0];
}

describe('immutable metadata query helpers', () => {
  beforeEach(() => {
    reactQueryMocks.useMutation.mockReset();
    reactQueryMocks.useQuery.mockReset();
    reactQueryMocks.useQueryClient.mockReset();

    reactQueryMocks.useMutation.mockImplementation((config) => config);
    reactQueryMocks.useQuery.mockImplementation((config) => config);
    reactQueryMocks.useQueryClient.mockReturnValue({
      cancelQueries: vi.fn(),
      getQueryData: vi.fn(),
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    });
  });

  it('builds immutable metadata defaults with bounded cache retention', () => {
    expect(immutableMetadataQueryOptions()).toEqual({
      staleTime: Infinity,
      gcTime: IMMUTABLE_METADATA_GC_TIME,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    });
  });

  it('detects whether filter params are meaningful before using immutable caches', () => {
    expect(hasMeaningfulQueryParams({})).toBe(false);
    expect(hasMeaningfulQueryParams({ search: '  ' })).toBe(false);
    expect(hasMeaningfulQueryParams({ search: 'cbc' })).toBe(true);
    expect(hasMeaningfulQueryParams({ active: false })).toBe(true);
  });

  it('uses immutable caching for chart metadata hooks', () => {
    renderHook(() => useChartCategories({ enabled: false }));

    expect(getLastQueryCall()).toMatchObject({
      queryKey: chartKeys.categories(),
      enabled: false,
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useChartIntervals());

    expect(getLastQueryCall()).toMatchObject({
      queryKey: chartKeys.intervals(),
      ...immutableMetadataQueryOptions(),
    });
  });

  it('uses immutable caching for system-managed lookup hooks', () => {
    renderHook(() => useTemplateCategories());
    expect(getLastQueryCall()).toMatchObject(immutableMetadataQueryOptions());

    renderHook(() => useFacilities({ includeInactive: true }));
    expect(getLastQueryCall()).toMatchObject({
      queryKey: ['facilities', true],
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useSystemCapabilities({ enabled: false }));
    expect(getLastQueryCall()).toMatchObject({
      queryKey: ['system', 'deployment-capabilities'],
      enabled: false,
      ...immutableMetadataQueryOptions(),
    });
  });

  it('uses immutable caching for drug forms and appointment types', () => {
    renderHook(() => useDrugForms('12345'));
    expect(getLastQueryCall()).toMatchObject({
      enabled: true,
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useAppointmentTypes());
    expect(getLastQueryCall()).toMatchObject({
      queryKey: appointmentKeys.types(),
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useAppointmentType('appt-type-1'));
    expect(getLastQueryCall()).toMatchObject({
      queryKey: appointmentKeys.type('appt-type-1'),
      enabled: true,
      ...immutableMetadataQueryOptions(),
    });
  });

  it('uses immutable caching for validation rules and base catalog queries', () => {
    renderHook(() => usePatientValidationRules());
    expect(getLastQueryCall()).toMatchObject({
      queryKey: patientKeys.validation(),
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useLabTests());
    expect(getLastQueryCall()).toMatchObject({
      queryKey: labKeys.testsList({}),
      enabled: true,
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useLabPanels());
    expect(getLastQueryCall()).toMatchObject({
      queryKey: labKeys.panelsList({}),
      enabled: true,
      ...immutableMetadataQueryOptions(),
    });

    renderHook(() => useInventoryCategories());
    expect(getLastQueryCall()).toMatchObject({
      queryKey: inventoryKeys.categoryList({}),
      ...immutableMetadataQueryOptions(),
    });
  });

  it('keeps filtered catalog queries on normal freshness semantics', () => {
    renderHook(() => useLabTests({ search: 'cbc' }));
    expect(getLastQueryCall()).toMatchObject({
      queryKey: labKeys.testsList({ search: 'cbc' }),
      enabled: true,
    });
    expect(getLastQueryCall().staleTime).toBeUndefined();

    renderHook(() => useServiceCategories({ search: 'radiology' }));
    expect(getLastQueryCall()).toMatchObject({
      queryKey: billingKeys.serviceCategoryList({ search: 'radiology' }),
    });
    expect(getLastQueryCall().staleTime).toBeUndefined();
  });
});
