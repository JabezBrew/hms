import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import StaffListPage from '../StaffListPage'
import { useStaff, useStaffFilterFacets } from '@/features/staff/hooks'

vi.mock('@/features/staff/hooks', () => ({
  useStaff: vi.fn(),
  useStaffFilterFacets: vi.fn(),
}))

vi.mock('@/components/ui/VirtualizedTable', () => ({
  default: ({ rows }) => (
    <div data-testid="virtualized-table">
      {rows.map((row, index) => (
        <div key={row?.id || index} data-testid="staff-row">
          {row?.name}
        </div>
      ))}
    </div>
  ),
}))

const mockUseStaff = vi.mocked(useStaff)
const mockUseStaffFilterFacets = vi.mocked(useStaffFilterFacets)

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false
}

if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {}
}

if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {}
}

const staffResults = [
  {
    id: 'staff-1',
    name: 'Alice Carter',
    user_type: 'doctor',
    department: 'Medicine',
    position: 'Physician',
    employee_id: 'EMP-1001',
  },
  {
    id: 'staff-2',
    name: 'Ben Mensah',
    user_type: 'nurse',
    department: 'Ward A',
    position: 'Ward Nurse',
    employee_id: 'EMP-1002',
  },
  {
    id: 'staff-3',
    name: 'Clara Owusu',
    user_type: 'receptionist',
    department: 'Front Desk',
    position: 'Receptionist',
    employee_id: 'EMP-1003',
  },
]

function renderStaffListPage() {
  return render(
    <MemoryRouter>
      <StaffListPage />
    </MemoryRouter>
  )
}

describe('StaffListPage role filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseStaff.mockReturnValue({
      data: {
        results: staffResults,
        count: 3,
        count_exact: true,
        page: 1,
        page_size: 25,
        next: null,
      },
      isLoading: false,
      refetch: vi.fn(),
    })
    mockUseStaffFilterFacets.mockReturnValue({
      data: {
        departments: [
          { value: 'Medicine', label: 'Medicine', count: 1 },
          { value: 'Ward A', label: 'Ward A', count: 1 },
          { value: 'Front Desk', label: 'Front Desk', count: 1 },
        ],
        positions: [
          { value: 'Physician', label: 'Physician', count: 1 },
          { value: 'Ward Nurse', label: 'Ward Nurse', count: 1 },
          { value: 'Receptionist', label: 'Receptionist', count: 1 },
        ],
      },
      isLoading: false,
    })
  })

  it('shows position options from server-backed facets', async () => {
    const user = userEvent.setup()

    renderStaffListPage()

    const [roleFilter] = screen.getAllByRole('combobox')
    await user.click(roleFilter)

    expect(screen.getByRole('option', { name: 'All Positions' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Physician (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ward Nurse (1)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Receptionist (1)' })).toBeInTheDocument()
  })

  it('resets correctly when switching back to All Positions', async () => {
    const user = userEvent.setup()

    renderStaffListPage()

    expect(screen.getAllByTestId('staff-row')).toHaveLength(3)

    const [roleFilter] = screen.getAllByRole('combobox')
    await user.click(roleFilter)
    await user.click(screen.getByRole('option', { name: 'Physician (1)' }))

    await waitFor(() => {
      expect(mockUseStaff.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
        position: 'Physician',
      }))
    })

    await user.click(roleFilter)
    await user.click(screen.getByRole('option', { name: 'All Positions' }))

    await waitFor(() => {
      expect(mockUseStaff.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
        position: undefined,
      }))
    })
  })

  it('requests inactive staff only when the inactive toggle is enabled', async () => {
    const user = userEvent.setup()

    renderStaffListPage()

    expect(mockUseStaff.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
      is_active: true,
    }))

    await user.click(screen.getByRole('switch', { name: 'Show inactive staff' }))

    await waitFor(() => {
      expect(mockUseStaff.mock.calls.at(-1)[0]).toEqual(expect.objectContaining({
        is_active: undefined,
      }))
    })
  })
})
