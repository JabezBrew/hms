import { useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { BreadcrumbSetter } from '@/components/layout/PageBreadcrumb'

export function PageMeta({ title, breadcrumbs }) {
  return (
    <>
      {title ? (
        <Helmet>
          <title>{title}</title>
        </Helmet>
      ) : null}
      <BreadcrumbSetter breadcrumbs={breadcrumbs} />
    </>
  )
}

export function usePageMeta({ title, breadcrumbs }) {
  return useMemo(
    () => <PageMeta title={title} breadcrumbs={breadcrumbs} />,
    [title, JSON.stringify(breadcrumbs || [])],
  )
}
