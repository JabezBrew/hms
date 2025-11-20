import { Header } from "./header"
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
        <Header />
        <div className="flex pt-14 w-full">
          <Sidebar>
            <AppSidebar />
          </Sidebar>
          <SidebarInset className="p-4 flex-1 min-w-0 flex flex-col">
            <div className="w-full flex-1">
              <PageBreadcrumb />
              {children}
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}
