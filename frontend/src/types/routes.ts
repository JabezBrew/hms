import type { ComponentType } from 'react'

export type RouteLayout = 'app' | 'bare'

export interface BreadcrumbItem {
  label: string
  path: string
}

export interface AppRoute {
  path: string
  component: ComponentType<any>
  roles: readonly string[] | null
  layout: RouteLayout
  title?: string
  breadcrumbs?: BreadcrumbItem[]
  props?: Record<string, unknown>
}
