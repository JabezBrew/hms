import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PatientPage from '../PatientPage';

const mocks = vi.hoisted(() => ({
  role: 'receptionist',
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/patients/patient-1?mode=test']}>
      <Routes>
        <Route path="/patients/:id" element={<PatientPage />} />
        <Route path="/patients/:id/profile" element={<div>Administrative profile</div>} />
        <Route path="/patients/:id/chronicle" element={<div>Clinical Chronicle</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PatientPage compatibility redirect', () => {
  beforeEach(() => {
    mocks.role = 'receptionist';
  });

  it('routes registration staff to the administrative patient profile', () => {
    renderRoute();

    expect(screen.getByText('Administrative profile')).toBeInTheDocument();
  });

  it('routes clinical users to Patient Chronicle', () => {
    mocks.role = 'doctor';

    renderRoute();

    expect(screen.getByText('Clinical Chronicle')).toBeInTheDocument();
  });
});
