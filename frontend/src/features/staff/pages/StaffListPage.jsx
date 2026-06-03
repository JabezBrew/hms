import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useStaff, useStaffFilterFacets } from "@/features/staff/hooks";
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
import { TablePagination } from "@/components/ui/table-pagination";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { PageShell } from "@/shared/components/page/PageShell";
import { useDebounce } from "@/hooks/use-debounce";
import { useRouteTableState } from "@/shared/hooks/useRouteTableState";
import { createReturnToLocation } from "@/shared/lib/returnTo";

const STAFF_PAGE_SIZE = 25;

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

function getStaffStats(staffData, staffList, includeInactive) {
  const total = Number(staffData?.count ?? staffData?.total ?? staffList.length) || 0;
  const exact = staffData?.count_exact !== false && staffData?.total_is_lower_bound !== true;

  return {
    total,
    totalLabel: `${total}${exact ? "" : "+"}`,
    visible: staffList.length,
    exact,
    accountLabel: includeInactive ? "staff accounts" : "active staff accounts",
  };
}

function StaffDirectoryHeader({ onAddStaff, stats }) {
  return (
    <PageHeader
      title="Staff Directory"
      description={(
        <span>
          {stats.totalLabel} {stats.accountLabel}
          {stats.visible !== stats.total || !stats.exact ? (
            <span className="text-muted-foreground ml-2">
              · Showing {stats.visible}
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
  positionOptions,
  searchQuery,
  selectedDepartment,
  selectedRole,
  departmentOptions,
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
        {positionOptions.length > 0 ? (
          <Select value={selectedRole} onValueChange={onRoleChange}>
            <SelectTrigger className="w-full sm:w-[160px] font-mono text-xs h-9">
              <Filter className="size-3.5 mr-2" />
              <SelectValue placeholder="All Positions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Positions</SelectItem>
              {positionOptions.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {formatRoleLabel(role.label || role.value)} ({role.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {departmentOptions.length > 0 ? (
          <Select value={selectedDepartment} onValueChange={onDepartmentChange}>
            <SelectTrigger className="w-full sm:w-[180px] font-mono text-xs h-9">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departmentOptions.map((dept) => (
                <SelectItem key={dept.value} value={dept.value}>
                  {dept.label || dept.value} ({dept.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

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
  hasActiveFilters,
  isLoading,
  onClearFilters,
  onRowClick,
  staffRows,
}) {
  if (isLoading) return <LoadingSkeleton />;
  if (staffRows.length === 0) {
    return <EmptyState hasFilters={hasActiveFilters} onClear={onClearFilters} />;
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={staffRows}
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
 * - Position and department filtering
 * - Staggered animations on load
 */
const StaffListPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [tableState, setTableState] = useRouteTableState("staff:directoryTable", {
    search: "",
    selectedRole: "all",
    selectedDepartment: "all",
    includeInactive: false,
    page: 1,
  });
  const searchQuery = tableState.search || "";
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const searchQueryRef = useRef(searchQuery);
  const previousSearchQueryRef = useRef(searchQuery);
  const debouncedSearchDraft = useDebounce(searchDraft, 300);
  const selectedRole = tableState.selectedRole || "all";
  const selectedDepartment = tableState.selectedDepartment || "all";
  const includeInactive = Boolean(tableState.includeInactive);
  const page = Number(tableState.page || 1);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
    const previousSearchQuery = previousSearchQueryRef.current;
    previousSearchQueryRef.current = searchQuery;
    setSearchDraft((current) => (
      current === previousSearchQuery ? searchQuery : current
    ));
  }, [searchQuery]);

  useEffect(() => {
    const nextSearch = debouncedSearchDraft.trim();
    if (nextSearch === searchQueryRef.current) return;
    setTableState((current) => ({
      ...current,
      search: nextSearch,
      page: 1,
    }));
  }, [debouncedSearchDraft, setTableState]);

  const staffFilters = useMemo(
    () => ({
      paginated: true,
      page,
      page_size: STAFF_PAGE_SIZE,
      search: searchQuery,
      is_active: includeInactive ? undefined : true,
      department: selectedDepartment !== "all" ? selectedDepartment : undefined,
      position: selectedRole !== "all" ? selectedRole : undefined,
    }),
    [includeInactive, page, searchQuery, selectedDepartment, selectedRole]
  );
  const facetFilters = useMemo(
    () => ({
      is_active: includeInactive ? undefined : true,
    }),
    [includeInactive]
  );

  // Fetch staff
  const {
    data: staffData = [],
    isLoading,
    refetch
  } = useStaff(staffFilters);
  const {
    data: staffFacets = { departments: [], positions: [] },
  } = useStaffFilterFacets(facetFilters);

  const staffList = useMemo(() => getStaffList(staffData), [staffData]);
  const positionOptions = staffFacets?.positions || [];
  const departmentOptions = staffFacets?.departments || [];
  const stats = useMemo(
    () => getStaffStats(staffData, staffList, includeInactive),
    [includeInactive, staffData, staffList]
  );

  const setPage = (nextPage) => {
    setTableState((current) => ({
      ...current,
      page: nextPage,
    }));
  };

  const handleSearchChange = (e) => {
    setSearchDraft(e.target.value);
  };

  const handleClearFilters = () => {
    setSearchDraft("");
    setTableState((current) => ({
      ...current,
      search: "",
      selectedRole: "all",
      selectedDepartment: "all",
      page: 1,
    }));
  };

  const handleDepartmentChange = (value) => {
    setTableState((current) => ({
      ...current,
      selectedDepartment: value,
      page: 1,
    }));
  };

  const handleRoleChange = (value) => {
    setTableState((current) => ({
      ...current,
      selectedRole: value,
      page: 1,
    }));
  };

  const handleIncludeInactiveChange = (value) => {
    setTableState((current) => ({
      ...current,
      includeInactive: value,
      selectedRole: "all",
      selectedDepartment: "all",
      page: 1,
    }));
  };

  const handleAddStaff = () => {
    navigate('/staff/create');
  };

  const handleRowClick = (member) => {
    if (member?.id) {
      navigate(`/staff/${member.id}`, {
        state: {
          returnTo: createReturnToLocation(location),
        },
      });
    }
  };

  const hasActiveFilters = Boolean(searchDraft.trim() || searchQuery) || selectedRole !== "all" || selectedDepartment !== "all";

  return (
    <PageShell>
      <StaffDirectoryHeader
        onAddStaff={handleAddStaff}
        stats={stats}
      />

      <div className="p-4 sm:p-6 space-y-4">
        <StaffDirectoryFilters
          hasActiveFilters={hasActiveFilters}
          includeInactive={includeInactive}
          onClearFilters={handleClearFilters}
          onDepartmentChange={handleDepartmentChange}
          onIncludeInactiveChange={handleIncludeInactiveChange}
          onRefresh={refetch}
          onRoleChange={handleRoleChange}
          onSearchChange={handleSearchChange}
          searchQuery={searchDraft}
          selectedDepartment={selectedDepartment}
          selectedRole={selectedRole}
          departmentOptions={departmentOptions}
          positionOptions={positionOptions}
        />

        <StaffDirectoryContent
          hasActiveFilters={hasActiveFilters}
          isLoading={isLoading}
          onClearFilters={handleClearFilters}
          onRowClick={handleRowClick}
          staffRows={staffList}
        />

        <TablePagination
          currentPage={staffData?.page || page}
          totalCount={staffData?.count ?? staffList.length}
          pageSize={staffData?.page_size || STAFF_PAGE_SIZE}
          countExact={staffData?.count_exact !== false && staffData?.total_is_lower_bound !== true}
          totalPages={staffData?.total_pages}
          hasNextPage={Boolean(staffData?.next)}
          hasPrevPage={(staffData?.page || page) > 1}
          canJumpToPage={false}
          onPageChange={setPage}
          itemLabel="staff"
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
