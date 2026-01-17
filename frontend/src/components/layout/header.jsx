import PanelLeftIcon from 'lucide-react/dist/esm/icons/panel-left.js';
import LogOutIcon from 'lucide-react/dist/esm/icons/log-out.js';
import UserIcon from 'lucide-react/dist/esm/icons/user.js';
import { ThemeToggle } from "../theme-toggle"
import { useAuth } from "../../lib/auth"
import { useIsMobile } from "../../hooks/use-mobile"
import AppointmentNotifications from "../appointments/AppointmentNotifications"

// Helper function to check if a user has access to a menu item
const hasAccess = (userRole, allowedRoles) => {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) return false
  return allowedRoles.includes(userRole)
}

// Define menu items with their access roles
const menuItems = {
  dashboard: {
    overview: ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing', 'patient'],
    patients: ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing'],
    appointments: ['admin', 'doctor', 'nurse', 'receptionist'],
  },
  management: {
    wards: ['admin', 'doctor', 'nurse'],
    inventory: ['admin', 'pharmacist'],
    billing: ['admin', 'billing', 'receptionist'],
    laboratory: ['admin', 'lab_technician', 'doctor'],
    pharmacy: ['admin', 'pharmacist', 'doctor'],
    staff: ['admin'],
  }
}

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,

} from "@/components/ui/navigation-menu"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"

export function Header() {
  const { user, logout, isAuthenticated } = useAuth()
  const isMobile = useIsMobile()
  const userRole = user?.role || ''

  const handleLogout = async () => {
    await logout()
  }

  // Check if user has access to any dashboard items
  const hasDashboardAccess = 
    hasAccess(userRole, menuItems.dashboard.overview) ||
    hasAccess(userRole, menuItems.dashboard.patients) ||
    hasAccess(userRole, menuItems.dashboard.appointments)

  // Check if user has access to any management items
  const hasManagementAccess = 
    hasAccess(userRole, menuItems.management.wards) ||
    hasAccess(userRole, menuItems.management.inventory) ||
    hasAccess(userRole, menuItems.management.billing) ||
    hasAccess(userRole, menuItems.management.laboratory) ||
    hasAccess(userRole, menuItems.management.pharmacy) ||
    hasAccess(userRole, menuItems.management.staff)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center">
        {!isMobile && <SidebarTrigger className="mr-2" />}

        <div className="mr-2 flex">
          <a href="/" className="flex items-center space-x-2">
            <span className="font-bold">HMS</span>
          </a>
        </div>

        <div className="flex-1 hidden md:flex">
          <NavigationMenu>
            <NavigationMenuList>
              {hasDashboardAccess && (
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Dashboard</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid gap-3 p-4 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]">
                      <li className="row-span-3">
                        <NavigationMenuLink asChild>
                          <a
                            className="flex h-full w-full select-none flex-col justify-end rounded-md bg-gradient-to-b from-muted/50 to-muted p-6 no-underline outline-none focus:shadow-md"
                            href="/"
                          >
                            <div className="mb-2 mt-4 text-lg font-medium">
                              HMS Dashboard
                            </div>
                            <p className="text-sm leading-tight text-muted-foreground">
                              Hospital Management System Dashboard
                            </p>
                          </a>
                        </NavigationMenuLink>
                      </li>

                      {hasAccess(userRole, menuItems.dashboard.overview) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/overview"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Overview</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Hospital overview and statistics
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.dashboard.patients) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/patients"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Patients</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Patient management and records
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.dashboard.appointments) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/appointments"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Appointments</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Schedule and manage appointments
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              )}

              {hasManagementAccess && (
                <NavigationMenuItem>
                  <NavigationMenuTrigger>Management</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-[400px] gap-3 p-4 md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                      {hasAccess(userRole, menuItems.management.wards) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/wards"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Wards</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Manage hospital wards and beds
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.management.inventory) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/inventory"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Inventory</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Manage hospital inventory and supplies
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.management.billing) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/billing"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Billing</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Manage patient billing and invoices
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.management.laboratory) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/laboratory"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Laboratory</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Manage lab tests and results
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.management.pharmacy) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/pharmacy"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Pharmacy</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Manage prescriptions and medications
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}

                      {hasAccess(userRole, menuItems.management.staff) && (
                        <li>
                          <NavigationMenuLink asChild>
                            <a
                              href="/staff"
                              className="block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                            >
                              <div className="text-sm font-medium leading-none">Staff</div>
                              <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                Manage hospital staff and roles
                              </p>
                            </a>
                          </NavigationMenuLink>
                        </li>
                      )}
                    </ul>
                  </NavigationMenuContent>
                </NavigationMenuItem>
              )}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        <div className="flex items-center ml-auto space-x-2">
          {isAuthenticated && <AppointmentNotifications />}
          <ThemeToggle />

          {isAuthenticated && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full" aria-label="User menu">
                  <UserIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.name || "User"}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user?.email || ""}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground mt-1">
                      Role: <span className="font-medium capitalize">{user?.role?.replace('_', ' ') || "Unknown"}</span>
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOutIcon className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
}
