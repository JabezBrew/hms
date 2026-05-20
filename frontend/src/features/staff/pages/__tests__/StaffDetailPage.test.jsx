import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import StaffDetailPage from '../StaffDetailPage'
import { usePractitioner, usePractitioners, useStaffMember } from '@/features/staff/hooks'

vi.mock('@/features/staff/hooks', () => ({
  useStaffMember: vi.fn(),
  usePractitioner: vi.fn(),
  usePractitioners: vi.fn(),
}))

vi.mock('@/components/staff/StaffDetail', () => ({
  default: ({ staff, practitioner }) => (
    <div>
      <div data-testid="staff-name">{staff?.name}</div>
      <div data-testid="practitioner-license">{practitioner?.license_number || 'none'}</div>
    </div>
  ),
}))

const mockUseStaffMember = vi.mocked(useStaffMember)
const mockUsePractitioner = vi.mocked(usePractitioner)
const mockUsePractitioners = vi.mocked(usePractitioners)

function renderStaffDetailPage() {
  return render(
    <MemoryRouter initialEntries={['/staff/staff-1']}>
      <Routes>
        <Route path="/staff/:id" element={<StaffDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StaffDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseStaffMember.mockReturnValue({
      data: {
        id: 'staff-1',
        name: 'Ama Mensah',
        user_details: { user_type: 'doctor' },
      },
      isLoading: false,
      isError: false,
      error: null,
    })
    mockUsePractitioner.mockReturnValue({
      data: {
        id: 'practitioner-1',
        staff: 'staff-1',
        license_number: 'MDC-001',
      },
      isLoading: false,
    })
    mockUsePractitioners.mockReturnValue({
      data: [],
      isLoading: false,
    })
  })

  it('loads the practitioner profile through direct detail fetch instead of a list-and-find query', () => {
    renderStaffDetailPage()

    expect(mockUsePractitioner).toHaveBeenCalledWith(
      'staff-1',
      expect.objectContaining({ enabled: true, retry: false }),
    )
    expect(mockUsePractitioners).not.toHaveBeenCalled()
    expect(screen.getByTestId('staff-name')).toHaveTextContent('Ama Mensah')
    expect(screen.getByTestId('practitioner-license')).toHaveTextContent('MDC-001')
  })
})
