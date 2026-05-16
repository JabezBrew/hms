import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PatientDetail from './PatientDetail';

const patient = {
  local_data: {
    id: 'patient-1',
    medical_record_number: 'MRN-001',
    user_details: {
      first_name: 'Ama',
      last_name: 'Mensah',
      email: 'ama@example.test',
      phone_number: '0240000000',
    },
    date_of_birth: '1990-01-01',
    gender: 'female',
    address: 'Accra',
    allergies: 'None',
  },
};

describe('PatientDetail Rust V2 guards', () => {
  afterEach(() => {
    delete window.__HMS_RUNTIME_CONFIG__;
  });

  it('hides patient deletion in Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' };

    render(
      <PatientDetail
        patient={patient}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/patient deletion is not available in rust v2/i)).toBeInTheDocument();
  });

  it('keeps patient deletion available outside Rust V2 mode', () => {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };

    render(
      <PatientDetail
        patient={patient}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(screen.queryByText(/patient deletion is not available in rust v2/i)).not.toBeInTheDocument();
  });
});
