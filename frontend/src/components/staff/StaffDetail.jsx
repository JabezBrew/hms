import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Briefcase from 'lucide-react/dist/esm/icons/briefcase.js';
import Award from 'lucide-react/dist/esm/icons/award.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Receipt from 'lucide-react/dist/esm/icons/receipt.js';
import GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import KeyRound from 'lucide-react/dist/esm/icons/key-round.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import format from 'date-fns/format';
import { cn } from '@/lib/utils';
import { useUpdateStaff, staffKeys } from '@/features/staff/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
import { DatePicker } from '@/components/ui/date-picker';
import { staffApi } from '@/features/staff/api';
import { authApi } from '@/shared/api/auth';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';

import StaffActivityLog from './StaffActivityLog';
import { StaffWardAssignments } from './StaffWardAssignments';

// Edit form validation schema
const staffSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email'),
  phone_number: z.string().optional(),
  department: z.string().optional(),
  position: z.string().optional(),
  hire_date: z.date().optional().nullable(),
  // Practitioner fields
  license_number: z.string().optional(),
  specialization: z.string().optional(),
  qualification: z.string().optional(),
});

/**
 * StaffDetail - Chronicle-style staff profile with view/edit modes
 */
const StaffDetail = ({ staff, practitioner, onBack, onDeleted }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  // Update mutation
  const updateMutation = useUpdateStaff();

  // Form setup
  const form = useForm({
    resolver: zodResolver(staffSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone_number: '',
      department: '',
      position: '',
      hire_date: null,
      license_number: '',
      specialization: '',
      qualification: '',
    },
  });

  // Populate form when staff data is available
  useEffect(() => {
    if (staff) {
      form.reset({
        first_name: staff.user_details?.first_name || '',
        last_name: staff.user_details?.last_name || '',
        email: staff.user_details?.email || '',
        phone_number: staff.user_details?.phone_number || '',
        department: staff.department || '',
        position: staff.position || '',
        hire_date: staff.hire_date ? new Date(staff.hire_date) : null,
        license_number: practitioner?.license_number || '',
        specialization: practitioner?.specialization || '',
        qualification: practitioner?.qualification || '',
      });
    }
  }, [staff, practitioner, form]);

  if (!staff) return null;

  // Data extraction
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
  const isPractitioner = ['doctor', 'nurse', 'lab_technician', 'pharmacist'].includes(userType);

  // Role configuration
  const getRoleConfig = (type) => {
    const configs = {
      admin: { label: 'Administrator', icon: Shield, badgeClass: 'bg-rose-500/10 text-rose-600 border-rose-500/30', description: 'System administrator with full access' },
      doctor: { label: 'Physician', icon: Stethoscope, badgeClass: 'bg-sky-500/10 text-sky-600 border-sky-500/30', description: 'Medical practitioner providing patient care' },
      nurse: { label: 'Nurse', icon: ClipboardList, badgeClass: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30', description: 'Nursing professional providing patient care' },
      receptionist: { label: 'Receptionist', icon: Building, badgeClass: 'bg-violet-500/10 text-violet-600 border-violet-500/30', description: 'Front desk staff managing patient intake' },
      lab_technician: { label: 'Lab Technician', icon: FlaskConical, badgeClass: 'bg-amber-500/10 text-amber-600 border-amber-500/30', description: 'Laboratory specialist processing tests' },
      pharmacist: { label: 'Pharmacist', icon: Pill, badgeClass: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30', description: 'Pharmacy professional dispensing medications' },
      billing: { label: 'Billing Clerk', icon: Receipt, badgeClass: 'bg-pink-500/10 text-pink-600 border-pink-500/30', description: 'Finance staff handling billing and claims' }
    };
    return configs[type] || { label: 'Staff', icon: Building, badgeClass: 'bg-muted text-muted-foreground border-border', description: 'Staff member' };
  };

  const roleConfig = getRoleConfig(userType);
  const RoleIcon = roleConfig.icon;

  // Handle save
  const onSubmit = async (data) => {
    try {
      const updateData = {
        user_details: {
          first_name: data.first_name,
          last_name: data.last_name,
          email: data.email,
          phone_number: data.phone_number || undefined,
        },
        department: data.department || undefined,
        position: data.position || undefined,
        hire_date: data.hire_date ? format(data.hire_date, 'yyyy-MM-dd') : undefined,
      };

      await updateMutation.mutateAsync({ id: staff.id, data: updateData });

      // TODO: Update practitioner data separately if needed
      // if (isPractitioner && practitioner?.id) { ... }

      queryClient.invalidateQueries({ queryKey: staffKeys.detail(staff.id) });
      toast.success('Staff information updated');
      setIsEditing(false);
    } catch (err) {
      toast.error(err.message || 'Failed to update staff');
    }
  };

  const handleCancelEdit = () => {
    form.reset();
    setIsEditing(false);
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await staffApi.deleteStaff(staff.id);
      toast.success('Staff member deleted successfully');
      if (onDeleted) onDeleted();
    } catch {
      toast.error('Failed to delete staff member');
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
      await authApi.adminForceResetPassword(staff.user_details.id);
      toast.success('Password reset email sent successfully');
    } catch (error) {
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleManageSchedule = () => {
    if (practitioner?.id) {
      const params = new URLSearchParams({ practitioner: String(practitioner.id) });
      navigate(`/practitioner-availability?${params.toString()}`);
      return;
    }
    navigate('/practitioner-availability');
  };

  const headerDescription = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium", roleConfig.badgeClass)}>
          <RoleIcon className="h-3 w-3" />
          {roleConfig.label}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{employeeId}</span>
      </div>
      <p className="text-sm text-muted-foreground">{roleConfig.description}</p>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title={(
          <span className="flex items-center gap-4">
            <span className={cn("w-16 h-16 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0", roleConfig.badgeClass.replace('text-', 'bg-').replace('/10', '/20'))}>
              <RoleIcon className="h-8 w-8 sm:h-10 sm:w-10 text-foreground/70" />
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {fullName}
              {!isActive && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
            </span>
          </span>
        )}
        description={headerDescription}
        descriptionClassName="mt-2"
        actions={(
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button size="sm" onClick={form.handleSubmit(onSubmit)} disabled={updateMutation.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Edit</span>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Delete</span>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {fullName}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete the staff member and remove their data from the system.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        )}
        contentClassName="max-w-4xl mx-auto w-full"
      >
        <Button variant="ghost" size="sm" onClick={onBack} className="self-start -ml-2">
          <ChevronLeft className="h-4 w-4 mr-1" />
          Staff Directory
        </Button>
      </PageHeader>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <Form {...form}>
          {/* Employment Information */}
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
              Employment
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="department" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Department</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="position" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Position</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="hire_date" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hire Date</FormLabel>
                      <FormControl>
                        <DatePicker date={field.value} onSelect={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                  <InfoItem label="Department" value={department} icon={Building} />
                  <InfoItem label="Position" value={position} icon={Briefcase} />
                  <InfoItem label="Hire Date" value={hireDate} icon={Calendar} />
                  <InfoItem label="Tenure" value={tenure} icon={Clock} />
                </div>
              )}
            </div>
          </section>

          {/* Contact Information */}
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <Mail className="h-5 w-5 text-muted-foreground" />
              Contact
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField control={form.control} name="first_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="last_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phone_number" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Mail className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">Email</p>
                      {email ? (
                        <a href={`mailto:${email}`} className="text-sm text-foreground hover:text-primary transition-colors truncate block">{email}</a>
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
                      <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">Phone</p>
                      {phone ? (
                        <a href={`tel:${phone}`} className="text-sm text-foreground hover:text-primary transition-colors">{phone}</a>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not provided</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
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
                {isEditing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <FormField control={form.control} name="license_number" render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Number</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="specialization" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Specialization</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="qualification" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Qualification</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                    <InfoItem label="License Number" value={practitioner?.license_number} icon={FileText} />
                    <InfoItem label="Specialization" value={practitioner?.specialization} icon={Award} />
                    <InfoItem label="Qualification" value={practitioner?.qualification} icon={GraduationCap} className="col-span-2 sm:col-span-1" />
                  </div>
                )}

                {/* Schedule Management Link */}
                {!isEditing && userType === 'doctor' && (
                  <div className="pt-4 border-t border-border">
                    <Button variant="outline" className="w-full sm:w-auto" onClick={handleManageSchedule}>
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
        </Form>

        {/* Ward Assignments - Only for practitioners (read-only) */}
        {!isEditing && isPractitioner && practitioner?.id && (
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              Ward Assignments
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              <StaffWardAssignments practitionerId={practitioner.id} practitionerName={fullName} />
            </div>
          </section>
        )}

        {/* Activity Log (read-only) */}
        {!isEditing && (
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              Activity Log
            </h2>
            <StaffActivityLog userId={staff.user_details?.id} userName={fullName} />
          </section>
        )}

        {/* Quick Actions */}
        {!isEditing && (
          <section className="pt-4 border-t border-border">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
              {userType === 'doctor' && (
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
                      This will send a password reset link to {email || 'the user\'s email'}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetPassword} disabled={isResettingPassword}>
                      {isResettingPassword ? 'Sending...' : 'Send Reset Email'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </section>
        )}
      </main>
    </PageShell>
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
        <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className="text-sm sm:text-base text-foreground truncate">
        {value || <span className="text-muted-foreground">—</span>}
      </p>
    </div>
  );
};

export default StaffDetail;
