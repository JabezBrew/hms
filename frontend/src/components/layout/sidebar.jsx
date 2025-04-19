import {
  LayoutIcon,
  UsersIcon,
  CalendarIcon,
  HomeIcon,
  PackageIcon,
  CreditCardIcon,
  FlaskConicalIcon,
  PillIcon,
  ShieldIcon,
} from "lucide-react"

import {
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarSeparator,
} from "@/components/ui/sidebar"

import { useAuth } from "@/lib/auth"

// Helper function to check if a user has access to a menu item
const hasAccess = (userRole, allowedRoles) => {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) return false
  return allowedRoles.includes(userRole)
}

export function AppSidebar() {
  const { user } = useAuth()
  const userRole = user?.role || ''

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
      practitionerAvailability: ['admin'],
    }
  }

  return (
    <SidebarContent>

      <SidebarGroup>
        <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {hasAccess(userRole, menuItems.dashboard.overview) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Overview" href="/overview">
                  <LayoutIcon />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.dashboard.patients) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Patients" href="/patients">
                  <UsersIcon />
                  <span>Patients</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.dashboard.appointments) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Appointments" href="/appointments">
                  <CalendarIcon />
                  <span>Appointments</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      {/* Only show Management section if user has access to at least one item */}
      {(hasAccess(userRole, menuItems.management.wards) ||
        hasAccess(userRole, menuItems.management.inventory) ||
        hasAccess(userRole, menuItems.management.billing) ||
        hasAccess(userRole, menuItems.management.laboratory) ||
        hasAccess(userRole, menuItems.management.pharmacy) ||
        hasAccess(userRole, menuItems.management.staff)) && (
        <SidebarGroup>
          <SidebarGroupLabel>Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {hasAccess(userRole, menuItems.management.wards) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Wards" href="/wards">
                    <HomeIcon />
                    <span>Wards</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasAccess(userRole, menuItems.management.inventory) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Inventory" href="/inventory">
                    <PackageIcon />
                    <span>Inventory</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasAccess(userRole, menuItems.management.billing) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Billing" href="/billing">
                    <CreditCardIcon />
                    <span>Billing</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasAccess(userRole, menuItems.management.laboratory) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Laboratory" href="/laboratory">
                    <FlaskConicalIcon />
                    <span>Laboratory</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasAccess(userRole, menuItems.management.pharmacy) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Pharmacy" href="/pharmacy">
                    <PillIcon />
                    <span>Pharmacy</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasAccess(userRole, menuItems.management.staff) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Staff Management" href="/staff">
                    <ShieldIcon />
                    <span>Staff</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {hasAccess(userRole, menuItems.management.practitionerAvailability) && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Practitioner Availability" href="/practitioner-availability">
                    <CalendarIcon />
                    <span>Availability</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      <SidebarFooter>
        <div className="px-2 text-xs text-muted-foreground">
          Hospital Management System v1.0
        </div>
      </SidebarFooter>
    </SidebarContent>
  )
}
