import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js'
import Calendar from 'lucide-react/dist/esm/icons/calendar.js'
import Inbox from 'lucide-react/dist/esm/icons/inbox.js'
import Settings from 'lucide-react/dist/esm/icons/settings.js'
import Activity from 'lucide-react/dist/esm/icons/activity.js'
import FileText from 'lucide-react/dist/esm/icons/file-text.js'
import Pill from 'lucide-react/dist/esm/icons/pill.js'
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js'
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js'
import Shield from 'lucide-react/dist/esm/icons/shield.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Clock from 'lucide-react/dist/esm/icons/clock.js'
import BookOpen from 'lucide-react/dist/esm/icons/book-open.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import FileSearch from 'lucide-react/dist/esm/icons/file-search.js'
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js'
import Droplet from 'lucide-react/dist/esm/icons/droplet.js'
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.js'
import BarChart3 from 'lucide-react/dist/esm/icons/chart-column.js'
import FolderTree from 'lucide-react/dist/esm/icons/folder-tree.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js'
import FileBox from 'lucide-react/dist/esm/icons/file-box.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarFooter,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { useAuth } from "@/lib/auth"
import { useInboxCount } from "@/features/inbox/hooks"
import { ROLES, ROLE_GROUPS } from '@/shared/constants/roles'
import { useSidebarState } from "@/hooks/useSidebarState"

// Helper function to check if a user has access to a menu item
const hasAccess = (userRole, allowedRoles) => {
  if (!userRole || !allowedRoles || allowedRoles.length === 0) return false
  return allowedRoles.includes(userRole)
}

const hasAnyAccess = (userRole, roleGroups) =>
  roleGroups.some((roleGroup) => hasAccess(userRole, roleGroup))

const DASHBOARD_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.NURSE,
  ROLES.RECEPTIONIST,
  ROLES.PRACTITIONER,
  ROLES.PHYSICIAN,
  ROLES.HEAD_NURSE,
  ROLES.NURSE_PRACTITIONER,
  ROLES.INPATIENT_DOCTOR,
  ROLES.PHARMACIST,
  ROLES.LAB_TECHNICIAN,
  ROLES.BILLING,
  'front_desk',
]

const INBOX_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.NURSE,
  ROLES.INPATIENT_DOCTOR,
  ROLES.PRACTITIONER,
  ROLES.PHYSICIAN,
]

const LAB_CATALOG_ROLES = [ROLES.ADMIN, ROLES.LAB_TECHNICIAN, ROLES.DOCTOR]
const LAB_COLLECTION_ROLES = [
  ROLES.ADMIN,
  ROLES.LAB_TECHNICIAN,
  ROLES.NURSE,
  ROLES.HEAD_NURSE,
  ROLES.NURSE_PRACTITIONER,
]
const LAB_RESULTS_ROLES = [
  ROLES.ADMIN,
  ROLES.LAB_TECHNICIAN,
  ROLES.DOCTOR,
  ROLES.PHYSICIAN,
  ROLES.PRACTITIONER,
]

const NOTE_TEMPLATE_ROLES = [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE]
const CHART_TEMPLATE_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.NURSE,
  ROLES.HEAD_NURSE,
  ROLES.NURSE_PRACTITIONER,
  ROLES.PHYSICIAN,
  ROLES.PRACTITIONER,
]

const DUTY_ROSTER_ROLES = [ROLES.ADMIN, ROLES.HEAD_NURSE]

export function AppSidebar() {
  const { user } = useAuth()
  const userRole = user?.role || ''
  const { count: inboxCount } = useInboxCount()
  const { getCollapsibleProps } = useSidebarState()

  // Get role-specific dashboard URL
  // Support staff are redirected to their workflow pages instead of a generic dashboard
  const getDashboardUrl = (role) => {
    if ([ROLES.NURSE, ROLES.HEAD_NURSE, ROLES.NURSE_PRACTITIONER].includes(role)) {
      return '/dashboards/nurse'
    }
    if ([ROLES.DOCTOR, ROLES.INPATIENT_DOCTOR].includes(role)) {
      return '/dashboards/inpatient'
    }
    if ([ROLES.RECEPTIONIST, 'front_desk'].includes(role)) {
      return '/dashboards/reception'
    }
    if (role === ROLES.ADMIN) {
      return '/dashboards/admin'
    }
    if ([ROLES.PHARMACIST, ROLES.PHARMACY_TECH].includes(role)) {
      return '/pharmacy/dispensing'
    }
    if (role === ROLES.LAB_TECHNICIAN) {
      return '/laboratory/dashboard'
    }
    if (role === ROLES.BILLING) {
      return '/billing'
    }
    if (role === ROLES.STORE_KEEPER) {
      return '/inventory'
    }
    return '/dashboard/provider'
  }

  const menuItems = {
    primary: {
      dashboard: DASHBOARD_ROLES,
      inbox: INBOX_ROLES,
      patients: ROLE_GROUPS.PATIENT_REGISTRY,
      schedule: ROLE_GROUPS.APPOINTMENTS,
      availability: ROLE_GROUPS.PRACTITIONER_AVAILABILITY,
    },
    operations: {
      wards: ROLE_GROUPS.WARDS,
      shiftHandoff: ROLE_GROUPS.NURSING_DASHBOARD,
      labCatalog: LAB_CATALOG_ROLES,
      labWorklist: ROLE_GROUPS.LAB_TECHS,
      labCollection: LAB_COLLECTION_ROLES,
      labOrders: ROLE_GROUPS.LAB_ACCESS,
      labResults: LAB_RESULTS_ROLES,
      pharmacy: ROLE_GROUPS.PHARMACY,
      billing: ROLE_GROUPS.BILLING,
      inventory: ROLE_GROUPS.INVENTORY,
      noteTemplates: NOTE_TEMPLATE_ROLES,
      chartTemplates: CHART_TEMPLATE_ROLES,
      staff: ROLE_GROUPS.ADMIN_ONLY,
      organization: ROLE_GROUPS.ADMIN_ONLY,
      dutyRoster: DUTY_ROSTER_ROLES,
      auditLogs: ROLE_GROUPS.ADMIN_ONLY,
    },
  }

  const showAppointments = hasAnyAccess(userRole, [
    menuItems.primary.schedule,
    menuItems.primary.availability,
  ])

  const showLaboratory = hasAnyAccess(userRole, [
    menuItems.operations.labCatalog,
    menuItems.operations.labWorklist,
    menuItems.operations.labCollection,
    menuItems.operations.labOrders,
    menuItems.operations.labResults,
  ])

  const showClinicalContent = hasAnyAccess(userRole, [
    menuItems.operations.noteTemplates,
    menuItems.operations.chartTemplates,
  ])

  const showAdministration = hasAnyAccess(userRole, [
    menuItems.operations.staff,
    menuItems.operations.organization,
    menuItems.operations.dutyRoster,
    menuItems.operations.auditLogs,
  ])

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

            {showAppointments && (
              <Collapsible asChild className="group/collapsible" {...getCollapsibleProps('appointments')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Appointments">
                      <Calendar />
                      <span>Appointments</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {hasAccess(userRole, menuItems.primary.schedule) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/appointments">
                            <Calendar className="h-4 w-4" />
                            <span>Schedule</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.primary.availability) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/practitioner-availability">
                            <Clock className="h-4 w-4" />
                            <span>Availability</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <SidebarGroup>
        <SidebarGroupLabel>Operations</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {hasAccess(userRole, menuItems.operations.wards) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Wards" href="/wards">
                  <Activity />
                  <span>Wards</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.operations.shiftHandoff) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Shift Handoff" href="/nursing/shift-handoff">
                  <ArrowLeftRight />
                  <span>Shift Handoff</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {showLaboratory && (
              <Collapsible asChild className="group/collapsible" {...getCollapsibleProps('laboratory')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Laboratory">
                      <FlaskConical />
                      <span>Laboratory</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {hasAccess(userRole, menuItems.operations.labCatalog) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/laboratory/catalog">
                            <FlaskConical className="h-4 w-4" />
                            <span>Catalog</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.labWorklist) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/laboratory/dashboard">
                            <ClipboardList className="h-4 w-4" />
                            <span>Worklist</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.labCollection) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/laboratory/collection">
                            <Droplet className="h-4 w-4" />
                            <span>Collection Queue</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.labOrders) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/laboratory/orders">
                            <TestTube2 className="h-4 w-4" />
                            <span>Orders</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.labResults) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/laboratory/results">
                            <FileText className="h-4 w-4" />
                            <span>Results</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )}

            {hasAccess(userRole, menuItems.operations.pharmacy) && (
              <Collapsible asChild className="group/collapsible" {...getCollapsibleProps('pharmacy')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Pharmacy">
                      <Pill />
                      <span>Pharmacy</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/pharmacy/dispensing">
                          <Pill className="h-4 w-4" />
                          <span>Dispensing</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/pharmacy/supply-queue">
                          <ClipboardList className="h-4 w-4" />
                          <span>Supply Queue</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )}

            {hasAccess(userRole, menuItems.operations.billing) && (
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Billing" href="/billing">
                  <CreditCard />
                  <span>Billing</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {hasAccess(userRole, menuItems.operations.inventory) && (
              <Collapsible asChild className="group/collapsible" {...getCollapsibleProps('inventory')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Inventory">
                      <Package />
                      <span>Inventory</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory">
                          <LayoutDashboard className="h-4 w-4" />
                          <span>Dashboard</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/items">
                          <Package className="h-4 w-4" />
                          <span>Items</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/locations">
                          <Warehouse className="h-4 w-4" />
                          <span>Locations</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/requisitions">
                          <ClipboardList className="h-4 w-4" />
                          <span>Requisitions</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/purchase-orders">
                          <ShoppingCart className="h-4 w-4" />
                          <span>Purchase Orders</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/grns">
                          <FileBox className="h-4 w-4" />
                          <span>GRNs</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/transfers">
                          <Truck className="h-4 w-4" />
                          <span>Transfers</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/controlled">
                          <AlertTriangle className="h-4 w-4" />
                          <span>Controlled</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton href="/inventory/analytics">
                          <BarChart3 className="h-4 w-4" />
                          <span>Analytics</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )}

            {showClinicalContent && (
              <Collapsible asChild className="group/collapsible" {...getCollapsibleProps('clinical-content')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Clinical Content">
                      <FileText />
                      <span>Clinical Content</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {hasAccess(userRole, menuItems.operations.noteTemplates) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/clinical-notes/templates">
                            <ClipboardList className="h-4 w-4" />
                            <span>Note Templates</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.chartTemplates) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/charts/templates">
                            <BarChart3 className="h-4 w-4" />
                            <span>Chart Builder</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )}

            {showAdministration && (
              <Collapsible asChild className="group/collapsible" {...getCollapsibleProps('administration')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Administration">
                      <Shield />
                      <span>Administration</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {hasAccess(userRole, menuItems.operations.staff) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/staff">
                            <Shield className="h-4 w-4" />
                            <span>Staff</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.organization) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/admin/organization">
                            <FolderTree className="h-4 w-4" />
                            <span>Organization</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.dutyRoster) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/admin/organization/duty-roster">
                            <CalendarClock className="h-4 w-4" />
                            <span>Duty Roster</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                      {hasAccess(userRole, menuItems.operations.auditLogs) && (
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton href="/admin/audit-logs">
                            <FileSearch className="h-4 w-4" />
                            <span>Audit Logs</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
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
