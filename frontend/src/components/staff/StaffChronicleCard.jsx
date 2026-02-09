import Building from 'lucide-react/dist/esm/icons/building.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Receipt from 'lucide-react/dist/esm/icons/receipt.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * StaffChronicleCard - Chronicle-style staff card
 *
 * Displays staff information in a clean, narrative format with:
 * - Role-based color accent
 * - Staff identity with distinctive typography
 * - Employment synopsis (department, position, hire date)
 * - Professional info for practitioners
 * - Contextual actions
 */
const StaffChronicleCard = ({
  staff,
  index = 0,
  className
}) => {
  const navigate = useNavigate();

  // ============================================
  // Data extraction helpers
  // ============================================

  const getStaffId = (staff) => staff?.id || null;

  const getDisplayName = (staff) => {
    if (staff?.name) return staff.name;
    const firstName = staff?.user_details?.first_name || '';
    const lastName = staff?.user_details?.last_name || '';
    return `${firstName} ${lastName}`.trim() || "Unknown Staff";
  };

  const getEmployeeId = (staff) => staff?.employee_id || "No ID";

  const getUserType = (staff) => staff?.user_details?.user_type || 'staff';

  const getDepartment = (staff) => staff?.department || null;

  const getPosition = (staff) => staff?.position || null;

  const getEmail = (staff) => staff?.email || staff?.user_details?.email || null;

  const getPhone = (staff) => staff?.phone_number || staff?.phone || staff?.user_details?.phone_number || null;

  const getHireDate = (staff) => {
    const hireDate = staff?.hire_date;
    if (!hireDate) return null;
    try {
      return new Date(hireDate).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return null;
    }
  };

  const getTenureString = (staff) => {
    const hireDate = staff?.hire_date;
    if (!hireDate) return null;
    try {
      const start = new Date(hireDate);
      const end = new Date();

      if (start > end) return "0 days";

      let years = end.getFullYear() - start.getFullYear();
      let months = end.getMonth() - start.getMonth();
      let days = end.getDate() - start.getDate();

      if (days < 0) {
        months--;
        const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
        days += prevMonth.getDate();
      }
      if (months < 0) {
        years--;
        months += 12;
      }

      if (years > 0) {
        return months > 0
          ? `${years} ${years === 1 ? 'year' : 'years'} ${months} ${months === 1 ? 'month' : 'months'}`
          : `${years} ${years === 1 ? 'year' : 'years'}`;
      }

      if (months > 0) {
        return `${months} ${months === 1 ? 'month' : 'months'}`;
      }

      return `${days} ${days === 1 ? 'day' : 'days'}`;
    } catch {
      return null;
    }
  };

  const isActive = (staff) => staff?.user_details?.is_active !== false;

  // ============================================
  // Role styling helpers
  // ============================================

  const getRoleConfig = (userType) => {
    const configs = {
      admin: {
        label: 'Administrator',
        shortLabel: 'Admin',
        icon: Shield,
        badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
        accentClass: 'bg-gradient-to-r from-rose-500/20 to-transparent'
      },
      doctor: {
        label: 'Physician',
        shortLabel: 'MD',
        icon: Stethoscope,
        badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
        accentClass: 'bg-gradient-to-r from-sky-500/20 to-transparent'
      },
      nurse: {
        label: 'Nurse',
        shortLabel: 'RN',
        icon: ClipboardList,
        badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
        accentClass: 'bg-gradient-to-r from-emerald-500/20 to-transparent'
      },
      receptionist: {
        label: 'Receptionist',
        shortLabel: 'Front Desk',
        icon: Building,
        badgeClass: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
        accentClass: 'bg-gradient-to-r from-violet-500/20 to-transparent'
      },
      lab_technician: {
        label: 'Lab Technician',
        shortLabel: 'Lab Tech',
        icon: FlaskConical,
        badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        accentClass: 'bg-gradient-to-r from-amber-500/20 to-transparent'
      },
      pharmacist: {
        label: 'Pharmacist',
        shortLabel: 'PharmD',
        icon: Pill,
        badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
        accentClass: 'bg-gradient-to-r from-indigo-500/20 to-transparent'
      },
      billing: {
        label: 'Billing Clerk',
        shortLabel: 'Billing',
        icon: Receipt,
        badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
        accentClass: 'bg-gradient-to-r from-pink-500/20 to-transparent'
      }
    };
    return configs[userType] || {
      label: 'Staff',
      shortLabel: 'Staff',
      icon: Building,
      badgeClass: 'bg-muted text-muted-foreground border-border',
      accentClass: 'bg-gradient-to-r from-muted/50 to-transparent'
    };
  };

  // ============================================
  // Extracted data
  // ============================================

  const staffId = getStaffId(staff);
  const displayName = getDisplayName(staff);
  const employeeId = getEmployeeId(staff);
  const userType = getUserType(staff);
  const department = getDepartment(staff);
  const position = getPosition(staff);
  const email = getEmail(staff);
  const phone = getPhone(staff);
  const hireDate = getHireDate(staff);
  const tenure = getTenureString(staff);
  const active = isActive(staff);

  const roleConfig = getRoleConfig(userType);
  const RoleIcon = roleConfig.icon;

  // Build info line
  const infoLine = [
    employeeId,
    department
  ].filter(Boolean).join(' · ');

  // ============================================
  // Event handlers
  // ============================================

  const handleViewProfile = () => {
    if (staffId) {
      navigate(`/staff/${staffId}`);
    }
  };

  const handleManageSchedule = (e) => {
    e.stopPropagation();
    if (staffId) {
      navigate(`/staff/${staffId}`);
    }
  };

  // ============================================
  // Render
  // ============================================

  return (
    <article
      onClick={handleViewProfile}
      className={cn(
        "group relative bg-card/50 backdrop-blur border border-border",
        "rounded-xl sm:rounded-2xl p-4 sm:p-6 cursor-pointer",
        "hover:border-primary/30 transition-all duration-500",
        "hover:shadow-[0_0_40px_-12px_var(--chronicle-amber)]",
        "animate-chronicle-enter",
        className
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Role Accent Bar */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1 rounded-t-xl sm:rounded-t-2xl",
        roleConfig.accentClass
      )} />

      {/* Header: Staff Identity */}
      <header className="flex items-start justify-between gap-2 mb-3 sm:mb-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display text-lg sm:text-2xl text-foreground tracking-tight truncate">
              {displayName}
            </h3>
            {!active && (
              <span className="text-[10px] sm:text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                Inactive
              </span>
            )}
          </div>
          <p className="font-mono text-[10px] sm:text-xs text-muted-foreground truncate">
            {infoLine}
          </p>
        </div>

        {/* Role Badge */}
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] sm:text-xs font-medium shrink-0",
          roleConfig.badgeClass
        )}>
          <RoleIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          <span className="hidden sm:inline">{roleConfig.label}</span>
          <span className="sm:hidden">{roleConfig.shortLabel}</span>
        </div>
      </header>

      {/* Employment Synopsis */}
      <div className="grid grid-cols-3 gap-2 sm:gap-6 mb-3 sm:mb-4">
        <div className="min-w-0">
          <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
            Position
          </dt>
          <dd className="text-foreground/90 font-medium text-xs sm:text-sm truncate">
            {position || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
            Since
          </dt>
          <dd className="text-foreground/90 font-medium text-xs sm:text-sm">
            {hireDate || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 sm:mb-1">
            Tenure
          </dt>
          <dd className="text-foreground/90 font-medium text-xs sm:text-sm">
            {tenure || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      </div>

      {/* Contact Info */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 p-2 sm:p-3 rounded-lg sm:rounded-xl bg-background/50 mb-3 sm:mb-4">
        {email && (
          <span className="font-mono text-[10px] sm:text-xs text-muted-foreground truncate max-w-[140px] sm:max-w-none">
            {email}
          </span>
        )}
        {email && phone && (
          <span className="hidden sm:inline text-muted-foreground/50">·</span>
        )}
        {phone && (
          <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
            {phone}
          </span>
        )}
        {!email && !phone && (
          <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
            No contact info
          </span>
        )}
      </div>

      {/* Action Footer */}
      <footer className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 sm:pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className={cn(
            "w-2 h-2 rounded-full",
            active ? "bg-emerald-500" : "bg-muted-foreground"
          )} />
          <span className="font-mono text-[10px] sm:text-xs">
            {active ? 'Active Account' : 'Inactive Account'}
          </span>
        </div>

        {/* Always show on mobile, hover on desktop */}
        <div className="flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="sm"
            className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
            onClick={handleViewProfile}
          >
            View Profile
          </Button>
          {userType === 'doctor' && (
            <Button
              size="sm"
              className="font-mono text-[10px] sm:text-xs h-8 flex-1 sm:flex-none"
              onClick={handleManageSchedule}
            >
              <Calendar className="h-3 w-3 mr-1" />
              Schedule
            </Button>
          )}
        </div>
      </footer>
    </article>
  );
};

export default StaffChronicleCard;
export { StaffChronicleCard };
