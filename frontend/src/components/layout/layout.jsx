import { OmniBar } from "./OmniBar"
import { AppSidebar } from "./sidebar"
import { PageBreadcrumb } from "./PageBreadcrumb"
import { ReadOnlyBanner } from '@/components/readonly'
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
    <SidebarProvider defaultOpen={getSidebarDefaultOpen()}>
      <div className="relative min-h-svh bg-background w-full">
        {/* Skip link for keyboard navigation */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:border-ring focus:rounded-md focus:shadow-lg"
        >
          Skip to main content
        </a>
        <OmniBar />
        <div className="flex min-h-svh pt-16 w-full">
          <Sidebar>
            <AppSidebar sidebar={sidebar} />
          </Sidebar>
          <SidebarInset className="p-3 sm:p-5 lg:p-6 flex-1 min-w-0 flex flex-col">
            <main id="main-content" tabIndex={-1} data-perf-ready="app-shell" className="w-full min-w-0 flex-1">
              <ReadOnlyBanner />
              <PageBreadcrumb />
              {children}
            </main>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}
