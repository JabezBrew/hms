import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  useUpdatePatientWithFHIR,
  useRegisterPatient,
  usePatientValidationRules
} from "@/hooks/usePatientQueries";
import { useWards, useWardBeds } from "@/hooks/useWardQueries";
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
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
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
      // Format data for registration
      const formattedData = {
        ...data,
        date_of_birth: format(data.date_of_birth, 'yyyy-MM-dd')
      };

      // Add admission details if inpatient
      if (admissionType === 'inpatient') {
        formattedData.admission_details = {
          type: 'inpatient',
          bed_id: isWaitingList ? null : data.bed_id,
          notes: data.admission_notes
        };
      } else {
        formattedData.admission_details = {
          type: 'outpatient'
        };
      }

      // Register new patient using mutation
      registerPatientMutation.mutate(
        formattedData,
        {
          onSuccess: (response) => {
            toast.success("Patient registered successfully");

            if (onSuccess) {
              // Check if response.data exists, otherwise use response directly
              const patientData = response.data !== undefined ? response.data : response;
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
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="personal" className="font-mono text-xs">Personal Information</TabsTrigger>
            <TabsTrigger value="medical" className="font-mono text-xs">Medical Information</TabsTrigger>
            <TabsTrigger value="contact" className="font-mono text-xs">Contact Information</TabsTrigger>
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

              <TabsContent value="admission" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <FormLabel className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Admission Type</FormLabel>
                  <RadioGroup
                    defaultValue="outpatient"
                    value={admissionType}
                    onValueChange={setAdmissionType}
                    className="flex flex-col space-y-1"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="outpatient" id="outpatient" />
                      <FormLabel htmlFor="outpatient" className="font-normal cursor-pointer">Outpatient (No admission)</FormLabel>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="inpatient" id="inpatient" />
                      <FormLabel htmlFor="inpatient" className="font-normal cursor-pointer">Inpatient (Admit to ward)</FormLabel>
                    </div>
                  </RadioGroup>
                </div>

                {admissionType === 'inpatient' && (
                  <>
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
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select ward" />
                              </SelectTrigger>
                            </FormControl>
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
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder={selectedWard ? "Select bed" : "Select ward first"} />
                                  </SelectTrigger>
                                </FormControl>
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
