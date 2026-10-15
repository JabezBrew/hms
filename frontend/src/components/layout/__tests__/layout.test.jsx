import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CareAreaScaffold } from '@/features/care-areas/components/CareAreaScaffold'
import { Layout } from '../layout'

vi.mock('../OmniBar', () => ({ OmniBar: () => <header>Global tools</header> }))
vi.mock('../sidebar', () => ({ AppSidebar: () => <nav aria-label="Main navigation" /> }))
vi.mock('../PageBreadcrumb', () => ({ PageBreadcrumb: () => null }))
vi.mock('@/shared/hooks/usePageMeta', () => ({ usePageMeta: () => null }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

describe('clinical application landmarks', () => {
  it('provides one main landmark for a clinical work area and a focusable skip destination', () => {
    render(
      <MemoryRouter>
        <Layout>
          <CareAreaScaffold
            title="Outpatient"
            description="Clinic work"
            breadcrumb={{ label: 'Outpatient', path: '/care-areas/outpatient' }}
          >
            <p>Current clinic work</p>
          </CareAreaScaffold>
        </Layout>
      </MemoryRouter>,
    )

    const landmarks = screen.getAllByRole('main')
    expect(landmarks).toHaveLength(1)
    expect(landmarks[0]).toHaveAttribute('id', 'main-content')
    expect(landmarks[0]).toHaveAttribute('tabindex', '-1')
    expect(landmarks[0]).toHaveTextContent('Current clinic work')
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content')
  })
})
