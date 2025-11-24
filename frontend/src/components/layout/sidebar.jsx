import {
  LayoutDashboard,
  Calendar,
  Inbox,
  Users,
  Settings,
  Activity,
  FileText,
  Pill,
  FlaskConical,
  CreditCard,
  Shield,
  Package,
  Clock
} from "lucide-react"

import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarFooter,
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
    primary: {
      commandCenter: ['admin', 'doctor', 'nurse', 'receptionist', 'practitioner', 'physician'],
      schedule: ['admin', 'doctor', 'nurse', 'receptionist', 'practitioner', 'physician'],
      availability: ['admin', 'doctor', 'practitioner', 'physician'],
      encounters: ['admin', 'doctor', 'nurse', 'receptionist', 'practitioner', 'physician'],
      inbox: ['admin', 'doctor', 'nurse', 'practitioner', 'physician'],
      patients: ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician', 'pharmacist', 'billing', 'practitioner', 'physician'],
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

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Menu</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {hasAccess(userRole, menuItems.primary.commandCenter) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Command Center" href="/dashboard/provider">
                  <LayoutDashboard />
                  <span>Command Center</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.primary.schedule) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Schedule" href="/appointments">
                  <Calendar />
                  <span>Schedule</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.primary.availability) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Availability" href="/practitioner-availability">
                  <Clock />
                  <span>Availability</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.primary.encounters) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Encounters" href="/encounters">
                  <FileText />
                  <span>Encounters</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.primary.inbox) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Inbox" href="/inbox">
                  <Inbox />
                  <span>Inbox</span>
                  <SidebarMenuBadge>3</SidebarMenuBadge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.primary.patients) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Patient Directory" href="/patients">
                  <Users />
                  <span>Patient Directory</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      {/* Management Section - Collapsible or separate group */}
      <SidebarGroup>
        <SidebarGroupLabel>Management</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {hasAccess(userRole, menuItems.management.wards) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Wards" href="/wards">
                  <Activity />
                  <span>Wards</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.laboratory) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Laboratory" href="/laboratory">
                  <FlaskConical />
                  <span>Laboratory</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.pharmacy) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Pharmacy" href="/pharmacy">
                  <Pill />
                  <span>Pharmacy</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.billing) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Billing" href="/billing">
                  <CreditCard />
                  <span>Billing</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.inventory) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Inventory" href="/inventory">
                  <Package />
                  <span>Inventory</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.staff) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Staff" href="/staff">
                  <Shield />
                  <span>Staff</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <div className="mt-auto">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Settings" href="/settings">
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </div>

      <SidebarFooter>
        <div className="px-2 text-xs text-muted-foreground">
          HMS v2.0
        </div>
      </SidebarFooter>
    </SidebarContent>
  )
}
