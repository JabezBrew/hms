
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Inbox from 'lucide-react/dist/esm/icons/inbox.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FileSearch from 'lucide-react/dist/esm/icons/file-search.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Droplet from 'lucide-react/dist/esm/icons/droplet.js';
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.js';
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js';
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js';
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
import { useInboxCount } from "@/hooks/useInboxCount"

// Helper function to check if a user has access to a menu item
const hasAccess = (userRole, allowedRoles) => {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) return false
  return allowedRoles.includes(userRole)
}

export function AppSidebar() {
  const { user } = useAuth()
  const userRole = user?.role || ''
  const { count: inboxCount } = useInboxCount()

  // Get role-specific dashboard URL
  // Support staff are redirected to their workflow pages instead of a generic dashboard
  const getDashboardUrl = (role) => {
    if (['nurse', 'head_nurse', 'nurse_practitioner'].includes(role)) {
      return '/dashboards/nurse';
    }
    if (['doctor', 'inpatient_doctor'].includes(role)) {
      return '/dashboards/inpatient';
    }
    if (['receptionist', 'front_desk'].includes(role)) {
      return '/dashboards/reception';
    }
    if (role === 'admin') {
      return '/dashboards/admin';
    }
    // Support staff go directly to their workflow pages
    if (['pharmacist', 'pharmacy_tech'].includes(role)) {
      return '/pharmacy/dispensing';
    }
    if (role === 'lab_technician') {
      return '/laboratory/dashboard';
    }
    if (role === 'billing') {
      return '/billing';
    }
    return '/dashboard/provider'; // Fallback to legacy dashboard
  };

  // Define menu items with their access roles
  // Note: Patient Registry is only for clinical staff who can access patient records directly.
  // Support staff (lab_technician, pharmacist, billing) access patients through their workflow pages.
  const menuItems = {
    primary: {
      dashboard: ['admin', 'doctor', 'nurse', 'receptionist', 'practitioner', 'physician', 'head_nurse', 'nurse_practitioner', 'inpatient_doctor', 'front_desk', 'pharmacist', 'lab_technician', 'billing'],
      schedule: ['admin', 'doctor', 'nurse', 'receptionist', 'practitioner', 'physician'],
      availability: ['admin', 'doctor', 'practitioner', 'physician'],
      inbox: ['admin', 'doctor', 'nurse', 'practitioner', 'physician'],
      patients: ['admin', 'doctor', 'nurse', 'receptionist', 'practitioner', 'physician', 'head_nurse', 'nurse_practitioner', 'inpatient_doctor'],
    },
    management: {
      wards: ['admin', 'doctor', 'nurse'],
      shiftHandoff: ['admin', 'nurse', 'head_nurse', 'nurse_practitioner'],
      noteTemplates: ['admin', 'doctor', 'nurse', 'practitioner', 'physician'],
      chartTemplates: ['admin', 'doctor', 'nurse', 'head_nurse', 'nurse_practitioner', 'practitioner', 'physician'],
      inventory: ['admin', 'pharmacist'],
      billing: ['admin', 'billing', 'receptionist'],
      laboratory: ['admin', 'lab_technician', 'doctor'],
      labWorklist: ['admin', 'lab_technician'],
      labCollection: ['admin', 'lab_technician', 'nurse', 'head_nurse', 'nurse_practitioner'],
      labOrders: ['admin', 'lab_technician', 'doctor', 'nurse', 'physician', 'practitioner'],
      labResults: ['admin', 'lab_technician', 'doctor', 'physician', 'practitioner'],
      pharmacy: ['admin', 'pharmacist', 'pharmacy_tech'],
      encounters: ['admin', 'billing'], // Moved here for admin/billing access only
      staff: ['admin'],
      organization: ['admin'],
      auditLogs: ['admin'],
    }
  }

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Menu</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {hasAccess(userRole, menuItems.primary.dashboard) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Dashboard" href={getDashboardUrl(userRole)}>
                  <LayoutDashboard />
                  <span>Dashboard</span>
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

            {hasAccess(userRole, menuItems.primary.inbox) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Inbox" href="/inbox">
                  <Inbox />
                  <span>Inbox</span>
                  {inboxCount > 0 && (
                    <SidebarMenuBadge>{inboxCount > 99 ? '99+' : inboxCount}</SidebarMenuBadge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.primary.patients) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Patient Registry" href="/patients">
                  <BookOpen />
                  <span>Patient Registry</span>
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

            {hasAccess(userRole, menuItems.management.shiftHandoff) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Shift Handoff" href="/nursing/shift-handoff">
                  <ArrowLeftRight />
                  <span>Shift Handoff</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.noteTemplates) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Note Templates" href="/clinical-notes/templates">
                  <ClipboardList />
                  <span>Note Templates</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.chartTemplates) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Chart Builder" href="/charts/templates">
                  <BarChart3 />
                  <span>Chart Builder</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.laboratory) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Lab Catalog" href="/laboratory/catalog">
                  <FlaskConical />
                  <span>Lab Catalog</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.labWorklist) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Lab Worklist" href="/laboratory/dashboard">
                  <ClipboardList />
                  <span>Lab Worklist</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.labCollection) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Collection Queue" href="/laboratory/collection">
                  <Droplet />
                  <span>Collection Queue</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.labOrders) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Lab Orders" href="/laboratory/orders">
                  <TestTube2 />
                  <span>Lab Orders</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.labResults) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Lab Results" href="/laboratory/results">
                  <FileText />
                  <span>Lab Results</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.pharmacy) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Pharmacy Dispensing" href="/pharmacy/dispensing">
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

            {hasAccess(userRole, menuItems.management.encounters) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Encounters" href="/encounters">
                  <FileText />
                  <span>Encounters</span>
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

            {hasAccess(userRole, menuItems.management.organization) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Organization" href="/admin/organization">
                  <FolderTree />
                  <span>Organization</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.management.auditLogs) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Audit Logs" href="/admin/audit-logs">
                  <FileSearch />
                  <span>Audit Logs</span>
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
