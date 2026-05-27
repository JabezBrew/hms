import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStaff } from "@/features/staff/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from "@/shared/components/page/PageHeader";
import { PageShell } from "@/shared/components/page/PageShell";
import { useListFilters } from "@/shared/hooks/useListFilters";

const getStaffUserType = (member) => {
  return member?.user_type || member?.user_details?.user_type || '';
};

const getStaffIsActive = (member) => {
  return member?.is_active ?? member?.user_details?.is_active ?? true;
};

const formatRoleLabel = (role) => {
  if (!role) return '';
  return role
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const STAFF_COLUMNS = [
  {
    key: "staff",
    header: "Staff",
    width: "260px",
    render: (member) => {
      const displayName =
        member?.name ||
        [member?.user_details?.first_name, member?.user_details?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "Unknown Staff";
      const email = member?.user_details?.email || member?.email || "No email";

      return (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{displayName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{email}</p>
        </div>
      );
    },
  },
  {
    key: "employee_id",
    header: "Employee ID",
    width: "150px",
    render: (member) => (
      <span className="font-mono text-sm text-muted-foreground">
        {member?.employee_id || "—"}
      </span>
    ),
  },
  {
    key: "role",
    header: "Role",
    width: "160px",
    render: (member) => (
      <Badge variant="outline" className="text-xs">
        {formatRoleLabel(getStaffUserType(member) || "staff")}
      </Badge>
    ),
  },
  {
    key: "department",
    header: "Department",
    width: "180px",
    render: (member) => (
      <span className="text-sm text-muted-foreground">
        {member?.department || "—"}
      </span>
    ),
  },
  {
    key: "position",
    header: "Position",
    width: "180px",
    render: (member) => (
      <span className="text-sm text-muted-foreground">
        {member?.position || "—"}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    width: "120px",
    render: (member) => {
      const isActive = getStaffIsActive(member);
      return (
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            isActive
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          )}
        >
          {isActive ? "Active" : "Inactive"}
        </Badge>
      );
    },
  },
];

function getStaffList(staffData) {
  const staff = Array.isArray(staffData)
    ? staffData
    : (staffData?.results || staffData?.staff || []);
  return Array.isArray(staff) ? staff : [];
}

function getUniqueStaffRoles(staffList) {
  const roles = new Set();
  staffList.forEach(member => {
    const role = getStaffUserType(member);
    if (role) roles.add(role);
  });
  return Array.from(roles).sort();
}

function getUniqueStaffDepartments(staffList) {
  const departments = new Set();
  staffList.forEach(member => {
    const dept = member?.department;
    if (dept) departments.add(dept);
  });
  return Array.from(departments).sort();
}

function staffMemberMatchesSearch(member, searchQuery) {
  if (!searchQuery) return true;

  const query = searchQuery.toLowerCase();
  const name = member?.name?.toLowerCase() || '';
  const firstName = member?.user_details?.first_name?.toLowerCase() || '';
  const lastName = member?.user_details?.last_name?.toLowerCase() || '';
  const email = (member?.user_details?.email || member?.email || '').toLowerCase();
  const department = member?.department?.toLowerCase() || '';
  const position = member?.position?.toLowerCase() || '';
  const employeeId = member?.employee_id?.toLowerCase() || '';

  return name.includes(query) ||
    firstName.includes(query) ||
    lastName.includes(query) ||
    email.includes(query) ||
    department.includes(query) ||
    position.includes(query) ||
    employeeId.includes(query);
}

function filterStaffList({ searchQuery, selectedDepartment, selectedRole, staffList }) {
  return staffList.filter(member => {
    if (!staffMemberMatchesSearch(member, searchQuery)) return false;
    if (selectedRole !== "all" && getStaffUserType(member) !== selectedRole) return false;
    if (selectedDepartment !== "all" && member?.department !== selectedDepartment) return false;
    return true;
  });
}

function getStaffStats(staffList) {
  const total = staffList.length;
  const active = staffList.filter(getStaffIsActive).length;
  const inactive = total - active;
  const practitioners = staffList.filter(member =>
    ['doctor', 'nurse', 'lab_technician', 'pharmacist'].includes(getStaffUserType(member))
  ).length;

  return { total, active, inactive, practitioners };
}

function StaffDirectoryHeader({ includeInactive, onAddStaff, stats }) {
  return (
    <PageHeader
      title="Staff Directory"
      description={(
        <span>
          {stats.total} staff members
          {stats.practitioners > 0 ? (
            <span className="text-primary ml-2">
              · {stats.practitioners} practitioners
            </span>
          ) : null}
          {stats.active !== stats.total ? (
            <span className="text-muted-foreground ml-2">
              · {stats.active} active
            </span>
          ) : null}
          {includeInactive && stats.inactive > 0 ? (
            <span className="text-amber-600 ml-2">
              · {stats.inactive} inactive
            </span>
          ) : null}
        </span>
      )}
      actions={(
        <Button onClick={onAddStaff} size="sm" className="font-mono text-xs w-full sm:w-auto">
          <Plus className="size-4 mr-2" />
          Add Staff Member
        </Button>
      )}
    />
  );
}

function StaffDirectoryFilters({
  hasActiveFilters,
  includeInactive,
  onClearFilters,
  onIncludeInactiveChange,
  onRefresh,
  onRoleChange,
  onDepartmentChange,
  onSearchChange,
  searchQuery,
  selectedDepartment,
  selectedRole,
  uniqueDepartments,
  uniqueRoles,
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, department, or employee ID..."
          value={searchQuery}
          onChange={onSearchChange}
          className="pl-10 font-mono text-sm bg-background"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedRole} onValueChange={onRoleChange}>
          <SelectTrigger className="w-full sm:w-[160px] font-mono text-xs h-9">
            <Filter className="size-3.5 mr-2" />
            <SelectValue placeholder="All Roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {uniqueRoles.map((role) => (
              <SelectItem key={role} value={role}>
                {formatRoleLabel(role)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedDepartment} onValueChange={onDepartmentChange}>
          <SelectTrigger className="w-full sm:w-[180px] font-mono text-xs h-9">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {uniqueDepartments.map((dept) => (
              <SelectItem key={dept} value={dept}>
                {dept}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          className="shrink-0 size-9"
        >
          <RefreshCw className="size-4" />
        </Button>

        <label htmlFor="staff-list-include-inactive" className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 font-mono text-xs text-muted-foreground">
          <Switch
            id="staff-list-include-inactive"
            checked={includeInactive}
            onCheckedChange={onIncludeInactiveChange}
            aria-label="Show inactive staff"
          />
          Show inactive
        </label>

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="font-mono text-xs h-9"
          >
            <X className="size-4 mr-1" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StaffDirectoryContent({
  filteredStaff,
  hasActiveFilters,
  isLoading,
  onClearFilters,
  onRowClick,
}) {
  if (isLoading) return <LoadingSkeleton />;
  if (filteredStaff.length === 0) {
    return <EmptyState hasFilters={hasActiveFilters} onClear={onClearFilters} />;
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={filteredStaff}
        rowKey={(member, index) => member?.id || index}
        rowHeight={68}
        columns={STAFF_COLUMNS}
        onRowClick={onRowClick}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1040px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

/**
 * StaffListPage - Chronicle-style staff directory
 *
 * Features:
 * - Chronicle-style staff cards
 * - Search and filter functionality
 * - Toggle between grid and list views
 * - Role-based filtering
 * - Staggered animations on load
 */
const StaffListPage = () => {
  const navigate = useNavigate();
  const { search: searchQuery, updateSearch, hasActiveFilters: hasBaseFilters } = useListFilters();
  const [selectedRole, setSelectedRole] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);

  const staffFilters = useMemo(
    () => (includeInactive ? { include_inactive: 'true' } : {}),
    [includeInactive]
  );

  // Fetch staff
  const {
    data: staffData = [],
    isLoading,
    refetch
  } = useStaff(staffFilters);

  const staffList = useMemo(() => getStaffList(staffData), [staffData]);
  const uniqueRoles = useMemo(() => getUniqueStaffRoles(staffList), [staffList]);
  const uniqueDepartments = useMemo(() => getUniqueStaffDepartments(staffList), [staffList]);
  const filteredStaff = useMemo(() => filterStaffList({
    searchQuery,
    selectedDepartment,
    selectedRole,
    staffList,
  }), [staffList, searchQuery, selectedRole, selectedDepartment]);
  const stats = useMemo(() => getStaffStats(staffList), [staffList]);

  const handleSearchChange = (e) => {
    updateSearch(e.target.value);
  };

  const handleClearFilters = () => {
    updateSearch("");
    setSelectedRole("all");
    setSelectedDepartment("all");
  };

  const handleAddStaff = () => {
    navigate('/staff/create');
  };

  const handleRowClick = (member) => {
    if (member?.id) {
      navigate(`/staff/${member.id}`);
    }
  };

  const hasActiveFilters = hasBaseFilters || selectedRole !== "all" || selectedDepartment !== "all";

  return (
    <PageShell>
      <StaffDirectoryHeader
        includeInactive={includeInactive}
        onAddStaff={handleAddStaff}
        stats={stats}
      />

      <div className="p-4 sm:p-6 space-y-4">
        <StaffDirectoryFilters
          hasActiveFilters={hasActiveFilters}
          includeInactive={includeInactive}
          onClearFilters={handleClearFilters}
          onDepartmentChange={setSelectedDepartment}
          onIncludeInactiveChange={setIncludeInactive}
          onRefresh={refetch}
          onRoleChange={setSelectedRole}
          onSearchChange={handleSearchChange}
          searchQuery={searchQuery}
          selectedDepartment={selectedDepartment}
          selectedRole={selectedRole}
          uniqueDepartments={uniqueDepartments}
          uniqueRoles={uniqueRoles}
        />

        <StaffDirectoryContent
          filteredStaff={filteredStaff}
          hasActiveFilters={hasActiveFilters}
          isLoading={isLoading}
          onClearFilters={handleClearFilters}
          onRowClick={handleRowClick}
        />
      </div>
    </PageShell>
  );
};

/**
 * LoadingSkeleton - Skeleton loading state
 */
const LoadingSkeleton = () => {
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
      <Skeleton className="h-10 w-full rounded-lg" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
};

/**
 * EmptyState - No staff found state
 */
const EmptyState = ({ hasFilters, onClear }) => {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Users className="size-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        {hasFilters ? 'No matching staff' : 'No staff members'}
      </h3>
      <p className="text-muted-foreground text-sm mb-4 max-w-md">
        {hasFilters
          ? 'Try adjusting your search or filter criteria.'
          : 'Start by adding a new staff member to see them appear here.'}
      </p>
      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onClear}>
          <X className="size-4 mr-2" />
          Clear Filters
        </Button>
      )}
    </div>
  );
};

export default StaffListPage;
