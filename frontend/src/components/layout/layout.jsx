import { OmniBar } from "./OmniBar"
import { AppSidebar } from "./sidebar"
import { PageBreadcrumb } from "./PageBreadcrumb"
import {
  Sidebar,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar"

export function Layout({ children }) {
  return (
    <SidebarProvider defaultOpen={true}>
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
            <AppSidebar />
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
