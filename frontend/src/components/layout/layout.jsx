import { Header } from "./header"
import { AppSidebar } from "./sidebar"
import {
  Sidebar,
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar"

export function Layout({ children }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="relative min-h-screen bg-background">
        <Header />
        <div className="flex pt-14">
          <Sidebar>
            <AppSidebar />
          </Sidebar>
          <SidebarInset className="p-4">
            <div className="container mx-auto">
              {children}
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  )
}
