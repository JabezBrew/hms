import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FacilitySwitcher } from '../FacilitySwitcher'

vi.mock('@/hooks/useSystemQueries', () => ({
  useSystemCapabilities: vi.fn(),
}))

vi.mock('@/hooks/useFacilityQueries', () => ({
  useFacilities: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/runtime-config', () => ({
  getDefaultFacilityCode: () => 'MAIN',
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import { useSystemCapabilities } from '@/hooks/useSystemQueries'
import { useFacilities } from '@/hooks/useFacilityQueries'
import { useAuth } from '@/lib/auth'

describe('FacilitySwitcher', () => {
  beforeEach(() => {
    useSystemCapabilities.mockReset()
    useFacilities.mockReset()
    useAuth.mockReset()

    useSystemCapabilities.mockReturnValue({ data: undefined })
    useFacilities.mockReturnValue({
      data: [
        { code: 'MAIN', name: 'Main Campus' },
        { code: 'EAST', name: 'East Clinic' },
      ],
      isLoading: false,
      isError: false,
    })
    useAuth.mockReturnValue({
      facilityCode: 'MAIN',
      setFacilityCode: vi.fn(),
    })
  })

  it('does not render while backend capabilities are unknown', () => {
    render(<FacilitySwitcher />)

    expect(screen.queryByRole('button', { name: /MAIN/i })).not.toBeInTheDocument()
    expect(useFacilities).not.toHaveBeenCalled()
  })

  it('does not render when backend explicitly disables the facility switcher', () => {
    useSystemCapabilities.mockReturnValue({
      data: {
        features: { facility_switcher: false },
        capabilities: { facility_switcher: true, multi_facility_mode: true },
      },
    })

    render(<FacilitySwitcher />)

    expect(screen.queryByRole('button', { name: /MAIN/i })).not.toBeInTheDocument()
    expect(useFacilities).not.toHaveBeenCalled()
  })

  it('does not render for multi-facility mode without the facility switcher capability', () => {
    useSystemCapabilities.mockReturnValue({
      data: {
        features: { multi_facility: true },
        capabilities: { multi_facility_mode: true },
      },
    })

    render(<FacilitySwitcher />)

    expect(screen.queryByRole('button', { name: /MAIN/i })).not.toBeInTheDocument()
    expect(useFacilities).not.toHaveBeenCalled()
  })

  it('renders when backend explicitly enables the facility switcher', () => {
    useSystemCapabilities.mockReturnValue({
      data: {
        features: { facility_switcher: true },
        capabilities: { facility_switcher: true, multi_facility_mode: true },
      },
    })

    render(<FacilitySwitcher />)

    expect(screen.getByRole('button', { name: /MAIN/i })).toBeInTheDocument()
    expect(useFacilities).toHaveBeenCalled()
  })
})
