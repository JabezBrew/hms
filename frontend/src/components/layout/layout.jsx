import { OmniBar } from "./OmniBar"
import { AppSidebar } from "./sidebar"
import { PageBreadcrumb } from "./PageBreadcrumb"
import {
  Sidebar,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar"

// Read sidebar state from cookie
function getSidebarDefaultOpen() {
  if (typeof document === 'undefined') return true
  const match = document.cookie.match(/(?:^|; )sidebar_state=([^;]*)/)
  if (match) {
    return match[1] === 'true'
  }
  return true
}

export function Layout({ children, sidebar }) {
  return (
    <SidebarProvider defaultOpen={getSidebarDefaultOpen()} style={{ '--app-header-height': '4rem', '--page-min-height': '0px' }}>
      <div className="relative flex min-h-svh w-full flex-col bg-background">
        {/* Skip link for keyboard navigation */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:border-border focus:rounded-md focus:shadow-lg"
        >
          Skip to main content
        </a>
        <OmniBar />
        <div className="flex min-h-0 w-full flex-1 pt-16">
          <Sidebar>
            <AppSidebar sidebar={sidebar} />
          </Sidebar>
          <SidebarInset className="flex min-w-0 flex-1 flex-col p-3 sm:p-4 lg:p-6">
            <main id="main-content" tabIndex={-1} data-perf-ready="app-shell" className="flex w-full min-w-0 flex-1 flex-col focus:outline-none">
              <PageBreadcrumb />
              {children}
            </main>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}
