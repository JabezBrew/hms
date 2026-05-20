import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useBillingRule,
  useClaim,
  useInvoice,
  useNhisMappingImportJob,
  usePatientInsuranceById,
} from '../useBillingQueries';
import { billingApi } from '@/features/billing/api';

vi.mock('@/features/billing/api', () => ({
  billingApi: {
    getBillingRule: vi.fn(),
    getClaim: vi.fn(),
    getInvoice: vi.fn(),
    getNhisMappingImportJob: vi.fn(),
    getPatientInsuranceById: vi.fn(),
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

describe('useBillingQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    billingApi.getBillingRule.mockResolvedValue({});
    billingApi.getClaim.mockResolvedValue({});
    billingApi.getInvoice.mockResolvedValue({});
    billingApi.getNhisMappingImportJob.mockResolvedValue({});
    billingApi.getPatientInsuranceById.mockResolvedValue({});
  });

  it('threads React Query AbortSignal into billing detail reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useInvoice('invoice-1'), { wrapper });
    renderHook(() => useClaim('claim-1'), { wrapper });
    renderHook(() => useBillingRule('rule-1'), { wrapper });

    await waitFor(() => {
      expect(billingApi.getInvoice).toHaveBeenCalledWith('invoice-1', {
        signal: expect.any(AbortSignal),
      });
      expect(billingApi.getClaim).toHaveBeenCalledWith('claim-1', {
        signal: expect.any(AbortSignal),
      });
      expect(billingApi.getBillingRule).toHaveBeenCalledWith('rule-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into billing ancillary detail reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => usePatientInsuranceById('insurance-1'), { wrapper });
    renderHook(() => useNhisMappingImportJob('mapping-job-1'), { wrapper });

    await waitFor(() => {
      expect(billingApi.getPatientInsuranceById).toHaveBeenCalledWith('insurance-1', {
        signal: expect.any(AbortSignal),
      });
      expect(billingApi.getNhisMappingImportJob).toHaveBeenCalledWith('mapping-job-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
