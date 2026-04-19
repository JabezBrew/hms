import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb'
import AdmissionDetailPage from '../AdmissionDetailPage.jsx'

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/features/admissions/api', () => ({
  admissionsApi: {
    getAdmission: vi.fn(),
  },
}))

import { useAuth } from '@/lib/auth'
import { admissionsApi } from '@/features/admissions/api'

function renderPage(initialEntry = '/admissions/adm-1') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <BreadcrumbProvider>
          <Routes>
            <Route path="/admissions/:admissionId" element={<AdmissionDetailPage />} />
            <Route path="/wards/:wardId" element={<div>Ward Detail</div>} />
            <Route path="/wards" element={<div>Ward List</div>} />
            <Route path="/patients/:patientId" element={<div>Patient Detail</div>} />
          </Routes>
        </BreadcrumbProvider>
      </MemoryRouter>
    </HelmetProvider>
  )
}

describe('AdmissionDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({
      user: { id: 'user-1', user_type: 'receptionist' },
    })
  })

  it('renders admission details from serializer response where bed is an ID and bed_details carries ward info', async () => {
    admissionsApi.getAdmission.mockResolvedValue({
      id: 'adm-1',
      patient: 'pat-1',
      patient_details: {
        id: 'pat-1',
        user_details: {
          first_name: 'Jane',
          last_name: 'Doe',
        },
      },
      bed: 'bed-7',
      bed_details: {
        id: 'bed-7',
        bed_number: 'B-12',
        ward_details: {
          id: 'ward-3',
          name: 'Medical Ward',
        },
      },
      status: 'admitted',
      admission_type: 'emergency',
      admission_date: '2026-04-01T08:00:00Z',
      expected_discharge_date: '2026-04-04T08:00:00Z',
      actual_discharge_date: null,
      daily_rate: '200.00',
      length_of_stay: 3,
      total_cost: '600.00',
      admission_case_id: null,
      is_billed: false,
      admitting_doctor_details: {
        staff_details: {
          user_details: {
            first_name: 'John',
            last_name: 'Smith',
          },
        },
      },
    })

    renderPage('/admissions/adm-1')

    expect(await screen.findByText('Medical Ward - Bed B-12')).toBeInTheDocument()
    expect(screen.getByText('Patient ID: pat-1')).toBeInTheDocument()
    expect(screen.getByText('John Smith')).toBeInTheDocument()
  })

  it('handles sparse admissions without crashing when optional nested fields are missing', async () => {
    admissionsApi.getAdmission.mockResolvedValue({
      id: 'adm-2',
      patient: null,
      bed: null,
      bed_details: null,
      status: 'admitted',
      admission_type: null,
      admission_date: null,
      expected_discharge_date: null,
      actual_discharge_date: null,
      daily_rate: null,
      length_of_stay: null,
      total_cost: null,
      admission_case_id: null,
      is_billed: false,
      admitting_doctor_details: null,
    })

    renderPage('/admissions/adm-2')

    expect(await screen.findByText('Admission Summary')).toBeInTheDocument()
    expect(screen.getByText('Not specified')).toBeInTheDocument()
    expect(screen.getAllByText('Not assigned').length).toBeGreaterThan(0)
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
  })
})
