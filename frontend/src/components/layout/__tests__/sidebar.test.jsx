import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { SIDEBARS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'
import { resolveSidebarSections, SidebarRenderer } from '../sidebar'

const opsHostMock = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/features/ops/host', () => ({
  isOpsDashboardHost: vi.fn(() => opsHostMock.allowed),
}))

beforeEach(() => {
  opsHostMock.allowed = true
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1024,
  })
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

afterEach(() => {
  cleanup()
})

function renderSidebar({
  sidebar = SIDEBARS.GLOBAL,
  user = { role: ROLES.ADMIN },
  route = '/',
  params = {},
  enabledFeatures,
  inboxCount = 0,
  mobileProbe = false,
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
        {mobileProbe ? <MobileSidebarProbe /> : null}
      </SidebarProvider>
    </MemoryRouter>,
  )
}

function sidebarHasHref(sections, href) {
  const stack = sections.flatMap((section) => section.items)
  while (stack.length > 0) {
    const item = stack.shift()
    if (item?.href === href) return true
    if (Array.isArray(item?.children)) {
      stack.push(...item.children)
    }
  }
  return false
}

function MobileSidebarProbe() {
  const { openMobile, setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(true)
  }, [setOpenMobile])

  return <div data-testid="mobile-sidebar-state">{openMobile ? 'open' : 'closed'}</div>
}

describe('dynamic sidebar', () => {
  it('filters contextual items by role', () => {
    renderSidebar({
      sidebar: SIDEBARS.LABORATORY,
      user: { role: ROLES.NURSE },
      route: '/laboratory/orders',
      enabledFeatures: { laboratory: true },
    })

    expect(screen.getByRole('link', { name: /Orders/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Worklist/i })).not.toBeInTheDocument()
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
      enabledFeatures: { inpatient_admissions: true, patient_chronicle: true },
      inboxCount: 4,
    })

    expect(screen.getByText('Shortcuts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /My Work/i })).toHaveAttribute('href', '/my-work')
    expect(screen.getByRole('link', { name: /Inbox/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Patient Directory/i })).toHaveAttribute('href', '/patients')
    expect(screen.queryByRole('link', { name: /Dashboard/i })).not.toBeInTheDocument()
  })

  it('renders care-area navigation from enabled workflow modules', () => {
    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.DOCTOR },
      route: '/care-areas/outpatient',
      enabledFeatures: {
        outpatient_encounters: true,
        emergency_encounters: true,
        ward_task_board: true,
        patient_chronicle: true,
        wards: true,
        inpatient_admissions: true,
        nursing_workflows: true,
      },
    })

    expect(screen.getByRole('link', { name: /My Work/i })).toHaveAttribute('href', '/my-work')
    expect(screen.getByRole('button', { name: /Care Areas/i })).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('link', { name: /Outpatient/i })).toHaveAttribute('href', '/care-areas/outpatient')
    expect(screen.getByRole('link', { name: /Inpatient/i })).toHaveAttribute('href', '/care-areas/inpatient')
    expect(screen.getByRole('link', { name: /Emergency/i })).toHaveAttribute('href', '/care-areas/emergency')
    expect(screen.getByRole('link', { name: /Patient Directory/i })).toBeInTheDocument()
  })

  it('resolves patient workspace links without clinical-data sidebar entries', () => {
    renderSidebar({
      sidebar: SIDEBARS.PATIENT_WORKSPACE,
      user: { role: ROLES.DOCTOR },
      route: '/patients/pat-123',
      params: { id: 'pat-123' },
      enabledFeatures: { patient_chronicle: true, patient_registration: true, wards: true },
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

  it('hides patient workspace actions when patient modules are disabled', () => {
    renderSidebar({
      sidebar: SIDEBARS.PATIENT_WORKSPACE,
      user: { role: ROLES.DOCTOR },
      route: '/patients/pat-123',
      params: { id: 'pat-123' },
      enabledFeatures: { patient_chronicle: true, patient_registration: false, wards: false },
    })

    expect(screen.getByRole('link', { name: /Chronicle/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit Demographics/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ward Round/i })).not.toBeInTheDocument()
  })

  it('hides insurance claim navigation when the subfeature is disabled', () => {
    renderSidebar({
      sidebar: SIDEBARS.BILLING,
      user: { role: ROLES.BILLING },
      route: '/billing',
      enabledFeatures: { billing: true, insurance_claims: false },
    })

    expect(screen.getByRole('link', { name: /Invoices/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Claims/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /NHIS/i })).not.toBeInTheDocument()
  })

  it('hides audit navigation when the audit feature is disabled', () => {
    renderSidebar({
      sidebar: SIDEBARS.ADMIN,
      user: {
        role: ROLES.ADMIN,
        adminAccess: { capabilities: ['admin.audit.view', 'admin.organization.manage'] },
      },
      route: '/admin/organization',
      enabledFeatures: { audit: false },
    })

    expect(screen.getByRole('link', { name: /Organization/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Audit Logs/i })).not.toBeInTheDocument()
  })

  it('shows the ops dashboard only to users with the system ops capability', () => {
    const regularAdminSections = resolveSidebarSections({
      sidebar: SIDEBARS.ADMIN,
      user: { role: ROLES.ADMIN },
      location: { pathname: '/admin/organization' },
    })

    expect(sidebarHasHref(regularAdminSections, '/system/ops')).toBe(false)

    const opsAdminSections = resolveSidebarSections({
      sidebar: SIDEBARS.ADMIN,
      user: {
        role: ROLES.ADMIN,
        adminAccess: { capabilities: ['system.ops.view'] },
      },
      location: { pathname: '/system/ops' },
    })

    expect(sidebarHasHref(opsAdminSections, '/system/ops')).toBe(true)
  })

  it('hides the ops dashboard on non-ops hosts even with the system ops capability', () => {
    opsHostMock.allowed = false

    renderSidebar({
      sidebar: SIDEBARS.ADMIN,
      user: {
        role: ROLES.ADMIN,
        adminAccess: { capabilities: ['system.ops.view'] },
      },
      route: '/system/ops',
    })

    expect(screen.queryByRole('link', { name: /Ops Dashboard/i })).not.toBeInTheDocument()
  })

  it('hides feature-gated entries until feature flags are known', () => {
    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.LAB_TECHNICIAN },
      route: '/laboratory/orders',
    })

    expect(screen.queryByRole('button', { name: /Laboratory/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Orders/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Dashboard/i })).not.toBeInTheDocument()
  })

  it('keeps always-on dashboard navigation visible without feature flags', () => {
    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.ADMIN },
      route: '/dashboards/admin',
    })

    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument()
  })

  it('closes the mobile sidebar after a top-level navigation link is selected', async () => {
    window.innerWidth = 390
    const user = userEvent.setup()

    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.ADMIN },
      enabledFeatures: { patient_chronicle: true },
      mobileProbe: true,
    })

    await waitFor(() => {
      expect(screen.getByTestId('mobile-sidebar-state')).toHaveTextContent('open')
    })

    await user.click(screen.getByRole('link', { name: /Patient Directory/i }))

    expect(screen.getByTestId('mobile-sidebar-state')).toHaveTextContent('closed')
  })

  it('closes the mobile sidebar after a nested navigation link is selected', async () => {
    window.innerWidth = 390
    const user = userEvent.setup()

    renderSidebar({
      sidebar: SIDEBARS.GLOBAL,
      user: { role: ROLES.LAB_TECHNICIAN },
      route: '/laboratory/orders',
      enabledFeatures: { laboratory: true },
      mobileProbe: true,
    })

    await waitFor(() => {
      expect(screen.getByTestId('mobile-sidebar-state')).toHaveTextContent('open')
    })

    await user.click(screen.getByRole('link', { name: /Orders/i }))

    expect(screen.getByTestId('mobile-sidebar-state')).toHaveTextContent('closed')
  })
})
