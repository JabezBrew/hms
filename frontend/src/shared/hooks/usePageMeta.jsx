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
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <BreadcrumbSetter breadcrumbs={breadcrumbs} />
      ) : null}
    </>
  )
}

export function usePageMeta({ title, breadcrumbs }) {
  return useMemo(
    () => <PageMeta title={title} breadcrumbs={breadcrumbs} />,
    [title, JSON.stringify(breadcrumbs || [])],
  )
}
