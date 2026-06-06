import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import WardBoardPage from '../WardBoardPage';
import {
  useWardBoard,
  useWardBoardContext,
  useWardBoardLiveUpdates,
  useWardBoardTaskAction,
  useWardBoardPatient,
} from '@/features/ward-board/hooks';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

vi.mock('@/features/ward-board/hooks', () => ({
  useWardBoard: vi.fn(),
  useWardBoardContext: vi.fn(),
  useWardBoardLiveUpdates: vi.fn(),
  useWardBoardTaskAction: vi.fn(),
  useWardBoardPatient: vi.fn(),
}));

vi.mock('@/lib/api/v2/runtime', () => ({
  isRustV2ApiMode: vi.fn(() => false),
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
const mockUseWardBoardContext = vi.mocked(useWardBoardContext);
const mockUseWardBoardLiveUpdates = vi.mocked(useWardBoardLiveUpdates);
const mockUseWardBoardTaskAction = vi.mocked(useWardBoardTaskAction);
const mockUseWardBoardPatient = vi.mocked(useWardBoardPatient);
const mockIsRustV2ApiMode = vi.mocked(isRustV2ApiMode);

function boardResponse(overrides = {}) {
  return {
    count: 24,
    next: '/api/ward-board/?page=3',
    previous: '/api/ward-board/?page=1',
    summary: {
      total_patients: 24,
      open_tasks: 4,
      critical: 1,
      due_medications: 1,
      pending_results: 1,
      discharge_blockers: 0,
      due_work: 2,
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
        active_alert_count: 1,
        critical_alert_count: 1,
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

function LocationProbe({ onLocation }) {
  const location = useLocation();
  useEffect(() => {
    onLocation(location);
  }, [location, onLocation]);
  return null;
}

function renderPageWithLocation(route, onLocation) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/ward-board"
          element={(
            <>
              <WardBoardPage />
              <LocationProbe onLocation={onLocation} />
            </>
          )}
        />
        <Route
          path="/wards/:wardId/board"
          element={(
            <>
              <WardBoardPage />
              <LocationProbe onLocation={onLocation} />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('WardBoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRustV2ApiMode.mockReturnValue(false);
    mockUseWardBoard.mockReturnValue({
      data: boardResponse(),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseWardBoardTaskAction.mockReturnValue({ mutate: vi.fn() });
    mockUseWardBoardContext.mockReturnValue({
      data: {
        assigned_wards: [],
        default_ward_id: null,
        can_view_all_wards: true,
        default_route: '/ward-board',
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
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

  it('reads ward board filters from query params and renders patient rows', async () => {
    renderPage('/ward-board?ward=ward-1&view=results&search=cbc&page=2&page_size=10');

    expect(mockUseWardBoard.mock.calls.at(-1)[0]).toEqual({
      ward: 'ward-1',
      view: 'results',
      search: 'cbc',
      page: 2,
      page_size: 10,
    });
    expect(screen.getByText('Ward A')).toBeInTheDocument();
    expect(screen.getByText(/Ward Board · Live clinical task board/)).toBeInTheDocument();
    expect(await screen.findAllByText('Ama Mensah')).not.toHaveLength(0);
    expect(await screen.findByRole('tab', { name: /Results/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('passes patient-scoped board query params into the ward board query', () => {
    renderPage('/ward-board?patient=patient-1');

    expect(mockUseWardBoard.mock.calls.at(-1)[0]).toEqual({
      patient: 'patient-1',
      view: 'by-patient',
      page: 1,
      page_size: 25,
    });
  });

  it('preserves patient filters when the Rust V2 resolver redirects to the default ward', async () => {
    mockIsRustV2ApiMode.mockReturnValue(true);
    mockUseWardBoardContext.mockReturnValue({
      data: {
        assigned_wards: [{
          assignment_id: 'assignment-1',
          ward_id: 'ward-default',
          ward_name: 'Default Ward',
          role_name: 'Staff Nurse',
          is_primary: true,
        }],
        default_ward_id: 'ward-default',
        can_view_all_wards: false,
        default_route: '/wards/ward-default/board',
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const locations = [];

    renderPageWithLocation('/ward-board?patient=patient-1&view=discharge', (location) => {
      locations.push({
        pathname: location.pathname,
        search: location.search,
        state: location.state,
      });
    });

    await waitFor(() => {
      expect(locations.at(-1)?.pathname).toBe('/wards/ward-default/board');
    });
    expect(locations.at(-1)?.search).toBe('?view=discharge&page=1');
    expect(locations.at(-1)?.state?.['wardBoard:privateFilters']).toEqual({
      search: '',
      patient: 'patient-1',
    });
    await waitFor(() => {
      expect(mockUseWardBoard.mock.calls.at(-1)[0]).toEqual({
        ward: 'ward-default',
        patient: 'patient-1',
        view: 'discharge',
        page: 1,
        page_size: 25,
      });
    });
  });

  it('uses the route ward id ahead of the ward query param for ward-specific boards', () => {
    renderPage('/wards/ward-7/board?ward=ignored&view=by-urgency&page_size=30', '/wards/:wardId/board');

    expect(mockUseWardBoard.mock.calls.at(-1)[0]).toEqual({
      ward: 'ward-7',
      view: 'by-urgency',
      page: 1,
      page_size: 30,
    });
    expect(screen.getByText('Ward A')).toBeInTheDocument();
  });

  it('shows the empty board state when no patients match', async () => {
    mockUseWardBoard.mockReturnValue({
      data: boardResponse({ count: 0, results: [] }),
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage('/ward-board?view=my-work');

    expect(await screen.findByText('No ward board patients')).toBeInTheDocument();
    expect(mockUseWardBoard.mock.calls.at(-1)[0]).toEqual({
      view: 'my-work',
      page: 1,
      page_size: 25,
    });
  });

  it('renders lightweight backend count fields when rows do not include nested arrays', async () => {
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
            due_medication_count: 1,
            pending_lab_order_count: 3,
            open_discharge_blocker_count: 2,
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

    expect(await screen.findAllByText('Kofi Owusu')).not.toHaveLength(0);
    expect(await screen.findAllByText('1 active')).not.toHaveLength(0);
    expect(await screen.findByText('Open Tasks')).toBeInTheDocument();
    expect(await screen.findByText('Meds Due')).toBeInTheDocument();
    expect(screen.getAllByText('3')).not.toHaveLength(0);
  });

  it('opens patient work in a side drawer from a stable patient row', async () => {
    renderPage('/ward-board');

    const patientRows = await screen.findAllByLabelText(/Open ward-board details for Ama Mensah/);
    fireEvent.click(patientRows[0]);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Patient Work')).toBeInTheDocument();
    expect(screen.getAllByText('Review medication chart')).not.toHaveLength(0);
  });

  it('uses assigned-ward switching instead of an all-ward selector on ward boards', async () => {
    mockIsRustV2ApiMode.mockReturnValue(true);
    mockUseWardBoardContext.mockReturnValue({
      data: {
        assigned_wards: [
          {
            assignment_id: 'assignment-a',
            ward_id: 'ward-a',
            ward_name: 'Medical Ward',
            role_name: 'Staff Nurse',
            is_primary: true,
          },
          {
            assignment_id: 'assignment-b',
            ward_id: 'ward-b',
            ward_name: 'Surgical Ward',
            role_name: 'Staff Nurse',
            is_primary: false,
          },
        ],
        default_ward_id: 'ward-a',
        can_view_all_wards: false,
        default_route: '/wards/ward-a/board',
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage('/wards/ward-a/board', '/wards/:wardId/board');

    expect(await screen.findByText('Medical Ward')).toBeInTheDocument();
    expect(await screen.findByLabelText('Assigned ward')).toBeInTheDocument();
    expect(screen.queryByText('All Wards')).not.toBeInTheDocument();
  });
});
