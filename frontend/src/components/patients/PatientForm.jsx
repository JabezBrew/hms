import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  useUpdatePatientWithFHIR,
  useRegisterPatient,
  usePatientValidationRules
} from "@/features/patients/hooks/usePatientQueries";
import { useWards, useWardBeds } from "@/features/wards/hooks/useWardQueries";
import { useDepartments, useRosterOnDutyDepartment } from "@/features/admin/hooks";
import {
  useInsuranceProviders,
  useInsurancePlans,
  useCreatePatientInsurance,
} from "@/features/billing/hooks";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { TeamSelectionField } from "@/components/registration/TeamSelectionField";

import format from "date-fns/format";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Form validation schema
const patientFormSchema = z.object({
  // User fields
  email: z.string().email({ message: "Please enter a valid email address" }),
  first_name: z.string().min(1, { message: "First name is required" }),
  last_name: z.string().min(1, { message: "Last name is required" }),
  phone_number: z.string().optional(),
  date_of_birth: z.date({ required_error: "Date of birth is required" }),

  // PatientProfile fields
  medical_record_number: z.string().optional(), // Made optional as it will be generated on the backend
  nhis_id: z.string().optional(),
  blood_group: z.string().optional(),
  allergies: z.string().optional(),
  emergency_contact_name: z.string().optional(),
  emergency_contact_phone: z.string().optional(),
  emergency_contact_relationship: z.string().optional(),

  // Address fields
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
});

const PatientForm = ({ patient, onSuccess }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [admissionType, setAdmissionType] = useState("outpatient");
  const [selectedWard, setSelectedWard] = useState("");
  const [isWaitingList, setIsWaitingList] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedClinic, setSelectedClinic] = useState("");
  const [selectedPrimaryTeam, setSelectedPrimaryTeam] = useState("");
  const [activeClinicOptions, setActiveClinicOptions] = useState([]);
  const [clinicSelectionRequired, setClinicSelectionRequired] = useState(false);
  const isEditMode = !!patient;

  // Use React Query hooks
  const {
    data: validationRules = [],
    isLoading: isValidationRulesLoading
  } = usePatientValidationRules();

  const updatePatientMutation = useUpdatePatientWithFHIR();
  const registerPatientMutation = useRegisterPatient();

  // Ward queries
  const { data: wards = [] } = useWards();
  const { data: beds = [] } = useWardBeds(selectedWard, { status: 'available' });

  // Department and clinic queries
  const { data: departmentsData, isLoading: isDepartmentsLoading } = useDepartments();
  // Filter to only show clinical departments (exclude ancillary like Lab/Radiology and ops_only like Administration)
  const allUnits = Array.isArray(departmentsData) ? departmentsData : [];
  const departments = allUnits.filter(unit =>
    unit.unit_type_code === 'department' && unit.unit_category === 'clinical'
  );

  // Fetch on-duty roster entries for the department (includes active clinics)
  const { data: onDutyData } = useRosterOnDutyDepartment(
    selectedDepartment,
    {},
    { enabled: !!selectedDepartment && admissionType === 'outpatient' }
  );

  // Extract active clinics from roster entries with category='clinic'
  const activeClinics = useMemo(() => {
    // apiClient.get unwraps `{ results: [...] }` into an array for these roster endpoints.
    const results = Array.isArray(onDutyData) ? onDutyData : (onDutyData?.results || []);
    // Filter to only clinic-category duty types
    const clinicEntries = results.filter(
      (entry) => entry.duty_type_category === 'clinic'
    );
    // Deduplicate by clinic_id (or duty_type_id if no clinic linked)
    const seen = new Set();
    return clinicEntries.reduce((acc, entry) => {
      // Use clinic_id if available, otherwise use duty_type_id as the identifier
      const uniqueId = entry.clinic_id || entry.duty_type_id;
      if (!seen.has(uniqueId)) {
        seen.add(uniqueId);
        acc.push({
          // If clinic is linked, use clinic info; otherwise use duty type as the "clinic"
          id: entry.clinic_id || entry.duty_type_id,
          name: entry.clinic_name || entry.duty_type_name,
          duty_type_id: entry.duty_type_id,
          duty_type_name: entry.duty_type_name,
          // Flag to indicate if this is a duty-type-as-clinic
          is_duty_type: !entry.clinic_id,
        });
      }
      return acc;
    }, []);
  }, [onDutyData]);

  // Insurance queries and state
  const { data: providersData } = useInsuranceProviders();
  const providers = providersData?.results || providersData || [];
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const { data: plansData } = useInsurancePlans(
    selectedProviderId ? { provider: selectedProviderId } : {}
  );
  const plans = plansData?.results || plansData || [];
  const createInsuranceMutation = useCreatePatientInsurance();

  // Insurance form state (separate from main form since it's optional)
  const [insuranceData, setInsuranceData] = useState({
    hasInsurance: false,
    plan: '',
    policy_number: '',
    valid_from: null,
    valid_until: null,
  });

  // Initialize form with default values
  const form = useForm({
    resolver: zodResolver(patientFormSchema),
    defaultValues: {
      email: "",
      first_name: "",
      last_name: "",
      phone_number: "",
      date_of_birth: undefined,
      medical_record_number: "",
      nhis_id: "",
      blood_group: "",
      allergies: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      emergency_contact_relationship: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      postal_code: "",
      country: "",
      // Admission fields
      bed_id: "",
      admission_notes: "",
    }
  });

  // Load patient data into form when in edit mode
  useEffect(() => {
    if (isEditMode && patient) {
      // Extract phone from FHIR telecom if not in local_data
      const phoneFromFhir = patient.fhir_data?.telecom?.find(t => t.system === 'phone')?.value || "";

      form.reset({
        // User fields - use user_details instead of user
        email: patient.local_data?.user_details?.email || "",
        first_name: patient.local_data?.user_details?.first_name || "",
        last_name: patient.local_data?.user_details?.last_name || "",
        phone_number: patient.local_data?.user_details?.phone_number || phoneFromFhir || "",
        date_of_birth: patient.local_data?.user_details?.date_of_birth ? new Date(patient.local_data.user_details.date_of_birth) : undefined,

        // PatientProfile fields
        medical_record_number: patient.local_data?.medical_record_number || "",
        nhis_id: patient.local_data?.nhis_id || "",
        blood_group: patient.local_data?.blood_group || "",
        allergies: patient.local_data?.allergies || "",
        emergency_contact_name: patient.local_data?.emergency_contact_name || "",
        emergency_contact_phone: patient.local_data?.emergency_contact_phone || "",
        emergency_contact_relationship: patient.local_data?.emergency_contact_relationship || "",

        // Address fields - extract from FHIR data if available
        address_line1: patient.fhir_data?.address?.[0]?.line?.[0] || "",
        address_line2: patient.fhir_data?.address?.[0]?.line?.[1] || "",
        city: patient.fhir_data?.address?.[0]?.city || "",
        state: patient.fhir_data?.address?.[0]?.state || "",
        postal_code: patient.fhir_data?.address?.[0]?.postalCode || "",
        country: patient.fhir_data?.address?.[0]?.country || "",
      });
    }
  }, [isEditMode, patient, form]);

  // Determine active clinics based on published roster entries
  useEffect(() => {
    if (admissionType !== 'outpatient' || !selectedDepartment) {
      setActiveClinicOptions([]);
      setClinicSelectionRequired(false);
      return;
    }

    // Active clinics come from roster entries with category='clinic'
    setActiveClinicOptions(activeClinics);

    if (activeClinics.length === 1) {
      setSelectedClinic(activeClinics[0].id);
      setClinicSelectionRequired(false);
    } else if (activeClinics.length > 1) {
      setClinicSelectionRequired(true);
      setSelectedClinic("");
    } else {
      setClinicSelectionRequired(false);
    }
  }, [activeClinics, selectedDepartment, admissionType]);

  // No need to fetch validation rules as React Query handles this

  const onSubmit = (data) => {
    setIsLoading(true);

    if (isEditMode) {
      // Prepare data for update
      const updateData = {
        local_data: {
          user: {
            email: data.email,
            first_name: data.first_name,
            last_name: data.last_name,
            phone_number: data.phone_number,
            date_of_birth: format(data.date_of_birth, 'yyyy-MM-dd'),
          },
          medical_record_number: data.medical_record_number,
          nhis_id: data.nhis_id,
          blood_group: data.blood_group,
          allergies: data.allergies,
          emergency_contact_name: data.emergency_contact_name,
          emergency_contact_phone: data.emergency_contact_phone,
          emergency_contact_relationship: data.emergency_contact_relationship,
        },
        fhir_data: {
          ...patient.fhir_data,
          name: [
            {
              family: data.last_name,
              given: [data.first_name],
            }
          ],
          telecom: [
            {
              system: "phone",
              value: data.phone_number,
              use: "home"
            }
          ],
          birthDate: format(data.date_of_birth, 'yyyy-MM-dd'),
          address: [
            {
              line: [
                data.address_line1,
                data.address_line2
              ].filter(Boolean),
              city: data.city,
              state: data.state,
              postalCode: data.postal_code,
              country: data.country
            }
          ]
        }
      };

      // Update patient using mutation
      updatePatientMutation.mutate(
        { id: patient.local_data.id, data: updateData },
        {
          onSuccess: (response) => {
            toast.success("Patient updated successfully");

            if (onSuccess) {
              // Check if response.data exists, otherwise use response directly
              const patientData = response.data !== undefined ? response.data : response;
              onSuccess(patientData);
            }

            setIsLoading(false);
          },
          onError: (error) => {
            console.error('Failed to update patient:', error);
            toast.error(error.message || "Failed to update patient");
            setIsLoading(false);
          }
        }
      );
    } else {
      // Validate department selection
      if (!selectedDepartment) {
        toast.error("Please select a department");
        setIsLoading(false);
        return;
      }

      // Validate clinic selection for outpatient
      if (admissionType === 'outpatient' && clinicSelectionRequired && !selectedClinic) {
        toast.error("Please select a clinic");
        setIsLoading(false);
        return;
      }

      // Format data for registration
      const formattedData = {
        ...data,
        date_of_birth: format(data.date_of_birth, 'yyyy-MM-dd')
      };

      // Build admission details with department and clinic scoping
      const admissionDetails = {
        type: admissionType,
        department_id: selectedDepartment,
        notes: data.admission_notes || ''
      };

      // Add primary team for inpatient/emergency encounters
      if ((admissionType === 'inpatient' || admissionType === 'emergency') && selectedPrimaryTeam) {
        admissionDetails.primary_team_id = selectedPrimaryTeam;
      }

      if (admissionType === 'outpatient' && selectedClinic) {
        // Find the selected clinic option to check if it's a duty-type-as-clinic
        const selectedClinicOption = activeClinicOptions.find(c => c.id === selectedClinic);
        if (selectedClinicOption?.is_duty_type) {
          // Use duty_type_id for scheduling, no clinic_id
          admissionDetails.duty_type_id = selectedClinic;
        } else {
          admissionDetails.clinic_id = selectedClinic;
        }
      }

      if (admissionType === 'inpatient') {
        if (!isWaitingList && data.bed_id) {
          admissionDetails.bed_id = data.bed_id;
        }
        if (!isWaitingList && selectedWard && !data.bed_id) {
          admissionDetails.ward_id = selectedWard;
        }
      }

      formattedData.admission_details = admissionDetails;

      // Register new patient using mutation
      registerPatientMutation.mutate(
        formattedData,
        {
          onSuccess: async (response) => {
            // Check if response.data exists, otherwise use response directly
            const patientData = response.data !== undefined ? response.data : response;
            const patientId = patientData.local_data?.id || patientData.id;

            // Create insurance if provided
            if (insuranceData.hasInsurance && insuranceData.plan && insuranceData.policy_number && patientId) {
              try {
                await createInsuranceMutation.mutateAsync({
                  patient: patientId,
                  plan: insuranceData.plan,
                  policy_number: insuranceData.policy_number,
                  valid_from: insuranceData.valid_from ? format(insuranceData.valid_from, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
                  valid_until: insuranceData.valid_until ? format(insuranceData.valid_until, 'yyyy-MM-dd') : null,
                  is_active: true,
                });
                toast.success("Patient registered with insurance");
              } catch (insuranceError) {
                console.error('Failed to create insurance:', insuranceError);
                toast.success("Patient registered successfully");
                toast.error("Failed to add insurance - you can add it later from patient profile");
              }
            } else {
              toast.success("Patient registered successfully");
            }

            if (onSuccess) {
              onSuccess(patientData);
            }

            setIsLoading(false);
          },
          onError: (error) => {
            console.error('Failed to register patient:', error);
            toast.error(error.message || "Failed to register patient");
            setIsLoading(false);
          }
        }
      );
    }
  };

  return (
    <Card className="w-full border-border">
      <CardContent className="pt-6">
        <Tabs defaultValue="personal">
          <TabsList className="grid w-full grid-cols-5 mb-6">
            <TabsTrigger value="personal" className="font-mono text-xs">Personal</TabsTrigger>
            <TabsTrigger value="medical" className="font-mono text-xs">Medical</TabsTrigger>
            <TabsTrigger value="contact" className="font-mono text-xs">Contact</TabsTrigger>
            <TabsTrigger value="insurance" className="font-mono text-xs">Insurance</TabsTrigger>
            <TabsTrigger value="admission" className="font-mono text-xs">Admission</TabsTrigger>
          </TabsList>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <TabsContent value="personal" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="First name" {...field} />
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
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Last name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="date_of_birth"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Date of Birth</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant={"outline"}
                              className={cn(
                                "w-full pl-3 text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              {field.value ? (
                                format(field.value, "PPP")
                              ) : (
                                <span>Pick a date</span>
                              )}
                              <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="Email address" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

              </TabsContent>

              <TabsContent value="medical" className="space-y-4 mt-4">
                {isEditMode && (
                  <FormField
                    control={form.control}
                    name="medical_record_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Medical Record Number</FormLabel>
                        <FormControl>
                          <Input placeholder="Medical record number" {...field} readOnly />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="nhis_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">NHIS ID</FormLabel>
                      <FormControl>
                        <Input placeholder="NHIS ID" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="blood_group"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Blood Group</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select blood group" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="A+">A+</SelectItem>
                          <SelectItem value="A-">A-</SelectItem>
                          <SelectItem value="B+">B+</SelectItem>
                          <SelectItem value="B-">B-</SelectItem>
                          <SelectItem value="AB+">AB+</SelectItem>
                          <SelectItem value="AB-">AB-</SelectItem>
                          <SelectItem value="O+">O+</SelectItem>
                          <SelectItem value="O-">O-</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="allergies"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Allergies</FormLabel>
                      <FormControl>
                        <Textarea placeholder="List any allergies" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="contact" className="space-y-4 mt-4">
                <FormField
                  control={form.control}
                  name="phone_number"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="Phone number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator className="my-4" />
                <h3 className="font-display text-lg text-foreground">Address</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="address_line1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Address Line 1</FormLabel>
                        <FormControl>
                          <Input placeholder="Address line 1" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="address_line2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Address Line 2</FormLabel>
                        <FormControl>
                          <Input placeholder="Address line 2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">City</FormLabel>
                        <FormControl>
                          <Input placeholder="City" {...field} />
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
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">State/Province</FormLabel>
                        <FormControl>
                          <Input placeholder="State/Province" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="postal_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Postal Code</FormLabel>
                        <FormControl>
                          <Input placeholder="Postal code" {...field} />
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
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Country</FormLabel>
                        <FormControl>
                          <Input placeholder="Country" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Separator className="my-4" />
                <h3 className="font-display text-lg text-foreground">Emergency Contact</h3>

                <FormField
                  control={form.control}
                  name="emergency_contact_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Emergency Contact Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency contact name" {...field} />
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
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Emergency Contact Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Emergency contact phone" {...field} />
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
                      <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Relationship</FormLabel>
                      <FormControl>
                        <Input placeholder="Relationship to patient" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}

                />
              </TabsContent>

              <TabsContent value="insurance" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Shield className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Insurance Coverage</p>
                        <p className="text-xs text-muted-foreground">
                          Add insurance details for this patient
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {insuranceData.hasInsurance ? 'Enabled' : 'Skip'}
                      </span>
                      <input
                        type="checkbox"
                        checked={insuranceData.hasInsurance}
                        onChange={(e) => setInsuranceData(prev => ({
                          ...prev,
                          hasInsurance: e.target.checked,
                          // Reset fields when unchecking
                          ...(e.target.checked ? {} : {
                            plan: '',
                            policy_number: '',
                            valid_from: null,
                            valid_until: null,
                          })
                        }))}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </div>
                  </div>

                  {insuranceData.hasInsurance && (
                    <div className="space-y-4 p-4 border border-border rounded-lg">
                      {/* Provider Selection */}
                      <div className="space-y-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Insurance Provider
                        </FormLabel>
                        <Select
                          value={selectedProviderId}
                          onValueChange={(value) => {
                            setSelectedProviderId(value);
                            setInsuranceData(prev => ({ ...prev, plan: '' }));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select provider" />
                          </SelectTrigger>
                          <SelectContent>
                            {providers.map((provider) => (
                              <SelectItem key={provider.id} value={provider.id}>
                                {provider.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Plan Selection */}
                      <div className="space-y-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Insurance Plan
                        </FormLabel>
                        <Select
                          value={insuranceData.plan}
                          onValueChange={(value) => setInsuranceData(prev => ({ ...prev, plan: value }))}
                          disabled={!selectedProviderId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={selectedProviderId ? "Select plan" : "Select provider first"} />
                          </SelectTrigger>
                          <SelectContent>
                            {plans.map((plan) => (
                              <SelectItem key={plan.id} value={plan.id}>
                                {plan.name} ({plan.coverage_percentage}% coverage)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Policy Number */}
                      <div className="space-y-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Policy Number
                        </FormLabel>
                        <Input
                          value={insuranceData.policy_number}
                          onChange={(e) => setInsuranceData(prev => ({ ...prev, policy_number: e.target.value }))}
                          placeholder="e.g., POL-12345678"
                        />
                      </div>

                      {/* Validity Period */}
                      <div className="space-y-2">
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Validity Period
                        </FormLabel>
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <DatePicker
                              date={insuranceData.valid_from}
                              setDate={(date) => setInsuranceData(prev => ({ ...prev, valid_from: date }))}
                              placeholder="Start date"
                              className="w-full"
                            />
                          </div>
                          <span className="text-muted-foreground text-sm">to</span>
                          <div className="flex-1">
                            <DatePicker
                              date={insuranceData.valid_until}
                              setDate={(date) => setInsuranceData(prev => ({ ...prev, valid_until: date }))}
                              placeholder="No expiry"
                              className="w-full"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">Leave end date blank for no expiry</p>
                      </div>
                    </div>
                  )}

                  {!insuranceData.hasInsurance && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Shield className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No insurance will be added</p>
                      <p className="text-xs mt-1">You can add insurance later from the patient's profile</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="admission" className="space-y-4 mt-4">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <Stethoscope className="h-4 w-4" />
                    Encounter Type
                  </label>
                  <RadioGroup
                    value={admissionType}
                    onValueChange={(val) => {
                      setAdmissionType(val);
                      setSelectedDepartment("");
                      setSelectedClinic("");
                      setSelectedPrimaryTeam("");
                      setSelectedWard("");
                      form.setValue("bed_id", "");
                    }}
                    className="flex flex-col space-y-2"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="outpatient" id="outpatient" />
                      <label htmlFor="outpatient" className="font-normal cursor-pointer">
                        Outpatient (Clinic visit)
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="inpatient" id="inpatient" />
                      <label htmlFor="inpatient" className="font-normal cursor-pointer">
                        Inpatient (Admit to ward)
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="emergency" id="emergency" />
                      <label htmlFor="emergency" className="font-normal cursor-pointer">
                        Emergency (ED triage)
                      </label>
                    </div>
                  </RadioGroup>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    Department
                    <span className="text-rose-500">*</span>
                  </label>
                  <Select
                    value={selectedDepartment}
                    onValueChange={(val) => {
                      setSelectedDepartment(val);
                      setSelectedClinic("");
                      setSelectedPrimaryTeam("");
                    }}
                  >
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder={isDepartmentsLoading ? "Loading departments..." : "Select department"} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id} className="font-mono">
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {admissionType === 'outpatient' && selectedDepartment && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                      <Stethoscope className="h-4 w-4" />
                      Clinic
                      {clinicSelectionRequired && <span className="text-rose-500">*</span>}
                    </label>

                    {activeClinicOptions.length === 0 ? (
                      <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          <p className="text-sm text-amber-700 dark:text-amber-300 font-mono">
                            No clinics currently scheduled for this department
                          </p>
                        </div>
                      </div>
                    ) : activeClinicOptions.length === 1 ? (
                      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <p className="text-sm text-emerald-700 dark:text-emerald-300">
                            Auto-selected: <span className="font-mono font-medium">{activeClinicOptions[0].name}</span>
                          </p>
                        </div>
                      </div>
                    ) : (
                      <Select value={selectedClinic} onValueChange={setSelectedClinic}>
                        <SelectTrigger className="font-mono">
                          <SelectValue placeholder="Select clinic" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeClinicOptions.map((clinic) => (
                            <SelectItem key={clinic.id} value={clinic.id} className="font-mono">
                              {clinic.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {clinicSelectionRequired && !selectedClinic && (
                      <p className="text-xs text-rose-500 font-mono">
                        Multiple clinics are active; please select one
                      </p>
                    )}
                  </div>
                )}

                {admissionType === 'inpatient' && selectedDepartment && (
                  <>
                    {/* Care Team Selection */}
                    <TeamSelectionField
                      departmentId={selectedDepartment}
                      encounterType={admissionType}
                      value={selectedPrimaryTeam}
                      onChange={setSelectedPrimaryTeam}
                    />

                    <div className="flex items-center space-x-2 mb-4">
                      <input
                        type="checkbox"
                        id="waitingList"
                        checked={isWaitingList}
                        onChange={(e) => {
                          setIsWaitingList(e.target.checked);
                          if (e.target.checked) {
                            setSelectedWard("");
                            form.setValue("bed_id", "");
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <label htmlFor="waitingList" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Add to Waiting List (Assign bed later)
                      </label>
                    </div>

                    {!isWaitingList && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Ward</FormLabel>
                          <Select onValueChange={setSelectedWard} value={selectedWard}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select ward" />
                            </SelectTrigger>
                            <SelectContent>
                              {wards.map((ward) => (
                                <SelectItem key={ward.id} value={ward.id}>
                                  {ward.name} ({ward.ward_type})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>

                        <FormField
                          control={form.control}
                          name="bed_id"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Bed</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value} disabled={!selectedWard}>
                                <SelectTrigger>
                                  <SelectValue placeholder={selectedWard ? "Select bed" : "Select ward first"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {beds.map((bed) => (
                                    <SelectItem key={bed.id} value={bed.id}>
                                      {bed.bed_number} ({bed.bed_type}) - ${bed.total_rate}
                                    </SelectItem>
                                  ))}
                                  {selectedWard && beds.length === 0 && (
                                    <div className="p-2 text-sm text-muted-foreground">No available beds</div>
                                  )}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    <FormField
                      control={form.control}
                      name="admission_notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Admission Notes</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Reason for admission, initial observations..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {/* Emergency: Show team selection and triage notes */}
                {admissionType === 'emergency' && selectedDepartment && (
                  <>
                    {/* Care Team Selection for Emergency */}
                    <TeamSelectionField
                      departmentId={selectedDepartment}
                      encounterType={admissionType}
                      value={selectedPrimaryTeam}
                      onChange={setSelectedPrimaryTeam}
                    />

                    <FormField
                      control={form.control}
                      name="admission_notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            Triage Notes
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Chief complaint, initial assessment..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {/* Outpatient: Show visit notes only (no team selection) */}
                {admissionType === 'outpatient' && selectedDepartment && (
                  <FormField
                    control={form.control}
                    name="admission_notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                          Visit Notes
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Reason for visit..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </TabsContent>

              <div className="flex justify-end pt-6">
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="font-mono text-sm bg-primary hover:bg-primary/90"
                >
                  {isLoading ? "Saving..." : isEditMode ? "Update Patient" : "Register Patient"}
                </Button>
              </div>
            </form>
          </Form>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default PatientForm;
