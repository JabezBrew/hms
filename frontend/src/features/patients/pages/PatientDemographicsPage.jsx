import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import CalendarPlus from 'lucide-react/dist/esm/icons/calendar-plus.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import format from 'date-fns/format';
import { cn } from '@/lib/utils';
import { usePatientDemographics, useUpdatePatient, patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { usePatientInsurance } from '@/features/billing/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import WalkInCheckInDialog from '@/features/clinics/components/WalkInCheckInDialog';
import { useAuth } from '@/lib/auth';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { resolvePatientDisplayName } from '@/features/patients/utils/resolvePatientDisplayName';

// Edit form validation schema
const demographicsSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone_number: z.string().optional(),
  date_of_birth: z.date().optional(),
  nhis_id: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  emergency_contact_relationship: z.string().optional(),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

/**
 * PatientDemographicsPage - Administrative patient detail view
 *
 * A demographics-focused patient detail page for non-clinical staff
 * (receptionists, billing, admin) to view and edit patient information
 * without accessing clinical data.
 *
 * Features:
 * - View patient demographics
 * - Edit patient demographics inline
 * - View insurance information
 * - Quick actions (schedule appointment)
 */
const PatientDemographicsPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const { user } = useAuth();
  const canWalkInCheckIn = user?.role === 'receptionist' || user?.role === 'admin';

  // Fetch patient demographics
  const {
    data: patient,
    isLoading,
    isError,
    error,
  } = usePatientDemographics(id);

  // Fetch patient insurance
  const { data: insuranceData } = usePatientInsurance(id);
  const insurance = insuranceData?.results?.[0] || insuranceData?.[0];

  // Update mutation
  const updateMutation = useUpdatePatient();

  // Form setup
  const form = useForm({
    resolver: zodResolver(demographicsSchema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone_number: '',
      date_of_birth: undefined,
      nhis_id: '',
      emergency_contact_name: '',
      emergency_contact_phone: '',
      emergency_contact_relationship: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
    },
  });

  // Populate form when patient data loads
  useEffect(() => {
    if (patient) {
      form.reset({
        first_name: patient.user_details?.first_name || patient.user?.first_name || '',
        last_name: patient.user_details?.last_name || patient.user?.last_name || '',
        email: patient.user_details?.email || patient.user?.email || '',
        phone_number: patient.user_details?.phone_number || patient.user?.phone_number || '',
        date_of_birth: patient.user_details?.date_of_birth || patient.user?.date_of_birth
          ? new Date(patient.user_details?.date_of_birth || patient.user?.date_of_birth)
          : undefined,
        nhis_id: patient.nhis_id || '',
        emergency_contact_name: patient.emergency_contact_name || '',
        emergency_contact_phone: patient.emergency_contact_phone || '',
        emergency_contact_relationship: patient.emergency_contact_relationship || '',
        address_line1: patient.address_line1 || '',
        address_line2: patient.address_line2 || '',
        city: patient.city || '',
        state: patient.state || '',
        postal_code: patient.postal_code || '',
        country: patient.country || '',
      });
    }
  }, [patient, form]);

  // Handle save
  const onSubmit = async (data) => {
    try {
      // Transform data to match backend expectations
      const updateData = {
        user: {
          first_name: data.first_name,
          last_name: data.last_name,
          email: data.email || undefined,
          phone_number: data.phone_number || undefined,
          date_of_birth: data.date_of_birth ? format(data.date_of_birth, 'yyyy-MM-dd') : undefined,
        },
        nhis_id: data.nhis_id || undefined,
        emergency_contact_name: data.emergency_contact_name || undefined,
        emergency_contact_phone: data.emergency_contact_phone || undefined,
        emergency_contact_relationship: data.emergency_contact_relationship || undefined,
        address_line1: data.address_line1 || undefined,
        address_line2: data.address_line2 || undefined,
        city: data.city || undefined,
        state: data.state || undefined,
        postal_code: data.postal_code || undefined,
        country: data.country || undefined,
      };

      await updateMutation.mutateAsync({ id, data: updateData });

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(id) });

      toast.success('Patient information updated');
      setIsEditing(false);
    } catch (err) {
      toast.error(err.message || 'Failed to update patient');
    }
  };

  // Cancel edit
  const handleCancelEdit = () => {
    form.reset();
    setIsEditing(false);
  };

  // Extract display data
  const fullName = useMemo(() => resolvePatientDisplayName(patient), [patient]);
  const patientPath = id ? `/patients/${id}` : '/patients';
  const pageMeta = usePageMeta({
    title: fullName ? `${fullName} | Hospital Management System` : 'Patient | Hospital Management System',
    breadcrumbs: [
      { label: 'Patients', path: '/patients' },
      { label: fullName || 'Patient', path: patientPath },
    ],
  });
  const mrn = patient?.medical_record_number || 'N/A';
  const email = patient?.user_details?.email || patient?.user?.email;
  const phone = patient?.user_details?.phone_number || patient?.user?.phone_number;
  const dob = patient?.user_details?.date_of_birth || patient?.user?.date_of_birth;
  const nhisId = patient?.nhis_id;

  // Loading state
  if (isLoading) {
    return (
      <>
        {pageMeta}
        <div className="min-h-screen bg-background">
          <header className="bg-card border-b border-border">
            <div className="max-w-4xl mx-auto p-4 sm:p-6">
              <Skeleton className="h-8 w-32 mb-4" />
              <div className="flex items-start gap-4">
                <Skeleton className="size-16 rounded-xl" />
                <div>
                  <Skeleton className="h-8 w-48 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            </div>
          </header>
          <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </main>
        </div>
      </>
    );
  }

  // Error state
  if (isError) {
    return (
      <>
        {pageMeta}
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <AlertCircle className="size-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Failed to load patient</h2>
            <p className="text-muted-foreground mb-4">{error?.message}</p>
            <Button onClick={() => navigate(-1)}>Go Back</Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-4xl mx-auto p-4 sm:p-6">
          {/* Navigation */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/patients')}
              className="self-start -ml-2"
            >
              <ChevronLeft className="size-4 mr-1" />
              Patient Registry
            </Button>

            {/* Actions */}
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                  >
                    <X className="size-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={form.handleSubmit(onSubmit)}
                    disabled={updateMutation.isPending}
                  >
                    <Save className="size-4 mr-2" />
                    {updateMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit className="size-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>
          </div>

          {/* Identity Hero */}
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Avatar */}
            <div className="size-16 sm:w-20 sm:h-20 rounded-xl sm:rounded-2xl bg-sky-500/20 flex items-center justify-center shrink-0">
              <User className="size-8 sm:h-10 sm:w-10 text-sky-600" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
                  {fullName || 'Unknown Patient'}
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium bg-sky-500/10 text-sky-600 border-sky-500/30">
                  <User className="size-3" />
                  Patient
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {mrn}
                </span>
              </div>
              {dob && (
                <p className="text-sm text-muted-foreground">
                  Born {format(new Date(dob), 'MMMM d, yyyy')}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
        <Form {...form}>
          {/* Personal Information */}
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <User className="size-5 text-muted-foreground" />
              Personal Information
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="last_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="date_of_birth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of Birth</FormLabel>
                        <FormControl>
                          <DatePicker
                            date={field.value}
                            onSelect={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nhis_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>NHIS ID</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                  <InfoItem label="First Name" value={patient?.user_details?.first_name || patient?.user?.first_name} icon={User} />
                  <InfoItem label="Last Name" value={patient?.user_details?.last_name || patient?.user?.last_name} icon={User} />
                  <InfoItem label="Date of Birth" value={dob ? format(new Date(dob), 'MMM d, yyyy') : null} icon={Calendar} />
                  <InfoItem label="NHIS ID" value={nhisId} icon={FileText} />
                </div>
              )}
            </div>
          </section>

          {/* Contact Information */}
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <Phone className="size-5 text-muted-foreground" />
              Contact Information
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Mail className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">
                        Email
                      </p>
                      {email ? (
                        <a href={`mailto:${email}`} className="text-sm text-foreground hover:text-primary transition-colors truncate block">
                          {email}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not provided</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Phone className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground">
                        Phone
                      </p>
                      {phone ? (
                        <a href={`tel:${phone}`} className="text-sm text-foreground hover:text-primary transition-colors">
                          {phone}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not provided</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Address */}
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <MapPin className="size-5 text-muted-foreground" />
              Address
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Address Line 1</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_line2"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Address Line 2</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State/Region</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="postal_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postal Code</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                  <InfoItem label="Address Line 1" value={patient?.address_line1} icon={MapPin} className="col-span-2 sm:col-span-3" />
                  {patient?.address_line2 && (
                    <InfoItem label="Address Line 2" value={patient?.address_line2} className="col-span-2 sm:col-span-3" />
                  )}
                  <InfoItem label="City" value={patient?.city} />
                  <InfoItem label="State/Region" value={patient?.state} />
                  <InfoItem label="Postal Code" value={patient?.postal_code} />
                  <InfoItem label="Country" value={patient?.country} />
                </div>
              )}
            </div>
          </section>

          {/* Emergency Contact */}
          <section>
            <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
              <AlertCircle className="size-5 text-muted-foreground" />
              Emergency Contact
            </h2>
            <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
              {isEditing ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="emergency_contact_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="emergency_contact_phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="emergency_contact_relationship"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Relationship</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., Spouse, Parent" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                  <InfoItem label="Contact Name" value={patient?.emergency_contact_name} icon={User} />
                  <InfoItem label="Contact Phone" value={patient?.emergency_contact_phone} icon={Phone} />
                  <InfoItem label="Relationship" value={patient?.emergency_contact_relationship} />
                </div>
              )}
            </div>
          </section>
        </Form>

        {/* Insurance Information (Read-only) */}
        <section>
          <h2 className="font-display text-lg sm:text-xl text-foreground mb-4 flex items-center gap-2">
            <Shield className="size-5 text-muted-foreground" />
            Insurance
          </h2>
          <div className="p-4 sm:p-6 rounded-xl sm:rounded-2xl bg-card/50 border border-border">
            {insurance ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                <InfoItem label="Provider" value={insurance.plan_details?.provider_name || insurance.provider_name} icon={Shield} />
                <InfoItem label="Plan" value={insurance.plan_details?.name || insurance.plan_name} />
                <InfoItem label="Policy Number" value={insurance.policy_number} />
                <InfoItem
                  label="Valid Until"
                  value={insurance.valid_until ? format(new Date(insurance.valid_until), 'MMM d, yyyy') : 'Ongoing'}
                  icon={Calendar}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No insurance information on file</p>
            )}
          </div>
        </section>

        {/* Quick Actions */}
        <section className="pt-4 border-t border-border">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/appointments/create?patient=${id}`)}
            >
              <CalendarPlus className="size-4 mr-2" />
              Schedule Appointment
            </Button>
            {canWalkInCheckIn && (
              <Button
                variant="default"
                size="sm"
                onClick={() => setWalkInOpen(true)}
              >
                <Stethoscope className="size-4 mr-2" />
                Arrived Now
              </Button>
            )}
            {!isEditing && (
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                <Edit className="size-4 mr-2" />
                Edit Information
              </Button>
            )}
          </div>
        </section>
      </main>

        <WalkInCheckInDialog
          open={walkInOpen}
          onOpenChange={setWalkInOpen}
          patientId={id}
          onSuccess={(_result, context) => {
            if (context?.clinicId) {
              navigate(`/clinics/${context.clinicId}/waiting-room`);
            }
          }}
        />
      </div>
    </>
  );
};

/**
 * InfoItem - Reusable info display component
 */
const InfoItem = ({ label, value, icon: Icon, className }) => {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        <p className="font-mono text-[9px] sm:text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="text-sm sm:text-base text-foreground truncate">
        {value || <span className="text-muted-foreground">-</span>}
      </p>
    </div>
  );
};

export default PatientDemographicsPage;
