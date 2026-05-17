import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/features/discharge/api', () => ({
  dischargeApi: {
    requestCase: vi.fn(),
  },
}))

vi.mock('@/features/discharge/components/DischargeCasePanel', () => ({
  DischargeCasePanel: () => null,
}))

import { useAuth } from '@/lib/auth'
import { admissionsApi } from '@/features/admissions/api'
import { dischargeApi } from '@/features/discharge/api'

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
            <Route path="/nursing/discharges" element={<div>Nursing Discharges</div>} />
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

  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__
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

  it('requests a discharge case through Rust V2 mode and opens the nursing queue', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
    useAuth.mockReturnValue({
      user: { id: 'user-1', user_type: 'doctor' },
    })
    admissionsApi.getAdmission.mockResolvedValue({
      id: 'adm-3',
      patient: 'pat-3',
      patient_name: 'Esi Boateng',
      bed: null,
      bed_details: null,
      status: 'admitted',
      admission_type: 'emergency',
      admission_date: '2026-04-01T08:00:00Z',
      expected_discharge_date: null,
      actual_discharge_date: null,
      daily_rate: '200.00',
      length_of_stay: 1,
      total_cost: '200.00',
      admission_case_id: null,
      is_billed: false,
      admitting_doctor_details: null,
    })
    dischargeApi.requestCase.mockResolvedValue({
      id: 'discharge-3',
      admission: 'adm-3',
      patient: 'pat-3',
      status: 'ready_for_finalization',
    })

    renderPage('/admissions/adm-3')

    expect(await screen.findByText('Esi Boateng')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /request discharge/i }))

    expect(dischargeApi.requestCase).toHaveBeenCalledWith('adm-3')
    expect(await screen.findByText('Nursing Discharges')).toBeInTheDocument()
  })

  it('keeps the medical discharge workflow available outside Rust V2 mode', async () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }
    admissionsApi.getAdmission.mockResolvedValue({
      id: 'adm-4',
      patient: 'pat-4',
      patient_name: 'Kojo Mensah',
      bed: null,
      bed_details: null,
      status: 'admitted',
      admission_type: 'emergency',
      admission_date: '2026-04-01T08:00:00Z',
      expected_discharge_date: null,
      actual_discharge_date: null,
      daily_rate: '200.00',
      length_of_stay: 1,
      total_cost: '200.00',
      admission_case_id: null,
      is_billed: false,
      admitting_doctor_details: null,
    })

    renderPage('/admissions/adm-4')

    expect(await screen.findByRole('button', { name: /medical discharge/i })).toBeInTheDocument()
  })
})
