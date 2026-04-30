import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider } from '@/components/ui/sidebar'
import { SIDEBARS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'
import { resolveSidebarSections, SidebarRenderer } from '../sidebar'

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

function renderSidebar({
  sidebar = SIDEBARS.GLOBAL,
  user = { role: ROLES.ADMIN },
  route = '/',
  params = {},
  enabledFeatures,
  inboxCount = 0,
} = {}) {
  const sections = resolveSidebarSections({
    sidebar,
    user,
    enabledFeatures,
    inboxCount,
    location: { pathname: route },
    params,
  })

  return render(
    <MemoryRouter initialEntries={[route]}>
      <SidebarProvider>
        <SidebarRenderer sections={sections} badges={{ inbox: inboxCount }} />
      </SidebarProvider>
    </MemoryRouter>,
  )
}

describe('dynamic sidebar', () => {
  it('filters contextual items by role', () => {
    renderSidebar({
      sidebar: SIDEBARS.LABORATORY,
      user: { role: ROLES.NURSE },
      route: '/laboratory/orders',
      enabledFeatures: { laboratory: true },
    })

    expect(screen.getByRole('link', { name: /Collection Queue/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Orders/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Catalog/i })).not.toBeInTheDocument()
  })

  it('filters contextual items by feature flag', () => {
    renderSidebar({
      sidebar: SIDEBARS.ADMIN,
      user: { role: ROLES.ADMIN },
      route: '/admin/organization',
      enabledFeatures: { department_rosters: false },
    })

    expect(screen.getByRole('link', { name: /Organization/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Duty Roster/i })).not.toBeInTheDocument()
  })

  it('marks the active leaf item', () => {
    renderSidebar({
      sidebar: SIDEBARS.BILLING,
      user: { role: ROLES.BILLING },
      route: '/billing/invoices',
      enabledFeatures: { billing: true },
    })

    expect(screen.getByRole('link', { name: /Invoices/i })).toHaveAttribute('data-active', 'true')
  })

  it('opens and marks a global parent group when a child route is active', () => {
    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.LAB_TECHNICIAN },
      route: '/laboratory/orders',
      enabledFeatures: { laboratory: true },
    })

    expect(screen.getByRole('button', { name: /Laboratory/i })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('link', { name: /Orders/i })).toHaveAttribute('data-active', 'true')
  })

  it('renders role-aware shortcuts for contextual sidebars', () => {
    renderSidebar({
      sidebar: SIDEBARS.PATIENT_WORKSPACE,
      user: { role: ROLES.DOCTOR },
      route: '/patients/pat-123',
      params: { id: 'pat-123' },
      inboxCount: 4,
    })

    expect(screen.getByText('Shortcuts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Dashboard/i })).toHaveAttribute('href', '/dashboards/inpatient')
    expect(screen.getByRole('link', { name: /Inbox/i })).toBeInTheDocument()
  })

  it('resolves patient workspace links without clinical-data sidebar entries', () => {
    renderSidebar({
      sidebar: SIDEBARS.PATIENT_WORKSPACE,
      user: { role: ROLES.DOCTOR },
      route: '/patients/pat-123',
      params: { id: 'pat-123' },
      enabledFeatures: { wards: true },
    })

    expect(screen.getByRole('link', { name: /Chronicle/i })).toHaveAttribute('href', '/patients/pat-123')
    expect(screen.getByRole('link', { name: /Edit Demographics/i })).toHaveAttribute('href', '/patients/pat-123/edit')
    expect(screen.getByRole('link', { name: /Ward Round/i })).toHaveAttribute('href', '/patients/pat-123/ward-round')

    expect(screen.queryByRole('link', { name: /Vitals/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Medications/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Labs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Notes/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Allergies/i })).not.toBeInTheDocument()
  })

  it('hides feature-gated entries until feature flags are known', () => {
    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.LAB_TECHNICIAN },
      route: '/laboratory/orders',
    })

    expect(screen.queryByRole('button', { name: /Laboratory/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Orders/i })).not.toBeInTheDocument()
  })
})
