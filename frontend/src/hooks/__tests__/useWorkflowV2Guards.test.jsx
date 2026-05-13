import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConsultationWorkflow } from '../useConsultationWorkflow';
import { useDischargeWorkflow as useDischargeWorkflowState } from '../useDischargeWorkflow';
import { useNoteWorkflow } from '../useNoteWorkflow';
import { useWardRoundWorkflow as useWardRoundWorkflowState } from '../useWardRoundWorkflow';
import { useDraftWorkflows, useWorkflow } from '../useWorkflow';
import {
  useDischargeWorkflow,
  useWardRoundWorkflow,
  useWorkflowDetail,
} from '../useWorkflowQueries';
import { __resetV2ApiClientForTests } from '@/lib/api/v2/client';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function captureMutationError(action) {
  let caught = null;
  await act(async () => {
    try {
      await action();
    } catch (error) {
      caught = error;
    }
  });
  return caught;
}

describe('Rust V2 workflow guards', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('fails closed for generic workflow mutations instead of calling legacy workflow URLs', async () => {
    const { result } = renderHook(() => useWorkflow('ward-round'), {
      wrapper: createWrapper(),
    });

    const error = await captureMutationError(() => result.current.startWorkflow({ patient_id: 'patient-1' }));

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('no generated /api/v2 workflow contract');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for workflow detail queries instead of calling legacy workflow URLs', async () => {
    const { result } = renderHook(() => useWorkflowDetail('workflow-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error.message).toContain('no generated /api/v2 workflow contract');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for ward-round workflow API mutations in Rust mode', async () => {
    const { result } = renderHook(() => useWardRoundWorkflow(), {
      wrapper: createWrapper(),
    });

    const error = await captureMutationError(() => result.current.startWardRound.mutateAsync({
      patientId: 'patient-1',
      admissionId: 'admission-1',
    }));

    expect(error.message).toContain('no generated /api/v2 workflow contract');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for discharge workflow API mutations in Rust mode', async () => {
    const { result } = renderHook(() => useDischargeWorkflow(), {
      wrapper: createWrapper(),
    });

    const error = await captureMutationError(() => result.current.startDischarge.mutateAsync({
      patientId: 'patient-1',
      admissionId: 'admission-1',
    }));

    expect(error.message).toContain('no generated /api/v2 workflow contract');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for stateful ward-round, consultation, and discharge workflow starters', async () => {
    const wrapper = createWrapper();
    const wardRound = renderHook(() => useWardRoundWorkflowState('patient-1', 'admission-1'), { wrapper });
    const consultation = renderHook(() => useConsultationWorkflow('patient-1'), { wrapper });
    const discharge = renderHook(() => useDischargeWorkflowState('patient-1', 'admission-1'), { wrapper });

    await act(async () => {
      await expect(wardRound.result.current.startWorkflow()).resolves.toBeNull();
      await expect(consultation.result.current.startWorkflow()).resolves.toBeNull();
      await expect(discharge.result.current.startWorkflow()).resolves.toBeNull();
    });

    await waitFor(() => expect(wardRound.result.current.error).toContain('no generated /api/v2 workflow contract'));
    await waitFor(() => expect(consultation.result.current.error).toContain('no generated /api/v2 workflow contract'));
    await waitFor(() => expect(discharge.result.current.error).toContain('no generated /api/v2 workflow contract'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps note editing local in Rust mode until completion uses the clinical-notes bridge', async () => {
    const template = {
      id: 'template-1',
      category: 'progress',
      structure: {
        sections: [
          { name: 'Subjective', type: 'text' },
        ],
      },
    };
    const { result } = renderHook(() => useNoteWorkflow('patient-1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.startWorkflow(template);
    });

    expect(result.current.currentStep).toBe(1);
    expect(result.current.error).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('workflow query cancellation outside Rust V2 mode', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'django',
      apiBaseUrl: 'http://localhost:8000/api',
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'workflow-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    __resetV2ApiClientForTests();
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('threads React Query AbortSignal through generic workflow detail reads', async () => {
    const { result } = renderHook(() => useWorkflow('ward-round'), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.loadWorkflow('workflow-1');
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    expect(globalThis.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('threads React Query AbortSignal through draft workflow reads', async () => {
    renderHook(() => useDraftWorkflows({ patient: 'patient-1' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    expect(globalThis.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('threads React Query AbortSignal through workflow detail query helpers', async () => {
    renderHook(() => useWorkflowDetail('workflow-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    expect(globalThis.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
