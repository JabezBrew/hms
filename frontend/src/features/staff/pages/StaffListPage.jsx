import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStaff } from "@/features/staff/hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StaffChronicleCard } from "@/components/staff/StaffChronicleCard";
import { PageHeader } from "@/shared/components/page/PageHeader";
import { PageShell } from "@/shared/components/page/PageShell";
import { useListFilters } from "@/shared/hooks/useListFilters";

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
  const [viewMode, setViewMode] = useState("grid");

  // Fetch staff
  const {
    data: staffData = [],
    isLoading,
    refetch
  } = useStaff();

  // ============================================
  // Data processing
  // ============================================

  // Get staff array from response
  const staffList = useMemo(() => {
    const staff = Array.isArray(staffData)
      ? staffData
      : (staffData?.results || staffData?.staff || []);
    return Array.isArray(staff) ? staff : [];
  }, [staffData]);

  // Extract unique roles for filter
  const uniqueRoles = useMemo(() => {
    const roles = new Set();
    staffList.forEach(member => {
      const role = member?.user_details?.user_type;
      if (role) roles.add(role);
    });
    return Array.from(roles).sort();
  }, [staffList]);

  // Extract unique departments for filter
  const uniqueDepartments = useMemo(() => {
    const departments = new Set();
    staffList.forEach(member => {
      const dept = member?.department;
      if (dept) departments.add(dept);
    });
    return Array.from(departments).sort();
  }, [staffList]);

  // Filter staff
  const filteredStaff = useMemo(() => {
    return staffList.filter(member => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = member?.name?.toLowerCase() || '';
        const firstName = member?.user_details?.first_name?.toLowerCase() || '';
        const lastName = member?.user_details?.last_name?.toLowerCase() || '';
        const email = member?.user_details?.email?.toLowerCase() || '';
        const department = member?.department?.toLowerCase() || '';
        const position = member?.position?.toLowerCase() || '';
        const employeeId = member?.employee_id?.toLowerCase() || '';

        const matches = name.includes(query) ||
          firstName.includes(query) ||
          lastName.includes(query) ||
          email.includes(query) ||
          department.includes(query) ||
          position.includes(query) ||
          employeeId.includes(query);

        if (!matches) return false;
      }

      // Role filter
      if (selectedRole !== "all") {
        if (member?.user_details?.user_type !== selectedRole) return false;
      }

      // Department filter
      if (selectedDepartment !== "all") {
        if (member?.department !== selectedDepartment) return false;
      }

      return true;
    });
  }, [staffList, searchQuery, selectedRole, selectedDepartment]);

  // Calculate stats
  const stats = useMemo(() => {
    const total = staffList.length;
    const active = staffList.filter(s => s?.user_details?.is_active !== false).length;
    const practitioners = staffList.filter(s =>
      ['doctor', 'nurse', 'lab_technician', 'pharmacist'].includes(s?.user_details?.user_type)
    ).length;

    return { total, active, practitioners };
  }, [staffList]);

  // ============================================
  // Event handlers
  // ============================================

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

  const hasActiveFilters = hasBaseFilters || selectedRole !== "all" || selectedDepartment !== "all";

  // Format role label
  const formatRoleLabel = (role) => {
    if (!role) return '';
    return role
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const headerDescription = (
    <span>
      {stats.total} staff members
      {stats.practitioners > 0 && (
        <span className="text-primary ml-2">
          · {stats.practitioners} practitioners
        </span>
      )}
      {stats.active !== stats.total && (
        <span className="text-muted-foreground ml-2">
          · {stats.active} active
        </span>
      )}
    </span>
  );

  // ============================================
  // Render
  // ============================================

  return (
    <PageShell>
      <PageHeader
        title="Staff Directory"
        description={headerDescription}
        actions={(
          <Button onClick={handleAddStaff} size="sm" className="font-mono text-xs w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Add Staff Member
          </Button>
        )}
      />

      <div className="p-4 sm:p-6 space-y-4">
        {/* Search and Filters */}
        <div className="flex flex-col gap-3">
          {/* Search - Full Width */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, department, or employee ID..."
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-10 font-mono text-sm bg-background"
            />
          </div>

          {/* Filters Row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Role Filter */}
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger className="w-full sm:w-[160px] font-mono text-xs h-9">
                <Filter className="h-3.5 w-3.5 mr-2" />
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

            {/* Department Filter */}
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
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

            {/* View Mode Toggle */}
            <div className="flex bg-muted rounded-lg p-0.5 ml-auto">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  viewMode === 'grid'
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  viewMode === 'list'
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>

            {/* Refresh */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              className="shrink-0 h-9 w-9"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="font-mono text-xs h-9"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Staff List */}
        {isLoading ? (
          <LoadingSkeleton viewMode={viewMode} />
        ) : filteredStaff.length === 0 ? (
          <EmptyState hasFilters={hasActiveFilters} onClear={handleClearFilters} />
        ) : (
          <div className={cn(
            viewMode === 'grid'
              ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6"
              : "space-y-4"
          )}>
            {filteredStaff.map((member, index) => (
              <StaffChronicleCard
                key={member?.id || index}
                staff={member}
                index={index}
                className={viewMode === 'list' ? 'max-w-none' : ''}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
};

/**
 * LoadingSkeleton - Skeleton loading state
 */
const LoadingSkeleton = ({ viewMode }) => {
  const count = viewMode === 'grid' ? 6 : 4;

  return (
    <div className={cn(
      viewMode === 'grid'
        ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6"
        : "space-y-4"
    )}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="bg-card/50 border border-border rounded-2xl p-6 space-y-4"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-4 w-56" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
          <div className="flex justify-between pt-4 border-t border-border">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
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
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Users className="h-8 w-8 text-muted-foreground" />
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
          <X className="h-4 w-4 mr-2" />
          Clear Filters
        </Button>
      )}
    </div>
  );
};

export default StaffListPage;
