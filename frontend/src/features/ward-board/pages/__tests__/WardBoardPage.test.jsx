import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import WardBoardPage from '../WardBoardPage';
import {
  useWardBoard,
  useWardBoardLiveUpdates,
  useWardBoardTaskAction,
  useWardBoardPatient,
} from '@/features/ward-board/hooks';

vi.mock('@/features/ward-board/hooks', () => ({
  useWardBoard: vi.fn(),
  useWardBoardLiveUpdates: vi.fn(),
  useWardBoardTaskAction: vi.fn(),
  useWardBoardPatient: vi.fn(),
}));

vi.mock('@/shared/hooks/usePageMeta', () => ({
  usePageMeta: () => null,
}));

vi.mock('@/hooks/use-debounce', () => ({
  useDebounce: (value) => value,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mockUseWardBoard = vi.mocked(useWardBoard);
const mockUseWardBoardLiveUpdates = vi.mocked(useWardBoardLiveUpdates);
const mockUseWardBoardTaskAction = vi.mocked(useWardBoardTaskAction);
const mockUseWardBoardPatient = vi.mocked(useWardBoardPatient);

function boardResponse(overrides = {}) {
  return {
    count: 24,
    next: '/api/ward-board/?page=3',
    previous: '/api/ward-board/?page=1',
    summary: {
      total_patients: 24,
      open_tasks: 4,
      critical: 1,
      pending_results: 1,
      discharge_ready: 0,
      my_work: 2,
    },
    results: [
      {
        id: 'row-1',
        patient_id: 'patient-1',
        patient_name: 'Ama Mensah',
        mrn: 'MRN-001',
        bed_label: 'A-01',
        ward_name: 'Ward A',
        urgency: 'critical',
        updated_at: '2026-04-30T08:00:00Z',
        tasks: [{ id: 'task-1', title: 'Review medication chart', status: 'pending' }],
        results: [{ id: 'result-1', test_name: 'CBC', status: 'pending' }],
        discharge_tasks: [],
      },
    ],
    ...overrides,
  };
}

function renderPage(route, path = '/ward-board') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={<WardBoardPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('WardBoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWardBoard.mockReturnValue({
      data: boardResponse(),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseWardBoardTaskAction.mockReturnValue({ mutate: vi.fn() });
    mockUseWardBoardLiveUpdates.mockReturnValue({
      isConnected: true,
      connectionError: null,
    });
    mockUseWardBoardPatient.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it('reads ward board filters from query params and renders patient rows', () => {
    renderPage('/ward-board?ward=ward-1&view=results&search=cbc&page=2&page_size=10');

    expect(mockUseWardBoard).toHaveBeenCalledWith({
      ward: 'ward-1',
      view: 'results',
      search: 'cbc',
      page: 2,
      page_size: 10,
    });
    expect(screen.getByText('Ward Clinical Task Board')).toBeInTheDocument();
    expect(screen.getAllByText('Ama Mensah')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true');
  });

  it('uses the route ward id ahead of the ward query param for ward-specific boards', () => {
    renderPage('/wards/ward-7/board?ward=ignored&view=by-urgency&page_size=30', '/wards/:wardId/board');

    expect(mockUseWardBoard.mock.calls.at(-1)[0]).toEqual({
      ward: 'ward-7',
      view: 'by-urgency',
      page: 1,
      page_size: 30,
    });
    expect(screen.getByDisplayValue('ward-7')).toBeDisabled();
  });

  it('shows the empty board state when no patients match', () => {
    mockUseWardBoard.mockReturnValue({
      data: boardResponse({ count: 0, results: [] }),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage('/ward-board?view=my-work');

    expect(screen.getByText('No ward board patients')).toBeInTheDocument();
    expect(mockUseWardBoard).toHaveBeenCalledWith({
      view: 'my-work',
      page: 1,
      page_size: 20,
    });
  });

  it('renders lightweight backend count fields when rows do not include nested arrays', () => {
    mockUseWardBoard.mockReturnValue({
      data: boardResponse({
        summary: undefined,
        results: [
          {
            patient_id: 'patient-counts',
            patient_name: 'Kofi Owusu',
            medical_record_number: 'MRN-002',
            bed_number: 'B-04',
            ward_name: 'Ward B',
            open_task_count: 2,
            nursing_task_count: 1,
            active_alert_count: 1,
            urgent_task_count: 1,
            open_lab_order_count: 3,
            discharge_task_count: 2,
          },
        ],
      }),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage('/ward-board');

    expect(screen.getAllByText('Kofi Owusu')).not.toHaveLength(0);
    expect(screen.getAllByText('urgent')).not.toHaveLength(0);
    expect(screen.getByText('Open Tasks')).toBeInTheDocument();
    expect(screen.getAllByText('4')).not.toHaveLength(0);
  });
});
