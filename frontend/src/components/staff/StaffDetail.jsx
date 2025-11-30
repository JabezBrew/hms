import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { staffApi } from '@/lib/api/staff';
import { authApi } from '@/lib/api/auth';
import {
  ChevronLeft,
  Edit,
  Trash2,
  Calendar,
  Mail,
  Phone,
  Building,
  Briefcase,
  Award,
  FileText,
  Clock,
  Stethoscope,
  Shield,
  ClipboardList,
  Pill,
  FlaskConical,
  Receipt,
  GraduationCap,
  ExternalLink,
  KeyRound,
  History,
} from 'lucide-react';
import StaffActivityLog from './StaffActivityLog';

/**
 * StaffDetail - Chronicle-style staff profile
 *
 * Clean, single-page layout with:
 * - Editorial identity header with role badge
 * - Employment information
 * - Professional information for practitioners
 * - Contact details
 * - Links to manage schedule/availability
 *
 * Removed:
 * - Tabs structure (unnecessary complexity)
 * - Duplicate contact information
 * - Fake placeholder data
 * - System account details (belongs in settings)
 */
const StaffDetail = ({ staff, practitioner, onBack, onEdit, onDeleted }) => {
  const navigate = useNavigate();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  if (!staff) return null;

  // ============================================
  // Data extraction
  // ============================================

  const userType = staff.user_details?.user_type || '';
  const firstName = staff.user_details?.first_name || '';
  const lastName = staff.user_details?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || 'Unknown Staff';
  const email = staff.user_details?.email || null;
  const phone = staff.user_details?.phone_number || null;
  const isActive = staff.user_details?.is_active !== false;
  const employeeId = staff.employee_id || 'N/A';
  const department = staff.department || null;
  const position = staff.position || null;
  const hireDate = staff.hire_date ? format(new Date(staff.hire_date), 'MMMM d, yyyy') : null;

  // Calculate tenure
  // Calculate tenure
  const calculateTenure = () => {
    if (!staff.hire_date) return null;
    try {
      const start = new Date(staff.hire_date);
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

  const tenure = calculateTenure();

  // Check if user is a practitioner (clinical staff)
  const isPractitioner = ['doctor', 'nurse', 'lab_technician', 'pharmacist'].includes(userType);

  // ============================================
  // Role configuration
  // ============================================

  const getRoleConfig = (type) => {
    const configs = {
      admin: {
        label: 'Administrator',
        icon: Shield,
        badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
        description: 'System administrator with full access'
      },
      doctor: {
        label: 'Physician',
        icon: Stethoscope,
        badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30',
        description: 'Medical practitioner providing patient care'
      },
      nurse: {
        label: 'Nurse',
        icon: ClipboardList,
        badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
        description: 'Nursing professional providing patient care'
      },
      receptionist: {
        label: 'Receptionist',
        icon: Building,
        badgeClass: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
        description: 'Front desk staff managing patient intake'
      },
      lab_technician: {
        label: 'Lab Technician',
        icon: FlaskConical,
        badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
        description: 'Laboratory specialist processing tests'
      },
      pharmacist: {
        label: 'Pharmacist',
        icon: Pill,
        badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
        description: 'Pharmacy professional dispensing medications'
      },
      billing: {
        label: 'Billing Clerk',
        icon: Receipt,
        badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30',
        description: 'Finance staff handling billing and claims'
      }
    };
    return configs[type] || {
      label: 'Staff',
      icon: Building,
      badgeClass: 'bg-muted text-muted-foreground border-border',
      description: 'Staff member'
    };
  };

  const roleConfig = getRoleConfig(userType);
  const RoleIcon = roleConfig.icon;

  // ============================================
  // Event handlers
  // ============================================

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await staffApi.deleteStaff(staff.id);
      toast.success('Staff member deleted successfully');
      if (onDeleted) onDeleted();
    } catch (error) {
      toast.error('Failed to delete staff member');
      console.error('Error deleting staff:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!staff.user_details?.id) {
      toast.error('Cannot reset password: User information not available');
      return;
    }

    try {
      setIsResettingPassword(true);
      const response = await authApi.adminForceResetPassword(staff.user_details.id);
      toast.success('Password reset email sent successfully');
      console.log('Password reset response:', response);
    } catch (error) {
      toast.error(error.message || 'Failed to reset password');
      console.error('Error resetting password:', error);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleManageSchedule = () => {
    navigate(`/staff/${staff.id}/schedule`);
  };

  // ============================================
  // Render
  // ============================================

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          {/* Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="self-start -ml-2"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Staff Directory
            </Button>

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Edit</span>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Delete</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {fullName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the staff
                      member and remove their data from the system.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {isDeleting ? 'Deleting...' : 'Delete'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Identity Hero */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Avatar */}
            <div className={cn(
              "w-16 h-16 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0",
              roleConfig.badgeClass.replace('text-', 'bg-').replace('/10', '/20')
            )}>
              <RoleIcon className="h-8 w-8 sm:h-10 sm:w-10 text-foreground/70" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
                  {fullName}
                </h1>
                {!isActive && (
                  <Badge variant="secondary" className="text-xs">
                    Inactive
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium",
                  roleConfig.badgeClass
                )}>
                  <RoleIcon className="h-3 w-3" />
                  {roleConfig.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {employeeId}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {roleConfig.description}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Employment Information */}
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-muted-foreground" />
            Employment
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
            <InfoItem
              label="Department"
              value={department}
              icon={Building}
            />
            <InfoItem
              label="Position"
              value={position}
              icon={Briefcase}
            />
            <InfoItem
              label="Hire Date"
              value={hireDate}
              icon={Calendar}
            />
            <InfoItem
              label="Tenure"
              value={tenure}
              icon={Clock}
            />
          </div>
        </section>

        {/* Contact Information */}
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            Contact
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">
                  Email
                </p>
                {email ? (
                  <a
                    href={`mailto:${email}`}
                    className="text-sm text-foreground hover:text-primary transition-colors truncate block"
                  >
                    {email}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">Not provided</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Phone className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">
                  Phone
                </p>
                {phone ? (
                  <a
                    href={`tel:${phone}`}
                    className="text-sm text-foreground hover:text-primary transition-colors"
                  >
                    {phone}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">Not provided</p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Professional Information - Only for practitioners */}
        {isPractitioner && (
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-muted-foreground" />
              Professional
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                <InfoItem
                  label="License Number"
                  value={practitioner?.license_number}
                  icon={FileText}
                />
                <InfoItem
                  label="Specialization"
                  value={practitioner?.specialization}
                  icon={Award}
                />
                <InfoItem
                  label="Qualification"
                  value={practitioner?.qualification}
                  icon={GraduationCap}
                  className="col-span-2 sm:col-span-1"
                />
              </div>

              {/* Schedule Management Link */}
              {(userType === 'doctor' || userType === 'nurse') && (
                <div className="pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={handleManageSchedule}
                  >
                    <Calendar className="h-4 w-4 mr-2" />
                    Manage Schedule & Availability
                    <ExternalLink className="h-3 w-3 ml-2" />
                  </Button>
                  <p className="text-xs text-muted-foreground mt-2">
                    Configure recurring schedules, blocked times, and appointment slots
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Activity Log */}
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            Activity Log
          </h2>
          <StaffActivityLog
            userId={staff.user_details?.id}
            userName={fullName}
          />
        </section>

        {/* Quick Actions */}
        <section className="pt-4 border-t border-border">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Profile
            </Button>
            {isPractitioner && (
              <Button variant="outline" size="sm" onClick={handleManageSchedule}>
                <Calendar className="h-4 w-4 mr-2" />
                Schedule
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <KeyRound className="h-4 w-4 mr-2" />
                  Reset Password
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Password for {fullName}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will send a temporary password to {email || 'the user\'s email'}.
                    The user will be required to change their password on next login.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleResetPassword}
                    disabled={isResettingPassword}
                  >
                    {isResettingPassword ? 'Sending...' : 'Send Reset Email'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      </main>
    </div>
  );
};

/**
 * InfoItem - Reusable info display component
 */
const InfoItem = ({ label, value, icon: Icon, className }) => {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="text-sm sm:text-base text-foreground truncate">
        {value || <span className="text-muted-foreground">—</span>}
      </p>
    </div>
  );
};

export default StaffDetail;
