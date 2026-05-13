import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useCompareNoteVersions,
  useNoteEntry,
  useNoteEntryHistory,
  useNoteEntrySections,
  useNoteEntryVersion,
  useNoteTemplate,
  useTemplateCategories,
} from '../useClinicalNotesQueries'
import { clinicalNotesApi } from '@/features/clinical-notes/api'

vi.mock('@/features/clinical-notes/api', () => ({
  clinicalNotesApi: {
    getNoteTemplate: vi.fn(),
    getTemplateCategories: vi.fn(),
    getNoteEntry: vi.fn(),
    getNoteEntrySections: vi.fn(),
    getNoteEntryHistory: vi.fn(),
    getNoteEntryVersion: vi.fn(),
    compareNoteVersions: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

async function expectSuccessfulHook(render) {
  const { result } = renderHook(render, { wrapper: createWrapper() })
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })
}

describe('useClinicalNotesQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.values(clinicalNotesApi).forEach((mockFn) => {
      mockFn.mockResolvedValue({})
    })
  })

  it('threads React Query AbortSignal into supported note detail reads', async () => {
    await expectSuccessfulHook(() => useNoteTemplate('template-1'))
    await expectSuccessfulHook(() => useTemplateCategories())
    await expectSuccessfulHook(() => useNoteEntry('note-1'))
    await expectSuccessfulHook(() => useNoteEntrySections('note-1'))
    await expectSuccessfulHook(() => useNoteEntryHistory('note-1'))
    await expectSuccessfulHook(() => useNoteEntryVersion('note-1', 2))
    await expectSuccessfulHook(() => useCompareNoteVersions('note-1', 1, 2))

    expect(clinicalNotesApi.getNoteTemplate).toHaveBeenCalledWith('template-1', {
      signal: expect.any(AbortSignal),
    })
    expect(clinicalNotesApi.getTemplateCategories).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    })
    expect(clinicalNotesApi.getNoteEntry).toHaveBeenCalledWith('note-1', {
      signal: expect.any(AbortSignal),
    })
    expect(clinicalNotesApi.getNoteEntrySections).toHaveBeenCalledWith('note-1', {
      signal: expect.any(AbortSignal),
    })
    expect(clinicalNotesApi.getNoteEntryHistory).toHaveBeenCalledWith('note-1', {
      signal: expect.any(AbortSignal),
    })
    expect(clinicalNotesApi.getNoteEntryVersion).toHaveBeenCalledWith('note-1', 2, {
      signal: expect.any(AbortSignal),
    })
    expect(clinicalNotesApi.compareNoteVersions).toHaveBeenCalledWith('note-1', 1, 2, {
      signal: expect.any(AbortSignal),
    })
  })
})
