import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router-dom'
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
})
