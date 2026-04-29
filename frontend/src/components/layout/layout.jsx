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
    <SidebarProvider defaultOpen={getSidebarDefaultOpen()}>
      <div className="relative min-h-screen bg-background w-full">
        {/* Skip link for keyboard navigation */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:border focus:border-border focus:rounded-md focus:shadow-lg"
        >
          Skip to main content
        </a>
        <OmniBar />
        <div className="flex pt-14 w-full">
          <Sidebar>
            <AppSidebar sidebar={sidebar} />
          </Sidebar>
          <SidebarInset className="p-4 flex-1 min-w-0 flex flex-col">
            <main id="main-content" className="w-full flex-1">
              <PageBreadcrumb />
              {children}
            </main>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}
