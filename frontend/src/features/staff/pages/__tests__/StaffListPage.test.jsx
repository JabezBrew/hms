import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import StaffListPage from '../StaffListPage'
import { useStaff } from '@/features/staff/hooks'

vi.mock('@/features/staff/hooks', () => ({
  useStaff: vi.fn(),
}))

vi.mock('@/components/staff/StaffChronicleCard', () => ({
  StaffChronicleCard: ({ staff }) => <div data-testid="staff-card">{staff?.name}</div>,
}))

vi.mock('@/components/ui/VirtualizedGrid', () => ({
  default: ({ items, renderItem }) => (
    <div data-testid="virtualized-grid">
      {items.map((item, index) => (
        <div key={item?.id || index}>{renderItem(item, index)}</div>
      ))}
    </div>
  ),
}))

vi.mock('@/components/ui/VirtualizedList', () => ({
  default: ({ items, renderItem }) => (
    <div data-testid="virtualized-list">
      {items.map((item, index) => (
        <div key={item?.id || index}>{renderItem(item, index)}</div>
      ))}
    </div>
  ),
}))

const mockUseStaff = vi.mocked(useStaff)

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
    employee_id: 'EMP-1001',
  },
  {
    id: 'staff-2',
    name: 'Ben Mensah',
    user_type: 'nurse',
    department: 'Ward A',
    employee_id: 'EMP-1002',
  },
  {
    id: 'staff-3',
    name: 'Clara Owusu',
    user_type: 'receptionist',
    department: 'Front Desk',
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
      data: { results: staffResults },
      isLoading: false,
      refetch: vi.fn(),
    })
  })

  it('shows role options from flattened user_type fields', async () => {
    const user = userEvent.setup()

    renderStaffListPage()

    const [roleFilter] = screen.getAllByRole('combobox')
    await user.click(roleFilter)

    expect(screen.getByRole('option', { name: 'All Roles' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Doctor' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Nurse' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Receptionist' })).toBeInTheDocument()
  })

  it('resets correctly when switching back to All Roles', async () => {
    const user = userEvent.setup()

    renderStaffListPage()

    expect(screen.getAllByTestId('staff-card')).toHaveLength(3)

    const [roleFilter] = screen.getAllByRole('combobox')
    await user.click(roleFilter)
    await user.click(screen.getByRole('option', { name: 'Doctor' }))

    await waitFor(() => {
      const cards = screen.getAllByTestId('staff-card')
      expect(cards).toHaveLength(1)
      expect(screen.getByText('Alice Carter')).toBeInTheDocument()
    })

    await user.click(roleFilter)
    await user.click(screen.getByRole('option', { name: 'All Roles' }))

    await waitFor(() => {
      expect(screen.getAllByTestId('staff-card')).toHaveLength(3)
    })
  })
})
