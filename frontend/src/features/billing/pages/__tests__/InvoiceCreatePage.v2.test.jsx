import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import InvoiceCreatePage from '../InvoiceCreatePage';
import { patientsApi } from '@/lib/api/patients';
import { apiClient } from '@/lib/api-client';

vi.mock('@/features/billing/hooks', () => ({
  useCreateInvoice: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useServices: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/components/patients/PatientSelector', () => ({
  default: () => <div data-testid="patient-selector" />,
}));

vi.mock('@/lib/api/patients', () => ({
  patientsApi: {
    getPatient: vi.fn(),
  },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe('InvoiceCreatePage Rust V2 bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientsApi.getPatient.mockResolvedValue({
      id: 'patient-1',
      first_name: 'Ama',
      last_name: 'Mensah',
      medical_record_number: 'MRN-MAIN-2026-000001',
    });
    apiClient.get.mockRejectedValue(new Error('legacy patient endpoint should not be called'));
  });

  it('loads a preselected patient through the patient API bridge', async () => {
    render(
      <MemoryRouter initialEntries={['/billing/invoices/new?patient=patient-1']}>
        <Routes>
          <Route path="/billing/invoices/new" element={<InvoiceCreatePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(patientsApi.getPatient).toHaveBeenCalledWith('patient-1');
    });
    expect(apiClient.get).not.toHaveBeenCalledWith('/patients/patient-1/');
    expect(await screen.findByText('Ama Mensah')).toBeInTheDocument();
    expect(screen.getByText('MRN: MRN-MAIN-2026-000001')).toBeInTheDocument();
  });
});
