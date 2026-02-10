import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { BreadcrumbProvider, PageBreadcrumb } from '@/components/layout/PageBreadcrumb'
import { usePageMeta } from '../usePageMeta'

function TestComponent() {
  const meta = usePageMeta({
    title: 'Test Title',
    breadcrumbs: [
      { label: 'Home', path: '/' },
      { label: 'Test', path: '/test' },
    ],
  })
  return <>{meta}<div>Content</div></>
}

function PatientRoute() {
  const navigate = useNavigate()
  const meta = usePageMeta({
    title: 'Patient | HMS',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Patient', path: '/patients/:id' },
    ],
  })

  return (
    <>
      {meta}
      <button type="button" onClick={() => navigate('/patients/2')}>
        Next Patient
      </button>
    </>
  )
}

function RouteWithMeta() {
  const navigate = useNavigate()
  const meta = usePageMeta({
    title: 'With Meta | HMS',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: 'Patient', path: '/patients/:id' },
    ],
  })

  return (
    <>
      {meta}
      <button type="button" onClick={() => navigate('/unauthorized')}>
        Go Unauthorized
      </button>
    </>
  )
}

function RouteWithoutMeta() {
  return <div>Unauthorized</div>
}

describe('usePageMeta', () => {
  it('sets document title and renders breadcrumbs', async () => {
    const { getByText } = render(
      <HelmetProvider>
        <MemoryRouter>
          <BreadcrumbProvider>
            <TestComponent />
            <PageBreadcrumb />
          </BreadcrumbProvider>
        </MemoryRouter>
      </HelmetProvider>
    )
    await waitFor(() => {
      expect(document.title).toBe('Test Title')
    })
    expect(getByText('Test')).toBeInTheDocument()
  })

  it('keeps breadcrumbs visible on param-only navigation', async () => {
    const user = userEvent.setup()

    const { getByText, getByRole } = render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/patients/1']}>
          <BreadcrumbProvider>
            <Routes>
              <Route path="/patients/:id" element={<PatientRoute />} />
            </Routes>
            <PageBreadcrumb />
          </BreadcrumbProvider>
        </MemoryRouter>
      </HelmetProvider>
    )

    expect(getByText('Patient')).toBeInTheDocument()

    await user.click(getByRole('button', { name: 'Next Patient' }))

    await waitFor(() => {
      expect(getByText('Patient')).toBeInTheDocument()
    })
  })

  it('clears stale breadcrumbs on routes without page meta', async () => {
    const user = userEvent.setup()

    const { getByRole, queryByText } = render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/patients/1']}>
          <BreadcrumbProvider>
            <Routes>
              <Route path="/patients/:id" element={<RouteWithMeta />} />
              <Route path="/unauthorized" element={<RouteWithoutMeta />} />
            </Routes>
            <PageBreadcrumb />
          </BreadcrumbProvider>
        </MemoryRouter>
      </HelmetProvider>
    )

    expect(queryByText('Patient')).toBeInTheDocument()
    await user.click(getByRole('button', { name: 'Go Unauthorized' }))

    await waitFor(() => {
      expect(queryByText('Patient')).not.toBeInTheDocument()
      expect(queryByText('Patients')).not.toBeInTheDocument()
    })
  })
})
